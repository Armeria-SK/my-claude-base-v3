---
description: レビューと確認が通った製品の PR を、持ち主を待たずにマージしてよいかの切り替え（オンにできるのはオーナー本人だけ）
disable-model-invocation: true
---

# Auto merge - 製品の PR を自動でマージしてよいかの切り替え

製品（`dev/<product>/`）の PR は、レビューと確認が通ったものだけ自動でマージします。この作業場そのものの PR は、これまでどおり持ち主がマージします（CLAUDE.md §0「Auto-merge」）。

## Usage
```
/auto-merge            # 今の状態を表示（/auto-merge status と同じ）
/auto-merge on         # 製品の PR の自動マージを許可する
/auto-merge off        # 持ち主がすべてマージする形に戻す
```

## Process
1. 引数（`$ARGUMENTS`）が `on` のとき: **自分では何もしない。スイッチのファイルを書かない・作らない。**
   - オーナーが入力欄に `/auto-merge on` とそのまま打った場合は、`owner-mode-on.js` フック（UserPromptExpansion）がすでに `.claude/auto-merge.json`（git 管理外）に `{ "enabled": true }` を書いている。`node "<ルート>/.claude/scripts/auto-merge.mjs" status` を 1 回実行して、オンになったことを伝えるだけにする。
   - status がオフのままなら、そのことをオーナーに伝えて、もう一度自分で `/auto-merge on` と打ってもらう。**フック（`owner-mode-on.js`）を自分で動かすことは絶対にしない**（それはオーナーの代わりにスイッチを入れることになる）。
2. 引数が `off` / `status` / なしのとき: `node "<ワークスペースのルート>/.claude/scripts/auto-merge.mjs" <off|status>` を 1 回実行する（引数なしは `status`）。
   - **必ず絶対パスで呼ぶ**。相対パスで呼ぶと、worktree の中にいるときに worktree 側のファイルを触ってしまう。
3. 出力をそのまま平易な日本語で伝える: 今オンかオフか。`off` はファイルを消すだけ。
   - ファイルが壊れていると、スイッチはオフ扱いになり、出力に理由が出る。オーナーが `/auto-merge on` と打って書き直すか、`off` で消す。
4. スイッチは `/auto-merge off` まで残る（セッションをまたいでも自動では切れない）。
5. エージェントはこのファイルにも `.claude/env-copy.json`・`.claude/fable-mode.json` にも直接触れない（`block-mode-file-write.js` が、名前を含むコマンドと Write / Edit を止める）。ただし文字列で照合しているだけなので、実行時に名前を組み立てるような書き方までは止められない。

## オンの間のマージのしかた
- 対象は製品（`dev/<product>/`）の PR だけ。この作業場そのものの PR は、オンでも持ち主がマージする。
- マージしてよいのは、PR の先頭のコミットそのものについて、レビューの合格（quality-loop の APPROVE）と確認の合格（verifier / `check` の PASS）が両方そろったときだけ。レビューを省いた小さな変更は、持ち主に任せる。
- マージの手順は `pr` スキルの「Auto-merge」の節に従う。`gh pr merge` を直接使うことはしない。
