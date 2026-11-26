// Denial-message hints of block-destructive-fs.js (owner ruling 2026-11-26: message text only, verdicts unchanged).
//   node --test .claude/hooks/lib/block-destructive-fs.test.js
// The denials of delete commands that would have been allowed if written differently (PowerShell recursive delete
// after a location change / with a variable target / fed by a pipe; find -delete / -exec rm; xargs rm) keep their
// old text and end with a hint holding an example. Each test feeds the hook a payload and checks that the denial
// still denies, that the old text is intact, that the hint is there, and that the example in the hint, with <topic>
// filled in, is itself allowed by the hook. Verdicts of the other branches stay pinned by hook-probes.samples.json.
// The hook only reads the command string, so the checkout itself is the workspace root here and nothing is deleted.
'use strict';

const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const HOOK = path.join(ROOT, '.claude', 'hooks', 'block-destructive-fs.js');
const PLAIN_ROOT = /^(?:[A-Za-z]:[\\/])?[\w.\-\\/]+$/.test(ROOT);
const SKIP_UNPLAIN = PLAIN_ROOT ? false : 'checkout path is not plain path text, so the hint shows a placeholder root';

function run(tool, command) {
  const payload = { tool_name: tool, cwd: ROOT, tool_input: { command } };
  try {
    execFileSync(process.execPath, [HOOK], {
      input: JSON.stringify(payload), env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT }, cwd: ROOT, stdio: 'pipe',
    });
    return { exit: 0, stderr: '' };
  } catch (e) {
    return { exit: typeof e.status === 'number' ? e.status : -1, stderr: String(e.stderr || '').trim() };
  }
}

const EXAMPLE = / e\.g\. (.+?) \(replace <topic>\)/;
const PS_TAIL =
  ' File deletion requires user confirmation (CLAUDE.md §1.5). Only disposable build dirs (node_modules, dist, ...) may be removed without asking.';
const FIND_TAIL = ' File deletion requires user confirmation (CLAUDE.md §1.5).';
const XARGS_TAIL = " Targets come from stdin and can't be safety-checked. File deletion requires user confirmation (CLAUDE.md §1.5).";

// `before` is the complete message the hook printed before the hint existed; `hint` is what must follow it.
const CASES = [
  {
    name: 'PowerShell recursive delete after a location change',
    tool: 'PowerShell',
    command: `Set-Location ${ROOT}; Remove-Item -Recurse -Force tmp/hint-probe`,
    before:
      'BLOCKED: Recursive delete detected (Remove-Item -Recurse -Force tmp/hint-probe). The command contains a location change (Set-Location/cd/Push-Location), so relative targets cannot be resolved.' +
      PS_TAIL,
    kind: 'ps',
  },
  {
    name: 'PowerShell recursive delete with a variable target',
    tool: 'PowerShell',
    command: 'Remove-Item -Recurse -Force $root\\tmp\\hint-probe',
    before: 'BLOCKED: Recursive delete detected (Remove-Item -Recurse -Force $root\\tmp\\hint-probe).' + PS_TAIL,
    kind: 'ps',
  },
  {
    name: 'PowerShell recursive delete fed by a pipe',
    tool: 'PowerShell',
    command: 'Get-ChildItem tmp/hint-probe | Remove-Item -Recurse -Force',
    before: 'BLOCKED: Recursive delete detected (Remove-Item -Recurse -Force).' + PS_TAIL,
    kind: 'ps',
  },
  {
    name: 'find -delete',
    tool: 'Bash',
    command: 'find tmp/hint-probe -delete',
    before: 'BLOCKED: "find ... -delete" is forbidden.' + FIND_TAIL,
    kind: 'rm',
  },
  {
    name: 'find -exec rm',
    tool: 'Bash',
    command: 'find tmp/hint-probe -exec rm -rf {} \\;',
    before: 'BLOCKED: "find ... -exec rm ..." is forbidden.' + FIND_TAIL,
    kind: 'rm',
  },
  {
    name: 'find -exec sh -c (shell-wrapper-mediated delete)',
    tool: 'Bash',
    command: "find tmp/hint-probe -exec sh -c 'rm -rf $1' _ {} \\;",
    before: 'BLOCKED: "find ... -exec sh ..." (shell-wrapper-mediated delete) is forbidden.' + FIND_TAIL,
    kind: 'rm',
  },
  {
    name: 'xargs rm -rf',
    tool: 'Bash',
    command: 'ls tmp | xargs rm -rf',
    before: 'BLOCKED: "xargs ... rm" with a recursive/force flag is forbidden (xargs rm -rf).' + XARGS_TAIL,
    kind: 'rm',
  },
  {
    name: 'xargs sh -c (shell-wrapper-mediated delete)',
    tool: 'Bash',
    command: "ls tmp | xargs sh -c 'rm -rf x'",
    before: "BLOCKED: \"xargs ... sh\" (shell-wrapper-mediated delete) is forbidden (xargs sh -c 'rm -rf x')." + XARGS_TAIL,
    kind: 'rm',
  },
];

const HINT_START = { ps: ' Hint: a folder under the workspace tmp/ is removed', rm: ' Hint: to delete a folder inside the workspace' };
const NEEDS_OWNER = "Deleting outside the workspace, or the user's data, still needs the owner.";

for (const c of CASES) {
  test(`${c.name}: still denied, old text intact, hint appended`, () => {
    const { exit, stderr } = run(c.tool, c.command);
    assert.strictEqual(exit, 2, stderr);
    assert.ok(stderr.startsWith(c.before + HINT_START[c.kind]), stderr);
    assert.ok(stderr.endsWith(NEEDS_OWNER), stderr);
  });

  test(`${c.name}: the example in the hint is allowed once <topic> is filled in`, { skip: SKIP_UNPLAIN }, () => {
    const { stderr } = run(c.tool, c.command);
    const m = EXAMPLE.exec(stderr);
    assert.ok(m, `no example in: ${stderr}`);
    assert.ok(m[1].includes('<topic>'), m[1]);
    assert.ok(m[1].includes('tmp'), m[1]);
    const rewrite = m[1].replace('<topic>', 'hint-probe-topic');
    const verdict = run(c.tool, rewrite);
    assert.strictEqual(verdict.exit, 0, `${rewrite} -> ${verdict.stderr}`);
  });
}

test('the PowerShell example is a plain absolute path under the workspace tmp/, the rm example uses forward slashes', { skip: SKIP_UNPLAIN }, () => {
  const ps = EXAMPLE.exec(run('PowerShell', 'Get-ChildItem tmp/x | Remove-Item -Recurse -Force').stderr)[1];
  assert.strictEqual(ps, `Remove-Item -Recurse -Force ${path.join(ROOT, 'tmp', '<topic>')}`);
  const rm = EXAMPLE.exec(run('Bash', 'find tmp/x -delete').stderr)[1];
  assert.strictEqual(rm, `rm -rf ${ROOT.replace(/\\/g, '/')}/tmp/<topic>`);
});

// Branches the hint does not belong to keep their old text: no hint on them.
const UNCHANGED = [
  ['rm with a wildcard (Japanese message)', 'Bash', 'rm -rf tmp/hint-probe*'],
  ['rm with a variable (Japanese message)', 'Bash', 'rm -rf $ROOT/tmp/hint-probe'],
  ['PowerShell delete of an absolute path outside the workspace', 'PowerShell', 'Remove-Item -Recurse -Force C:\\Users\\hint-probe'],
  ['dd overwrite of an absolute path', 'Bash', 'dd if=/dev/null of=/etc/hint-probe'],
];
for (const [name, tool, command] of UNCHANGED) {
  test(`no hint on an unrelated denial: ${name}`, () => {
    const { exit, stderr } = run(tool, command);
    assert.strictEqual(exit, 2, stderr);
    assert.ok(!stderr.includes('Hint:'), stderr);
  });
}

// --- PowerShell delete denied as `targeting "<path>" is forbidden (root/home/parent/absolute path)` ------------
// The hint is added only when the target lies inside tmp/ and differs from plain path text at most by wildcard / $
// characters (the same place written as a plain full path passes). Everywhere else the message stays as it was.
const SEP = path.sep;
const fwd = (p) => p.replace(/\\/g, '/');
const forbiddenMsg = (cmd, target) =>
  `BLOCKED: "${cmd}" targeting "${fwd(target)}" is forbidden (root/home/parent/absolute path). Confirm with user before proceeding.`;
const TMP = path.join(ROOT, 'tmp');
const T = path.join(ROOT, 'tmp', 'hint-probe');
const PRODUCT_TMP_X = path.join(ROOT, 'dev', 'hint-product', 'tmp', 'x');

// `target` is the path as the message prints it (before slash conversion); `allowedForm` is the same command
// without the part that made it a denial, which the hook allows.
const FORBIDDEN_WITH_HINT = [
  { name: 'after a location change, absolute path', command: `Set-Location ..; Remove-Item ${fwd(T)}`, target: fwd(T), allowedForm: `Remove-Item ${fwd(T)}` },
  { name: 'after a location change, recursive', command: `Set-Location ..; Remove-Item -Recurse -Force ${T}`, target: T, allowedForm: `Remove-Item -Recurse -Force ${T}` },
  { name: 'after a location change, the tmp directory itself', command: `Set-Location ..; Remove-Item -Recurse -Force ${TMP}`, target: TMP, allowedForm: `Remove-Item -Recurse -Force ${TMP}` },
  { name: 'after a location change, a product tmp/', command: `Set-Location ..; Remove-Item ${PRODUCT_TMP_X}`, target: PRODUCT_TMP_X, allowedForm: `Remove-Item ${PRODUCT_TMP_X}` },
  { name: 'after a location change, -LiteralPath:', command: `Set-Location ..; Remove-Item -Recurse -Force -LiteralPath:${T}`, target: T, allowedForm: `Remove-Item -Recurse -Force -LiteralPath:${T}` },
  { name: 'wildcard in tmp/', command: `Remove-Item -Recurse -Force ${TMP}${SEP}*`, target: `${TMP}${SEP}*` },
  { name: '$ in tmp/', command: `Remove-Item -Recurse -Force ${TMP}${SEP}$x`, target: `${TMP}${SEP}$x` },
  { name: 'glued word in tmp/', command: `Remove-Item -Recurse -Force "${T}"y${SEP}..${SEP}..${SEP}..${SEP}node_modules`, target: T },
];

for (const c of FORBIDDEN_WITH_HINT) {
  test(`forbidden target, ${c.name}: still denied, old text intact, hint appended`, { skip: SKIP_UNPLAIN }, () => {
    const { exit, stderr } = run('PowerShell', c.command);
    assert.strictEqual(exit, 2, stderr);
    assert.ok(stderr.startsWith(forbiddenMsg('remove-item', c.target) + HINT_START.ps), stderr);
    assert.ok(stderr.endsWith(NEEDS_OWNER), stderr);
  });

  test(`forbidden target, ${c.name}: the example in the hint is allowed once <topic> is filled in`, { skip: SKIP_UNPLAIN }, () => {
    const m = EXAMPLE.exec(run('PowerShell', c.command).stderr);
    assert.ok(m, 'no example in the message');
    const rewrite = m[1].replace('<topic>', 'hint-probe-topic');
    const verdict = run('PowerShell', rewrite);
    assert.strictEqual(verdict.exit, 0, `${rewrite} -> ${verdict.stderr}`);
  });

  if (c.allowedForm) {
    test(`forbidden target, ${c.name}: the same command without the location change is allowed`, { skip: SKIP_UNPLAIN }, () => {
      const verdict = run('PowerShell', c.allowedForm);
      assert.strictEqual(verdict.exit, 0, `${c.allowedForm} -> ${verdict.stderr}`);
    });
  }
}

// No allowed rewrite exists for these (outside the workspace, elsewhere in it, unresolvable, or a name with a
// character that cannot be written plainly): denied exactly as before, no hint.
const FORBIDDEN_NO_HINT = [
  ['absolute path outside the workspace', `Remove-Item C:\\Users\\hint-probe\\a.txt`, 'remove-item', 'C:\\Users\\hint-probe\\a.txt'],
  ['sibling of the workspace root', `Remove-Item -Recurse -Force ${ROOT}-other${SEP}tmp${SEP}x`, 'remove-item', `${ROOT}-other${SEP}tmp${SEP}x`],
  ['elsewhere in the workspace, file', `Remove-Item ${path.join(ROOT, 'plans', 'a.txt')}`, 'remove-item', path.join(ROOT, 'plans', 'a.txt')],
  ['elsewhere in the workspace, recursive', `Remove-Item -Recurse -Force ${path.join(ROOT, 'plans', 'x')}`, 'remove-item', path.join(ROOT, 'plans', 'x')],
  ['the workspace root itself', `Remove-Item -Recurse -Force ${ROOT}`, 'remove-item', ROOT],
  ['a path that leaves tmp/ through ..', `Remove-Item -Recurse -Force ${TMP}${SEP}..${SEP}plans`, 'remove-item', `${TMP}${SEP}..${SEP}plans`],
  ['a parent directory', `Remove-Item -Recurse -Force ..${SEP}hint-other`, 'remove-item', `..${SEP}hint-other`],
  ['~', 'Remove-Item -Recurse -Force ~/hint-probe', 'remove-item', '~/hint-probe'],
  ['$HOME', 'Remove-Item -Recurse -Force $HOME/hint-probe', 'remove-item', '$HOME/hint-probe'],
  ['a bare wildcard', 'Remove-Item -Recurse -Force *', 'remove-item', '*'],
  ['a non-ASCII name in tmp/', `Remove-Item -Recurse -Force ${TMP}${SEP}\u00e9`, 'remove-item', `${TMP}${SEP}\u00e9`],
  ['a colon in a name in tmp/', `Remove-Item -Recurse -Force ${TMP}${SEP}a:b`, 'remove-item', `${TMP}${SEP}a:b`],
  ['Clear-Content on a path in tmp/ (it has no tmp/ exemption)', `Clear-Content ${T}`, 'Clear-Content', T],
];
for (const [name, command, cmd, target] of FORBIDDEN_NO_HINT) {
  test(`forbidden target, no hint: ${name}`, { skip: SKIP_UNPLAIN }, () => {
    const { exit, stderr } = run('PowerShell', command);
    assert.strictEqual(exit, 2, stderr);
    assert.strictEqual(stderr, forbiddenMsg(cmd, target));
  });
}
