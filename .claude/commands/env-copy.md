# Env copy - 製品の .env を worktree にコピーしてよいかの切り替え

製品（`dev/<product>/`）の `.env`（API キーなど）を、その製品の git worktree（`tmp/worktrees/<name>`）にコピーしてよいかを入れたり切ったりする（CLAUDE.md §0「Env copy」）。中身を読む・表示することは、オンでも禁止のまま。

## Usage
```
/env-copy            # 今の状態を表示（/env-copy status と同じ）
/env-copy on         # コピーを許可する
/env-copy off        # コピーを禁止に戻す
```

## Process
1. 引数（`$ARGUMENTS`）に応じて `node "<ワークスペースのルート>/.claude/scripts/env-copy.mjs" <on|off|status>` を 1 回実行する（引数なしは `status`）。
   - **必ず絶対パスで呼ぶ**。相対パスで呼ぶと、worktree の中にいるときに worktree 側のファイルを書いてしまう。
2. 出力をそのまま平易な日本語で伝える: 今オンかオフか。
   - `on` は `.claude/env-copy.json`（git 管理外）に `{ "enabled": true }` を書く。`off` はそのファイルを消すだけ。
   - ファイルが壊れていると、スイッチはオフ扱いになり、出力に理由が出る。`/env-copy on` で書き直すか `/env-copy off` で消す。
3. スイッチは `/env-copy off` まで残る（セッションをまたいでも自動では切れない）。

## オンの間のコピーのしかた
- コピーは必ず `node "<ルート>/.claude/scripts/env-copy.mjs" copy <product> <worktree の絶対パス>` で行う（SessionStart の `=== ENV COPY ===` に絶対パス付きで出る）。`cp` / `Copy-Item` は使わない。
- スクリプトが確かめること: スイッチがオン／`<worktree>` が `tmp/worktrees/` の下にあり、`dev/<product>` と同じリポジトリの worktree である／コピー先のファイルが worktree で gitignore されている。
- コピーするのは `.env` と `.env.*`（`.env.example` は git に入っているので除く）。表示はファイル名とバイト数だけ。
- worktree に中身の違う同名ファイルがあれば止まる。置き換えるときだけ `--overwrite` を付ける。
- worktree を `git worktree remove` で消すと、コピーした `.env` も一緒に消える。
