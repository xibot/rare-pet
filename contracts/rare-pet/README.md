# RarePet care contract

**Implemented and locally tested; not deployed or audited.** This is a separate NFT-bound care ledger. It does not change Rare Friends metadata, take custody, charge RF, mint tokens, or accept payments. Transaction gas is paid by the caller. No deployment or wallet transaction is performed by the tests.

The only eligible collections are the [published Rare Friends contracts](https://rarefriends.com/docs/contracts) on Robinhood Chain **4663**:

| Collection | Contract |
| --- | --- |
| Genesis | `0x116EaA62241751E0c98dA43d458600c6C17cD361` |
| Generations | `0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D` |

Addresses were checked against the official documentation and the project's pinned FriendSDK / Genesis identity code on September 25, 2026. The contract verifies current `ownerOf` on **every write**. Approved operators, delegates, and previous owners cannot act as the owner. Care belongs to `(collection, tokenId)` and follows the NFT when transferred, including remaining daily quotas. Reads return a projected ledger, so an empty `getPet` response is not proof that a token exists or is owned.

## Rules implemented

These point amounts are explicit initial product rules; they do not affect original NFT rarity or metadata.

| Action | UTC daily limit | Change |
| --- | --- | --- |
| Pet | One reward; refreshes allowed anytime | +1 Kinship and +1 streak day |
| Feed | 5 | +1 Strength, +5 Stamina per meal |
| Play | 3 accepted completion claims | +10 Experience per verified run |
| Poop | 3 | +1 Health per action |
| Launch | Unavailable | Brain stays zero; no launch function |

First pet starts streak 1. Every pet refreshes the deadline to `block.timestamp + 24 hours`; same-UTC-day refreshes grant no additional Kinship or streak. A pet on a new UTC day at or before that deadline adds one streak day. Exactly 24 hours is on time. One second later, the streak and Rarity reset, and Kinship loses one point. Each further 24 hours overdue loses one additional Kinship point, clamped to zero. Petting after a miss starts a new streak at 1. Rarity equals `floor(current streak / 7)` and resets when the streak breaks. This UTC reward model allows a reward on either side of midnight; it is not a minimum-24-hour interval between rewards.

`getPet` immediately projects overdue decay and quota resets from chain time. The next successful action persists that projection without charging decay twice. No keeper or scheduled transaction is required. Feeding, playing, and pooping do not refresh the petting deadline. Feed, play, and poop quotas reset at 00:00 UTC regardless of the petting deadline.

## Client API

- `pet(address collection, uint256 tokenId)`
- `feed(address collection, uint256 tokenId)`
- `poop(address collection, uint256 tokenId)`
- `play(address collection, uint256 tokenId, bytes32 runId, uint256 deadline, bytes signature)`
- `getPet(address collection, uint256 tokenId)` returns one tuple, all `uint256`, in this order: `kinship, strength, stamina, health, experience, brain, streak, rarity, lastPetAt, careDay, feedsToday, playsToday, poopsToday`.
- `usedRuns(bytes32 runId)` returns whether a run was claimed anywhere in this contract.
- `playSigner()` returns the immutable completion authority; zero means rewards are disabled.

The compiler-generated ABI is [`RarePet.abi.json`](RarePet.abi.json). `CaredFor` identifies action values `0 = pet`, `1 = feed`, `2 = play`, `3 = poop`. Confirm a successful receipt from the configured chain and contract before presenting an action as saved; then reread `getPet`. All methods are nonpayable; do not add transaction value or token approvals.

## Rare Rush completion trust boundary

Opening Rare Rush is not proof of playing. An actual verified-run service is **not implemented** here. Until one exists, use `address(0)` as the constructor's `playSigner`, and keep the client reward claim unavailable. A nonzero signer is an immutable trusted EOA: compromising it allows fabricated play completions, bounded by per-NFT quotas. There is no signer rotation, admin, pause, proxy, or upgrade mechanism.

For an integrated verifier, use EIP-712 domain `{name: "RarePet", version: "1", chainId: 4663, verifyingContract: deployedAddress}` and primary type:

```text
Play(address owner,address collection,uint256 tokenId,bytes32 runId,uint256 deadline)
```

The service must validate completed gameplay, the selected NFT, and its current owner; assign a globally unique `runId`; and issue a short-lived deadline. The contract's `playDigest(...)` exposes the exact digest. Supply a 65-byte `r || s || v` signature with canonical low `s` and `v` 27 or 28. The owner submits the transaction. Claims bind the owner, collection, token ID, run ID, deadline, chain, and deployed contract. Every accepted `runId` is consumed globally, so transferring the NFT, switching collections, or waiting for a new day cannot replay it. The three-per-day limit applies to **claim time**. The attestor is responsible for completion-time and run-freshness policy.

## Local validation

Because the signer is immutable, deploying with `address(0)` permanently disables live XP on that instance. Establish the completion service and its final signer before deploying an instance intended to support Play rewards; adding XP later to a zero-signer instance requires a new deployment and a separate care-state migration design.

Requires Foundry and Solidity 0.8.30; there are no Solidity library dependencies.

```sh
cd contracts/rare-pet
forge test -vv
```

Local result: **23 passing tests**, including 256 fuzz cases for overdue decay. Coverage includes exact/late 24-hour boundaries, epoch zero, same-day reward farming, seven-day Rarity milestones, all quotas and UTC reset, transfer ownership, collection/token isolation, persistence of decay, disabled play rewards, EIP-712 field/domain binding, invalid/expired/malleable signatures, and replay prevention across days, collections, and token IDs. Tests use local mocks at the canonical collection addresses; no live network is contacted. This execution used Foundry 1.7.1 with cached solc-js 0.8.30 through a temporary local compiler adapter. A live-chain integration test and independent contract review remain outstanding.
