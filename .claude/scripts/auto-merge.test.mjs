// node --test .claude/scripts/auto-merge.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'auto-merge.mjs');
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'auto-merge-')));
after(() => fs.rmSync(root, { recursive: true, force: true }));
fs.mkdirSync(path.join(root, '.claude'));
const modeFile = path.join(root, '.claude', 'auto-merge.json');
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8' });

test('status with no file is OFF; on is refused (owner only); off removes the file', () => {
  assert.match(run().stdout, /^AUTO MERGE: OFF$/m);
  const r = run('on');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /only the owner turns auto-merge on, by typing \/auto-merge on/);
  assert.ok(!fs.existsSync(modeFile));
  fs.writeFileSync(modeFile, '{"enabled":true}\n');
  assert.match(run('status').stdout, /^AUTO MERGE: ON/m);
  assert.match(run('off').stdout, /^AUTO MERGE: OFF$/m);
  assert.ok(!fs.existsSync(modeFile));
  assert.strictEqual(run('off').status, 0);
});

for (const [name, text] of [
  ['enabled false', '{"enabled":false}'],
  ['extra key', '{"enabled":true,"x":1}'],
  ['not JSON', '{nope'],
  ['array', '[true]'],
  ['deeply nested', `{"enabled":${'['.repeat(50000)}${']'.repeat(50000)}}`],
]) {
  test(`a malformed mode file (${name}) is OFF and reported; on does not rewrite it`, () => {
    fs.writeFileSync(modeFile, text);
    try {
      const s = run('status');
      assert.strictEqual(s.status, 0, s.stderr);
      assert.match(s.stdout, /^AUTO MERGE: OFF — /m);
      assert.strictEqual(run('on').status, 1);
      assert.strictEqual(fs.readFileSync(modeFile, 'utf8'), text);
    } finally {
      fs.rmSync(modeFile, { force: true });
    }
  });
}

test('an unknown subcommand is a usage error and touches nothing', () => {
  const r = run('maybe');
  assert.strictEqual(r.status, 2);
  assert.ok(!fs.existsSync(modeFile));
});
