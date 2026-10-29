---
name: pr
description: >
  構造化 PR ワークフロー。「PR 作って」「プルリク出して」と頼まれた時に、
  ブランチ判定 → コミット（/commit プロトコル）→ push → gh pr create を
  テンプレート付きで実行する。push と PR 作成は確認を挟まずに行う。
user-invocable: true
---

# PR — Structured Pull Request Workflow

## Prerequisite checks

1. `gh auth status` — if not authenticated, explain the steps and stop
2. `git remote -v` — if there is no remote, stop and report

## Steps

### 1. Branch decision
- The standard flow is **one PR per work unit**, from a dated work branch to `main` (CLAUDE.md §3 Git Workflow). Default: ensure work is on a `<YYYY-MM-DD>-<topic>` branch — if you're on `main`, create it from an up-to-date `main` (`git switch -c $(date +%F)-<topic> main`) — and target that branch's `→ main` PR (create if absent; otherwise new commits stack onto it)
- `<topic>` = short English kebab-case describing the work (e.g. `model-tier-update` → branch `2026-09-29-model-tier-update`)
- Already on the right work branch → use it as-is. Never work on `main` (the `block-direct-to-main.js` hook blocks commits/pushes to it)

### 2. Commit
- If there are uncommitted changes, commit them via the `/commit` protocol (conventional + trailers)
- If unrelated changes are mixed in, propose splitting them

### 3. push + PR creation

No confirmation step: committing on a work branch is the go-ahead to push it and open (or update) its PR. The base branch is always `main`.

Run these as two separate tool calls:

```bash
git push -u origin <branch>
```

```bash
gh pr create --title "<conventional title>" --body "$(cat <<'EOF'
## Summary
- <key points of the change, 1-3 lines>

## Changes
- <list of the main changes>

## Test plan
- [ ] <verification steps / tests run and their results>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 4. Report
- Report the PR URL
- If CI exists, add a brief note on how to read the first check results

## Rules

- **Never commit or push to `main` directly** — `main` advances only when the user merges the PR (CLAUDE.md §3 Git Workflow; the `block-direct-to-main.js` hook enforces it). The standard PR is one per work unit: a `<YYYY-MM-DD>-<topic>` branch → `main`; `/pr` creates or updates it
- Do not force push (block-destructive-git.js blocks it)
- Do not leave the PR body's Test plan empty — write the verification you actually performed (CLAUDE.md §1.2)
- Stack commits addressing review feedback onto the same branch (preserve the PR context)
- Report the PR result in plain Japanese (what it is, how to merge, the URL) per CLAUDE.md §3
