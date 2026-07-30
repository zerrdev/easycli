/**
 * Integration tests for ConfigLoader
 *
 * These tests verify the config loading functionality including:
 * - Loading from different file locations
 * - YAML parsing
 * - Validation
 * - Group retrieval
 */

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigLoader, ConfigError } from '../../src/config/loader.js';
import yaml from 'js-yaml';

describe('ConfigLoader Integration Tests', () => {
  let testConfigDir: string;
  let testConfigPath: string;
  let originalHomeDir: string;

  before(() => {
    // Create a temporary directory for test configs
    testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cligr-test-'));
    testConfigPath = path.join(testConfigDir, '.cligr.yml');

    // Mock os.homedir to return our test directory
    originalHomeDir = os.homedir();
    mock.method(os, 'homedir', () => testConfigDir);
  });

  after(() => {
    // Clean up test directory
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
    // Restore original os.homedir
    mock.method(os, 'homedir', () => originalHomeDir);
  });

  describe('load()', () => {
    it('should load a valid config file from home directory', () => {
      const configContent = `
tools:
  docker:
    cmd: docker run -it --rm
  node:
    cmd: node

groups:
  test1:
    tool: docker
    restart: yes
    items:
      alpine: alpine,sh
      nginx: nginx,nginx,-p,80:80

  test2:
    tool: node
    restart: no
    items:
      server: server.js
      worker: worker.js
`;

      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      const config = loader.load();

      assert.ok(config.groups);
      assert.ok(config.tools);
      assert.strictEqual(Object.keys(config.groups).length, 2);
      assert.strictEqual(config.groups.test1.tool, 'docker');
      assert.strictEqual(config.groups.test1.restart, 'yes');
      assert.strictEqual(Object.keys(config.groups.test1.items).length, 2);
      assert.strictEqual(config.groups.test2.tool, 'node');
      assert.strictEqual(Object.keys(config.groups.test2.items).length, 2);
    });

    it('should throw ConfigError when config file does not exist', () => {
      // Remove config file if it exists
      if (fs.existsSync(testConfigPath)) {
        fs.unlinkSync(testConfigPath);
      }

      const loader = new ConfigLoader();

      assert.throws(
        () => loader.load(),
        (err: Error) => {
          assert.ok(err instanceof ConfigError);
          assert.ok(err.message.includes('Config file not found'));
          return true;
        }
      );
    });

    it('should throw ConfigError for invalid YAML', () => {
      fs.writeFileSync(testConfigPath, 'invalid: yaml: content: [unclosed');

      const loader = new ConfigLoader();

      assert.throws(
        () => loader.load(),
        (err: Error) => {
          assert.ok(err instanceof ConfigError);
          assert.ok(err.message.includes('Invalid YAML'));
          return true;
        }
      );
    });

    it('should throw ConfigError when config is not an object', () => {
      fs.writeFileSync(testConfigPath, 'just a string');

      const loader = new ConfigLoader();

      assert.throws(
        () => loader.load(),
        (err: Error) => {
          assert.ok(err instanceof ConfigError);
          assert.ok(err.message.includes('Config must be an object'));
          return true;
        }
      );
    });

    it('should throw ConfigError when groups field is missing', () => {
      fs.writeFileSync(testConfigPath, 'tools:\n  docker:\n    cmd: docker');

      const loader = new ConfigLoader();

      assert.throws(
        () => loader.load(),
        (err: Error) => {
          assert.ok(err instanceof ConfigError);
          assert.ok(err.message.includes('groups'));
          return true;
        }
      );
    });

    it('should load config without tools section', () => {
      const configContent = `
groups:
  simple:
    tool: echo
    restart: no
    items:
      hello: hello
      world: world
`;

      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      const config = loader.load();

      assert.ok(config.groups);
      assert.strictEqual(Object.keys(config.groups).length, 1);
      assert.strictEqual(config.groups.simple.tool, 'echo');
    });
  });

  describe('getGroup()', () => {
    before(() => {
      const configContent = `
tools:
  docker:
    cmd: docker run -it --rm

groups:
  web:
    tool: docker
    restart: unless-stopped
    items:
      nginx: nginx,nginx,-p,80:80
      redis: redis,redis

  api:
    tool: node
    restart: yes
    items:
      server: server.js,3000
      worker: worker.js
`;

      fs.writeFileSync(testConfigPath, configContent);
    });

    it('should retrieve an existing group with tool', () => {
      const loader = new ConfigLoader();
      const result = loader.getGroup('web');

      assert.strictEqual(result.config.tool, 'docker');
      assert.strictEqual(result.config.restart, 'unless-stopped');
      assert.strictEqual(result.tool, 'docker');
      assert.strictEqual(result.toolTemplate, 'docker run -it --rm');
      assert.strictEqual(result.items.length, 2);
    });

    it('should retrieve an existing group without registered tool', () => {
      const loader = new ConfigLoader();
      const result = loader.getGroup('api');

      assert.strictEqual(result.config.tool, 'node');
      assert.strictEqual(result.config.restart, 'yes');
      assert.strictEqual(result.tool, null); // No registered tool
      assert.strictEqual(result.toolTemplate, null);
      assert.strictEqual(result.items.length, 2);
    });

    it('should throw ConfigError for unknown group', () => {
      const loader = new ConfigLoader();

      assert.throws(
        () => loader.getGroup('unknown'),
        (err: Error) => {
          assert.ok(err instanceof ConfigError);
          assert.ok(err.message.includes('Unknown group'));
          assert.ok(err.message.includes('unknown'));
          return true;
        }
      );
    });
  });

  describe('listGroups()', () => {
    it('should return all group names', () => {
      const configContent = `
groups:
  group1:
    tool: echo
    restart: no
    items:
      test1: test1

  group2:
    tool: echo
    restart: no
    items:
      test2: test2

  group3:
    tool: echo
    restart: no
    items:
      test3: test3
`;

      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      const groups = loader.listGroups();

      assert.strictEqual(groups.length, 3);
      assert.ok(groups.includes('group1'));
      assert.ok(groups.includes('group2'));
      assert.ok(groups.includes('group3'));
    });

    it('should return empty array when no groups exist', () => {
      const configContent = `
groups: {}
`;

      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      const groups = loader.listGroups();

      assert.strictEqual(groups.length, 0);
    });
  });

  describe('Constructor with explicit path', () => {
    it('should load config from explicit path', () => {
      const customConfigPath = path.join(testConfigDir, 'custom-config.yml');
      const configContent = `
groups:
  custom:
    tool: echo
    restart: no
    items:
      test: test
`;

      fs.writeFileSync(customConfigPath, configContent);

      const loader = new ConfigLoader(customConfigPath);
      const config = loader.load();

      assert.ok(config.groups);
      assert.strictEqual(config.groups.custom.tool, 'echo');
    });

    it('should throw error when explicit path does not exist', () => {
      const nonExistentPath = path.join(testConfigDir, 'does-not-exist.yml');

      const loader = new ConfigLoader(nonExistentPath);

      assert.throws(
        () => loader.load(),
        (err: Error) => {
          assert.ok(err instanceof ConfigError);
          return true;
        }
      );
    });
  });

  describe('saveConfig()', () => {
    it('should save config back to file', () => {
      const configContent = `
groups:
  test1:
    tool: echo
    restart: no
    items:
      hello: hello
`;
      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      const config = loader.load();
      config.groups.test1.restart = 'yes';

      loader.saveConfig(config);

      const saved = fs.readFileSync(testConfigPath, 'utf-8');
      const parsed = yaml.load(saved) as any;
      assert.strictEqual(parsed.groups.test1.restart, 'yes');
    });
  });

  describe('toggleItem()', () => {
    it('should add item to disabledItems when disabling', () => {
      const configContent = `
groups:
  test1:
    tool: echo
    restart: no
    items:
      hello: hello
      world: world
`;
      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      loader.toggleItem('test1', 'hello', false);

      const reloaded = new ConfigLoader().load();
      assert.deepStrictEqual(reloaded.groups.test1.disabledItems, ['hello']);
    });

    it('should remove item from disabledItems when enabling', () => {
      const configContent = `
groups:
  test1:
    tool: echo
    restart: no
    disabledItems:
      - hello
    items:
      hello: hello
      world: world
`;
      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      loader.toggleItem('test1', 'hello', true);

      const reloaded = new ConfigLoader().load();
      assert.strictEqual(reloaded.groups.test1.disabledItems, undefined);
    });
  });

  describe('disabledItems', () => {
    // Disabled items are listed rather than dropped, so the dashboard can show
    // them as stopped and the user can start them without editing the config.
    it('should return disabled items alongside enabled ones, in config order', () => {
      const configContent = `
groups:
  test1:
    tool: echo
    restart: no
    disabledItems:
      - hello
    items:
      hello: hello
      world: world
`;
      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      const result = loader.getGroup('test1');

      assert.deepStrictEqual(result.items.map(i => i.name), ['hello', 'world']);
      assert.strictEqual(result.config.disabledItems?.length, 1);
    });

    it('should report which item names are disabled', () => {
      const configContent = `
groups:
  test1:
    tool: echo
    restart: no
    disabledItems:
      - hello
    items:
      hello: hello
      world: world
`;
      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      const result = loader.getGroup('test1');

      assert.deepStrictEqual(result.disabledNames, ['hello']);
    });

    it('should report no disabled names when disabledItems is empty', () => {
      const configContent = `
groups:
  test1:
    tool: echo
    restart: no
    disabledItems: []
    items:
      hello: hello
      world: world
`;
      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      const result = loader.getGroup('test1');

      assert.strictEqual(result.items.length, 2);
      assert.deepStrictEqual(result.disabledNames, []);
    });

    it('should report no disabled names when the key is absent', () => {
      const configContent = `
groups:
  test1:
    tool: echo
    restart: no
    items:
      hello: hello
`;
      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      const result = loader.getGroup('test1');

      assert.deepStrictEqual(result.disabledNames, []);
    });
  });

  describe('Config precedence', () => {
    it('should prefer home directory config over current directory', () => {
      const homeConfigPath = path.join(testConfigDir, '.cligr.yml');
      const currentConfigPath = path.join(process.cwd(), '.cligr.yml');

      const homeContent = `
groups:
  home-group:
    tool: echo
    restart: no
    items:
      fromHome: from-home
`;

      const currentContent = `
groups:
  current-group:
    tool: echo
    restart: no
    items:
      fromCurrent: from-current
`;

      // Write home config (mocked to testConfigDir)
      fs.writeFileSync(homeConfigPath, homeContent);

      // Write current directory config
      fs.writeFileSync(currentConfigPath, currentContent);

      const loader = new ConfigLoader();
      const groups = loader.listGroups();

      // Should load from home directory
      assert.strictEqual(groups.length, 1);
      assert.strictEqual(groups[0], 'home-group');

      // Clean up current directory config
      fs.unlinkSync(currentConfigPath);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty items object', () => {
      const configContent = `
groups:
  empty:
    tool: echo
    restart: no
    items: {}
`;

      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      const result = loader.getGroup('empty');

      assert.strictEqual(result.items.length, 0);
    });

    it('should handle special characters in item strings', () => {
      const configContent = `
groups:
  special:
    tool: echo
    restart: no
    items:
      hello: "hello, world"
      test: "test,with,commas"
      spaces: "spaces test"
`;

      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      const result = loader.getGroup('special');

      assert.strictEqual(result.items.length, 3);
      assert.strictEqual(result.items[0].value, 'hello, world');
      assert.strictEqual(result.items[1].value, 'test,with,commas');
    });

    it('should handle all restart policy values', () => {
      const configContent = `
groups:
  restart-yes:
    tool: echo
    restart: yes
    items:
      test: test

  restart-no:
    tool: echo
    restart: no
    items:
      test: test

  restart-unless-stopped:
    tool: echo
    restart: unless-stopped
    items:
      test: test
`;

      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();

      assert.strictEqual(loader.getGroup('restart-yes').config.restart, 'yes');
      assert.strictEqual(loader.getGroup('restart-no').config.restart, 'no');
      assert.strictEqual(loader.getGroup('restart-unless-stopped').config.restart, 'unless-stopped');
    });

    it('should inherit restart from tool when group has no restart', () => {
      const configContent = `
tools:
  docker:
    cmd: docker run
    restart: yes

groups:
  web:
    tool: docker
    items:
      nginx: nginx
`;

      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      const result = loader.getGroup('web');

      assert.strictEqual(result.config.restart, undefined);
      assert.strictEqual(result.restart, 'yes');
      assert.strictEqual(loader.getEffectiveRestart('web'), 'yes');
    });

    it('should allow group restart to override tool restart', () => {
      const configContent = `
tools:
  docker:
    cmd: docker run
    restart: yes

groups:
  web:
    tool: docker
    restart: no
    items:
      nginx: nginx
`;

      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      const result = loader.getGroup('web');

      assert.strictEqual(result.config.restart, 'no');
      assert.strictEqual(result.restart, 'no');
      assert.strictEqual(loader.getEffectiveRestart('web'), 'no');
    });

    it('should return undefined restart when neither group nor tool defines it', () => {
      const configContent = `
tools:
  docker:
    cmd: docker run

groups:
  web:
    tool: docker
    items:
      nginx: nginx
`;

      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      const result = loader.getGroup('web');

      assert.strictEqual(result.config.restart, undefined);
      assert.strictEqual(result.restart, undefined);
      assert.strictEqual(loader.getEffectiveRestart('web'), undefined);
    });
  });

  describe('Run mode', () => {
    it('should default to monitor mode with sequential off', () => {
      const configContent = `
groups:
  web:
    tool: echo
    items:
      nginx: nginx
`;

      fs.writeFileSync(testConfigPath, configContent);

      const result = new ConfigLoader().getGroup('web');

      assert.strictEqual(result.mode, 'monitor');
      assert.strictEqual(result.sequential, false);
    });

    it('should inherit mode from tool when group has no mode', () => {
      const configContent = `
tools:
  kubectx:
    cmd: kubectl config use-context $1
    mode: once

groups:
  nav-stg:
    tool: kubectx
    items:
      ctx: staging
`;

      fs.writeFileSync(testConfigPath, configContent);

      const result = new ConfigLoader().getGroup('nav-stg');

      assert.strictEqual(result.mode, 'once');
    });

    it('should allow group mode to override tool mode', () => {
      const configContent = `
tools:
  kubectx:
    cmd: kubectl config use-context $1
    mode: once

groups:
  watcher:
    tool: kubectx
    mode: monitor
    items:
      ctx: staging
`;

      fs.writeFileSync(testConfigPath, configContent);

      const result = new ConfigLoader().getGroup('watcher');

      assert.strictEqual(result.mode, 'monitor');
    });

    it('should read sequential from the group', () => {
      const configContent = `
groups:
  db-migrate:
    tool: node
    mode: once
    sequential: true
    items:
      schema: migrate.js
      seed: seed.js
`;

      fs.writeFileSync(testConfigPath, configContent);

      const result = new ConfigLoader().getGroup('db-migrate');

      assert.strictEqual(result.mode, 'once');
      assert.strictEqual(result.sequential, true);
    });

    it('should allow group sequential to override tool sequential', () => {
      const configContent = `
tools:
  node:
    cmd: node $1
    mode: once
    sequential: true

groups:
  tasks:
    tool: node
    sequential: false
    items:
      one: one.js
      two: two.js
`;

      fs.writeFileSync(testConfigPath, configContent);

      const result = new ConfigLoader().getGroup('tasks');

      assert.strictEqual(result.sequential, false);
    });

    it('should reject a mode outside monitor and once', () => {
      const configContent = `
groups:
  web:
    tool: echo
    mode: forever
    items:
      nginx: nginx
`;

      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();

      assert.throws(() => loader.load(), (err: Error) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /web/);
        assert.match(err.message, /mode/);
        return true;
      });
    });

    it('should reject a non-boolean sequential', () => {
      const configContent = `
groups:
  web:
    tool: echo
    mode: once
    sequential: sometimes
    items:
      nginx: nginx
`;

      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();

      assert.throws(() => loader.load(), (err: Error) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /sequential/);
        return true;
      });
    });

    it('should reject an invalid mode on a tool', () => {
      const configContent = `
tools:
  broken:
    cmd: echo
    mode: sometimes

groups:
  web:
    tool: broken
    items:
      nginx: nginx
`;

      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();

      assert.throws(() => loader.load(), (err: Error) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /broken/);
        return true;
      });
    });
  });
});
