---
name: quality-loop
description: >
  作る担当（worker）と審査する担当（Fable の reviewer / planner）を別のインスタンスに分け、
  差し戻し → 修正 → 再審査を APPROVE まで繰り返す品質ゲート。審査は最初 effort low で行い、
  決着しない・自信が低い・BLOCK が出たときだけ effort medium の -deep 版で確認する。
  差し戻しは、直した本人（同じ worker）を再開して渡す。
  非自明なコード・計画の完了前に使う。「品質チェックして」「レビューループして」
  「自己改善ループで」で単体でも発動し、harness / plan からも呼ばれる。
user-invocable: true
---

# Quality Loop — low first, medium to confirm

Writer and judge are different instances in independent contexts. The judge is Fable: **low effort first, medium only when low cannot settle it.** Effort is pinned in each agent's frontmatter (the hook denies a per-dispatch `effort`, except the usage-limit fallback), so the two levels are two agents: `reviewer` / `planner` (low) and `reviewer-deep` / `planner-deep` (medium).

## Roles

| Role | Agent | Model / effort |
|---|---|---|
| Worker | code = `executor` (or `debugger`); plan = `planner` | fable low (`debugger`: opus medium) / fable low |
| Worker, escalation | `executor-deep` — only when `executor` failed twice on the same finding/test or the phase is marked `Hard: yes`; see below | fable medium |
| Judge, first pass | code = `reviewer`; plan = `planner` (Self-Review Mode) | fable low |
| Judge, confirming pass | `reviewer-deep` / `planner-deep` | fable medium |
| Evidence check | `verifier` (after APPROVE, code only) | opus medium |

## Loop (max 3 cycles)

```
worker produces
  -> judge (low) reviews             pass it: diff/artifact path + PLAN.md path. Never the worker's self-defense.
       APPROVE, Status RESOLVED, Confidence >= medium  -> verifier -> done
       REQUEST_CHANGES  -> send the FULL findings back to the same worker (resumed, see below): "fix only the cited spots, no scope expansion"
                           -> judge (low) re-reviews the fix
       Status UNRESOLVED | Confidence low | BLOCK      -> escalate (below)
```

### Escalate to the -deep judge when any of these holds
1. The low pass returned `Status: UNRESOLVED` or `Confidence: low`.
2. After one fix round the same finding is still open (low re-review still REQUEST_CHANGES on it) — the two parties are not converging.
3. The low pass returned `BLOCK` or a CRITICAL finding — confirm before acting on it.
4. The low pass and the worker disagree on whether a finding is real and the evidence does not settle it.

Dispatch the -deep judge with: the artifact path, the PLAN.md path, the low report (path or text), and the `Open:` items. It forms its own verdict first, then reconciles. Its verdict decides:
- `RESOLVED` → follow it (APPROVE → verifier; REQUEST_CHANGES → back to the worker).
- `BLOCK` confirmed → stop and take it to the user with the evidence.
- `UNRESOLVED` → it names the missing input. Take that question to the user; do **not** re-run it (CLAUDE.md §1.5).

The -deep judge runs at most once per loop cycle, and never as the first pass.

### Fix-backs resume the same worker
When a judge or the verifier returns findings to fix, resume the worker that wrote the change (`SendMessage` to its agent ID / name; it keeps its full context) and pass the findings verbatim, instead of dispatching a fresh worker. A fresh worker re-reads the plan and code (more cost, more rounds); the original author knows why it wrote what it wrote. Start a fresh worker only when the original's context is near full, it was stopped, it is being escalated to `executor-deep` (a different agent), or it is a one-shot built-in type (`Explore` / `Plan`) that cannot be resumed. If a resume fails, fall back to a fresh dispatch and say so in the report.

### Escalate the worker to `executor-deep`
Only when `executor` failed twice on the same point — the same review finding still open, or the same test still failing, after the original change and one fix-back — or when PLAN.md marks the phase `Hard: yes — <reason>` (planner's format). Never the default first pass: an unmarked phase that has not failed twice goes to `executor`. Order against the judge ladder: when the repeat finding also triggers the -deep judge (trigger 2 above), the -deep judge confirms first; if the finding stands, the next fix goes to `executor-deep`. Hand it the PLAN.md path and the failed `executor` report. If `executor-deep` fails too, replan from a different angle (CLAUDE.md §1.5).

### Usage-limit fallback
If a Fable worker or judge dies on a billing / credit / rate-limit error, restart that role on Opus per CLAUDE.md §2: a fresh dispatch, not a fix-back, and say so in the report.

## Cycle-3 carryover
If cycle 3 still ends in REQUEST_CHANGES, stop looping. Report to the user: what was fixed, what remains (finding, severity, file:line, why it did not converge), and your recommendation. The verifier still runs on the current state so the report says exactly what is proven.

## Security track
When the change touches auth, payments, secrets, user data, DB access, deletion/migration, or an API boundary, seat a `reviewer` with `target: security` in parallel with the code review (no need to be asked). Merge both reports before deciding; a security CRITICAL follows the BLOCK rule above.

## Recurring categories
If the same review category shows up a 2nd time across cycles or PRs, it is a role-definition gap, not an implementation slip: record a lesson in `tasks/lessons.md` and propose the fix to the agent/skill definition to the user. Do not just patch the instance.

## Output
```
## Quality Loop Report: <deliverable>
Cycles: N   Judge passes: low xN, deep xN (why escalated)   Fix-backs: resumed xN, fresh xN (why)
Verdict: APPROVE | carried over | BLOCKED
Fixed: ...
Open: ... (finding, severity, file:line)
Verifier: PASS | FAIL | INCOMPLETE — evidence
```
