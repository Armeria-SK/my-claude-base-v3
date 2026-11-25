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

test('status / off with anything extra is a usage error and touches nothing', () => {
  fs.writeFileSync(modeFile, '{"enabled":true}\n');
  try {
    for (const args of [['off', 'extra'], ['off', '--force'], ['status', 'x'], ['status', 'off'], ['off', '']]) {
      const r = run(...args);
      assert.strictEqual(r.status, 2, args.join(' '));
      assert.match(r.stderr, /takes no further arguments/);
      assert.strictEqual(r.stdout, '');
      assert.ok(fs.existsSync(modeFile), 'the switch file must still be there');
    }
  } finally {
    fs.rmSync(modeFile, { force: true });
  }
});

test('status / off print the root they acted on, and say so when it is not the script\'s own workspace', () => {
  const own = path.resolve(path.dirname(SCRIPT), '..', '..').split(path.sep).join('/');
  const shown = root.split(path.sep).join('/');
  fs.writeFileSync(modeFile, '{"enabled":true}\n');
  const s = run('status');
  assert.ok(s.stdout.includes(`\nroot: ${shown}\n`), s.stdout);
  assert.ok(s.stdout.includes(`NOTE: that root is the folder CLAUDE_PROJECT_DIR names, not this script's own workspace (${own}). The switch of ${own} was not read;`), s.stdout);
  const o = run('off');
  assert.ok(o.stdout.includes(`\nroot: ${shown}\n`), o.stdout);
  assert.ok(o.stdout.includes(`The switch of ${own} was not touched; check / merge only ever use that one.`), o.stdout);
  for (const env of [{ CLAUDE_PROJECT_DIR: own }, { CLAUDE_PROJECT_DIR: path.join(own, '.claude', '..') }, {}]) {
    const full = { ...process.env, ...env };
    if (!('CLAUDE_PROJECT_DIR' in env)) delete full.CLAUDE_PROJECT_DIR;
    const r = spawnSync(process.execPath, [SCRIPT, 'status'], { env: full, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /^root: /m);
    assert.doesNotMatch(r.stdout, /NOTE:/, 'no note when the root is the script\'s own workspace');
  }
});

// ---- check / merge: refusals that end before GitHub is asked.
// check / merge take the root from the script's own location, so each fixture workspace gets its own copy
// of the script and the lib (same relative layout). No fixture passes the local identity checks, except
// the one "gh cannot be run" case, which runs only where gh can be taken off PATH.
const LIB = path.join(path.dirname(SCRIPT), '..', 'hooks', 'lib', 'auto-merge-mode.js');
const SHA = '0123456789abcdef0123456789abcdef01234567';
const win = process.platform === 'win32';
const git = (dir, ...a) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
};
function installScript(ws) {
  fs.mkdirSync(path.join(ws, '.claude', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(ws, '.claude', 'hooks', 'lib'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(ws, '.claude', 'scripts', 'auto-merge.mjs'));
  fs.copyFileSync(LIB, path.join(ws, '.claude', 'hooks', 'lib', 'auto-merge-mode.js'));
}
function workspace(name, origin) {
  const ws = path.join(root, name);
  installScript(ws);
  git(ws, 'init', '-q', '-b', 'main');
  if (origin) git(ws, 'remote', 'add', 'origin', origin);
  return ws;
}
function product(ws, name, origin) {
  const dir = path.join(ws, 'dev', name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  if (origin) git(dir, 'remote', 'add', 'origin', origin);
  return dir;
}
const hasExe = (dir, name) => ['', '.exe', '.cmd', '.bat'].some((x) => fs.existsSync(path.join(dir, name + x)));
const PATH_KEY = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'PATH';
const pathWithoutGh = (process.env[PATH_KEY] || '').split(path.delimiter).filter((d) => d && !hasExe(d, 'gh'));
const ghHidden = pathWithoutGh.some((d) => hasExe(d, 'git'));
const fixtureEnv = (extra = {}) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDE_PROJECT_DIR' && !/^GIT_/i.test(k)));
  if (ghHidden) env[PATH_KEY] = pathWithoutGh.join(path.delimiter);
  return { ...env, ...extra };
};
const at = (ws, args, env) =>
  spawnSync(process.execPath, [path.join(ws, '.claude', 'scripts', 'auto-merge.mjs'), ...args], { env: fixtureEnv(env), encoding: 'utf8' });
const switchOf = (ws) => path.join(ws, '.claude', 'auto-merge.json');
const turnOn = (ws) => fs.writeFileSync(switchOf(ws), '{"enabled":true}\n');

const ws = workspace('ws', 'https://github.com/acme/ws.git');
turnOn(ws);
product(ws, 'prod', 'https://example.invalid/acme/prod.git');
product(ws, 'noorigin');
product(ws, 'other', 'https://github.com/other/x.git');
product(ws, 'good', 'https://github.com/acme/prod.git');
fs.mkdirSync(path.join(ws, 'dev', 'plain'));
const base = product(ws, 'base', 'https://github.com/acme/base.git');
git(base, 'commit', '-q', '--allow-empty', '-m', 'init');
git(base, 'worktree', 'add', '-q', '-b', 'w1', path.join(ws, 'dev', 'wt'));

// Refused (exit 1) with this reason among the REFUSED lines, nothing merged, and GitHub never asked.
function refused(r, re) {
  const out = r.stdout + r.stderr;
  assert.strictEqual(r.status, 1, out);
  assert.match(out, re);
  assert.match(out, /^VERDICT: not merged \(\d+ reasons?\)$/m);
  assert.doesNotMatch(out, /MERGED:|every check holds/);
  assert.doesNotMatch(out, /gh (repo|pr) /, 'gh must not have been reached');
  assert.match(out, /^REFUSED: not inspected: .*\(an earlier check ended the inspection\)$/m);
}
function usageError(r) {
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /^usage: auto-merge\.mjs /m);
  assert.strictEqual(r.stdout, '', 'nothing is inspected or printed on a usage error');
}

test('check / merge: the switch off is a reason, listed together with the other reasons', () => {
  fs.rmSync(switchOf(ws));
  try {
    for (const args of [['check', 'other', '5'], ['merge', 'other', '5', SHA]]) {
      const r = at(ws, args);
      refused(r, /^REFUSED: the auto-merge switch is off; the owner turns it on with \/auto-merge on$/m);
      assert.match(r.stdout, /^REFUSED: owner mismatch: /m);
    }
  } finally {
    turnOn(ws);
  }
});

test('check / merge: a malformed switch file is off, with the reason', () => {
  fs.writeFileSync(switchOf(ws), '{"enabled":1}');
  try {
    refused(at(ws, ['merge', 'other', '5', SHA]), /^REFUSED: the auto-merge switch is off \(.*must be exactly \{ "enabled": true \} \(got enabled is number\)\); /m);
  } finally {
    turnOn(ws);
  }
});

test('check / merge: with the switch on, the switch is not among the reasons', () => {
  assert.doesNotMatch(at(ws, ['check', 'other', '5']).stdout, /switch is off/);
});

for (const bad of ['../x', '..', '.', 'dev/prod', path.join(root, 'ws', 'dev', 'prod'), '', '-x', '--help', 'a b', 'prod/']) {
  test(`check / merge: product ${JSON.stringify(bad)} is a usage error`, () => {
    usageError(at(ws, ['check', bad, '5']));
    usageError(at(ws, ['merge', bad, '5', SHA]));
  });
}

for (const bad of ['abc', '0', '05', '1234567', '-1', '5a', '', 'https://github.com/acme/prod/pull/5', '#5']) {
  test(`check / merge: PR ${JSON.stringify(bad)} is a usage error`, () => {
    usageError(at(ws, ['check', 'good', bad]));
    usageError(at(ws, ['merge', 'good', bad, SHA]));
  });
}

for (const bad of ['abc123', SHA.slice(0, 39), SHA + '0', SHA.toUpperCase(), '', 'HEAD', '--admin']) {
  test(`check / merge: head sha ${JSON.stringify(bad)} is a usage error`, () => {
    usageError(at(ws, ['check', 'good', '5', bad]));
    usageError(at(ws, ['merge', 'good', '5', bad]));
  });
}

test('check / merge: a missing sha for merge, an extra positional and any flag are usage errors', () => {
  for (const args of [
    ['merge', 'good', '5'],
    ['merge', 'good'],
    ['merge'],
    ['check', 'good'],
    ['check'],
    ['merge', 'good', '5', SHA, 'extra'],
    ['check', 'good', '5', SHA, 'extra'],
    ['merge', 'good', '5', SHA, '--admin'],
    ['merge', '--admin', 'good', '5', SHA],
    ['merge', 'good', '5', '--auto'],
    ['check', 'good', '5', '--repo', 'acme/ws'],
    ['merge', 'good', '--delete-branch', '5', SHA],
  ]) {
    usageError(at(ws, args));
  }
});

test('check / merge: dev/<p> missing, a plain folder, and a worktree (.git is a file) are refused', () => {
  refused(at(ws, ['merge', 'nothere', '5', SHA]), /^REFUSED: dev\/nothere does not exist$/m);
  refused(at(ws, ['merge', 'plain', '5', SHA]), /^REFUSED: dev\/plain is not a git repository of its own \(no \.git folder/m);
  assert.ok(fs.statSync(path.join(ws, 'dev', 'wt', '.git')).isFile(), 'fixture: the worktree has a .git file');
  refused(at(ws, ['merge', 'wt', '5', SHA]), /^REFUSED: dev\/wt is not a git repository of its own \(no \.git folder/m);
});

test('check / merge: dev/<p> that is a junction to a repo elsewhere is refused', { skip: !win && 'junctions are a win32 fixture' }, () => {
  const elsewhere = path.join(root, 'elsewhere');
  fs.mkdirSync(elsewhere);
  git(elsewhere, 'init', '-q', '-b', 'main');
  git(elsewhere, 'remote', 'add', 'origin', 'https://github.com/acme/elsewhere.git');
  const r = spawnSync('cmd', ['/c', 'mklink', '/J', path.join(ws, 'dev', 'linked'), elsewhere], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  refused(at(ws, ['merge', 'linked', '5', SHA]), /^REFUSED: dev\/linked is a link or an alias of another name, not a real folder$/m);
});

test('check / merge: Windows name variants of a product folder', { skip: !win && 'win32 file-name rules' }, () => {
  // observed on this machine: realpath does not resolve "good." at all, so it reads as missing; either way it is not "good"
  refused(at(ws, ['merge', 'good.', '5', SHA]), /^REFUSED: dev\/good\. (does not exist|is a link or an alias of another name, not a real folder)$/m);
  refused(at(ws, ['merge', 'NUL', '5', SHA]), /^REFUSED: dev\/NUL (does not exist|is a link or an alias of another name, not a real folder)$/m);
  // another letter case is the same folder: it gets past the folder checks and is refused on its origin
  refused(at(ws, ['merge', 'PROD', '5', SHA]), /^REFUSED: dev\/PROD's origin is missing or is not a github\.com repository$/m);
});

test('check / merge: a product origin that is missing or not on github.com is refused', () => {
  refused(at(ws, ['merge', 'noorigin', '5', SHA]), /^REFUSED: dev\/noorigin's origin is missing or is not a github\.com repository$/m);
  refused(at(ws, ['merge', 'prod', '5', SHA]), /^REFUSED: dev\/prod's origin is missing or is not a github\.com repository$/m);
});

test('check / merge: a product whose origin belongs to another owner is refused', () => {
  refused(at(ws, ['merge', 'other', '5', SHA]), /^REFUSED: owner mismatch: the product's origin belongs to "other", the workspace to "acme"/m);
});

for (const [name, origin] of [
  ['self-same', 'https://github.com/acme/ws.git'],
  ['self-case', 'https://github.com/ACME/WS'],
  ['self-nogit', 'https://github.com/acme/ws'],
  ['self-ssh', 'git@github.com:acme/ws.git'],
]) {
  test(`check / merge: a product whose origin is the workspace's own repository (${origin}) is refused`, () => {
    product(ws, name, origin);
    refused(at(ws, ['merge', name, '5', SHA]), /^REFUSED: the product's origin is the workspace repository itself — workspace PRs are never auto-merged$/m);
  });
}

test('check / merge: a workspace origin that is missing or unparseable is refused', () => {
  for (const [name, origin] of [['ws-noorigin', null], ['ws-badorigin', 'https://example.invalid/acme/ws.git']]) {
    const w = workspace(name, origin);
    turnOn(w);
    product(w, 'good', 'https://github.com/acme/prod.git');
    refused(at(w, ['merge', 'good', '5', SHA]), /^REFUSED: the workspace's origin is missing or is not a github\.com repository$/m);
  }
});

test('check / merge: CLAUDE_PROJECT_DIR pointing elsewhere is refused, and never moves the root', () => {
  const elsewhere = workspace('ws-elsewhere', 'https://github.com/acme/ws.git');
  turnOn(elsewhere);
  product(elsewhere, 'other', 'https://github.com/acme/would-pass.git');
  const r = at(ws, ['merge', 'other', '5', SHA], { CLAUDE_PROJECT_DIR: elsewhere });
  refused(r, /^REFUSED: CLAUDE_PROJECT_DIR points at another folder; /m);
  assert.match(r.stdout, /^REFUSED: owner mismatch: /m, "the product is still read from the script's own workspace");
  assert.doesNotMatch(at(ws, ['merge', 'other', '5', SHA], { CLAUDE_PROJECT_DIR: ws }).stdout, /CLAUDE_PROJECT_DIR/);
});

test('check / merge: a copy of the script whose root has a .git file (a worktree) is refused', () => {
  const copy = path.join(root, 'ws-as-worktree');
  git(base, 'worktree', 'add', '-q', '-b', 'w2', copy);
  installScript(copy);
  turnOn(copy);
  assert.ok(fs.statSync(path.join(copy, '.git')).isFile(), 'fixture: the root has a .git file');
  refused(at(copy, ['merge', 'good', '5', SHA]), /^REFUSED: this copy of the script is not in the workspace's main checkout .*run the workspace root's copy by absolute path$/m);
});

test('check / merge: when gh cannot be run, that is a reason and nothing is merged', { skip: !ghHidden && 'gh cannot be taken off PATH here' }, () => {
  for (const args of [['check', 'good', '5'], ['merge', 'good', '5', SHA]]) {
    const r = at(ws, args);
    const out = r.stdout + r.stderr;
    assert.strictEqual(r.status, 1, out);
    assert.match(out, /^REFUSED: gh repo view failed \(ENOENT\)$/m);
    assert.match(out, /^REFUSED: not inspected: the GitHub repository and the PR /m);
    assert.match(out, /^VERDICT: not merged \(2 reasons\)$/m);
    assert.doesNotMatch(out, /MERGED:/);
  }
});
