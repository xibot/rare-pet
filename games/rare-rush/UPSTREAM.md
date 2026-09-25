# Rare Rush embedded in RarePet

Gameplay source: https://github.com/xibot/rare-rush at commit `da952d7d825dabb13b3bd9a724fd2b80d99404a0` (2026-09-25).

RarePet uses the production direction engine, not the classic-only engine. The `twist/` modules, `RunnerArt.tsx`, `BrandMark.tsx`, `style.css`, `replay-recorder.ts`, `analytics.ts`, and `run-save-bridge.ts` are copied unchanged from this revision. The classic `engine.ts` still supplies shared types/constants and its existing tests; gameplay starts through `twist/engine.ts`. The presentation and twist tests are retained from the same revision.

`index.tsx` carries a small host adapter: `beforeRun` gates every attempt, `onRunComplete` reports once per actual completed run, `previewSprites` keeps wallet-free art offline, and Genesis `bodyId` preserves the pet's chosen body. Callback refs and the initialization guard protect against stale asynchronous starts. `enableRunSaving={false}` is supplied by both RarePet hosts; the separate Rare Rush public replay service is not connected here. Analytics is inactive for the top-level RarePet page.

When updating from Rare Rush, update the complete engine, rendering, input-recorder and dependent modules together. Preserve the host adapter and `games/rare-pet/play-dialog.css`, then run typecheck, the full unit suite, the Pet browser/wallet suites and `test:twist`. The twist browser test instruments only an isolated temporary build to exercise legal controls through full runs; production contains no test pilot or observer.
