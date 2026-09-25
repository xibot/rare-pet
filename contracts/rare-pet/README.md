# RarePet care contract

**Implemented and locally tested; not deployed or audited.** This is a separate NFT-bound care ledger. It does not change Rare Friends metadata, take custody, charge RF, mint tokens, or accept payments. Transaction gas is paid by the caller. No deployment or wallet transaction is performed by the tests.

The only eligible collections are the [published Rare Friends contracts](https://rarefriends.com/docs/contracts) on Robinhood Chain **4663**:

| Collection | Contract |
| --- | --- |
| Genesis | `0x116EaA62241751E0c98dA43d458600c6C17cD361` |
| Generations | `0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D` |

Addresses were checked against the official documentation and the project's pinned FriendSDK / Genesis identity code on September 25, 2026. The contract verifies current `ownerOf` on **every write**. Approved operators, delegates, and previous owners cannot act as the owner. Care belongs to `(collection, tokenId)` and follows the NFT when transferred, including active cooldowns and play slots. Reads return a projected ledger, so an empty `getPet` response is not proof that a token exists or is owned.

## Rules implemented

These point amounts are explicit initial product rules; they do not affect original NFT rarity or metadata.

| Action | Availability | Change |
| --- | --- | --- |
| Pet | Once every 24 hours | +1 Kinship and +1 streak step |
| Feed | Once every 4 hours | +1 Strength, +5 Stamina per meal |
| Play | 3 accepted completion claims per rolling 24 hours | +10 Experience per verified run |
| Poop | Once every 4 hours | +1 Health per action |
| Launch | Unavailable; future 24-hour cooldown | Brain stays zero; no launch function |

Every action has its own clock. Pet, Feed and Poop reject early attempts without refreshing any timer. UTC midnight does not reset availability. Each Play claim consumes one slot until exactly 24 hours after that claim; staggered claims release staggered slots.

First pet starts streak 1. A pet unlocks 24 hours after the previous pet, then has a **24-hour grace window**. The exact 48-hour deadline is still on time. One second later, the streak and Rarity reset, and Kinship loses one point. Each further 24 hours overdue loses one additional Kinship point, clamped to zero. Petting after a miss starts a new streak at 1. Rarity equals `floor(current streak / 7)` and resets when the streak breaks. Feeding, playing and pooping never refresh this bond deadline.

`getPet` immediately projects overdue decay and expired play slots from chain time. The next successful action persists that projection without charging decay twice. No keeper or scheduled transaction is required. Explicit action flags distinguish a valid timestamp zero from an unused action.

## Preview cache upgrade

The client stores previews under `rarepet:preview:v2:<friend-key>`. Existing v1 points and streaks migrate without awarding new points, and the old Genesis/Generations key separation remains intact. The old cache did not record meal, poop or run timestamps: migration conservatively uses the latest possible time within each recorded UTC day (or the migration time for the current day). Previous-day activity may therefore temporarily occupy cooldowns or play slots; those expire normally. Migration is persisted once, so repeated page loads do not restart the clocks. A v2 reset takes precedence over any remaining v1 record. Previously applied decay is retained to avoid charging it again.

## Client API

- `pet(address collection, uint256 tokenId)`
- `feed(address collection, uint256 tokenId)`
- `poop(address collection, uint256 tokenId)`
- `play(address collection, uint256 tokenId, bytes32 runId, uint256 deadline, bytes signature)`
- `getPet(address collection, uint256 tokenId)` returns one tuple: eight `uint256` traits (`kinship, strength, stamina, health, experience, brain, streak, rarity`), four `uint256` timestamps (`lastPetAt, lastFeedAt, lastPoopAt, lastLaunchAt`), `uint256[3] playTimes`, `uint256 playCount`, `uint256 decayApplied`, then four booleans (`hasPet, hasFed, hasPooped, hasLaunched`). Only the first `playCount` slots are active; timestamp zero can be a valid slot. The client normalizes unused action timestamps to `-1` and retains only active play timestamps.
- `usedRuns(bytes32 runId)` returns whether a run was claimed anywhere in this contract.
- `playSigner()` returns the immutable completion authority; zero means rewards are disabled.

The compiler-generated ABI is [`RarePet.abi.json`](RarePet.abi.json). `CaredFor` records the action timestamp and identifies action values `0 = pet`, `1 = feed`, `2 = play`, `3 = poop`. Confirm a successful receipt from the configured chain and contract before presenting an action as saved; then reread `getPet`. All methods are nonpayable; do not add transaction value or token approvals.

## Rare Rush completion trust boundary

Opening Rare Rush is not proof of playing. An actual verified-run service is **not implemented** here. Until one exists, use `address(0)` as the constructor's `playSigner`, and keep the client reward claim unavailable. A nonzero signer is an immutable trusted EOA: compromising it allows fabricated play completions, bounded by per-NFT quotas. There is no signer rotation, admin, pause, proxy, or upgrade mechanism.

For an integrated verifier, use EIP-712 domain `{name: "RarePet", version: "1", chainId: 4663, verifyingContract: deployedAddress}` and primary type:

```text
Play(address owner,address collection,uint256 tokenId,bytes32 runId,uint256 deadline)
```

The service must validate completed gameplay, the selected NFT, and its current owner; assign a globally unique `runId`; and issue a short-lived deadline. The contract's `playDigest(...)` exposes the exact digest. Supply a 65-byte `r || s || v` signature with canonical low `s` and `v` 27 or 28. The owner submits the transaction. Claims bind the owner, collection, token ID, run ID, deadline, chain, and deployed contract. Every accepted `runId` is consumed globally, so transferring the NFT, switching collections, or waiting for a new day cannot replay it. The three-slot rolling window applies to **accepted claim time**. The unchanged receipt interface does not include a signed completion timestamp. The attestor is responsible for completion-time and run-freshness policy; the wallet-free preview uses the actual local run completion timestamp.

## Local validation

Because the signer is immutable, deploying with `address(0)` permanently disables live XP on that instance. Establish the completion service and its final signer before deploying an instance intended to support Play rewards; adding XP later to a zero-signer instance requires a new deployment and a separate care-state migration design.

Requires Foundry and Solidity 0.8.30; there are no Solidity library dependencies.

```sh
cd contracts/rare-pet
forge test -vv
```

Coverage includes exact cooldown boundaries, the inclusive 48-hour grace deadline, epoch-zero timestamps, staggered and simultaneous rolling play slots, seven-step Rarity milestones, transfer ownership, collection/token isolation, persisted decay, disabled Play rewards, EIP-712 field/domain binding, invalid/expired/malleable signatures, and replay prevention. Fuzz tests check decay underflow and duplicate charging over 256 cases. Tests use local mocks at the canonical collection addresses; no live network is contacted. A live-chain integration test and independent contract review remain outstanding.
