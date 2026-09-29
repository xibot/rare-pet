---
name: rarepet
description: Help humans and agents care for Genesis and Generations Rare Friends in RarePet. Read onchain traits and cooldowns, prepare unsigned Pet/Feed/Poop transactions, and guide the app’s wallet, sharing, launch and trading workflows.
---

# RarePet

A Rare Friend is a Rare Pet. Use this skill with [RarePet](https://rarepet.app), its [human guide](https://rarepet.app/docs), and [agent page](https://rarepet.app/agent).

## Choose the right workflow

- **Check a Friend or plan care:** read [onchain.md](references/onchain.md). The bundled helper reads ownership, current traits, lifetime totals, recent care history, live policy, cooldowns and launch Brain. It can simulate and print unsigned Pet, Feed or Poop calldata.
- **Choose a Friend, customize/share, use Rare Wallet, launch, claim creator fees or trade:** read [app-workflows.md](references/app-workflows.md). These workflows use the app’s reviewed forms and the user’s wallet.

Use collection + token ID as identity; names and artwork do not prove ownership. Ask for the missing collection or token ID when they cannot be inferred. Read the current owner from the canonical collection before treating a Friend as the user’s. Public status reads do not require ownership or wallet connection.

## Start with a read

Requires Node.js 22 or later. Run from this skill’s directory; there are no npm dependencies.

```sh
node scripts/rarepet.mjs status --collection generations --token-id 68356
```

Use the returned block number and timestamp when describing a snapshot. Integer quantities in JSON are decimal strings. Report ready actions and the next unlock; never infer a midnight reset. The helper uses the public Robinhood mainnet RPC, or an optional locally configured `RAREPET_RPC_URL`. Never put a private endpoint, key or seed phrase into chat, generated plans or public files.

For an explicitly requested Pet, Feed or Poop, replace the placeholder with the **public owner address**:

```sh
node scripts/rarepet.mjs plan --collection generations --token-id 68356 --action pet --owner 0xYOUR_PUBLIC_OWNER_ADDRESS
```

The helper verifies the chain, pinned contract runtime, canonical owner, current rule version, readiness and a read-only simulation. It outputs a zero-value transaction for review. It cannot sign or broadcast. A plan becomes stale; recheck and simulate before sending through an authorized wallet integration.

## Action authority

Installing or invoking this skill grants no wallet authority. A request to inspect or prepare a plan does not authorize signing. For an authorized care action, present the Friend, action, trait gain, contract, chain and gas implications before the wallet confirmation. An existing explicit standing authorization may cover routine care only within its stated Friend/action scope, gas budget and expiry; this skill does not create such an authorization or a scheduler.

Launches, approvals, swaps, transfers and fee claims need their own user-authorized scope and concrete review. Never infer a financial action from “take care of my Friend.” Do not request raw private keys or seed phrases. Respect the wallet/tool’s confirmation flow. If the account, Friend, chain, quote, recipient, rules or reviewed amounts change, refresh the review before continuing.

After a submission, retain its transaction hash. A wallet signature or returned hash is not success. Verify a successful receipt, the expected contract event and canonical block before reporting earned traits. If a request is rejected, stop. If confirmation is unknown, inspect the existing transaction before any retry; see recovery steps in the onchain reference.

## What is live

Pet, Feed and Poop record care on Robinhood Chain mainnet. Brain is recorded by successful **Friend launches in the separate launch router**. Lifetime earned care and action history are permanent; current Kinship, streak and streak Rarity can decay. Read active policy instead of assuming initial values.

Play opens Rare Rush. Preview XP is local; wallet Play XP is still pending completion verification. This skill does not prepare Play claims, fabricate run proofs or award XP. V1 does not include HOLD & CLAIM, automatic holder rewards or active rarity-farming prizes. Sharing makes local PNG/GIF downloads; it does not post to X without a separate explicit request.

The bundled address and ABI reference is [protocol.json](references/protocol.json), checked against the repository’s deployment manifests on 2026-09-28. If the pinned runtime or supported deployment no longer matches, stop transaction planning and obtain a reviewed skill update. Source verification is not an independent security audit.
