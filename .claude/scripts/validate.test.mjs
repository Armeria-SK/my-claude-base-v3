// node --test .claude/scripts/validate.test.mjs
// Mutation check for validate.mjs: each mutation breaks one rule in a real harness file and the
// validator must FAIL on it; the file is restored afterwards. A validator that cannot fail proves nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
process.chdir(ROOT);
const { CLAUDE_PROJECT_DIR: _ignored, ...envWithoutProjectDir } = process.env;
const validate = () => spawnSync(process.execPath, ['.claude/scripts/validate.mjs'], { encoding: 'utf8', env: envWithoutProjectDir });

test('baseline: the harness passes validate', () => {
  const r = validate();
  assert.strictEqual(r.status, 0, r.stdout);
});

const cases = [
  ['reviewer effort xhigh->high', '.claude/agents/reviewer.md', /^effort: xhigh/m, 'effort: high'],
  ['executor pinned model id', '.claude/agents/executor.md', /^model: opus/m, 'model: claude-opus-5-5'],
  ['executor model opus->fable', '.claude/agents/executor.md', /^model: opus/m, 'model: fable'],
  ['debugger model opus->sonnet', '.claude/agents/debugger.md', /^model: opus/m, 'model: sonnet'],
  ['verifier effort medium->xhigh', '.claude/agents/verifier.md', /^effort: medium/m, 'effort: xhigh'],
  ['reviewer-deep gains Write', '.claude/agents/reviewer-deep.md', /^tools: Bash, Glob, Grep, Read/m, 'tools: Bash, Glob, Grep, Read, Write'],
  ['planner-deep effort xhigh->max', '.claude/agents/planner-deep.md', /^effort: xhigh/m, 'effort: max'],
  ['reviewer-deep effort max->xhigh', '.claude/agents/reviewer-deep.md', /^effort: max/m, 'effort: xhigh'],
  ['planner effort medium->low', '.claude/agents/planner.md', /^effort: medium/m, 'effort: low'],
  ['executor effort medium->low', '.claude/agents/executor.md', /^effort: medium/m, 'effort: low'],
  ['explorer gains effort key', '.claude/agents/explorer.md', /^model: haiku/m, 'model: haiku\neffort: low'],
  ['reviewer loses Status field', '.claude/agents/reviewer.md', /^Status: RESOLVED \| UNRESOLVED\n/m, ''],
  ['hook wiring points at a missing file', '.claude/settings.json', /block-no-verify.js/, 'block-no-verify-x.js'],
  ['stale v2 reference', '.claude/skills/check/SKILL.md', /^# Check.*$/m, '# Check — see .fable-status'],
  ['skill frontmatter closer glued to a heading', '.claude/skills/commit/SKILL.md', /^user-invocable: true\n---\n\n/m, 'user-invocable: true\n---# Commit\n\n'],
  ['Fable mode file no longer gitignored', '.gitignore', /^\.claude\/fable-mode\.json\n?/m, ''],
  ['env copy file no longer gitignored', '.gitignore', /^\.claude\/env-copy\.json\n?/m, ''],
  ['env-copy command loses disable-model-invocation', '.claude/commands/env-copy.md', /^disable-model-invocation: true\n/m, ''],
  ['fable command loses disable-model-invocation', '.claude/commands/fable.md', /^disable-model-invocation: true\n/m, 'disable-model-invocation: false\n'],
  ['bad § citation', '.claude/skills/check/SKILL.md', /CLAUDE\.md §1\.2/, 'CLAUDE.md §9.9'],
];
for (const [name, file, re, rep] of cases) {
  test(`validate catches: ${name}`, () => {
    const orig = fs.readFileSync(file, 'utf8');
    assert.ok(re.test(orig), 'mutation pattern no longer matches — update this test');
    fs.writeFileSync(file, orig.replace(re, rep));
    try {
      assert.strictEqual(validate().status, 1);
    } finally {
      fs.writeFileSync(file, orig);
    }
  });
}

for (const twin of ['planner-deep', 'reviewer-deep']) {
  test(`validate catches: ${twin} missing (first-pass role has no -deep twin)`, () => {
    const file = `.claude/agents/${twin}.md`;
    fs.renameSync(file, `${file}.off`);
    try {
      const r = validate();
      assert.strictEqual(r.status, 1);
      assert.match(r.stdout, new RegExp(`no -deep twin "${twin}"`));
    } finally {
      fs.renameSync(`${file}.off`, file);
    }
  });
}

test('validate catches: a malformed Fable mode file (in a temp root, never the checkout\'s own file)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-fable-'));
  try {
    fs.mkdirSync(path.join(root, '.claude'));
    const run = () => spawnSync(process.execPath, ['.claude/scripts/validate.mjs'], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
    assert.strictEqual(run().status, 0, 'no mode file in the temp root must pass');
    fs.writeFileSync(path.join(root, '.claude', 'fable-mode.json'), JSON.stringify({ debugger: { model: 'fable', effort: 'low' } }));
    const r = run();
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /fable-mode\.json: .*unknown agent "debugger"/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validate catches: a malformed env copy file (in a temp root, never the checkout\'s own file)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-env-copy-'));
  try {
    fs.mkdirSync(path.join(root, '.claude'));
    const run = () => spawnSync(process.execPath, ['.claude/scripts/validate.mjs'], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
    fs.writeFileSync(path.join(root, '.claude', 'env-copy.json'), '{"enabled":true}');
    assert.strictEqual(run().status, 0, 'a valid switch file must pass');
    fs.writeFileSync(path.join(root, '.claude', 'env-copy.json'), '{"enabled":1}');
    const r = run();
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /env-copy\.json: .*must be exactly/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
