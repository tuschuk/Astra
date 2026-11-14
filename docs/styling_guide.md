# Styling Guide

Design system extracted from the **Max Method** app (`c:\Users\trist\MaxMethodApp\client\max-method`),
to be reused as the visual language for Astra. Source of truth in that codebase:
`src/index.css` (base), `src/App.css` (the design system + components, tokens at the top),
`src/pages/account/ExerciseLibrary.css` (category colors), `index.html` (font loading).

**The look in one sentence:** near-black page with faint maroon gradient bands and a subtle red
grid texture, white text, a hot red accent with neon glows, green reserved exclusively for
"completed", marker-style graffiti headings over clean geometric UI type.

---

## 1. Color palette

### Core tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0d0d0d` | Page background base (near-black) |
| `--bg-maroon` | `#2a0a0e` | Dark maroon — gradient bands in the page background |
| `--nav-bg` | `#000000` | Navigation sidebar — pure black |
| `--text` | `#ffffff` | Primary text |
| `--accent` | `#cc0404` | Brand red — CTAs, active nav, highlights, identity labels |
| `--accent-dim` | `rgba(204, 4, 4, 0.12)` | Red-tinted fill for selected/active states |
| `--accent-border` | `rgba(204, 4, 4, 0.40)` | Red border on active/hovered elements |
| `--accent-glow` | `0 0 16px rgba(204,4,4,0.40), 0 0 32px rgba(204,4,4,0.18)` | Large neon glow (button hover) |
| `--accent-glow-sm` | `0 0 8px rgba(204,4,4,0.35)` | Small neon glow (resting CTAs, badges) |

Accent hover shades (brighter reds used on solid-red button `:hover`): `#e00505` and `#e01010`.

### Completion green (strict convention)

Green means **one thing only: "this is done."** Completed day cells, checked sets, full progress
bars, COMPLETED labels. Identity/branding contexts always stay red, even on done items.

| Token | Value |
|---|---|
| `--accent-green` | `#2dba7e` |
| `--accent-green-dim` | `rgba(45, 186, 126, 0.12)` |
| `--accent-green-border` | `rgba(45, 186, 126, 0.40)` |
| `--accent-green-glow-sm` | `0 0 8px rgba(45, 186, 126, 0.35)` |
| darker hover (untokened) | `#28a870` |

Layered green tints (row done-state fills, banners) use bespoke alphas of `rgba(45, 186, 126, X)`
in the 0.06–0.45 range.

### Surfaces, borders, muted text

Cards and surfaces are **translucent white lifts** over the dark base, not solid grays — this lets
the maroon gradient show through and gives automatic elevation tiers.

| Token | Value | Use |
|---|---|---|
| `--surface` | `rgba(255, 255, 255, 0.04)` | Card / section background (tier 1) |
| `--surface-hover` | `rgba(255, 255, 255, 0.07)` | Hovered surface (tier 2) |
| `--surface-deep` | `rgba(255, 255, 255, 0.10)` | Nested/raised surface (tier 3) |
| `--card-bg`, `--input-bg` | `rgba(255, 255, 255, 0.10)` | Aliases of `--surface-deep` |
| `--border` | `rgba(255, 255, 255, 0.10)` | Default hairline border |
| `--border-strong` | `rgba(255, 255, 255, 0.18)` | Inputs, interactive borders |
| `--muted` | `rgba(255, 255, 255, 0.72)` | Secondary text (~10:1 on `--bg`, AAA) |
| `--muted-decor` | `rgba(255, 255, 255, 0.50)` | Decorative text only (~5.3:1, AA) |

Inputs sit on translucent **black**, not white: `rgba(0, 0, 0, 0.28)` with `--border-strong`.
Table headers / chips use `rgba(0, 0, 0, 0.15–0.38)` tints.

### Semantic / status colors

| Purpose | Value |
|---|---|
| Error text | `#ff6b6b` |
| Warning | `#ff5555` |
| Info / caution badge | `#facc15` on `rgba(250, 204, 21, 0.15)` fill |
| PR badge | gradient `linear-gradient(135deg, #f59e0b, #f97316)`, white text, pill radius |
| Star / gold highlight | `#ffd700` |

(In Max Method these aren't tokens; if Astra adopts them, promote to `--error`, `--warn`, `--info`.)

### Category colors (Exercise Library)

Muscle-group color coding, each with a 0.15-alpha dim fill for chips/tabs:

| Category | Color | Dim fill |
|---|---|---|
| Upper body | `#60a5fa` | `rgba(96, 165, 250, 0.15)` |
| Lower body | `#4ade80` | `rgba(74, 222, 128, 0.15)` |
| Core | `#c084fc` | `rgba(192, 132, 252, 0.15)` |
| Cardio | `#fb923c` | `rgba(251, 146, 60, 0.15)` |

---

## 2. Page background (signature texture)

The page background lives on `body`, viewport-fixed, three layers: a faint red grid (two 1px line
layers on a 60px cell) over a vertical black→maroon→black band gradient.

```css
body {
  background-color: #0d0d0d;
  background-image:
    linear-gradient(rgba(230, 57, 70, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(230, 57, 70, 0.04) 1px, transparent 1px),
    linear-gradient(180deg,
      #0d0d0d 0%, #2a0a0e 25%, #0d0d0d 50%, #2a0a0e 75%, #0d0d0d 100%);
  background-size: 60px 60px, 60px 60px, 100% 100vh;
  background-repeat: repeat, repeat, no-repeat;
  background-attachment: fixed;
}
```

App containers above it must be `background: transparent` so the gradient shows through.
`color-scheme: dark` is set on `:root` — dark-only, no light theme.

---

## 3. Typography

Three-font system, loaded from Google Fonts:

```html
<link href="https://fonts.googleapis.com/css2?family=Permanent+Marker&family=Space+Grotesk:wght@300;400;500;600;700&family=Manrope:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
```

| Token | Font | Role |
|---|---|---|
| `--font-heading` | `'Permanent Marker', cursive` | h1–h6, page titles, program/exercise display names, brand wordmark. Single weight (400); marker/graffiti personality. |
| `--font-sub` | `'Space Grotesk', sans-serif` (300–700) | Everything "UI": labels, nav links, buttons, badges, stat values, table headers. Almost always uppercase + letterspaced. |
| `--font-body` | `'Manrope', sans-serif` (300–800) | Default body text, inputs, table cells, paragraphs. |

Base: `line-height: 1.5`, weight 400, `-webkit-font-smoothing: antialiased`; headings get
`line-height: 1.1`.

### Type scale & conventions

- **Page titles (heading font):** fluid — `clamp(30px, 5vw, 44px)` typical; hero up to
  `clamp(52px, 11vw, 88px)`; section titles `1.25rem`.
- **The label pattern** (the system's most-used text style — Space Grotesk):
  `font-size: 9–13px · font-weight: 600–700 · text-transform: uppercase ·
  letter-spacing: 0.08em–0.22em · color: var(--muted)`. Smaller text gets wider tracking.
- **Buttons:** Space Grotesk, 12px, 700, uppercase, `letter-spacing: 0.14em`.
- **Stat values:** Space Grotesk 700 at 15–22px, with 9–10px uppercase muted labels beneath.
- **Body/inputs:** Manrope 12–14px.

---

## 4. Shape, spacing, motion

### Radii

| Radius | Use |
|---|---|
| 3–4px | Buttons, inputs, small badges (default) |
| 6px | Day cells, chips, mid-size controls |
| 8px | Banners, summary pills, search bars |
| 10px | Large cards |
| 20px / 50% | Pills and circular controls (set numbers, check buttons, chevrons) |

### Motion

| Token | Value |
|---|---|
| `--transition` | `150ms cubic-bezier(0.4, 0, 0.2, 1)` |
| `--transition-md` | `250ms cubic-bezier(0.4, 0, 0.2, 1)` |

- Cards/CTAs lift on hover: `transform: translateY(-2px or -3px)` + shadow/glow.
- Card entrance: `fadeUp .35s both` with staggered `animation-delay` (.07s steps).
- Program cards reveal a 3px top accent bar via `scaleX(0→1)` on hover.
- Respect `prefers-reduced-motion` (global kill switch: `animation-duration: 0.01ms !important`).

### Z-index scale

`--z-nav: 100` · `--z-sticky: 200` · `--z-overlay: 900` · `--z-modal: 1000` ·
`--z-toast: 1100` · `--z-skiplink: 2000`.

---

## 5. Component recipes

**Primary button (solid red CTA):** `background: var(--accent)`, white text, no border, radius 4–6px,
Space Grotesk 12px/700 uppercase tracked, resting `box-shadow: var(--accent-glow-sm)`; hover →
brighter red (`#e00505`) or `opacity: .9`, `translateY(-2px)`, full `--accent-glow`.
Min-height 44–48px for tap targets.

**Secondary / ghost button:** transparent background, `1px solid var(--border-strong)`, muted text;
hover → `--accent-border` border, red-tinted fill `rgba(204,4,4,0.06–0.12)`, text to white or accent.

**Outline-accent button:** transparent with `1.5px solid var(--accent)`, white text; hover fills solid red.

**Card:** `background: var(--surface)`, `1px solid var(--border)` (or `--border-strong` when
interactive), radius 8–10px, padding ~18–32px. Hover: `--surface-hover`, translateY(-3px),
`box-shadow: 0 8px 28px rgba(0,0,0,0.3)`.

**Accent banner:** `--surface` fill, `--border`, plus `border-left: 3px solid var(--accent)`, radius 8px.

**Selected pill / radio (the "selected" treatment):** `border-color: var(--accent)`,
`background: var(--accent-dim)`, `color: var(--accent)`,
`box-shadow: 0 0 0 1px var(--accent-border), var(--accent-glow-sm)`. Native radio hidden,
styled `label` with `:has(input:checked)`.

**Text input:** `background: rgba(0,0,0,0.28)`, `1px solid var(--border-strong)`, white text,
radius 4px, padding 12px 14px; focus → `border-color: var(--accent)` +
`box-shadow: 0 0 0 3px rgba(204,4,4,0.12)`. Placeholder = `--muted`. Unit suffix ("LBS") as an
attached muted uppercase tag with a left hairline.

**Nav (sidebar in Max Method):** pure black, 240px, red hairline right edge
(`rgba(204,4,4,0.32)`). Links: Space Grotesk 11px/600 uppercase 0.10em, muted, 2px transparent
left border; active → accent color, accent left border, `--accent-dim` fill, red text-shadow glow.

**Badges:** small uppercase Space Grotesk chips — accent style = `--accent-dim` fill +
`--accent-border` + accent text (+ small glow); done style = same formula in green.

---

## 6. Accessibility rules (carried over)

- **Focus ring:** global `:focus-visible` — `outline: 2px solid var(--text)` with
  `outline-offset: 2px`. Keyboard-only (no ring on mouse click). Never remove it.
- **Skip link** to main content; `.sr-only` utility for screen-reader text.
- **Contrast:** muted text is 0.72-alpha white (AAA on the dark bg); 0.50-alpha white is
  decorative-only. Don't put dark text on accent-dim fills.
- **Tap targets:** interactive controls 44px minimum.
- `cursor: pointer` on all interactive elements; `not-allowed` when disabled.

---

## 7. Using this in Astra (React Native / Expo)

- Fonts via `@expo-google-fonts/permanent-marker`, `@expo-google-fonts/space-grotesk`,
  `@expo-google-fonts/manrope` — same three roles.
- CSS variables become a shared theme object (one module, imported everywhere — same rule as
  training math). Translucent surfaces/borders translate directly to RN rgba colors.
- No `background-attachment: fixed` in RN — recreate the page texture as an absolutely-positioned
  gradient + grid layer (e.g. `expo-linear-gradient` bands at 0/25/50/75/100%).
- Glows: RN has no `box-shadow` spread — approximate with `shadowColor: '#cc0404'` +
  `shadowOpacity`/`shadowRadius` (iOS) and `elevation` (Android), or accept borders-only.
- Keep the green-means-done convention; it maps cleanly onto workout logging and PRs.
