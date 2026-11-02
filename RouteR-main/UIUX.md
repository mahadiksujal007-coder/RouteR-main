# ANTIGRAVITY AI — Design System Specification

## Three Designer Variants | EV Routing Platform | Production-Grade

> **Project Context:** Antigravity AI is an energy-aware EV route planning system. The UI must communicate precision, safety, and data density — a driver trusting this app with a critical range decision. Every design choice is accountable.

---

## Designer 1: VERA — "Aerospace HUD"

_Design Style: Dark Kinetic Instrumentalism — inspired by modern EV instrument clusters (Tesla, Rivian, Lucid), aerospace cockpit HUDs, and Braun industrial design. Dark-first, monospace-heavy, glow-state data._

### Visual Preview

- **Primary aesthetic:** Every component behaves like a precision instrument panel — calibrated, purposeful, void of decoration. The interface glows where data lives. Background is near-void black with a slight warm charcoal undertone. Data surfaces emit a controlled teal bioluminescence at active states.
- **Colors:** Deep void `#080C10` + Electric teal `#00E5A0` + Amber alert `#F5A623` + Danger crimson `#FF4542`
- **Typography:** `DM Mono` for all numeric/data display; `Syne` for labels and UI chrome; monospace creates instrument-panel authenticity
- **Best for:** Power users, fleet managers, technical dashboard consumers, OEM integration displays

### Signature Moves

- SOC Trace Bar — segmented energy timeline pinned to screen bottom, each pixel a node, glowing by charge state
- Instrument-style circular arc gauges with `stroke-dashoffset` animation for SOC/SOH
- Razor-thin `1px` borders in `rgba(255,255,255,0.08)` — barely there, just enough to define surfaces
- `letter-spacing: 0.08em` uppercase DM Mono labels — the language of precision instruments
- Accent glow halos: `box-shadow: 0 0 20px rgba(0,229,160,0.20), 0 0 40px rgba(0,229,160,0.08)`

### Example Mental Image

> You open the app on a dark night. A near-black canvas fills the screen. The map tiles are desaturated to 60% — functional, not decorative. In the left panel, your EV's battery arc glows teal at 75%, a faint nimbus of light surrounding it. As you set your destination, the route draws itself onto the map with a single glowing green polyline, animating forward like a laser trace. At the bottom of the screen, a segmented timeline — the SOC trace — pulses alive segment by segment, each one the color of your battery at that exact point of the journey. Amber segments appear near the charging stop marker, a small lightning bolt floating above the trace. The entire interface feels like a flight management computer that happens to route electric vehicles.

---

<details>
<summary><strong>→ View Complete Design System: Vera / Aerospace HUD</strong></summary>

```
# Design System Specification — Antigravity AI / Vera / Aerospace HUD

You are implementing an Aerospace HUD design system characterized by dark
instrumentalism, precision data typography, controlled luminescence, and
zero decorative noise. Every element serves a data function. Follow these
exact specifications for all UI components.

## Core Visual Language

This design system emphasizes: (1) data legibility at a glance, (2) state
communication through controlled light emission, (3) spatial economy — no
pixel wasted, (4) monospace precision for numeric data. Every element should
reinforce the principle that this interface is a precision instrument, not a
consumer app.

## Color Palette

### Primary Colors
- primary:         #00E5A0  — electric teal. Use for: active route, primary CTA, SOC-full state, selected element, key data value highlights
- primary-hover:   #00FFB2  — brightened teal. Use for: hover states on primary elements
- primary-glow:    rgba(0,229,160,0.15)  — Use for: focus rings, active card borders, glow shadows
- primary-dim:     rgba(0,229,160,0.40)  — Use for: border-accent on focused inputs

### Neutral Scale (Dark-first, near-void base)
- neutral-50:  #080C10  — Base background. The void. Map underlay, page bg
- neutral-100: #0F1419  — Surface. Cards, panels, left drawer
- neutral-200: #161D26  — Elevated surface. Inputs, dropdowns, hover bg
- neutral-300: #1E2833  — Overlay. Tooltips, popovers, context menus
- neutral-400: #2A3A4A  — Separator. Dividers, ruler lines
- neutral-500: #3D4F5C  — Disabled / tertiary. Placeholder text, inactive icons
- neutral-600: #5A6B7A  — Muted text. Labels, captions, metadata
- neutral-700: #7A8A99  — Secondary text. Descriptions, helper text
- neutral-800: #A8B8C8  — Body text. Standard readable copy
- neutral-900: #E8EDF2  — Primary text. Maximum readability on dark surfaces

### Semantic Colors
- success: #00E5A0  — (same as primary — success IS energy in this system)
- warning: #F5A623  — amber. Low SOC, charging required, station with caveats
- error:   #FF4542  — crimson. Route infeasible, critically low SOC, API errors
- info:    #4A9EFF  — steel blue. Station info, metadata highlights, secondary data

### SOC State Colors (Battery charge visual language — EV-specific)
- soc-full:    #00E5A0  — SOC > 60%. Green-teal. Route is safe.
- soc-medium:  #F5A623  — SOC 20–60%. Amber. Attention recommended.
- soc-low:     #FF4542  — SOC < 20%. Crimson. Charge required.
- soc-reserve: #2A3A4A  — SOC < 10% reserve. Dark grey. Below safe threshold.

### Special Effects
- gradient-energy:   linear-gradient(90deg, #00E5A0 0%, #F5A623 60%, #FF4542 100%)
  — Use for: SOC trace bar gradient, energy spectrum indicators
- gradient-route:    linear-gradient(to bottom, rgba(0,229,160,0.1) 0%, transparent 100%)
  — Use for: route card background tint
- shadow-glow-teal:  0 0 20px rgba(0,229,160,0.20), 0 0 40px rgba(0,229,160,0.08)
  — Use for: active elements, focused inputs, primary buttons
- shadow-glow-amber: 0 0 20px rgba(245,166,35,0.20)
  — Use for: charging stop cards, warning states
- shadow-glow-red:   0 0 20px rgba(255,69,66,0.20)
  — Use for: infeasible route banner, critical low SOC
- shadow-card:       0 2px 12px rgba(0,0,0,0.40), 0 0 0 1px rgba(255,255,255,0.05)
  — Use for: default card surfaces
- shadow-panel:      0 8px 32px rgba(0,0,0,0.60), 0 0 0 1px rgba(255,255,255,0.08)
  — Use for: drawer panels, modals
- border-default:    1px solid rgba(255,255,255,0.08)
- border-active:     1px solid rgba(0,229,160,0.40)
- border-warning:    1px solid rgba(245,166,35,0.40)
- border-danger:     1px solid rgba(255,69,66,0.40)

## Typography System

### Font Stack
font-family: 'DM Mono', 'Fira Code', monospace;          — data, numbers, labels
font-family: 'Syne', 'Outfit', sans-serif;               — UI chrome, headings, body
font-family: 'Syne Mono', monospace;                     — code, technical strings

### Type Scale
- text-xs:   0.65rem  / 1.0rem   — micro labels, coordinates, IDs, metadata tags
- text-sm:   0.75rem  / 1.2rem   — field labels, captions, tags
- text-base: 0.875rem / 1.5rem   — body copy, descriptions
- text-lg:   1rem     / 1.6rem   — card titles, section names
- text-xl:   1.25rem  / 1.5rem   — panel headings
- text-2xl:  1.5rem   / 1.8rem   — large headings
- text-3xl:  2rem     / 1.2rem   — hero data values (SOC %, kWh display)
- text-4xl:  2.5rem   / 1.1rem   — full-screen data emphasis
- text-5xl:  3.5rem   / 1.0rem   — single-number dashboards

### Font Weights
- Headings (Syne):        600  — semi-bold, architectural
- Body (Syne):            400  — regular
- Data values (DM Mono):  700  — bold monospace for maximum instrument legibility
- Labels (DM Mono):       400  — regular monospace
- Emphasis (DM Mono):     500  — medium

### Letter Spacing Rules
- ALL-CAPS labels:         letter-spacing: 0.08em   — essential for instrument aesthetic
- Data numbers:            letter-spacing: -0.02em  — tighter for monospace alignment
- Body text:               letter-spacing: 0.01em
- Large display numbers:   letter-spacing: -0.04em  — optical tightening at large sizes

## Spacing System

Base unit: 4px

### Scale
- space-0:  0
- space-1:  4px    — icon gaps, micro padding
- space-2:  8px    — icon-to-label gap, tight list spacing
- space-3:  12px   — input vertical padding, compact card padding
- space-4:  16px   — standard card padding, form field spacing
- space-5:  24px   — panel inner padding, section breathing room
- space-6:  32px   — between sections
- space-8:  48px   — major section separation
- space-10: 64px   — hero sections
- space-12: 80px   — above-the-fold primary spacing
- space-16: 128px  — full-bleed section margin

## Component Specifications

### Buttons — Primary Action
padding: 12px 20px;
border-radius: 6px;
font-family: 'DM Mono', monospace;
font-weight: 600;
font-size: 0.875rem;
letter-spacing: 0.04em;
text-transform: none;
background: #00E5A0;
color: #080C10;
border: none;
transition: opacity 150ms ease, transform 100ms ease, box-shadow 250ms ease;
cursor: pointer;

/* Hover state */
transform: translateY(-1px);
box-shadow: 0 0 20px rgba(0,229,160,0.25), 0 0 40px rgba(0,229,160,0.10);
opacity: 1;

/* Active/Pressed */
transform: translateY(0) scale(0.98);
box-shadow: none;

/* Disabled */
opacity: 0.35;
cursor: not-allowed;
transform: none;

/* Loading state */
position: relative;
color: transparent;
/* ::after spinner: width 16px, height 16px, border 2px solid #080C10, border-top transparent, border-radius 50%, animation: spin 600ms linear infinite */

### Buttons — Ghost/Secondary
padding: 11px 20px;
border: 1px solid rgba(255,255,255,0.15);
border-radius: 6px;
background: transparent;
color: #E8EDF2;
font-family: 'DM Mono', monospace;
font-size: 0.875rem;
transition: border-color 200ms ease, background 200ms ease;

/* Hover */
border-color: rgba(0,229,160,0.40);
background: rgba(0,229,160,0.06);

### Input Fields
height: 44px;
padding: 0 16px;
background: #161D26;
border: 1px solid rgba(255,255,255,0.08);
border-radius: 6px;
color: #E8EDF2;
font-family: 'DM Mono', monospace;
font-size: 0.875rem;
transition: border-color 200ms ease, box-shadow 200ms ease;
outline: none;

/* Placeholder */
color: #3D4F5C;

/* Focus state */
border-color: rgba(0,229,160,0.40);
box-shadow: 0 0 0 3px rgba(0,229,160,0.12);

/* Error state */
border-color: rgba(255,69,66,0.60);
box-shadow: 0 0 0 3px rgba(255,69,66,0.10);

/* Filled/valid state */
border-color: rgba(255,255,255,0.15);

### Range Slider (SOC/SOH inputs)
height: 6px;
background: #1E2833;
border-radius: 9999px;
appearance: none;
outline: none;
cursor: pointer;

/* Filled track (via JS width on .slider-fill div) */
background: #00E5A0;
height: 100%;
border-radius: 9999px;
transition: width 80ms linear;

/* Thumb */
::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #00E5A0;
  border: 2.5px solid #0F1419;
  box-shadow: 0 0 8px rgba(0,229,160,0.50);
  transition: transform 150ms ease;
}

::-webkit-slider-thumb:hover {
  transform: scale(1.25);
}

### Cards — Standard Data Card
padding: 16px;
background: #0F1419;
border: 1px solid rgba(255,255,255,0.06);
border-radius: 10px;
box-shadow: 0 2px 12px rgba(0,0,0,0.40), 0 0 0 1px rgba(255,255,255,0.04);
transition: border-color 300ms ease, box-shadow 300ms ease;

/* Active / result state */
border-color: rgba(0,229,160,0.30);
box-shadow: 0 0 0 1px rgba(0,229,160,0.20), 0 4px 20px rgba(0,0,0,0.50);
animation: card-reveal 400ms cubic-bezier(0.22, 1, 0.36, 1) forwards;

/* Warning card (charging stop) */
border-left: 3px solid #F5A623;
box-shadow: 0 0 20px rgba(245,166,35,0.12);

### SOC Trace Bar (Signature Component)
height: 72px;
background: #0F1419;
border-top: 1px solid rgba(255,255,255,0.08);
padding: 8px 24px;
display: flex; flex-direction: column; gap: 6px;

/* Segment track */
height: 28px;
display: flex;
gap: 1px;
border-radius: 4px;
overflow: hidden;

/* Individual segment */
flex: 1;
transition: filter 150ms ease, transform 100ms ease;
cursor: pointer;

/* Segment color states */
[data-soc-state="full"]    { background: #00E5A0; opacity: 0.85; }
[data-soc-state="medium"]  { background: #F5A623; opacity: 0.85; }
[data-soc-state="low"]     { background: #FF4542; opacity: 0.85; }
[data-soc-state="reserve"] { background: #2A3A4A; opacity: 0.60; }

/* Segment hover */
filter: brightness(1.3);
transform: scaleY(1.1);
transform-origin: bottom;

### Battery Arc Gauge (SVG Component)
viewBox: 0 0 120 120; width: 120px; height: 120px;
Track arc: stroke=#1E2833; stroke-width=10; stroke-linecap=round
Fill arc: stroke=#00E5A0; transition: stroke-dashoffset 600ms cubic-bezier(0.4,0,0.2,1)
Center percent: font-family=DM Mono; font-size=20px; font-weight=700; fill=#E8EDF2
Center label: font-family=Syne; font-size=10px; letter-spacing=0.08em; fill=#3D4F5C

### Feasibility Status Banner
position: fixed/absolute; top: calc(topbar-height + 16px); centered horizontally;
min-width: 360px; max-width: 560px;
padding: 12px 16px;
border-radius: 10px;
display: flex; align-items: center; gap: 12px;
transition: transform 300ms cubic-bezier(0.22,1,0.36,1), opacity 200ms ease;
transform: translateY(-20px); opacity: 0;  — default hidden
transform: translateY(0); opacity: 1;      — visible state

/* Feasible */
background: rgba(0,229,160,0.10);
border: 1px solid rgba(0,229,160,0.30);
box-shadow: 0 0 20px rgba(0,229,160,0.15);

/* Charging needed */
background: rgba(245,166,35,0.10);
border: 1px solid rgba(245,166,35,0.30);

/* Infeasible */
background: rgba(255,69,66,0.10);
border: 1px solid rgba(255,69,66,0.30);

### Layout Principles
- App container: 100vw × 100vh, overflow: hidden (no page scroll)
- Root grid: grid-template-columns: 380px 1fr; grid-template-rows: 52px 1fr 72px
- Left panel width: 380px fixed (desktop); overlay 320px wide (tablet); bottom-sheet (mobile)
- Panel inner padding: 24px
- Card gap within panel: 12px
- Map canvas: flex: 1, position: relative
- Floating result card: position: absolute; bottom: calc(72px + 24px); right: 24px; width: 320px
- Topbar height: 52px

### Z-index Layers
- map canvas:     z-index: 1
- map overlays:   z-index: 2–4
- left panel:     z-index: 5
- floating cards: z-index: 6
- soc trace bar:  z-index: 8
- topbar:         z-index: 10
- banners:        z-index: 50
- modals:         z-index: 100

## Animation Guidelines

### Timing Functions
- ease-snap:   cubic-bezier(0.22, 1.00, 0.36, 1)   — panel slides, card reveals (snappy exits)
- ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)   — confirmation bounce, gauge fill
- ease-linear: linear                                — SOC fill, progress bars
- ease-in-out: cubic-bezier(0.4,  0.00, 0.2,  1)   — state transitions

### Durations
- instant: 0ms    — layout shifts that must feel native
- fast:  150ms    — hover state changes, button press feedback
- base:  250ms    — color transitions, border changes
- slow:  400ms    — card reveals, panel entrance
- crawl: 1200ms   — route polyline draw animation (deliberate)

### Keyframe Animations
@keyframes card-reveal {
  from { transform: translateY(8px) scale(0.97); opacity: 0; }
  to   { transform: translateY(0)   scale(1);    opacity: 1; }
}

@keyframes draw-route {
  from { stroke-dashoffset: 1000; }
  to   { stroke-dashoffset: 0; }
}
/* duration: 1200ms ease-out — the route drawing feels intentional */

@keyframes segment-appear {
  from { transform: scaleY(0); opacity: 0; }
  to   { transform: scaleY(1); opacity: 1; }
}
/* Apply stagger: animation-delay: calc(var(--i) * 2ms) per segment */

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 20px rgba(0,229,160,0.20); }
  50%       { box-shadow: 0 0 30px rgba(0,229,160,0.40), 0 0 60px rgba(0,229,160,0.15); }
}
/* duration: 2.5s ease-in-out infinite — on active route polyline */

@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}
/* Skeleton loader: linear-gradient(90deg, #0F1419 25%, #161D26 50%, #0F1419 75%) */
/* background-size: 200%; animation: shimmer 1.4s ease infinite */

### Standard Transitions
- Hover on interactive:  all 150ms ease
- Focus ring:            box-shadow 200ms ease
- Active/pressed:        transform 80ms ease
- Card state change:     border-color 300ms ease, box-shadow 300ms ease
- Route polyline draw:   stroke-dashoffset 1200ms cubic-bezier(0.22,1,0.36,1)
- SOC fill gauge:        stroke-dashoffset 600ms cubic-bezier(0.34,1.56,0.64,1)
- Banner entrance:       transform + opacity 300ms cubic-bezier(0.22,1,0.36,1)

## Implementation Rules

### DO:
- Use DM Mono for ALL numeric values — kWh, %, km, kW, minutes
- Apply letter-spacing: 0.08em to ALL uppercase label strings
- Use data-* attributes for component state, never class-based boolean flags
- Animate only transform and opacity — never layout properties (width, height, margin)
- Apply SOC state colors via data-soc-state attribute, not inline style
- Show glow shadows ONLY on active/focused states — never decoratively
- Validate all OCM coordinates before rendering station markers
- Use aria-live="polite" on result sections, aria-live="assertive" on critical banners

### DON'T:
- Never use white or light backgrounds — this is a dark-first instrument interface
- Never put decorative gradients behind text — gradients only on data viz elements
- Never apply box-shadow to more than 3 elements simultaneously visible on screen
- Never use border-radius > 12px on functional components (only pills use 9999px)
- Never mix DM Mono and Syne within the same line of text
- Never animate width, height, top, left, or margin — use transform instead
- Never show an error as a red empty state — always show partial data + degradation flag

### Accessibility Requirements
- Minimum contrast ratio: 4.5:1 for body text; 3:1 for large text and UI components (WCAG AA)
- Focus indicators: outline: 2px solid #00E5A0; outline-offset: 3px — never outline: none
- Touch targets: minimum 44×44px on mobile
- Color is never the sole state indicator — every SOC state also has a text label
- Motion preferences: @media (prefers-reduced-motion: reduce) — disable all keyframe animations, reduce transitions to max 100ms
- Screen readers: aria-label on all SVG gauges and the SOC trace bar (role="img")

## Visual Hierarchy System

### Emphasis Levels
- Level 1 (Maximum):  Large DM Mono 700 weight number in #E8EDF2 + teal glow accent — SOC%, kWh values
- Level 2 (High):     Syne 600 16px #E8EDF2 — Card titles, section headers
- Level 3 (Standard): Syne 400 14px #A8B8C8 — Body copy, descriptions
- Level 4 (Reduced):  DM Mono 400 12px #5A6B7A — Labels, captions, metadata
- Level 5 (Minimum):  DM Mono 400 11px #3D4F5C — Timestamps, coordinates, IDs

### Contrast Ratios
- Primary text (#E8EDF2) on base (#080C10):     18.5:1  — far exceeds AAA
- Secondary text (#A8B8C8) on surface (#0F1419): 7.8:1  — exceeds AA
- Muted text (#5A6B7A) on surface (#0F1419):     3.2:1  — meets AA for large text only
- Accent (#00E5A0) on base (#080C10):            9.1:1  — strong contrast
- Warning (#F5A623) on base (#080C10):           8.4:1  — strong contrast
- Disabled elements: intentionally reduced; not interactive, no minimum required

## Iconography System

### Icon Style
- Library: Phosphor Icons (outline weight) or Lucide React — consistent 1.5px stroke
- Grid size: 24px standard, 16px compact, 32px decorative/hero
- Corner radius: 2px rounded — matches card radius feel
- Style: outline only — no filled icons except for active/selected state toggle
- Optical corrections: SVG viewBox 24×24; center-align with text using vertical-align: middle

### Icon Usage
.icon-inline { width: 1.1em; height: 1.1em; vertical-align: middle; margin-right: 6px; }
.icon-sm     { width: 16px; height: 16px; }
.icon-md     { width: 24px; height: 24px; }
.icon-lg     { width: 32px; height: 32px; }
/* All icons: aria-hidden="true" (decorative) or role="img" aria-label="..." (informative) */

## Interaction States

### State Definitions
/* Hover */
opacity: 1; transform: translateY(-1px); transition: all 150ms ease;

/* Active/Pressed */
transform: translateY(0) scale(0.98); transition: transform 80ms ease;

/* Focus */
outline: 2px solid #00E5A0; outline-offset: 3px;

/* Disabled */
opacity: 0.35; cursor: not-allowed; pointer-events: none; filter: grayscale(0.3);

/* Loading */
background: linear-gradient(90deg, #0F1419 25%, #161D26 50%, #0F1419 75%);
background-size: 200%;
animation: shimmer 1.4s ease infinite;
border-radius: inherit;

/* Error */
border-color: rgba(255,69,66,0.60);
box-shadow: 0 0 0 3px rgba(255,69,66,0.10);

/* Success */
border-color: rgba(0,229,160,0.40);
box-shadow: 0 0 0 3px rgba(0,229,160,0.08);

## Responsive Behavior

### Breakpoint Philosophy
- Mobile-first: No — this is a power-user tool. Desktop-first. Mobile is a deliberate
  reduction of the full experience.
- Breakpoint logic: Content-based + device class
- Scaling strategy: Stepped (not fluid)

### Breakpoints
/* Desktop — full experience */
@media (min-width: 1024px) {
  /* Two-column grid: 380px panel + map */
  /* Full SOC trace bar at bottom */
  /* All instrument components visible */
}

/* Tablet (768–1023px) */
@media (min-width: 768px) and (max-width: 1023px) {
  /* Left panel becomes slide-over at 320px wide */
  /* Map fills full screen */
  /* Panel toggle button in topbar */
  /* SOC trace bar: height reduces to 52px */
}

/* Mobile (< 768px) */
@media (max-width: 767px) {
  /* Bottom sheet pattern: panel slides up 50vh */
  /* SOC trace bar hidden — replaced by compact SOC chip in topbar */
  /* Floating result card becomes full-width bottom card */
  /* Font scale reduced: text-3xl → text-2xl for data values */
  /* Panel padding: 24px → 16px */
}

### Component Adaptation
- Navigation: Topbar stays full-width; hamburger removed — use persistent icon buttons
- Left panel: 380px fixed (desktop) → 320px slide-over (tablet) → bottom sheet 50vh (mobile)
- SOC Trace Bar: Full 72px height (desktop) → 52px (tablet) → hidden/compact (mobile)
- Battery gauge: 120px (desktop) → 80px (tablet, inline with stats)
- Typography scale: no change desktop→tablet; -1 step mobile (text-3xl → text-2xl)
- Glow effects: Full intensity desktop → reduce 50% mobile (performance)
- Blur effects: None in this system (no glassmorphism)

## Data Visualization

### Chart Styling
--chart-soc-full:   #00E5A0;  — energy-safe range
--chart-soc-mid:    #F5A623;  — caution range
--chart-soc-low:    #FF4542;  — critical range
--chart-route:      #00E5A0;  — route polyline
--chart-elevation:  #4A9EFF;  — elevation profile
--chart-speed:      #7B61FF;  — speed data

--grid-color:  rgba(255,255,255,0.06);  — almost invisible grid
--axis-color:  rgba(255,255,255,0.15);  — subtle axes
--tick-size:   4px;

### Chart Principles
- Grid lines: nearly invisible (0.06 opacity) — data should stand alone
- Labels: DM Mono 0.65rem on axes, tooltip on hover only
- Legends: inline with data, not external — label the line directly
- Animations: draw-in on mount, 800ms ease-out from origin
- Interactions: hover tooltip shows exact value in DM Mono bold

## Dark Mode

This system IS dark mode. There is no light mode for the instrument panel.
For potential admin/dashboard light mode:
--bg-base-light:     #F4F5F7
--surface-light:     #FFFFFF
--text-primary-light: #111827
--accent-light:      #00A878  — darkened teal for light bg contrast
Shadow in light: standard box-shadow without glow variants

## Accessibility Specifications

### Keyboard Navigation
- Tab order: Topbar → Left Panel (top to bottom) → Map controls → Floating card → SOC trace
- Focus trap: Active on modals and expanded dropdown overlays
- Skip links: "Skip to map" and "Skip to route results" at document top (visually hidden)
- All interactive elements reachable; map is navigable via keyboard for pin placement

### Screen Reader
- Map canvas: role="main" aria-label="Interactive EV route map"
- SOC trace: role="img" aria-label="Battery charge level along route: starts at X%, arrives at Y%"
- Live results: aria-live="polite" aria-atomic="false"
- Critical banners: aria-live="assertive" aria-atomic="true"
- Heading hierarchy: h1=app name (visually hidden), h2=panel sections, h3=card titles

### Motion Preferences
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  .route-polyline { animation: none; stroke-dashoffset: 0; }
  .trace-segment  { animation: none; opacity: 1; transform: none; }
}

## Performance Guidelines

### Asset Optimization
- Image formats: WebP with AVIF fallback for map overlays
- Icons: SVG inline (not icon font — better performance and accessibility)
- Fonts: preload DM Mono 400/700 and Syne 400/600 — only these 4 weights
- Font display: swap — prevents FOIT
- Critical CSS: color variables, layout grid, topbar, left panel — inline in <head>

### Interaction Performance
- Target interaction response: < 100ms (perceived instant)
- Animation FPS: 60fps — use transform/opacity only to stay on compositor thread
- SOC trace segment render: batch DOM writes in single requestAnimationFrame
- Map tile rendering: debounce pan/zoom events by 16ms (one frame)
- Input latency: usable energy preview updates on every keydown, debounce API calls 300ms

## Code Examples

### Complete SOC Slider Component
<div class="form-field" data-field="soc_current">
  <label class="field-label" for="f-soc">
    Current Charge
    <span class="field-unit" id="soc-display"
          style="font-family:'DM Mono',monospace;color:#00E5A0">75%</span>
  </label>
  <div style="position:relative;height:6px;border-radius:9999px;background:#1E2833">
    <div id="soc-fill"
         style="position:absolute;top:0;left:0;width:75%;height:100%;
                background:#00E5A0;border-radius:9999px;
                transition:width 80ms linear,background 300ms ease;
                pointer-events:none;">
    </div>
    <input id="f-soc" type="range" min="0" max="100" value="75"
           style="position:absolute;inset:0;width:100%;
                  appearance:none;background:transparent;cursor:pointer"
           aria-valuemin="0" aria-valuemax="100" aria-valuenow="75"
           aria-label="State of charge percentage"
           oninput="
             const v=this.value;
             document.getElementById('soc-display').textContent=v+'%';
             const fill=document.getElementById('soc-fill');
             fill.style.width=v+'%';
             fill.style.background=v>60?'#00E5A0':v>20?'#F5A623':'#FF4542';
             this.setAttribute('aria-valuenow',v);
           "/>
  </div>
  <div style="display:flex;justify-content:space-between;
              font-family:'DM Mono',monospace;font-size:0.65rem;
              color:#3D4F5C;margin-top:6px;letter-spacing:0.06em">
    <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
  </div>
</div>

### Page Layout Template
<div id="app" style="
  display:grid;
  grid-template-columns:380px 1fr;
  grid-template-rows:52px 1fr 72px;
  grid-template-areas:'topbar topbar' 'panel map' 'trace trace';
  height:100vh;width:100vw;overflow:hidden;
  background:#080C10;
  font-family:'Syne',sans-serif;color:#E8EDF2;">

  <header style="grid-area:topbar;background:#0F1419;
                 border-bottom:1px solid rgba(255,255,255,0.08);
                 padding:0 24px;display:flex;align-items:center;gap:16px;z-index:10">
    <span style="font-family:'DM Mono',monospace;font-weight:700;
                 letter-spacing:0.12em;color:#00E5A0">AG</span>
    <span style="font-size:0.875rem;font-weight:600;letter-spacing:0.04em">ANTIGRAVITY</span>
  </header>

  <aside style="grid-area:panel;background:#0F1419;overflow-y:auto;
                border-right:1px solid rgba(255,255,255,0.06);padding:24px;z-index:5">
    <!-- Route input, EV profile, results -->
  </aside>

  <main style="grid-area:map;background:#0A1018;position:relative;z-index:1">
    <!-- Map canvas -->
  </main>

  <div style="grid-area:trace;background:#0F1419;z-index:8;
              border-top:1px solid rgba(255,255,255,0.08);padding:8px 24px">
    <!-- SOC Trace Bar -->
  </div>
</div>

## Utility Classes Reference
.font-mono   { font-family: 'DM Mono', monospace; }
.font-ui     { font-family: 'Syne', sans-serif; }
.text-data   { font-family: 'DM Mono', monospace; font-weight: 700; letter-spacing: -0.02em; }
.text-label  { font-family: 'DM Mono', monospace; font-size: 0.65rem; letter-spacing: 0.08em; text-transform: uppercase; color: #3D4F5C; }
.text-muted  { color: #5A6B7A; }
.text-accent { color: #00E5A0; }
.text-warn   { color: #F5A623; }
.text-danger { color: #FF4542; }
.surface     { background: #0F1419; }
.elevated    { background: #161D26; }
.border-dim  { border: 1px solid rgba(255,255,255,0.08); }
.border-glow { border: 1px solid rgba(0,229,160,0.40); }
.glow-primary{ box-shadow: 0 0 20px rgba(0,229,160,0.20), 0 0 40px rgba(0,229,160,0.08); }
.rounded-md  { border-radius: 6px; }
.rounded-lg  { border-radius: 10px; }
.rounded-xl  { border-radius: 14px; }
.pill        { border-radius: 9999px; }

## Implementation Checklist

### Component Review
- [ ] All numeric values use DM Mono font
- [ ] All uppercase labels have letter-spacing: 0.08em
- [ ] State is managed via data-* attributes, not class toggles
- [ ] Glow effects only on active/focused states
- [ ] SOC state colors applied through data-soc-state attribute
- [ ] All animations use transform/opacity only
- [ ] Disabled states have opacity: 0.35 and pointer-events: none

### Page Review
- [ ] Dark background throughout — no white surfaces
- [ ] Route polyline uses draw animation on mount
- [ ] SOC trace bar populated from API soc_trace array
- [ ] Feasibility banner uses correct color state
- [ ] All interactive elements have visible focus ring
- [ ] prefers-reduced-motion respected
```

</details>

---

## Designer 2: AXEL — "Swiss Kinetic"

_Design Style: Swiss International Typographic Style meets kinetic data — the rigor of Helvetica-era grid systems applied to real-time EV data. Light, geometric, mathematical. Every element has a calculated position._

### Visual Preview

- **Primary aesthetic:** A white-dominant precision grid. Clean like a circuit schematic, warm like a Nordic navigation app. Mathematical spacing, razor-thin rule lines, massive typographic contrast between display figures and body copy. Data is black and monospace, chrome is warm grey, actions are a single pure electric cyan.
- **Colors:** Pure white `#FFFFFF` + Near-black `#0A0A0A` + Electric cyan `#00C8FF` + Warm grey `#F5F5F3`
- **Typography:** `IBM Plex Mono` for all data; `Neue Montreal` or `DM Sans` for labels; Swiss-style tight tracking
- **Best for:** Consumer-facing EV apps, clean mobile interfaces, enterprise fleet dashboards

### Signature Moves

- Mathematical grid: 8px base unit, everything aligned to 4px sub-grid
- Heavy typographic contrast: 72px route distance in black, 11px grey label below it
- Thin `1px solid #E8E8E6` borders on all surfaces — structural, not decorative
- Negative space as a design element — generously empty panels that feel premium
- Cyan highlight appears in exactly ONE place per screen at any time — like a cursor

### Example Mental Image

> Stark white app opens. A warm grey map fills the right two-thirds — slightly washed out, almost a technical drawing. The left panel is white with thin hairline borders. "FROM" label in 11px uppercase tracked letters, a clean input below. Below that, in 72px IBM Plex Mono bold black: `12.4 km`. Beneath it: `2.18 kWh` in the same scale. Below that, a single line of cyan — the SOC trace — running edge to edge as a 4px colored rule. Simple. Surgical. Mathematical.

---

<details>
<summary><strong>→ View Complete Design System: Axel / Swiss Kinetic</strong></summary>

```
# Design System Specification — Antigravity AI / Axel / Swiss Kinetic

You are implementing a Swiss International Typographic Style design system
characterized by mathematical grid discipline, extreme typographic hierarchy,
white-dominant surfaces, and a single electric cyan accent used with restraint.

## Color Palette

### Primary Colors
- primary:        #00C8FF  — electric cyan. ONE accent only. Use for: active state only.
- primary-hover:  #00AEDE  — slightly deeper cyan
- primary-light:  rgba(0,200,255,0.08)  — for focus rings only

### Neutral Scale
- neutral-50:  #FFFFFF  — Pure white. Primary surface.
- neutral-100: #F8F8F6  — Off-white. Alternate surface.
- neutral-150: #F2F2F0  — Hover background.
- neutral-200: #E8E8E6  — Hairline borders. Rule lines.
- neutral-300: #D0D0CC  — Disabled borders.
- neutral-400: #B0B0AA  — Placeholder text.
- neutral-500: #888884  — Secondary text.
- neutral-600: #606060  — Body text.
- neutral-700: #383838  — Sub-headings.
- neutral-800: #1A1A1A  — Headings.
- neutral-900: #0A0A0A  — Maximum contrast. Display numbers.

### Semantic Colors
- success: #00A878  — restrained green
- warning: #E8890A  — amber
- error:   #D94040  — red
- info:    #00C8FF  — same as primary

### Special Effects
- shadow-sm:  0 1px 3px rgba(0,0,0,0.08)
- shadow-md:  0 2px 8px rgba(0,0,0,0.10)
- shadow-lg:  0 4px 24px rgba(0,0,0,0.12)
- rule-line:  1px solid #E8E8E6
- rule-strong: 2px solid #0A0A0A  — for data separators
- focus-ring: 0 0 0 2px rgba(0,200,255,0.40)

## Typography System

### Font Stack
font-family: 'IBM Plex Mono', 'Courier New', monospace;  — all numeric data
font-family: 'DM Sans', 'Outfit', sans-serif;            — labels and body

### Type Scale (Swiss discipline — large contrast between display and body)
- text-xs:   0.6875rem / 1.0rem   — micro: tags, coordinates
- text-sm:   0.75rem   / 1.2rem   — labels (11px equivalent at base 16)
- text-base: 0.875rem  / 1.5rem   — body text (14px)
- text-lg:   1rem      / 1.6rem   — card content
- text-xl:   1.25rem   / 1.5rem   — section headings
- text-2xl:  1.75rem   / 1.2rem   — panel titles
- text-3xl:  2.5rem    / 1.1rem   — stat values
- text-4xl:  4rem      / 1.0rem   — hero display numbers (distance, energy)
- text-5xl:  5.5rem    / 1.0rem   — full-screen SOC percentage

### Font Weights
- Display numbers:  700  — IBM Plex Mono heavy
- Headings:         600  — DM Sans semi-bold
- Body:             400  — DM Sans regular
- Labels:           500  — DM Sans medium
- Monospace body:   400  — IBM Plex Mono regular

### Letter Spacing (Swiss precision)
- Uppercase labels: letter-spacing: 0.10em  — classic Swiss wide tracking
- Display numbers:  letter-spacing: -0.03em — optical tightening
- Body text:        letter-spacing: 0.01em

## Spacing System (8px base — mathematical)
- space-1:  4px
- space-2:  8px
- space-3:  12px (8 + 4)
- space-4:  16px (8 × 2)
- space-5:  24px (8 × 3)
- space-6:  32px (8 × 4)
- space-8:  48px (8 × 6)
- space-10: 64px (8 × 8)
- space-12: 80px (8 × 10)
- space-16: 128px (8 × 16)

## Component Specifications

### Buttons — Primary
padding: 12px 24px;
background: #0A0A0A;
color: #FFFFFF;
border: none;
border-radius: 4px;
font-family: 'DM Sans', sans-serif;
font-weight: 600;
font-size: 0.875rem;
letter-spacing: 0.02em;
transition: background 150ms ease;

/* Hover */
background: #383838;

/* Active */
transform: scale(0.99);

### Input Fields
height: 48px;
padding: 0 16px;
border: 1px solid #E8E8E6;
border-radius: 4px;
background: #FFFFFF;
color: #0A0A0A;
font-family: 'DM Sans', sans-serif;
font-size: 0.875rem;
transition: border-color 200ms ease;

/* Focus */
border-color: #00C8FF;
box-shadow: 0 0 0 2px rgba(0,200,255,0.15);
outline: none;

### Cards
padding: 24px;
background: #FFFFFF;
border: 1px solid #E8E8E6;
border-radius: 4px;
box-shadow: 0 1px 3px rgba(0,0,0,0.06);

/* Stat cell (large number + label) */
display: flex;
flex-direction: column;
gap: 4px;
padding: 16px 0;
border-bottom: 1px solid #E8E8E6;

.stat-value { font-family: 'IBM Plex Mono'; font-weight: 700; font-size: 2.5rem; color: #0A0A0A; }
.stat-unit  { font-family: 'IBM Plex Mono'; font-size: 0.75rem; color: #888884; }
.stat-label { font-family: 'DM Sans'; font-size: 0.6875rem; letter-spacing: 0.10em; text-transform: uppercase; color: #B0B0AA; }

### SOC Trace Bar (Swiss variant)
/* A single 4px rule line instead of segments */
height: 48px;
background: #F8F8F6;
border-top: 1px solid #E8E8E6;
padding: 0 32px;
display: flex;
align-items: center;
gap: 16px;

/* The trace is a thin colored rule */
.soc-rule { height: 4px; flex: 1; border-radius: 2px; }
/* Fill using linear-gradient from start-soc color to end-soc color */
background: linear-gradient(to right, #00A878 0%, #E8890A 70%, #D94040 100%);

### Layout Principles
- Container max-width: 1400px centered
- Grid: 12 columns, 24px gap
- Left panel: 360px fixed
- Content padding: 32px
- Section spacing: 48px top/bottom
- Mobile breakpoint: 768px
- Typography baseline grid: 8px
```

</details>

---

## Designer 3: RHEA — "Bioluminescent Depth"

_Design Style: Deep-sea bioluminescence meets spatial computing — inspired by Apple Vision Pro spatial UI, deep ocean organism glow, and aurora borealis color science. Layered depth, organic glow, animated light emission._

### Visual Preview

- **Primary aesthetic:** Multiple depth layers create the feeling of looking through water at glowing organisms below. Background is `#030810` — ocean-floor deep. Cards float at different z-depths, each layer slightly lighter. Accent colors are bio-organic: phosphorescent lime-green for energy-safe, deep amber for caution, and crimson pulse for danger. Everything glows softly, breathes.
- **Colors:** Ocean void `#030810` + Phosphor green `#39FF7A` + Deep amber `#FF9A3C` + Bio-teal `#00D4D4`
- **Typography:** `Oxanium` for data (sci-fi geometric mono); `Manrope` for UI (organic humanist)
- **Best for:** Premium consumer EV apps, forward-looking brand statements, futuristic product showcases

### Signature Moves

- `backdrop-filter: blur(12px) saturate(150%)` on floating cards — liquid depth between layers
- Organic glow animations: pulsing `box-shadow` at 3s intervals simulates bioluminescence
- Background mesh gradient: 3-color radial mesh shifts subtly at 10s intervals
- Route polyline rendered with SVG filter `feGlow` — the path emits light into the map
- Depth-stacked cards: each layer uses a progressively lighter background stop

### Example Mental Image

> A near-void background pulsates with a barely-visible deep teal mesh — like bioluminescent plankton at rest. The map tiles are dark-filtered to 40% brightness, making the glowing route polyline the most luminous object on screen. It pulses with a soft inner glow. Station markers are small bioluminescent orbs — bright green if compatible, amber if membership-required. The charging stop card floats above the map like an AR overlay, blurred glass frosted from behind, a soft green halo around its border. The SOC trace bar glows like a phosphorescent sea creature, each segment breathing light as you hover over it.

---

<details>
<summary><strong>→ View Complete Design System: Rhea / Bioluminescent Depth</strong></summary>

```
# Design System Specification — Antigravity AI / Rhea / Bioluminescent Depth

You are implementing a Bioluminescent Depth design system characterized by
deep-ocean dark backgrounds, organic glow light emission, layered glass
surfaces with backdrop-filter blur, and living animated accents.

## Color Palette

### Primary Colors
- primary:        #39FF7A  — phosphor green. Use for: SOC full, safe route, primary CTA
- primary-glow:   rgba(57,255,122,0.20)
- secondary:      #00D4D4  — bio-teal. Use for: info states, route overlay, charger markers
- secondary-glow: rgba(0,212,212,0.15)

### Neutral Scale (Ocean void system)
- neutral-50:  #030810  — ocean floor. Root background.
- neutral-100: #060D18  — first depth. Base panel.
- neutral-200: #0C1826  — second depth. Cards, surfaces.
- neutral-300: #132436  — third depth. Elevated cards.
- neutral-400: #1E3348  — fourth depth. Inputs.
- neutral-500: #2E4A60  — separator/border color
- neutral-600: #4A6B82  — muted text
- neutral-700: #7A9BB5  — secondary text
- neutral-800: #B5CEDF  — body text
- neutral-900: #EAF2F8  — primary text

### Semantic Colors
- success: #39FF7A  — phosphor green (= primary)
- warning: #FF9A3C  — deep amber bioluminescence
- error:   #FF4560  — crimson pulse
- info:    #00D4D4  — bio-teal

### Special Effects
- blur-glass:          backdrop-filter: blur(12px) saturate(150%)
- blur-light:          backdrop-filter: blur(6px) saturate(120%)
- bg-glass-dark:       background: rgba(12,24,38,0.70)
- bg-glass-mid:        background: rgba(19,36,54,0.80)
- glow-primary:        0 0 20px rgba(57,255,122,0.30), 0 0 60px rgba(57,255,122,0.10)
- glow-secondary:      0 0 20px rgba(0,212,212,0.25), 0 0 50px rgba(0,212,212,0.08)
- glow-warning:        0 0 20px rgba(255,154,60,0.30)
- glow-danger:         0 0 20px rgba(255,69,96,0.30)
- mesh-gradient:       radial-gradient(ellipse at 20% 50%, rgba(0,212,212,0.08) 0%, transparent 60%),
                       radial-gradient(ellipse at 80% 20%, rgba(57,255,122,0.05) 0%, transparent 50%),
                       radial-gradient(ellipse at 50% 90%, rgba(255,154,60,0.04) 0%, transparent 40%)
- pulse-animation:     keyframes pulse-bio {
                         0%,100% { box-shadow: glow-primary; }
                         50%     { box-shadow: 0 0 35px rgba(57,255,122,0.45), 0 0 80px rgba(57,255,122,0.15); }
                       }
                       animation: pulse-bio 3s ease-in-out infinite;

## Typography System

### Font Stack
font-family: 'Oxanium', 'Share Tech Mono', monospace;  — data, numbers, labels
font-family: 'Manrope', 'Plus Jakarta Sans', sans-serif; — UI, body, headings

### Type Scale
- text-xs:   0.65rem / 1.0rem
- text-sm:   0.75rem / 1.2rem
- text-base: 0.875rem / 1.5rem
- text-lg:   1rem    / 1.6rem
- text-xl:   1.25rem / 1.5rem
- text-2xl:  1.5rem  / 1.8rem
- text-3xl:  2rem    / 1.2rem
- text-4xl:  2.75rem / 1.1rem
- text-5xl:  4rem    / 1.0rem

### Font Weights
- Display (Oxanium):  700
- Headings (Manrope): 700
- Body (Manrope):     400
- Labels (Oxanium):   500

## Component Specifications

### Buttons — Primary (Bio-glass style)
padding: 13px 22px;
background: rgba(57,255,122,0.12);
border: 1px solid rgba(57,255,122,0.35);
border-radius: 8px;
color: #39FF7A;
font-family: 'Oxanium', monospace;
font-weight: 600;
font-size: 0.875rem;
backdrop-filter: blur(6px);
box-shadow: 0 0 12px rgba(57,255,122,0.10);
transition: all 200ms ease;

/* Hover */
background: rgba(57,255,122,0.20);
box-shadow: 0 0 24px rgba(57,255,122,0.25);
transform: translateY(-1px);

### Input Fields
height: 46px;
padding: 0 16px;
background: rgba(30,51,72,0.70);
border: 1px solid rgba(74,107,130,0.50);
border-radius: 8px;
color: #EAF2F8;
font-family: 'Oxanium', monospace;
backdrop-filter: blur(8px);
transition: border-color 200ms ease, box-shadow 200ms ease;

/* Focus */
border-color: rgba(0,212,212,0.60);
box-shadow: 0 0 0 3px rgba(0,212,212,0.10), 0 0 20px rgba(0,212,212,0.12);

### Glass Cards
padding: 20px;
background: rgba(12,24,38,0.75);
border: 1px solid rgba(74,107,130,0.25);
border-radius: 14px;
box-shadow: 0 4px 24px rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.05);
backdrop-filter: blur(12px) saturate(140%);

/* Active route card */
border-color: rgba(57,255,122,0.30);
box-shadow: 0 0 30px rgba(57,255,122,0.10), 0 4px 24px rgba(0,0,0,0.50);
animation: card-reveal 450ms cubic-bezier(0.22,1,0.36,1) forwards;

### SOC Trace Bar (Bio variant)
/* Segments glow, not just color */
.trace-segment[data-soc-state="full"]   { background: #39FF7A; box-shadow: 0 0 8px rgba(57,255,122,0.6); }
.trace-segment[data-soc-state="medium"] { background: #FF9A3C; box-shadow: 0 0 8px rgba(255,154,60,0.5); }
.trace-segment[data-soc-state="low"]    { background: #FF4560; box-shadow: 0 0 8px rgba(255,69,96,0.5); }

/* Hover: glow intensifies */
.trace-segment:hover {
  filter: brightness(1.4);
  box-shadow: 0 0 14px rgba(57,255,122,0.9);
}

### Background System
/* Root background: ocean floor + mesh gradient */
body {
  background: #030810;
  background-image:
    radial-gradient(ellipse at 20% 50%, rgba(0,212,212,0.08) 0%, transparent 60%),
    radial-gradient(ellipse at 80% 20%, rgba(57,255,122,0.05) 0%, transparent 50%);
  background-attachment: fixed;
}

/* Animate mesh subtly */
@keyframes mesh-drift {
  0%,100% { background-position: 20% 50%, 80% 20%; }
  50%     { background-position: 25% 45%, 75% 25%; }
}
/* animation: mesh-drift 10s ease-in-out infinite — very subtle */

## Implementation Rules

### DO:
- Apply backdrop-filter: blur() on ALL floating cards and panels
- Use phosphor green for success states — it matches the bioluminescent metaphor
- Animate glow shadows (not transforms) to simulate breathing/pulsing organisms
- Layer backgrounds from #030810 (void) through progressively lighter stops
- Render route polyline with SVG feDropShadow filter for glow effect
- Use border: 1px solid rgba(74,107,130,0.25) as default — low opacity, feels underwater

### DON'T:
- Never use flat/opaque card backgrounds — all surfaces need transparency + blur
- Never remove backdrop-filter for performance shortcuts — it's the core visual
- Never use sharp/angular shapes — everything has border-radius ≥ 8px
- Never use pure white text (#FFF) — use #EAF2F8 (ocean-tinted white)
- Never animate background properties — use transform/opacity only

### Performance Note for backdrop-filter
- backdrop-filter creates a new stacking context — use sparingly (max 4–5 simultaneously)
- On mobile: reduce blur from blur(12px) to blur(6px) to maintain 60fps
- Test on mid-range Android — backdrop-filter is GPU-intensive
- Fallback: background: rgba(12,24,38,0.90) with no blur for older browsers
```

</details>

---

## Quick Selection Guide

| Goal                                                                   | Choose                          | Why                                                                                               |
| ---------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------- |
| Production EV instrument panel, fleet management, OEM integration      | **Vera — Aerospace HUD**        | Dark-first, data-dense, instrument precision. Optimized for glance-ability and trust.             |
| Consumer-facing app, enterprise dashboard, accessibility priority      | **Axel — Swiss Kinetic**        | Light, legible, mathematical. Highest contrast ratios. WCAG AAA on key elements.                  |
| Premium brand statement, forward-looking product, immersive experience | **Rhea — Bioluminescent Depth** | Organic depth, visual drama, spatial computing aesthetic. Best for demos and premium positioning. |

**Usage:** Copy your chosen design system block → Paste into your AI coding tool as system context → Reference it by name (Vera / Axel / Rhea) when building each component.
