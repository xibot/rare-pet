# RarePet launch router

**Deployed on Robinhood Chain; independently checked against the reviewed source and configuration, not audited.** The router is [`0x8c46baA63079B8648b1cd5689058E0AAB33DF063`](https://robinhoodchain.blockscout.com/address/0x8c46baA63079B8648b1cd5689058E0AAB33DF063). [Deployment transaction `0x0cd33c88…2dd57f`](https://robinhoodchain.blockscout.com/tx/0x0cd33c88b3f34a17299d19c47a2a96f4682420397543fbb856ddb349ba2dd57f) succeeded at block **72744001**, sent from the approved treasury/deployer wallet with the exact reviewed constructor calldata and zero ETH value. Actual network fee: **0.000422233692192 ETH**. The user signed deployment in their wallet; these verification tools sent no transactions.

The tracked [deployment manifest](deployments/4663.json) records the successful receipt and checks at block **72746303**: exact constructor-produced runtime hash, every non-immutable byte compared with the local compiler output, treasury, 85/10/5 fee split, one-billion-token supply, 24-hour RF cooldown, canonical collections, Doppler module bytecode/approvals, all 196 quote addresses in order and every `allowedQuote` flag. Explorer source publication is separate: the source is already [public on GitHub](https://github.com/xibot/rare-pet/blob/001d66d9cea98963dcb000a5d24f381016eee83f/contracts/rare-launchpad/src/RarePetLaunchRouter.sol), but Blockscout's source-verification API returned HTTP 403 with a Cloudflare challenge. No explorer verification badge is claimed. Exact standard JSON input and constructor arguments are prepared locally under `out/verification/` for a supported verification interface.

Before deployment, at block **72740950**, constructor `eth_call` produced the exact runtime with its configured immutables. Overriding only that prospective router runtime and its full 196-entry quote allowlist and array storage, both the real Genesis #2 owner → canonical RF `execute` → router → real Doppler modules route and the direct self route completed successfully. Self mode also verified the creator-equals-treasury fee merge. A third complete launch against ZS, the last stock in the catalog, succeeded. All existing RF and Doppler contracts used actual pinned mainnet state. No simulated state persisted. Local tests cover persisted Brain, cooldown and failure behavior.

The conventional Forge fork remains unavailable through this public RPC (older state was pruned and a fresh Forge request received HTTP 403). The state-override rehearsal uses ordinary supported `eth_call` requests and does not bypass that restriction. Evidence is generated in `state-override-review.json`; the unsigned deployment review binds its SHA-256, creation-bytecode hash, exact creation calldata hash (including every constructor quote), catalog SHA-256, quote count and deployer. A proof for the earlier five-token constructor is rejected even though the router bytecode is unchanged.

For Your Rare Friend mode, the owner calls the existing Rare Friend account’s `execute(router, 0, launchCalldata, 0)`. That canonical account authenticates the owner. The router verifies the account’s `(chain, collection, tokenId)` binding against the collection’s canonical `tokenBoundAccount`, and verifies current NFT/account ownership. Direct EOA calls to the RF route, fabricated accounts and unsupported collections cannot earn NFT Brain. Identity comes from the caller; the request cannot substitute a different Friend.

For Yourself mode, the connected creator calls `launchAsSelf` directly. This route requires no NFT and has no daily limit. Its count and `SelfLaunchRecorded` event are separate from NFT Brain and cooldowns. Calling the self route from an RF wallet still produces only a self record; it cannot bypass that NFT’s rewarded launch limit.

The router constructs all Doppler parameters internally and enforces:

- Robinhood mainnet 4663 and the pinned Genesis/Generations collections.
- For RF mode, one launch per NFT per rolling 24 hours, including after ownership changes. Token ID zero is valid if the canonical collection/account verifies it.
- For RF mode, one Brain point only after successful creation and verified asset supply, pool, canonical modules, burn destinations and beneficiaries. Reverts roll back Brain, cooldown and the launch itself.
- Fixed constructor supply, 100% assigned to the pool, zero vesting/creator allocations, no mint controller or balance restrictions, no custom hooks, and NoOp governance/migration. Canonical pool rounding dust goes to NoOp governance’s burn address.
- Only the constructor quote allowlist and 0.3%, 1% or 2% trading fees. Ticks must align to 200, curve weights total 1e18, at most eight curves/100 positions.
- An immutable initial fee policy and treasury. No administrator, withdrawal, setter or upgrade path exists in this contract.

The browser’s one-billion-token, approximately $10,000 initial FDV preset and current price checks are additional product constraints. The constructor can represent other supply values within its bounds, but the RarePet client and deployment handoff reject anything except `1e27`. Price curves themselves are owner supplied; this router does not authenticate an oracle price or guarantee market value.

## Configuration that must be reviewed

The user-confirmed treasury and deployer are both **`0xCa88efc94b567A5185FEA63599aD895c3e514FBc`**, saved in `deployment-config.json`. The example file remains an unfilled template. The public read at block 72738256 found no code and 0.04497917791746475 ETH at that address; these facts do not establish wallet ownership. The prospective nonce-zero router had no code at that pre-deployment observation; its subsequent confirmed deployment is recorded above. Wallet balance and network fees are checked again before signing. The user-confirmed policy is **85% creator / 10% treasury / 5% Doppler**, represented by `friendFeeBps: 8500`; no other split is accepted. The creator is the connected wallet in self mode and the canonical RF wallet in Friend mode. These percentages divide trading fees, not token supply. The protocol beneficiary is the current Airlock owner at launch time. Identical addresses are merged while preserving their combined shares, then sorted as required by Doppler. For example, a self creator who is also the treasury receives the combined 95%, with 5% allocated to Doppler.

Doppler’s own `FeesManager.updateBeneficiary()` allows each beneficiary to transfer its fee rights. The initial allocation is fixed by this router; fee rights are not permanently nontransferable. RarePet exposes claims through the RF wallet and does not expose reassignment. An owner can still instruct its general-purpose RF wallet to make that external Doppler call. Fee rights remain with the RF account across an NFT transfer unless deliberately reassigned.

The initial list is **WETH plus all 195 active Robinhood stock and ETF tokens**, 196 quote contracts total, including QNT. The authoritative shared snapshot is [`launch-quote-catalog.json`](../../games/rare-pet/launch-quote-catalog.json), generated from the official Robinhood issuer directory. The app and deployment handoff derive their exact address lists from that same file. Bankr's smaller quote subset is not used to omit issuer-listed stocks. All 196 contracts were checked for bytecode and 18 decimals at block 72738256; catalog generation separately verifies issuer identity and token symbols. The existing 256-entry constructor bound is sufficient and remains unchanged.

The allowlist cannot be expanded after deployment. Quote issuer activity, registry identity and oracle freshness are rechecked by the app; the onchain router checks only its immutable token list.

## ABI and metadata

`RarePetLaunchRouter.abi.json` is generated from Solidity 0.8.30 with the supplied Foundry settings. The core call is:

```solidity
launch(LaunchRequest request) returns (address asset) // canonical RF account only
launchAsSelf(LaunchRequest request) returns (address asset) // direct creator
selfLaunchCount(address creator) view returns (uint256)
// LaunchRequest = (string name, string symbol, string tokenURI, address quote,
//                  uint24 fee, Curve[] curves, int24 farTick, bytes32 salt)
// Curve = (int24 tickLower, int24 tickUpper, uint16 numPositions, uint256 shares)
```

Names allow 1–64 bytes without ASCII controls; tickers allow 1–12 uppercase ASCII letters/digits. The UI is stricter. `tokenURI` is bounded to 4096 bytes and allows a nonempty `ipfs://` or `data:application/json;base64,` payload. The router does not interpret JSON or certify image availability. The app uses onchain JSON with a public Vercel Blob image URL and SHA-256 hash. Content-hash storage paths disable overwrites; storage service continuity remains necessary for the referenced image.

The Airlock salt is derived from:

```solidity
keccak256(abi.encode(uint256(4663), address(router), address(friendWallet),
                    address(collection), uint256(tokenId), uint256(nextBrain), userSalt))
```

Self mode uses the same salt encoding with `creator` in place of `friendWallet`, zero collection/tokenId, and `nextSelfLaunchCount` instead of `nextBrain`. The SDK must use that derived salt, `account=router`, the constructor treasury as `integrator`, empty vesting arrays and the same canonical module configuration when predicting the asset. `LaunchRecorded` includes NFT identity, asset, Friend wallet, owner, quote, fee, metadata hash and timestamp. The separate launch ledger is authoritative for Brain; it does not modify the existing RarePet care contract’s reserved Brain fields.

## Checks and unsigned deployment handoff

From the repository root:

```sh
forge test --root contracts/rare-launchpad -vv
node --test contracts/rare-launchpad/test/deployment-config.test.mjs
# Uses a current pinned block; mutates only Forge's local EVM, never broadcasts:
node contracts/rare-launchpad/script/rehearse-fork.mjs /path/to/forge
# Alternative verified route: exact constructor runtime + real mainnet dependencies, read-only:
node contracts/rare-launchpad/script/rehearse-state-override.mjs
```

Set `RARE_LAUNCH_RPC` only when using an authorized RPC with mainnet fork access. The script pins a fresh block to avoid the public provider’s short historical-state retention. The fork test is skipped during ordinary offline unit runs. It uses a fixture treasury only in local EVM state; that address is not a suggested production treasury.

The local suite contains 28 tests, including 256-case fuzz tests for invalid curve weights and invalid creation receipts. It checks exact cooldown boundaries, timestamp zero, transferred NFTs, token ID zero, impersonation, metadata/quote/fee constraints, full-pool policy, the confirmed 85/10/5 policy and rejection of other splits, module revocation, failed/reentrant launches, NFT movement during callbacks duplicate assets, separate self-mode accounting, no self-to-RF reward bypass, cross-mode reentry and merged fee recipients. Four Node tests cover explicit deployment configuration, full catalog coverage, invalid catalogs, and rejection of old or mismatched constructor/catalog rehearsal proofs. Contract tests store and read all 196 quotes, launch against the final entry, reject unlisted quotes, and reject duplicate or oversized catalogs. These tests do not constitute an audit.

The confirmed public configuration is already saved. To reproduce its unsigned review (choose a new output filename when a review exists), run:

```sh
forge build --root contracts/rare-launchpad
node contracts/rare-launchpad/script/prepare-deployment.mjs contracts/rare-launchpad/deployment-config.json
```

This read-only script rejects missing/extra configuration fields, checks chain/module approvals/quote code and decimals at one block, checks that compiled bytecode matches the current source/settings, estimates contract-creation gas/current ETH cost, and writes an **unsigned** deployment payload plus a review manifest. The full-catalog creation estimate is 12,613,786 gas units; the reviewed price estimate was 0.000425917098076 ETH and must be refreshed by the signing wallet. It never loads a private key, signs or sends a transaction. The output refuses to overwrite an existing review. Mainnet preparation and its state-override rehearsal must be rerun if code, constructor configuration or catalog bytes change. `rehearse-state-override.mjs [review.json] [proof.json]` writes a new proof and attaches its binding to that unsigned review. The local signer refuses to start without a matching proof and checks the current local review again before wallet submission. It displays the quote count with a collapsible full list; previously loaded stale pages fail closed.

For any future replacement deployment: review the successful real-module state-override evidence, implementation and exact immutable configuration, fund the approved wallet with Robinhood ETH, sign deployment explicitly in that wallet, verify source/bytecode and all immutable getters/quote entries, then set `RAREPET_LAUNCHPAD_ADDRESS` at build time. The current deployment has completed the receipt, runtime and configuration checks above; explorer publication remains separately unconfirmed. Configure server-side image storage separately. No frontend timer, local storage flag or preview action substitutes for the router’s cooldown or Brain ledger.

The post-deployment checker is read-only and creates a new tracked manifest without overwriting an existing one:

```sh
node contracts/rare-launchpad/script/verify-deployment.mjs 0x0cd33c88b3f34a17299d19c47a2a96f4682420397543fbb856ddb349ba2dd57f
```

The local signing server was stopped after deployment to prevent stale pages from initiating another creation. Its fresh-review check therefore fails for previously loaded pages.

## Upstream references

The ABI adapters match Doppler commit [`bda077cf05c834f3bb5eb311f5b86376910d7912`](https://github.com/whetstoneresearch/doppler/tree/bda077cf05c834f3bb5eb311f5b86376910d7912), including Airlock, DopplerHookInitializer, DopplerERC20V1Factory, NoOp governance/migration and FeesManager. See the [Doppler deployment directory](https://docs.doppler.lol/reference/contract-addresses), [Robinhood contract list](https://docs.robinhood.com/chain/contracts/) and [Robinhood stock-token API documentation](https://docs.robinhood.com/chain/stock-token-apis/). Pinned module approval is rechecked at construction and every launch; no protection is claimed against defects or privileged upgrades in upstream contracts.
