# Onchain reads and unsigned care plans

## Deployment anchors

The current tracked sources are:

- [Care deployment manifest](https://github.com/xibot/rare-pet/blob/main/contracts/rare-pet/deployments/4663.json)
- [Current V1 launch deployment manifest](https://github.com/xibot/rare-pet/blob/main/contracts/rare-launchpad/deployments/4663-0xc6a4b2d4d369747b26e4ff805a79a57da2505dc3.json)
- [Care contract source](https://github.com/xibot/rare-pet/blob/main/contracts/rare-pet/src/RarePetCare.sol)

| Item | Value |
| --- | --- |
| Chain | Robinhood Chain mainnet, chain ID 4663 (`0x1237`) |
| Native gas | ETH |
| Care | `0x0082229d9592292E2542cb29a6b94d9a2F22d124` |
| Genesis | `0x116EaA62241751E0c98dA43d458600c6C17cD361` |
| Generations | `0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D` |
| Current launch router | `0xc6a4b2D4D369747B26e4Ff805a79A57da2505dC3` |
| Archived launch history | `0x8c46baA63079B8648b1cd5689058E0AAB33DF063` |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` |

Addresses and method selectors are packaged in [protocol.json](protocol.json); the exact care subset ABI is in [care-abi.json](care-abi.json). The app’s `/api/rpc` is an origin-restricted browser relay, not a public third-party agent API. Use the public RPC or a private RPC configured locally in `RAREPET_RPC_URL`; never copy the app’s server secrets.

The helper pins the care and launch runtime SHA-256 hashes. These were derived from compiler output and matched to the deployment manifests’ exact Keccak-256 runtime hashes before packaging. It verifies live `eth_getCode`, chain ID and care collection constants. Pinning does not establish a new deployment is safe; mismatch requires a reviewed update.

## Helper commands

Run from the extracted skill directory with Node.js 22+:

```sh
node scripts/rarepet.mjs --help
node scripts/rarepet.mjs status --collection genesis --token-id 2
node scripts/rarepet.mjs status --collection generations --token-id 68356
```

Optional `--owner 0xPUBLIC_ADDRESS` asserts current ownership. Without it, public status is available for any valid Friend. Owner and canonical Rare Wallet are separate addresses. A generation-0 Generations Friend returns `walletAddress: null`.

Read results include:

- One shared block number, hash and timestamp; all contract reads use that block.
- Canonical collection/token identity and owner.
- Live current traits, lifetime earned totals, per-action counts and the last eight immutable action records.
- Active rule version, reward parameters, authoritative remaining slots and readiness times, plus saved Pet bond schedule.
- Current-router Brain (matching the app), a separate total across current and archived V1 routers, per-router records, and the **current router’s** next launch time. The care contract’s legacy Brain fields are not used.

The helper rechecks the snapshot block’s hash before returning. It performs no writes, uses no state overrides and has no signing integration. Its network allowlist is only `eth_chainId`, `eth_getBlockByNumber`, `eth_getCode` and `eth_call`.

To prepare care, supply the canonical public NFT owner:

```sh
node scripts/rarepet.mjs plan --collection generations --token-id 68356 --action feed --owner 0xYOUR_PUBLIC_OWNER_ADDRESS
```

A plan uses `pet(address,uint256,uint256)`, `feed(address,uint256,uint256)` or `poop(address,uint256,uint256)`. The last parameter is the reviewed `expectedRuleVersion`; it prevents silently accepting newly activated rules. The helper refuses wrong owners, paused/cooling-down actions, runtime mismatches and failed simulations. It prints the exact `from`, `to`, `chainId`, zero `value` and calldata; it deliberately does not select nonce, gas price, gas limit or a signing account.

Before using a plan, obtain appropriate user authorization, refresh ownership/chain/rules/availability and simulate again. A plan does not reserve a slot. Present the action, Friend, reward and gas before sending through an authorized wallet. Do not route care calls through the Friend’s wallet: care checks the NFT owner as `msg.sender`.

## Receipt verification and recovery

The helper does not submit transactions, poll a wallet or verify submitted receipts. If a wallet integration sends a care plan:

1. Preserve the returned hash and inspect it on the correct chain. Check the actual transaction recipient is the care address, sender is the reviewed owner, and calldata matches the reviewed action/Friend/version.
2. Require a successful receipt and a `CaredFor(address indexed collection,uint256 indexed tokenId,address indexed owner,uint8 action,uint256 timestamp)` event emitted by the care contract matching the Friend, owner and action. Action IDs are Pet `0`, Feed `1`, Play `2`, Poop `3`.
3. Confirm the receipt block is canonical, then reread care. An unrelated successful receipt or wallet signature is not an award.
4. If the transaction is pending, replaced or cannot be verified, report that status and inspect the original hash before retrying. A read failure after success means refresh the state, not submit again. A user rejection ends the attempted action.

The app performs receipt checks for its own action submissions. Use its refreshed dashboard and explorer links for app-led workflows; do not claim that this helper automatically recovers or broadcasts pending actions.

## Durable traits, mutable policy

Care is keyed by `(collection, tokenId)` and follows the NFT. Lifetime earned totals, action receipts and their original rule versions are append-only. Current Kinship, current streak and streak Rarity may decay; “immutable history” does not mean all displayed values only increase.

The deployed ledger has fixed code. An administrator can schedule permitted rule changes with a fixed 24-hour delay, but cannot rewrite earlier care records. Pet’s once-per-24-hour cooldown/limit is locked. Existing action cooldowns and Pet grace schedules retain the values saved when the action occurred. Read availability and saved schedules rather than recomputing them from the newest default rules.

Play XP needs a completion verifier and client integration; setting a signer alone would not provide that integration. Testnet game records or a browser completion callback do not authorize a mainnet XP claim. This package supports no Play writes, rule administration, deployment or launch calldata generation.
