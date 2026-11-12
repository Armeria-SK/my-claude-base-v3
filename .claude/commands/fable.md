# Fable - Fable モードの切り替え

大きな実装のときに、一部のエージェントを Fable で動かすモードを入れたり切ったりする（CLAUDE.md §2「Fable mode」）。メインセッション自身のモデルは変えない。

## Usage
```
/fable            # 今の状態を表示（/fable status と同じ）
/fable on         # Fable モードを入れる
/fable off        # Fable モードを切る（通常の Opus の割り当てに戻す）
```

## Process
1. 引数（`$ARGUMENTS`）に応じて `node .claude/scripts/fable-mode.mjs <on|off|status>` を 1 回実行する（引数なしは `status`）。
2. 出力をそのまま平易な日本語で伝える: 今オンかオフか、オンなら各エージェントの effort。
   - `on` は `.claude/fable-mode.json`（git 管理外）に既定の割り当てを書く: planner=low, executor=low, reviewer=low, planner-deep=medium, reviewer-deep=medium。debugger / verifier / explorer / chore は対象外。
   - `off` はそのファイルを消すだけ。エージェント定義（`.claude/agents/*.md`）は触らない。
   - ファイルが壊れている（知らないエージェント名・fable 以外のモデル・範囲外の effort）と、モードはオフ扱いになり、出力に理由が出る。`/fable on` で書き直すか `/fable off` で消す。
3. モードは `/fable off` まで残る（セッションをまたいでも自動では切れない）。

## オンの間の呼び出し方
- 対象エージェントは `model: "fable"` と割り当ての `effort` を付けて呼ぶ。`model` を付けずに呼ぶと `enforce-model-tier.js` が止める。
- 利用上限（クレジット不足・レート制限）で止まったら、`model: "opus"` をそのエージェント本来の effort（または effort なし）で付けて出し直す。

## 新しいセッションでの確認
モードがオンでもオフでも、新しいセッションで対象エージェント（planner / executor / reviewer / planner-deep / reviewer-deep）を初めて呼ぶ前に、AskUserQuestion で 1 回だけ平易な日本語で聞く。
- オンのとき: 「Fable モードのまま続けるか、切るか」→ 切るなら `node .claude/scripts/fable-mode.mjs off`
- オフのとき: 「通常の Opus のままにするか、Fable モードを入れるか」→ 入れるなら `node .claude/scripts/fable-mode.mjs on`

対象エージェントを呼ばないセッションでは聞かなくてよい。SessionStart フックがこの指示を毎回コンテキストに入れる。
