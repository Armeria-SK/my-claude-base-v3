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

Never stack PRs (a PR whose base is another work branch): merging the lower one does not move the upper one's base to `main` (GitHub does that only when the lower branch is deleted), so the work never reaches `main`. Open one PR from the tip branch to `main` instead. `block-direct-to-main.js` denies `gh pr create` / `new` / `edit` with a base other than `main` / `master`; it does not catch every form (its header lists the gaps) and does not check what a merge delivered — when the owner reports a merge, confirm the commits are on `origin/main` (`git fetch origin`, then `git log origin/main`) before saying it landed.

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

## リスク
- <この変更で起こりうる困りごとと、その影響の範囲。なければ「なし」と理由>

## 元に戻す方法
- <マージ後に取り消す手順（例: この PR のマージコミットを `git revert -m 1 <マージコミット>` で打ち消すブランチを作り、PR を出す）。それだけでは戻らないもの（データの移行、git の外の設定、すでに外へ出たもの）があればここに書く>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

If `gh pr create` returns an error, the PR may exist anyway: run `gh pr list --head <branch>` before every retry and before telling the owner it failed.

### 4. Report
- Report the PR URL
- If CI exists, add a brief note on how to read the first check results

## Auto-merge (after the gate, only while the switch is ON, product PRs only)

Opening or updating a PR is **never** the trigger: PRs open before review. This section applies only to a PR of a `dev/<product>/` repo, and only while SessionStart shows `AUTO MERGE: ON` (CLAUDE.md §0). A PR of the workspace repo itself has nothing to run here: the owner merges it.

**Precondition — all of it, for one commit X:**
- quality-loop returned APPROVE for X **and** the verifier / `check` returned PASS for X, both finished
- X is the pushed HEAD of the product's work branch (`git -C <product checkout or its worktree> rev-parse HEAD`) and the tree is clean
- Reported, not merged: a change that skipped review (CLAUDE.md §1.3 trivial fix, §6.1 `check skipped`), a PR opened or updated during review, a head that moved after the gate

**Run, with the Bash tool, in exactly this spelling** (root = the absolute workspace path SessionStart printed):

```bash
node "<root>/.claude/scripts/auto-merge.mjs" merge <product> <PR#> <X>
```

Do not judge eligibility yourself (which repo, whose repo, which branch): the script's verdict is the test. It prints every reason as `REFUSED: ...` and merges only when there is none.

**Merged** → confirm by a second path: `git -C <root>/dev/<product> fetch origin`, then `git -C <root>/dev/<product> merge-base --is-ancestor <X> origin/<default>`. Catch up locally only if that checkout is on the default branch (`git -C <root>/dev/<product> merge --ff-only origin/<default>`). Work done in `tmp/worktrees/<name>` is now removable per CLAUDE.md §0 — removal stays a separate step under the existing rules. Report in plain Japanese, including the `checks:` line.

**Refused** → report the PR URL and every reason; the owner merges as before. Two cases differ:
- **A check failed**: that verdict is final for that head (re-running `merge` with the same sha is pointless), but do not hand the PR straight to the owner. Find the cause (`gh pr checks`, the run's log). If it is a fault in the change: fix it, push to the same branch (the PR is updated, never a second PR), take the **new head** through the whole precondition again (quality-loop APPROVE + verifier / `check` PASS for that head), then run `merge` with the new sha. At most 3 such fix cycles (CLAUDE.md §6.2 / §1.5), then one batched question to the owner. A failure that is not a code fault you can fix (CI quota, an outage, a missing secret) is reported to the owner and left to them — never worked around by editing or disabling the check.
- **"Not yet"**: re-running the **same** `merge` command is allowed only for `mergeable still UNKNOWN` (once) and `checks still running` (later, when they have finished; no polling loop).

No other route, ever: not `gh pr merge`, not `gh api`, not the app's PR tools.

## Rules

- **Never commit or push to `main` directly** — a workspace PR is always merged by the user; a `dev/<product>` PR is merged by the user, or by `auto-merge.mjs` under the Auto-merge section above while the owner's switch is on (CLAUDE.md §3 Git Workflow; the `block-direct-to-main.js` hook enforces it). The standard PR is one per work unit: a `<YYYY-MM-DD>-<topic>` branch → `main`; `/pr` creates or updates it
- Do not force push (block-destructive-git.js blocks it)
- Do not leave the PR body's Test plan empty — write the verification you actually performed (CLAUDE.md §1.2)
- Do not leave リスク / 元に戻す方法 empty: write plain Japanese the owner can act on without opening the diff; 'なし' needs its reason. The revert is a new branch + PR, never a push to `main` (CLAUDE.md §3)
- Stack commits addressing review feedback onto the same branch (preserve the PR context)
- Report the PR result in plain Japanese (what it is, how to merge, the URL) per CLAUDE.md §3
