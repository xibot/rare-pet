# RarePet

**Your Rare Friend, every day.**

[Meet Your Pet](https://rarepet.app) · [Care Guide](https://rarepet.app/docs/) · [Agent Skill](https://rarepet.app/agent/) · [Vibeathon Entry](https://github.com/spokesz/rarefriends-vibeathon/pull/76)

Every Rare Friend is a Rare Pet. Give your Genesis or Generations Friend a little love, a good meal, a game together, and a floating home of their own.

RarePet is a Tamagotchi-inspired app built for the Rare Friends ecosystem. Come back for the daily routine, watch your Friend react, and capture a moment for the timeline. Their Rare Wallet gives them a place to hold assets, launch tokens, and collect creator trading fees.

Created by **XIBOT** for the [Rare Friends Vibeathon](https://github.com/spokesz/rarefriends-vibeathon).

## Two ways to meet your pet

| | Preview | My Wallet |
| --- | --- | --- |
| **Your Friend** | Three Genesis and three Generations samples | Your owned Genesis or Generations NFT |
| **Getting started** | Open the app; no wallet needed | Connect a browser wallet on Robinhood Chain |
| **Care progress** | Saved on this device, separately for each sample | Onchain Pet, Feed and Poop, with permanent care history |
| **Wallet features** | Explore the interface | Manage eligible Friends' wallets and launch tokens |
| **Transactions** | None | Care actions, wallet sends, launches and fee claims require confirmation and gas |

**Preview** is the Vibeathon care demo. Choose a Friend, try the actions, change islands, and try the in-app arcade. Care points and game rewards are simulated. Reset Preview clears only the selected sample's care.

**My Wallet** verifies real ownership and preserves your Friend's original artwork. Rare Wallet and Play with owned Friends support Genesis and hardwired Generations. Wallet features use Robinhood Chain, chain `4663`; connecting a wallet does not convert Preview progress into onchain records. On mobile, use a supported wallet's built-in browser. WalletConnect is not included.

## A little care. Every day.

Each action has its own countdown. Pet, Feed and Poop record care on Robinhood Chain in My Wallet, or on this device in Preview. These are the starting rules:

| Action | When | What grows |
| --- | --- | --- |
| **Pet** | Once every 24 hours | +1 Kinship and the care streak |
| **Feed** | Once every 4 hours | +1 Strength and +5 Stamina |
| **Play — Preview only** | 3 rewarded completed runs per rolling 24 hours | +10 preview Experience per completion |
| **Poop** | Once every 4 hours | +1 Health |
| **Keep the streak** | Every 7 consecutive care cycles | +1 RarePet Rarity |

Pet unlocks 24 hours after the last pet, followed by a **24-hour grace window** to keep the bond. Miss that window and the streak and its RarePet Rarity reset, while Kinship decreases. Each rewarded Play slot returns 24 hours after its completion. Closing an unfinished run does not earn XP.

RarePet traits are separate from the NFT's original traits and collection rarity. Stamina currently accumulates; it is not an entry cost for Play. See the [care guide](https://rarepet.app/docs/) for the full routine.

Turn on **MUSIC** for a soft, original 8-bit habitat loop, or **FX** for care chimes, snack pops, playful bubbles and launch celebrations. Both start off and remember your choices on this device. Audio waits for a tap, pauses when the tab is hidden, and the habitat music steps aside during Play. Onchain care and launch celebrations sound only after confirmation.

## Your Friend. Your world.

- **11 islands.** Six canonical Worlds and five Classic floors, including black-and-white Rare.
- **A floating neighborhood.** Matching background islands drift through space with visiting Friends, passing behind your pet's home.
- **36 Genesis bodies.** Give a Genesis portrait a new silhouette while keeping its original character artwork intact.
- **A little personality.** Different care reactions, snacks, hearts and speech bubbles bring the daily routine to life. Reduced-motion preferences are supported.

Your island, Genesis body and last Preview Friend are remembered on this device. These choices are cosmetic.

## Play with your Friend

Open **Play** and take your selected Friend into RarePet's in-app arcade. Run, climb, fall and occasionally reverse through connected courses, with spinning Friends, flying bonus coins, shields and magnets along the way.

Choose Easy, Normal or Degen. Space / ↑ / W jumps; press again to double jump. Hold ↓ / S to slide. Use ← / → to adjust pace on horizontal tracks and steer in vertical sections. Touch controls, pause and sound controls are built in.

The arcade's displayed currency and rewards are simulated. RarePet's Preview XP is awarded only when a run completes. Playing with an owned Friend does not yet award onchain XP.

## Share a rare moment

Pick **Pet**, **Feed**, **Poop** or **Talk** and capture your Friend with their chosen island, body and speech bubble. **Talk** keeps the focus on your message, with no care-action effects or action label. Download a **2000 × 2000 PNG** or an **800 × 800 animated GIF** with a 2.4-second loop.

The share dialog prepares your post and offers **Download + Share on X**. Attach the downloaded file and publish when you're ready. Images and GIFs are rendered locally in your browser; exporting a moment does not change care progress.

## Rare Wallet

Your pet has pockets. Open **Rare Wallet** to see your Friend's canonical wallet address, ETH, tokens and NFTs. Copy its address, review a token or NFT send, and manage assets held by the Friend.

Sends come **from the Rare Friend's wallet**. The connected owner authorizes the action and pays gas. Holdings are checked onchain, and manual asset lookup is available when public history is incomplete.

The wallet also lists **Tokens Launched**, with full copyable contract addresses. Check accrued trading fees and claim the creator's share into that same Rare Wallet.

## Launch a rare idea

Open [RarePet](https://rarepet.app) and choose **LAUNCH** in **Daily Care**. Rare Launchpad, powered by **Doppler**, lets you **Launch as Yourself** or **Launch as Your Rare Friend**.

Set the token's name, ticker and image. Pair it with **WETH, $RAREFRIENDS, USDG, cbBTC** or a supported Robinhood stock/ETF token, then choose a **0.3%, 1% or 2%** trading fee. The live catalog includes 199 pairs: four crypto assets and all 195 supported stock/ETF tokens, with ticker/name search and price checks before launch. USDG uses 6 decimals and the CCIP-bridged cbBTC uses 8; pool pricing and fee amounts respect each token’s units.

The launch preset assigns the full supply of **1 billion tokens to liquidity**, with no creator token allocation. A Friend can launch once every rolling 24 hours; a confirmed RF launch adds one Brain in the separate launch ledger. Self launches need no NFT, have no daily limit and do not change a Friend's Brain.

| Trading-fee share | Recipient |
| --- | --- |
| **85%** | Creator wallet: yours or your Rare Friend's |
| **10%** | RarePet treasury, intended to fund future prizes |
| **5%** | Doppler |

These are the initial shares of collected trading fees. Fees accrue when swaps happen; they are not guaranteed earnings. Launches and fee claims are live on Robinhood Chain and require wallet confirmation. The [deployed router and verification record](contracts/rare-launchpad/README.md) document the configuration and checks; the contracts have not been audited.

## Buy / Sell

Open **Buy / Sell** below Rare Wallet to explore WETH, RAREFRIENDS, USDG, cbBTC, all 195 supported Robinhood stock/ETF tokens, and confirmed RarePet launches. **Find a Token** opens a searchable dropdown for the entire catalog. Browse compact horizontal cards in a scrollable four-column desktop grid, with category filters and a responsive mobile layout. You do not need to own a Rare Friend to browse or trade.

Buy and sell **inside RarePet**. The main market uses your connected wallet. Open **Buy / Sell inside Rare Wallet** to trade with that Friend’s assets: its wallet pays and receives the tokens, while you sign and pay gas as the NFT owner.

Ecosystem assets use available Uniswap V3/V4 routes; RarePet launches use their existing Doppler pools and actual launch pairs. Review the exact input, estimate, minimum received and slippage, approve the displayed amount when needed, then confirm the swap. Ecosystem pairs default to WETH, with USDG for WETH itself. ETH pays network gas. A catalog listing does not guarantee liquidity or a supported route.

Trading has **no trait effect or care cooldown** and preserves the launch’s existing fee split. RarePet adds no trading fee. Routing credentials stay on the server; swaps use the existing onchain routers without a new RarePet trading contract.

## Your Friend. Your agent.

The **[rarepet skill](https://rarepet.app/agent/)** helps an agent understand RarePet, read live care and prepare unsigned Pet, Feed and Poop transactions. Download the complete [skill ZIP](https://rarepet.app/skills/rarepet.zip), add the `rarepet` folder to your agent's skills directory, then invoke `$rarepet` with your collection and token ID. The bundled Node.js 22 helper has no dependencies and never signs or broadcasts.

The [AGENT page](https://rarepet.app/agent/) includes setup, example prompts and capability boundaries. Agents can start at [SKILL.md](https://rarepet.app/skills/rarepet/SKILL.md), [llms.txt](https://rarepet.app/llms.txt) or the [JSON manifest](https://rarepet.app/agent/manifest.json). The manifest provides contract identities and SHA-256 checksums for the downloadable resources.

Installing the skill grants no wallet access. The current NFT owner authorizes care; launches, trades, transfers and claims use the app's review and wallet flows. Scheduling depends on the user's agent platform and explicit instructions. Onchain Play XP is still coming later.

## Permanent care. Room to grow.

**Pet, Feed and Poop now have a deployed onchain care ledger.** [RarePetCare](contracts/rare-pet/README.md) preserves lifetime earned points, action counts, best streak and per-action receipts for each Friend, even when ownership changes. Current Kinship, streak and streak-based Rarity can still fall when care is missed; lifetime achievements remain recorded.

Future rewards and Feed/Play/Poop cooldowns and limits can be adjusted through a public **24-hour rule-change delay**. Past records cannot be edited or reset. Pet stays locked at one action per 24 hours, and Launch at +1 Brain per 24 hours. Live Experience remains disabled until the verified game-completion service and client claim flow are connected.

Next comes the planned **rarity farming season**: the rarer your Friend becomes through daily care, the bigger their prize rewards. The season, eligibility and prize distribution are still to come. Preview points have no onchain value, and a progress carryover is not promised.

Rare Wallet and the separate launch router remain independent of care. Care deployment and runtime checks are recorded in the [deployment manifest](contracts/rare-pet/deployments/4663.json); source verification and automated tests are not an independent security audit.

## Run locally

Use **Node.js 22.18+ within the 22.x release line** and npm.

```sh
git clone https://github.com/xibot/rare-pet.git
cd rare-pet
npm ci
npm run dev
```

Open [localhost:4175](http://localhost:4175). The Preview demo and build need no credentials. Owned-wallet features require a compatible wallet and the documented network/configuration.

Onchain reads use the server-only `RAREPET_RPC_URL` through `/api/rpc`. The existing `RAREPET_SNAPSHOT_RPC_URL` setting is also accepted; `npm run dev` loads the ignored `.env.holder-archive.local` file when present. Keep RPC credentials out of client code and set them as sensitive Vercel environment variables. See the [private RPC setup](docs/DEVELOPMENT.md#private-rpc) for deployment and local checks.

```sh
npm run typecheck
npm run typecheck:server
npm test
npm run build
```

The production build is written to `dist-pet/`, including the main app and `/docs/`. Launch is available through **LAUNCH** in **Daily Care**. FriendSDK v0.1.2 is bundled for reproducible installation. See the [developer guide](docs/DEVELOPMENT.md) for browser checks, live configuration, contract tests and deployment details.

## Explore the code

RarePet uses **TypeScript, React, SVG rendering, FriendSDK and viem**. Solidity contracts support the care ledger and Doppler launch router; server routes handle onchain reads, launch images, quote pricing and swap routing.

| Path | Purpose |
| --- | --- |
| [`games/rare-pet/`](games/rare-pet/) | Habitat, care model, sharing, Rare Wallet, launchpad and guide |
| [Embedded game](games/rare-rush/) | Game engine, canonical artwork, bodies and fonts |
| [`contracts/rare-pet/`](contracts/rare-pet/) | Deployed care ledger, permanent history and future completion-signature rules |
| [`contracts/rare-launchpad/`](contracts/rare-launchpad/) | Deployed launch router, tests and verification records |
| [`api/`](api/) | Private RPC relay, launch-image publication, quote pricing and swap routing |
| [`tests/`](tests/) | Care, gameplay, identity, launch and wallet checks |
| [`scripts/`](scripts/) | Build tools, browser checks and read-only activation verification |
| [`docs/`](docs/) | Developer setup and implementation notes |

## Documentation

- [RarePet care guide](https://rarepet.app/docs/) — modes, actions, traits, timers and streaks.
- [Developer guide](docs/DEVELOPMENT.md) — setup, configuration, checks and implementation details.
- [Care contract](contracts/rare-pet/README.md) — onchain care, permanent records and the XP trust model.
- [Care deployment](contracts/rare-pet/deployments/4663.json) — Robinhood care contract, authority and initial rules.
- [Launch router](contracts/rare-launchpad/README.md) — launch policy, fee split and verification limits.
- [Launch deployment](contracts/rare-launchpad/deployments/4663-0xc6a4b2d4d369747b26e4ff805a79a57da2505dc3.json) — current Robinhood contract and configuration.
- [Genesis bodies](games/rare-rush/genesis/BODIES.md) — canonical body artwork and provenance.
- [Embedded game notes](games/rare-rush/UPSTREAM.md) — game code and update notes.
- [Vibeathon submission](https://github.com/spokesz/rarefriends-vibeathon/pull/76) — RarePet's entry, submitted September 25, 2026.

## Feedback welcome

Found a bug, a strange reaction, or an idea for your Friend's next adventure? [Open an issue](https://github.com/xibot/rare-pet/issues) or reach out to [XIBOT on X](https://x.com/xavieriturralde).

For playtest reports, include Preview or My Wallet, your collection, device/browser, and what happened. A screenshot or short recording helps.

## Credits

App design and development by **XIBOT**, building on the **Rare Friends** ecosystem. Rare Friends retains ownership of its character artwork.

Canonical Friends, body frames and Worlds artwork come from Rare Friends/FriendSDK. Doppler supplies the launch modules and SDK. Credits and permissions are documented in [third-party notices](THIRD_PARTY_NOTICES.md), [FriendSDK notices](licenses/FRIENDSDK-NOTICE.md) and [font provenance](games/rare-rush/assets/fonts/provenance.md).

**Take care. Play. Stay rare.**
