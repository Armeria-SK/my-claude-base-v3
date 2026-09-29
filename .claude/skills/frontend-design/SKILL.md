---
name: frontend-design
description: >
  アンチスロップ（AIっぽくない）フロントデザインスキル。実際に動く Web UI / サイト / アプリ
  （主に製品ディレクトリ配下の制作物）を作るときに使う。ブリーフを読んで方向性を推論し、テンプレ臭のない
  LP・ポートフォリオ・リデザインを実装する。3ダイヤル（変化 / モーション / 密度）、実在デザインシステムの
  使い分け、AIバレ・パターン禁止集、リデザインは監査優先、厳格なプリフライト・チェックを備える。
  「サイト作って」「LP 作って」「フロントのデザインして」「ポートフォリオ作って」「この画面をリデザインして」で発動。
user-invocable: true
---

## 運用メモ（最優先）

- **このスキルの守備範囲**: 実際に動く Web UI / サイト / アプリ（製品ディレクトリ配下の制作物）。
- **対象外 = ユーザーが読む資料・スライド**: レポート / 調査結果 / ガイド / スライドは `doc` スキルが担当する（外部フェッチなしの単一 HTML）。React / Tailwind / CDN / Web フォントなどスタック前提は資料に持ち込まない。
- **画像が要るとき**: 装飾 SVG やコード生成アートを手描きせず、`chatgpt-image-gen` スキルで生成する。参考デザイン画像は `imagegen-frontend-web`、画像ファーストで作るなら `image-to-code`。
- 描画に依存しない美学ルール（AIバレ集・パレット・レイアウト規律）は、`doc` の単一 HTML 資料にも流用できる。持ち込めないのはスタック（CDN / フレームワーク）だけ。

---

# tasteskill: Anti-Slop Frontend Skill

> Landing pages, portfolios, and redesigns. Not dashboards, not data tables, not multi-step product UI.
> Every rule below is **contextual**. None of it fires automatically. First read the brief, then pull only what fits.

---

## 0. BRIEF INFERENCE (Read the Room Before Anything Else)

Before touching code or tweaking dials, **infer what the user actually wants**. Most LLM design output is bad because the model jumps to a default aesthetic instead of reading the room.

### 0.A Read these signals first
1. **Page kind** - landing (SaaS / consumer / agency / event), portfolio (dev / designer / creative studio), redesign (preserve vs overhaul), editorial / blog.
2. **Vibe words** the user used - "minimalist", "calm", "Linear-style", "Awwwards", "brutalist", "premium consumer", "Apple-y", "playful", "serious B2B", "editorial", "agency-y", "glassy", "dark tech".
3. **Reference signals** - URLs they linked, screenshots they pasted, products they named, brands they're competing with.
4. **Audience** - B2B procurement panel vs. design-conscious consumer vs. recruiter scanning a portfolio. The audience picks the aesthetic, not your taste.
5. **Brand assets that already exist** - logo, color, type, photography. For redesigns, these are starting material, not optional input (see Section 11).
6. **Quiet constraints** - accessibility-first audiences, public-sector, regulated industries, trust-first commerce, kids' products. These constraints override aesthetic preference.

### 0.B Output a one-line "Design Read" before generating
Before any code, state in one line: **"Reading this as: \<page kind> for \<audience>, with a \<vibe> language, leaning toward \<design system or aesthetic family>."**

Example reads:
- *"Reading this as: B2B SaaS landing for technical buyers, with a Linear-style minimalist language, leaning toward Tailwind utilities + Geist + restrained motion."*
- *"Reading this as: solo designer portfolio for hiring managers, with an editorial / kinetic-type language, leaning toward native CSS + scroll-driven animation + custom typography."*
- *"Reading this as: redesign of a public-sector service site, with a trust-first language, leaning toward GOV.UK Frontend or USWDS."*

### 0.C If the brief is ambiguous, ask one question, do not guess
Ask exactly **one** clarifying question - never a multi-question dump - and only when the design read genuinely diverges. Example: *"Should this feel closer to Linear-clean or Awwwards-experimental?"*

If you can confidently infer from context, **do not ask**. Just declare the design read and proceed.

### 0.D Anti-Default Discipline
Do not default to: AI-purple gradients, centered hero over dark mesh, three equal feature cards, generic glassmorphism on everything, infinite-loop micro-animations everywhere, Inter + slate-900. These are the LLM defaults. Reach past them deliberately based on the design read.

---

## 1. THE THREE DIALS (Core Configuration)

After the design read, set three dials. Every layout, motion, and density decision below is gated by these.

* **`DESIGN_VARIANCE: 8`** - 1 = Perfect Symmetry, 10 = Artsy Chaos
* **`MOTION_INTENSITY: 6`** - 1 = Static, 10 = Cinematic / Physics
* **`VISUAL_DENSITY: 4`** - 1 = Art Gallery / Airy, 10 = Cockpit / Packed Data

**Baseline:** `8 / 6 / 4`. Use these unless the design read overrides them. Do not ask the user to edit this file - overrides happen conversationally.

### 1.A Dial Inference (design read → dial values)
| Signal | VARIANCE | MOTION | DENSITY |
|---|---|---|---|
| "minimalist / clean / calm / editorial / Linear-style" | 5-6 | 3-4 | 2-3 |
| "premium consumer / Apple-y / luxury / brand" | 7-8 | 5-7 | 3-4 |
| "playful / wild / Dribbble / Awwwards / experimental / agency" | 9-10 | 8-10 | 3-4 |
| "landing page / portfolio / marketing site (default)" | 7-9 | 6-8 | 3-5 |
| "trust-first / public-sector / regulated / accessibility-critical" | 3-4 | 2-3 | 4-5 |
| "redesign - preserve" | match existing | +1 | match existing |
| "redesign - overhaul" | +2 | +2 | match existing |

### 1.B Use-Case Presets
| Use case | VARIANCE | MOTION | DENSITY |
|---|---|---|---|
| Landing (SaaS, mainstream) | 7 | 6 | 4 |
| Landing (Agency / creative) | 9 | 8 | 3 |
| Landing (Premium consumer) | 7 | 6 | 3 |
| Portfolio (Designer / studio) | 8 | 7 | 3 |
| Portfolio (Developer) | 6 | 5 | 4 |
| Editorial / Blog | 6 | 4 | 3 |
| Public-sector service | 3 | 2 | 5 |

### 1.C How the Dials Drive Output
Use these (or user-overridden values) as global variables. Cross-references throughout this document refer to these exact variable names - never invent aliases like `LAYOUT_VARIANCE` or `ANIM_LEVEL`.

---

## 2. BRIEF → DESIGN SYSTEM MAP

Once you have the design read (Section 0) and dials (Section 1), pick the right foundation. Do not invent CSS for things that have an official package. Do not pretend an aesthetic trend is an official system.

### 2.A When to reach for a real design system (use official packages)
| Brief reads as… | Reach for | Why |
|---|---|---|
| Microsoft / enterprise SaaS / dashboards | `@fluentui/react-components` or `@fluentui/web-components` | Official Fluent UI, Microsoft tokens, accessibility done |
| Google-ish UI, Material-flavored product | `@material/web` + Material 3 tokens | Official Material 3 web components, **in maintenance mode since 2024** (usable, but no new components); check the component you need exists. |
| IBM-style B2B / enterprise analytics | `@carbon/react` + `@carbon/styles` | Official Carbon, mature data-density patterns |
| Shopify app surfaces | `polaris.js` web components (Polaris React is deprecated) | Required for Shopify admin UI |
| Atlassian / Jira-style product | `@atlaskit/*` + `@atlaskit/tokens` | Official Atlassian DS |
| GitHub-style devtool / community page | `@primer/css` or `@primer/react-brand` | Official Primer; Brand variant for marketing |
| Public-sector UK service | `govuk-frontend` | Legally / regulatorily expected |
| US public-sector / trust-first | `@uswds/uswds` | Same |
| Fast local-business / agency MVP | Bootstrap 5.3 | Boring, fast, works |
| Modern accessible React foundation | `@radix-ui/themes` | Primitives + polished theme |
| Modern SaaS where you own the components | shadcn/ui (`npx shadcn@latest add ...`) | You own the code, easy to customise; never ship default state |
| Tailwind-based modern SaaS / AI marketing | Tailwind v4 utilities + `dark:` variant | Default for indie + small team builds |

**Honesty rule:** if the brief reads as one of the systems above, install and use the **official** package. Do not recreate its CSS by hand. Do not import a system's tokens but then override 90% of them.

**One system per project.** Do not mix Fluent React with Carbon in the same tree. Do not import shadcn/ui components into a Material 3 app.

### 2.B When the brief is an aesthetic, not a system
For these directions, there is **no single official package**. Build with native CSS + Tailwind + a maintained component library. Be honest in code comments about what is borrowed inspiration vs. official material.

| Aesthetic | Honest implementation |
|---|---|
| Glassmorphism / "frosted glass" | `backdrop-filter`, layered borders, highlight overlays. Provide solid-fill fallback for `prefers-reduced-transparency`. |
| Bento (Apple-style tile grids) | CSS Grid with mixed cell sizes. No single library owns this. |
| Brutalism | Native CSS, monospace, raw borders. No library. |
| Editorial / magazine | Serif type, asymmetric grid, generous whitespace. No library. |
| Dark tech / hacker | Mono + accent neon, terminal motifs. No library. |
| Aurora / mesh gradients | SVG or layered radial gradients. No library. |
| Kinetic typography | Native CSS animations, scroll-driven animations, GSAP for hijacks. No library. |
| **Apple Liquid Glass** | Apple documents this for Apple platforms only. **There is no official `liquid-glass.css`.** Web implementations are approximations using `backdrop-filter` + layered borders + highlights. Label clearly as approximation. |

---

## 3. DEFAULT ARCHITECTURE & CONVENTIONS

Unless the design read picks a real design system (Section 2.A), these are the defaults:

### 3.A Stack
* **Framework:** React or Next.js. Default to Server Components (RSC).
  * **RSC safety:** global state works only in Client Components. In Next.js, wrap providers in a `"use client"` component.
  * **Interactivity isolation:** any component using Motion, scroll listeners, or pointer physics is an isolated leaf with `'use client'` at the top. Server Components render static layouts only. For simple enter animations in an RSC file, `import * as motion from "motion/react-client"` avoids a wrapper; hooks (`useScroll`, `useMotionValue`) still need a client component.
* **Styling:** **Tailwind v4** (default). Tailwind v3 only if the existing project demands it.
  * For v4: do not use the `tailwindcss` plugin in `postcss.config.js`; use `@tailwindcss/postcss` or the `@tailwindcss/vite` plugin.
* **Animation:** **Motion** (the library formerly known as Framer Motion). Import from `motion/react` (`import { motion } from "motion/react"`). The `framer-motion` package still works as a legacy alias - prefer `motion/react` in new code.
* **Fonts:** use `next/font` (Next.js) or self-host with `@font-face` + `font-display: swap`. Do not link Google Fonts via `<link>` in production.

### 3.B State
* Local `useState` / `useReducer` for isolated UI.
* Global state only to avoid deep prop-drilling: Zustand, Jotai, or React context.
* Do not use `useState` for continuous values driven by user input (mouse position, scroll progress, pointer physics, magnetic hover). Use Motion's `useMotionValue` / `useTransform` / `useScroll` (see 5.D); `useState` re-renders the React tree on every change and collapses on mobile.

### 3.C Icons
* **Allowed libraries (priority order):** `@phosphor-icons/react`, `@hugeicons/react` (with `@hugeicons/core-free-icons`), `@radix-ui/react-icons`, `@tabler/icons-react`.
* **Discouraged:** `lucide-react`. Acceptable only when the user explicitly asks for it or the project already depends on it. shadcn/ui installs `lucide-react` by default. Either keep it (the "project already depends on it" case applies) or set `iconLibrary` in `components.json` (`lucide | hugeicons | phosphor | tabler | remixicon | radix`) before adding components. Do not end up with two families.
* **Do not hand-roll SVG icons.** If a glyph is missing, install a second library or compose from primitives; do not draw icon paths from scratch.
* **One family per project.** Do not mix Phosphor with Lucide in the same component tree.
* **Standardize stroke weight globally**: `strokeWidth` (Tabler/Hugeicons/Lucide, e.g. `1.5` or `2.0`) or `weight` (Phosphor, e.g. `weight="light"` via `IconContext`).

### 3.D Emoji Policy
Discouraged by default in code, markup, and visible text. Replace symbols with icon-library glyphs. **Override:** allow emojis only when the user explicitly asks for a playful / chat-style / social-native vibe - and even then use them sparingly with intent.

### 3.E Responsiveness & Layout Mechanics
* Standardize breakpoints (`sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536`).
* Contain page layouts using `max-w-[1400px] mx-auto` or `max-w-7xl`.
* **Viewport Stability:** avoid `h-screen` (`100vh`) for full-height heroes; on mobile it is taller than the visible area. Use `min-h-svh` (stable, sized to the toolbar-expanded viewport) by default, or `min-h-dvh` when the section should track the toolbar.
* **Grid over Flex-Math:** avoid flexbox percentage math (`w-[calc(33%-1rem)]`); use CSS Grid (`grid grid-cols-1 md:grid-cols-3 gap-6`).

### 3.F Dependency Verification
Before importing any third-party library, check `package.json`. If the package is missing, output the install command first; do not assume a library exists.

### 3.G Platform-first CSS (reach for these before a JS library)
* **Container queries** (Baseline 2023; Tailwind v4 `@container` + `@md:`): components in bento cells or sidebars respond to their box, not the viewport.
* **`text-wrap: balance`** on headlines (Tailwind `text-balance`) prevents one-word last lines, which serves the 2-line hero rule. **`text-wrap: pretty`** on body is progressive enhancement.
* **`@starting-style` + `transition-behavior: allow-discrete`**: CSS-only enter animations for dialogs, popovers and toasts.
* **Scroll-driven animations** (`animation-timeline: view()/scroll()`): Chromium and Safari 26+, Firefox behind a flag (2026). Wrap in `@supports (animation-timeline: view())` so the static page is the fallback. Prefer them over GSAP for simple reveals and progress bars. In static or server-rendered markup use CSS scroll-driven animations; inside an existing Motion client leaf use `whileInView` (Section 5.C).
* **View Transitions:** same-document `document.startViewTransition()` for state swaps; cross-document `@view-transition { navigation: auto; }` for MPA page transitions. Gate under reduced motion.
* **Popover API / `<dialog>`** for menus and modals; CSS **anchor positioning** for tooltips as progressive enhancement.
* **Colour:** define tokens in `oklch()` (Tailwind v4's default palette is OKLCH) and derive tints and hover states with `color-mix(in oklch, ...)`.
* Motion/GSAP remain the choice for springs, layout animation, pinning and scrub choreography.

---

## 4. DESIGN ENGINEERING DIRECTIVES (Bias Correction)

LLMs default to clichés. Override these defaults proactively. Each rule has a context-aware override path.

### 4.1 Typography
* **Display / Headlines:** Default `text-4xl md:text-6xl tracking-tighter leading-none`.
* **Body / Paragraphs:** Default `text-base text-gray-600 leading-relaxed max-w-[65ch]`.
* **Sans font choice:**
  * **Discouraged as default:** `Inter`. Pick `Geist`, `Outfit`, `Cabinet Grotesk` or `Satoshi` first (a serif only under the serif discipline below).
  * **Override:** Inter is acceptable when the user explicitly asks for a neutral / standard / Linear-style feel, or when the brief is a public-sector / accessibility-first site.
* **Pairings to know:** `Geist` + `Geist Mono`, `Satoshi` + `JetBrains Mono`, `Cabinet Grotesk` + `Inter Tight`, `Instrument Sans` + `IBM Plex Mono`.
* **Licensing:** only name a font you can actually load: `next/font/google` (Geist, Inter Tight, Instrument Sans, Bricolage Grotesque, Newsreader, EB Garamond, Cormorant ...) or Fontshare (Satoshi, Cabinet Grotesk, General Sans, Clash Display) self-hosted. Commercial faces (Söhne, GT *, ABC *, PP *, Klim) only when the brief supplies the files.

* **Serif discipline (discouraged as default):**
  * Do not default to a serif for any project. "It feels creative / premium / editorial" is not a reason to reach for one; the reflex "creative brief = serif" is a recognisable AI tell.
  * **A serif is acceptable only when one of these is explicitly true:**
    - The brand brief literally names a serif font, or
    - The aesthetic family is genuinely editorial / luxury / publication / manuscript / heritage / vintage and you can articulate why this specific serif fits this specific brand.
  * For everything else (creative agency, design studio, modern brand, premium consumer, portfolio, lifestyle), default to a sans-serif display face (the sans faces above, or ABC Diatype, Söhne Breit, GT Walsheim, Inter Display, PP Neue Montreal where the files are available). Sans display faces are not "boring"; they are the default for the same reason black is the default in fashion.
  * **Emphasis rule (related):** to emphasize a word within a headline (the kinetic "and `spatial` design" move), use italic or bold of the same font. Do not inject a random serif word into a sans headline (or vice versa) just to add visual interest; mixed-family emphasis reads as amateur.
  * Do not default to `Fraunces` or `Instrument_Serif` (the two display serifs models reach for most).
  * **If a serif is justified** (rare, per the above), rotate from this pool and do not reuse the same serif across sites built in the same session or repo: PP Editorial New, GT Sectra Display, Reckless Neue, Tiempos Headline, Recoleta, Cormorant Garamond, Playfair Display, EB Garamond, IvyPresto, Migra, Editorial Old, Saol Display, Domaine Display, Canela, Schnyder, Tobias, ITC Galliard. Free via Google Fonts: Cormorant Garamond, Playfair Display, EB Garamond (and Newsreader, Instrument Serif where allowed); the rest are commercial and need brief-supplied files.
* **Japanese pages:** pair the Latin face with a JP family loaded via `next/font/google` (Noto Sans JP, BIZ UDPGothic, Zen Kaku Gothic New, M PLUS 1p; serif: Noto Serif JP, Shippori Mincho), subset or split to control weight. Use `line-break: strict` and `word-break: auto-phrase` (Chromium; progressive) so headlines break at phrase boundaries; `text-wrap: balance` alone does not handle CJK well. Loosen `tracking-tighter` and use `leading-[1.6]` to `leading-[1.8]` for JP body.

* **Italic descender clearance:** when italic is used in display type and the word contains a descender letter (`y g j p q`), `leading-[1]` or `leading-none` will clip the descender. Use `leading-[1.1]` minimum and add `pb-1` or `mb-1` reserve on the wrapping element. Audit every italic word in display headlines before shipping.

### 4.2 Color Calibration
* Max 1 accent color. Saturation < 80% by default.
* **The lila rule:** the "AI Purple / Blue glow" aesthetic is discouraged as a default. No automatic purple button glows, no random neon gradients. Use neutral bases (Zinc / Slate / Stone) with high-contrast singular accents (Emerald, Electric Blue, Deep Rose, Burnt Orange, etc.).
* **Override:** if the brand or brief explicitly asks for purple / violet / lila, embrace it. But execute with intent: consistent palette, harmonised neutrals, restrained gradients. Not generic AI gradient slop.
* **One palette per project.** Do not fluctuate between warm and cool grays within the same project.
* **Color consistency lock:** once an accent color is chosen for a page, it is used on the whole page. A warm-grey site does not suddenly get a blue CTA in section 7. A rose-accented site does not get a teal status badge in the footer. Pick one accent, lock it, audit every component before shipping.

* **Premium-consumer palette: avoid the beige/brass default.**
  * For premium-consumer briefs (cookware, wellness, artisan, luxury, heritage craft, DTC home goods, etc.) the LLM default is **warm beige/cream + brass/clay/oxblood/ochre + espresso/ink dark text**. Do not use these hex families as default backgrounds and accents:
    - Backgrounds: `#f5f1ea`, `#f7f5f1`, `#fbf8f1`, `#efeae0`, `#ece6db`, `#faf7f1`, `#e8dfcb` (all "warm paper / cream / chalk / bone")
    - Accents: `#b08947`, `#b6553a`, `#9a2436`, `#9c6e2a`, `#bc7c3a`, `#7d5621` (all "brass / clay / oxblood / ochre")
    - Text: `#1a1714`, `#1a1814`, `#1b1814` (all "espresso / warm near-black")
  * Do not use this palette as the default for premium-consumer briefs. It is the palette models reach for by default, so a site using it looks like every other generated premium site; the brand disappears.
  * **Default alternatives (rotate, do not reuse):**
    - **Cold Luxury:** silver-grey + chrome + smoke (think Tesla, Apple Watch Hermes-without-the-leather)
    - **Forest:** deep green + bone + amber accent (think Filson, Patagonia premium)
    - **Black and Tan:** true off-black + warm tan, sharp contrast, no beige
    - **Cobalt + Cream:** saturated blue against a single neutral, no brass
    - **Terracotta + Slate:** warm rust against cool grey, no brass
    - **Olive + Brick + Paper:** muted olive plus brick-red accent
    - **Pure monochrome + single saturated pop:** off-white + off-black + one bright accent (electric blue, emerald, hot pink, etc.)
  * **Rotation:** when building several sites in the same session or repo, do not reuse a palette family (or display serif) across them.
  * **Override:** the beige+brass+espresso palette is acceptable only when the brand brief explicitly names those colors, or when the brand identity is genuinely vintage / artisan / warm-craft and you can articulate why this specific palette fits this specific brand. Reaching for it just because "this is a cookware brief" is not a reason.

### 4.3 Layout Diversification
* **Anti-center bias:** avoid centered hero / H1 sections when `DESIGN_VARIANCE > 4`. Prefer "Split Screen" (50/50), "Left-aligned content / right-aligned asset", "Asymmetric white-space", or scroll-pinned structures.
* **Override:** centered hero is OK for editorial / manifesto / launch-announcement briefs where the message itself is the design.

### 4.4 Materiality, Shadows, Cards
* Use cards only when elevation communicates real hierarchy. Otherwise group with `border-t`, `divide-y`, or negative space.
* When a shadow is used, tint it to the background hue. No pure-black drop shadows on light backgrounds.
* For `VISUAL_DENSITY > 7`: skip generic card containers. Data metrics breathe in plain layout.
* **Shape consistency lock:** pick one corner-radius scale for the page and stick to it. Options: all-sharp (radius 0), all-soft (radius 12-16px), all-pill (full radius for interactive). Mixed systems are allowed only when there is a documented rule (e.g. "buttons are full-pill, cards are 16px, inputs are 8px") and that rule is followed everywhere. Round buttons in a square layout, or square cards on a pill-button page, is broken design.

### 4.5 Interactive UI States
LLMs default to "static successful state only." Always implement full cycles:
* **Loading:** Skeletal loaders matching the final layout's shape. Avoid generic circular spinners.
* **Empty States:** Beautifully composed; indicate how to populate.
* **Error States:** Clear, inline (forms), or contextual (toasts only for transient).
* **Tactile Feedback:** On `:active`, use `-translate-y-[1px]` or `scale-[0.98]` to simulate a physical push.
* **Button contrast check (a11y):** before shipping any button, verify the button text is readable against the button background. A white button with white text, a `bg-white` CTA with a `text-white` label, or a transparent button against the page background with no border all fail. Audit every CTA against WCAG AA (4.5:1 for normal text; 3:1 for large text = ≥24px regular or ≥18.66px bold). The same rule applies to ghost buttons over photographic backgrounds (use a backdrop, scrim, or stroke).
* **CTA labels stay on one line at desktop.** If a label like "VIEW SELECTED WORK" wraps to 2 or 3 lines, the button is broken. Fix it by either shortening the label (3 words max for primary CTAs, ideally 1-2) or widening the button (do not artificially constrain `max-width` on CTAs). Wrapped CTAs at desktop are a Pre-Flight Fail.
* **One label per CTA intent.** Two CTAs with the same intent on one page is a Pre-Flight Fail. Examples of same intent: "Get in touch" + "Contact us" + "Let's talk" + "Start a project" + "Start something" + "Reach out" = all "contact" intent → pick one label and use it everywhere on the page (nav, hero, footer). Same for "Try free" + "Get started" + "Sign up free" (all "signup" intent) and "View work" + "See selected work" + "Browse projects" (all "portfolio" intent). One label per intent.
* **Form contrast check (a11y):** placeholder, helper, label and error **text** pass 4.5:1; input borders and focus indicators pass 3:1 against adjacent colors (WCAG 1.4.11). Light placeholders on a near-white form, a white form on a white page section, or form labels grayer than 4.5:1 all fail. Audit every form before shipping.

### 4.6 Data & Form Patterns
* Label above the input. Helper text optional but present in markup. Error text below the input. Standard `gap-2` for input blocks.
* Do not use a placeholder as the label.

### 4.7 Layout Discipline (Hard Rules. Failing any of these is shipping broken work)

* **Hero MUST fit in the initial viewport.** Headline max 2 lines on desktop, subtext max **20 words** AND max 3-4 lines, CTAs visible without scroll. If the copy is too long: reduce font scale OR cut copy. If you cannot describe the value-prop in 20 words of subtext, the value-prop is unclear, not the rule too tight. Never let the hero overflow and force scroll to find the CTA.
* **Hero font-scale discipline.** Plan font size and image size *together*. If the hero asset is large and the headline is more than 6 words, do not start at `text-7xl/text-8xl`. Default sensible range: `text-4xl md:text-5xl lg:text-6xl` for most heroes; `text-6xl md:text-7xl` only when the headline is 3-5 words. A 4-line hero headline is always a font-size error, never a copy-length error.
* **HERO TOP PADDING CAP (mandatory):** Hero top padding max `pt-24` (≈6rem) at desktop. More than that means the hero content floats halfway down the viewport and reads as a layout bug, not as intentional space. If your hero needs more breathing room, increase font scale or asset size, not top padding.
* **HERO STACK DISCIPLINE (max 4 text elements).** The hero is a single moment, not a feature list. Allowed text elements, max 4 in total:
  1. Eyebrow (small uppercase label) OR brand strip OR neither - pick zero or one
  2. Headline (max 2 lines, see above)
  3. Subtext (max 20 words, max 4 lines)
  4. CTAs (1 primary + max 1 secondary)
  - **BANNED in the hero:** tiny tagline below CTAs ("Works with GitHub, GitLab, and self-hosted Git"), trust micro-strip ("Used by engineering teams at..."), pricing teaser ("Free for solo, $10/user for teams"), feature bullet list, social-proof avatar row. All of those move to dedicated sections directly below the hero.
  - If you have an eyebrow AND a tagline below CTAs in the same hero, drop the tagline. If you have a brand strip AND a tagline, drop the tagline. One small text element per hero, max.
* **"Used by" / "Trusted by" logo wall belongs UNDER the hero, never inside it.** The hero is for the value prop and primary CTA. The logo wall is a separate section directly below. Do not stuff trust logos into the same flex row as the hero copy.
* **Navigation MUST render on a single line on desktop.** If items don't fit at `lg` (1024px), condense labels, drop secondary items, or move to a hamburger. A two-line nav at desktop is broken design.
* **Navigation height cap: 80px max desktop, default 64-72px.** No huge "agency" nav bars that eat 15% of the viewport.
* **Bento grids MUST have rhythm, not one-sided repetition.** Do not stack 6 left-image / right-text rows. Vary the composition: alternate full-width feature rows, asymmetric tile sizes, vertical breaks.
* **BENTO CELL COUNT RULE (mandatory):** A bento grid has EXACTLY as many cells as you have content for. 3 items → 3 cells (1+2 split, or 2+1, or asymmetric trio). 5 items → 5 cells (2+3, 3+2, hero+4, etc.). If your grid has an empty cell in the middle or at the end, you planned wrong. Re-shape the grid; do not paste a blank tile.
* **Section-Layout-Repetition Ban.** Once you use a layout family for a section (e.g., 3-column-image-cards, full-width-quote, split-text-image), that family can appear at most ONCE on the page. "Selected commissions" must not look like "What we do." A landing page with 8 sections must use at least 4 different layout families.
* **ZIGZAG ALTERNATION CAP (mandatory).** Alternating "left-image + right-text" then "left-text + right-image" zigzag layout = banal. Max 2 sections in a row with this image+text-split pattern. The 3rd consecutive image+text split is a Pre-Flight Fail. Break the pattern with a full-width section, a vertical-stack section, a bento grid, a marquee, or a different layout family.
* **EYEBROW RESTRAINT (mandatory).** An "eyebrow" is the small uppercase wide-tracking label sitting above a section headline (e.g. `FOUR COLORWAYS`, `SELECTED WORK`, `THE HARDWARE`, `Git-native task management`). Typical CSS signature: `text-[11px] uppercase tracking-[0.18em]`, `font-mono text-[10.5px] uppercase tracking-[0.22em]`. Every AI-built site puts an eyebrow above EVERY section header, producing the same templated rhythm. Hard rule:
  - **Maximum 1 eyebrow per 3 sections.** Hero counts as 1. So a page with 9 sections may use at most 3 eyebrows total.
  - If section A has an eyebrow, the next 2 sections cannot have one.
  - **Pre-Flight Check is mechanical:** count instances of `uppercase tracking` (or similar small-caps mono labels above headlines) across all section components. If count > ceil(sectionCount / 3), the output fails.
  - **What to do instead of an eyebrow:** drop it entirely. The headline alone is enough. If you need to categorize a section, the section's location on the page already categorizes it; no label needed.
* **SPLIT-HEADER BAN (mandatory).** The pattern "left big headline + right small explainer paragraph" as a section header (left col-span-7/8, right col-span-4/5 with a small body paragraph floating in the right column) is **banned as default**. Sections should have ONE focused message. If you genuinely need both a headline and an explainer paragraph, stack them vertically (headline on top, body below, max-width 65ch). Reach for the split-header pattern only when there is a real compositional reason (e.g., the right column carries a visual or interactive element, not just filler text).
* **Bento Background Diversity (mandatory).** Bento and feature-grid sections cannot be 6 white-on-white cards with text inside. At least 2-3 cells in any multi-cell grid need real visual variation: a real image, a brand-appropriate gradient (not AI-purple), a pattern, a tinted background. A cream-on-cream bento with only typography inside reads as boring AI default, even when the rest of the page is good.
* **Mobile collapse must be explicit per section.** For every multi-column layout, declare the `< 768px` fallback in the same component. No "it'll work, Tailwind handles it" assumptions.

### 4.8 Image & Visual Asset Strategy

Landing pages and portfolios are **visual products**. Text-only pages with fake-screenshot divs are slop.

**Priority order for visual assets:**
1. **Brand or brief assets first**, then **generated images** via the `chatgpt-image-gen` skill (or any image tool in the environment) for hero, product and mood shots at the section's aspect ratio. Generated imagery reads as real work; hand-drawn CSS/SVG scenes read as placeholder.
2. **Real web images second.** When no gen tool is available, use real photography sources. Acceptable defaults:
   * `https://picsum.photos/seed/{descriptive-seed}/{w}/{h}` for placeholder photography (seed should describe the section, e.g. `marrow-cookware-kitchen`). The seed only makes the photo stable; the content is random. Treat it as a layout placeholder and list the real image needed in the final response.
   * Actual stock or brand URLs when the brief provides them
   * Open-license sources (Unsplash via direct URL, Pexels) if explicitly allowed
3. **Last resort: tell the user.** If neither is possible, do not fill the page with hand-rolled SVG illustrations or div-based "fake screenshots." Instead, leave clearly-labeled placeholder slots (`<!-- TODO: hero product photo, 1600x1200 -->`) and at the end of the response say: *"This page needs real images at: \[list of placements\]. Please generate or provide them."*

**Even minimalist sites need real images.** A landing page with no imagery usually reads as unfinished, so plan for 2-3 real images unless the design read is explicitly type-only (manifesto / editorial poster). Generate restrained (for example black-and-white) photography if the brief is minimal; do not skip images just because the dials are low.

**Logo walls for social proof.** When the brief calls for a "Trusted by / Used by / Customers" logo wall, do not default to plain text wordmarks (`<span>Acme Co</span>` styled in a row). Use SVG logos:
* **Source: Simple Icons** (`https://cdn.simpleicons.org/{slug}` or the `simple-icons` package), **only for logos the brief says are real customers or integrations**. Showing a real company's logo as a customer of a product it does not use is a false endorsement. For fictional or unconfirmed customers, use invented marks (next bullet) or a labeled placeholder row.
* **Alternative: devicon** for tech-stack logos (`devicon` npm package or its jsDelivr CDN).
* **Invented brand name? Then invent an SVG mark too.** Generate a simple monogram (one letter in a circle, two-letter ligature, abstract glyph) rendered as an inline `<svg>` matching the page style. Plain text wordmarks for invented brand names look generic.
* Make sure logos render in both light and dark mode (white-on-dark, black-on-light, or single-color theme variable).
* **Logo-only rule:** a logo wall is logos and nothing else. Do not print industry / category labels below each logo (no `Vercel` + `hosting` underneath, no `Stripe` + `payments`, no `Cloudflare` + `infra`). The logo is the credibility, the label adds nothing the user does not already know. Optional: brand name as alt-text for screen readers, optional link to the brand's site. That is it.

**Hand-rolled illustrations:**
* SVG icons from libraries: fine (see Section 3.C).
* Hand-rolled decorative SVGs (custom illustrations, logos, marks): strongly discouraged, never as default. Acceptable only when:
  - The brief explicitly calls for it ("draw me an SVG logo")
  - It's a single, simple geometric mark (a square, a circle, a wordmark in display type)
  - You're confident in the output quality

**Div-based fake screenshots are banned.** A "hand-built product preview" rendered with `<div>` rectangles, fake task lists, fake dashboards, fake terminal windows is a Tell. If you need to show a product:
* Use a real screenshot URL if one exists
* Generate one via image tool
* Use a real component preview (an actual mini-version of the UI inside the page)
* Or skip the preview entirely and use editorial photography

**Hero needs a real visual** unless the Design Read declares a type-only page (manifesto / editorial poster). Text + gradient blob is not a hero - it's a placeholder.

### 4.9 Content Density

Landing pages live on the **first impression**, not the full read. Cut ruthlessly.

* **Default content shape per section:** short headline (≤ 8 words) + short sub-paragraph (≤ 25 words) + one visual asset OR one CTA. Anything more must be justified by the section's job.
* **No data-dump sections.** A 20-row publication table, a 30-row award list, a giant pricing matrix on a marketing page = wrong layout. Use:
  - Top 3-5 highlights + "View full list" link
  - Marquee / carousel for breadth
  - Different page entirely if the data is the product
* **Long lists need a different UI component, not a longer list.** Default `<ul>` with bullets / `divide-y` rows is the lazy choice. If you have > 5 items, reach for one of these instead:
  - 2-column split with grouped items
  - Card grid with image + label per item
  - Tabs / accordion if items are categorisable
  - Horizontal scroll-snap pills
  - Carousel for breadth-heavy lists (testimonials, logos, capabilities)
  - Marquee for "lots-of-things-that-don't-need-individual-attention"
  A spec sheet with 10 rows + a hairline under every row is the worst default. Either group rows into 2-3 chunks with sparse dividers, or move to a card-per-spec layout.
* **Spec sheets specifically (the Marrow-cookware pattern).** A long product specification table with `border-b` on every row is the AI default for cookware / hardware / apparel / artisan-goods briefs. Avoid it. Concrete alternatives:
  - **2-col card grid:** each spec gets its own card with the spec name, the value (large display number), and a one-line "why it matters" body. Cards arranged 2-col on desktop, 1-col mobile.
  - **Scroll-snap horizontal pills:** each spec is a pill, user can flick through.
  - **Grouped chunks:** group 10 specs into 3 logical clusters (e.g. "Materials", "Cooking", "Warranty"), each cluster gets one soft divider and a cluster heading.
  - **Featured-vs-rest:** 3-4 hero specs visualised as large display tiles, the rest collapsed under a "View full specifications" disclosure.

* **Copy self-audit before shipping:** before declaring any task done, re-read every visible string on the page (headlines, subheads, eyebrows, button labels, body copy, captions, alt text, footer text, error messages). Flag any string that is:
  - **Grammatically broken** ("free on its past", "two plans but one is honest", "to put it on the table" out of context)
  - **Has unclear referents** ("we plan to stay that way" without prior context)
  - **Sounds like AI hallucination** (cute-but-wrong wordplay, forced metaphors that don't track, "elegant nothing" phrases)
  - **Reads like an LLM trying to sound thoughtful** (passive-aggressive humility, fake-craftsman labels, mock-poetic micro-meta)
  Rewrite every flagged string. If unsure whether a string makes sense, replace it with a plain functional sentence. AI-generated cute copy is worse than boring copy.
* **Fake-precise numbers are flagged.** Numbers like `92%`, `4.1×`, `48k`, `5.8 mm`, `13.4 lb` either:
  - Come from real data (brief, brand guidelines, public metrics) - fine
  - Are explicitly labeled as mock (`<!-- mock -->`, "example", "sample data") - fine
  - Are AI-invented spec aesthetics: don't. Do not fake engineering precision the brand doesn't claim.
* **One copy register per page.** Don't mix technical mono ("47 tasks · 0.6 ctx-switches/day"), editorial prose, and marketing punch in the same composition unless the brand voice explicitly calls for it.

### 4.10 Quotes & Testimonials

* **Max 3 lines** of quote body. Never 6. If the original quote is longer → cut it. A landing-page quote is a snippet, not the full review.
* For very small font sizes (e.g. footer-style testimonials), the line cap can stretch slightly. Spirit: "fits in a glance."
* No em-dashes (Section 9.G).
* Attribution: name + role + (optionally) company. Never name only ("- Sarah").
* Quote marks: use real typographic quotes ( " " ) or none at all. Not straight ASCII ( " ).

### 4.11 Page Theme Lock (Light / Dark Mode Consistency)

The page has one theme. Sections do not invert.

* If the page is dark mode, all sections are dark mode. No light-mode-warm-paper section sandwiched between dark sections (or vice versa). The user must not feel they walked into a different website mid-scroll.
* The exception: if the brief explicitly calls for a "Color Block Story" or "Theme Switch on Scroll" device and that is a deliberate composition (one full theme switch with a strong transition, not random alternation), it is allowed once per page.
* Default behaviour: pick light, dark, or auto (`prefers-color-scheme`) at the page level and lock it. Section-level background tints within the same theme family are fine (`bg-zinc-950` next to `bg-zinc-900`); flipping to `bg-amber-50` in the middle of a `bg-zinc-950` page is broken.
* When using a design system with built-in theming (Radix Themes `<Theme>`, shadcn/ui via `next-themes` `ThemeProvider` + CSS variables), set the theme once at the root layout.

---

## 5. CONTEXT-AWARE PROACTIVITY

These are tools, not defaults. Use them when the design read calls for them. **None of these fire automatically.**

* **Liquid Glass / Glassmorphism:** Appropriate for premium consumer, Apple-adjacent, luxury brand, or media-overlay vibes. Inappropriate for dashboards, public-sector, or "boring B2B." When used, go beyond `backdrop-blur`: add a 1px inner border (`border-white/10`) and a subtle inner shadow (`shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]`) for physical edge refraction. Provide a solid-fill fallback under `prefers-reduced-transparency`.
* **Magnetic Micro-physics:** Use when `MOTION_INTENSITY > 5` and the brief reads premium / playful / agency. Implement with Motion's `useMotionValue` / `useTransform` outside the React render cycle, not `useState` (see Section 3.B).
* **Perpetual Micro-Interactions** (Pulse, Typewriter, Float, Shimmer, Carousel): Use when `MOTION_INTENSITY > 5` and the section actively benefits from motion (status indicators, live feeds, AI-feel). **Not every card needs an infinite loop.** If a section is informational, leave it still. Use springs (`type: "spring", stiffness: 100, damping: 20`) for pointer- and state-driven motion. Scroll-scrubbed tweens stay `ease: "none"` because scroll position is already the easing.
* **"Motion claimed, motion shown."** If `MOTION_INTENSITY > 4`, the page must actually move: entry transitions on hero, scroll-reveal on key sections, hover physics on CTAs, at minimum. A static page that claims `MOTION_INTENSITY: 7` is broken. Conversely, if you cannot ship working motion in the available scope, drop the dial to 3 and ship a clean static page. Never half-build motion that breaks (cut-off ScrollTriggers, jumpy enters, missing cleanups).
* **Motion must be motivated.** Before adding any animation, ask: "what does this animation communicate?" Valid answers: hierarchy (drawing attention to the right thing), storytelling (revealing content in sequence that matches a narrative), feedback (acknowledging a user action), state transition (showing something changed). Invalid answer: "it looked cool". GSAP everywhere because GSAP is available is amateur. Each ScrollTrigger, each marquee, each pinned section needs a reason. If you cannot articulate the reason in one sentence, drop the animation.
* **One marquee per page at most.** Horizontal scrolling text marquees ("logos endlessly scrolling", "manifesto scrolling sideways", "kinetic word strip") are appropriate at most once per page. Two or more marquees on the same page reads as lazy filler. Pick the one section where the marquee actually serves the content; the others get a different layout.
* **Sticky-Stack Pattern (when scroll-stack is used).** A "card stack on scroll" must be a real sticky stack, not a sequential reveal list. See Section 5.A below for the canonical code skeleton. Common failure: cards that do not pin at the viewport top. CSS `sticky top-0` does the pinning; do not fake it with a late ScrollTrigger `start` such as `"top center"` or `"top 80%"`.
* **GSAP Horizontal-Pan Pattern (when horizontal scroll-hijack is used).** See Section 5.B below for the canonical skeleton. Common failure: animation starts before the section is pinned, so the user sees half a slide. Fix: `start: "top top"`, pin the wrapper, scrub the inner track.

### 5.A Sticky-Stack - Canonical Skeleton

```tsx
"use client";
import { Fragment, useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { useReducedMotion } from "motion/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function StickyStack({ cards }: { cards: ReactNode[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useGSAP(
    () => {
      if (reduce) return;
      const bodies = gsap.utils.toArray<HTMLElement>(".stack-body");
      const markers = gsap.utils.toArray<HTMLElement>(".stack-marker");
      bodies.forEach((body, i) => {
        const next = markers[i]; // marker i sits in the flow directly above card i + 1 (none after the last card)
        if (!next) return;
        gsap.to(body, {
          scale: 0.92,
          opacity: 0.55,
          ease: "none",
          scrollTrigger: {
            trigger: next,       // never a sticky element: a stuck card reports its stuck rect, not its flow position
            start: "top bottom", // card i + 1 enters at the viewport bottom
            end: "top top",      // card i + 1 is fully stuck
            scrub: true,
          },
        });
      });
    },
    { scope: ref, dependencies: [reduce], revertOnUpdate: true },
  );

  return (
    <div ref={ref} className="relative">
      {cards.map((card, i) => (
        <Fragment key={i}>
          {i > 0 && <div aria-hidden className="stack-marker" />}
          {/* opaque surface (use the page background) so earlier cards never show through */}
          <div className="sticky top-0 flex min-h-svh items-center justify-center bg-zinc-50 dark:bg-zinc-950">
            <div className="stack-body">{card}</div>
          </div>
        </Fragment>
      ))}
    </div>
  );
}
```

Critical points: CSS `sticky top-0` does the pinning; GSAP only scrubs the previous card's `scale`/`opacity` while the next card slides in (`start: "top bottom"` → `end: "top top"`). The trigger is the zero-height `.stack-marker` in normal flow above each card, never a sticky card: ScrollTrigger measures with `getBoundingClientRect()`, so a card that is already stuck when its trigger is created (hydration or client-side navigation with a restored scroll position) reports its stuck position, and the ranges stay wrong until the next global `ScrollTrigger.refresh()`. Each sticky wrapper has an opaque background matching the page and is never transformed; only the inner `.stack-body` scales and fades, so earlier cards never show through. Keep each card within one viewport height (the next card covers a taller one before its bottom is seen), and if the sticky offset changes (e.g. `top-16` under a fixed nav), change `end` to match (`"top 64px"`). `revertOnUpdate: true` removes the tweens if `reduce` changes; under reduced motion the cards still stack, nothing scales or fades.

### 5.B Horizontal-Pan - Canonical Skeleton

```tsx
"use client";
import { Children, useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { useReducedMotion } from "motion/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function HorizontalPan({ children, label }: { children: ReactNode; label: string }) {
  const wrap = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useGSAP(
    () => {
      const section = wrap.current;
      const rail = track.current;
      if (reduce || !section || !rail) return;
      // visible width = the section's clientWidth (window.innerWidth includes the scrollbar and under-travels)
      const getDistance = () => Math.max(0, rail.scrollWidth - section.clientWidth);
      gsap.to(rail, {
        x: () => -getDistance(),
        ease: "none",
        scrollTrigger: {
          trigger: section,
          start: "top top",                 // pin starts when section top hits viewport top
          end: () => `+=${getDistance()}`,  // vertical scroll distance = horizontal travel
          pin: true,
          scrub: 1,
          invalidateOnRefresh: true,        // re-run getDistance on every refresh (resize, load)
        },
      });
    },
    { scope: wrap, dependencies: [reduce], revertOnUpdate: true },
  );

  return (
    <section
      ref={wrap}
      aria-label={label}
      tabIndex={0}
      // Mode is chosen in CSS, never from `reduce`: useReducedMotion() is null on the server and React keeps the server className on a hydration mismatch.
      className="relative overflow-clip motion-reduce:overflow-x-auto motion-reduce:snap-x motion-reduce:snap-mandatory"
    >
      <div ref={track} className="flex h-svh items-center">
        {Children.map(children, (child) => (
          <div className="shrink-0 snap-start">{child}</div>
        ))}
      </div>
    </section>
  );
}
```

Critical points: `start: "top top"`, `pin: true`, `end` returns the horizontal travel (`+=${getDistance()}`), `scrub: 1`, `invalidateOnRefresh: true` so the distance is recomputed on resize. Measure the travel against the section's `clientWidth`, clamped with `Math.max(0, …)`; `window.innerWidth` includes the vertical scrollbar and leaves the last slide cut off by that width. Never branch `className` on `useReducedMotion()`: it is `null` on the server and a boolean on the first client render, and React keeps the server `className` on a hydration mismatch, so reduced-motion users would get a clipped section with no pin. The mode is chosen in CSS: `motion-reduce:` turns the section into a native `overflow-x-auto snap-x snap-mandatory` scroller with `snap-start` slides, and JS only decides whether to pin. Use `overflow-clip`, not `overflow-hidden`: a hidden box is still a scroll container, so focusing a link in an off-screen slide scrolls it and throws the pan off for the rest of the visit. `tabIndex={0}` plus `aria-label` make the native scroller keyboard-scrollable; in pinned mode the focused section passes arrow keys to the page, which drives the pan. In pinned mode focus can still land on a slide that is off-screen, so keep links and buttons out of pinned slides or scroll to the slide on focus. `revertOnUpdate: true` removes the pin if `reduce` changes.

### 5.C Scroll-Reveal Stagger - Canonical Skeleton (lighter alternative)

For simple "items appear as they enter viewport" (no pinning), prefer Motion's `whileInView` over GSAP (lighter, no ScrollTrigger needed):

```tsx
"use client";
import { motion, useReducedMotion } from "motion/react";

export function RevealStagger({ items }: { items: string[] }) {
  const reduce = useReducedMotion();
  return (
    <ul className="grid gap-6">
      {items.map((item, i) => (
        <motion.li
          key={item}
          initial={reduce ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{
            duration: 0.6,
            delay: i * 0.06,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          {item}
        </motion.li>
      ))}
    </ul>
  );
}
```

Use this for: feature lists, testimonial grids, logo walls, anything that just needs "enter on scroll." Save GSAP for actual pin/scrub work.

### 5.D Forbidden Animation Patterns

* Avoid raw `scroll` listeners that set React state or read layout every frame (jank, re-renders). Use Motion `useScroll()`, ScrollTrigger, IntersectionObserver, or CSS scroll-driven animations.
* **Custom scroll progress calculations using `window.scrollY`** in React state: same reason, re-renders on every frame.
* **`requestAnimationFrame` loops that touch React state.** Use motion values (`useMotionValue` + `useTransform`) instead.
* **Layout Transitions:** Use Motion's `layout` and `layoutId` props for visible state changes (re-ordering lists, expanding modals, shared elements between routes). Do not wrap static content in `layout` props "for safety" - it costs measurement work.
* **Staggered Orchestration:** Use `staggerChildren` (Motion) or CSS cascade (`animation-delay: calc(var(--index) * 100ms)`) for reveal moments where sequence matters. For `staggerChildren`, parent (`variants`) and children must share the same Client Component tree.

---

## 6. PERFORMANCE & ACCESSIBILITY GUARDRAILS

### 6.A Hardware Acceleration
* Animate only `transform` and `opacity`; avoid animating `top`, `left`, `width`, `height`.
* Use `will-change: transform` sparingly - only on elements that will actually animate.

### 6.B Reduced Motion
* Any motion above `MOTION_INTENSITY > 3` must honor `prefers-reduced-motion`. This is an accessibility requirement.
* In Motion: wrap the app once in `<MotionConfig reducedMotion="user">`; still use `useReducedMotion()` for GSAP/Three.js leaves and infinite loops, and degrade to static.
* In CSS: gate animations behind `@media (prefers-reduced-motion: no-preference)` or provide an override block under `@media (prefers-reduced-motion: reduce)` that disables.
* Infinite loops, parallax, scroll-hijack, and magnetic physics collapse to static / instant under reduced motion.

### 6.C Core Web Vitals Targets
* **LCP** < 2.5s. Preload only the single LCP hero image: `next/image` `preload` on Next 16+ (`priority` is inert there; use it only on ≤15), otherwise `fetchPriority="high"` (`<img fetchpriority="high" loading="eager">` in plain HTML); never lazy-load it.
* **INP** < 200ms. Heavy work off main thread.
* **CLS** < 0.1. Reserve space for images, fonts, embeds.
* Run Lighthouse if available (lab: LCP/CLS; TBT is only a proxy for INP).

### 6.D DOM Cost
* Apply grain / noise filters only to fixed, `pointer-events-none` pseudo-elements (e.g., `fixed inset-0 z-[60] pointer-events-none`), never to scrolling containers: continuous GPU repaints destroy mobile FPS.
* Be aware of bundle size. Motion is not tiny. Three.js is large. Lazy-load anything that's not above-the-fold.

### 6.E Z-Index Restraint
Do not sprinkle arbitrary `z-50` or `z-10`. Use z-index strictly for systemic layer contexts (sticky navbars, modals, overlays, grain). Document the z-index scale in a project constants file.

### 6.F WCAG 2.2 items that bite landing pages
* **Target size (2.5.8):** interactive targets ≥ 24×24 CSS px (icon buttons, carousel dots, footer socials).
* **Focus not obscured (2.4.11):** a sticky nav must not cover the focused element. Add `scroll-padding-top` equal to the nav height.
* **Visible focus:** never remove `outline` without a `:focus-visible` replacement that has 3:1 contrast.
* Honour `prefers-contrast: more` where glass or low-contrast styling is used.

---

## 7. DIAL DEFINITIONS (Technical Reference)

### DESIGN_VARIANCE (Level 1-10)
* **1-3 (Predictable):** Symmetrical CSS Grid (12-col, equal fr-units), equal paddings, centered alignment.
* **4-7 (Offset):** `margin-top: -2rem` overlaps, varied image aspect ratios (4:3 next to 16:9), left-aligned headers over center-aligned data.
* **8-10 (Asymmetric):** Masonry layouts, CSS Grid with fractional units (`grid-template-columns: 2fr 1fr 1fr`), massive empty zones (`padding-left: 20vw`).
* **Mobile override:** for levels 4-10, asymmetric layouts above `md:` collapse to strict single-column (`w-full`, `px-4`, `py-8`) on viewports `< 768px`.

### MOTION_INTENSITY (Level 1-10)
* **1-3 (Static):** No automatic animations. CSS `:hover` and `:active` states only.
* **4-7 (Fluid CSS):** `transition-property: transform, opacity; transition-duration: .3s; transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1)` (Tailwind: `transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]`). `animation-delay` cascades for load-ins. Focus on `transform` and `opacity`.
* **8-10 (Advanced Choreography):** Complex scroll-triggered reveals, parallax, scroll-driven animation (CSS `animation-timeline` or GSAP ScrollTrigger). Use Motion hooks. Avoid raw scroll listeners (see 5.D).

### VISUAL_DENSITY (Level 1-10)
* **1-3 (Art Gallery):** Lots of white space. Huge section gaps (`py-32` to `py-48`). Expensive, clean.
* **4-7 (Daily App):** Standard web app spacing (`py-16` to `py-24`).
* **8-10 (Cockpit):** Tight paddings. No card boxes; 1px lines separate data. Use `tabular-nums` (`font-variant-numeric: tabular-nums`) for numbers in columns; mono only if the aesthetic calls for it.

---

## 8. DARK MODE PROTOCOL

Default to both modes via tokens and `prefers-color-scheme`. A single brand-defined mode is fine when the design read says so (state it in the Design Read); then set `color-scheme` to that mode so native controls match.

### 8.A Token Strategy (pick one, stick to it)
* **Tailwind `dark:` variant** (default for utility-first projects): every color utility paired with its dark variant (`bg-zinc-50 dark:bg-zinc-950`, `text-gray-900 dark:text-gray-100`).
* **CSS variables** (for shadcn/ui, Radix Themes, or component libraries with theming): define semantic tokens (`--surface`, `--surface-elevated`, `--text-primary`, `--accent`) and swap values under `[data-theme="dark"]` or `@media (prefers-color-scheme: dark)`.
* Tailwind v4 manual toggle: add `@custom-variant dark (&:where(.dark, .dark *));` to the CSS entry (with next-themes, set `attribute="class"`, or write the variant for `[data-theme=dark]`); otherwise `dark:` only follows the OS setting.
* Set `color-scheme: light dark` on `:root` (or `<meta name="color-scheme">`) so form controls and scrollbars follow the theme. For plain-CSS tokens, `light-dark(<light>, <dark>)` (Baseline 2024) avoids duplicate media blocks.

### 8.B Do Not Prescribe Specific Colors Here
The brief and brand decide. This skill enforces only:
* **Contrast** - WCAG AA minimum for all text (4.5:1 / 3:1 large); aim higher for long-form body.
* **Hierarchy parity** - visual hierarchy that works in light must work in dark. If a CTA pops in light, it pops in dark.
* **Brand fidelity** - primary brand color stays recognisable. Don't desaturate the brand into a dark mode.

### 8.C Default Mode
Respect `prefers-color-scheme` unless the brand insists. Add a manual toggle if either mode would lose key brand expression.

### 8.D Test in Both Modes Before Finishing
Open the page in both modes during development. Do not ship a page you've only seen in one mode.

---

## 9. AI TELLS (Forbidden Patterns)

Avoid these signatures unless the brief explicitly asks for them.

### 9.A Visual & CSS
* **No neon / outer glows** by default. Use inner borders or subtle tinted shadows.
* **No pure black (`#000000`) and no pure `#ffffff`.** Use off-black, zinc-950, or charcoal; use an off-white.
* **No oversaturated accents.** Desaturate to blend with neutrals.
* **No excessive gradient text** for large headers.
* **No custom mouse cursors.** Outdated, accessibility-hostile, perf-hostile.

### 9.B Typography
* **No oversized H1s** that just scream. Control hierarchy with weight + color, not raw scale.

### 9.C Layout & Spacing
* **No 3-column equal feature cards.** The generic "three identical cards horizontally" feature row is a tell. Use 2-column zig-zag, asymmetric grid, scroll-pinned, or horizontal-scroll alternative.

### 9.D Content & Data ("Jane Doe" Effect)
* **No generic names.** "John Doe", "Sarah Chan", "Jack Su" → use creative, realistic, locale-appropriate names.
* **No generic avatars.** No SVG "egg" or Lucide user icons → use believable photo placeholders or specific styling.
* **No fake-perfect numbers** (`99.99%`, `10x`, `1234567`). Mock numbers are fine when labelled as mock (Section 4.9); make them plausible, not decorative. Use `555-01xx` style fictional phone numbers.
* **No startup-slop brand names.** "Acme", "Nexus", "SmartFlow", "Cloudly" → invent contextual, premium names that sound real.
* **No filler verbs.** "Elevate", "Seamless", "Unleash", "Next-Gen", "Revolutionize" → concrete verbs only.

### 9.E External Resources & Components
* Icons / SVG / screenshots: see 3.C and 4.8.
* `source.unsplash.com` random URLs were shut down; do not use them. Use `https://picsum.photos/seed/{descriptive-string}/{w}/{h}`, generated photo placeholders, or actual assets.
* **shadcn/ui customization:** allowed, but never in default state. Customize radii, colors, shadows, typography to the project aesthetic.

### 9.F Production-Test Tells

These patterns came out of real LLM-generated landing-page tests. They are the signatures the model defaults to when it tries to "look designed." Treat them as hard bans unless the brief explicitly calls for one.

**Hero & top-of-page**
* **No version labels in the hero.** `V0.6`, `v2.0`, `BETA`, `INVITE-ONLY PREVIEW`, `EARLY ACCESS`, `ALPHA` - banned as default eyebrows. Only acceptable when the brief is explicitly about a product launch / preview status.
* **No "Brand · No. 01"-style sub-eyebrows.** "Marrow · No. 01 · The 6-quart" type micro-meta lines. Skip them.

**Section numbering & micro-labels**
* **No section-number eyebrows.** `00 / INDEX`, `001 · Capabilities`, `002 · Featured commission`, `06 · how it works`, `05 · The honest table` - banned. Eyebrows should name the topic in plain language, not enumerate.
* **No `01 / 4`-style pagination on images or bento tiles.** If the user can count, they don't need the label.
* **No "Index of Work, 2018 - 2026"-style range labels** as eyebrows. Just say what the section is.

**Separators**
* **The middle-dot (`·`) is rationed.** Maximum 1 per line in metadata strips. Do not use it as the default separator for everything ("foo · bar · baz · qux · quux"). If you need a separator family, prefer line breaks, hairlines, or columns.

**Typography flourishes**
* **No `<br>`-broken-and-italicized headlines** as a default "design move." "for thirty\<br\>*years.*" type splits. Headlines should read naturally first, get clever only when the brief demands it.
* **No vertical rotated text** ("INDEX OF WORK, 2018 - 2026" rotated 90°). Agency-portfolio cliché. Use it only when the brief is explicitly agency / Awwwards / experimental and it serves a real composition purpose.
* **No crosshair / hairline grid lines as decoration.** Vertical and horizontal lines drawn just to make the page "feel designed" are banned. Use them only when they organize real content.

**Fake product previews**
* **No div-based fake product UI in the hero** (fake task list, fake terminal, fake dashboard built from styled divs). Use a real screenshot, a generated image, a real component preview, or none at all.

**Marketing-copy Tells**
* **No "Quietly in use at" / "Quietly trusted by"** social-proof headers. Use natural language: "Trusted by", "Used at", "Customers include", or skip the heading entirely if the logos speak.
* **No "From the field" / "Field notes" / "Currently on the bench" / "On our desks" / "Loose plates" style poetic labels** on quote, blog, or sidebar sections. Reads as performative-craftsman. Use plain functional labels ("Testimonials", "Latest writing", "Now working on") or skip the label.
* **No "We respect the French ones"-style** mock-humble industry-references in body copy. Cute and AI-y.
* **No micro-meta-sentences under eyebrows.** Sentences like *"Each of these is a feature we ship today, not a roadmap promise. The list will stay short on purpose."* sitting under a section heading are clutter. Eyebrow + Headline + Body is enough.
* **No generic step labels.** "Stage 1 / Stage 2 / Stage 3", "Step 1 / Step 2 / Step 3", "Phase 01 / Phase 02 / Phase 03", "Pass One / Pass Two / Pass Three". The actual step content is the label. If you must show progression, use the verb-noun directly ("Install", "Configure", "Ship") not "Stage 1: Install".

**Pills, labels and version stamps**
* **No pills/labels/tags overlaid on images.** No `<span>` overlays on photos with tags like `Brand · 02`, `PLATE · BRAND`, `Field notes - journal`. Either let the image speak alone, or add a caption directly below (outside the image).
* **No photo-credit captions as decoration.** Strings like `Field study no. 12 · Ines Caetano`, `Plate 03 · House archive`, `Frame XII · 35mm` under stock/picsum images are pretentious. Photo credit is allowed only when there is a real photographer being credited for a real photo (with permission). Otherwise: skip the caption or use a one-line functional caption ("The 6-quart, in Sage.").
* **No version footers on marketing pages or inside fake screenshots.** Footer strings like `v1.4.2`, `Build 0048`, `last sync 4s ago · main` are CLI / devtool fixtures, not landing-page content.
* **No "Reservation 412 of 800"-style live-stock counters** as decoration. Only if the brief is explicitly a limited-run waitlist with real data.

**Decoration text strips**
* **No decoration text strip at hero bottom.** Patterns like `BRAND. MOTION. SPATIAL.`, `TYPE / FORM / MOTION`, `DESIGN · BUILD · SHIP`, `ESTD. 2018 · LISBON · BRAND. MOTION. SPATIAL.` as a small mono-caps strip across the bottom of the hero are an agency-portfolio cliché. Only acceptable when the strip carries real, navigable links (sticky bottom nav) or real status info (cookie banner, build info on a docs site).

**Lists, dividers and scoring**
* **No `border-t` + `border-b` on every row of a long list / spec table.** Pick one (bottom-border between rows OR top-border above the group) and use it sparingly. A 10-row spec table with hairlines under each row is the laziest layout - see Section 4.9 for alternative UI components.
* **No scoring/progress bars with filled background tracks** as comparison visuals. If you need to show "X out of Y" comparisons, prefer a number + small icon, or a tiny inline bar without a background track. Big filled `bg-zinc-200` tracks with a partial fill on top are dashboard-UI clutter on a landing page.

**Locale, time, scroll cues**
* **Locale / city-name / time / weather strips are banned for 99% of briefs.** "Lisbon, working with founders" in the hero, "1200-690 Lisbon, Portugal" in the footer, "Lisbon 14:23 · 18°C" in the nav. These are agency-portfolio decoration tells. Allowed only when the brief explicitly describes a globally-distributed studio with timezone-relevant work, a travel-focused brand, or a real-world physical venue. A single contact-address mention in the footer is fine; an atmospheric locale strip is not.
* **Scroll cues are banned.** `Scroll`, `↓ scroll`, `Scroll to explore`, `Scroll to walk through it`, animated mouse-wheel icons. If the user has not scrolled yet, they are looking at the hero. They know what scroll is. The bottom of the viewport does not need a label.
* **No decorative status dots by default.** A colored dot before nav items, before list rows, before badges, before status labels is a tell. Only acceptable when conveying real semantic state (a live indicator on actual server status, a live availability flag) and limited to one per page section.

### 9.G Em-dash / en-dash ban

No `—` or `–` in any visible text (headlines, labels, body, quotes, attribution, captions, buttons, alt). It is the most recognisable LLM prose habit, and "use sparingly" did not work, so the rule is zero. Restructure with a period, comma, colon or parentheses; ranges and attribution use `-`.

**Japanese pages:** the ban targets Latin `—` / `–` flourishes. `〜` for ranges is normal. `――` is not banned outright in Japanese body prose, but keep it rare.

---

## 10. REFERENCE VOCABULARY (Pattern Names the Agent Should Know)

This is a vocabulary, not a library. Implement from the design read; the skeletons in Section 5 cover the pin/scrub cases.

### Hero Paradigms
* **Asymmetric Split Hero** - Text on one side, asset on the other, generous white space.
* **Editorial Manifesto Hero** - Large type, no asset, almost-poster.
* **Video / Media Mask Hero** - Type cut out as mask over video background.
* **Kinetic-Type Hero** - Animated typography as the primary visual.
* **Curtain-Reveal Hero** - Hero parts on scroll like a curtain.
* **Scroll-Pinned Hero** - Hero stays pinned while content scrolls behind.

### Layout & Grids
* **Bento Grid** - Asymmetric tile grouping (Apple Control Center).
* **Masonry Layout** - Staggered grid, no fixed row height.
* **Chroma Grid** - Borders / tiles with subtle animating gradients.
* **Split-Screen Scroll** - Two halves sliding in opposite directions.
* **Sticky-Stack Sections** - Sections that pin and stack on scroll.

### Scroll Animations
* **Sticky Scroll Stack** - Cards stick and physically stack.
* **Horizontal Scroll Hijack** - Vertical scroll → horizontal pan.
* **Locomotive / Sequence Scroll** - Video / 3D sequence tied to scrollbar.
* **Zoom Parallax** - Central background image zooming on scroll.
* **Scroll Progress Path** - SVG line drawing along scroll.
* **Liquid Swipe Transition** - Page transition like viscous liquid.

### Other named effects
Other named effects (magnetic, spotlight border, tilt, text scramble, image trail, etc.) are allowed only under Section 5's motivation test.

### Animation Library Choice
* **Motion (`motion/react`)** - default for UI / Bento / state-change motion.
* **GSAP + ScrollTrigger** - for full-page scrolltelling and scroll hijacks. Isolate in dedicated leaf components. Use `useGSAP(() => {...}, { scope: ref, dependencies: [reduce], revertOnUpdate: true })` from `@gsap/react` instead of `useEffect` + `gsap.context`. All GSAP plugins (SplitText, ScrollSmoother, MorphSVG) are free since 2025.
* **Three.js / WebGL** - for canvas backgrounds and 3D scenes. Same isolation rule.
* **Do not animate the same element (or the same property) with two engines.** GSAP and Motion both write inline `transform`; whichever runs last wins and the other jitters. Keep each engine's targets in its own leaf component.

---

## 11. REDESIGN PROTOCOL

This skill handles **greenfield builds AND redesigns**. Classify the mode before anything else.

### 11.A Detect the Mode (first action)
* **Greenfield** - no existing site, or full overhaul approved. Dial baseline from Section 1.
* **Redesign - Preserve** - modernise without breaking the brand. Audit first, extract brand tokens, evolve gradually.
* **Redesign - Overhaul** - new visual language on top of existing content. Treat as greenfield for visuals; preserve content and IA.

If ambiguous, ask **once**: *"Should this redesign preserve the existing brand, or are we starting visually from scratch?"*

### 11.B Audit Before Touching
Document the current state before proposing changes:
* **Brand tokens** - primary / accent colors, type stack, logo treatment, radii.
* **Information architecture** - page tree, primary nav, key conversion paths.
* **Content blocks** - what exists, what's doing work, what's filler.
* **Patterns to preserve** - signature interactions, recognisable hero, copy voice.
* **Patterns to retire** - AI-slop tells, broken layouts, dead links, generic stock imagery, perf traps.
* **Dial reading of the existing site** - infer current `DESIGN_VARIANCE` / `MOTION_INTENSITY` / `VISUAL_DENSITY`. That's your starting point, not the baseline.
* **SEO baseline** - current ranking pages, meta titles, structured data, OG cards. SEO migration is the main redesign risk.

### 11.C Preservation Rules
* **Do not change information architecture** unless asked. Keep page slugs, anchor IDs, primary nav labels stable for SEO and muscle memory.
* **Extract brand colors before applying Section 4.2.** A brand that is already purple stays purple - apply the lila rule's override.
* **Preserve copy voice** unless asked for a rewrite. Visual modernisation ≠ content rewrite.
* **Honor existing accessibility wins.** Do not regress focus states, alt text, keyboard nav, contrast.
* **Respect existing analytics events.** Do not rename buttons, form fields, section IDs that downstream tracking depends on.

### 11.D Modernisation Levers (priority order)
Apply in order - stop when the brief is satisfied:
1. **Typography refresh** - biggest visual lift per unit of risk.
2. **Spacing & rhythm** - increase section padding, fix vertical rhythm.
3. **Color recalibration** - desaturate, unify neutrals, keep brand accent.
4. **Motion layer** - add `MOTION_INTENSITY`-appropriate micro-interactions to existing components.
5. **Hero & key-section recomposition** - restructure top-of-funnel using Section 10 vocabulary.
6. **Full block replacement** - only when the existing block is unsalvageable.

### 11.E Decision Tree: Targeted Evolution vs Full Redesign
* IA, content, and SEO sound → **targeted evolution** (Levers 1-4). ~70% of value at ~40% of risk.
* Visual debt is structural (broken IA, no design system, broken mobile) → **full redesign** with strict content preservation.
* Brand itself is changing → **greenfield**.

### 11.F What Never Changes Silently
Never modify without explicit user approval:
* URL structure / route slugs.
* Primary nav labels.
* Form field names or order (breaks analytics + autofill).
* Brand logo or wordmark.
* Existing legal / consent / cookie copy.

---

## 12. OUT OF SCOPE

This skill is NOT for:
* Dashboards / dense product UI / admin panels (use Fluent, Carbon, Atlassian, or Polaris from Section 2.A).
* Data tables (use TanStack Table or AG Grid).
* Multi-step forms / wizards (use Form-specific patterns; this skill won't make them better).
* Code editors (use Monaco / CodeMirror with their official skinning).
* Native mobile (use Apple HIG / Material directly).
* Realtime collab UIs (presence, cursors, OT-aware - different problem class).

If the brief is one of the above, say so explicitly, point to the right tool, and only apply this skill's marketing-page / about-page / landing-page parts to the surfaces where they apply.

---

## 13. FINAL PRE-FLIGHT CHECK

Run this matrix before outputting code. This is the last filter. Run every box; a box you cannot honestly tick means the page is not done.

- [ ] **Brief inference** declared (Section 0.B one-liner)?
- [ ] **Dial values** explicit and reasoned from the brief, not silently using baseline?
- [ ] **Design system** chosen from Section 2 if applicable, or aesthetic labeled honestly?
- [ ] **Redesign mode** detected and audit performed (if applicable, Section 11)?
- [ ] **Zero em-dashes (`—`)** anywhere on the page: headlines, eyebrows, pills, body, quotes, attribution, captions, buttons, alt text (Section 9.G)?
- [ ] **Page Theme Lock**: ONE theme (light, dark, or auto) for the whole page. No section flips to inverted mode mid-page (Section 4.11)?
- [ ] **Color Consistency Lock**: one accent color used identically across all sections (Section 4.2)?
- [ ] **Shape Consistency Lock**: one corner-radius system applied consistently (Section 4.4)?
- [ ] **Button Contrast Check**: every CTA text is readable against its background (no white-on-white, WCAG AA 4.5:1)?
- [ ] **CTA Button Wrap**: no CTA label wraps to 2+ lines at desktop?
- [ ] **Form Contrast Check**: form inputs, placeholders, focus rings, labels all pass WCAG AA against the section background?
- [ ] **Serif discipline**: if a serif is used, it is NOT Fraunces or Instrument_Serif (or it is, with explicit brand justification)?
- [ ] **Premium-consumer palette check**: if the brief is premium-consumer (cookware / wellness / artisan / luxury), the palette is NOT the AI-default beige+brass+oxblood+espresso family?
- [ ] **Italic descender clearance**: every italic word with `y g j p q` has `leading-[1.1]` min + `pb-1` reserve?
- [ ] **Hero fits the viewport**: headline ≤ 2 lines, subtext ≤ 20 words AND ≤ 4 lines, CTA visible without scroll, font scale planned around image?
- [ ] **Hero top padding**: max `pt-24` at desktop, hero content does not float halfway down the viewport?
- [ ] **Hero stack discipline**: max 4 text elements in hero (eyebrow OR brand strip, headline, subtext, CTAs)? No tiny tagline below CTAs, no trust micro-strip in hero?
- [ ] **Eyebrow count (mechanical)**: count instances of `uppercase tracking` micro-labels above section headlines across all components. Count ≤ ceil(sectionCount / 3)? Hero counts as 1.
- [ ] **Split-Header Ban**: no "left big headline + right small explainer paragraph" pattern as a section header (vertical stack instead)?
- [ ] **Zigzag Alternation Cap**: no 3+ consecutive sections with the same image+text-split layout?
- [ ] **No Duplicate CTA Intent**: no two CTAs with the same intent ("Get in touch" + "Let's talk" both on page = Fail)?
- [ ] **Logo wall** sits under the hero, is logos only (no industry / category labels), and shows real logos only for customers the brief confirms; otherwise invented marks, not plain text wordmarks?
- [ ] **Bento** has rhythm (not one-sided repetition), an exact cell count (N items, N cells, no empty cell in the middle or at the end), and at least 2-3 cells with real visual variation (image, gradient, pattern), not all white-on-white text cards?
- [ ] **Copy Self-Audit**: every visible string re-read, no grammatically-broken or AI-hallucinated phrases ("free on its past" type) shipped?
- [ ] **Motion motivated**: every animation can be justified in one sentence (hierarchy / storytelling / feedback / state transition), no GSAP-for-show?
- [ ] **One marquee per page at most**?
- [ ] **Navigation on ONE line** at desktop, height ≤ 80px?
- [ ] **Section-Layout-Repetition** check: no two sections share the same layout family (at least 4 different families across 8 sections)?
- [ ] **Long lists use the right UI component** (not default `<ul>` with `divide-y` for > 5 items - see Section 4.9 alternatives)?
- [ ] **Real images used** (brand assets or generated images first, then Picsum-seed placeholders, then explicit placeholder slots) - NO div-based fake screenshots, NO hand-rolled decorative SVGs, NO pure-text minimalism unless the Design Read declares a type-only page (manifesto / editorial poster)?
- [ ] **No Section 9.A-E tells** (neon / outer glows, pure black or pure white, oversaturated accents, gradient-text headers, custom cursors, oversized H1s, three equal feature cards, placeholder names and brands like Jane Doe / Acme, generic avatars, fake-perfect numbers, filler verbs, `source.unsplash.com` URLs, default-state shadcn/ui)?
- [ ] **No Section 9.F tells** (image-overlay pills, decorative photo credits, version stamps, micro-meta sentences, hero-bottom text strips, filled-track score bars, locale strips, scroll cues, section-number eyebrows, decorative dots, per-row borders)?
- [ ] **Content density** sane: no 20-row data tables, no fake-precise specs without justification, ≤ 25-word sub-paragraphs by default?
- [ ] **Quotes ≤ 3 lines** of body, attribution clean (no em-dash)?
- [ ] **Motion claimed = motion shown**: if `MOTION_INTENSITY > 4`, page actually animates, not just claimed?
- [ ] **Sticky-stack / horizontal-pan** implemented per Section 5.A / 5.B canonical skeleton (stack: CSS `sticky top-0` on an opaque, never-transformed wrapper, scale/opacity scrubbed on the inner `.stack-body` from a zero-height `.stack-marker` trigger; pan: `start: "top top"`, `pin: true`, `invalidateOnRefresh`, `overflow-clip`, reduced-motion mode chosen in CSS with `motion-reduce:`, never by branching `className` on `useReducedMotion()`; both: `revertOnUpdate: true`)?
- [ ] **No raw `scroll` listeners** that set React state or read layout every frame - using Motion `useScroll()` / ScrollTrigger / IntersectionObserver / CSS scroll-driven animations?
- [ ] **Reduced motion** wrapped for everything `MOTION_INTENSITY > 3`?
- [ ] **Dark mode** tokens defined and tested in both modes (or one brand-defined mode declared in the Design Read, with `color-scheme` set)?
- [ ] **Mobile collapse** explicit (`w-full`, `px-4`, `max-w-7xl mx-auto`) for high-variance layouts?
- [ ] **Viewport stability**: `min-h-svh`/`min-h-dvh`, not `h-screen`?
- [ ] **Effect cleanup**: GSAP work runs in `useGSAP` with a `scope` (or a reverted `gsap.context`), and every other effect cleans up?
- [ ] **Empty / loading / error** states provided?
- [ ] **Icons** from an allowed library only (Phosphor / HugeIcons / Radix / Tabler, or Lucide when the project or shadcn/ui already uses it, Section 3.C), no hand-rolled SVG paths?
- [ ] **Motion** isolated in client-leaf components with `'use client'` at the top (or `motion/react-client` for simple enter animations in a Server Component file, Section 3.A)?
- [ ] **Core Web Vitals** plausibly hit (LCP < 2.5s, INP < 200ms, CLS < 0.1)?
- [ ] **One design system** per project (no Material + shadcn mixed)?

---

# APPENDICES - Real Source-Backed Reference Material

The sections below are vendored reference content. They give the agent real install commands, real canonical doc links, and real working starter snippets for each design system named in Section 2. Use them to ground decisions in production reality, not training-data fiction.

## Appendix A - Install Commands per Design System

```bash
# Material Web (Material 3)
npm install @material/web

# Fluent UI React (v9)
npm install @fluentui/react-components

# Fluent UI Web Components (framework-free)
npm install @fluentui/web-components @fluentui/tokens

# IBM Carbon
npm install @carbon/react @carbon/styles

# Radix Themes
npm install @radix-ui/themes

# shadcn/ui (open code, owned components)
npx shadcn@latest init
npx shadcn@latest add button card badge separator input

# Primer CSS (GitHub product/devtool UI)
npm install --save @primer/css

# Primer Brand (GitHub marketing UI)
npm install @primer/react-brand

# GOV.UK Frontend
npm install govuk-frontend

# USWDS (US Web Design System)
npm install @uswds/uswds

# Atlassian Design System (Atlaskit)
yarn add @atlaskit/css-reset @atlaskit/tokens @atlaskit/button @atlaskit/badge @atlaskit/section-message @atlaskit/card

# Bootstrap 5.3
npm install bootstrap

# Shopify Polaris Web Components (Shopify apps only)
# Add this to your app HTML head:
#   <meta name="shopify-api-key" content="%SHOPIFY_API_KEY%" />
#   <script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>
```

## Appendix B - Canonical Sources (read these before reinventing)

One docs-home link per system.

- Material Web: https://m3.material.io/develop/web
- Fluent UI: https://fluent2.microsoft.design/get-started/develop
- Carbon: https://carbondesignsystem.com/
- Shopify Polaris (web components): https://shopify.dev/docs/api/app-home/web-components
- Atlassian: https://atlassian.design/get-started/develop
- Primer: https://primer.style/
- GOV.UK: https://design-system.service.gov.uk/
- USWDS: https://designsystem.digital.gov/documentation/developers/
- Bootstrap: https://getbootstrap.com/docs/5.3/getting-started/introduction/
- Tailwind: https://tailwindcss.com/docs/dark-mode
- Radix Themes: https://www.radix-ui.com/themes/docs/components/theme
- shadcn/ui: https://ui.shadcn.com/docs
- MDN, scroll-driven animations: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations

### Apple Liquid Glass (Apple platforms only)
- https://developer.apple.com/design/human-interface-guidelines/materials
- https://developer.apple.com/documentation/TechnologyOverviews/liquid-glass
- https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass
- https://developer.apple.com/documentation/SwiftUI/Material

---

## Appendix C - Apple Liquid Glass: Honest Web Approximation

Do **not** treat random CSS snippets as official Apple Liquid Glass.

### What is official
Apple documents Liquid Glass inside Apple's Human Interface Guidelines and Developer Documentation for **Apple platforms**. It is a dynamic material used across Apple platform UI. Apple's native implementation belongs to Apple platform APIs and system components, **not a public web CSS package**.

Relevant official docs:
- Apple Human Interface Guidelines → Materials
- Apple Developer Documentation → Liquid Glass
- Apple Developer Documentation → Adopting Liquid Glass
- SwiftUI → Material

### What is NOT official
There is no `liquid-glass.css` from Apple for normal websites.

A web approximation can use:
- `backdrop-filter`
- transparent backgrounds
- layered borders
- highlight overlays
- gradients
- motion
- strong contrast fallbacks

But that is **web glassmorphism / frosted-glass approximation**, not official Apple Liquid Glass. Label it as such in comments.

### Safer web approximation skeleton

```css
.liquid-glass-web-approx {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border-radius: 999px;
  border: 1px solid rgb(255 255 255 / .32);
  background:
    linear-gradient(135deg, rgb(255 255 255 / .30), rgb(255 255 255 / .08)),
    rgb(255 255 255 / .12);
  backdrop-filter: blur(24px) saturate(180%) contrast(1.05);
  -webkit-backdrop-filter: blur(24px) saturate(180%) contrast(1.05);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / .48),
    inset 0 -1px 0 rgb(255 255 255 / .12),
    0 18px 60px rgb(0 0 0 / .18);
}

.liquid-glass-web-approx::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background:
    radial-gradient(circle at 20% 0%, rgb(255 255 255 / .55), transparent 34%),
    linear-gradient(90deg, rgb(255 255 255 / .18), transparent 42%, rgb(255 255 255 / .14));
  pointer-events: none;
}

.liquid-glass-web-approx::after {
  content: "";
  position: absolute;
  inset: 1px;
  border-radius: inherit;
  border: 1px solid rgb(255 255 255 / .14);
  pointer-events: none;
}

@media (prefers-color-scheme: dark) {
  .liquid-glass-web-approx {
    border-color: rgb(255 255 255 / .18);
    background:
      linear-gradient(135deg, rgb(255 255 255 / .16), rgb(255 255 255 / .04)),
      rgb(15 23 42 / .42);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / .22),
      0 18px 60px rgb(0 0 0 / .42);
  }
}

@media (prefers-reduced-transparency: reduce) {
  .liquid-glass-web-approx {
    background: rgb(250 250 250 / .96);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

@media (prefers-reduced-transparency: reduce) and (prefers-color-scheme: dark) {
  .liquid-glass-web-approx { background: rgb(15 23 42 / .96); }
}
```

**Important:** `prefers-reduced-transparency` is not Baseline (Chromium only at time of writing), so treat it as a bonus. The base design must already pass contrast with blur **off** (test with `backdrop-filter: none`).

---

## Attribution

Adapted from **taste-skill** (https://github.com/Leonxlnx/taste-skill), MIT License, Copyright (c) 2026 Leonxlnx. Repository-specific frontmatter and integration notes added for my-claude-base.
