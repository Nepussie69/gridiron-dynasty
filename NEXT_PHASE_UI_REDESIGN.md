# NEXT PHASE — UI redesign "Sunday Broadcast" (user request 2026-10-10, backlog 177/184)

_Chosen by the user on 2026-10-10 from three directions (Sunday Broadcast / Front Office / Modern Sports App) after a 12-agent audit + design + judge workflow; all three judges picked Sunday Broadcast (weighted 49.3 vs 44.8 vs 43.8). Reference mockup: `docs/redesign/direction-broadcast.html` (Staff & Hiring, desktop 1440 + phone 390, dark + light). Builds on Broadcast 2.0 (`NEXT_PHASE_UI.md`, merged)._

## Why this direction

All three judges picked Sunday Broadcast: Player/UX scored it 51 vs 45 vs 42, Visual 48 vs 46 vs 45, and Engineering 47 vs 45 vs 44. Weighting the player lens most (0.5 player, 0.3 visual, 0.2 build) gives Broadcast 49.3, Modern 44.8 and Front Office 43.8.

**Why Broadcast wins**
- It fixes every problem in the current Cleveland Staff screenshot:
  - Low rating tiers become outlines instead of solid red, so 57 and 53 read as amber WEAK and 48, 46 and 45 as red-outline LIABILITY. Each tile also shows "−17 vs avg".
  - LET GO moves into a ⋯ menu that leads to a review sheet offering "Find a replacement first".
  - A System Check names the two schemes the sim actually uses (OC West Coast, DC 4-3 Base) and marks every other coach that runs a different one.
  - −9.0 and ×0.84 are explained on the tile itself.
  - The 9-chip top bar becomes three zones with verdict words (HOT SEAT, TIGHT) and one CTA.
  - The DYNASTY wordmark uses a contrast-checked accent colour.
- It is the only direction that feels like a football dynasty game rather than SaaS or a generic sports app.
- It is also the cheapest to roll out. It keeps the current type system (font-cond 462 uses, uppercase 439, font-display 228), the token names and the existing Broadcast 2.0 game-day look. Most screens change by swapping components, which DeepSeek Flash handles reliably.

**Gaps the grafts close**
- Coach cards are not dense enough: add Front Office's grouped DataTable and inspector.
- Italics are overused: keep italics for display text and numbers only, and use upright Inter in tables.
- Very dark team primaries vanish on dark slabs: add a luminance lift and ring.
- Light-mode chips wrap: set nowrap.
- The light Weak amber fails contrast: darken it.
- The CTA's label swap can hide Advance: keep Advance one tap away.

**Should Claude do it?** Yes for the foundation, no for the rest.
- Claude should own the cross-cutting layer: tokens, rating tiers, team-accent contrast maths, the kit, AppShell and the phone shell, plus the Staff pilot. This needs one owner with design judgement, and the skew and slab details are the easiest to drift if several hands build them.
- After that, DeepSeek can run the per-screen rollout as parallel worktree pushes against the finished kit and the Staff reference screen. Each push only consumes primitives that already exist.

## Ideas grafted from the other directions

- From Front Office: the Table view becomes a real dense alternative built on the kit DataTable. Group rows read 'OFFENSE · System: West Coast'. Columns are Coach / Scheme (with a ≠ OC or ≠ DC marker) / Effect (with a FLOOR tag) / Rating tile + pips / Δ vs avg / Contract ('$2.2M × 3y') / ⋯. The Effect column sorts numerically, table rows use upright Inter tabular figures, and the chosen view is remembered per viewer.
- From Front Office: a selection inspector replaces hover cards. It is a right-hand column at 1280px and above, and a bottom sheet below that. It shows the rating against the league track (with a '#24 of 32' rank where staff peer data is cheap), 'What he does' in plain words, the scheme-conflict sentence, the contract with remaining dollars and share of payroll, and 'Compare with market'.
- From Front Office: the ConfirmSheet consequence table includes before → after engine truth, for example 'Offense edge −4.5 → −4.5 (already at floor)' and 'Remaining contract $6.6M (3 yr)'.
- From Front Office: vacant seats state what they cost, for example '+ Analytics · vacant: no analytics read on 4th-down and 2-pt calls', with a 'Recommend a hire' action (gated by access).
- From Front Office: pips (5/4/3/2/1) next to RatingTile in table and dense modes, so a tier is never shown by colour alone.
- From Front Office: the Payroll KPI is a budget meter, '$20.3M of $35.4M · 57% used', labelled as advisory.
- From Front Office: a keyboard layer. J/K moves the row, Enter opens, '.' opens actions, ⌘↵ advances, and every shortcut is listed in the command palette. G+letter jumps are deferred to a later phase.
- From Modern Sports App: diverging SVG meters on the On-field impact KPI (−9 floor | 0 | +9) and the Development KPI (×0.80 floor | ×1.00 | ×1.20), with the marker pinned at the floor.
- From Modern Sports App: every -soft and tier-wash token is built with color-mix(in srgb, tone N%, transparent), and a single dark selector list replaces the duplicated dark blocks.
- From Modern Sports App: the System Check labels the OC and DC chips 'Drives play-calling', adds a footnote that only coordinator schemes reach the sim, and adds a ✓ match chip variant. ST shows 'no effect', not 'match'.
- From Modern Sports App: on phone, the System Check collapses to a single row, '5 scheme clashes · West Coast / 4-3 Base ›', which opens a sheet.
- From Modern Sports App: 'Best on staff' and 'Lowest rated' tags, plus a 'feeds program ×0.84' explanation on position-coach dev lines.
- From Modern Sports App: the confirm footer reads 'Sent to the GM as a recommendation · logged in The Ledger'.
- From Modern Sports App / Front Office: on phone, Advance week stays one tap away even when the CTA reads Coach. The score-strip slab becomes two segments, [Coach ▸ | ⏭ Sim week], and shows [Advance ▸] when no coachable game is pending.
- Visual-judge correction: large KPI numbers are always neutral ink. Status colour appears only in the verdict chip and the meter, so there are no 52px red numbers.

## Must fix (from the audit)

- The rating colour scale: gradeColor (format.ts:33-39) paints everything under 66 solid red with hard-coded light-mode hex values, so staff rated 45-57 form an identical red wall and about 48% of NFL players show red. inkOn (format.ts:14-21) uses a YIQ test and picks white on amber (2.94:1) and on mid-green (3.2:1). At least four conflicting scales exist (PlayerHoverCard, RatingsTable, PlayerTable valueClass, Staff, LockerRoomCard) and four different 'elite' cut-offs (>80, ≥82, ≥85, ≥88).
- Team colour is used as foreground with no contrast guard. 23 of 32 primaries are below 3:1 on the dark surface (CLE #311D00 is 1.08:1, which makes the DYNASTY wordmark, the active nav pill and the inbox badge invisible), and PIT is 1.76:1 on white. --team-soft is resolved on :root, so all 67 uses are a blue wash. The team vars exist only on the AppShell div, so PlayerProfile, SeasonModal, MatchView and the portals fall back to #0b62ff.
- Cap-space units bug: AppShell.tsx:420 and Dashboard.tsx:143/146 compare dollars against 5, 25 and 60, so $885K shows green with a full bar. There are six separate cap thresholds across the app.
- Destructive actions are loud at rest and get no confirm: LET GO on every staff card (Staff.tsx:814, 916), Cut on every cap ledger and practice-squad row, Restructure, Sign, Propose and Accept trade, Tag and Exercise, 'Complete the draft', 'Start fresh' (CareerHub, no confirm at all), 'New Career' in the sidebar footer, the SeasonModal X that declines every job offer, and abandoning a game in MatchView. The kit has no confirm or sheet primitive.
- Access gating is cosmetic. Staff.tsx never calls accessFor(), and at the Advisor level (NFL HC) every Let Go, Hire and Focus button is a dead control that ends in a toast. The only cue is an unexplained top-bar badge that is hidden below lg.
- Phone is unsupported. The 68px rail always stays in the layout and main uses p-5, leaving about 267px of content at 375px. There is no drawer or bottom nav. The top bar hides record, OVR, cap, access, week, opponent, job security and the sim toggle with no replacement. The layout uses 100vh with no safe areas, touch targets are 16-24px, and hover-only explanations are common.
- Unexplained derived numbers: 'On-field impact −9.0' is the clamp floor but is never stated, 'Dev ×0.84' is a program-wide average shown per coach, 'Staff rating 49' and its 'Poor staff' label come from different formulas, and the Cap Health indices and trade-value points have no units.
- Scheme clashes are invisible. Only the OC and DC schemes reach the sim, yet the HC's cosmetic scheme is shown on the Dashboard and the ST coordinator carries an offensive scheme. The engine bug `coach.scheme !== coach.scheme` (gameStore.ts:4485) means cohesion copy would be false.
- Top bar overload: about 12 equal-weight items, labels that wrap, the club name truncated to 'CLEVE…', hard-coded white on the team gradient (fails for 17 clubs), job security untoned and hidden below xl, and two competing CTAs plus a loose sim toggle.
- Contrast and type debt: about 466 sizes below 12px (down to 7px), text-faint at 2.84:1 on white, light Badge tones from 2.61:1 to 4.33:1, borders at 1.35:1, dark brand-soft equal to surface-2, no focus-visible styles, about 149 hex literals in .tsx files, and 248 white/black utilities.
- Dark-mode token leaks on Game Day: bg-white + text-ink active states measure 1.17:1, and PlanEditor and PersonnelCard sit inside a hard-coded white box. On phone the 42vh side panel crushes the field at decision time.
- The kit has no Tabs/SegmentedControl (12+ hand-rolled versions), OptionCard, IconButton, Dialog/Sheet, OverflowMenu, KPI-with-explanation, Delta/Money or a shared table with a phone mode. Four or five table implementations disagree, and there are 57-83 `!important` overrides.
- Correctness bugs to fix during the rollout: DeadlinePanel marks every offer 'Accepted'; ExtensionTalks previews the old contract; the FA row shows a stale $0 and Sign also opens the profile through click bubbling; a literal '—' renders in the FA banner; ContractExplainer shows an unnamed player; Schedule PPG divides by 17; Standings has no header row and paints leaders in your team colour; History repeats column headers; the Dashboard Vegas line is fake, the Game Plan link points to Schedule and the ordinals render '2th'; the Staff vacant count assumes 10 seats; the CareerHub accordion changes the start level; Inbox shows fake Suggested Actions; Profile has a dead Trade Block button; and the CommandPalette AREA_BY_SCREEN has drifted.

## Design system

GRIDIRON DYNASTY: "SUNDAY BROADCAST" DESIGN SYSTEM (FINAL)

1. PRINCIPLES
- Separate identity from meaning. Team colour is a fill slab or a contrast-checked accent and never means good or bad.
- Red means a real problem for you: Liability tier, negative edge, over cap, injury, or the final destructive confirm. It never means "below average", a category, or a button at rest.
- One primary action per bar and per view. Destructive actions go through ⋯, then a ConfirmSheet that lists the consequences.
- No bare numbers. Every value shows its unit, baseline and reason on the surface (sub-line or meter), never only on hover.
- Each fact is shown once. The top bar owns Record, Job, Cap, OVR and Next game, and screens don't repeat them.
- Phone is first class: bottom tabs, 16px gutters, 44px targets, no hover-only information.
- Type: condensed italic is for display text and numbers on cards and heroes only. Body text and tables use upright Inter (Semi Condensed for labels). Minimum size is 12px, with 11px allowed only for units inside a rating tile and axis ticks.

2. COLOUR TOKENS (index.css @theme = light; a single dark block selected by `@media (prefers-color-scheme: dark){:root:not([data-theme=light])}` plus `:root[data-theme=dark]`)

| Token | Dark | Light |
|---|---|---|
| canvas | #090D14 | #ECEFF4 |
| surface | #111723 | #FFFFFF |
| surface-2 | #171F2E | #F5F7FA |
| surface-3 | #202A3B | #E7EBF1 |
| line (dividers) | #263146 | #D6DCE5 |
| line-strong (control borders, ≥3:1) | #4B5A74 | #8792A4 |
| ink | #F3F6FB | #0B1220 |
| ink-2 | #C5CEDC | #2B374B |
| muted | #97A3B6 | #556175 |
| faint (≥4.5:1, lowest text colour) | #7A879D | #687489 |
| brand (info/links) | #5B96FA | #1F62D6 |
| win | #3CCB82 | #0D7F48 |
| loss | #F2646F | #C42734 |
| warn | #EDA73C | #9A5800 |
| gold (honours and Elite only) | #F3B53F | #8A6100 |
| slab / on-slab (inverse CTA) | #F3F6FB / #0B1220 | #0B1220 / #FFFFFF |
| focus | #7FB0FF | #2F6FE0 |

- Soft tints: `--color-X-soft: color-mix(in srgb, var(--color-X) 14%, transparent)` in dark and 10% in light. Every tone-on-soft pair must reach ≥4.5:1.
- Scoped `.broadcast` class: redeclares the dark values whatever the app theme is (Game Day, BoxScore, the schedule box modal).

3. TEAM TOKENS
src/lib/teamColor.ts exports teamTokens(primary, secondary, theme), which uses WCAG relative luminance. AppShell writes the result to document.documentElement in a useLayoutEffect whenever the team or the theme changes, and redeclares --team-tint on the same element.
- --team-fill: raw primary (large slabs only).
- --team-fill-2: raw secondary (the skewed stripe).
- --team-on: whichever of #FFFFFF or #0B1220 contrasts more with the fill.
- --team-accent: the first of primary or secondary that reaches ≥3:1 on surface. If neither does, mix the more saturated one toward white (dark theme) or black (light theme) until it does.
- --team-accent-text: the same rule with a ≥4.5:1 target.
- --team-tint: color-mix(accent 12% in dark, 8% in light, surface).
- Dark-slab lift: if the fill's contrast against canvas is under 1.5:1 (CLE, NE, HOU, LV, CHI, NO, PIT black, the navy clubs), slabs get a 1px line-strong inner ring and a 6px secondary stripe.
- Legacy alias: --team maps to --team-accent, so the 155 existing var(--team) foreground uses pass contrast immediately.
- Example (CLE): fill #311D00, fill-2 #FF3C00, accent #FF4A12 dark / #E63A00 light, accent-text #FF7448 dark / #C23000 light.
- Allowed uses: top-bar brand block and a 3px rule, the HC feature slab, unit/role/position tags, the active nav (tint plus a 4px accent bar), tab underlines, eyebrows, the selected table row (tint plus a 3px inset bar), avatar tint, and chart series 1.
- Never used for ratings, status, or selected-chip fills.
- A script verifies contrast for all 32 clubs in both themes.

4. RATING TIERS
ratingTier(v) in format.ts returns {key, label, fill, ink, outline}. It is used for players, staff, prospect NOW/CEIL on the NFL scale, and every rating meter. College grades are labelled "college" and use the same function. "Elite" means 90+ everywhere.

| Tier | Range | Style | Dark | Light |
|---|---|---|---|---|
| Elite | 90+ | gold fill, ink #0B1220 | #F3B53F | #EBA923 |
| Pro Bowl | 82-89 | green fill | #3CCB82 | #2DB86F |
| Starter | 74-81 (league avg 74) | blue fill | #5B96FA | #4C86EE |
| Rotation | 66-73 | slate fill | #9AA9C0 | #B3BFD0 |
| Depth | 58-65 | 2px outline, ink-2 number | #5E6C84 | #8792A4 |
| Weak | 50-57 | amber outline, amber number on 12% wash | #EDA73C | #9A5800 |
| Liability | under 50 | red outline, red number on 10% wash | #F2646F | #C42734 |

- Filled tiers always use ink #0B1220 (≥5.7:1).
- The Depth outline grey is never used as a text colour.
- RatingTile sizes: sm 32 (table), md 40 (row), lg 56 (card), plus an optional tier word (WEAK / LIAB.), an optional "−17 vs avg" delta against STAFF_BASELINE 74 or the position average, and optional pips (5 to 1) in table and dense modes.
- The POT bubble uses the same tiers.
- Segmented RatingBar fills segments up to the value, all in the tier colour of the value itself.
- DevBadge uses neutral chips, with a gold star only for X-Factor and Superstar.
- gradeColor and inkOn remain as deprecated shims that map to these tokens, and valueClass and its copies are deleted.

5. TYPOGRAPHY
- Fonts: Barlow Condensed 600/700/800 plus italic 700/800, Barlow Semi Condensed 500-700, and Inter 400-700. index.html must load the 800 weight and the italic axis.
- Numbers use .tnum by default on every number component.
- Scale:

| Role | Size / line height | Style |
|---|---|---|
| hero / page title | 40/40 (28 on phone) | Condensed 800 italic, uppercase |
| KPI value | 30/1 | 800 italic, neutral ink |
| H2 card or name title | 22/1 | 800 italic, uppercase |
| H3 row name | 16/1.15 | Semi Condensed 700, uppercase, +0.02em |
| body | 14/20 | Inter |
| small | 13/18 | Inter |
| label | 12/16 | Semi Condensed 600, uppercase, +0.07em, muted (replaces the 10.9px .label) |
| micro | 11 | units and ticks only |

- Table cells use upright Inter 13-14 tnum, never italic.
- Signs and units: U+2212 for minus, × for multipliers, and one money() helper that right-aligns values.

6. SPACE, SHAPE, ELEVATION, MOTION
- Spacing: a 4pt grid.
- Radius: xs 2, sm 4, md 6, lg 10, pill. Broadcast slabs stay sharp.
- Shadows: shadow-1 for cards (inset white 3% plus 0 1px 2px black 40%), shadow-2 for popovers and sheets (0 18px 40px -12px plus a 1px white 6% ring).
- z-index: bar 30, nav 40, pop 60, sheet 70, toast 80.
- Focus: a global :focus-visible ring (2px canvas plus 4px focus).
- Durations: d1 120ms, d2 220ms, d3 420ms.
- Motion: lower-thirds and menus wipe in with clip-path over 220ms, sheets slide up over 420ms, the tab underline slides, and KPI numbers count up once per visit.
- No loops outside Game Day, and prefers-reduced-motion makes every change instant.

7. KIT (src/ui/kit.tsx plus new src/ui/*.tsx, all re-exported from kit)
- RatingTile: value, size, tier word, delta, pips.
- KpiTile and KpiStrip: a lower-third bar split by 1px rules. Each tile has a label, a neutral value, a unit, a grade chip (nowrap), a single-line explanation, and a slot for a scale, a DivergingMeter or a budget meter.
- DivergingMeter: an SVG with a midline and a floor marker.
- Delta / Effect: kind edge, mult or money, a goodWhen rule, a neutral number, a coloured ▲▼ glyph, and a FLOOR or CAP flag when the value is clamped.
- Money: signed, tnum, right-aligned, with a 'freed' or 'cost' tone.
- SchemeChip: live (slab with a green dot, 'Drives play-calling'), match (✓), off (amber outline with '≠ OC/DC'), na ('no effect').
- Tabs: underline style, 42px, a 3px accent underline, role=tab, and a count pill.
- SegmentedControl: surface-2 track, the active segment is surface-3 with a line-strong ring, aria-pressed. Never filled with team colour.
- FilterChip: aria-pressed with a check mark.
- OptionCard: a radio mark, with distinct hover and selected states.
- Buttons, minimum 36px tall (44 on touch):
  - Slab: skew −10°, inverse colours, one per view.
  - Primary: inverse, no skew.
  - Secondary: line-strong outline.
  - Quiet.
  - IconButton: aria-label required.
  - Destructive: solid loss fill, used ONLY inside the ConfirmSheet's final step. The resting 'danger' variant is removed.
  - Event behaviour: Button stops propagation by default inside rows (prop rowSafe).
  - A loading state.
- OverflowMenu (⋯): 272px, surface-2, shadow-2. Each item has a title and a 12px consequence line, and destructive items come last after a divider, in red text only.
- ConfirmSheet / Dialog: a centred dialog on desktop and a bottom sheet under 768px. It holds a subject, a 'Consequences' key/value list (money, seat, before → after edge), a safer alternative button, the primary action, an access note and 'logged in The Ledger'. It traps focus, closes on Esc and has role=dialog.
- GatedAction and AccessBanner: read accessFor(). At 'advise' the label becomes 'Recommend…' and the action is sent to the GM; at 'none' it is disabled with a visible reason. The banner is a lower-third with an 'ADVISOR' slab and one sentence.
- Inspector / Sheet: a right column at 1280px and above, a bottom sheet below. It replaces hover-only cards, and HoverCard becomes tap-to-sheet on touch.
- Card tiers: base (surface, line, shadow-1, lg radius); feature (a team slab block on the left); needs-a-call (a 2px warn left edge plus a chip).
- VacantSeat: a dashed line-strong pill with the consequence line and an action.
- Avatar: initials on surface-3 with an accent ring, never navy.
- DataTable (one shared table): sticky first column whose background follows the row hover, aria-sort buttons, keyboard rows (J/K, Enter), density, group rows with sub-labels, a selected row with tint plus a 3px accent bar, rank and pips columns, right-aligned money, and a card-row mode under 640px. It never nests a fixed-height scroller on phone.
- ScoreBlock: promoted from MatchView into the kit and reused on Schedule, Up Next and the Dashboard hero.

8. SHELL
- Desktop top bar, 64px on surface with a 3px team rule underneath:
  - Zone 1, the brand block: 232px, aligned with the sidebar, team fill plus a skewed fill-2 stripe, a 38px crest, 'BROWNS' 21px 800 italic in --team-on, and 'AFC North'.
  - Zone 2: Record 5–2 | 'WEEK 9 of 18' with a 96px accent progress bar | '@ ATL FALCONS' with a crest, linking to Game Plan.
  - Zone 3, right-aligned KPI cells (label, value, verdict chip, 84px meter): Job 39% 'HOT SEAT' (jobTone against the owner's firing line: >line+25 win, >line+10 neutral, >line warn, ≤line loss); Cap $885K 'TIGHT' (capTone in dollars: <0 loss, <$5M warn, <$25M neutral, otherwise win); OVR 80 as a tier tile with 'Pro Bowl tier'.
  - Then a 40px search IconButton (⌘K) and one split Slab CTA: 'Coach the game' when a coachable game is pending, otherwise 'Advance week'. The caret holds 'Sim week instead', 'Sim mode: Fast/Authentic' (aria-pressed) and ⌘↵.
  - The Advisor badge leaves the bar and becomes an AccessBanner on each affected screen. Nothing in the bar is ever truncated.
- Sidebar, 232px:
  - Wordmark: 'GRIDIRON' in ink and 'DYNASTY' in --team-accent-text, with 'Season 2026 · Week 9' under it.
  - Inbox is pinned first with a brand-blue badge.
  - Five groups (Career, Team, Personnel, Club, League) with unique icons: binoculars for Scouting, search for Find a Player, a play diagram for Game Plan, stacked rows for Draft, and distinct icons for Roster and Team.
  - Items are 36px tall. The active item gets the tint, a 4px accent bar and an accent icon, and is scrolled into view.
  - The footer is one 58px row (avatar, role, season, gear). The gear opens a sheet with theme, density, export, import and collapse, and 'New career' sits there in danger styling behind a ConfirmDialog.
  - Rail: 68px at 768-1023px only.
- Command palette: shares AREA_BY_SCREEN, canCoach and stageLabels from src/ui/nav.ts, and adds actions for sim mode, theme, density, collapse and export/import.
- Phone (under 768px), with no sidebar:
  - A 56px score strip: a team slab with the crest and '5–2' (diagonal clip plus the secondary stripe), 'Wk 9/18 · @ ATL', and a two-segment slab [Coach ▸ | ⏭ Sim] that becomes [Advance ▸] when no game is pending.
  - A 40px KPI ticker that scrolls sideways: Job 39% (warn), Cap $885K (warn), OVR 80, Sim Fast.
  - A 64px bottom tab bar plus env(safe-area-inset-bottom), with the 5 groups (Career carries the inbox dot). Tapping a tab opens that group's last screen, and tapping it again opens the group sheet. The active tab gets a 3px accent top bar.
  - Main uses p-4 (16px gutters) on phone and p-8 on desktop, with h-dvh and safe-area insets.
  - Form controls use 16px text, every target is at least 44px, and tables become card rows.
  - The toast sits above the tab bar.

9. STAFF PILOT (reference screen)
- Header: eyebrow 'CLUB', title 'STAFF & HIRING', Tabs [My Staff 10/11 | Hiring Market], and a SegmentedControl [Chart | Table].
- AccessBanner: 'ADVISOR · At your rung the GM makes staff moves. Actions send a recommendation.'
- KpiStrip:
  - Staff 10 of 11 · 0 elite (90+) · 1 vacant: Analytics.
  - Staff rating 49 'Poor staff' (avg of 10) on a tier scale with an avg-74 tick.
  - On-field impact −9.0 pts/snap 'AT THE FLOOR', DivergingMeter, OFF −4.5 + DEF −4.5, 'A coordinator rated 52+ is the first hire that moves it'.
  - Development ×0.84 '16% slower', DivergingMeter, 'Avg of 4 position coaches, applied to every player; floor ×0.80'.
  - Payroll $20.3M of budget, $15.1M headroom, 'budget is advisory'.
- System Check: live chips 'Offense runs West Coast · OC Dawson' and 'Defense runs 4-3 Base · DC Barnett'. Off chips: HC RPO Heavy, QB Spread, OL Pro Style, DL 4-2-5 Nickel, Secondary 3-4 Base. ST West Coast shows 'no effect'. Footnote: only coordinator schemes reach the sim. On phone this collapses to one row that opens a sheet.
- Coaching tree with a tier legend:
  - HC feature slab: Miles Nakamura, RPO Heavy off-chip, ▼ −2.0 situational, Weak 57 tile with '−17 vs avg', '$8.0M/yr · 4 yr', ⋯.
  - OFF / DEF / ST unit columns: a coordinator card, then compact position-coach rows that carry 'feeds program ×0.84' and the Best on staff / Lowest rated tags.
  - Front Office as a collapsed bar with VacantSeat Analytics.
- Table view: the grouped DataTable.
- Inspector: opens when a row is selected.
- ⋯ menu: View readout | Find a better <role> (market pre-filtered to 52+ with the live scheme first) | divider | 'Recommend letting go…', which opens a ConfirmSheet listing the remaining contract, 'Seat vacant until hired', the edge before → after and who decides, with the safer option 'Find a replacement first'.
- Market: shows the projected edge change ('+0.0 · still at floor'), and its filters collapse into a 'Filters (n)' sheet on phone.

## Rollout

Foundation steps (F*) are built by Claude; screen groups (D*) by DeepSeek Flash in parallel worktrees with non-overlapping files, each reviewed and browser-checked by the orchestrator (desktop + 375px, light + dark).

### F0 Spec + baseline — claude
This file is the final spec (with a progress table), and add a PLAYTEST_BACKLOG.md row for the redesign request. Add scripts/check-contrast.ts, which asserts teamTokens contrast for all 32 clubs in both themes plus the tier and tone-on-soft pairs. Add scripts/check-hex.sh, which greps a list of files for hex literals and for text/bg-white or text/bg-black outside allowlisted broadcast code. Capture before-screenshots at 375 and 1440 in both themes for CLE, PIT and KC.

Files: `NEXT_PHASE_UI.md`, `PLAYTEST_BACKLOG.md`, `scripts/check-contrast.ts`, `scripts/check-hex.sh`

Acceptance:
- npm run build passes
- npm run lint shows exactly 4 warnings
- the check-contrast script runs and reports today's failures as the baseline
- NEXT_PHASE.md, CLAUDE_RESUME.md and .claude/ are not committed (only tracked spec files)

### F1 Tokens, team colour, formatting helpers — claude
index.css:
- Replace the @theme colours with the tokens above, using a single dark selector list.
- Make the soft tints color-mix; add the tier, slab, focus, radius, shadow, type-scale, z-index and duration tokens.
- Change .label to 12px, add the global :focus-visible ring, and add the .broadcast scoped dark token class.
- Delete the :root --team-soft, and alias --team and --team-soft to --team-accent and --team-tint.

index.html: load Barlow Condensed 800 and the italic axis.

src/lib/teamColor.ts: teamTokens() using WCAG luminance, including the dark-slab lift.

src/lib/format.ts: ratingTier(), a WCAG-based inkOn, gradeColor kept as a shim returning tier vars, capTone(dollars), jobTone(sec, firingLine), signed() with U+2212, mult(), ordinal(), and one ELITE constant (90). The existing money() keeps its signature.

(The audit's `coach.scheme !== coach.scheme` tenure bug in gameStore is an ENGINE fix — it needs the previous scheme stored per club — so it is tracked as its own job, backlog 185, not part of this visual redesign.)

Depends on: F0 Spec + baseline

Files: `src/index.css`, `index.html`, `src/lib/teamColor.ts`, `src/lib/format.ts`, `src/store/gameStore.ts`

Acceptance:
- build passes; lint shows exactly 4 warnings
- check-contrast passes: accent ≥3:1 and accent-text ≥4.5:1 for all 32 clubs in both themes; every tier ink and tone-on-soft pair ≥4.5:1; light Weak #9A5800 ≥4.5:1
- every existing screen still renders (the gradeColor shim keeps 24 files compiling) with no visual regression beyond the new colours
- the CLE dark sidebar wordmark becomes visible with no AppShell change, through the --team alias
- the scheme-change cohesion reset is verified with a quick season-rollover sim

### F2 Kit primitives — claude
Build the kit:
- RatingTile (pips, delta, tier word); rebuild OvrBadge, the POT bubble, RangeBubble, RatingBar and DevBadge on it.
- KpiTile, KpiStrip and DivergingMeter; Delta/Effect and Money; SchemeChip; Tabs, SegmentedControl, FilterChip and OptionCard; IconButton.
- The Button variants slab, primary, secondary, quiet and destructive-only-in-confirm, with rowSafe stopPropagation and a loading state.
- OverflowMenu, ConfirmSheet/Dialog, GatedAction plus AccessBanner, Inspector/Sheet, Avatar and VacantSeat; promote ScoreBlock.

Make DataTable the single shared table (group rows, sticky column that follows hover, aria-sort, keyboard rows, density, rank and pips, card-row mode under 640px, no nested vh scroller on phone). HoverCard gets a touch path to the sheet, a 44px info target and an opaque panel.

Add a hidden /kit dev route that showcases every primitive in both themes.

Depends on: F1 Tokens, team colour, formatting helpers

Files: `src/ui/kit.tsx`, `src/ui/RatingTile.tsx`, `src/ui/Kpi.tsx`, `src/ui/Controls.tsx`, `src/ui/Overlay.tsx`, `src/ui/Access.tsx`, `src/ui/ScoreBlock.tsx`, `src/components/DataTable.tsx`, `src/components/HoverCard.tsx`, `src/components/StaffReadout.tsx`, `src/components/AccessBadge.tsx`

Acceptance:
- build passes; lint shows exactly 4 warnings; check-hex is clean on kit files
- old export names (OvrBadge, Stat, Badge, Button variant='danger') still compile as wrappers, so no screen breaks before its own push
- every primitive is keyboard operable with a visible focus ring; dialogs trap focus and close on Esc; ConfirmSheet becomes a bottom sheet at 375px
- the /kit route checked at 375 and 1440 in light and dark for CLE, PIT and KC

### F3 AppShell, navigation, phone shell — claude
Rebuild TopBar:
- The three zones, unit-correct capTone, jobTone against the firing line, and the split Slab CTA with sim mode in its menu.
- Remove the loose sim toggle and AccessBadge from the bar, and stop hard-coding white on the gradient.

Rebuild the sidebar:
- Accent wordmark, Inbox first, unique icons, active item scrolled into view.
- One-row footer with a settings sheet, and New Career behind a ConfirmDialog.
- Rail only at 768-1023px.

Build the phone shell (under 768px): score strip with a two-segment CTA, KPI ticker, bottom group tabs with group sheets, h-dvh, safe areas, p-4.

Move team vars to documentElement. Move shared AREA_BY_SCREEN, canCoach and stageLabels into src/ui/nav.ts (adding the missing depth:'roster'). Add sim, theme, density and export actions to the palette, and give it a dvh layout, a close button and a sync focus. Mount the toast above the tab bar.

Depends on: F2 Kit primitives

Files: `src/components/AppShell.tsx`, `src/components/CommandPalette.tsx`, `src/ui/nav.ts`, `src/App.tsx`

Acceptance:
- build passes; lint shows exactly 4 warnings; check-hex clean
- at 375px: no sidebar, no horizontal page scroll; record, OVR, cap, job, week, opponent, sim mode, Coach and Advance are all reachable in at most 2 taps; Advance is reachable in 1 tap when a game is pending
- at 1440 and 2000px the club name never truncates and no top-bar label wraps
- $885K shows warn 'Tight'
- PlayerProfile, SeasonModal and MatchView show the club accent, not #0b62ff
- light and dark checked for CLE, PIT and KC
- every one of the 21 screens is still reachable from both nav surfaces

### F4 Staff pilot (reference screen) — claude
Rebuild Staff.tsx to the spec:
- AccessBanner, KpiStrip with diverging meters, System Check (OC/DC live only, ≠ markers, ST 'no effect').
- HC feature slab, unit columns, VacantSeat.
- Grouped DataTable view with pips and Δ, plus the inspector.
- ⋯ menus through GatedAction that read accessFor(); ConfirmSheet replaces the direct fireStaff call and window.confirm.
- Market: projected edge with floor awareness, a filters sheet on phone, and the budget overage in warn.

Fixes: 11 seats in the vacant count, one elite threshold (90), numeric Effect sort, and no navy avatars. Add the clamp and floor helpers to staffEffects.ts. Write src/screens/README-pattern.md: the pattern notes DeepSeek pushes copy.

Depends on: F3 AppShell, navigation, phone shell

Files: `src/screens/Staff.tsx`, `src/components/staffEffects.ts`, `src/screens/README-pattern.md`

Acceptance:
- build passes; lint shows exactly 4 warnings; check-hex clean on Staff.tsx
- the CLE screenshot data renders verbatim; 57 and 53 show amber Weak, 48/46/45 show red-outline Liability, and there are no filled red tiles
- no resting red button anywhere on the screen; at Advisor every action reads 'Recommend…' and no dead control triggers a toast
- −9.0 and ×0.84 are explained on the surface with a FLOOR marker
- checked at 375 and 1440 in light and dark (CLE, PIT, KC), including the ConfirmSheet on phone
- all features retained: hire, fire, focus, Chart/Table, market filters and sorts, hover readouts moved to the inspector
- Claude commits; the user decides whether to rebuild stable 4173; no git push

### D1 Home and career screens — deepseek (parallel-safe)
Dashboard:
- Order: needs-a-call WeeklyDecision, ScoreBlock matchup hero (win %, Coach/Advance), checklist, unit grades as RatingTiles with the OC/DC schemes, owner and injury news.
- Remove the duplicate KPI strip, the fake Vegas line and the Quick Actions; OfficeScene becomes a collapsible strip.
- Fix the cap units, the Game Plan link (gameplan) and ordinal(); job security uses jobTone.

Career: job security in the strip, the seed button moved to an overflow, and skill-point spend through ConfirmSheet.

CareerHub: Continue first on phone; 'Start fresh' through ConfirmSheet; the accordion no longer changes the start level and honours scenarioLocked; one track toggle; no bg-ink/white-on-near-white; neutral NFL badge.

Inbox: remove the fake Suggested Actions (or link to real screens); phone master-detail opens the detail; don't auto-mark read on mount.

Ledger: Best/Worst call as text rows, not KPI numbers; neutral category chips.

Use SegmentedControl and Tabs everywhere and remove hex values.

Depends on: F4 Staff pilot (reference screen)

Files: `src/screens/Dashboard.tsx`, `src/screens/Career.tsx`, `src/screens/CareerHub.tsx`, `src/screens/Inbox.tsx`, `src/screens/Ledger.tsx`, `src/components/OfficeScene.tsx`, `src/components/OwnerCard.tsx`, `src/components/OwnerMeetingCard.tsx`, `src/components/WeeklyDecision.tsx`, `src/components/WeeklyChecklist.tsx`, `src/components/CareerPeople.tsx`, `src/components/CareerRhythm.tsx`, `src/components/CulturePanel.tsx`, `src/components/LockerRoomCard.tsx`, `src/components/ByeWeekCard.tsx`, `src/components/AmbitionsCard.tsx`, `src/components/LegacyCard.tsx`, `src/components/PortfolioCard.tsx`, `src/components/GmRequestsDesk.tsx`, `src/components/InterviewPrep.tsx`, `src/components/VoicesCard.tsx`, `src/components/RoomCard.tsx`

Acceptance:
- npm run build passes; npm run lint shows exactly 4 warnings
- check-hex reports no hex literals or white/black utilities in the listed files
- the diff touches only the listed files
- checked in a browser at 1440 and 375px in light and dark for CLE, PIT and KC: no horizontal page scroll, no text below 12px, targets ≥44px on phone
- no feature removed: every card, action and navigation link still reachable (the Vegas line and fake Suggested Actions are intentional removals noted in the commit)
- every irreversible action goes through ConfirmSheet

### D2 Roster, depth, development, player profile — deepseek (parallel-safe)
PlayerTable, RatingsTable and Roster:
- One RatingTile per row (OVR plus the POT bubble) and remove the duplicate OVR/POT columns.
- Consistent first-click sort descending, with the sort select kept in sync.
- Single loss 'OUT 3W' injury chip; DeadMoneyCell legend; filters move into a sheet on phone; card rows under 640px through the kit DataTable or the card mode.
- Practice-squad Cut moves into ⋯ plus ConfirmSheet.

DepthChart: the starter band, Start in ⋯, 44px reorder controls, OFF/DEF/ST tabs on phone, OVR gap to the backup, injury weeks, no hard-coded accents.

Development: the program × explained as a % pace linked to Staff, a ceiling-gap progress visual, gain chips visible on phone, 16px selects, the list first on phone.

PlayerProfile: section order Contract, Fit, Composites, Stats, College; tier-coloured bars; remove or wire the dead Trade Block; header text uses --team-on; one set of morale thresholds.

FindPlayer: OVR sticky first; own-club row tint.

ShadowBoard: 44px remove control, OVR delta chip, ShadowStar in accent.

Depends on: F4 Staff pilot (reference screen)

Files: `src/screens/Roster.tsx`, `src/screens/DepthChart.tsx`, `src/screens/Development.tsx`, `src/screens/FindPlayer.tsx`, `src/components/PlayerTable.tsx`, `src/components/RatingsTable.tsx`, `src/components/PlayerCard.tsx`, `src/components/PlayerProfile.tsx`, `src/components/PlayerHoverCard.tsx`, `src/components/TeamHoverCard.tsx`, `src/components/ShadowBoardCard.tsx`, `src/components/TopPlayers.tsx`

Acceptance:
- npm run build passes; npm run lint shows exactly 4 warnings
- check-hex clean on the listed files
- the diff touches only the listed files; PlayerTable props stay backward compatible for FreeAgency
- 1440 and 375px in light and dark for CLE, PIT and KC: Roster readable as card rows at 375 with no sideways table scroll needed to see OVR, name and position
- about 48% of players no longer show red; only Liability (<50) is red
- no feature removed (sorts, filters, tabs, cards view, PS/IR moves, profile sections)

### D3 Draft and scouting — deepseek (parallel-safe)
Draft:
- The board comes first on phone and the rail goes below it.
- College grades are labelled 'college' and separated from the NOW/CEIL bubbles.
- Hide the consensus where readProspect hides it.
- Board rank uses neutral chips.
- 'Complete the draft' and Accept trade go through ConfirmSheet.
- Remove nested scrollers on phone.

Scouting:
- Conviction and red-flag toggles get distinct glyph tones (good/warn), not a team fill.
- Quick actions become labelled 44px items in ⋯ or the sheet.
- The expanded report opens in the Inspector/Sheet, not a colSpan row.
- Sticky column first.
- Recommendation chips are neutral except Pass, which is muted not red.
- Hit Rate is toned by its value.
- No #101820 truth panel: use the .broadcast scope.

Combine and Travel cards: compact range labels at 11px minimum, accent meters, the board shown before them on phone.

Depends on: F4 Staff pilot (reference screen)

Files: `src/screens/Draft.tsx`, `src/screens/Scouting.tsx`, `src/components/CombineCard.tsx`, `src/components/ScoutTravelCard.tsx`, `src/components/DraftTradePanel.tsx`, `src/components/ScoutClub.tsx`

Acceptance:
- npm run build passes; npm run lint shows exactly 4 warnings
- check-hex clean on the listed files; the diff touches only the listed files
- 1440 and 375px in light and dark for CLE, PIT and KC: Prospect Board visible in the first screen on phone; no 7-10px text
- Complete draft and Accept trade require a confirm
- no feature removed (fog of war, points, travel, combine, conviction, red flags, calls, staff board, sim-to-pick, draft-day trades)

### D4 Money and transactions — deepseek (parallel-safe)
Cap:
- One capTone() everywhere; the Contract Ledger first.
- Money cells right-aligned tnum with a sticky Player column; a single ⋯ per row (Restructure, Extend, Cut), each through a ConfirmSheet showing this-year savings against future dead money and void years.
- Neutral rating number style in money tables.
- Cap Health indices given units and explanations.
- Allocation bar and % use the same denominator.
- ContractExplainer names its player.

ExtensionTalks: kit Dialog; preview the offered contract (dead money and cap per year); a threshold marker on the AAV slider; 'uses 1 of 3 tries'; guarantees shown in dollars.

ContractLifeCard: neutral option styling; Tag, Exercise and Pay through ConfirmSheet.

FreeAgency:
- One cap colour; the real price in the row (no stale $0).
- Sign is rowSafe and opens a review sheet with years, total and guarantees.
- On coaching rungs a single GatedAction replaces the 'GM decides' noise.
- Fix the literal —.
- The Sign action is reachable without sideways scroll on phone.

Trades:
- A cap line in the tray (in, out, space after) and a net delta; 'pts' units.
- Ask GM is rowSafe.
- Propose goes through a review step and is disabled outside the NFL.
- Open on the Deadline tab when live offers exist.

DeadlinePanel: Accepted/Passed history correct (track the decision locally or from data already in state; no gameStore edit); cap per asset; Pass gated by trade authority.

Depends on: F4 Staff pilot (reference screen)

Files: `src/screens/Cap.tsx`, `src/screens/FreeAgency.tsx`, `src/screens/Trades.tsx`, `src/components/CapPlanner.tsx`, `src/components/ContractExplainer.tsx`, `src/components/ContractLifeCard.tsx`, `src/components/ExtensionTalks.tsx`, `src/components/GmRestructureRequest.tsx`, `src/components/DeadlinePanel.tsx`, `src/components/GmAskButton.tsx`

Acceptance:
- npm run build passes; npm run lint shows exactly 4 warnings
- check-hex clean on the listed files; the diff touches only the listed files (if accept/decline tracking needs a store field, stop and hand back to Claude rather than editing gameStore.ts or engine files)
- $885K shows warn 'Tight' everywhere on these screens
- no one-click irreversible money action remains
- 1440 and 375px in light and dark for CLE, PIT and KC
- no feature removed (restructure, extend, cut, tag, option, holdouts, memo, planner, waivers, all trade tabs, deadline AI toggle)

### D5 Game day — deepseek (parallel-safe)
MatchView:
- Wrap the broadcast surfaces in .broadcast.
- Replace bg-white/text-ink active states with slab/on-slab.
- Map the hard-coded hex values (#8ef0b5, #ffb3ba, #dc2937, #e0344a, #ffd34d) to the broadcast win/loss/warn/gold tokens, keeping gold with one meaning.
- The plan panel drops its white box.
- Label the score order consistently.
- Abandon game moves into ⋯ plus a ConfirmSheet.
- Decision UI type at 12px minimum.
- On phone the side panel becomes a collapsible bottom sheet, so the field keeps at least 45% of the height during a decision.

BoxScore uses ScoreBlock from the kit. PlanEditor and PersonnelCard are not edited here; they inherit the tokens through .broadcast.

Depends on: F4 Staff pilot (reference screen)

Files: `src/components/MatchView.tsx`, `src/components/playAnim.ts`, `src/components/fieldPos.ts`

Acceptance:
- npm run build passes; npm run lint shows exactly 4 warnings
- check-hex reports only allowlisted field-art colours (turf and end-zone gradients) in MatchView.tsx
- the diff touches only the listed files
- a full coached game and a replay checked at 375 and 1440 in app light and dark: all active states readable, the plan panel readable in both themes
- no feature removed (speeds, call modes, decisions, timeouts, plan and personnel edits, box score, replay)

### D6 Game plan — deepseek (parallel-safe)
GamePlanScreen:
- An Up Next ScoreBlock hero first (pinned first on phone).
- Cards grouped into This week / Situational / Review with kit section headers.
- The Off/Def toggle scope made honest (labelled or applied to every card).
- MatchupLine becomes a Delta bar with magnitude and a neutral band.
- The RatingColumn fits 375.

Option components (PlanEditor presets, Keys, Practice, Install, Wrinkle, Personnel, call sheet) move to the kit OptionCard with a radio mark and distinct hover/selected states. PlanEditor bars are neutral, not red above 66. Wrinkle uses a win tone for a positive edge. Long-shot keys are neutral.

Depends on: F4 Staff pilot (reference screen)

Files: `src/screens/GamePlanScreen.tsx`, `src/components/PlanEditor.tsx`, `src/components/PersonnelCard.tsx`, `src/components/KeysCard.tsx`, `src/components/PracticeCard.tsx`, `src/components/InstallCard.tsx`, `src/components/WrinkleCard.tsx`, `src/components/SchemeFitReport.tsx`, `src/components/RouteDiagram.tsx`, `src/components/AnalyticsCard.tsx`

Acceptance:
- npm run build passes; npm run lint shows exactly 4 warnings
- check-hex clean (RouteDiagram turf colours allowlisted)
- the diff touches only the listed files
- PlanEditor and PersonnelCard render correctly both standalone and inside MatchView's .broadcast scope (check a live game after D5 merges)
- selected options are visible for CLE in dark mode
- 1440 and 375px in light and dark for CLE, PIT and KC
- no feature removed (every card, the script, matchups, workload, call sheet, self-scout, coordinator advice)

### D7 League information — deepseek (parallel-safe)
Schedule: ScoreBlock rows and phone card rows; PPG divided by games played; the next game with a Coach/Sim action; the replay caveat shown as visible text; the box modal uses the .broadcast scope instead of #101820.

Standings: real header rows, a W-L-T format, a clinch legend on every tab, the user's row with tint plus an accent bar, neutral leader pills, neutral AFC/NFC conference tokens (not loss red), tabs that fit at 375.

StatsHub and StatsTable: the kit DataTable or SegmentedControl, a rank column, an emphasised sort column, density support, one scope control.

League: the detail panel opens as a sheet on phone; no nested button; hero text uses --team-on.

TeamView: deduplicate the header; --team-on; a filters sheet.

History: Offense/Defense group headers; tiered tiles by career path; a timeline with the record emphasised.

Awards: winners first, a MVP hero, consistent honour colours, StaffAwardRow fits 375.

SeasonModal: the X closes without declining offers (an explicit 'Decline all' through ConfirmSheet); the record verdict emphasised; the CTA sticky; gold text at ≥4.5:1.

Depends on: F4 Staff pilot (reference screen)

Files: `src/screens/Schedule.tsx`, `src/screens/Standings.tsx`, `src/screens/StatsHub.tsx`, `src/screens/League.tsx`, `src/screens/TeamView.tsx`, `src/screens/History.tsx`, `src/screens/Awards.tsx`, `src/components/StatsTable.tsx`, `src/components/statsColumns.ts`, `src/components/SeasonModal.tsx`

Acceptance:
- npm run build passes; npm run lint shows exactly 4 warnings
- check-hex clean on the listed files; the diff touches only the listed files
- a 5-2 team with 150 points shows 21.4 PPG
- closing the hiring carousel keeps the offers
- 1440 and 375px in light and dark for CLE, PIT and KC: no tab bar overflow, every table has visible column labels
- no feature removed (all tabs, past seasons, bracket, HoF ballots, replays, box scores)

### V1 Integration and cleanup — claude
Merge the D1-D7 worktrees one at a time (git merge --no-edit wt-<name>, keeping both sides of any conflict) and re-verify on main after each. Then:
- Remove the deprecated shims (gradeColor, the Button danger variant, old OvrBadge internals) once there are no callers.
- Sweep the remaining `!important` overrides and sub-12px sizes.
- Run check-hex across src.
- Do a final 32-club contrast pass and a full screenshot matrix (21 screens × 375/1440 × light/dark × CLE/PIT/KC).
- Update the NEXT_PHASE_UI.md progress table and OPENCODE_CONTINUE.md, and give the user a status table.

Do not rebuild stable 4173 or git push without the user's explicit ok.

Depends on: D1 Home and career screens, D2 Roster, depth, development, player profile, D3 Draft and scouting, D4 Money and transactions, D5 Game day, D6 Game plan, D7 League information

Files: `src/ui/kit.tsx`, `src/lib/format.ts`, `src/index.css`, `NEXT_PHASE_UI.md`, `OPENCODE_CONTINUE.md`, `PLAYTEST_BACKLOG.md`

Acceptance:
- build passes; lint shows exactly 4 warnings
- grep shows 0 gradeColor/inkOn/valueClass callers, 0 Button variant='danger' outside ConfirmSheet, and 0 text-[7-10px]
- check-hex reports 0 hard-coded colours outside the allowlisted field art
- check-contrast passes for all 32 clubs in both themes
- the full screenshot matrix is reviewed with no feature regressions and no horizontal page scroll at 375

## Risks

- Faithfulness drift in the DeepSeek rollout. Skew slabs, clip-path diagonals and italic display type are easy for Flash to reinvent badly. Mitigation: these exist only as kit primitives; README-pattern.md plus the Staff reference; check-hex and the 'touches only listed files' acceptance on every push.
- Merge conflicts on shared hubs. kit.tsx, format.ts, index.css, gameStore.ts and AppShell are Claude-only and frozen during D1-D7. Any DeepSeek push that needs a kit or store change must stop and hand back rather than edit. PlayerTable (D2) is consumed by FreeAgency (D4), so its props must stay backward compatible.
- During F1-F3 the gradeColor shim and the --team → --team-accent alias change colours on every screen at once before the screens are restyled. Interim screens may look mixed. Mitigation: keep the user's stable 4173 build held until V1; the dev 5173 shows work in progress.
- Team-accent maths across 32 clubs × 2 themes: mixed accents can look off-brand (for example a lightened CLE brown versus the secondary orange), and mid-luminance fills (MIA, LAC, JAX) need a correct --team-on. Verify with the script, not by eye, and allow per-club overrides in teamColor.ts.
- The tier rework changes the meaning of colours players have learned (74-81 blue is now Starter; red only below 50). Add a tier legend on rating-heavy screens and in the kit route, and note the change in the inbox or release notes.
- Italic condensed type over long sessions and the dense-table legibility the judges flagged. Enforce upright Inter tnum in tables and body text; italic only on display text and numbers.
- Phone vertical budget: score strip 56 + ticker 40 + tab bar 64 + safe area leaves about 600px at 812px tall. Game Day must collapse the chrome (hide the ticker and tab bar during a live game) or the field is squeezed again.
- Engine-truth copy: on-surface explanations (floor at −4.5, program-wide dev, only OC/DC schemes live, cohesion reset) must match the engine. The scheme tenure bug is fixed in F1 before any cohesion copy, and staffEffects clamp helpers are the single source.
- Removing the 'danger' button variant and adding rowSafe stopPropagation can break existing row-click behaviour: buttons inside rows that intentionally bubbled. Audit the callers during F2.
- tailwind-merge was proposed to remove the `!important` overrides, but it is a new dependency. Do not add it without the user's ok; the fallback is a small hand-written class-conflict helper in cn.ts or removing the overrides by hand.
- Scope and time: about 4.5 days of Claude foundation work plus 3-4 days of parallel pushes plus integration. Watch the plan's usage limit (the handover rule at 95%), and keep each foundation step independently shippable.
- Fake or static content removals (Vegas line, Suggested Actions, OfficeScene chips) and moving New Career and the sim toggle could be read as 'features removed'. List each one in the commit and status table, and keep every real function reachable.

## Constraints
- Visual only: no sim, rng, calibration or save-field changes (UI prefs in localStorage only). No new dependencies (SVG + CSS).
- Build OK and lint exactly 4 warnings after every step; no feature removed; every dev global keeps working.

## Progress

| Step | Status |
|---|---|
| F0 Spec + baseline | ✅ 2026-10-10 |
| F1 Tokens, team colour, formatting helpers | ✅ f25f84f on ui-redesign (contrast 342/342 pass, 32 clubs × 2 themes) |
| F2 Kit primitives | ✅ d629294 on ui-redesign (live-checked /kit: menu, ConfirmSheet, focus trap, Esc, phone card rows) |
| F3 AppShell, navigation, phone shell | ✅ 851bc3d on ui-redesign |
| F4 Staff pilot (reference screen) | ⏳ |
| D1 Home and career screens | ⏳ |
| D2 Roster, depth, development, player profile | ⏳ |
| D3 Draft and scouting | ⏳ |
| D4 Money and transactions | ⏳ |
| D5 Game day | ⏳ |
| D6 Game plan | ⏳ |
| D7 League information | ⏳ |
| V1 Integration and cleanup | ⏳ |
