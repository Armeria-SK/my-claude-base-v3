// node --test .claude/hooks/lib/check-commit-safety.test.js
// Secret detection on the staged diff, in a throwaway repo under the OS temp dir. Fake values only.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync, execFileSync } = require('node:child_process');

const HOOK = path.resolve(__dirname, '..', 'check-commit-safety.js');
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-safety-'));
after(() => fs.rmSync(repo, { recursive: true, force: true }));
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
git('init', '-q');

function commitCheck(file, text) {
  git('rm', '-q', '--cached', '-r', '--ignore-unmatch', '.');
  fs.writeFileSync(path.join(repo, file), text);
  git('add', '-f', file);
  return spawnSync(process.execPath, [HOOK], {
    cwd: repo,
    input: JSON.stringify({ tool_name: 'Bash', cwd: repo, tool_input: { command: 'git commit -m x' } }),
    encoding: 'utf8',
  });
}

test('an Anthropic key in a force-added .env blocks the commit', () => {
  const r = commitCheck('.env', 'ANTHROPIC_API_KEY=sk-ant-test-0000000000000000\n');
  assert.strictEqual(r.status, 2, r.stderr);
});

test('an Anthropic api03-style key in any file blocks the commit', () => {
  const r = commitCheck('config.txt', 'key = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA-BBBB_CCCC"\n');
  assert.strictEqual(r.status, 2, r.stderr);
});

test('a short sk-ant- mention without a key body passes', () => {
  const r = commitCheck('notes.txt', 'keys look like sk-ant-...\n');
  assert.strictEqual(r.status, 0, r.stderr);
});
