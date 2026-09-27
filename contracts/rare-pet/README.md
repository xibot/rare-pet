# RarePet permanent care ledger

**Deployed on Robinhood Chain; receipt, runtime, authority and initial rules checked. Not independently audited.** `RarePetCare` is deployed at [`0x0082229d9592292E2542cb29a6b94d9a2F22d124`](https://robinhoodchain.blockscout.com/address/0x0082229d9592292E2542cb29a6b94d9a2F22d124) in [transaction `0x7d2eb582…e65827b`](https://robinhoodchain.blockscout.com/tx/0x7d2eb582a54416b32cdfcac287b2b439f18b83ac7759e728f4329f232e65827b), block **73495965**. The user signed from the approved treasury wallet. The [deployment manifest](deployments/4663.json) records exact creation/runtime and configuration checks at block **73497474**; verification did not send care or admin transactions.

Pet, Feed and Poop use the deployed ledger. Play XP is disabled with a zero completion signer. The earlier fixed-rule `RarePet.sol` prototype remains for reference and regression tests; the client targets the new `RarePetCare` ABI only. [Blockscout source verification](https://robinhoodchain.blockscout.com/address/0x0082229d9592292E2542cb29a6b94d9a2F22d124?tab=contract) is confirmed as **verified (exact match)**, with source, ABI and constructor arguments public. The explorer badge and deployment checks do not constitute an independent security audit.

Care belongs to `(collection, tokenId)` on Robinhood Chain **4663**. Every write checks the current NFT owner. Records, points, cooldowns and daily usage follow the NFT when it transfers. The only collections are Genesis `0x116EaA62241751E0c98dA43d458600c6C17cD361` and Generations `0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D`.

## What stays permanent

The contract has immutable code and storage ownership. It has no proxy, delegatecall, generic executor, arbitrary writer, import, reset, point setter, withdrawal or upgrade function. It does not hold tokens, change original NFT metadata or take custody of NFTs. The owner pays transaction gas.

- **Lifetime earned traits:** Kinship, Strength, Stamina, Health, Experience and Rarity only accumulate through accepted actions.
- **Lifetime action counts:** Pet, Feed, Play and Poop counts never reset. Best streak never decreases.
- **Action receipts:** Each NFT has a sequential, append-only record containing its owner, action, timestamp, rule version and exact awarded points, secondary points and Rarity points.
- **Rule history:** Activated rules remain available by version. Every receipt identifies the version applied; future point changes do not reprice past rewards.

Current Kinship, streak and streak-based Rarity remain separate live care state. Missing the Pet grace window can reduce those live values without deleting lifetime achievements. Projected decay is persisted on the next accepted action and cannot be charged twice. Future gamification can read permanent totals and action records directly, or index their public events. This contract does not distribute prizes or promise future rewards.

Changing **rules** is supported. Replacing arbitrary Solidity code is deliberately outside this contract's authority: an unrestricted implementation upgrade could defeat the guarantee that history cannot be rewritten. A future game can read this same permanent ledger without migrating or resetting it.

## Initial action rules

| Action | Initial reward | Cooldown | Maximum accepted actions per rolling 24h |
| --- | --- | --- | --- |
| Pet | +1 Kinship (reward adjustable) | 24h; locked in | 1; locked in |
| Feed | +1 Strength, +5 Stamina | 4h | 6 |
| Play — disabled until receipt integration | +10 Experience per valid completion receipt | 0h between receipts | 3 |
| Poop | +1 Health | 4h | 6 |
| Launch — separate deployed router | +1 Brain | 24h | 1; locked in |

Pet’s 24-hour cooldown and limit of one per rolling 24 hours are enforced as constants of the rule validation and cannot be changed by an administrator. The Feed/Poop caps reflect the existing once-every-four-hours rule. UTC midnight does not reset usage. Each accepted action occupies its own rolling 24-hour slot. Changing rules does not clear recent action history. A lower cap waits for enough prior actions to expire; a higher cap grants only additional slots, subject to the existing cooldown.

Each successful action saves its next unlock using the rules applied to that action. A later cooldown change affects the next accepted action, preserving an already-running timer. Pet saves its own grace, decay interval and decay points, so a later edit cannot shorten an existing bond deadline. A pending Rarity milestone keeps its saved target and award; subsequent milestones use new settings.

Initially, the first Pet starts streak 1. Pet unlocks after 24h and has another 24h of grace. The exact 48h deadline is still on time. One second later, current streak and Rarity reset and one current Kinship is lost; each further overdue 24h loses another, down to zero. Every seven uninterrupted Pets awards one Rarity. Lifetime earned points remain intact.

## Community adjustments and authority

The deployed initial admin is the approved RarePet treasury `0xCa88efc94b567A5185FEA63599aD895c3e514FBc`. It can propose the complete rule set: action points, Feed's secondary Stamina points, Feed/Play/Poop cooldowns and rolling daily caps, enabled flags, Pet grace/decay, future Rarity milestones and the Play receipt signer.

A proposal waits **24 hours** onchain before anyone can execute the exact stored version. Proposals can be cancelled. Admin transfer also requires nomination, a 24-hour delay and acceptance by the nominee. Acceptance clears any unexecuted rule proposal. The delay is fixed and cannot be reduced.

Config bounds limit daily caps to 32 actions and points to 1,000,000 per award. Cooldowns and grace are bounded to 30 days. Invalid combinations revert onchain. Administrators can influence future earning rates or disable actions, but cannot award an arbitrary NFT points or edit its previous records. Disabling Pet may prevent continuing a live streak even though the saved bond deadline itself is unchanged; the permanent earned record is preserved. Review these effects during the public delay. Public logs expose rule proposals, cancellations, activations and authority changes.

Launch is intentionally excluded from these editable rules. Pet is also fixed at one action every 24 hours. The already deployed Doppler V1 router keeps **+1 Brain and its 24-hour cooldown locked in**, as confirmed by the product owner. It remains the authoritative Brain ledger; no care transaction duplicates or imports its rewards.

## Play receipts

Live Play rewards remain disabled. The deployed initial signer is the zero address. Activation requires a genuine run-completion service, the client receipt/claim flow and a reviewed signer activated through the 24-hour rule delay. The ledger does not need to be redeployed. A signer setting alone does not implement the missing service or client integration.

The signature binds the current owner, collection, token ID, unique run ID, deadline, chain, contract and active rule version. Changing rules invalidates outstanding receipts from earlier versions. Used run IDs remain consumed across policy changes and ownership transfers. The trusted signer can attest fabricated runs if compromised, but cannot bypass owner authorization, global run replay protection or per-NFT action limits.

See [PLAY_VERIFIER.md](PLAY_VERIFIER.md) for the implementation boundary, reusable engine code and service acceptance requirements. A browser `onRunComplete` callback is never accepted as onchain evidence.

## Build, inspect and review

Requires Foundry and Solidity `0.8.30+commit.73712a01`, optimizer 200, via-IR, Cancun and IPFS metadata hashing. There are no Solidity library dependencies. The compiled ABI is `RarePetCare.abi.json`.

```sh
forge test --root contracts/rare-pet -vv
node --test contracts/rare-pet/test/deployment-policy.test.mjs
npm run typecheck
npm run test:pet
```

Read methods include `currentRuleVersion`, `currentRules`, `rules(version)`, `pendingRules`, `getPet`, `getPetSchedule`, `actionAvailability`, `getLifetime`, `actionCount` and `actionRecord`. The client uses `pet`, `feed` and `poop` with `(collection, tokenId, expectedVersion)`, pinning the rule version reviewed before signing. These overloads revert if another rule version activates before execution. The two-argument `(collection, tokenId)` overloads remain available and deliberately use whichever rules are active when executed. `play` additionally needs its signed receipt, which binds the active rule version. `CaredFor` preserves the action event used by wallet receipt checks; detailed records carry the immutable award history.

The completed mainnet deployment uses `deployment-review-mainnet-v1.json`. Preserve that review and the deployment manifest; do not sign a duplicate creation. To reproduce an unsigned review for a separately reviewed future deployment, use a new output path:

```sh
node contracts/rare-pet/script/prepare-deployment.mjs \
  contracts/rare-pet/deployment-config.example.json \
  artifacts/rarepet-care-deployment-review.json
```

The tool checks chain/collection code, current deployer nonce, exact source/compiler settings, constructor execution and gas. It writes the expected runtime hash and unsigned zero-value transaction, never loads a key or broadcasts, and refuses to overwrite a review. Do not infer deployment approval from an example configuration. For any future deployment, verify the receipt/runtime/admin/rules and explorer source before changing `RAREPET_CONTRACT_ADDRESS`. The active care address is `0x0082229d9592292E2542cb29a6b94d9a2F22d124`.

The rule helper creates a reviewable, simulated, unsigned admin transaction:

```sh
node contracts/rare-pet/script/prepare-rule-change.mjs \
  <deployed-care-address> <admin-address> schedule \
  artifacts/rarepet-care-rule-review.json contracts/rare-pet/rules.example.json
```

Other modes are `cancel`, `execute`, `nominate-admin`, `cancel-admin` and `accept-admin`. Execution is a separate transaction after the onchain delay; the script cannot bypass it. Review all four action rules together, including the signer and Rarity/decay fields, before signing a proposal.
