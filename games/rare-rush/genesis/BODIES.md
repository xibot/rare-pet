# Genesis runner bodies

This cosmetic pool is the 36-body Genesis prototype approved by XIBOT. It contains 7 Asymmetry, 15 Mask, 3 Skeleton and 11 Cellular body/gait combinations selected from 367 public canonical registry artwork responses on Robinhood (chain 4663).

Source artwork was decoded with `@rarefriends/friendsdk` 0.1.2, upstream commit `762d6f58a73ace723f7f82dc1a61bfa036c21edc`. The registry is `0x246E3E9730A7Eade94c79be0Fd78d210f89AEb8D`. Each catalog entry identifies its Generations token and family. The pack retains the original right-facing lower-body pixels and all eight running frames, cropped below the narrow neck. Seven 16-bit row masks encode each unique frame; the running sequence references those frames without duplication. Artwork is bundled locally: choosing a body makes no chain request.

The Genesis portrait remains the exact image supplied by the existing identity verifier. XIBOT's composition attaches it above the body and adds the same one-pixel white outline as the approved prototype. A uniform transform fits the composition into the game's 16×16 sprite space. The game's existing parent transform handles sliding and growth. Bodies do not change physics, collision boxes, eligibility, entry fees or rewards, and do not modify either NFT.

`pickGenesisBody` excludes the preceding body. RarePet uses it for the cosmetic body control and passes the selected body into its embedded Rare Rush game. The chosen body stays the same through pose changes, pauses and results. The library does not own selection or run state.

RarePet's wallet-free Genesis samples are cached separately in `games/rare-pet/preview-genesis.json`. They contain the unmodified tokenURI portraits from the canonical Genesis contract on Robinhood mainnet, checked by the same static-portrait validator as wallet-owned Genesis. The cache records its source contract, chain and block. These public samples do not imply ownership or grant onchain care access.

The unit suite checks all 288 running frames plus 36 idle frames against a golden digest computed independently from FriendSDK's decoded canonical registry data, as well as distinct body/gait sequences, portrait attachment, bounds, outline pixels and picker reachability. Unusual or unsupported anatomy is deliberately excluded from this pool.

Rare Friends retains ownership of its Genesis and Generations artwork. Sprite composition and the game are by XIBOT. See the project's existing Rare Friends artwork notices.
