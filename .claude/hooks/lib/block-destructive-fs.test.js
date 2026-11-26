// Denial-message hints of block-destructive-fs.js (owner ruling 2026-11-26: message text only, verdicts unchanged).
//   node --test .claude/hooks/lib/block-destructive-fs.test.js
// The denials of delete commands that would have been allowed if written differently (PowerShell recursive delete
// after a location change / with a variable target / fed by a pipe / a forbidden target; find -delete / -exec rm;
// xargs rm) keep their old text and end with a hint holding an example. Each test feeds the hook a payload and checks that the denial
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

function run(tool, command, cwd = ROOT) {
  const payload = { tool_name: tool, cwd, tool_input: { command } };
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

// The hint offers only what the owner asked for (tmp/ leftovers) and names what still needs the owner.
const HINT_START = {
  ps: ' Hint: a folder you created under the workspace tmp/ is removed',
  rm: ' Hint: to delete a folder you created under the workspace tmp/',
};
const NEEDS_OWNER =
  "Anything else (outside the workspace, plans/, tasks/, dev/<product>/ other than its tmp/, or the user's data) still needs the owner.";

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

test('the hint offers tmp/ only: it never says "inside the workspace" and lists plans/, tasks/, dev/ as owner-only', () => {
  for (const [tool, command] of [['Bash', "find plans -name '*.bak' -delete"], ['PowerShell', 'Get-ChildItem plans | Remove-Item -Recurse -Force']]) {
    const { exit, stderr } = run(tool, command);
    assert.strictEqual(exit, 2, stderr);
    assert.ok(!stderr.includes('inside the workspace'), stderr);
    for (const word of ['workspace tmp/', 'plans/', 'tasks/', 'dev/<product>/']) assert.ok(stderr.includes(word), `${word} missing in: ${stderr}`);
  }
});

// Branches the hint does not belong to keep their old text: no hint on them.
const UNCHANGED = [
  ['rm with a wildcard (Japanese message)', 'Bash', 'rm -rf tmp/hint-probe*'],
  ['rm with a variable (Japanese message)', 'Bash', 'rm -rf $ROOT/tmp/hint-probe'],
  ['Clear-Content on a path in tmp/ (it has no tmp/ exemption)', 'PowerShell', `Clear-Content ${path.join(ROOT, 'tmp', 'hint-probe')}`],
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
// Every such denial gets the same hint (it is a conditional sentence about tmp/, so it stays true when the target is
// somewhere else); the old text stays the exact prefix.
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

// Targets with no allowed rewrite (outside the workspace, elsewhere in it, unresolvable): same denial, old text intact,
// and the hint's last sentence says these still need the owner.
const FORBIDDEN_OTHER = [
  ['absolute path outside the workspace', `Remove-Item C:\\Users\\hint-probe\\a.txt`, 'C:\\Users\\hint-probe\\a.txt'],
  ['elsewhere in the workspace', `Remove-Item -Recurse -Force ${path.join(ROOT, 'plans', 'x')}`, path.join(ROOT, 'plans', 'x')],
  ['~', 'Remove-Item -Recurse -Force ~/hint-probe', '~/hint-probe'],
  ['a bare wildcard', 'Remove-Item -Recurse -Force *', '*'],
];
for (const [name, command, target] of FORBIDDEN_OTHER) {
  test(`forbidden target, ${name}: still denied, old text intact, hint appended`, { skip: SKIP_UNPLAIN }, () => {
    const { exit, stderr } = run('PowerShell', command);
    assert.strictEqual(exit, 2, stderr);
    assert.ok(stderr.startsWith(forbiddenMsg('remove-item', target) + HINT_START.ps), stderr);
    assert.ok(stderr.endsWith(NEEDS_OWNER), stderr);
  });
}

// The hook has no try/catch and Claude Code treats exit 1 as non-blocking, so a throw turns a denial into a pass.
// The hint code must never read payload.cwd: with a malformed cwd these denials stay denials (exit 2, not 1).
const MALFORMED_CWD = [5, [], {}];
const CWD_PROBES = [
  ['PowerShell', 'Remove-Item -Recurse -Force *'],
  ['PowerShell', 'Set-Location ..; Remove-Item -Recurse ..'],
  ['Bash', 'find x -delete'],
];
for (const cwd of MALFORMED_CWD) {
  for (const [tool, command] of CWD_PROBES) {
    test(`malformed cwd ${JSON.stringify(cwd)}: ${command} is still denied`, () => {
      const { exit, stderr } = run(tool, command, cwd);
      assert.strictEqual(exit, 2, stderr);
    });
  }
}
