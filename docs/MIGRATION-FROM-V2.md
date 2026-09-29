# v2 → v3 移行メモ

v2 は追跡ファイルだけで約 2 MB（`validate.mjs` だけで 183 KB）まで育っていました。v3 は「効いていたものだけ」を持ち込み、約 0.3 MB（およそ 1/7）です。判断の根拠は、**v2 の実物を読んだこと**、**手元の利用履歴（`history.jsonl`）の使用回数**、**Claude Code 公式ドキュメント**です。

## 使用実績（履歴の集計）

`/resume-session` 23回 · `/save-session` 16回 · `/quality-loop` 10回 · `/commit` 3回 · `/relay` 2回 · `/doc` 2回。フック名は v2 のセッション記録に大量に出ており、安全装置はよく発火していました。

## 持ち込んだもの

| v2 の資産 | v3 での扱い | 理由 |
|---|---|---|
| 安全フック 6本（破壊的 git / 破壊的 fs / 秘密読み取り / `--no-verify` / main 直コミット / コミット前チェック）＋ `lib/parse-cmd` など共有ライブラリ | **そのまま**（Fable 関連の古いコメントだけ除去） | 引用符・heredoc・PowerShell を解釈する解析器は作り直すと退行しやすく、v2 で何度も穴を塞いだ実績がある |
| フックの検査サンプル 145件（`hook-probes.samples.json`） | 127件を持ち込み、実行係を約120行に書き直し | 「拒否されるべきものが拒否される」ことを実行で示す唯一の資産。全件 PASS を確認 |
| `session-journal`（開始/終了/保存の目印）・`session-start` と `/save-session` `/resume-session` | **持ち込み**（`session-start` は約80行に簡素化。最新レポートを日付を問わず探す方式に修正） | 利用回数が最多。dev/ 切替・codemap・roadmap の分岐は外した。v2 は「今日の日付」のジャーナルしか注入せず、翌日に前日のレポートが自動では入らなかった |
| `journal.js`（ツール実行ごとに1行ログ） | **外した**（v3 作成後に判断） | 編集・コマンドは git と会話記録で追える。実行のたびに node が起動（約70ミリ秒）。レポートが無い日はログ行がそのまま注入されノイズになった |
| `quality-loop` の「書く側と審査する側を分ける」考え方 | **書き直し**（35 KB → 4 KB）。medium→xhigh 昇格を中心に再設計 | 利用実績あり。共同審査席・レンズ集・赤チーム席などの重い儀式は外した |
| `plan` / `harness` / `check` / `commit` / `pr` / `code-cleaner` / `preview` | 持ち込み（plan・harness・check は縮小、他は軽い修正のみ） | 汎用で依存が少ない |
| CLAUDE.md の原則（証拠主義・書く側と審査側の分離・3回失敗で止まる・批判を鵜呑みにしない・最小コード・依頼を疑う・委任先の報告は仮説・依頼文の設計） | 持ち込み、約 1/2 に圧縮 | 運用の中核。「ハーネス自身を検査する」規則類は validate に移した |
| ステータスライン（コンテキスト・5時間・週間の使用率） | 持ち込み（Fable 表示のみ除去） | 単独で動く |
| 秘密ファイルの Read 拒否設定 | 持ち込み | そのまま有効 |

## 後から持ち込んだもの（画像生成との組み合わせ用）

| 資産 | 扱い |
|---|---|
| `chatgpt-image-gen`（利用者提供） | そのまま導入。画像生成の実行役 |
| `imagegen-frontend-web` / `image-to-code` / `frontend-design` | 画像生成の呼び先を Codex の `$imagegen` から `chatgpt-image-gen` に差し替え。重複と古い記述は Opus のレビューを経て整理 |
| `doc` | 軽量版。HTML テンプレートだけ持ち込み、画像を HTML に埋め込んで自己完結を検査する `inline-assets.mjs` を新設 |

## 新しく作ったもの

- **エージェント 9体**：`planner` / `reviewer`（Opus medium）、`planner-deep` / `reviewer-deep`（Opus xhigh）、`executor` / `debugger` / `verifier`（Sonnet xhigh）、`explorer` / `chore`（Haiku）。
- **`enforce-model-tier.js`**：v2 の `block-review-floor`（10 KB）・`block-fable-when-off`（9 KB）・`relay-required-agent`（9 KB）・`cmd-write-guard`（9 KB）を約 70 行に置き換え。呼び出しごとの `model` 指定で階層をすり抜けることと、Fable への振り分けを止めます（15件のテスト付き）。
- **`validate.mjs`**（約 150 行）：モデル別名・エフォート固定・medium/deep の対・読み取り専用の道具リスト・フック配線・「消したはずの v2 機能への参照」・CLAUDE.md の § 引用を検査。9通りの意図的な破壊でちゃんと FAIL することをテストで固定。

## 外したもの（必要なら v2 から取り戻せます）

| 外したもの | 理由 |
|---|---|
| Fable の ON/OFF スイッチ一式（`block-fable-when-off` / `cmd-write-guard` / `.fable-status`） | Fable を使わない構成のため不要。`enforce-model-tier` が Fable への振り分けを拒否 |
| `clover/`（外部モデル中継）と `relay` スキル・`relay-required-agent` | 今回の構成は Claude 3 階層のみ。使用も `/relay` 2回のみ。中継中は claude.ai 連携機能が止まる副作用もあった |
| Codex 側一式（`AGENTS.md` / `.codex/` / `.agents/`） | Claude 用ハーネスの更新が目的。Codex を使い続けるなら v2 のまま残すのが安全 |
| `deliberation-gate.js` | v2 自身の計測で精度 46%、発火は委任全体の 4% 弱。ルール（CLAUDE.md §1.9）だけ残した |
| `block-pr-without-todo.js`（29 KB） | todo.md の更新時刻しか見ない形式的な関門で、v2 の記録上いちばん頻繁に止めていた |
| `document-author` / `html2pdf` / `html2pptx` / `deckpack` / スライド用テンプレート | PDF・PPTX・Word は標準の pdf / pptx / docx スキルで足りる。自前の変換器（WeasyPrint・puppeteer 依存）を保守する理由が薄い |
| `imagegen-frontend-mobile` / `brandkit` | 今回の組み合わせ（ChatGPT 画像生成 → Web 実装・資料）の外。必要になった時に個別に戻す |
| `debugger` の「3 仮説 → 反証モード」以外の細部、`executor` の変異検査の長大な規定 | 要点（再現先行・反証・RED→GREEN・3回で停止）だけ残して圧縮 |
| `dev/{name}` の入れ子リポジトリ切替、`codemap.md`、`roadmap.md` | v3 は 1 ワークスペース＝1 プロジェクトの前提に簡素化 |
| 権限モード `bypassPermissions` | セキュリティ設定なので勝手に持ち込まない。必要ならご自身で `defaultMode` を設定 |

## v2 の記述で誤りだったこと（公式ドキュメントで確認）

- v2 の CLAUDE.md §2 は「エフォートは呼び出しごとに上書きできる」と書いていましたが、**Agent ツールにエフォート指定はありません**（サブエージェントのエフォートは定義ファイルの `effort:` かセッションの値だけ）。そのため v3 は Opus の役割を medium 版 / xhigh 版の 2 体に分けています。
- v2 の「実モデル ID を固定してはいけない」方針は妥当でした。v3 も別名（`opus` / `sonnet` / `haiku`）のみを使い、`validate.mjs` が固定 ID を FAIL にします。
- 実測（Claude Code 2.1.278・このマシン）：別名は `opus`→`claude-opus-5`、`sonnet`→`claude-sonnet-5`、`haiku`→`claude-haiku-4-5` に解決されました。Opus 5.5 / Sonnet 5.5 に固定したい場合は、Claude Code を更新するか環境変数 `ANTHROPIC_DEFAULT_OPUS_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL` を設定してください。
