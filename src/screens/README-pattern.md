# Screen pattern ("Sunday Broadcast") — copy this for every D* push

The reference implementation is `src/screens/Staff.tsx`. Read it before you start.
The design system lives in `NEXT_PHASE_UI_REDESIGN.md` (sections 1–8). The rules below are
the parts a screen pass must follow. If a rule needs a kit, store or engine change,
**stop and hand back**. Do not edit `src/ui/*`, `src/components/DataTable.tsx`,
`src/lib/format.ts`, `src/index.css`, `gameStore.ts` or engine files.

## 1. Imports

```ts
import { cn } from '../lib/cn'
import { ELITE, money, mult, signed, STAFF_BASELINE, capTone, jobTone } from '../lib/format' // signed() uses U+2212
import {
  PageHeader, Card, SectionTitle, Tabs, SegmentedControl, FilterChip,
  KpiStrip, KpiTile, VerdictChip, DivergingMeter, TierScale, BudgetMeter,
  RatingTile, TierLegend, Delta, Effect, Money, SchemeChip,
  Button, OverflowMenu, ConfirmSheet, Sheet, Dialog, Inspector, WithInspector,
  GatedAction, AccessBanner, Avatar, VacantSeat, OptionGroup, OptionCard,
  type MenuItem, type Consequence,
} from '../ui/kit'
import { gateMenuItem, useAccessLevel, usePhone, useMediaQuery, WIDE_QUERY } from '../ui/hooks'
import { DataTable, type Column } from '../components/DataTable'
```

Do not hand-roll a tab bar, segmented toggle, chip, dialog, menu, table or rating badge.
The kit already has each of these.

## 2. Page structure (top to bottom)

1. `PageHeader` with eyebrow = the nav group ("Club"), the title and a one-sentence
   subtitle. Put the view switch in `right` as a `SegmentedControl` (never team-filled).
2. `Tabs` (underline, with a `count`) when the screen has sections. Pass `stretch={phone}`.
3. `AccessBanner area="…"` when the screen has an access area (see `AREA_BY_SCREEN` in
   `src/ui/nav.ts`). It renders nothing at 'decide'. Gating lives on the screen, not the top bar.
4. `KpiStrip` of `KpiTile`s: no more than 5, and fewer than 5 if fewer facts exist.
5. Optional "needs a call" or alignment card (Staff: System Check).
6. The main content. Chart/cards **or** `DataTable`, with an `Inspector` for the selected row.
7. Overlays at the end of the component: `ConfirmSheet`, `Sheet`.

Do not repeat top-bar facts (record, job, cap, team OVR, next game) on the screen.

## 3. KPI strip

- The value is **neutral ink**, always. Never colour a big number. Status goes only in
  `verdict={{ label, tone }}` (the chip) and in the meter.
- Every tile explains itself on the surface in `why`: the baseline, the unit and the reason.
  No hover-only explanations, no bare numbers.
- Clamped values: use a `DivergingMeter` with `floor` / `cap`, plus a verdict such as "At the floor".
  Then say in words what moves it, e.g. "A coordinator rated 52+ is the first hire that moves it".
- Compute clamp facts from engine functions, never by hand. See `engineLimits()` and
  `staffChangeImpact()` in `src/components/staffEffects.ts`, which probe `coachEffect()`.
- For money against a budget, use `BudgetMeter`. Over budget is **warn**, not loss.
- Phone (under 640px) shows 2 columns. Hide a low-value tile with `className="max-sm:hidden"` and fold its
  fact into another tile's `why` (wrap it in `<span className="sm:hidden">`).

## 4. Ratings

- Always use `RatingTile` (sizes sm 32 / md 40 / lg 56). Add `tierWord` on cards and `delta` for "−17 vs avg".
  In tables, use `pipsFor={(r) => r.rating}` on the DataTable.
- Tiers: Elite is 90+ (`ELITE`). 58–65 Depth is a grey outline. **50–57 Weak is an amber outline. Under 50
  Liability is a red outline.** No tile is ever filled red. Never call `gradeColor` / `inkOn` / `valueClass`.
- Put a `TierLegend` on rating-heavy screens.

## 5. Colour rules

- **No hex literals and no `text-white` / `bg-black` utilities.** Use tokens such as `text-ink`, `text-ink-2`,
  `text-muted`, `bg-surface`, `bg-surface-2`, `border-line`, `border-line-strong`, `text-win`, `text-warn` and `text-loss`.
- Team colour is identity only. Allowed uses: `var(--team-accent)` for marks and underlines,
  `var(--team-accent-text)` for eyebrow text, `var(--team-fill)` with `var(--team-on)` for skewed role/unit
  tags and the `Card tier="feature"` slab, and `var(--team-tint)` for selected rows. Never use it for status, a
  rating or a selected chip fill.
- **Red means a real problem only**: Liability, a negative edge, over the cap, an injury, or the final destructive
  confirm. "Below average" is not red. Interest "Cold" is warn. Budget overage is warn.
- **No resting red button.** `variant="danger"` is deprecated. Destructive actions sit in ⋯ and use
  `danger: true` (red text), which leads to a `ConfirmSheet`. Its confirm is the only solid red.

## 6. Tables

Use one shared `DataTable`. Give **every column a card role** so phones get readable card rows:

| role | use for |
|---|---|
| `card: 'title'` | the name column (also the sticky column, key `name`) |
| `card: 'meta'` | short chips/lines that may wrap: scheme, **long effect text** |
| `card: 'aside'` | the rating tile and the ⋯ menu (right side of the card) |
| `card: 'value'` | short label/value pairs: Δ, contract, age |
| `card: 'hidden'` | low-value columns (specialty) |

Long `whitespace-nowrap` content in a `value` cell overflows into the next column on
phone. Make it `meta`. Other table rules:

- `sortValue` must return a **number** for numeric columns. Effect columns sort by a comparable number, not a string.
- Use `groupBy` / `groupLabel` for sections ("Offense · System: West Coast").
- `onRowClick` + `selectedKey` + `Inspector`, not hover cards. `maxHeight="none"` when the page scrolls.
- Money is right-aligned and tnum. Table text is upright Inter (the default), never italic.

## 7. Actions: ⋯, GatedAction, ConfirmSheet

```ts
const level = useAccessLevel('staff')            // 'decide' | 'advise' | 'view' | 'locked'
// No store-backed recommendation for this action? Treat 'advise' as gated:
const gate = level === 'advise' ? 'view' : level
items.push(gateMenuItem(gate, { id: 'fire', label: 'Let go…', danger: true,
  description: 'Opens a review of what it costs', onSelect: () => setFiring(m) },
  { reason: 'The GM signs off on staff moves at your rung' }))
```

- Never ship a control that ends in a "you can't do that" toast. The store actions toast at
  non-decide levels, so a button that calls them at 'advise' is a **dead control**.
- 'Recommend…' (the `advise` label) is allowed **only** if a real store action records the
  recommendation (for example the GM request desk: `requestGmRelease`, `requestGmTrade`,
  `requestGmSignFreeAgent`, `requestGmRestructure`). Otherwise disable the control and show the reason.
- `GatedAction level={gate} reason={…}` for buttons. `gateMenuItem` for ⋯ items.
- Irreversible action: ⋯ item, then `ConfirmSheet` with
  - `title` "Let go Elijah Chase?" and `subtitle` (role · rating · scheme)
  - `consequences`: money, the seat or roster spot, and engine **before → after** ("Offense edge / snap −4.5 → +0.0 (leaves the floor)")
  - `saferAlternative` ("Find a replacement first")
  - `ledgerNote={null}` **unless the store action really writes to The Ledger** (fireStaff and hireStaff don't)
- Call store actions **exactly as before**: same function, same arguments. The ConfirmSheet only
  sits in front of the call.

## 8. Phone rules (under 640/768px)

- `usePhone()` is under 640px. No horizontal page scroll at 375. Targets are at least 44px (kit controls handle
  `pointer-coarse` themselves). Form controls use 16px text: `max-sm:h-11 max-sm:text-[16px]`.
- Filter rows collapse into a `Filters (n)` button that opens a `Sheet`.
- Wide comparison cards collapse to one row that opens a `Sheet` (Staff: System Check).
- No hover-only information. `Inspector` becomes a bottom sheet automatically below 1280px.
- Minimum text is 12px (`text-label`). 11px (`text-micro`) is only for units and axis ticks. No `text-[7-10px]`.

## 9. Type

- Display (condensed 800 italic, uppercase) is for page and card titles, names on cards and KPI values.
- Body text is Inter `text-body` / `text-small`. Labels use `.label` (12px, uppercase, muted).
- Use U+2212 minus via `signed()` and × via `mult()`.

## 10. How to verify (every push)

```bash
PATH="$HOME/.local/node/bin:$PATH"
npm run build                       # must pass
npm run lint                        # EXACTLY 4 warnings
bash scripts/check-hex.sh <your files>
node --experimental-strip-types scripts/check-contrast.ts   # PASS
```

Then check the screen in a browser (dev server and throwaway careers via
`(await import('/src/store/gameStore.ts')).useGame.getState().startCareer({...})`), and
`setScreen('<id>')`:

- 1440×900 and 375×812, light and dark (set `localStorage['gd.theme']`, not only `data-theme`), CLE, PIT and KC.
- Open every ⋯ and every ConfirmSheet on phone and desktop. At 'decide', confirm the
  store state really changed. At 'advise', confirm no enabled control produces a toast.
- No feature removed: every sort, filter, tab, action and readout must still be reachable.
- `git diff --stat` touches only your listed files.
