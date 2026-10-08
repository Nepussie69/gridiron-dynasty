# NEXT PHASE — UI "Broadcast 2.0" (user request, 2026-10-08: "make the UI look even more modern and advanced")

_Spec by Claude Opus 5.5. Implement with DeepSeek Flash **after the running pushes merge** (it touches every screen). One push per section; build + lint exactly 4 warnings after each. Visual only: no sim, no rng, no save fields._

## U1 — Game day field (TV broadcast look) — `MatchView.tsx`, `playAnim.ts` render only
User screenshot: flat green field, no yard numbers, end zones as dark blocks, dots crowd at the line.
- **Field:** alternating 5-yard mowing stripes (two greens, subtle), yard numbers every 10 (10 20 30 40 50 40 …) on both sides with arrows toward the nearer goal, hash marks every yard (NFL hash positions), sideline white border, goal posts drawn at both end lines.
- **End zones:** club primary-colour gradient with the club name in large condensed italic letters, rotated like TV; a faint club logo-crest watermark at midfield (use `TeamCrest` colours).
- **Lines like TV:** blue line of scrimmage + **yellow first-down line** (today the single yellow line is the LOS — switch it to blue and add the yellow line at `startYard + distance`; goal-to-go → no yellow line). Red-zone tint inside the 20 when the offence is there.
- **Players:** 2.4× larger dots with a soft drop shadow, jersey numbers bold, offence/defence ring colours, the ball carrier gets a pulsing ring; motion trails (fading 6-frame tail) for the ball carrier and the targeted receiver; pass arc drawn as a dashed parabola while the ball is in the air; tackle "pop" (small burst) at the end spot; TD → end zone flash + confetti in club colours.
- **Camera:** auto-zoom to the action (viewBox follows the ball with easing, shows ~45 yards), button to toggle "Full field".
- **Down & distance overlay** on the field (top-left glass chip: "3rd & 4 · CLE 38 · 1st-down line"), play-result toast after each play ("+12 · First down", "SACK −7", "TOUCHDOWN") that animates in and out.

## U2 — Scorebug and controls
- Broadcast scorebug (bottom-center over the field or top bar): club colour blocks with abbr + score, quarter + clock, down & distance, timeouts as 3 pips per side, possession arrow, win-probability bar (use the existing EP/decision model if available; else omit).
- Replay controls as a floating glass pill (backdrop-blur), Space hint, speed chips; the game-day action bar becomes a sticky bottom dock with icon buttons (Next play / drive / moment / Sim to end) and the call-mode segmented control.
- Moment cards slide up from the dock with the options as large cards (icon, label, staff read, EV chip).

## U3 — App-wide design system — `index.css` @theme, `src/ui/kit.tsx`
- **Dark mode** (system + toggle in the sidebar footer): add a dark token set (canvas #0b1220, surface #111a2b, surface-2 #16223a, line #22324d, ink #e8eef7, muted #93a4bd) via `prefers-color-scheme` and `[data-theme]`; every screen uses tokens only (sweep hard-coded colours).
- **Depth:** cards get `rounded-2xl`, 1px inner highlight, layered shadow `0 1px 0 rgba(255,255,255,.04) inset, 0 8px 24px -12px rgba(10,22,38,.25)`; glass headers (backdrop-blur) on sticky table headers and the top bar.
- **Motion:** 150–200 ms ease-out on hover/press for buttons, rows and cards; number counters tween when values change (record, cap space, ratings after growth); tab underline slides; skeleton shimmer while the real data loads (first ~5 s).
- **Data viz:** ratings as segmented bars with tier colours; sparklines (wins per season, player OVR history) in History / profile; radar chart for a player's position composites on the profile; mini bar for cap usage.
- **Top bar:** club gradient stays, but compact KPI chips with icons, a week progress pill (Week 4 of 18), and an animated "Advance week" primary button with a keyboard hint (⌘↵).
- **Sidebar:** icon + label with an active pill indicator that slides, collapsible to icons only, group headers smaller, unread badges (inbox, trade offers).
- **Command palette (⌘K):** jump to any screen, player (search by name) or club; actions like "Advance week", "Coach the game".
- **Tables:** zebra-free with row hover lift, sticky first column, column-header sort chips with ▲/▼, density toggle (comfortable / compact), sticky totals row where relevant.
- **Typography:** keep Barlow Condensed for display/numbers, Inter for body; tighten label tracking; larger hero numbers (OVR, scores) with tabular figures.

## U4 — Screen passes (after U3)
Dashboard (hero matchup card with both clubs' gradients, win-prob, keys, practice), Roster/Find a Player (player cards view toggle with face-less silhouettes + rating ring), Player profile (hero header in club colours, radar, OVR history sparkline, contract timeline), Trade Center (drag-and-drop assets into the middle tray), Draft (big-board cards with tier rings), Standings/Playoff picture (bracket view).

## DO NOT
No sim/engine changes, no rng, no new save fields except an optional UI pref (`theme`, `density`) stored in localStorage only. No new dependencies (SVG + CSS only; no chart libraries). Keep every existing feature and dev global working.
Do not edit `ORCHESTRATION_HANDOVER.md`, `OPENCODE_CONTINUE.md`, any other `NEXT_PHASE*.md`, `ROADMAP_*.md`, `IDEAS_*.md`, `HANDOFF.md`, `PLAYTEST_BACKLOG.md`. No git commands.

## Order
U1 (game day — the user's screenshot) → U2 → U3 → U4. Check each in the browser at desktop and phone width.
