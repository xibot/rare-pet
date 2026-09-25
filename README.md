# RarePet

**RARE PET BY XIBOT**. A daily care app for Genesis and Generations Rare Friends, using the same canonical artwork, FriendSDK identity checks, visual language, and actual Rare Rush engine as Rare Rush.

## Run

Requires Node.js **22.18 or later in the 22.x release line** and npm.

```sh
npm ci
npm run dev
# http://localhost:4175
```

This is the standalone RarePet repository. The app lives in `games/rare-pet`; the minimum Rare Rush engine, identity reader, fonts, and canonical preview artwork needed by RarePet are retained under `games/rare-rush`. `npm run build` creates the static distributable in `dist-pet`. The included `vercel.json` uses `npm ci`, `npm run build`, and that output directory; it does not deploy anything. The care contract has not been deployed.

## What works

- Explicit Preview and My Wallet modes. Preview offers three canonical Genesis and three Generations Friends, wallet-free Pet, Feed, Poop and actual Rare Rush play. Per-Friend device storage, daily limits, deadline decay and seven-day rarity milestones remain separate from wallet care. Reset Preview resets only the selected sample’s care.
- Genesis portraits use the same 36 canonical Generations bodies as Rare Rush. Change Body selects a different body and carries it into the embedded game; the original portrait stays intact. Meadow, Moon, Arcade and Beach islands, the chosen body and the last preview Friend are remembered on this device. All showcase choices are cosmetic.
- Three reactions each for Pet, Feed, Poop and completed Play, with hearts, different snacks, cleanup effects and XP celebrations. Reduced-motion preferences disable animation and decorative effects.
- Connect an injected browser wallet through FriendSDK; switch to Robinhood Chain (4663); discover and select Genesis or Generations. Current ownership and original art are reverified before selection. Manual token verification remains available if transfer-history discovery is incomplete. Generation 0 can receive care; Rare Rush requires a Genesis or hardwired Generations Friend.
- Left-side actions and a large Friend stage; trait panel, 24-hour bond clock, seven-day streak strip, guide, transaction status, collection selector, keyboard-accessible native dialogs, reduced-motion behavior.
- Rare Rush embedded with the same selected NFT. Preview XP is granted only by an actual completed run, once per run, at most three per UTC day. Closing a game does not earn XP.
- Solidity care ledger in `contracts/rare-pet`. Every write checks current ownership. Each `(collection, tokenId)` has its own care state, which follows the NFT on transfer. Daily quotas, decay, and rarity are enforced onchain, separately from original NFT metadata.
- Live client path for Pet, Feed, and Poop: fresh ownership, transaction simulation, explicit wallet confirmation, matching receipt/event verification, and confirmed-block readback. Actions remain unavailable until a trusted care deployment is configured.

## Initial care rules

These are the explicit first implementation choices for the user's concept; they can be revised before deployment.

| Action | Limit | Result |
| --- | --- | --- |
| Pet | One reward per UTC day; extra refreshes allowed | +1 Kinship; maintain a rolling 24-hour bond |
| Feed | 5/day | +1 Strength and +5 Stamina per meal |
| Play | 3 rewarded completed runs/day | +10 Experience per completion |
| Launch | Soon; intended 1/day | Brain integration reserved |
| Poop | 3/day | +1 Health per break |
| Streak | Consecutive daily pets within 24 hours | +1 Rarity per 7 days |

First pet starts streak 1. Extra same-day pets refresh the deadline without granting more points. Exactly 24 hours is on time. Going one second past the deadline breaks the streak, resets its Rarity, and loses one Kinship; another point is lost for each additional missed 24-hour period, clamped at zero. The contract projects decay in reads and persists it at the next action, without a scheduled keeper. Feeding, playing, and pooping do not refresh the bond. Quotas reset at midnight UTC. The UI labels these rules in How to care.

Stamina currently accumulates as a care trait; it does not charge for play or regenerate on a separate schedule. Rarity is a RarePet streak score, not the original collection rarity. Brain remains zero until a real launch integration exists.

## Activation boundaries

The wallet selector reads **real ownership**. The initial habitat is explicitly **Preview Mode**. Its state is namespaced `rarepet:preview:v1` and never becomes onchain state. Genesis samples have collection-prefixed keys to separate them from Generations with the same token number; existing Generations preview saves are preserved. Owned Friends do not receive simulated care points. The app never signs a message merely to imitate a blockchain write.

To enable live Pet/Feed/Poop after deployment, build with the trusted deployment address:

```sh
RAREPET_CONTRACT_ADDRESS=0xYourDeployedRarePetAddress npm run build
```

The address is set at build time, not from a URL or local storage. Only public configuration is included. No private key or wallet authority belongs in this app. The contract has no RF fee, NFT custody, approvals, token minting, or transaction value; the owner's wallet pays network gas.

**Live Experience still needs a verified completion service and client claim integration.** The contract already accepts owner-bound EIP-712 completions with replay protection, but browser callbacks are not trusted evidence. The current live UI opens Rare Rush while explaining that XP receipts are not connected. The Solidity signer is immutable: deploying with a zero signer permanently disables Play rewards for that instance. Set the final completion signer before a deployment intended to support live XP; otherwise a new contract/migration will be necessary later. See the contract README for the signing format and trust model. Launch remains intentionally unavailable.

## Validation

```sh
npm run typecheck
npm test
npm run build
# With npm run dev active and Google Chrome installed:
npm run test:browser
npm run test:wallet
# With Foundry and solc 0.8.30 installed:
cd contracts/rare-pet && forge test -vv
```

The care-model tests cover UTC reset, duplicate pet rewards, exact/overdue 24-hour boundaries, projected decay, streaks, and quota caps. Canonical body tests verify 324 frames, connected geometry, portrait placement and body selection. Browser checks exercise desktop and 390px/320px mobile layouts, both preview collections, isolated care/reset, island and body persistence, varied action effects, reduced motion, real game completion and no XP on incomplete games. Wallet fixtures check fresh ownership, network/account changes and switching back to Preview without signing. Contract tests additionally cover transfers, identity separation, signatures, replay, and fuzzed decay. Live-chain deployment testing is still outstanding.

## Artwork and reuse

Rare Friends artwork and FriendSDK are credited in the app and distributed `credits.txt`. Generations preview art and body frames use the cached public registry art from Rare Rush, with original provenance. Genesis preview portraits are verified original tokenURI SVGs cached at mainnet block 72489062 in `games/rare-pet/preview-genesis.json`; owned Genesis portraits are freshly validated. The body catalog and provenance are documented in `games/rare-rush/genesis/BODIES.md`. Fonts are the existing licensed Silkscreen, Archivo, and Sometype Mono assets. Islands and action effects are decorative interface artwork, not replacement Rare Friends characters.

Rare Rush integration uses optional `beforeRun`, `onRunComplete`, and `previewSprites` props, plus `bodyId` and `onRunComplete` on GenesisRush. The reused game engine and original economy are included with their unit tests. This repository does not contain the separate Rare Rush website, testnet services, launchpad, analytics, or deployment infrastructure.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [SDK notices](licenses/FRIENDSDK-NOTICE.md), [SDK license](licenses/friendsdk-APACHE-2.0.txt), and the retained [font provenance](games/rare-rush/assets/fonts/provenance.md). Source availability is not a grant of rights to Rare Friends branding; the SDK artwork permissions are stated in its notices.
