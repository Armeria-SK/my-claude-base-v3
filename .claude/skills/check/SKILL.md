---
name: check
description: >
  変更を完了してユーザーに「終わりました」と報告する前に使う単一の検証入口。対象を自動判別する:
  製品コード → verifier（build/型/lint/test/挙動）、UI 変更 → さらに /preview、
  ハーネス本体（.claude/・CLAUDE.md）→ validate.mjs と hook テスト。
  1-2 行の自明な修正・純粋な docs のみスキップ可。「check して」「検証して」でも発動。
user-invocable: true
---

# Check — verify before "done"

Run every check that applies to what changed (`git status --porcelain`), then report evidence, not confidence.

| Changed | Check |
|---|---|
| Harness (`.claude/**`, `CLAUDE.md`, `README.md`) | `node .claude/scripts/validate.mjs` and `node --test .claude/hooks/lib/*.test.js` |
| Product code | dispatch `verifier` (build / types / lint / tests / behavior). It owns tool detection and the phase list |
| UI files among the above | the above, plus `/preview` (launch → screenshot → console). Verifier cannot look at a screen; the conductor owns the visual check |
| HTML reading documents made with `doc` | `node .claude/scripts/inline-assets.mjs --check <file.html>` — PASS means nothing outside the file is referenced |

## Execution notes
- Read pass/fail from the **exit code**, captured with a redirect (`node .claude/scripts/validate.mjs > tmp/validate.log 2>&1; echo "EXIT=$?"`), never through a pipe and never by scanning for failure words. Compare the findings/test count to the previous run when there is one: a check that only looks for "something bad is present" stays silent when the thing it checks has disappeared.
- node must be on PATH.
- Captured logs like `tmp/validate.log` are scratch: delete them after reading (CLAUDE.md §0). Before reporting done, delete everything you created in `tmp/`.
- A failure is fixed and rerun. Do not report "done" on FAIL, and "probably works" is not evidence (CLAUDE.md §1.2).

## Skipping
Allowed for 1–2 line obvious fixes (typos, renames), pure docs/comments with no harness impact, and questions. Say so in one line: `check skipped: <reason>`. Removing comments from code is **not** skippable — machine-read annotations (`@ts-expect-error`, `eslint-disable`, pragmas) hide among human ones.
