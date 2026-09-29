---
name: plan
description: >
  実装の前にタスクの規模をまず判定し、深さを自動調整する計画スキル。小さく明確な作業は軽量パス
  （曖昧度の採点 + 質問 → 要件まとめ）、大きい・複雑・高リスクな作業は重量パス
  （調査 → GO/NO-GO → planner が PLAN.md を作成 → 実装）に分岐する。要件が曖昧なとき、
  または実装前に計画を立てるべきときに使う。「計画して」「プランして」「要件を整理して」「/plan」で発動。
user-invocable: true
---

# Plan — adaptive planning

`/plan [task or feature]`. First decide how deep to go; declare the choice before proceeding ("Heavy path — 3 files touched + auth change").

## Step 0 — complexity gate
| Signal | Light | Heavy |
|---|---|---|
| Files affected | 1–2 | 3+ or cross-module |
| Nature | local fix, small feature | new feature, architecture decision |
| Risk | low | auth, payments, data migration, external-facing, deletion |
| Requirements | settled | cannot be decided without research |

Any heavy signal → heavy. All light → light. Split → ask the user one plain-language question: "A: just pin down the requirements / B: research, plan, then build."
Skip planning entirely when concrete anchors already exist (file paths, function names, issue numbers) and the change is small.

## Light path — requirements only (no implementation)
Score clarity 0–100% on Goal (40) · Constraints (20) · Success criteria (25) · Context (15). Ask **one question per round**, about the lowest-scoring dimension, with concrete options (max 5 rounds). From round 3 challenge the request: *is it needed? what is the bare-minimum MVP? what happens in edge case X?* If a stated premise is factually wrong, object at once with evidence and a concrete alternative — the user rules, record the ruling. Stop at ≤20% ambiguity or after 5 rounds.

Output (inline, or `plans/{slug}/requirements.md` if continuing to the heavy path):
```
## Requirements Summary
Goal · Scope (IN/OUT) · Success Criteria (checkable) · Constraints · Assumptions (unconfirmed) · Objections & Rulings · Next Step
```

## Heavy path — research → plan → build
1. **Research** — dispatch `explorer` (codebase facts, parallel) and use WebSearch/WebFetch for external facts. For product-shaped work, also look at comparable products (table stakes, common complaints) and volunteer gap proposals. Write `plans/{slug}/research.md`: requirements, assumptions, code impact, risks, proposals awaiting a ruling, evidence-backed objections.
2. **GO / NO-GO** — go if requirements are clear and risks are containable; otherwise NO-GO with the specific blocking question. Present it to the user (one batched, plain-language question) when a proposal or objection needs a ruling. **Proposals never enter scope without a ruling.**
3. **Plan** — dispatch `planner` (medium) to write `plans/{slug}/PLAN.md` (format in the agent). If it returns `UNRESOLVED` / low confidence, dispatch `planner-deep`. For non-trivial plans, run Self-Review Mode through the same medium → deep ladder (quality-loop).
4. **Build** — hand `executor` the PLAN.md **path** (never a paraphrase of it), one phase at a time; each phase runs the quality-loop and `check`. Out-of-scope ideas found on the way go to `plans/{slug}/deviations.md` and are proposed at `/save-session` — never implemented on the spot.
5. **Close** — record results in PLAN.md, update `tasks/todo.md`, and clean up temporary files.

Approach is presented, then implementation proceeds; the only stops are CLAUDE.md §1.5's boundaries (5+ files, security-related, deletion, 3 failures).
