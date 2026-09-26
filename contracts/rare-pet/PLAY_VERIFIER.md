# Rare Rush completion verifier

**Not connected.** RarePet currently has no mainnet service that verifies a run and signs a care reward receipt. Keep onchain Play rewards disabled until that service is implemented, tested, configured with its own signer, and activated. Opening the game or receiving the browser's `onRunComplete` callback is not proof of a completed run.

The care contract can enforce ownership, receipt validity, one claim per run and per-Friend limits. It cannot independently execute the Rare Rush engine. A configured completion signer is a trusted authority: its compromise could fabricate completions within those contract limits. Replay verification proves that inputs produce a legal completed run; it does not prove human play, prevent automation, or make the result trustless.

## Reusable code

RarePet already contains the pinned gameplay engine and dense input recorder:

- `games/rare-rush/twist/engine.ts`: deterministic fixed-step gameplay.
- `games/rare-rush/replay-recorder.ts`: ordered controls and complete replay export.
- `games/rare-rush/UPSTREAM.md`: pinned upstream revision and update requirements.

The sibling `published/rare-rush` project has reusable validation patterns, not a drop-in RarePet reward service:

- `infra/testnet/src/replay.ts`: strict bounded input parsing and engine replay. Its reward policy requires surviving the timer.
- `agent-play/runner.ts`: `checkAgentReplay` validates complete wins and losses. Use an explicit RarePet completion policy; do not silently substitute the stricter Testnet policy.
- `infra/testnet/src/verifier-core.ts`: ownership, confirmed chain state, engine version, signer epoch and short-lived receipt checks. This implementation only supports its existing Testnet/local game contract and cannot sign RarePet receipts unchanged.
- `server/replay-feed.mjs` and `server/replay-arcade.mjs`: bounded requests, publication authorization, ownership checks and immutable replay storage. The publication API accepts a client-selected seed and does not authorize care rewards.

Copy or extract the minimal relevant modules into this repository before use; production must not import a sibling checkout. Pin the complete engine dependency graph and replay format together, and test the browser recording against the server validator.

## Required reward flow

1. **Start a bound session.** Issue an unpredictable challenge seed and a unique run ID bound to the current owner, collection, token ID, chain, care contract, active rule version, pinned engine version, difficulty, start time and expiry. Authenticate the challenge so a browser cannot change these fields. Verify the eligible NFT and current owner through the configured chain RPC.
2. **Record legal inputs.** Supply that seed to the game. Export its dense replay on completion; the existing callback reports only score, elapsed time and difficulty and needs an explicit replay/session adapter. Never trust submitted scores, elapsed time, state snapshots or a browser completion flag.
3. **Validate on the server.** Enforce request byte, frame, nesting and execution limits; reject malformed, truncated and post-finish inputs. Re-execute the exact pinned engine. Check the session has not expired and that enough wall-clock time has elapsed for the verified run. Apply the documented completion policy, recheck current ownership and verify the contract's active signer and `currentRuleVersion`.
4. **Sign the contract's exact receipt.** Use the deployed contract's EIP-712 domain and fields, with a short expiry and the session's stable run ID. Keep the dedicated signing key server-side, separate from the treasury and deployment wallets. Never expose it through a `VITE_`/`NEXT_PUBLIC_` variable, browser bundle, logs or repository.
5. **Claim and refresh.** The current NFT owner submits the signed claim. Only a successful confirmed transaction and refreshed contract state should award live XP in the UI. A failed claim must not produce a local substitute reward.

Retries must retain the same run ID. A new ID for the same session would bypass one-run-one-claim protection. Durable session storage can provide idempotency and audit records; alternatively, an authenticated stateless challenge can bind the identity while the contract consumes it once. Either design needs distributed abuse controls and a bounded failure mode when RPC/verification is unavailable. `RarePetCare` binds receipts to `currentRuleVersion`: every activated rules update invalidates outstanding receipts, including signer changes and restoring an earlier signer address. Do not silently move a pending session to a newer rule version.

## Activation checks

Test valid wins/losses under the chosen policy, modified challenges, changed seeds/difficulty/identity/engine, fabricated scores, early completion, stale ownership, expired receipts, wrong domains, signer rotation, duplicate and concurrent submissions, malformed/oversized replays, and service/RPC outages. Verify the same legal browser recording replays identically on the server. Enable the signer only after the deployed service passes those checks; no live signer or service is supplied by this document.
