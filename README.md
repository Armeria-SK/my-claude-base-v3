# my-claude-base v3

Claude 5 世代のモデル構成に合わせて作り直した Claude Code 用ハーネス（作業環境一式）です。v2 から「実際に効いていたもの」だけを持ち込み、モデル選びは階層で固定しました。

## モデルの割り当て

| 役割 | モデル・エフォート | エージェント |
|---|---|---|
| 計画・重大な判断 | **Opus**：まず `medium`、決着しなければ `xhigh` で確認 | `planner` → `planner-deep` |
| レビュー | **Opus**：まず `xhigh`、決着しなければ `max` で確認 | `reviewer` → `reviewer-deep` |
| 実装・デバッグ・検証 | **Opus `medium`** | `executor` / `debugger` / `verifier` |
| grep・ファイル操作などの単純作業 | **Haiku** | `explorer` / `chore` |
| 指揮者（この会話そのもの） | Opus `medium`（`.claude/settings.json`） | — |

エフォートは各エージェントの定義ファイルで固定し、呼び出しごとの上書きは `enforce-model-tier.js` が止める（例外は利用上限の出し直しと Fable モードだけ）ため、計画・レビューの役割だけ「初回版」と一段上のエフォートの「確認版（`-deep`）」の2体を用意し、引き上げを目に見える手順にしています。`-deep` に上げる条件は [CLAUDE.md §2](CLAUDE.md) と `quality-loop` スキルに書いてあります。大きな実装のときは `/fable on` で一部の役割（planner / executor / reviewer と -deep 版）を Fable に切り替えられ、`/fable off` で通常の Opus に戻ります。新しいセッションでは、対象の役割を初めて呼ぶ前に、このモードを続けるか（または入れるか）を指揮者が聞きます。Fable で動く役割が利用上限（クレジット不足・レート制限）で止まったら、指揮者が同じ役割を Opus で出し直します（[CLAUDE.md §2](CLAUDE.md)）。階層のずれは `enforce-model-tier.js`（呼び出し時）と `validate.mjs`（定義ファイル）が機械的に止めます。

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
  - 開発の流れ: `plan`（規模に応じた計画）/ `harness`（feature・bugfix などの流れを束ねる）/ `quality-loop`（レビューの繰り返しと `-deep` への引き上げ）/ `check`（完了前の検証）/ `commit` / `pr` / `code-cleaner` / `preview`
  - 画像・デザイン・資料: `chatgpt-image-gen`（Claude のブラウザで ChatGPT に画像を作らせ、点検・修正まで。保存は内蔵ブラウザでは利用者が「保存」を1回押し、押したあとファイルは `assets/` などへ自動で集める）/ `imagegen-frontend-web`（サイト用の参考画像のディレクション）/ `image-to-code`（参考画像を作ってから忠実に実装）/ `frontend-design`（AI っぽく見えない画面づくりの規則集）/ `doc`（画像も埋め込んだ 1 ファイル完結の HTML 資料）
- **commands（2種）** — `/save-session`（区切りで報告を残す）/ `/resume-session`（記録と git を突き合わせて再開）
- **hooks（9本）** — 危険操作を止めるもの（破壊的な git・ファイル削除・秘密情報の読み取り・`--no-verify`・main への直接コミット・コミット前の秘密/デバッグ混入）、モデル階層の強制、セッション開始時の再開情報の注入（ツール実行ごと・セッション開始終了ごとのログは取りません）
- **tasks/** — todo / lessons / `YYYY-MM/DD.md`（日ごとのジャーナル。`/save-session` のレポートだけが入る。再開は最新の日を読む）（git 追跡外）

## 権限の扱い
`settings.json` では権限モードを固定していません（v2 は `bypassPermissions`）。フックによる安全装置は権限モードに関係なく働きます。確認ダイアログを減らしたい場合は、ご自身で `defaultMode` を選んでください。
