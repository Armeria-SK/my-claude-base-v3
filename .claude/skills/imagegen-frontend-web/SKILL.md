---
name: imagegen-frontend-web
description: >
  Web / LP 向けの「デザイン参考画像」を生成するアートディレクション・スキル（画像のみ・コードは書かない）。
  セクションごとに 1 枚ずつ横長画像を生成し、構図・背景・CTA・ヒーロー階層に変化を付け、ページ全体で
  一貫したパレットを保つ。開発者やコーディングモデルが正確に再現できる高品位コンプを狙う。
  「参考デザインを画像で」「LP のビジュアル案を画像で出して」「サイトのモックを画像で」で発動。
  画像の実際の生成は `chatgpt-image-gen` スキルに渡す。実装が要るなら frontend-design / image-to-code へ。
user-invocable: true
---

## 運用メモ — 画像の実行は chatgpt-image-gen（最優先）

このスキルは「どんな画像を・どう作るか」の指示（アートディレクション）を担当する。実際の画像生成は下記に従う:

- **画像生成は `chatgpt-image-gen` スキルで行う**（Claude のブラウザで ChatGPT に生成させ、点検 → 修正 → 保存まで進める）。
- **1 回 = 1 枚**。複数セクションはそれぞれ別の依頼として順に生成する。このスキルが組んだ英語プロンプトを、`chatgpt-image-gen` の依頼文（主題・構図・画風・入れないもの）にそのまま反映する。
- **保存**: 保存先として `./assets/<記述的な英語のケバブケース名>.png`（製品ディレクトリで作業中ならその `assets/`。例 `./assets/hero-fintech-teal.png`。同名があれば `-2`・`-3` を付けた空き名にする。決め方は chatgpt-image-gen §5）を `chatgpt-image-gen` に渡す。利用者が「保存」を1回押した直後に、`chatgpt-image-gen` が `collect-download.mjs` でダウンロードフォルダからそのファイルを見つけて保存先へ移す（`chore` は使わない）。`MOVED` の行が出たら `ls` で存在を確認する。
- 保存前の許可確認の質問はしない（画像を作る依頼そのものが許可）。「名前を付けて保存」画面が出たら、そのたびに利用者に「保存」を1回押してもらう（chatgpt-image-gen §5 に準拠）。
- 生成に失敗・上限到達したときは `chatgpt-image-gen` の報告に従い、利用者に伝えて止まる（別の手段で押し通さない）。
- このスキルは画像のみ。コード実装は `frontend-design`（直接実装）か `image-to-code`（画像ファースト）へ渡す。

---

# Role
You art-direct website design reference images that a developer or coding model can build from. Image models drift toward the same defaults — centered dark hero, purple-blue glow, blobs, card spam, weak type hierarchy, cloned sections, overcrowding. The rules below steer away from those while keeping every comp readable and buildable. Default to section comps; make mood art only when asked.

---

## 0. Output: one section per image, via chatgpt-image-gen
Generate one landscape image per section, each as its own chatgpt-image-gen request. One section per frame keeps text, spacing and buttons large enough to read and build from; a tall whole-page image shrinks everything below usefulness.
- Count: use the user's number. If none: hero → 1; landing page / product page / portfolio → 6 (§12); full website / marketing site → 8. Before starting, state the count and rough cost ("6 images, one per section, about 1–2 min each plus a check; I'll ask once to save them all").
- Aspect: wide landscape, 16:9, desktop web page section (a hero may use up to ~21:9 if the composition needs it). ChatGPT Images (2.5 as of 2026-09) supports wide landscape including 16:9; the pass condition is landscape orientation, so a ratio that is slightly off is not worth a fix round.
- Order: hero first. Generate the whole set in the same ChatGPT conversation and repeat the style anchor (§10) verbatim in every prompt. For sections after the first, override chatgpt-image-gen: skip its §1 navigate to https://chatgpt.com/ (that opens a new chat), stay on the current conversation tab and confirm by screenshot that the previous section is visible; when inspecting (its §4) and downloading (its §5), use the newest image in the conversation. Images 2.5 keeps context across turns of one conversation, which is what makes the set read as one site.
- Progress labels ("Section 2 of 6: Trust bar") go in your message to the user, never in the prompt, or ChatGPT may render them into the image.
- On a usage limit or refusal, stop and report which sections are done and which remain. Don't merge the remaining sections into one image to "finish".

Pass conditions to hand chatgpt-image-gen (its 合格条件):
- Fatal: shows only this section, flat and full-width (no browser frame or laptop mockup); landscape; headline and CTA text exactly as quoted; palette matches the style anchor; none of the "do not include" items.
- Minor, report but don't loop: garbled body copy, subheadline or small labels (placeholders); small UI inconsistencies.
- Up to 3 fix points per round (chatgpt-image-gen rule): fix hierarchy and composition before decoration.
- Fix by targeted edits in the same conversation ("change only X, keep everything else") rather than regenerating from scratch; Images 2.5 is built for localized edits and keeps earlier edits intact.
- In-image text: quote exactly only the headline, subheadline (≤12 words) and CTA labels; describe everything else as "short placeholder copy". Image models garble small text, and requiring exact strings everywhere causes fix loops. For Japanese copy, keep in-image Japanese to the headline and CTA.
- Layout pinning: for a section whose layout matters, the user or conductor may give ChatGPT a rough wireframe (an uploaded image, or @Sketch) to pin the composition.

Prompt template for each section:
```
Generate one image.
- Subject: the <section> section of a <site type> website for <brand>, desktop, shown flat and full-width (no browser frame, no device mockup, no other sections).
- Layout: <composition anchor in plain words>; <background mode in plain words>.
- Style anchor (identical in every image): background <hex>, text <hex>, accent <hex> only on the primary button; <type, e.g. "large light-weight grotesk headline, tight tracking; small regular sans body">; corners <sharp | 8px | pill buttons>; imagery <grade/treatment>.
- Exact text: headline "…"; subheadline "…"; CTA "…". Other text: short placeholder copy.
- Aspect: wide landscape, 16:9.
- Do not include: purple-to-blue glow, floating blobs, section numbers, captions describing the image, browser chrome.
Image only, no explanation.
```

---

## 1. Baseline configuration
Global defaults; adapt them from the brief (the user's brief always overrides them: adjust dials, hero scale, background mode, gradient use and composition variety to match).
- DESIGN_VARIANCE 8 (1 rigid / symmetrical, 10 artsy / asymmetric)
- VISUAL_DENSITY 4 (1 airy / gallery-like, 10 packed / intense)
- ART_DIRECTION 8 (1 safe commercial, 10 bold creative statement)
- IMPLEMENTATION_CLARITY 9 (1 loose moodboard, 10 very codeable UI reference)
- IMAGE_USAGE_PRIORITY 9 (1 mostly typographic, 10 strongly image-led)
- SPACING_GENEROSITY 8 (1 compact / tight, 10 very spacious / breathable)
- LAYOUT_VARIATION 8 (1 same anchor repeats, 10 bold composition variety across sections)
- CONVERSION_DISCIPLINE 8 (1 pure art moodboard, 10 clear funnel + premium design balance)

Interpretation:
- "clean" → reduce density, raise clarity. "crazy creative" → raise variance and art direction. "premium SaaS" → keep clarity high, art direction controlled. "editorial" → stronger type and more asymmetry.
- Lean toward a stronger visual concept when the brief allows it.
- Keep sections breathable, with slightly more whitespace between sections than default.
- Stay conversion-aware: every section has a job (hook / proof / educate / convert).

### Brief-to-direction mapping
Read the brief, then bias the picks:
- **minimalist / clean / typography-only / swiss / ultra simple**: Mini Minimalist hero; solid surfaces, subtle texture, optionally one color-blocked diptych; gradients skipped or the softest tonal one; stacked center with generous negative space; suspend the §15 full-bleed push.
- **editorial / magazine / art-directed / fashion**: Mid Editorial or Giant Statement hero; editorial side-image, duotone or atmospheric photo grade; subtle tonal grades only; off-grid offset and asymmetric pulls; strong type contrast.
- **cinematic / atmospheric / premium / luxury / bold**: Giant Statement hero; full-bleed image with tonal overlay, soft radial vignette + product, micro-noise gradient; palette-matched cinematic gradients welcome; bottom-left over image, centered low, image-as-canvas.
- **SaaS / product / dashboard / fintech / infra**: Mid Editorial hero; solid + inline asset, flat block + detail crop, occasional editorial side-image; very subtle palette-matched gradients; clear product framing, trust-driven anchors; slightly higher implementation clarity.
- **agency / creative studio / portfolio**: Giant Statement or Mini Minimalist (decisive); bold background variety (full-bleed image, color-blocked diptych, duotone); editorial color washes acceptable; off-grid, poster-like.
- **e-commerce / shop / store / product page**: Mid Editorial with strong product focus; full-bleed product photo, soft radial vignette + crop, flat block + detail; subtle gradients that never compete with the product; product-led, unmistakable CTAs.
- **brief silent on style**: defaults from §1 + §2 with confident background variety; pick one Hero Scale decisively rather than splitting the difference.

Don't force backgrounds, gradients or full-bleed treatments where the brief asks for restraint, and don't strip them out where it asks for atmosphere.

---

## 2. The combinatorial variation engine
Choose one option per category from the prompt and commit to it across the set. A coherent combination executed clearly beats every option mashed together.

### Theme Paradigm (choose 1)
1. Pristine Light Mode: off-white / cream / paper tones, sharp dark text, editorial confidence.
2. Deep Dark Mode: charcoal / graphite / zinc, elegant glow only when justified.
3. Bold Studio Solid: strong controlled color fields (oxblood, royal blue, forest, vermilion, emerald) with crisp contrasting UI.
4. Quiet Premium Neutral: bone, sand, taupe, stone, smoke; muted contrast, restrained luxury.

### Background Character (choose 1)
1. Subtle technical grid / dotted field
2. Pure solid field with soft ambient gradient depth
3. Full-bleed cinematic imagery with proper contrast control
4. Quiet textured paper / material / tactile surface

### Typography Character (choose 1; avoid default web-typography energy)
1. Satoshi-like clean grotesk
2. Neue-Montreal-like refined grotesk
3. Cabinet / Clash-like expressive display
4. Monument-like compressed statement typography
5. Elegant editorial serif + sans pairing
6. Swiss rational sans with very strong hierarchy

### Hero Architecture (choose 1)
1. Cinematic Centered Minimalist
2. Asymmetric Split Hero
3. Floating Polaroid Scatter
4. Inline Typography Behemoth
5. Editorial Offset Composition
6. Massive Image-First Hero with restrained text

### Section System (choose 1 dominant structure)
1. Strict modular bento rhythm
2. Alternating editorial blocks
3. Poster-like stacked storytelling
4. Gallery-led visual cadence
5. Swiss grid discipline
6. Asymmetric premium marketing flow

### Signature Component Set (choose 4 unique components; enough to give the set a signature without becoming a catalogue)
- Diagonal Staggered Square Masonry
- 3D Cascading Card Deck
- Hover-Accordion Slice Layout
- Pristine Gapless Bento Grid
- Infinite Brand Marquee Strip
- Turning Polaroid Arc
- Vertical Rhythm Lines
- Off-Grid Editorial Layout
- Product UI Panel Stack
- Split Testimonial Quote Wall
- Oversized Metrics Strip (only with real, specific figures)
- Layered Image Crop Frames

### Motion-Implied Language (choose 2)
scrubbing text reveal · pinned narrative section · staggered float-up · parallax image drift · smooth accordion expansion · cinematic fade-through

### Composition Anchor (per section)
Each section picks 1 anchor; at least 3 different anchors appear across the site, and the hero shouldn't open on the AI default. The classic left-third caption + right-two-thirds visual is allowed, but not as a reflex and never twice in a row.
- Centered statement
- Top-left lead, support bottom-right
- Bottom-left text over background image
- Bottom-right CTA cluster
- Left-third caption + right-two-thirds visual (classic)
- Right-third caption + left-two-thirds visual (inverted classic)
- Centered low (text in lower 40% over hero image)
- Off-grid editorial offset (asymmetric pull)
- Stacked center (label / headline / sub / CTA all centered, ultra minimalist)
- Image-as-canvas with text overlaid in a clean safe area

### Background Mode (per section)
Pick 1 per section and vary it across the page. Backgrounds are a primary tool, so be confident with them.
- Solid surface with inline asset
- Subtle texture / paper / grid
- Full-bleed image with tonal overlay (text stays highly readable)
- Editorial side-image (50/50, 60/40, 40/60, invertible)
- Image as the entire visual + text in a clean safe area
- Flat color block + small product / detail crop as accent
- Cinematic tonal gradient (palette-matched, low chroma)
- Atmospheric photo with strong single-tone color grade
- Duotone treated image (two-color, palette-locked)
- Soft radial vignette + product crop (luxury / editorial)
- Micro-noise gradient over solid (tactile depth, not flashy)
- Color-blocked diptych (two flat fields meeting, modernist)

### CTA Variation (per section)
Pick the style that fits each section rather than a default pill every time: classic primary pill · outline / ghost · underlined inline link with arrow · banner-style full-width CTA · oversized headline + tiny CTA hint · CTA as caption under a strong visual. Vary the style at least once across the site; the page's primary action stays unmistakable.

### Hero Scale (per page, match the brand mood)
- Giant Statement: massive type, large image, dominant first viewport
- Mid Editorial: balanced type/image, cinematic but not screen-filling
- Mini Minimalist: tiny logo + short statement + thin CTA, almost no image, lots of negative space (confident restraint, not weakness)

### Narrative / Concept Spine (choose 1; thread it through visuals and short copy)
- Artifact / collectible: proof, specimen, treasured object framing
- Journey / pilgrimage: directional flow, waypoint sections, roadmap feeling
- Tool / precision instrument: machined detail, calibrated UI, tactile controls
- Living system / garden: organic growth metaphor, branching layout, nurtured tone
- Stage / spotlight: theatrical contrast, performer + audience framing
- Archive / dossier: indexed rows, captions, understated authority

### Second-Read Moment (choose 1, placed once across the page)
An unobvious but legible motif that aids scan order or brand recall, not a gimmick: an asymmetric bleed that still respects hierarchy · one oversized punctuation or numeral serving structure · a single unexpected material switch (paper vs gloss vs metal accent) · a narrow vertical side-rail editorial note · a macro crop that carries brand color naturally.

These picks are direction for you, not coding instructions. In the prompt, describe each pick in plain visual words (e.g. Turning Polaroid Arc → "five photos slightly rotated in a gentle arc"); ChatGPT doesn't know these names. Motion-implied picks are not sent to the generator; record them in the handoff for implementation.

---

## 3. Frontend reference rule
Every image should communicate layout, section hierarchy, spacing, type scale, visual rhythm, CTA priority, component styling, image treatment and the design system underneath, so a developer or coding model can see how to build it. Avoid vague abstract artwork when the request is for frontend.

---

## 4. Hero
The hero is a cinematic, clean, intentional opening scene with one focal point.
- **Composition**: left-text / right-image is the most overused AI hero pattern. Use it only when it is clearly the strongest fit; otherwise pick from centered statement over full-bleed image (text in lower 40%), bottom-left or bottom-right over image, top-left lead, stacked center, image-as-canvas, right-text / left-image, off-grid editorial offset, or Mini Minimalist. Before drafting, ask whether you are producing text-left / image-right out of habit.
- **Headline**: 1–2 lines, 3 at most (about 5–10 words); if it runs longer, cut words rather than add lines. It should read as a premium statement, not long, weak or over-wrapped.
- **First view**: the hero should read cleanly on a small laptop (about 1280×720 visible): headline, one supporting line, primary CTA, one focal visual. Keep supporting text concise, prioritise negative space and contrast, and skip pills, fake stats, badges, tiny logos and nonsense detail.
- **Type**: prefer medium / normal / light weights, tight tracking, controlled line count, strong scale contrast. Avoid extra-bold shouting everywhere, gradient text as a lazy premium effect, 6-line startup headings, and text that looks generated.
- **Graphic restraint**: instead of giant meaningless outline numbers, cheap SVG-looking filler, generic blobs or orb clutter, use typography, image crops, real layout tension, premium materials and strong framing.

---

## 5. Creativity and section size
Don't settle for the first obvious layout: push at least one of composition, type scale or image treatment past the template default, without adding clutter.
Mix section ambition across the site: some sections large, content-rich and art-directed; some mini and mostly negative space; some medium editorial blocks. That rhythm makes a premium scrollscape rather than uniform slabs.

---

## 6. Image-first art direction
Images are a core part of the design language, not decoration. Use them, including as full-bleed backgrounds when the brief allows it, to create hierarchy, break up text-heavy layouts, build mood and brand character, support transitions, and make the design easier to interpret and build.
- Prefer art-directed photography, product and editorial imagery, image crops, framed panels, layered compositions, image-led heroes and image-supported storytelling blocks.
- The design shouldn't become text-only or card-only unless the user wants that. In a multi-section page several sections should meaningfully include imagery, and a hero should usually contain a strong visual, product visual or art-directed media element. Imagery should feel premium and intentional, not like stock filler.
- Avoid tiny useless thumbnails, decorative images with no structural role, one image followed by a text-heavy rest of page, and fake UI panels standing in for real visual variety.

---

## 7. Anti-AI-slop
Avoid these by default: they are the signatures that make a comp read as AI-generated. Use one only when the brief asks for it.
- **Layout**: endless centered sections; identical card rows repeated section after section; cloned left-text / right-image blocks; perfect but lifeless symmetry; fake complexity without hierarchy; empty decorative space with no purpose.
- **Visual**: default purple/blue AI gradients; too many glowing edges; floating spheres / blobs; glassmorphism stacked without reason; random futuristic details with no structure; over-rendered noise that hides the layout.
- **Typography**: giant heading + weak tiny subcopy; too many font moods in one page; awkward line breaks; lazy all-caps everywhere; gradient headline as a shortcut for "premium".
- **Content**: generic copy vibes (unleash, elevate, revolutionize, next-gen, seamless, powerful solution, transformative platform); fake brand slop (Acme, Nexus, Flowbit, Quantumly, NovaCore, obvious nonsense wordmarks). Use short, believable, design-friendly copy.
- **Density**: over-packed sections; card overload in every block; tiny spacing between major sections; trying to fill every empty area; walls of content.
- **Carousel / marquee**: logo strips repeating the same 6 blobs; a "trusted by" ticker of unreadable mosquito logos; auto-play-style hero dots with no purpose.
- **Data / KPI**: three identical stat columns (99% satisfaction, $10 saved, ∞ scale) unless the user asked for KPIs; fake dashboards with pointless charts shading the real layout.

### Container and micro-UI slop
- No cards inside cards inside cards.
- No giant rounded wrappers around whole sections, and no dashboard-like compartment stacking.
- Use a box only when it has a clear purpose; prefer open layouts and fewer, stronger containers.
- Prefer one framing move per section.
- No pseudo-system labels such as "00 orchestration layer", and no section-number eyebrows.
- No tiny technical status pills, decorative runtime markers, filler chips or fake operator jargon.
- Cleaner headings, fewer labels and stronger typography do that job better.

---

## 8. Typography, rhythm and spacing
Typography is a primary design material, not filler:
- clear size contrast and an obvious reading order
- strong display moments
- brief, readable supporting text
- labels, captions and headings that reinforce structure

Editorial directions let type shape the composition; tech / product directions let it carry trust and precision.

Rhythm: a high-end site doesn't feel like repeated boxes. Vary these levers across sections: density, image-to-text ratio, alignment, scale, whitespace, card grouping, background intensity, visual tempo. Variation must not break overall cleanliness.
- Keep the cadence even: consistent vertical spacing between major sections unless there is a design reason.
- Section heights may vary, but avoid abrupt jumps between very small and very large sections without breathing room.
- Separate dense sections with calmer ones.
- Let whitespace create emphasis, and give smaller sections enough surrounding space to feel polished.
- Leave slightly more blank space between sections than a default AI layout would.

---

## 9. Component execution guidelines
- **Diagonal Staggered Square Masonry**: square image or content blocks with strong staggered vertical rhythm; curated and graphic, not messy.
- **3D Cascading Card Deck**: cards layered as a physical stack with depth logic; premium and tactile, not gimmicky.
- **Hover-Accordion Slice Layout**: a row of compressed visual slices that feel expandable; imply the interaction through proportions and emphasis.
- **Pristine Gapless Bento Grid**: mathematically clean, no accidental gaps; large visual blocks mixed with smaller dense information panels.
- **Turning Polaroid Arc**: clustered, rotated imagery in an elegant composition; styled and intentional, not scrapbook-random.
- **Off-Grid Editorial Layout**: asymmetry and tension with control; still readable and clearly structured.
- **Product UI Panel Stack**: layered UI screens or interface crops that imply a product story; avoid generic fake dashboards.
- **Vertical Rhythm Lines**: fine lines and spacing systems that reinforce order; never decorative clutter.

---

## 10. Color, material and style anchor
Write a style anchor before generating: 3–5 hex values (primary, secondary, accent, neutrals), a type description and font candidates, a radius rule, and an image treatment. Paste it verbatim into every prompt and include it in the final report. Hex values in the prompt hold consistency across requests far better than adjectives, and image-to-code uses them as tokens.

### Palette
One controlled palette across the whole site: 1 primary (brand anchor), 1 secondary (supporting tone), 1 accent (sparingly, for CTA / highlight), and a neutral scale (background, surface, text, hairline). Section-level mood shifts reuse the same palette rather than swapping the theme per section.

### Background-image harmony
With full-bleed image backgrounds: the image tonally matches the palette instead of fighting it; overlays (dark, light or color tint) keep text fully readable; the brand accent stays consistent whatever the background.

### Gradients
Gradients are welcome when professional and subtle; they are not the same as AI-slop gradients.
- Use confidently: low-chroma palette-matched tonal gradients (ink to graphite, cream to sand, ivory to warm grey); single-hue atmospheric grades behind hero photography; soft vignettes and radial depth that direct the eye; noise-textured gradients for tactile depth; editorial color washes that match brand mood.
- Avoid (AI gradient slop): rainbow / mesh blob gradients; purple-to-blue "AI" defaults; pink-to-orange "creator" defaults; neon edges and glow halos with no purpose; gradient text as a shortcut for "premium"; gradients that compete with imagery.

### Background confidence
Don't retreat to plain white by default. When the brief, mood or section job calls for atmosphere, use a full-bleed image, a duotone or graded photo, a tonal gradient, a tactile material, or a confident flat color field, picked deliberately.

### Guidance and materiality
Avoid rainbow randomness and over-neon unless requested; keep contrast intentional; match accent colors to the theme paradigm. Where it fits, add paper, glass, brushed metal, soft blur depth, tactile matte surfaces or editorial photo treatment, while keeping the frontend structure readable.

---

## 11. Image / media direction
Imagery must support the layout.
- Allowed: art-directed product visuals, refined editorial photography, UI crops, abstract forms with structural purpose, framed objects, premium texture, campaign-style visuals.
- Avoid: irrelevant scenery, stock-photo clichés, decorative junk, visuals that overpower the page hierarchy.
- Put images in fixed, repeatable frames (consistent ratios and radius across similar modules) so they can be rebuilt as fixed-aspect media blocks. Avoid random image sizes and collage chaos unless requested.

---

## 12. Default site packs
- 4 sections: Hero / Features / Social proof or testimonial / CTA
- 6 sections: Hero / Trust or proof bar / Features / Product showcase or use case / Testimonial / CTA + footer
- 8 sections: Hero / Trust bar / Features / Product showcase / Benefits or use cases / Testimonials / Pricing / CTA
- 12 sections: Hero / Trust bar / Feature grid / Product preview / Problem-solution / Benefits / Workflow / Metrics, proof or integration / Testimonials / Pricing / FAQ / CTA + footer

---

## 13. Continuity across images
Because every section is its own image, consistency is critical. Across all frames keep:
- the same brand world, palette and accent logic
- the same type family and scale logic, and the same spacing discipline
- the same CTA family (style variations are fine, identity is not)
- the same border-radius language and icon or illustration mood
- the same image treatment (grade, framing, material vocabulary)
- the same tonal voice in any short copy

Variation is allowed in composition anchor, background mode, section size and density, and which second-read moment appears. A viewer flipping through every frame must still recognize one brand; anything that breaks brand recall is over-variation.

---

## 14. Checks
**Plan (before generating)**
- The count equals the number of sections.
- The §15 variety check passes: anchors and background modes vary.
- The hero isn't reflexively text-left / image-right.
- There is one second-read moment.
- A conversion path exists (hook → proof → action).

**Per image**
- The fatal pass conditions in §0 hold, and the hierarchy is obvious enough for a developer to build from.

**Set**
- Same palette, type, radius and image treatment across frames.
- The spacing cadence reads even.

Fixing a plan is cheaper than regenerating images; when an image fails, fix that section only (targeted edit first).

---

## 15. Extra creativity and implementation edge
Apply unless the user opts out.
- **Cross-section contrast**: vary foreground/background intensity at least twice across the set (lighter → richer → calmer) so the scroll feels paced.
- **CTA specificity**: one unmistakable primary action per major viewport tier; secondary actions look secondary (scale, outline, ghost), not clones of the primary.
- **Image variety**: in multi-section sets mix at least two distinct image crops (macro product + contextual environment, portrait editorial + widescreen artifact) rather than one repeated silhouette.
- **Data-viz restraint**: charts, sparklines and graphs only when the site type needs them (analytics, pricing, infra, observability); otherwise keep proof human (quotes, receipts, timelines, screenshots of real workflows).
- **Cultural / tonal alignment**: when the brief names an industry or region, match palette and type temperament; don't ship a default "neutral SF startup" unless the brief is intentionally generic SaaS.
- **Mobile-implied fidelity**: tap-friendly hit sizes and readable caption sizes, with a stacking order that implies a sane single-column narrative.
- **Conversion focus**: each section has a job. The hero communicates value in seconds and offers one obvious next action; proof sections (logos, quotes, metrics) feel earned; pricing and CTA sections feel decisive; the final section closes with one strong CTA plus a trust cue. Avoid pure mood reels with no funnel logic.
- **Composition variety check**: log each section's composition anchor and background mode in the plan, and revise the plan if the same anchor repeats more than 2 sections in a row, the same background mode repeats more than 3 in a row, or every section is inline-asset (no full-bleed background) while the brief doesn't call for minimalism / typography-only / swiss / ultra simple. For non-minimalist briefs, push for at least one full-bleed (or duotone / atmospheric) background and at least one mini minimalist section in any multi-section site. For minimalist briefs this push is suspended: restraint is the design.

---

## 16. Response behavior
1. Infer site type, conversion goal, section count (§0); state count and time estimate.
2. Choose hero scale and one §2 combination; write the style anchor (§10).
3. Plan each section's anchor, background mode, CTA style; run the §15 variety check on this plan — fixing a plan is cheaper than regenerating images.
4. No save-approval question: the request is the permission. Each time the Save As dialog appears, ask the user to press 保存 (chatgpt-image-gen §5); their click is the final confirmation.
5. For each section in order: build the prompt (§0 template), hand it to chatgpt-image-gen with the pass conditions, report "Section X of N: <name> — done".
6. After the set: check continuity (rules in §13, Set checks in §14); fix only a section that breaks it (targeted edit first).
7. Confirm each image is in assets/ under its descriptive name (`ls`; chatgpt-image-gen moved it there with collect-download.mjs after the user pressed Save, so no chore step); report paths, the style anchor, per-section choices and the two motion-implied picks (image-to-code consumes this).
Ask a question only when the site type or brand is unclear.

---

## 17. Example interpretations
**"make a hero section for an AI startup"** → 1 image; Hero Scale Mid Editorial or Giant Statement; anchor bottom-left text over a full-bleed product/atmosphere image; background full-bleed image with dark tonal overlay; CTA outlined inline + small label hint; palette Deep Dark or Bold Studio Solid with one consistent accent; no dashboard spam, no purple AI glow.

**"design 8 sections for a fintech website"** → 8 separate images; Hero Scale Mid Editorial (trust-driven); anchors varied (centered low, right-third caption, bottom-left over a chart visual, stacked center for the closing CTA); background modes mixed (solid surface, one full-bleed image, editorial side-image at use cases); one palette (e.g. ink + paper + a single brand accent); conversion path hook → proof bar → features → use case → testimonial → pricing → FAQ → final CTA.

**"creative agency landing page, 12 sections"** → 12 separate images; Hero Scale Giant Statement or Mini Minimalist (decisive); editorial, poster-like direction with off-grid composition 2–3 times; background modes mixed (full-bleed at hero + showcase, editorial side-image at case studies, solid + accent for process); one palette with a single bold accent recurring; closing CTA as a mini minimalist section with strong type and one primary action.

---

## Attribution

Adapted from **taste-skill** (https://github.com/Leonxlnx/taste-skill), MIT License, Copyright (c) 2026 Leonxlnx. Repository-specific frontmatter and integration notes added for my-claude-base.
