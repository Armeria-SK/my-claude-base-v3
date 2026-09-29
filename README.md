# my-claude-base v3

Claude 5 世代のモデル構成に合わせて作り直した Claude Code 用ハーネス（作業環境一式）です。v2 から「実際に効いていたもの」だけを持ち込み、モデル選びは階層で固定しました。

## モデルの割り当て

| 役割 | モデル・エフォート | エージェント |
|---|---|---|
| 計画・レビュー・重大な判断 | **Opus**：まず `medium`、決着しなければ `xhigh` で確認 | `planner` / `reviewer` → `planner-deep` / `reviewer-deep` |
| 実装・デバッグ・検証 | **Sonnet `xhigh`** | `executor` / `debugger` / `verifier` |
| grep・ファイル操作などの単純作業 | **Haiku** | `explorer` / `chore` |
| 指揮者（この会話そのもの） | Opus `medium`（`.claude/settings.json`） | — |

エフォートは呼び出しごとには変えられない仕様のため、Opus の役割だけ「medium 版」と「xhigh 版（`-deep`）」の2体を用意しています。`xhigh` に上げる条件は [CLAUDE.md §2](CLAUDE.md) と `quality-loop` スキルに書いてあります。階層のずれは `enforce-model-tier.js`（呼び出し時）と `validate.mjs`（定義ファイル）が機械的に止めます。

## はじめかた
```bash
claude        # このフォルダで起動。エージェント定義は起動時に読み込まれる
```
- 構成の検査: `node .claude/scripts/validate.mjs`（`VERDICT: PASS` が正常）
- 全テスト: `node --test ".claude/hooks/lib/*.test.js" ".claude/scripts/*.test.mjs"`
- v2 から何を持ち込み、何を外したか: [docs/MIGRATION-FROM-V2.md](docs/MIGRATION-FROM-V2.md)

## 中身

- **agents（9体）** — 上の表のとおり
- **skills（13種）**
  - 開発の流れ: `plan`（規模に応じた計画）/ `harness`（feature・bugfix などの流れを束ねる）/ `quality-loop`（レビューの繰り返しと medium→xhigh 昇格）/ `check`（完了前の検証）/ `commit` / `pr` / `code-cleaner` / `preview`
  - 画像・デザイン・資料: `chatgpt-image-gen`（Claude のブラウザで ChatGPT に画像を作らせ、点検・修正まで。保存は内蔵ブラウザでは利用者が「保存」を1回押し、押したあとファイルは `assets/` などへ自動で集める）/ `imagegen-frontend-web`（サイト用の参考画像のディレクション）/ `image-to-code`（参考画像を作ってから忠実に実装）/ `frontend-design`（AI っぽく見えない画面づくりの規則集）/ `doc`（画像も埋め込んだ 1 ファイル完結の HTML 資料）
- **commands（2種）** — `/save-session`（区切りで報告を残す）/ `/resume-session`（記録と git を突き合わせて再開）
- **hooks（9本）** — 危険操作を止めるもの（破壊的な git・ファイル削除・秘密情報の読み取り・`--no-verify`・main への直接コミット・コミット前の秘密/デバッグ混入）、モデル階層の強制、セッション開始時の再開情報の注入と、開始/終了/保存の目印の記録（ツール実行ごとのログは取りません）
- **tasks/** — todo / lessons / `YYYY-MM/DD.md`（日ごとのジャーナル。再開は最新の日を読む）（git 追跡外）

## 権限の扱い
`settings.json` では権限モードを固定していません（v2 は `bypassPermissions`）。フックによる安全装置は権限モードに関係なく働きます。確認ダイアログを減らしたい場合は、ご自身で `defaultMode` を選んでください。
