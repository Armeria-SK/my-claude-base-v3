// node --test .claude/scripts/fable-mode.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fable-mode.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fable-mode-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
fs.mkdirSync(path.join(root, '.claude'));
const file = path.join(root, '.claude', 'fable-mode.json');
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8' });

test('status with no file is OFF', () => {
  const r = run();
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /^FABLE MODE: OFF$/m);
});

const ON = JSON.stringify({ executor: { model: 'fable', effort: 'low' } });

test('on is refused: only the owner turns it on (by typing /fable on), and nothing is written', () => {
  const r = run('on');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /only the owner turns Fable mode on, by typing \/fable on/);
  assert.ok(!fs.existsSync(file));
});

test('status reports a file the owner hook wrote; off (allowed to agents) removes it', () => {
  fs.writeFileSync(file, ON);
  assert.match(run('status').stdout, /FABLE MODE: ON .*executor=low/);
  assert.match(run('off').stdout, /^FABLE MODE: OFF$/m);
  assert.ok(!fs.existsSync(file));
  assert.strictEqual(run('off').status, 0);
});

test('a malformed file is reported as OFF with the reason; on does not rewrite it', () => {
  fs.writeFileSync(file, '{"executor":{"model":"opus","effort":"low"}}');
  assert.match(run('status').stdout, /OFF — .*model must be "fable"/);
  assert.strictEqual(run('on').status, 1);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{"executor":{"model":"opus","effort":"low"}}');
  run('off');
});

test('an unknown subcommand fails without touching the file', () => {
  const r = run('maybe');
  assert.strictEqual(r.status, 2);
  assert.ok(!fs.existsSync(file));
});
