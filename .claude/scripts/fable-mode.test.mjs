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

test('on writes the default mapping, off removes it', () => {
  assert.match(run('on').stdout, /ON .*planner=low, executor=low, reviewer=low, planner-deep=medium, reviewer-deep=medium/);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
    planner: { model: 'fable', effort: 'low' },
    executor: { model: 'fable', effort: 'low' },
    reviewer: { model: 'fable', effort: 'low' },
    'planner-deep': { model: 'fable', effort: 'medium' },
    'reviewer-deep': { model: 'fable', effort: 'medium' },
  });
  assert.match(run('status').stdout, /FABLE MODE: ON/);
  assert.match(run('off').stdout, /^FABLE MODE: OFF$/m);
  assert.ok(!fs.existsSync(file));
  assert.strictEqual(run('off').status, 0);
});

test('a malformed file is reported as OFF with the reason; on rewrites it', () => {
  fs.writeFileSync(file, '{"executor":{"model":"opus","effort":"low"}}');
  assert.match(run('status').stdout, /OFF — .*model must be "fable"/);
  assert.match(run('on').stdout, /FABLE MODE: ON/);
  run('off');
});

test('an unknown subcommand fails without touching the file', () => {
  const r = run('maybe');
  assert.strictEqual(r.status, 2);
  assert.ok(!fs.existsSync(file));
});
