---
name: doc
description: >
  ユーザーが読む資料（レポート・調査/分析結果・ガイド・比較表・サマリ）を、オフラインで開ける
  1 ファイル完結の HTML として作る。chatgpt-image-gen で作った画像も HTML の中に埋め込めるので、
  画像入りの資料をそのまま配れる。「資料を作って」「ドキュメント化して」「HTMLでまとめて」
  「画像入りでまとめて」で発動。PDF・PPTX・Word が要るときは標準の pdf / pptx / docx スキルへ。
  内部作業ファイル（tasks/・plans/・コミット等）は対象外（Markdown のまま）。
user-invocable: true
---

# Doc — self-contained HTML reading documents

The deliverable is **one HTML file that opens offline and fetches nothing**: all CSS and scripts inline, images embedded as `data:` URIs. It survives being emailed, attached, or copied on its own.

## When
- **Use** for documents the user reads: reports, analyses, guides, comparisons, summaries — with or without generated images.
- **Don't use** for internal working files (`tasks/`, `plans/`, `.claude/`, commit messages, code) — those stay Markdown.
- **Other formats**: a PDF, `.pptx`, or `.docx` the user asks for by name → the standard `pdf` / `pptx` / `docx` skills. A slide deck → `pptx`.

## Steps
1. **Write** — dispatch `executor` (small documents: the conductor may write directly). Start from `.claude/skills/doc/template/doc.template.html`: keep its `<head>`, CSS and trailing `<script>`; replace only what is inside `<main id="content">` (the sample body is an example of the available parts — callouts, tables, steps, trees, inline SVG figures). Conclusion first, short sections (CLAUDE.md §6.3). Plain Japanese, no direct-translation jargon.
2. **Images** (optional) — generate with `chatgpt-image-gen` (one image per request, user approves each download). Move the file next to the HTML (e.g. `<doc-dir>/img/`), reference it with a relative `<img src="img/x.png" alt="...">`, and always write meaningful `alt` text. Diagrams made of boxes and arrows are better as inline SVG than as generated images — they stay sharp and editable.
3. **Embed and prove** — run:
   ```bash
   node .claude/scripts/inline-assets.mjs <doc.html>
   ```
   It replaces every local image with a `data:` URI and then lints the result: any remaining `http(s)://`, `//host`, relative path, or `@import` is listed and the exit code is 1. FAIL → fix and rerun. Keep the `img/` source files; the HTML no longer needs them. Large photos bloat the file (base64 is ~1.33× the image size) — if the output passes ~10 MB, resize the images first.
4. **Open** — `start "" "<path>"` on Windows (fail-open), and report the path.

## Rules
- No web fonts, CDNs, or remote images — device fonts and inline assets only. Inline `<script>` is fine.
- The `check` skill treats `inline-assets.mjs --check <file>` as this document's gate.
- Visual rules that do not depend on a stack (palette discipline, spacing, typographic hierarchy, avoiding AI-looking clichés) can be borrowed from `frontend-design`; its framework/CDN assumptions cannot.
