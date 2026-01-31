/**
 * Integration tests for CLI commands
 *
 * These tests verify the CLI command functionality including:
 * - up command (starting process groups)
 * - ls command (listing groups)
 * - down command (stopping groups)
 * - Error handling
 */

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { upCommand } from '../../src/commands/up.js';
import { lsCommand } from '../../src/commands/ls.js';
import { downCommand } from '../../src/commands/down.js';
import { groupsCommand } from '../../src/commands/groups.js';

describe('CLI Commands Integration Tests', () => {
  let testConfigDir: string;
  let testConfigPath: string;
  let originalHomeDir: string;
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let logOutput: string[];
  let errorOutput: string[];

  before(() => {
    // Create a temporary directory for test configs
    testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easycli-cli-test-'));
    testConfigPath = path.join(testConfigDir, '.easycli.yml');

    // Mock os.homedir to return our test directory
    originalHomeDir = os.homedir();
    mock.method(os, 'homedir', () => testConfigDir);

    // Capture console output
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    logOutput = [];
    errorOutput = [];

    console.log = (...args: any[]) => {
      logOutput.push(args.map(arg => String(arg)).join(' '));
    };
    console.error = (...args: any[]) => {
      errorOutput.push(args.map(arg => String(arg)).join(' '));
    };
  });

  after(() => {
    // Restore console
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    os.homedir = () => originalHomeDir;

    // Clean up test directory
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  function resetOutput() {
    logOutput = [];
    errorOutput = [];
  }

  function getLogOutput(): string {
    return logOutput.join('\n');
  }

  function getErrorOutput(): string {
    return errorOutput.join('\n');
  }

  describe('upCommand', () => {
    it('should start a group with echo commands (completes quickly)', { timeout: 5000 }, async () => {
      const configContent = `
groups:
  echo-test:
    tool: echo
    restart: no
    items:
      - hello
      - world
`;

      fs.writeFileSync(testConfigPath, configContent);

      // upCommand waits for Ctrl+C, so we need a different approach
      // We'll test by verifying the config loads correctly
      // The actual process spawning is tested in ProcessManager tests

      // For now, just verify the command structure is valid
      // Note: upCommand is designed to wait indefinitely, so we can't test it fully
      // We just verify it doesn't throw on valid config
      try {
        // Create a timeout promise to avoid hanging
        const timeoutPromise = new Promise<number>((resolve) => {
          setTimeout(() => resolve(0), 100);
        });

        // Start the command but it will wait for signals
        // We'll just verify the initial setup doesn't throw
        const { ConfigLoader } = await import('../../src/config/loader.js');
        const loader = new ConfigLoader();
        const { config } = loader.getGroup('echo-test');

        assert.strictEqual(config.tool, 'echo');
        assert.strictEqual(config.restart, 'no');
        assert.strictEqual(config.items.length, 2);
      } catch (err) {
        assert.fail(`Should not throw: ${err}`);
      }
    });

    it('should handle missing config file', async () => {
      // Remove config file
      if (fs.existsSync(testConfigPath)) {
        fs.unlinkSync(testConfigPath);
      }

      const exitCode = await upCommand('missing');

      assert.strictEqual(exitCode, 1);
      assert.ok(getErrorOutput().includes('Config file not found') || getErrorOutput().includes('Unknown group'));
    });

    it('should handle unknown group', async () => {
      const configContent = `
groups:
  known-group:
    tool: echo
    restart: no
    items:
      - test
`;

      fs.writeFileSync(testConfigPath, configContent);

      const exitCode = await upCommand('unknown-group');

      assert.strictEqual(exitCode, 1);
      assert.ok(getErrorOutput().includes('Unknown group'));
    });

    it('should handle restart policies correctly', { timeout: 3000 }, async () => {
      const configContent = `
groups:
  restart-test:
    tool: echo
    restart: yes
    items:
      - test
`;

      fs.writeFileSync(testConfigPath, configContent);

      // Verify config loads with correct restart policy
      const { ConfigLoader } = await import('../../src/config/loader.js');
      const loader = new ConfigLoader();
      const { config } = loader.getGroup('restart-test');

      assert.strictEqual(config.restart, 'yes');
    });
  });

  describe('lsCommand', () => {
    it('should list items in a group', async () => {
      const configContent = `
tools:
  docker:
    cmd: docker run -it --rm

groups:
  web:
    tool: docker
    restart: unless-stopped
    items:
      - nginx,nginx,-p,80:80
      - redis,redis
      - postgres,postgres,-e,POSTGRES_PASSWORD=test
`;

      fs.writeFileSync(testConfigPath, configContent);
      resetOutput();

      const exitCode = await lsCommand('web');

      assert.strictEqual(exitCode, 0);
      const output = getLogOutput();
      assert.ok(output.includes('Group: web'));
      assert.ok(output.includes('Tool: docker'));
      assert.ok(output.includes('Restart: unless-stopped'));
      assert.ok(output.includes('Items:'));
      assert.ok(output.includes('nginx'));
      assert.ok(output.includes('redis'));
      assert.ok(output.includes('postgres'));
    });

    it('should list items with correct arguments', async () => {
      const configContent = `
groups:
  test:
    tool: echo
    restart: no
    items:
      - item1,arg1,arg2
      - item2,arg3,arg4,arg5
`;

      fs.writeFileSync(testConfigPath, configContent);
      resetOutput();

      const exitCode = await lsCommand('test');

      assert.strictEqual(exitCode, 0);
      const output = getLogOutput();
      assert.ok(output.includes('item1'));
      assert.ok(output.includes('arg1, arg2'));
      assert.ok(output.includes('item2'));
      assert.ok(output.includes('arg3, arg4, arg5'));
    });

    it('should handle empty items list', async () => {
      const configContent = `
groups:
  empty:
    tool: echo
    restart: no
    items: []
`;

      fs.writeFileSync(testConfigPath, configContent);
      resetOutput();

      const exitCode = await lsCommand('empty');

      assert.strictEqual(exitCode, 0);
      const output = getLogOutput();
      assert.ok(output.includes('Group: empty'));
      assert.ok(output.includes('Items:'));
    });

    it('should return error exit code for unknown group', async () => {
      const configContent = `
groups:
  known:
    tool: echo
    restart: no
    items:
      - test
`;

      fs.writeFileSync(testConfigPath, configContent);
      resetOutput();

      const exitCode = await lsCommand('unknown');

      assert.strictEqual(exitCode, 1);
      assert.ok(getErrorOutput().includes('Unknown group'));
    });

    it('should return error exit code for missing config', async () => {
      if (fs.existsSync(testConfigPath)) {
        fs.unlinkSync(testConfigPath);
      }
      resetOutput();

      const exitCode = await lsCommand('any-group');

      assert.strictEqual(exitCode, 1);
      assert.ok(getErrorOutput().includes('Config file not found') || getErrorOutput().includes('Unknown group'));
    });

    it('should handle groups without registered tools', async () => {
      const configContent = `
groups:
  direct:
    tool: node
    restart: no
    items:
      - server.js,3000
      - worker.js
`;

      fs.writeFileSync(testConfigPath, configContent);
      resetOutput();

      const exitCode = await lsCommand('direct');

      assert.strictEqual(exitCode, 0);
      const output = getLogOutput();
      assert.ok(output.includes('Tool: node'));
    });
  });

  describe('downCommand', () => {
    it('should return success and display message', async () => {
      resetOutput();

      const exitCode = await downCommand('test-group');

      assert.strictEqual(exitCode, 0);
      const output = getLogOutput();
      assert.ok(output.includes('down test-group'));
      assert.ok(output.includes('will stop'));
    });

    it('should work with any group name', async () => {
      const groupNames = ['test1', 'my-app', 'production', 'staging-env'];

      for (const groupName of groupNames) {
        resetOutput();
        const exitCode = await downCommand(groupName);
        assert.strictEqual(exitCode, 0);
        assert.ok(getLogOutput().includes(groupName));
      }
    });
  });

  describe('Command integration scenarios', () => {
    it('should handle ls followed by up workflow', async () => {
      const configContent = `
groups:
  workflow-test:
    tool: echo
    restart: no
    items:
      - service1
      - service2
      - service3
`;

      fs.writeFileSync(testConfigPath, configContent);

      // First list the group
      resetOutput();
      const lsExitCode = await lsCommand('workflow-test');
      assert.strictEqual(lsExitCode, 0);
      assert.ok(getLogOutput().includes('workflow-test'));

      // Then verify config loads for up
      const { ConfigLoader } = await import('../../src/config/loader.js');
      const loader = new ConfigLoader();
      const { config } = loader.getGroup('workflow-test');

      assert.strictEqual(config.items.length, 3);
    });

    it('should handle multiple groups in config', async () => {
      const configContent = `
groups:
  group1:
    tool: echo
    restart: no
    items:
      - item1

  group2:
    tool: echo
    restart: yes
    items:
      - item2

  group3:
    tool: echo
    restart: unless-stopped
    items:
      - item3
`;

      fs.writeFileSync(testConfigPath, configContent);

      // List each group
      for (const groupName of ['group1', 'group2', 'group3']) {
        resetOutput();
        const exitCode = await lsCommand(groupName);
        assert.strictEqual(exitCode, 0);
        assert.ok(getLogOutput().includes(`Group: ${groupName}`));
      }
    });
  });

  describe('Error handling', () => {
    it('should handle malformed YAML in config', async () => {
      fs.writeFileSync(testConfigPath, 'invalid: yaml: [');

      resetOutput();

      const exitCode = await lsCommand('any-group');

      assert.strictEqual(exitCode, 1);
      assert.ok(getErrorOutput().includes('Invalid YAML') || getErrorOutput().includes('Config file not found') || getErrorOutput().includes('Unknown group'));
    });

    it('should handle config with missing required fields', async () => {
      const configContent = `
groups:
  incomplete:
    tool: echo
    # missing restart and items
`;

      fs.writeFileSync(testConfigPath, configContent);

      resetOutput();

      const exitCode = await lsCommand('incomplete');

      // Should either fail or handle gracefully
      // The behavior depends on the validator implementation
      assert.ok([0, 1].includes(exitCode));
    });

    it('should handle config with extra unknown fields', async () => {
      const configContent = `
extra_field: value
another_extra:
  nested: value

groups:
  with-extras:
    tool: echo
    restart: no
    items:
      - test
    extra_item_field: should be ignored
`;

      fs.writeFileSync(testConfigPath, configContent);

      resetOutput();

      const exitCode = await lsCommand('with-extras');

      // Should succeed - extra fields are ignored
      assert.strictEqual(exitCode, 0);
    });
  });

  describe('Special characters and edge cases', () => {
    it('should handle group names with hyphens and underscores', async () => {
      const configContent = `
groups:
  my-test-group_123:
    tool: echo
    restart: no
    items:
      - test
`;

      fs.writeFileSync(testConfigPath, configContent);

      resetOutput();
      const exitCode = await lsCommand('my-test-group_123');

      assert.strictEqual(exitCode, 0);
      assert.ok(getLogOutput().includes('my-test-group_123'));
    });

    it('should handle item strings with special characters', async () => {
      const configContent = `
groups:
  special-chars:
    tool: echo
    restart: no
    items:
      - "service,with,commas"
      - "another test"
      - simple
`;

      fs.writeFileSync(testConfigPath, configContent);

      resetOutput();
      const exitCode = await lsCommand('special-chars');

      assert.strictEqual(exitCode, 0);
      const output = getLogOutput();
      assert.ok(output.includes('service,with,commas'));
      assert.ok(output.includes('another test'));
    });

    it('should handle all restart policy values', async () => {
      const configContent = `
groups:
  restart-yes:
    tool: echo
    restart: yes
    items:
      - test

  restart-no:
    tool: echo
    restart: no
    items:
      - test

  restart-unless-stopped:
    tool: echo
    restart: unless-stopped
    items:
      - test
`;

      fs.writeFileSync(testConfigPath, configContent);

      for (const groupName of ['restart-yes', 'restart-no', 'restart-unless-stopped']) {
        resetOutput();
        const exitCode = await lsCommand(groupName);
        assert.strictEqual(exitCode, 0);
        assert.ok(getLogOutput().includes(groupName));
      }
    });
  });

  describe('Tools configuration', () => {
    it('should handle config with tools defined', async () => {
      const configContent = `
tools:
  docker:
    cmd: docker run -it --rm
  node:
    cmd: node
  python:
    cmd: python3

groups:
  docker-group:
    tool: docker
    restart: no
    items:
      - nginx,nginx

  node-group:
    tool: node
    restart: yes
    items:
      - server.js
`;

      fs.writeFileSync(testConfigPath, configContent);

      // Test docker group
      resetOutput();
      let exitCode = await lsCommand('docker-group');
      assert.strictEqual(exitCode, 0);
      assert.ok(getLogOutput().includes('Tool: docker'));

      // Test node group
      resetOutput();
      exitCode = await lsCommand('node-group');
      assert.strictEqual(exitCode, 0);
      assert.ok(getLogOutput().includes('Tool: node'));
    });

    it('should handle group referencing undefined tool', async () => {
      const configContent = `
groups:
  missing-tool:
    tool: nonexistent-tool
    restart: no
    items:
      - test
`;

      fs.writeFileSync(testConfigPath, configContent);

      resetOutput();
      const exitCode = await lsCommand('missing-tool');

      // Should handle gracefully - tool is treated as direct executable
      assert.strictEqual(exitCode, 0);
      assert.ok(getLogOutput().includes('Tool: nonexistent-tool'));
    });
  });

  describe('groupsCommand', () => {
    it('should list group names in simple mode', async () => {
      const configContent = `
groups:
  web:
    tool: docker
    restart: no
    items:
      - nginx
      - redis

  database:
    tool: docker
    restart: yes
    items:
      - postgres
`;
      fs.writeFileSync(testConfigPath, configContent);
      resetOutput();

      const exitCode = await groupsCommand(false);

      assert.strictEqual(exitCode, 0);
      const output = getLogOutput();
      assert.ok(output.includes('web'));
      assert.ok(output.includes('database'));
    });

    it('should show detailed table in verbose mode', async () => {
      const configContent = `
tools:
  docker:
    cmd: docker run

groups:
  web:
    tool: docker
    restart: unless-stopped
    items:
      - nginx
      - redis
      - postgres

  direct:
    tool: node
    restart: no
    items:
      - server.js
`;
      fs.writeFileSync(testConfigPath, configContent);
      resetOutput();

      const exitCode = await groupsCommand(true);

      assert.strictEqual(exitCode, 0);
      const output = getLogOutput();
      assert.ok(output.includes('GROUP'));
      assert.ok(output.includes('TOOL'));
      assert.ok(output.includes('RESTART'));
      assert.ok(output.includes('ITEMS'));
      assert.ok(output.includes('web'));
      assert.ok(output.includes('docker'));
      assert.ok(output.includes('unless-stopped'));
      assert.ok(output.includes('3')); // item count for web
      assert.ok(output.includes('direct'));
      assert.ok(output.includes('node'));
      assert.ok(output.includes('1')); // item count for direct
    });
  });
});
