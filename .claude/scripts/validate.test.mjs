// node --test .claude/scripts/validate.test.mjs
// Mutation check for validate.mjs: each mutation breaks one rule in a real harness file and the
// validator must FAIL on it; the file is restored afterwards. A validator that cannot fail proves nothing.
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
process.chdir(ROOT);
const validate = () => spawnSync(process.execPath, ['.claude/scripts/validate.mjs'], { encoding: 'utf8' });

test('baseline: the harness passes validate', () => {
  const r = validate();
  assert.strictEqual(r.status, 0, r.stdout);
});

const cases = [
  ['reviewer effort medium->high', '.claude/agents/reviewer.md', /^effort: medium/m, 'effort: high'],
  ['executor pinned model id', '.claude/agents/executor.md', /^model: sonnet/m, 'model: claude-sonnet-5-5'],
  ['reviewer-deep gains Write', '.claude/agents/reviewer-deep.md', /^tools: Bash, Glob, Grep, Read/m, 'tools: Bash, Glob, Grep, Read, Write'],
  ['planner-deep effort xhigh->high', '.claude/agents/planner-deep.md', /^effort: xhigh/m, 'effort: high'],
  ['explorer gains effort key', '.claude/agents/explorer.md', /^model: haiku/m, 'model: haiku\neffort: low'],
  ['reviewer loses Status field', '.claude/agents/reviewer.md', /^Status: RESOLVED \| UNRESOLVED\n/m, ''],
  ['hook wiring points at a missing file', '.claude/settings.json', /block-no-verify.js/, 'block-no-verify-x.js'],
  ['stale v2 reference', '.claude/skills/check/SKILL.md', /^# Check.*$/m, '# Check — see .fable-status'],
  ['skill frontmatter closer glued to a heading', '.claude/skills/commit/SKILL.md', /^user-invocable: true\n---\n\n/m, 'user-invocable: true\n---# Commit\n\n'],
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
