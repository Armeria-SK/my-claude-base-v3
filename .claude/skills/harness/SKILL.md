---
name: harness
description: >
  複数の専門エージェントを束めてタスクを端から端まで遂行するワークフローのルーター。
  feature（新機能）/ bugfix（バグ修正）/ refactor / security（セキュリティ審査）/ research（事前調査）
  から目的に合うものを選び、planner・executor・reviewer・verifier 等を委任・調整する。
  担当者には計画書のパスだけを渡し、内容は本人に読ませる。「機能を作って」「バグを直して」
  「リファクタして」「セキュリティ審査して」「調べて」で発動。
user-invocable: true
---

# Harness — multi-agent workflows

`/harness [feature|bugfix|refactor|security|research] [task]`. The conductor only delegates, coordinates, integrates and decides (CLAUDE.md §2). Each step's model and effort come from the agent it names — do not restate them here.

Judge steps use the **medium → deep ladder** from `quality-loop`: run `reviewer` / `planner` first; run the `-deep` twin only on the escalation triggers listed there.

## feature (default)
1. `planner` → PLAN.md (or `/plan`'s heavy path). Product-shaped requests: get the user's ruling on gap proposals/objections in one batched question *before* any executor starts.
2. `planner` Self-Review Mode when the plan is non-trivial.
3. `executor` per task (independent tasks in parallel, each in its own worktree — below).
4. quality-loop: `reviewer` target `code` (+ `security` on sensitive changes) → fix → re-review.
5. `verifier` → evidence. Then `check`.

## bugfix
Autonomous and convergent; the user is asked at most once.
1. **Reproduce first.** `debugger` gets a failing reproduction (test / command / log) on its own before the user is involved.
2. **Root cause.** Clear cause → `debugger` fixes. Unclear → fan out up to 3 `debugger` dispatches, one hypothesis each, each running its single most discriminating probe; keep the survivor. Nothing survives, or the same approach has failed 3 times → hand the collected evidence to `reviewer-deep` for an independent diagnosis (read-only), then a fresh `debugger` fix.
3. **Fix → verify** loop, max 3 cycles, internal: `verifier` PASS/FAIL; on FAIL the findings go back to the debugger, not the user.
4. **Regression test** by `executor`, pinned to the confirmed root cause.
5. `reviewer` (code) on the fix + test before closing.
6. Still failing after cycle 3 → ask the user once, in one batched question (bug / reproduction / tried / ruled out / blocker / decision needed).

## refactor
`reviewer` (architecture) sets direction → `executor` → `verifier` proves behavior unchanged → `reviewer` (code).

## security
`reviewer` (security) and `reviewer` (code) in parallel → `verifier` confirms the findings. Anything CRITICAL/BLOCK is confirmed by `reviewer-deep` before it is reported as fact.

## research
`explorer` (parallel, codebase) + WebSearch/WebFetch (external) → `reviewer` (architecture) analyses and proposes direction.

## Handoff — every dispatch states
Outcome and why it matters (not a step script) · what must come back and in what shape · input **paths** (PLAN.md path, never a paraphrase) · constraints · findings so far · open items. Give reasoning models the goal, reason and constraints, and let them plan; a numbered recipe measurably lowers quality.

## Conductor discipline
- Before restating a subordinate's success word ("done", "verified", "both seats agree") in your own text, a record or another dispatch, check the primary source (the file, the command output, each seat's own text). A point one seat did not mention is not agreement.
- A worker's error report plus proposed fix is a hypothesis, not a diagnosis. Accept it only with root-cause evidence; otherwise send it back for root-cause analysis, re-dispatch `debugger`, or escalate to replan. A symptom-level fix (delete / suppress / loosen / catch-and-ignore) needs named rejected alternatives.
- While a ruling is outstanding with the user, start no new work unit.

## Parallel implementation
One git worktree per parallel task at `tmp/worktrees/<slug>-<task>`, created and removed by the conductor (never the worker); the path goes in the dispatch prompt. Two workers never share a tree. Workers measure their baseline inside their own tree. If a worktree cannot be provisioned, run that task serially in the main tree.
