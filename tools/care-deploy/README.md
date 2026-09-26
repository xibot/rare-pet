# RarePet Care mainnet wallet handoff

This local page prepares **one `RarePetCare` creation transaction** for the reviewed deployer. The user must connect and approve in their own wallet. The server cannot sign, broadcast, change application configuration or activate care.

The initial administrator and deployer are the existing RarePet treasury, `0xCa88efc94b567A5185FEA63599aD895c3e514FBc`. The page displays this authority for review before signing. Pet is fixed at once per 24 hours. Future configurable care rules require a 24-hour public delay. PLAY rewards start disabled; the existing Launch router remains separate.

```sh
node contracts/rare-pet/script/prepare-deployment.mjs \
  contracts/rare-pet/deployment-config.example.json \
  contracts/rare-pet/deployment-review-mainnet-v1.json
node tools/care-deploy/serve.mjs contracts/rare-pet/deployment-review-mainnet-v1.json --check
node tools/care-deploy/serve.mjs contracts/rare-pet/deployment-review-mainnet-v1.json
```

Open `http://localhost:4180` in the browser with the deployer's wallet extension. Connect, check the network fee, read the configuration and tick its confirmation, then approve deployment in the wallet. The unsigned review and exact standard JSON source/compiler input are downloadable. The contract has not been independently audited.

The server binds only to loopback, checks Host, accepts only GET/HEAD and serves no transaction endpoint. It refuses changed review/source/build files. The page verifies exact deployment data, current and pending nonce, predicted address, canonical collection code, chain/account, constructor runtime and available ETH before submission. A browser-wide Web Lock and a saved request marker prevent duplicate submissions from open tabs or reloads. Confirmation verifies the exact transaction/receipt, runtime, administrator, delay, canonical collections and all starting rules at one pinned block.

If wallet submission has an unknown outcome, inspect the wallet first. Paste its transaction hash into recovery, or clear the request **only after cancelling it in the wallet**. A submitted hash stays saved; a timeout never enables another deployment. Nonce changes require a new review. Never reuse the earlier launchpad deployment review.

After confirmation, independently verify before app activation:

```sh
node contracts/rare-pet/script/verify-deployment.mjs \
  <transaction-hash> contracts/rare-pet/deployment-review-mainnet-v1.json \
  contracts/rare-pet/deployments/4663.json
```

Create the `deployments` directory first if needed. Publish source to Blockscout using the downloaded standard JSON input and exact compiler `0.8.30+commit.73712a01`. Verify its result, then configure `RAREPET_CONTRACT_ADDRESS` to the verified address and rebuild RarePet. Keep the existing `RAREPET_LAUNCHPAD_ADDRESS`. Retire this signing server after deployment. PLAY stays practice-only until the reviewed game-completion service is connected.

Validation:

```sh
npx tsc --noEmit -p tsconfig.care-deploy.json
node --test tests/care-deployment.test.ts
node --test contracts/rare-pet/test/deployment-policy.test.mjs
```

Controller tests use fake wallet/RPC/storage implementations and never connect to a real wallet or send a network transaction.
