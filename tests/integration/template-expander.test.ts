/**
 * Integration tests for TemplateExpander
 *
 * These tests verify the template expansion functionality including:
 * - Command template expansion with $1, $2, etc.
 * - Item string parsing
 * - Name generation
 * - Direct executable handling
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TemplateExpander } from '../../src/process/template.js';
import type { ProcessItem } from '../../src/config/types.js';

describe('TemplateExpander Integration Tests', () => {
  describe('expand()', () => {
    it('should expand template with single argument', () => {
      const template = 'echo $1';
      const itemStr = 'hello';

      const result = TemplateExpander.expand(template, itemStr, 0);

      assert.strictEqual(result.name, 'hello');
      assert.deepStrictEqual(result.args, ['hello']);
      assert.strictEqual(result.fullCmd, 'echo hello');
    });

    it('should expand template with multiple arguments', () => {
      const template = 'docker run -p $2:$3 $1';
      const itemStr = 'nginx,8080,80';

      const result = TemplateExpander.expand(template, itemStr, 0);

      assert.strictEqual(result.name, 'nginx');
      assert.deepStrictEqual(result.args, ['nginx', '8080', '80']);
      assert.strictEqual(result.fullCmd, 'docker run -p 8080:80 nginx');
    });

    it('should replace all occurrences of placeholder', () => {
      const template = 'echo $1 and $1 again';
      const itemStr = 'test';

      const result = TemplateExpander.expand(template, itemStr, 0);

      assert.strictEqual(result.fullCmd, 'echo test and test again');
    });

    it('should handle placeholders with spaces around', () => {
      const template = 'cmd $1 opt $2 end';
      const itemStr = 'arg1,arg2';

      const result = TemplateExpander.expand(template, itemStr, 0);

      assert.strictEqual(result.fullCmd, 'cmd arg1 opt arg2 end');
    });

    it('should use index as name when first argument is empty', () => {
      const template = 'echo test';
      const itemStr = ',arg2,arg3';

      const result = TemplateExpander.expand(template, itemStr, 5);

      assert.strictEqual(result.name, 'item-5');
      assert.deepStrictEqual(result.args, ['', 'arg2', 'arg3']);
    });

    it('should handle single argument with no commas', () => {
      const template = 'node $1';
      const itemStr = 'server.js';

      const result = TemplateExpander.expand(template, itemStr, 0);

      assert.strictEqual(result.name, 'server.js');
      assert.deepStrictEqual(result.args, ['server.js']);
      assert.strictEqual(result.fullCmd, 'node server.js');
    });

    it('should handle more placeholders than arguments', () => {
      const template = 'cmd $1 $2 $3 $4';
      const itemStr = 'a,b';

      const result = TemplateExpander.expand(template, itemStr, 0);

      assert.strictEqual(result.fullCmd, 'cmd a b $3 $4');
    });

    it('should trim whitespace from arguments', () => {
      const template = 'cmd $1 $2 $3';
      const itemStr = ' a , b , c ';

      const result = TemplateExpander.expand(template, itemStr, 0);

      assert.deepStrictEqual(result.args, ['a', 'b', 'c']);
      assert.strictEqual(result.fullCmd, 'cmd a b c');
    });

    it('should handle empty string argument', () => {
      const template = 'cmd $1 $2 $3';
      const itemStr = 'first,,third';

      const result = TemplateExpander.expand(template, itemStr, 0);

      assert.deepStrictEqual(result.args, ['first', '', 'third']);
      assert.strictEqual(result.fullCmd, 'cmd first  third');
    });

    it('should handle quoted paths with spaces in template', () => {
      const template = '"C:\\Program Files\\app\\app.exe" $1';
      const itemStr = 'arg1';

      const result = TemplateExpander.expand(template, itemStr, 0);

      assert.strictEqual(result.fullCmd, '"C:\\Program Files\\app\\app.exe" arg1');
    });
  });

  describe('parseItem()', () => {
    describe('with registered tool template', () => {
      it('should use tool template for expansion', () => {
        const tool = 'docker';
        const toolTemplate = 'docker run -it --rm $1';
        const itemStr = 'nginx,-p,80:80';

        const result = TemplateExpander.parseItem(tool, toolTemplate, itemStr, 0);

        assert.strictEqual(result.name, 'nginx');
        assert.strictEqual(result.fullCmd, 'docker run -it --rm nginx -p 80:80');
      });

      it('should handle complex docker compose templates', () => {
        const tool = 'compose';
        const toolTemplate = 'docker-compose run --service-ports $1';
        const itemStr = 'web';

        const result = TemplateExpander.parseItem(tool, toolTemplate, itemStr, 0);

        assert.strictEqual(result.name, 'web');
        assert.strictEqual(result.fullCmd, 'docker-compose run --service-ports web');
      });

      it('should handle templates with no placeholders', () => {
        const tool = 'echo';
        const toolTemplate = 'echo hello world';
        const itemStr = 'item1';

        const result = TemplateExpander.parseItem(tool, toolTemplate, itemStr, 0);

        assert.strictEqual(result.name, 'item1');
        assert.strictEqual(result.fullCmd, 'echo hello world');
      });
    });

    describe('without registered tool (direct executable)', () => {
      it('should prefix command with tool name', () => {
        const tool = 'node';
        const toolTemplate = null;
        const itemStr = 'server.js,3000';

        const result = TemplateExpander.parseItem(tool, toolTemplate, itemStr, 0);

        assert.strictEqual(result.name, 'server.js');
        assert.strictEqual(result.fullCmd, 'node server.js,3000');
      });

      it('should handle null tool and toolTemplate', () => {
        const tool = null;
        const toolTemplate = null;
        const itemStr = 'echo hello';

        const result = TemplateExpander.parseItem(tool, toolTemplate, itemStr, 0);

        assert.strictEqual(result.name, 'echo');
        assert.strictEqual(result.fullCmd, 'echo hello');
      });

      it('should use index for name when args are empty', () => {
        const tool = null;
        const toolTemplate = null;
        const itemStr = '';

        const result = TemplateExpander.parseItem(tool, toolTemplate, itemStr, 3);

        assert.strictEqual(result.name, 'item-3');
      });

      it('should handle multiple items with same tool', () => {
        const tool = 'python';
        const toolTemplate = null;

        const result1 = TemplateExpander.parseItem(tool, toolTemplate, 'script1.py', 0);
        const result2 = TemplateExpander.parseItem(tool, toolTemplate, 'script2.py', 1);

        assert.strictEqual(result1.name, 'script1.py');
        assert.strictEqual(result2.name, 'script2.py');
      });
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle docker service templates', () => {
      const toolTemplate = 'docker run -d --name $1_$2 -p $2:$3 $1';
      const itemStr = 'nginx,8080,80';

      const result = TemplateExpander.expand(toolTemplate, itemStr, 0);

      assert.strictEqual(result.name, 'nginx');
      assert.strictEqual(result.fullCmd, 'docker run -d --name nginx_8080 -p 8080:80 nginx');
    });

    it('should handle node process manager templates', () => {
      const toolTemplate = 'node $1 --port $2';
      const itemStr = 'server.js,3000';

      const result = TemplateExpander.expand(toolTemplate, itemStr, 0);

      assert.strictEqual(result.name, 'server.js');
      assert.strictEqual(result.fullCmd, 'node server.js --port 3000');
    });

    it('should handle database connection templates', () => {
      const toolTemplate = 'psql -h $1 -p $2 -U $3 -d $4';
      const itemStr = 'localhost,5432,admin,mydb';

      const result = TemplateExpander.expand(toolTemplate, itemStr, 0);

      assert.strictEqual(result.name, 'localhost');
      assert.strictEqual(result.fullCmd, 'psql -h localhost -p 5432 -U admin -d mydb');
    });

    it('should handle custom script execution', () => {
      const toolTemplate = './scripts/$1.sh $2 $3';
      const itemStr = 'deploy,production,force';

      const result = TemplateExpander.expand(toolTemplate, itemStr, 0);

      assert.strictEqual(result.name, 'deploy');
      assert.strictEqual(result.fullCmd, './scripts/deploy.sh production force');
    });

    it('should handle Windows executable paths', () => {
      const toolTemplate = '"C:\\My App\\app.exe" --config $1 --port $2';
      const itemStr = 'config.json,8080';

      const result = TemplateExpander.expand(toolTemplate, itemStr, 0);

      assert.strictEqual(result.name, 'config.json');
      assert.strictEqual(result.fullCmd, '"C:\\My App\\app.exe" --config config.json --port 8080');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle very long argument lists', () => {
      const template = Array.from({ length: 20 }, (_, i) => `$${i + 1}`).join(' ');
      const itemStr = Array.from({ length: 20 }, (_, i) => `arg${i}`).join(',');

      const result = TemplateExpander.expand(template, itemStr, 0);

      assert.strictEqual(result.args.length, 20);
      assert.ok(result.fullCmd.includes('arg0'));
      assert.ok(result.fullCmd.includes('arg19'));
    });

    it('should handle special characters in arguments', () => {
      const template = 'echo "$1" "$2"';
      const itemStr = 'hello world,test&argument';

      const result = TemplateExpander.expand(template, itemStr, 0);

      assert.deepStrictEqual(result.args, ['hello world', 'test&argument']);
    });

    it('should handle unicode characters', () => {
      const template = 'echo $1 $2';
      const itemStr = 'こんにちは,世界';

      const result = TemplateExpander.expand(template, itemStr, 0);

      assert.strictEqual(result.name, 'こんにちは');
      assert.deepStrictEqual(result.args, ['こんにちは', '世界']);
      assert.strictEqual(result.fullCmd, 'echo こんにちは 世界');
    });

    it('should handle numeric arguments', () => {
      const template = 'app --port $1 --timeout $2 --retries $3';
      const itemStr = '8080,5000,5';

      const result = TemplateExpander.expand(template, itemStr, 0);

      assert.strictEqual(result.fullCmd, 'app --port 8080 --timeout 5000 --retries 5');
    });

    it('should preserve whitespace in command template', () => {
      const template = 'cmd    $1    $2';
      const itemStr = 'a,b';

      const result = TemplateExpander.expand(template, itemStr, 0);

      // Template whitespace is preserved
      assert.strictEqual(result.fullCmd, 'cmd    a    b');
    });
  });

  describe('Multiple items in sequence', () => {
    it('should generate unique names using index', () => {
      const template = 'worker $1';
      const items = ['job1', 'job2', 'job3'];

      const results = items.map((item, index) =>
        TemplateExpander.expand(template, item, index)
      );

      assert.strictEqual(results[0].name, 'job1');
      assert.strictEqual(results[1].name, 'job2');
      assert.strictEqual(results[2].name, 'job3');
    });

    it('should use index as fallback for identical names', () => {
      const template = 'echo $1';
      const items = ['test', 'test', 'test'];

      const results = items.map((item, index) =>
        TemplateExpander.expand(template, item, index)
      );

      // All will have name 'test' since first arg is used
      assert.strictEqual(results[0].name, 'test');
      assert.strictEqual(results[1].name, 'test');
      assert.strictEqual(results[2].name, 'test');
    });
  });

  describe('ProcessItem type compliance', () => {
    it('should return valid ProcessItem objects', () => {
      const template = 'cmd $1';
      const itemStr = 'arg1,arg2';

      const result: ProcessItem = TemplateExpander.expand(template, itemStr, 0);

      assert.strictEqual(typeof result.name, 'string');
      assert.ok(Array.isArray(result.args));
      assert.strictEqual(typeof result.fullCmd, 'string');
      assert.ok(result.name.length > 0);
      assert.ok(result.fullCmd.length > 0);
    });

    it('should have consistent structure across different calls', () => {
      const results: ProcessItem[] = [
        TemplateExpander.expand('echo $1', 'test', 0),
        TemplateExpander.expand('cmd $1 $2', 'a,b', 1),
        TemplateExpander.parseItem('node', null, 'app.js', 2),
      ];

      for (const result of results) {
        assert.ok('name' in result);
        assert.ok('args' in result);
        assert.ok('fullCmd' in result);
        assert.ok(Array.isArray(result.args));
      }
    });
  });

  describe('Named params', () => {
    it('should replace named param in template', () => {
      const template = 'node $1.js --name $name';
      const itemStr = 'server';
      const params = { name: 'John doe' };

      const result = TemplateExpander.expand(template, itemStr, 0, params);

      assert.strictEqual(result.name, 'server');
      assert.strictEqual(result.fullCmd, 'node server.js --name John doe');
    });

    it('should replace multiple named params', () => {
      const template = 'app --host $host --port $port --env $env';
      const itemStr = 'myapp';
      const params = { host: 'localhost', port: '3000', env: 'production' };

      const result = TemplateExpander.expand(template, itemStr, 0, params);

      assert.strictEqual(result.fullCmd, 'app --host localhost --port 3000 --env production');
    });

    it('should combine positional and named params', () => {
      const template = 'node $1.js --name $name --port $port';
      const itemStr = 'server';
      const params = { name: 'Alice', port: '8080' };

      const result = TemplateExpander.expand(template, itemStr, 0, params);

      assert.strictEqual(result.fullCmd, 'node server.js --name Alice --port 8080');
    });

    it('should handle empty params object', () => {
      const template = 'node $1.js';
      const itemStr = 'server';

      const result = TemplateExpander.expand(template, itemStr, 0, {});

      assert.strictEqual(result.fullCmd, 'node server.js');
    });

    it('should leave unreplaced named params as-is', () => {
      const template = 'node $1.js --name $name --env $env';
      const itemStr = 'server';
      const params = { name: 'Bob' }; // env not provided

      const result = TemplateExpander.expand(template, itemStr, 0, params);

      assert.strictEqual(result.fullCmd, 'node server.js --name Bob --env $env');
    });

    it('should replace all occurrences of named param', () => {
      const template = 'echo $name and $name again';
      const itemStr = 'test';
      const params = { name: 'world' };

      const result = TemplateExpander.expand(template, itemStr, 0, params);

      assert.strictEqual(result.fullCmd, 'echo world and world again');
    });

    it('should work with parseItem for registered tools', () => {
      const tool = 'node-param';
      const toolTemplate = 'node $1.js --name $name';
      const itemStr = 'server';
      const params = { name: 'Charlie' };

      const result = TemplateExpander.parseItem(tool, toolTemplate, itemStr, 0, params);

      assert.strictEqual(result.name, 'server');
      assert.strictEqual(result.fullCmd, 'node server.js --name Charlie');
    });

    it('should handle named params with spaces in values', () => {
      const template = 'echo "Hello, $name!"';
      const itemStr = 'test';
      const params = { name: 'John Doe' };

      const result = TemplateExpander.expand(template, itemStr, 0, params);

      assert.strictEqual(result.fullCmd, 'echo "Hello, John Doe!"');
    });
  });
});
