// Runs every row of hook-probes.samples.json against its hook and checks the verdict.
//   node --test .claude/hooks/lib/hook-probes.test.js
// Each row: feed `payload` to `hook` on stdin; exit 2 = deny, exit 0 = allow.
// <REPO> and <SANDBOX*> are throwaway directories under tmp/ (never this repo's own git state),
// so results do not depend on the branch or files of the checkout the tests run from.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, after } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const BASE = path.join(ROOT, 'tmp', 'hook-probes');
const dirs = {
  REPO: path.join(BASE, 'repo'),
  SANDBOX: path.join(BASE, 'repo', 'tmp', 'sandbox'), // under <REPO>/tmp: the scratch exemption is workspace-root-relative
  SANDBOX_GIT: path.join(BASE, 'sandbox-git'),
  SANDBOX_GIT_MAIN: path.join(BASE, 'sandbox-git-main'),
  SANDBOX_JUNCTION: path.join(BASE, 'sandbox-junction'),
};
const slash = (p) => p.split(path.sep).join('/');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });

function fresh(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function initRepo(dir, branch) {
  git(dir, 'init', '-q', '-b', branch);
  git(dir, 'config', 'user.email', 'probe@example.com');
  git(dir, 'config', 'user.name', 'probe');
}

function build() {
  // <REPO>: a work-branch repo with a .claude/ dir so projectRoot() resolves inside it.
  fresh(dirs.REPO);
  fs.mkdirSync(path.join(dirs.REPO, '.claude', 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(dirs.REPO, 'tasks'), { recursive: true });
  initRepo(dirs.REPO, 'main');
  // tracked files that the redirect-overwrite / containment rows refer to
  fs.writeFileSync(path.join(dirs.REPO, 'CLAUDE.md'), '# probe\n');
  fs.writeFileSync(path.join(dirs.REPO, 'f.txt'), 'x\n');
  fs.writeFileSync(path.join(dirs.REPO, '.claude', 'hooks', 'keep.txt'), 'x\n');
  fs.writeFileSync(path.join(dirs.REPO, '.claude', 'settings.json'), '{}\n');
  git(dirs.REPO, 'add', '-A');
  git(dirs.REPO, 'commit', '-q', '-m', 'init');
  git(dirs.REPO, 'checkout', '-q', '-b', 'topic');

  fresh(dirs.SANDBOX); // after the repo is built: fresh(REPO) would wipe it
  fs.writeFileSync(path.join(dirs.SANDBOX, 'scratch.txt'), 'scratch\n');

  // check-commit-safety inspects `git diff --cached`, so it needs a real staged console.log.
  fresh(dirs.SANDBOX_GIT);
  git(dirs.SANDBOX_GIT, 'init', '-q');
  fs.writeFileSync(path.join(dirs.SANDBOX_GIT, 'leaky.js'), 'function f() {\n  console.log("debug");\n}\n');
  git(dirs.SANDBOX_GIT, 'add', 'leaky.js');

  // fast-forward catch-up exception: on main, with origin/main as its tracked upstream.
  fresh(dirs.SANDBOX_GIT_MAIN);
  initRepo(dirs.SANDBOX_GIT_MAIN, 'main');
  fs.writeFileSync(path.join(dirs.SANDBOX_GIT_MAIN, 'f.txt'), 'x\n');
  git(dirs.SANDBOX_GIT_MAIN, 'add', 'f.txt');
  git(dirs.SANDBOX_GIT_MAIN, 'commit', '-q', '-m', 'init');
  const sha = git(dirs.SANDBOX_GIT_MAIN, 'rev-parse', 'HEAD').toString().trim();
  git(dirs.SANDBOX_GIT_MAIN, 'update-ref', 'refs/remotes/origin/main', sha);
  git(dirs.SANDBOX_GIT_MAIN, 'remote', 'add', 'origin', 'https://example.invalid/probe.git');
  git(dirs.SANDBOX_GIT_MAIN, 'branch', '--set-upstream-to=origin/main', 'main');

  // NTFS junction (Windows only): a delete through a junction must resolve to the real target.
  fresh(dirs.SANDBOX_JUNCTION);
  fs.mkdirSync(path.join(dirs.SANDBOX_JUNCTION, 'real-target'), { recursive: true });
  fs.mkdirSync(path.join(dirs.SANDBOX_JUNCTION, 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(dirs.SANDBOX_JUNCTION, 'real-target', 'precious.txt'), 'secret\n');
  if (process.platform === 'win32') {
    execFileSync('cmd', ['/c', 'mklink', '/J',
      path.join(dirs.SANDBOX_JUNCTION, 'tmp', 'jdir'), path.join(dirs.SANDBOX_JUNCTION, 'real-target')]);
  }
}

function substitute(raw) {
  // longest names first so <SANDBOX_GIT_MAIN> is not eaten by <SANDBOX_GIT> or <SANDBOX>
  return Object.keys(dirs)
    .sort((a, b) => b.length - a.length)
    .reduce((s, k) => s.split(`<${k}>`).join(slash(dirs[k])), raw);
}

function run(row) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: slash(dirs.REPO) };
  for (const [k, v] of Object.entries(row.env || {})) {
    if (v === null) delete env[k];
    else env[k] = v;
  }
  try {
    execFileSync(process.execPath, [path.join(ROOT, row.hook)], {
      input: JSON.stringify(row.payload), env, cwd: row.payload.cwd || dirs.REPO, stdio: 'pipe',
    });
    return { exit: 0, stderr: '' };
  } catch (e) {
    return { exit: typeof e.status === 'number' ? e.status : -1, stderr: String(e.stderr || '') };
  }
}

build();
// tmp/ is delete-after-use (CLAUDE.md §0): remove the fixtures once the suite is done.
after(() => {
  fs.rmSync(BASE, { recursive: true, force: true });
  try {
    fs.rmdirSync(path.dirname(BASE)); // tmp/ itself, only if nothing else is in it
  } catch {
    /* not empty or already gone: leave it */
  }
});
const rows = JSON.parse(substitute(fs.readFileSync(path.join(__dirname, 'hook-probes.samples.json'), 'utf8')));

test('canary: the harness can tell deny from allow', () => {
  const deny = run(rows.find((r) => r.name === '__canary_deny_exit'));
  const allow = run(rows.find((r) => r.name === '__canary_allow'));
  assert.strictEqual(deny.exit, 2);
  assert.strictEqual(allow.exit, 0);
});

for (const row of rows) {
  const skip = row.skipIf === 'non-win32' && process.platform !== 'win32' ? row.skipReason : false;
  test(`${row.set}/${row.name}`, { skip }, () => {
    const { exit, stderr } = run(row);
    assert.ok(exit === 0 || exit === 2, `unexpected exit ${exit}: ${stderr}`);
    assert.strictEqual(exit === 2 ? 'deny' : 'allow', row.expect, stderr);
  });
}
