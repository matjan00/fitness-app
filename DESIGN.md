---
name: Fit
description: A dark-first, numbers-first personal tracker for gym, runs, food and an 11-week cut.
colors:
  # Dark theme (canonical: the world is dark-first). Source: docs/style.css @media (prefers-color-scheme: dark)
  ground: "#000000"
  card: "#1c1c1e"
  card-raised: "#2a2a2e"
  ink: "#f4f4f6"
  ink-secondary: "#a8a8b1"
  ink-tertiary: "#8c8c95"
  hairline: "#2e2e33"
  field-line: "#6a6a73"
  action-blue: "#2f6df0"
  action-blue-soft: "#142449"
  action-blue-ink: "#7aa7ff"
  on-action: "#ffffff"
  on-color: "#0b0b0c"
  done-green: "#34d27b"
  done-green-soft: "#0e2a1b"
  attention-amber: "#fbbf24"
  attention-amber-soft: "#2e2410"
  destructive-red: "#f87171"
  destructive-red-soft: "#3a1515"
  destructive-red-ink: "#fca5a5"
  macro-protein: "#f472a0"
  macro-carbs: "#6ea0ff"
  macro-fat: "#f0b54a"
  run-tempo: "#f5a35a"
  run-workout: "#b29cff"
  hero: "#1b1b1e"
  hero-ink: "#ffffff"
  hero-muted: "#a9a9b3"
  # Light theme mirror. Source: docs/style.css :root
  ground-light: "#f2f2f6"
  card-light: "#ffffff"
  card-raised-light: "#efeff3"
  ink-light: "#0f0f12"
  ink-secondary-light: "#4e4e57"
  ink-tertiary-light: "#686872"
  hairline-light: "#e3e3e8"
  field-line-light: "#8d8d96"
  action-blue-light: "#2563eb"
  action-blue-soft-light: "#e7eefd"
  action-blue-ink-light: "#1d4fd0"
  on-color-light: "#ffffff"
  done-green-light: "#15803d"
  done-green-soft-light: "#e2f5e9"
  attention-amber-light: "#9a5b00"
  attention-amber-soft-light: "#fcf0d9"
  destructive-red-light: "#c81e1e"
  destructive-red-soft-light: "#fdeceb"
  destructive-red-ink-light: "#b91c1c"
  macro-protein-light: "#d02f68"
  macro-carbs-light: "#2f6fd6"
  macro-fat-light: "#a86400"
  run-tempo-light: "#b45900"
  run-workout-light: "#6f47d6"
  hero-light: "#131316"
typography:
  hero-figure:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", Roboto, \"Segoe UI\", system-ui, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "44px"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", Roboto, \"Segoe UI\", system-ui, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  stat-figure:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", Roboto, \"Segoe UI\", system-ui, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", Roboto, \"Segoe UI\", system-ui, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 750
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", Roboto, \"Segoe UI\", system-ui, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.2
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", Roboto, \"Segoe UI\", system-ui, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", Roboto, \"Segoe UI\", system-ui, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.45
  field-label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", Roboto, \"Segoe UI\", system-ui, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.45
  tab-label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", Roboto, \"Segoe UI\", system-ui, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "11.5px"
    fontWeight: 600
rounded:
  inner: "9px"
  sm: "10px"
  md: "12px"
  lg: "14px"
  sheet: "18px"
  pill: "99px"
spacing:
  xs: "6px"
  sm: "8px"
  gap: "10px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.on-action}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "12px 18px"
    height: "46px"
  button-ghost:
    backgroundColor: "{colors.card-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 18px"
    height: "46px"
  button-soft:
    backgroundColor: "{colors.action-blue-soft}"
    textColor: "{colors.action-blue-ink}"
    rounded: "{rounded.md}"
    padding: "12px 18px"
    height: "46px"
  button-danger:
    backgroundColor: "{colors.destructive-red}"
    textColor: "{colors.on-color}"
    rounded: "{rounded.md}"
    padding: "12px 18px"
    height: "46px"
  icon-button:
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    size: "44px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  card-flat:
    backgroundColor: "{colors.card-raised}"
    rounded: "{rounded.lg}"
    padding: "16px"
  hero:
    backgroundColor: "{colors.hero}"
    textColor: "{colors.hero-ink}"
    rounded: "{rounded.lg}"
    padding: "18px"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "12px 13px"
  chip:
    backgroundColor: "{colors.card-raised}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.pill}"
    padding: "7px 14px"
  chip-on:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.on-action}"
    rounded: "{rounded.pill}"
  segmented:
    backgroundColor: "{colors.card-raised}"
    rounded: "{rounded.md}"
    padding: "3px"
  segmented-on:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.on-action}"
    rounded: "{rounded.inner}"
    height: "42px"
  pill:
    backgroundColor: "{colors.card-raised}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.pill}"
    padding: "3px 9px"
  pill-done:
    backgroundColor: "{colors.done-green-soft}"
    textColor: "{colors.done-green}"
    rounded: "{rounded.pill}"
  pill-attention:
    backgroundColor: "{colors.attention-amber-soft}"
    textColor: "{colors.attention-amber}"
    rounded: "{rounded.pill}"
  tabbar:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.tab-label}"
    height: "64px"
  tabbar-active:
    textColor: "{colors.action-blue-ink}"
  set-row-done:
    backgroundColor: "{colors.done-green-soft}"
    rounded: "11px"
  set-check-done:
    backgroundColor: "{colors.done-green}"
    textColor: "{colors.on-color}"
    rounded: "{rounded.inner}"
    size: "44px"
---

# Design System: Fit

## Overview

**Creative North Star: "The Gym-Floor Scoreboard"**

Fit plays the fitness-tracker category straight, at the craft level of Hevy: a near-black ground, raised graphite cards, and the day's figures set heavy and large so they read at arm's length between sets. Each card leads with a bold title row and a stat row of two or three tabular figures over small grey labels; the action is a full-width blue button underneath. Nothing decorates. Hierarchy comes from weight, size and tonal lift, not from colour.

The system is dense and one-handed: 44px targets in the core loops, a fixed bottom tab bar, full-screen pages that slide in from the right, bottom sheets for choices. Colour is rationed. One blue means "act or selected"; green, amber and red carry status and nothing else. The light theme is a faithful mirror (white cards on cool light grey), and the hero surface stays dark in both.

This world replaced an earlier soft slate SaaS look with Inter and per-section accent colours; that look is rejected.

**Key Characteristics:**
- Dark-first: pure black ground, #1c1c1e-family cards, light mirror follows the phone setting.
- Numbers first: heavy (800) tabular figures, small grey labels beneath.
- One blue accent shared by every section; status colours used only for status.
- Flat: depth by tonal steps, hairline separators, no card shadows.
- System UI font stack only.

## Colors

Neutral graphite and black, one confident blue, and a strict status triad.

### Primary
- **Action Blue** (`action-blue`, light `action-blue-light`): every primary button, the selected chip, the selected segment, progress fills, the rest-timer skip. The only fill that means "do this" or "this is chosen".
- **Action Blue Ink** (`action-blue-ink`): blue used as text, for links, the active tab, the back arrow in page bars, selected labels. Lighter than the fill in dark mode so it holds 4.5:1 on cards.
- **Action Blue Soft** (`action-blue-soft`): soft buttons, accent pills, the update card. A wash, never a selection signal on its own.

### Secondary (status)
- **Done Green** (`done-green` / `done-green-soft`): completed set rows and their check, the Resume-workout button, the live pulse dot, ok sync line, ticked checklist items, switches when on.
- **Attention Amber** (`attention-amber` / `attention-amber-soft`): red flags, warm-up set tags, PR markers, warnings, gym notes. Problems phrased as the next action.
- **Destructive Red** (`destructive-red` / `destructive-red-soft` / `destructive-red-ink`): delete and discard, failure-set tags, genuinely off-track figures, error sync line.

### Tertiary (data only)
- **Macro Protein / Carbs / Fat** (`macro-protein`, `macro-carbs`, `macro-fat`): food macro rings and bars only.
- **Run Tempo / Run Workout** (`run-tempo`, `run-workout`): run-type tints alongside green (easy), grey (recovery), blue (long), red (intervals), amber (race). Defined in docs/run.css.

### Neutral
- **Ground** (`ground`): the page, page bars and sheet footers. Pure black in dark, cool grey `#f2f2f6` in light.
- **Card** (`card`): cards, tab bar, sheets, inputs.
- **Card Raised** (`card-raised`): ghost buttons, chips, segmented track, set-row inputs and tags, progress tracks, flat cards.
- **Ink / Ink Secondary / Ink Tertiary** (`ink`, `ink-secondary`, `ink-tertiary`): figures and titles; labels and sub-lines; placeholders, chevrons, empty-state icons.
- **Hairline** (`hairline`): 1px separators between list rows, stat columns, page bars and the tab bar.
- **Field Line** (`field-line`): input borders, the off switch, scrollbar thumbs (3:1 on cards).
- **Hero** (`hero`, `hero-ink`, `hero-muted`): the live workout banner, run week hero, workout-complete summary. Dark in both themes; in dark mode it carries a 1px inset ring.

### Named Rules
**The One Blue Rule.** Blue is the only action and selection colour, and every section shares it (`--gym`, `--run`, `--food` all alias the accent). No section gets its own identity hue.

**The Status Means Status Rule.** Green is done or good, amber is attention, red is destructive or truly off-track. None of them is ever decoration or a section colour.

**The Filled Selection Rule.** A chosen option is filled with Action Blue (chip, segment, picker check); selection never relies on a faint tint.

## Typography

**Display Font:** System UI stack (SF Pro Text on Apple, Roboto on Android, Segoe UI on Windows)
**Body Font:** the same stack
**Label/Mono Font:** none; figures use tabular digits from the same stack

**Character:** Native, heavy and unfussy. Weight does the work: 800 for figures and page titles, 650-750 for titles and controls, 400 for running text.

### Hierarchy
- **Hero figure** (800, 44px, 1.05, -0.03em): the single big number in a hero (run week km); the weekly-review figure uses 40px.
- **Display** (800, 28px, 1.2, -0.02em): page titles (h1) on each tab.
- **Stat figure** (800, 22px, 1.15, -0.02em, tabular): the figure in a stat row; 26px for the rest-timer countdown, 17px inside the finish summary.
- **Headline** (750, 17px, 1.2): card titles, section titles, page-bar titles (700).
- **Title** (650, 15px): h3, button labels (700), list item names.
- **Body** (400, 15px, 1.45): running text; inputs use 16px to stop mobile zoom.
- **Label** (400, 12.5px, Ink Secondary): the grey label under a stat figure; list sub-lines are 13px.
- **Field label** (600, 13px, Ink Secondary): labels above inputs.
- **Tab label** (600, 11.5px; 700 when active).

### Named Rules
**The Figure Over Label Rule.** A number is read first: heavy figure on top, small grey label below, never the reverse and never the label in bold.

**The Tabular Digits Rule.** Anything that is read or compared as a number (stats, pills, chips, inputs, times, sub-lines) uses tabular numerals so columns line up.

## Layout

A single phone column: 16px side gutters, content capped at 720px and centred. The view clears the top safe area (14px) and the 64px tab bar plus 24px. Cards stack with a 12px gap; card padding is 16px (hero 18px); section titles sit 24px above their group. Stat rows auto-fit columns of at least 84px. Full-screen pages use a three-column bar (44px back button, centred title, right actions), a scrolling body with 16px padding, and an optional footer bar. Bottom sheets are capped at 560px wide and 88vh tall. Forms are single-column grids with 14px gaps and 10px two-up rows.

At 760px and wider the tab bar detaches into a floating dock the width of the content column, 12px from the bottom with an 18px radius, and the view gains 28px top padding.

## Elevation & Depth

Flat by default. `--shadow` is `none`: cards sit on the ground by tone alone (ground, then card, then card raised). Shadows appear only on things that genuinely float above content: the desktop tab-bar dock, the live-workout banner above the tab bar, and the rest-timer bar's soft upward shadow. Focus is a 3px blue halo on fields and a 2px blue outline elsewhere. Bottom sheets dim the page with a near-black scrim at 45%.

### Shadow Vocabulary
- **Dock** (`box-shadow: 0 10px 30px rgba(0, 0, 0, .18)`): the tab bar at 760px+.
- **Floating banner** (`box-shadow: 0 8px 24px rgba(11, 14, 19, .22)`): the live-workout banner.
- **Rest bar lift** (`box-shadow: 0 -6px 20px rgba(0, 0, 0, .06)`): the rest-timer bar pinned to the bottom of the workout.
- **Hero ring, dark** (`box-shadow: inset 0 0 0 1px #2c2c31`): separates the hero from the black ground in dark mode.
- **Field focus** (`box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 25%, transparent)`).

### Named Rules
**The Tonal Lift Rule.** Depth comes from tone steps and hairlines. A shadow means "this floats over the page", never "this is a card".

## Shapes

Gently rounded and consistent: cards and heroes 14px, buttons, segmented tracks, icon buttons and thumbnails 12px, inputs and secondary controls 10px, small inner pieces (segments, set tags, set inputs, checks) 9px, sheets 18px on the top corners, pills and chips fully round. Lines are 1px hairlines. Icons are 22px outline strokes at 2px with round caps and joins (26px in the tab bar, thicker when active).

**The Hairline Rule.** Groups are divided by 1px hairlines (stat columns, list rows, bars), not boxed into tiles.

## Components

### Buttons
Confident, filled, full-width where they are the card's action.
- **Shape:** gently rounded (12px), minimum 46px tall, 12px 18px padding, 700 weight 15px.
- **Primary:** Action Blue fill, white label. Used full-width (`block`) as the card or page action.
- **Press:** scales to 0.98 and darkens slightly (brightness 0.94) over 0.1-0.15s. Disabled is 50% opacity.
- **Ghost:** Card Raised fill, Ink label. **Soft:** blue wash with blue ink. **Danger:** red fill with on-color label.
- **Icon button:** 44px square, 12px radius, raised-tone background only while pressed.

### Chips and segmented control
- **Chip:** fully round, Card Raised fill, 650 weight 13.5px; selected fills Action Blue with white text. Horizontally scrolling row.
- **Segmented control:** Card Raised track (12px radius, 3px inset), 42px segments; the chosen segment is filled blue.

### Pills
Small status capsules (3px 9px, 12px 650 weight, tabular). Neutral, accent, done, attention and destructive variants pair each soft fill with its own ink.

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** Card; flat variant uses Card Raised.
- **Shadow Strategy:** none (see Elevation).
- **Border:** none; inner groups split by hairlines.
- **Internal Padding:** 16px, a card head row with a 17px 750 title and an optional blue text link on the right (44px tall hit area).
- **Hero:** dark in both themes, 18px padding, figures in white with muted grey labels and translucent white column dividers.

### Stat row (signature)
Two to three columns, each a 22px 800 tabular figure over a 12.5px grey label, divided by hairlines with no tile backgrounds. The first column sits flush left.

### Inputs / Fields
- **Style:** Card background, 1px Field Line border, 10px radius, 12px 13px padding, 16px text.
- **Focus:** border turns blue with a 3px soft blue halo; caret is blue.
- **Labels:** 13px 600 grey above the field. Search fields carry a grey 19px icon inset left.
- **Switch:** 48 by 28px track, Field Line off, Done Green on, white knob.

### Navigation
- **Tab bar:** fixed bottom, 64px plus safe area, Card background with a hairline top border; labelled outline icons, grey at rest, Action Blue Ink and heavier stroke when active, icon dips to 0.9 on press. Floats as a dock at 760px+.
- **Page bar:** ground background, hairline bottom, blue back arrow, centred 17px title with an optional 12px grey subtitle.
- **Sheets:** slide up over a dimmed page, 18px top corners, a grab handle, centred title, menu rows of 52px separated by hairlines.

### Workout logger (signature)
Set rows on a five-column grid (set tag, previous, weight, reps, check), 44px controls on Card Raised with 9px corners and tabular 16px 680-weight inputs. Tags tint by set type (warm-up amber, drop in the blue wash, failure red). Completing a set fills the row Done Green Soft, the check turns solid Done Green and the row pops once. A rest bar pins to the bottom with a thin blue progress track, a 26px countdown and a blue Skip button.

## Do's and Don'ts

### Do:
- **Do** use Action Blue for every primary action and every selected state, and nothing else.
- **Do** lead each card with its key figures: a stat row of 22px 800 tabular numbers over 12.5px grey labels.
- **Do** separate groups with 1px hairlines and build depth from ground, card and card raised.
- **Do** keep core-loop targets at 44px or larger and inputs at 16px text.
- **Do** define every colour as a token with both a light and a dark value, holding 4.5:1 for text on card and ground.
- **Do** honour reduced motion: no slides, pops or confetti.

### Don't:
- **Don't** give sections their own identity colours; gym, run and food share the one blue.
- **Don't** use green, amber or red for decoration; they are status only, and red is for destructive or genuinely off-track.
- **Don't** put shadows on cards; shadows are for floating layers only.
- **Don't** signal selection with a faint tint alone; fill it.
- **Don't** introduce a web font or a second accent hue.
- **Don't** return to the soft slate SaaS card look this world replaced.
