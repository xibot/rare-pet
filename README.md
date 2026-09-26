# RarePet

**Your Rare Friend, every day.**

[Meet Your Pet](https://rarepet.app) · [Rare Launchpad](https://rarepet.app/launch/) · [Care Guide](https://rarepet.app/docs/) · [Rare Rush](https://rarerush.app) · [Vibeathon Entry](https://github.com/spokesz/rarefriends-vibeathon/pull/76)

Every Rare Friend is a Rare Pet. Give your Genesis or Generations Friend a little love, a good meal, a game together, and a floating home of their own.

RarePet is a Tamagotchi-inspired app built for the Rare Friends ecosystem. Come back for the daily routine, watch your Friend react, and capture a moment for the timeline. Their Rare Wallet gives them a place to hold assets, launch tokens, and collect creator trading fees.

Created by **XIBOT** for the [Rare Friends Vibeathon](https://github.com/spokesz/rarefriends-vibeathon).

## Two ways to meet your pet

| | Preview | My Wallet |
| --- | --- | --- |
| **Your Friend** | Three Genesis and three Generations samples | Your owned Genesis or Generations NFT |
| **Getting started** | Open the app; no wallet needed | Connect a browser wallet on Robinhood Chain |
| **Care progress** | Saved on this device, separately for each sample | Onchain care is coming after Vibeathon testing |
| **Wallet features** | Explore the interface | Manage eligible Friends' wallets and launch tokens |
| **Transactions** | None | Wallet sends, launches and fee claims require confirmation and gas |

**Preview** is the Vibeathon care demo. Choose a Friend, try the actions, change islands, and play Rare Rush. Care points and game rewards are simulated. Reset Preview clears only the selected sample's care.

**My Wallet** verifies real ownership and preserves your Friend's original artwork. Rare Wallet and owned Rare Rush play support Genesis and hardwired Generations. Wallet features use Robinhood Chain, chain `4663`; connecting a wallet does not convert Preview progress into onchain records. On mobile, use a supported wallet's built-in browser. WalletConnect is not included.

## A little care. Every day.

Each action has its own countdown. In Preview, keeping a routine grows your Friend's RarePet traits:

| Action | When | What grows |
| --- | --- | --- |
| **Pet** | Once every 24 hours | +1 Kinship and the care streak |
| **Feed** | Once every 4 hours | +1 Strength and +5 Stamina |
| **Play** | 3 rewarded completed runs per rolling 24 hours | +10 Experience per completion |
| **Poop** | Once every 4 hours | +1 Health |
| **Keep the streak** | Every 7 consecutive care cycles | +1 RarePet Rarity |

Pet unlocks 24 hours after the last pet, followed by a **24-hour grace window** to keep the bond. Miss that window and the streak and its RarePet Rarity reset, while Kinship decreases. Each rewarded Play slot returns 24 hours after its completion. Closing an unfinished run does not earn XP.

RarePet traits are separate from the NFT's original traits and collection rarity. Stamina currently accumulates; it is not an entry cost for Play. See the [care guide](https://rarepet.app/docs/) for the full routine.

## Your Friend. Your world.

- **11 islands.** Six canonical Worlds and five Classic floors, including black-and-white Rare.
- **A floating neighborhood.** Matching background islands drift through space with visiting Friends, passing behind your pet's home.
- **36 Genesis bodies.** Give a Genesis portrait a new silhouette while keeping its original character artwork intact.
- **A little personality.** Different care reactions, snacks, hearts and speech bubbles bring the daily routine to life. Reduced-motion preferences are supported.

Your island, Genesis body and last Preview Friend are remembered on this device. These choices are cosmetic.

## Playtime means Rare Rush

Open **Play** and take the same Friend into [Rare Rush](https://rarerush.app). Run, climb, fall and occasionally reverse through connected courses, with spinning Friends, flying bonus coins, shields and magnets along the way.

Choose Easy, Normal or Degen. Space / ↑ / W jumps; press again to double jump. Hold ↓ / S to slide. Use ← / → to adjust pace on horizontal tracks and steer in vertical sections. Touch controls, pause and sound controls are built in.

The embedded game uses Rare Rush's actual engine. Its displayed RF/$RUSH economy is simulated, and RarePet's Preview XP is awarded only when a run completes. Playing with an owned Friend does not yet award onchain XP.

## Share a rare moment

Pick **Pet**, **Feed** or **Poop** and capture your Friend with their chosen island, body and speech bubble. Download a **2000 × 2000 PNG** or an **800 × 800 animated GIF** with a 2.4-second loop.

The share dialog prepares your post and offers **Download + Share on X**. Attach the downloaded file and publish when you're ready. Images and GIFs are rendered locally in your browser; exporting a moment does not change care progress.

## Rare Wallet

Your pet has pockets. Open **Rare Wallet** to see your Friend's canonical wallet address, ETH, tokens and NFTs. Copy its address, review a token or NFT send, and manage assets held by the Friend.

Sends come **from the Rare Friend's wallet**. The connected owner authorizes the action and pays gas. Holdings are checked onchain, and manual asset lookup is available when public history is incomplete.

The wallet also lists **Tokens Launched**, with full copyable contract addresses. Check accrued trading fees and claim the creator's share into that same Rare Wallet.

## Launch a rare idea

[Rare Launchpad](https://rarepet.app/launch/), powered by **Doppler**, lets you **Launch as Yourself** or **Launch as Your Rare Friend**.

Set the token's name, ticker and image. Pair it with **WETH** or a supported Robinhood stock/ETF token, then choose a **0.3%, 1% or 2%** trading fee. The current catalog includes 195 stock/ETF tokens, with individual ticker/name search and price checks before launch.

The launch preset assigns the full supply of **1 billion tokens to liquidity**, with no creator token allocation. A Friend can launch once every rolling 24 hours; a confirmed RF launch adds one Brain in the separate launch ledger. Self launches need no NFT, have no daily limit and do not change a Friend's Brain.

| Trading-fee share | Recipient |
| --- | --- |
| **85%** | Creator wallet: yours or your Rare Friend's |
| **10%** | RarePet treasury, intended to fund future prizes |
| **5%** | Doppler |

These are the initial shares of collected trading fees. Fees accrue when swaps happen; they are not guaranteed earnings. Launches and fee claims are live on Robinhood Chain and require wallet confirmation. The [deployed router and verification record](contracts/rare-launchpad/README.md) document the configuration and checks; the contracts have not been audited.

## What comes next

**Fully onchain care traits are planned after the Vibeathon test stage.** The care contract is implemented and locally tested, but not deployed. Live Experience also needs the verified game-completion service.

After the mainnet care rollout comes the planned **rarity farming season**: the rarer your Friend becomes through daily care, the bigger their prize rewards. The season, eligibility and prize distribution are still to come. Preview points have no onchain value, and a progress carryover is not promised.

Rare Wallet and the separate launch router are already live; their availability is independent of the care rollout.

## Run locally

Use **Node.js 22.18+ within the 22.x release line** and npm.

```sh
git clone https://github.com/xibot/rare-pet.git
cd rare-pet
npm ci
npm run dev
```

Open [localhost:4175](http://localhost:4175). The Preview demo and build need no credentials. Owned-wallet features require a compatible wallet and the documented network/configuration.

```sh
npm run typecheck
npm run typecheck:server
npm test
npm run build
```

The production build is written to `dist-pet/`, including `/docs/` and `/launch/`. FriendSDK v0.1.2 is bundled for reproducible installation. See the [developer guide](docs/DEVELOPMENT.md) for browser checks, live configuration, contract tests and deployment details.

## Explore the code

RarePet uses **TypeScript, React, SVG rendering, FriendSDK and viem**. Solidity contracts support the care ledger and Doppler launch router; server routes handle launch images and quote pricing.

| Path | Purpose |
| --- | --- |
| [`games/rare-pet/`](games/rare-pet/) | Habitat, care model, sharing, Rare Wallet, launchpad and guide |
| [`games/rare-rush/`](games/rare-rush/) | Embedded game engine, canonical artwork, bodies and fonts |
| [`contracts/rare-pet/`](contracts/rare-pet/) | Care ledger and completion-signature rules; awaiting deployment |
| [`contracts/rare-launchpad/`](contracts/rare-launchpad/) | Deployed launch router, tests and verification records |
| [`api/`](api/) | Launch-image publication and quote pricing |
| [`tests/`](tests/) | Care, gameplay, identity, launch and wallet checks |
| [`scripts/`](scripts/) | Build tools, browser checks and read-only activation verification |
| [`docs/`](docs/) | Developer setup and implementation notes |

This is the standalone RarePet repository. The retained Rare Rush code supplies the embedded game; the separate Rare Rush website, Testnet services and community infrastructure live in [xibot/rare-rush](https://github.com/xibot/rare-rush).

## Documentation

- [RarePet care guide](https://rarepet.app/docs/) — modes, actions, traits, timers and streaks.
- [Developer guide](docs/DEVELOPMENT.md) — setup, configuration, checks and implementation details.
- [Care contract](contracts/rare-pet/README.md) — future onchain care and the XP trust model.
- [Launch router](contracts/rare-launchpad/README.md) — launch policy, fee split and verification limits.
- [Launch deployment](contracts/rare-launchpad/deployments/4663.json) — current Robinhood contract and configuration.
- [Genesis bodies](games/rare-rush/genesis/BODIES.md) — canonical body artwork and provenance.
- [Rare Rush integration](games/rare-rush/UPSTREAM.md) — retained game code and update notes.
- [Vibeathon submission](https://github.com/spokesz/rarefriends-vibeathon/pull/76) — RarePet's separate entry, submitted September 25, 2026.

## Feedback welcome

Found a bug, a strange reaction, or an idea for your Friend's next adventure? [Open an issue](https://github.com/xibot/rare-pet/issues) or reach out to [XIBOT on X](https://x.com/xavieriturralde).

For playtest reports, include Preview or My Wallet, your collection, device/browser, and what happened. A screenshot or short recording helps.

## Credits

App design and development by **XIBOT**, building on the **Rare Friends** ecosystem. Rare Friends retains ownership of its character artwork.

Canonical Friends, body frames and Worlds artwork come from Rare Friends/FriendSDK. Rare Rush supplies the embedded game; Doppler supplies the launch modules and SDK. Credits and permissions are documented in [third-party notices](THIRD_PARTY_NOTICES.md), [FriendSDK notices](licenses/FRIENDSDK-NOTICE.md) and [font provenance](games/rare-rush/assets/fonts/provenance.md).

**Take care. Play. Stay rare.**
