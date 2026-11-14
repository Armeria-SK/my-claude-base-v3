// node --test .claude/scripts/env-copy.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'env-copy.mjs');
const FAKE = 'ANTHROPIC_API_KEY=sk-ant-test-0000000000000000\n';
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'env-copy-')));
after(() => fs.rmSync(root, { recursive: true, force: true }));
fs.mkdirSync(path.join(root, '.claude'));
const modeFile = path.join(root, '.claude', 'env-copy.json');
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8' });
const git = (dir, ...a) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
};
const noSecret = (r) => assert.ok(!(r.stdout + r.stderr).includes('sk-ant-test'), 'output must never contain file contents');

function repo(name, env = true) {
  const dir = path.join(root, 'dev', name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.env\n.env.*\n!.env.example\n');
  fs.writeFileSync(path.join(dir, '.env.example'), 'ANTHROPIC_API_KEY=\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  if (env) {
    fs.writeFileSync(path.join(dir, '.env'), FAKE);
    fs.writeFileSync(path.join(dir, '.env.local'), FAKE + 'X=1\n');
  }
  return dir;
}
const prod = repo('prod');
const other = repo('other');
const wtDir = (n) => path.join(root, 'tmp', 'worktrees', n);
fs.mkdirSync(wtDir(''), { recursive: true });
git(prod, 'worktree', 'add', '-q', '-b', 'w1', wtDir('wt'));
git(other, 'worktree', 'add', '-q', '-b', 'w2', wtDir('otherwt'));
const outside = path.join(root, 'outside-wt');
git(prod, 'worktree', 'add', '-q', '-b', 'w3', outside);
const wt = wtDir('wt');
const turnOn = () => fs.writeFileSync(modeFile, '{"enabled":true}\n');
const clean = () => ['.env', '.env.local'].forEach((n) => fs.rmSync(path.join(wt, n), { force: true }));

test('status with no file is OFF; on is refused (owner only); off removes the file', () => {
  assert.match(run().stdout, /^ENV COPY: OFF$/m);
  const r = run('on');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /only the owner turns env copy on, by typing \/env-copy on/);
  assert.ok(!fs.existsSync(modeFile));
  turnOn();
  assert.match(run('status').stdout, /^ENV COPY: ON/m);
  assert.match(run('off').stdout, /^ENV COPY: OFF$/m);
  assert.ok(!fs.existsSync(modeFile));
  assert.strictEqual(run('off').status, 0);
});

test('copy is refused while the switch is off', () => {
  const r = run('copy', 'prod', wt);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /REFUSED: the env copy switch is off/);
  assert.ok(!fs.existsSync(path.join(wt, '.env')));
});

for (const [name, text] of [
  ['enabled false', '{"enabled":false}'],
  ['extra key', '{"enabled":true,"x":1}'],
  ['not JSON', '{nope'],
  ['array', '[true]'],
  ['deeply nested', `{"enabled":${'['.repeat(50000)}${']'.repeat(50000)}}`],
]) {
  test(`a malformed mode file (${name}) is OFF, reported, and copy fails closed`, () => {
    fs.writeFileSync(modeFile, text);
    try {
      const s = run('status');
      assert.strictEqual(s.status, 0, s.stderr);
      assert.match(s.stdout, /^ENV COPY: OFF — /m);
      const r = run('copy', 'prod', wt);
      assert.strictEqual(r.status, 1, r.stderr);
      assert.match(r.stderr, /REFUSED: the env copy switch is off/);
      assert.ok(!fs.existsSync(path.join(wt, '.env')));
    } finally {
      fs.rmSync(modeFile, { force: true });
    }
  });
}

test('with the switch on: copies .env and .env.* (not .env.example), printing names and sizes only', () => {
  turnOn();
  try {
    clean();
    const exampleBefore = fs.readFileSync(path.join(wt, '.env.example'), 'utf8');
    const r = run('copy', 'prod', wt);
    assert.strictEqual(r.status, 0, r.stderr);
    noSecret(r);
    assert.match(r.stdout, /^copied: \.env \(\d+ bytes\)$/m);
    assert.match(r.stdout, /^copied: \.env\.local \(\d+ bytes\)$/m);
    assert.doesNotMatch(r.stdout, /\.env\.example/);
    assert.strictEqual(fs.readFileSync(path.join(wt, '.env'), 'utf8'), FAKE);
    assert.strictEqual(fs.readFileSync(path.join(wt, '.env.example'), 'utf8'), exampleBefore);
    const again = run('copy', 'prod', wt);
    assert.strictEqual(again.status, 0);
    assert.match(again.stdout, /^unchanged: \.env /m);
  } finally {
    run('off');
  }
});

test('an existing different .env is kept unless --overwrite', () => {
  turnOn();
  try {
    clean();
    fs.writeFileSync(path.join(wt, '.env'), 'ANTHROPIC_API_KEY=sk-ant-test-1111111111111111\n');
    const r = run('copy', 'prod', wt);
    assert.strictEqual(r.status, 1);
    noSecret(r);
    assert.match(r.stderr, /\.env already exists in the worktree with different content/);
    assert.ok(!fs.existsSync(path.join(wt, '.env.local')), 'nothing is copied when any file is refused');
    const o = run('copy', 'prod', wt, '--overwrite');
    assert.strictEqual(o.status, 0, o.stderr);
    assert.match(o.stdout, /^overwritten: \.env /m);
    assert.strictEqual(fs.readFileSync(path.join(wt, '.env'), 'utf8'), FAKE);
  } finally {
    run('off');
    clean();
  }
});

test('refused targets: product folder, worktree of another repo, worktree outside tmp/worktrees, .. tricks, links', () => {
  turnOn();
  const links = [];
  try {
    const cases = [
      [[prod], /must be under tmp\/worktrees/],
      [[wtDir('otherwt')], /not a worktree of dev\/prod/],
      [[outside], /must be under tmp\/worktrees/],
      [[path.join(wt, '..', '..', '..', 'dev', 'prod')], /must be under tmp\/worktrees/],
      [[wtDir('')], /must be under tmp\/worktrees/],
      [[path.join(root, 'tmp', 'worktrees', 'missing')], /does not exist/],
    ];
    for (const [target, link] of [[prod, 'jprod'], [outside, 'joutside']]) {
      const p = wtDir(link);
      try {
        fs.symlinkSync(target, p, 'junction');
        links.push(p);
        cases.push([[p], /must be under tmp\/worktrees/]);
      } catch (e) {
        if (process.platform === "win32") throw e;
      }
    }
    for (const [[target], re] of cases) {
      const r = run('copy', 'prod', target);
      assert.strictEqual(r.status, 1, `${target}: ${r.stdout}`);
      assert.match(r.stderr, re, target);
      noSecret(r);
    }
    for (const bad of ['../prod', '..', 'prod/../other', '.']) {
      const r = run('copy', bad, wt);
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /plain folder name/);
    }
    assert.ok(!fs.existsSync(path.join(wt, '.env')));
    assert.ok(!fs.existsSync(path.join(wtDir('otherwt'), '.env')));
  } finally {
    links.forEach((p) => fs.unlinkSync(p));
    run('off');
  }
  assert.ok(fs.existsSync(path.join(prod, '.env')), 'removing the test junctions must not touch the product');
});

test('a file the worktree does not gitignore is refused', () => {
  turnOn();
  const gi = path.join(wt, '.gitignore');
  const orig = fs.readFileSync(gi, 'utf8');
  try {
    fs.writeFileSync(gi, '.env\n.env.*.tmp\n');
    const r = run('copy', 'prod', wt);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /\.env\.local is not gitignored/);
    assert.ok(!fs.existsSync(path.join(wt, '.env')));
  } finally {
    fs.writeFileSync(gi, orig);
    run('off');
  }
});

test('a hard-linked destination is refused even with --overwrite, and its other name never receives the secret', () => {
  turnOn();
  const victim = path.join(root, 'victim.txt');
  const dest = path.join(wt, '.env');
  try {
    clean();
    fs.writeFileSync(victim, 'ORIGINAL\n');
    fs.linkSync(victim, dest);
    for (const extra of [[], ['--overwrite']]) {
      const r = run('copy', 'prod', wt, ...extra);
      assert.strictEqual(r.status, 1, r.stdout);
      assert.match(r.stderr, /\.env in the worktree is a hard link \(2 names\)/);
      noSecret(r);
      assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'ORIGINAL\n');
      assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'ORIGINAL\n');
    }
  } finally {
    clean();
    fs.rmSync(victim, { force: true });
    run('off');
  }
});

test('--overwrite replaces the destination entry and leaves no temp file behind', () => {
  turnOn();
  try {
    clean();
    fs.writeFileSync(path.join(wt, '.env'), 'OLD\n');
    const r = run('copy', 'prod', wt, '--overwrite');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(fs.readFileSync(path.join(wt, '.env'), 'utf8'), FAKE);
    assert.deepStrictEqual(fs.readdirSync(wt).filter((n) => n.endsWith('.tmp')), []);
  } finally {
    clean();
    run('off');
  }
});

test('a junctioned tmp/worktrees (pointing outside the workspace) is refused', { skip: process.platform !== 'win32' && 'junctions are Windows-only' }, () => {
  const root2 = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'env-copy-j-')));
  try {
    fs.mkdirSync(path.join(root2, '.claude'));
    fs.writeFileSync(path.join(root2, '.claude', 'env-copy.json'), '{"enabled":true}');
    const p2 = path.join(root2, 'dev', 'p2');
    fs.mkdirSync(p2, { recursive: true });
    git(p2, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(p2, '.gitignore'), '.env\n.env.*\n');
    git(p2, 'add', '.');
    git(p2, 'commit', '-q', '-m', 'init');
    fs.writeFileSync(path.join(p2, '.env'), FAKE);
    const ext = path.join(root2, 'ext');
    fs.mkdirSync(ext);
    git(p2, 'worktree', 'add', '-q', '-b', 'w', path.join(ext, 'w'));
    fs.mkdirSync(path.join(root2, 'tmp'));
    fs.symlinkSync(ext, path.join(root2, 'tmp', 'worktrees'), 'junction');
    const r = spawnSync(process.execPath, [SCRIPT, 'copy', 'p2', path.join(root2, 'tmp', 'worktrees', 'w')], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: root2 },
      encoding: 'utf8',
    });
    assert.strictEqual(r.status, 1, r.stdout);
    assert.match(r.stderr, /tmp\/ or tmp\/worktrees\/ is a link/);
    assert.ok(!fs.existsSync(path.join(ext, 'w', '.env')));
    fs.unlinkSync(path.join(root2, 'tmp', 'worktrees'));
  } finally {
    fs.rmSync(root2, { recursive: true, force: true });
  }
});

test('usage errors exit 2 without touching anything', () => {
  for (const a of [['maybe'], ['copy', 'prod'], ['copy', 'prod', wt, '--force']]) assert.strictEqual(run(...a).status, 2);
  assert.ok(!fs.existsSync(modeFile));
});
