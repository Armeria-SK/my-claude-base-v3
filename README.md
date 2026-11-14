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

エフォートは各エージェントの定義ファイルで固定し、呼び出しごとの上書きは `enforce-model-tier.js` が止める（例外は利用上限の出し直しと Fable モードだけ）ため、計画・レビューの役割だけ「初回版」と一段上のエフォートの「確認版（`-deep`）」の2体を用意し、引き上げを目に見える手順にしています。`-deep` に上げる条件は [CLAUDE.md §2](CLAUDE.md) と `quality-loop` スキルに書いてあります。階層のずれは `enforce-model-tier.js`（呼び出し時）と `validate.mjs`（定義ファイル）が機械的に止めます。

## 持ち主のスイッチ
どちらも **オンにできるのは持ち主だけ** です。入力欄に自分で `/fable on` / `/env-copy on` と打ったときだけオンになり、エージェントはオフにしかできません（オンの状態はセッション開始時に表示されます）。守りの水準は「うっかりや善意でオンにしてしまうエージェントを止める」までで、わざと抜け道を探すものまでは止めきれません。残る抜け道は [CLAUDE.md §0](CLAUDE.md) に書いてあります。

| コマンド | オンのとき | 詳しく |
|---|---|---|
| `/fable on` / `off` / `/fable` | 大きな実装向けに、planner / executor / reviewer を Fable Low、planner-deep / reviewer-deep を Fable Medium で呼ぶ。新しいセッションでは、対象の役割を初めて呼ぶ前に、続けるか（入れるか）を指揮者が聞く。Fable が利用上限で止まったら、その役割をいつもの Opus で出し直す | [CLAUDE.md §2](CLAUDE.md) |
| `/env-copy on` / `off` / `/env-copy` | 製品（`dev/<製品>/`）の `.env` を、同じ製品の作業フォルダ（`tmp/worktrees/` の下）へ、専用のスクリプトでだけ写せる。中身は表示しない。作業フォルダを消すと写したものも消える | [CLAUDE.md §0](CLAUDE.md) |

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
- **commands（4種）** — `/save-session`（区切りで報告を残す）/ `/resume-session`（記録と git を突き合わせて再開）/ `/fable` / `/env-copy`（上の「持ち主のスイッチ」）
- **hooks（11本）** — 危険操作を止めるもの（破壊的な git・ファイル削除・秘密情報の読み取り・`--no-verify`・main への直接コミット・コミット前の秘密/デバッグ混入・作業フォルダを `tmp/worktrees/` の外に作ること）、モデル階層の強制、スイッチを持ち主しかオンにできないようにする 2 本（持ち主の入力でオンにするもの・エージェントがモードのファイルを書いたりオンの言葉を仕込んだりするのを止めるもの）、セッション開始時の再開情報とスイッチの状態の注入（ツール実行ごと・セッション開始終了ごとのログは取りません）
- **tasks/** — todo / lessons / `YYYY-MM/DD.md`（日ごとのジャーナル。`/save-session` のレポートだけが入る。再開は最新の日を読む）（git 追跡外）

## 権限の扱い
`settings.json` では権限モードを固定していません（v2 は `bypassPermissions`）。フックによる安全装置は権限モードに関係なく働きます。確認ダイアログを減らしたい場合は、ご自身で `defaultMode` を選んでください。確認なしで通す許可は、`.env` を写す専用スクリプトの `copy` だけです（スイッチがオフならスクリプトが断ります）。

会話は 40 万トークンあたりで自動で要約されます（`settings.json` の `autoCompactWindow`）。
