# RarePet

**RARE PET BY XIBOT**. A daily care app for Genesis and Generations Rare Friends, using the same canonical artwork, FriendSDK identity checks, visual language, and actual Rare Rush engine as Rare Rush.

## Run

Requires Node.js **22.18 or later in the 22.x release line** and npm.

```sh
npm ci
npm run dev
# http://localhost:4175
```

This is the standalone RarePet repository. The app lives in `games/rare-pet`; the minimum Rare Rush engine, identity reader, fonts, and canonical preview artwork needed by RarePet are retained under `games/rare-rush`. `npm run build` creates the static distributable in `dist-pet`, including real `/docs/` and `/launch/` pages. The local server supports `/docs/`, `/launch/`, their slashless routes and direct reloads; all pages load the shared root-level assets. The included `vercel.json` uses `npm ci`, `npm run build`, and that output directory; it does not deploy anything. The care and launch contracts have not been deployed. Public launches remain gated until the launch router and treasury are reviewed and configured with the confirmed 85/10/5 fee split.

## What works

- Explicit Preview and My Wallet modes. Preview offers three canonical Genesis and three Generations Friends, wallet-free Pet, Feed, Poop and actual Rare Rush play. Per-Friend device storage, independent care cooldowns, deadline decay and seven-pet rarity milestones remain separate from wallet care. Reset Preview resets only the selected sample’s care.
- Genesis portraits use the same 36 canonical Generations bodies as Rare Rush. Change Body selects a different body and carries it into the embedded game; the original portrait stays intact. Six canonical Worlds and five Classic floors are selectable. Background islands always match the main island, with smaller flybys for Classic. Separate sky and side corridors reserve space for the main pet, its speech and animations; narrow screens use one sky corridor. The island, chosen body and last preview Friend are remembered on this device. All showcase choices are cosmetic.
- Three reactions each for Pet, Feed, Poop and completed Play, with hearts, different snacks, cleanup effects and XP celebrations. Reduced-motion preferences disable animation and decorative effects.
- Connect an injected browser wallet through FriendSDK; switch to Robinhood Chain (4663); discover and select Genesis or Generations. Current ownership and original art are reverified before selection. Manual token verification remains available if transfer-history discovery is incomplete. Generation 0 can receive care; Rare Rush requires a Genesis or hardwired Generations Friend.
- Rare Wallet opens the selected Friend’s canonical wallet with a copyable address, native ETH, ERC-20 and ERC-721/ERC-1155 holdings. Assets are discovered from recipient-filtered history and checked against one chain snapshot, with bounded continuation and manual asset lookup. Reviewed transfers execute from the Friend account; the connected owner pays gas. Preview cannot access real wallets.
- Left-side actions and a large Friend stage; trait panel, per-action countdowns, bond deadline, seven-pet streak strip, documentation page, transaction status, collection selector, keyboard-accessible native dialogs, reduced-motion behavior.
- Current Rare Rush gameplay embedded with the same selected NFT: connected suction shafts and free falls, continuously spinning Friends, occasional leftward exits, direction-aware keyboard/touch controls, flying 10× coins, growth, shields and magnets. Preview XP is granted only by an actual completed run, once per run, with three completion slots in a rolling 24-hour window. Each rewarded completion releases its slot 24 hours later. Closing a game does not earn XP.
- Rare Launchpad at `/launch/` toggles Launch as Yourself and Launch as Your Rare Friend. Its form supports a local 512 × 512 image crop, token name/ticker, WETH or the full pinned Robinhood Chain stock/ETF token catalog with ticker/name search, and 0.3%/1%/2% trading fees. The owned-wallet flow signs an image-upload authorization, stores public image bytes under their content hash, embeds the URL/hash in onchain JSON metadata, reviews the exact token/pool/fees, then launches directly from the connected wallet or executes through the selected canonical Rare Wallet. Live launches and claims use the verified Robinhood router listed below; each write still requires the creator’s wallet confirmation.
- Solidity care ledger in `contracts/rare-pet`. Every write checks current ownership. Each `(collection, tokenId)` has its own care state, which follows the NFT on transfer. Care cooldowns, rolling Play slots, decay, and rarity are enforced onchain, separately from original NFT metadata.
- Live client path for Pet, Feed, and Poop: fresh ownership, transaction simulation, explicit wallet confirmation, matching receipt/event verification, and confirmed-block readback. Actions remain unavailable until a trusted care deployment is configured.

## Care rules

Each action has an independent timer; there is no shared midnight reset.

| Action | Cooldown | Result |
| --- | --- | --- |
| Pet | Once every 24 hours | +1 Kinship; advance an unbroken care streak |
| Feed | Once every 4 hours | +1 Strength and +5 Stamina per meal |
| Play | 3 rewarded completed runs in a rolling 24-hour window | +10 Experience per completion; each slot returns 24 hours later |
| Launch as Your Rare Friend | Once every 24 hours after a confirmed launch; activation pending | +1 Brain in the separate launch router ledger |
| Poop | Once every 4 hours | +1 Health per break |
| Streak | Pet after its 24-hour cooldown and within a further 24-hour grace window | +1 Rarity per 7 consecutive care cycles |

The first pet starts streak 1. Pet unlocks exactly 24 hours later, followed by a 24-hour grace window: the bond deadline is 48 hours after the last successful pet. Exactly at the deadline is on time. Going one second past it breaks the streak, resets its Rarity, and loses one Kinship; another point is lost for each additional missed 24-hour period, clamped at zero. The next Pet starts a new streak. The contract projects decay in reads and persists it at the next action, without a scheduled keeper. Feeding, playing, and pooping do not refresh the bond.

The `/docs/` page explains modes, collections, cosmetic choices, every action and trait, cooldowns, streaks and activation status. Its grace-period copy receives the care model's configured value from the app.

Stamina currently accumulates as a care trait; it does not charge for play or regenerate on a separate schedule. Rarity is a RarePet streak score, not the original collection rarity. Brain comes from the separate launch router’s confirmed launch records; live rewards remain unavailable until that contract is deployed and configured.

## Activation boundaries

The wallet selector reads **real ownership**. The initial habitat is explicitly **Preview Mode**. Its state is namespaced `rarepet:preview:v2` and never becomes onchain state. Existing v1 saves are migrated once, preserving earned traits and assigning conservative cooldown timestamps where the old save did not track action times. Genesis samples have collection-prefixed keys to separate them from Generations with the same token number; existing Generations preview saves are preserved. Owned Friends do not receive simulated care points. The app never signs a message merely to imitate a blockchain write.

To enable live Pet/Feed/Poop after deployment, build with the trusted deployment address:

```sh
RAREPET_CONTRACT_ADDRESS=0xYourDeployedRarePetAddress npm run build
```

The address is set at build time, not from a URL or local storage. Only public configuration is included. No private key or wallet authority belongs in this app. The contract has no RF fee, NFT custody, approvals, token minting, or transaction value; the owner's wallet pays network gas.

**Live Experience still needs a verified completion service and client claim integration.** The contract already accepts owner-bound EIP-712 completions with replay protection, but browser callbacks are not trusted evidence. The current live UI opens Rare Rush while explaining that XP receipts are not connected. The Solidity signer is immutable: deploying with a zero signer permanently disables Play rewards for that instance. Set the final completion signer before a deployment intended to support live XP; otherwise a new contract/migration will be necessary later. See the contract README for the signing format and trust model. Launch activation uses its own contract and configuration, described below.

## Validation

```sh
npm run typecheck
npm test
npm run build
# With npm run dev active and Google Chrome installed:
npm run test:browser
npm run test:wallet
npm run test:rare-wallet
npm run test:rare-wallet:browser
# With Foundry and solc 0.8.30 installed:
forge test --root contracts/rare-pet -vv
forge test --root contracts/rare-launchpad -vv
node --test contracts/rare-launchpad/test/deployment-config.test.mjs
```

The care-model tests cover independent cooldowns, duplicate rewards, exact/overdue bond boundaries, projected decay, streaks, and rolling Play slots. Canonical body tests verify 324 frames, connected geometry, portrait placement and body selection. Browser checks exercise desktop and 390px/320px mobile layouts, both preview collections, isolated care/reset, island and body persistence, varied action effects, reduced motion, real game completion and no XP on incomplete games. Wallet fixtures check fresh ownership, network/account changes and switching back to Preview without signing. Contract tests additionally cover transfers, identity separation, signatures, replay, and fuzzed decay. Live-chain deployment testing is still outstanding.

## Rare Wallet execution

Rare Wallet uses the FriendSDK 0.1.2 account interface from `src/chain.ts`: `execute(address,uint256,bytes,uint8)`, `owner()` and `token()`. Execution is restricted to CALL (operation 0), with zero outer ETH value. Supported calls are native ETH sends, ERC-20 `transfer`, and ERC-721/ERC-1155 `safeTransferFrom`. Ownership, canonical account binding, deployment, balances, network/provider identity and simulation are verified before asking the owner to sign. Receipt events and exact transaction calldata are checked before reporting confirmation.

Read-only mainnet verification on 2026-09-25 checked Genesis #2 (wallet `0x460e849Bf2fC54983Cdbc60e6e13E49307e7D0dd`) and hardwired Generations #68356 (wallet `0xDe2fB641C01Fc91C7C5Bd8e99435C6ca0dFd9F6C`). Both use account implementation `0xed038886c002b285eb0f74971e967b02f6af8ea55a`; owner/token binding matched the canonical collections, owner execution simulated successfully, and outsider execution reverted. No real transfer was sent during development.

Asset discovery uses public Robinhood RPC rather than depending on explorer availability. Standard incoming Transfer, TransferSingle and TransferBatch events identify candidates; current balances and NFT ownership are verified at a pinned block. Eventless/nonstandard assets may require manual lookup. Rate limits, partial history, missing metadata and failed balance checks remain explicit. A pending balance is never rendered as zero. `rare-wallet-holdings.ts` also provides a paginated Blockscout reader; the UI currently uses RPC discovery because the explorer can challenge browser access.

`test:rare-wallet` checks exact amounts, history coverage, pagination, failed reads, canonical execution, session changes, duplicates and receipt verification. `test:rare-wallet:browser` mocks every blockchain and wallet request while exercising preview, holdings, review, transfers and responsive dialogs. No test submits a live transaction.

## Rare Launchpad

`games/rare-pet/launch-doppler.ts` integrates Doppler SDK 1.0.43 with the canonical Robinhood `DopplerHookInitializer`, ERC-20 V1 factory, NoOp governance and NoOp migrator. The router in `contracts/rare-launchpad` constructs all module parameters itself and supports two separate routes. `launch` requires owner-authorized canonical RF account entry and enforces a rolling 24-hour NFT-bound limit. `launchAsSelf` requires no NFT, has no daily limit and only increments the caller’s separate launch count. Both enforce full supply to the pool with zero vesting allocations and a fixed initial fee allocation. Only the RF route credits one Brain after checking the created asset, module receipt and beneficiaries. Self launches cannot alter NFT Brain or its cooldown. No owner, upgrade, withdrawal or arbitrary external-target setter exists in the router.

The product preset is **1 billion tokens**, **100% assigned to the pool**, approximately **$10,000 initial fully diluted value**, four liquidity curves, and a selectable **0.3%, 1% or 2% swap fee**. Canonical Doppler sends any pool rounding dust to NoOp governance’s burn address. Initial USD value is a price configuration, not funds raised or a guaranteed valuation. Quotes are WETH and all 195 active stock/ETF tokens in the verified Robinhood Chain catalog snapshot. Stocks are individually identified Robinhood tokens, not a single `STOCKS` token. `games/rare-pet/launch-quote-catalog.json` is the shared source for the picker, transaction adapter and deployment allowlist. Regenerate it with `node scripts/generate-launch-quote-catalog.mjs` when reviewing a catalog update; additions require a reviewed contract deployment, not an unverified runtime address. Before market preparation the app checks issuer registry identity, deployed contracts, token metadata and a current USD price. Verified Chainlink feeds price 35 stocks and WETH; the remaining 160 stocks use Robinhood’s official bid/ask midpoint multiplied once by the verified onchain multiplier. Stale, paused or unverifiable prices fail closed. Issuer prices also require no trading halt and agreement between registry and onchain multipliers. The final review identifies the price source.

**The confirmed fee split is 85% creator / 10% treasury / 5% Doppler.** “Creator” means the connected wallet for self launches or the RF wallet for Friend launches. The contract and deployment handoff accept only this split. The confirmed treasury/deployer is `0xCa88efc94b567A5185FEA63599aD895c3e514FBc`; the router is deployed at `0x8c46baA63079B8648b1cd5689058E0AAB33DF063` on Robinhood Chain. Fee claims execute directly from the creator or through the RF wallet to the pinned initializer and pay that wallet’s share to it. Identical creator/treasury/protocol recipient addresses are merged without changing the total allocation. The connected NFT owner pays gas. Claims do not increment Brain or consume the launch cooldown. Doppler permits a beneficiary to transfer its own fee rights externally; the RarePet UI does not provide that action, and the initial allocation is not a promise of permanently nontransferable fee rights.

Images accept PNG/JPG/WebP up to 5 MB, are decoded and center-cropped locally into a 512px PNG, and are uploaded after an owner signature tied to the exact image hash, creator, launch mode, optional NFT identity and expiry. The API checks the signer and, in RF mode, live ownership and stores bytes at a content-hash path with overwrites disabled. Token JSON is a bounded onchain `data:application/json;base64,...` URI containing the public image URL and SHA-256 hash. The metadata survives independently of the app; the referenced image still depends on Vercel Blob availability. `BLOB_READ_WRITE_TOKEN` is a server-only credential and must never enter the browser bundle. Without configured storage, publishing an image fails explicitly. Immutable reservations limit each creator to five new images per UTC day and all creators together to 100 new images per UTC day (at most 100 MiB of image bytes). Concurrent requests and failed-upload retries cannot exceed those caps; existing images can still be reused.

Live launch activation is separate from live care. Production and preview builds use `RAREPET_LAUNCHPAD_ADDRESS=0x8c46baA63079B8648b1cd5689058E0AAB33DF063`. The frontend rechecks module addresses, supply, fee shares, quote allowance, NFT ownership and cooldown before asking for a transaction. Confirmations require an exact router event, expected token/pool and verified receipt block. Preview cannot publish, receive Brain or claim real fees. See [the launch contract handoff](contracts/rare-launchpad/README.md) for the unsigned deployment script and successful read-only full-route state-override verification. The standard Forge fork remains limited by public RPC access. The user signed the router deployment. Activation checks use public reads and simulations; they do not launch a token.

## Artwork and reuse

Rare Friends artwork and FriendSDK are credited in the app and distributed `credits.txt`. Generations preview art and body frames use the cached public registry art from Rare Rush, with original provenance. Genesis preview portraits are verified original tokenURI SVGs cached at mainnet block 72489062 in `games/rare-pet/preview-genesis.json`; owned Genesis portraits are freshly validated. The body catalog and provenance are documented in `games/rare-rush/genesis/BODIES.md`. Fonts are the existing licensed Silkscreen, Archivo, and Sometype Mono assets. The Worlds collection uses the six official FriendSDK complete world presets also used in Rare Rush, preserving their original SVG artwork, palette and proportions. Classic restores the five earlier custom main floors. All 11 designs share the same layout and responsive Friend/island proportions in the main showcase and background. Former Floating selections map to the matching Classic palette. Classic islands and action effects are decorative interface artwork, not replacement Rare Friends characters.

Rare Rush integration uses optional `beforeRun`, `onRunComplete`, and `previewSprites` props, plus `bodyId` and `onRunComplete` on GenesisRush. The direction engine, renderer, fixed-step input recorder and economy are included with their unit tests; upstream provenance and update notes are in `games/rare-rush/UPSTREAM.md`. RarePet explicitly disables the public replay-saving UI because it has no signed replay publication host. The retained analytics bridge is inactive outside the Rare Rush host. This repository does not contain the separate Rare Rush website, testnet services, launchpad, analytics service, or deployment infrastructure.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [SDK notices](licenses/FRIENDSDK-NOTICE.md), [SDK license](licenses/friendsdk-APACHE-2.0.txt), and the retained [font provenance](games/rare-rush/assets/fonts/provenance.md). Source availability is not a grant of rights to Rare Friends branding; the SDK artwork permissions are stated in its notices.

### Verified deployment and activation

The router is deployed at [0x8c46baA63079B8648b1cd5689058E0AAB33DF063](https://robinhoodchain.blockscout.com/address/0x8c46baA63079B8648b1cd5689058E0AAB33DF063) on Robinhood Chain (4663), created by the confirmed treasury wallet in [transaction 0x0cd33c88…a2dd57f](https://robinhoodchain.blockscout.com/tx/0x0cd33c88b3f34a17299d19c47a2a96f4682420397543fbb856ddb349ba2dd57f), block **72744001**. Its runtime exactly matches the reviewed constructor-produced bytecode. The complete 196-token allowlist, treasury, 85/10/5 split, one-billion supply and enabled Doppler modules were verified directly onchain.

Actual adapter preparation also passed against the deployed contract in both modes: the canonical Genesis #2 wallet route and the treasury’s direct self route. These checks used no state overrides, image uploads, signatures or transaction submissions. The launch counters and Brain remained unchanged. Run `node scripts/verify-launch-activation.ts 0x8c46baA63079B8648b1cd5689058E0AAB33DF063` for the same read-only activation check; it permits only documented public RPC reads and simulations.

Vercel Production and Preview configure the verified public address through `RAREPET_LAUNCHPAD_ADDRESS`. Image publication uses the existing server-only Blob credential. Anonymous visitors can still preview; connected creators review and sign their own image authorization, launch and fee-claim transactions. The local deployment helper is retained as review tooling, excluded from Vercel uploads, and stopped after the completed deployment.
