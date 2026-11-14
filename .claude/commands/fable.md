---
description: Fable モードの切り替え（オンにできるのはオーナー本人だけ）
disable-model-invocation: true
---

# Fable - Fable モードの切り替え

大きな実装のときに、一部のエージェントを Fable で動かすモードを入れたり切ったりする（CLAUDE.md §2「Fable mode」）。メインセッション自身のモデルは変えない。**入れられるのはオーナー本人だけ**。

## Usage
```
/fable            # 今の状態を表示（/fable status と同じ）
/fable on         # Fable モードを入れる（オーナーが自分で打ったときだけ効く）
/fable off        # Fable モードを切る（通常の Opus の割り当てに戻す）
```

## Process
1. 引数（`$ARGUMENTS`）が `on` のとき: **自分では何もしない。モードのファイルを書かない・作らない。**
   - オーナーが入力欄に `/fable on` とそのまま打った場合は、`owner-mode-on.js` フック（UserPromptExpansion）がすでにファイルを書いている。`node "<ルート>/.claude/scripts/fable-mode.mjs" status` を 1 回実行して、オンになったことを伝えるだけにする。
   - status がオフのままなら、そのことをオーナーに伝えて、もう一度自分で `/fable on` と打ってもらう。**フック（`owner-mode-on.js`）を自分で動かすことは絶対にしない**（それはオーナーの代わりにモードを入れることになる）。
2. 引数が `off` / `status` / なしのとき: `node "<ワークスペースのルート>/.claude/scripts/fable-mode.mjs" <off|status>` を 1 回実行する（引数なしは `status`）。
   - **必ず絶対パスで呼ぶ**。ルートは SessionStart の `=== FABLE MODE ===` に出ている `node "…/fable-mode.mjs"` のパスをそのまま使う。相対パスで呼ぶと、worktree の中にいるときに worktree 側のファイルを書いてしまい、フックが読むワークスペース側のモードは変わらない。
3. 出力をそのまま平易な日本語で伝える: 今オンかオフか、オンなら各エージェントの effort。
   - オンにすると `.claude/fable-mode.json`（git 管理外）に既定の割り当てが書かれる: planner=low, executor=low, reviewer=low, planner-deep=medium, reviewer-deep=medium。debugger / verifier / explorer / chore は対象外。
   - `off` はそのファイルを消すだけ。エージェント定義（`.claude/agents/*.md`）は触らない。
   - ファイルが壊れている（知らないエージェント名・fable 以外のモデル・範囲外の effort）と、モードはオフ扱いになり、出力に理由が出る。オーナーが `/fable on` と打って書き直すか、`off` で消す。
4. モードは `/fable off` まで残る（セッションをまたいでも自動では切れない）。

## オンの間の呼び出し方
- 対象エージェントは `model: "fable"` と割り当ての `effort` を付けて呼ぶ。`model` を付けずに呼ぶと `enforce-model-tier.js` が止める。
- Fable で動かした回が利用上限（クレジット不足・レート制限）で止まったときに限り、`model: "opus"` をそのエージェント本来の effort（または effort なし）で付けて出し直す。

## 新しいセッションでの確認
モードがオンでもオフでも、新しいセッションで対象エージェント（planner / executor / reviewer / planner-deep / reviewer-deep）を初めて呼ぶ前に、AskUserQuestion で 1 回だけ平易な日本語で聞く。
- オンのとき: 「Fable モードのまま続けるか、切るか」→ 切るなら SessionStart が示した `node "<ルート>/.claude/scripts/fable-mode.mjs" off`
- オフのとき: 「通常の Opus のままにするか、Fable モードを入れるか」→ 入れるなら、オーナーに入力欄へ `/fable on` と打ってもらう（自分では入れられない）

対象エージェントを呼ばないセッションでは聞かなくてよい。SessionStart フックがこの指示を毎回コンテキストに入れる。
