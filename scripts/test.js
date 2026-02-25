#!/usr/bin/env node

/**
 * Test runner script that compiles TypeScript tests with esbuild
 * and runs them with Node.js built-in test runner
 */

import { build } from 'esbuild';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TESTS_DIR = path.join(PROJECT_ROOT, 'tests/integration');
const DIST_DIR = path.join(PROJECT_ROOT, 'tests-dist');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');

async function buildSourceModules() {
  console.log('Building source modules...');

  // Build source modules directly to src directory (as .js files alongside .ts)
  const dirs = ['config', 'process', 'commands'];

  for (const dir of dirs) {
    const dirPath = path.join(SRC_DIR, dir);
    if (!fs.existsSync(dirPath)) continue;

    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.ts'));

    for (const file of files) {
      const inFile = path.join(dirPath, file);
      const outFile = path.join(dirPath, file.replace('.ts', '.js'));

      await build({
        entryPoints: [inFile],
        bundle: false,
        platform: 'node',
        target: 'es2022',
        format: 'esm',
        outfile: outFile,
        absWorkingDir: PROJECT_ROOT,
        logLevel: 'silent',
      });
    }
  }

  console.log('Built source modules');
}

async function buildTests(skipBlocking = false) {
  console.log('Building TypeScript tests...');

  // Clean dist directory
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // Also create tests/integration subdirectory to match original structure
  const outputSubDir = path.join(DIST_DIR, 'integration');
  fs.mkdirSync(outputSubDir, { recursive: true });

  // Find all test files
  let testFiles = fs.readdirSync(TESTS_DIR)
    .filter(f => f.endsWith('.test.ts'))
    .map(f => path.join(TESTS_DIR, f));

  // Skip blocking-processes tests by default (they have infinite loops)
  if (skipBlocking) {
    testFiles = testFiles.filter(f => !f.includes('blocking-processes'));
  }

  // Build each test file
  for (const testFile of testFiles) {
    const outputFile = path.join(
      outputSubDir,
      path.basename(testFile).replace('.ts', '.js')
    );

    await build({
      entryPoints: [testFile],
      bundle: false,
      platform: 'node',
      target: 'es2022',
      format: 'esm',
      outfile: outputFile,
      absWorkingDir: PROJECT_ROOT,
      logLevel: 'error',
    });
  }

  console.log(`Built ${testFiles.length} test files`);
  return testFiles.length;
}

function runTests(verbose = false) {
  const testFiles = fs.readdirSync(path.join(DIST_DIR, 'integration'))
    .filter(f => f.endsWith('.test.js'))
    .map(f => path.join(DIST_DIR, 'integration', f));

  const args = ['--test'];
  if (verbose) {
    args.push('--verbose');
  }
  args.push(...testFiles);

  console.log('\nRunning tests...\n');
  const result = spawnSync('node', args, {
    stdio: 'inherit',
    cwd: PROJECT_ROOT,
    shell: true
  });

  if (result.status !== 0) {
    throw new Error(`Tests failed with exit code ${result.status}`);
  }

  return { status: result.status };
}

async function cleanupSourceModules() {
  // Remove generated .js files from src directory
  const dirs = ['config', 'process', 'commands'];

  for (const dir of dirs) {
    const dirPath = path.join(SRC_DIR, dir);
    if (!fs.existsSync(dirPath)) continue;

    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.js'));

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      fs.unlinkSync(filePath);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const includeBlocking = args.includes('--include-blocking') || args.includes('-b');

  try {
    await buildSourceModules();
    await buildTests(!includeBlocking);
    runTests(verbose);

    // Clean up
    cleanupSourceModules();
    if (fs.existsSync(DIST_DIR)) {
      fs.rmSync(DIST_DIR, { recursive: true, force: true });
    }
  } catch (error) {
    console.error('Test failed:', error.message);
    // Still try to clean up on error
    try {
      cleanupSourceModules();
    } catch (e) {
      // Ignore cleanup errors
    }
    process.exit(1);
  }
}

main();
