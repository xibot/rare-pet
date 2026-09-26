# RarePet permanent care ledger

**Built for review; not deployed or independently audited.** `RarePetCare` adds configurable care rules and permanent NFT-bound records. No deployment, care action or admin transaction has been sent by this build. The earlier fixed-rule `RarePet.sol` prototype remains for reference and regression tests; the client targets the new `RarePetCare` ABI only.

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
| Play | +10 Experience per valid completion receipt | 0h between receipts | 3 |
| Poop | +1 Health | 4h | 6 |
| Launch — separate deployed router | +1 Brain | 24h | 1; locked in |

Pet’s 24-hour cooldown and limit of one per rolling 24 hours are enforced as constants of the rule validation and cannot be changed by an administrator. The Feed/Poop caps reflect the existing once-every-four-hours rule. UTC midnight does not reset usage. Each accepted action occupies its own rolling 24-hour slot. Changing rules does not clear recent action history. A lower cap waits for enough prior actions to expire; a higher cap grants only additional slots, subject to the existing cooldown.

Each successful action saves its next unlock using the rules applied to that action. A later cooldown change affects the next accepted action, preserving an already-running timer. Pet saves its own grace, decay interval and decay points, so a later edit cannot shorten an existing bond deadline. A pending Rarity milestone keeps its saved target and award; subsequent milestones use new settings.

Initially, the first Pet starts streak 1. Pet unlocks after 24h and has another 24h of grace. The exact 48h deadline is still on time. One second later, current streak and Rarity reset and one current Kinship is lost; each further overdue 24h loses another, down to zero. Every seven uninterrupted Pets awards one Rarity. Lifetime earned points remain intact.

## Community adjustments and authority

The constructor accepts a nonzero initial admin. The supplied example uses the existing RarePet treasury `0xCa88efc94b567A5185FEA63599aD895c3e514FBc`; review this authority before deployment. It can propose the complete rule set: action points, Feed's secondary Stamina points, Feed/Play/Poop cooldowns and rolling daily caps, enabled flags, Pet grace/decay, future Rarity milestones and the Play receipt signer.

A proposal waits **24 hours** onchain before anyone can execute the exact stored version. Proposals can be cancelled. Admin transfer also requires nomination, a 24-hour delay and acceptance by the nominee. Acceptance clears any unexecuted rule proposal. The delay is fixed and cannot be reduced.

Config bounds limit daily caps to 32 actions and points to 1,000,000 per award. Cooldowns and grace are bounded to 30 days. Invalid combinations revert onchain. Administrators can influence future earning rates or disable actions, but cannot award an arbitrary NFT points or edit its previous records. Disabling Pet may prevent continuing a live streak even though the saved bond deadline itself is unchanged; the permanent earned record is preserved. Review these effects during the public delay. Public logs expose rule proposals, cancellations, activations and authority changes.

Launch is intentionally excluded from these editable rules. Pet is also fixed at one action every 24 hours. The already deployed Doppler V1 router keeps **+1 Brain and its 24-hour cooldown locked in**, as confirmed by the product owner. It remains the authoritative Brain ledger; no care transaction duplicates or imports its rewards.

## Play receipts

Live Play rewards remain disabled until a genuine run-completion service is connected. Use the zero address as the initial signer. A later reviewed signer can be activated through the rule delay, without redeploying the ledger.

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

An unsigned deployment review can be generated with the example copied to an explicitly reviewed configuration:

```sh
node contracts/rare-pet/script/prepare-deployment.mjs \
  contracts/rare-pet/deployment-config.example.json \
  artifacts/rarepet-care-deployment-review.json
```

The tool checks chain/collection code, current deployer nonce, exact source/compiler settings, constructor execution and gas. It writes the expected runtime hash and unsigned zero-value transaction, never loads a key or broadcasts, and refuses to overwrite a review. Do not infer deployment approval from an example configuration. After wallet deployment, verify the receipt/runtime/admin/rules and explorer source before configuring `RAREPET_CONTRACT_ADDRESS`.

The rule helper creates a reviewable, simulated, unsigned admin transaction:

```sh
node contracts/rare-pet/script/prepare-rule-change.mjs \
  <deployed-care-address> <admin-address> schedule \
  artifacts/rarepet-care-rule-review.json contracts/rare-pet/rules.example.json
```

Other modes are `cancel`, `execute`, `nominate-admin`, `cancel-admin` and `accept-admin`. Execution is a separate transaction after the onchain delay; the script cannot bypass it. Review all four action rules together, including the signer and Rarity/decay fields, before signing a proposal.
