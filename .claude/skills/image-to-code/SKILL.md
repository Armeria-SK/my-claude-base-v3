---
name: image-to-code
description: >
  画像ファースト（image-first）のサイト実装スキル。まず自分でデザイン参考画像を生成し→深く解析し→
  その画像に忠実にフロントを実装する。ビジュアル重視の Web 制作で、参考画像から起こしたいときに使う。
  「画像を作ってからサイトにして」「このデザイン画像通りに実装して」「image-first で作って」で発動。
  画像の生成は `chatgpt-image-gen` スキル、実装の美学は `frontend-design`（taste）に準拠する。
  ⚠️ ユーザーが読む資料・スライドは対象外 → `doc` スキル（オフライン単一 HTML）。
user-invocable: true
---

## 運用メモ（最優先）

- **画像の生成・保存・`assets/` への移動は `imagegen-frontend-web` の運用メモに従う**（`chatgpt-image-gen` 経由）。解析は `assets/` に移した PNG を Read で開いて行う（ブラウザのスクリーンショットは縮小されているため使わない）。
- **実装の美学は `frontend-design`（taste）に準拠**: AIバレ集・レイアウト規律・プリフライトを共有する。
- **ユーザーが読む資料 / スライドには使わない** → `doc` スキルへ。React / Tailwind / CDN / Web フォント前提を資料に持ち込まない。

---

## 0. Workflow: image → analysis → code
For visually led website work: generate section references (imagegen-frontend-web via chatgpt-image-gen) → analyse each saved image as a spec (§A) → implement faithfully (§B, within frontend-design's engineering rules). Starting in code tends to reproduce the generic layouts the images exist to avoid.
- Use it when the request is mostly about visual quality: a hero, landing page, marketing site, portfolio, redesign, multi-section concept, or anything described in visual terms.
- User supplied design images → skip generation; analyse theirs with §A.
- Bug fixes, structural work, or a precise design system already given → go straight to frontend-design.
- chatgpt-image-gen can't run (no browser, not logged in, usage limit) → tell the user and offer frontend-design directly, rather than silently skipping images.

## Image budget
One image per section (count rules: imagegen-frontend-web §0). Add a detail render for a section only when analysis names a specific element you can't read (e.g. pricing figures); at most one per section, and tell the user before going past N+2 images. Each image costs time plus inspection in a browser, and ChatGPT has usage limits — clearer images beat more images.

## Generation rules live elsewhere
- What to generate and how (section count, variation engine, hero, anti-slop, rhythm, palette/style anchor, consistency): imagegen-frontend-web. For image-to-code runs, bias VISUAL_DENSITY toward 3 and keep UI chrome minimal — images that are meant to be coded should be easy to read.
- How it should feel in code (stack, icons, motion, a11y, AI tells): frontend-design.

## Getting more detail
Analyse the downloaded PNG in assets/ (Read it), not the browser screenshot, which is downscaled. Zooming or cropping a saved file to read it is fine; what to avoid is using a crop of a multi-section image as a section's reference, because proportions and type scale get lost. If a section is still unreadable, ask ChatGPT in the same conversation for "the same <section>, same design, closer framing with larger text". If a render is cluttered, use a targeted edit ("change only these points, keep everything else"). Keep palette, type, radius and image treatment identical — it's a clearer render of the same design, not a new one. Typical targets: hero type and CTA, pricing cards, testimonials, navbar/header, feature cards or UI panels, footer/CTA; or a render focused on typography and spacing rather than the full composition.

---

## A. Analysis checklist
Treat each saved image as a design specification and work through it calmly and exactly, not as a vibe read. Note what stays unclear as you go: unclear elements go to "Getting more detail", not to guesses. The aim is to understand why the design looks strong, then carry that into the build.

**Text**
- Extract visible text where readable: hero headline and subheadline, CTA labels, section headings, navbar and footer labels, pricing labels, feature names, testimonial names and roles if clearly shown.
- Generated text is often misspelled or half-rendered. Use headline, CTA and section headings verbatim when they're real words; fix obvious garbling; replace brand names or copy that hit the slop lists (frontend-design §9.D) instead of copying them.
- Text too small to read reliably → a closer render, not a guess.

**Type**
- Size relationships and weight relationships.
- Display vs body contrast, and section heading rhythm.
- CTA text scale.
- Line count and line-wrapping behaviour.
- Line-height feel and tracking feel.
- Alignment logic.
- Serif vs sans, font mood, calm vs aggressive.
- Don't flatten typography into a generic coded hierarchy.

**Spacing**
- Headline ↔ subheadline, text ↔ buttons, card ↔ card, image ↔ text.
- Section top and bottom spacing, and side gutters.
- Card padding, navbar spacing, CTA block spacing.
- Overall cadence across sections.
- This is not exact pixel OCR; the goal is faithful spacing logic.
- If the design is generous, don't collapse it into generic tight spacing.

**Components**
- Buttons: size, shape, radius, padding.
- Buttons: fill vs outline, primary vs secondary hierarchy, icon usage.
- Buttons: hover-implied mood, only if visually suggested.
- Cards and blocks: structure, dimensions, rhythm, radius.
- Dividers, strokes, borders, shadows and depth logic.
- Badge and pill usage; input styling if present.
- Media: image frames and aspect ratios, image treatment, icon treatment.

**Colour**
- Background, panels, accents, button fills.
- Text colour hierarchy, border colour logic, shadow mood.
- Image tint or grade, and gradient restraint or intensity.
- Estimate hex values from the saved PNG; if a script tool is available, sample pixels (e.g. Python + Pillow) for background, text and accent.
- If imagegen-frontend-web produced a style anchor, use its hex values as tokens and use the image to confirm where they're used.
- Keep the original palette logic; don't replace it with generic default web colours.

**Structure**
- What the section is and its visual priority.
- Grid and layout structure; section order and density.
- Visual rhythm across the page.
- Repeated motifs that define the design language.

---

## B. Implementation
Build copy-oriented: the target is visually faithful to the image, translated into real frontend, not "inspired by" it. Keep each reference's layout logic, spacing rhythm, section order, text/image balance, typography mood, component style and overall cleanliness.
- **Drift**: the images look strong but the coded result becomes generic. This is the most common failure; check each section against its image before moving on. Watch for default templates replacing distinctive sections, generous spacing compressed into a dense layout, strong typography reduced to a plain hierarchy, section logic merged into repetitive patterns the images didn't have, nested-box complexity the images had avoided creeping back, or "improving" it into a generic layout.
- **Precedence**: the image decides layout, section order, composition, spacing rhythm, type mood and palette. frontend-design decides engineering and accessibility (stack, real icon library, contrast, reduced motion, responsive behaviour, performance). If the image contains a pattern frontend-design lists as an AI tell (e.g. three equal feature cards, section-number eyebrows), prefer a targeted edit of that section's image over silently diverging in code; if you do diverge, say so in the report.
- **Unclear details**, in order: keep the visible design language; keep layout and spacing logic; keep the component family; keep mood and polish level; get a closer render of that section (see "Getting more detail"); only then choose the most implementation-friendly faithful version. Don't fill ambiguity with generic defaults too quickly.
- **First view**: after building, view the page at about 1280×720: headline, supporting line, primary CTA and focal visual visible without scrolling.
- **Fonts**: Neue Montreal / Monument are commercial (Pangram Pangram); Satoshi / Cabinet Grotesk / Clash are free on Fontshare — map picks to fonts that are actually available.
- **Motion**: implement the handed-off motion picks within frontend-design's motion and reduced-motion rules.

---

## Checks
1. Was every saved image analysed with §A, and is the text readable enough (a closer render made where it wasn't)?
2. Are typography, spacing, buttons and components, and colours extracted rather than guessed?
3. Was the analysis structured and specific, and can someone build from it faithfully?
4. Does the built page match each section image side by side?

## Steps
1. Decide the workflow branch (§0).
2. Run imagegen-frontend-web §16, which returns images, the style anchor, per-section choices and the two motion-implied picks.
3. Analyse each PNG (§A); note unreadable elements.
4. At most one detail render per section, if needed.
5. Implement (§B) with frontend-design.
6. Compare each section side by side; report divergences.

Ask a question only when the site type or brand is unclear.

## Examples
**"make me one hero section for an AI startup"** → 1 hero image; 1 closer render only if CTA text is unreadable. Analyse headline, subheadline, CTA, spacing, colours and hero media from the saved PNG, then implement the hero.

**"design me an 8-section landing page"** → 8 section images, one per section; a closer render only for a named unreadable element (budget: N+2 at most, tell the user before exceeding). Analyse all 8, then implement the full site from those references.

---

## Attribution

Adapted from **taste-skill** (https://github.com/Leonxlnx/taste-skill), MIT License, Copyright (c) 2026 Leonxlnx. Repository-specific frontmatter and integration notes added for my-claude-base.
