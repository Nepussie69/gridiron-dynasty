# Multiple career save slots — backlog 131

User request: add multiple save slots to the Continue Career screen shown in the screenshot. Default to five named slots; each holds an independent career. Existing career must survive the upgrade.

## Ownership

DeepSeek implements in its isolated worktree. Own `src/game/persistence.ts`, relevant save/load/new-career actions and state in `src/store/gameStore.ts`, `src/screens/CareerHub.tsx`, `src/components/AppShell.tsx`, and optional reusable save-slot component. You are not alone: realism owns engine changes and animcontact owns animation; do not touch those modules or revert others. No RNG/sim tuning, dependency installation, git, markdown edits, dev/watch server, stable4173 rebuild, push or publish. Keep payload migrations and all dev probes working.

## Product behavior

- Landing screen has five numbered slots, custom label (rename), manager name, role/path, club, season/week and saved timestamp. Selected/default recent slot can Continue. Empty slot starts a New Career using existing setup UI. Starting a new career never silently overwrites any occupied slot; if full, explain and let user delete a specifically chosen slot after confirmation.
- Remove the current combined "Start fresh (erase this save)" trap. Provide separate New Career and explicit Delete for chosen slot. Delete confirmation names the slot/career and affects only that slot and its backup. Cancel leaves all saves intact.
- From an active career, Saves/menu returns to the slot picker to load another career or start a new one, after safely finishing the current autosave. Show active slot/label in menu. Rename and Continue work; new-career menu must no longer erase current career. Disable unsafe switching during an active unsaved game-day session or explicitly require finish/cancel using existing behavior; do not lose a live game silently.
- Autosave writes only active slot. Each slot has its own rolling backup. Export chosen/current slot, import valid existing export into an empty chosen slot by default; overwrite only after explicit UI confirmation. No data leaks between careers (world/career/statDb/awards/read news and stale match/gameDay/modal/selection state).
- Light/dark, desktop and375px with no horizontal page scroll, concise cards, reuse kit components. No technical implementation details in product flows.

## Persistence and safety

- Keep IndexedDB (multi-MB worlds); use additive slot keys/metadata/active-slot selection and schema compatibility. Legacy `career` plus `career_backup`, both pre-envelope and current version2 payloads, migrate idempotently into first free slot (normally Slot1). Copy primary AND backup before marking migration complete; never overwrite an existing slot; don't clear legacy data until safely copied. Preserve timestamp and save validation/backup recovery. Deleted migrated careers must not resurrect on reload.
- Validate slot IDs and all imported payloads BEFORE writing. Corrupt one slot must not wipe others. Backup fallback is per slot; display recovery status. Unknown future schema and unavailable/quota/transaction failure report clear errors and don't pretend data is saved/deleted/migrated.
- Resolve writes on transaction COMMIT, not request success. Primary+backup rotation atomically in one transaction. Capture data AND slot target when saving; queue/serialize appropriately so late writes cannot land in the newly selected slot, a deletion cannot be undone by a queued write, and rapid slot switches never cross-write. Explicit slot argument beats global active pointer; avoid shared-tab pointer crosswrites.
- Persist metadata without creating a huge payload read for every autosave-render. Saved label must survive subsequent autosaves, restart and import unless intentionally renamed. Use canonical migrations/relinking on load.
- Maintain compatible no-argument persistence API defaults for existing callers/probes if useful, but production store always targets the specific active slot. Test probes must not overwrite real user careers: isolated browser storage/DB or fake IndexedDB only; never operate on user Chrome/Pages existing saves.

## Acceptance

Build passes; lint exactly4. Real-data three seeds33333/2222/5150 ×500 --eq --smoke=coach:4,personnel:4, eq20/20, smokes0/0; exact unchanged prefeature simulation outputs (no tuning to hide preexisting bands). Animation end spots100%.

Meaningful persistence integration checks using isolated IndexedDB/browser:
1. Seed a legacy primary and backup; hydrate twice → only one migration, both preserved, rename survives autosave, old save continues normally.
2. Create coach careerA and personnelB in separate slots, advance/save, switch/reload each → independent world seeds, week/year/club/manager/statDb/awards; A unchanged by B/new-career/import/export.
3. Per-slot backup recovery after corrupt primary; corrupt one slot doesn't erase another. Invalid import leaves all existing bytes unchanged. Export/import existing version2 file into empty slot; full slots requires deliberate overwrite/delete.
4. Delete selected slot and reload → only target primary+backup gone, no legacy resurrection, canceled delete unchanged. Reuse empty slot safely.
5. Concurrent/rapid saves and switch/delete/new-career while pending: target isolation, latest save wins in correct slot, no stale active gameDay/match/sim context. Simulate failed/aborted transaction/quota/unavailable IndexedDB → honest failure, original data preserved.
6. Browser verify five-slot picker/new/continue/rename/delete confirmation plus in-career entry, desktop375px/lightdark. No actual user save mutation in tests.

Foreground checks, WAIT for completion (no detached tests left in final report). Save output `/private/tmp/saveslots-verify.out`, any independent probe paths. Final report changed files, behavior, migration safety, measured tests, all unfinished work. Do not claim tests passed without output.

## Progress

| Item | Status |
|---|---|
| Five career slots and safe migration | DeepSeek isolated implementation; acceptance pending |
