# Attribution and source provenance

RarePet is a XIBOT project built for Genesis and Generations Rare Friends. It uses canonical Rare Friends assets and the FriendSDK rather than claiming ownership of those underlying materials.

- **FriendSDK 0.1.2**: the pinned `rarefriends-friendsdk-0.1.2.tgz` is included for reproducible installs. SDK source is Apache-2.0; the full [license](licenses/friendsdk-APACHE-2.0.txt) and [notice](licenses/FRIENDSDK-NOTICE.md) are retained. Upstream: <https://github.com/spokesz/friendsdk>.
- **Character/world/sound assets**: Rare Friends. The SDK records its sources and hashes in the retained [art provenance](licenses/friendsdk-art-provenance.json) and [sound provenance](licenses/friendsdk-sound-provenance.json). The SDK notice states the applicable permission for supplied artwork.
- **Preview character frames**: public canonical registry artwork cached by Rare Rush. `games/rare-rush/landing/preview-art.json` retains its retrieval date, token IDs, source SDK, chain contract addresses, and method. These frames are previews and never prove ownership.
- **Rare Rush integration**: XIBOT's Rare Rush engine, economy, visual components, navigation adapter, and Genesis ownership reader are reused under `games/rare-rush`. Original source project: <https://github.com/xibot/rare-rush>. Only files needed by RarePet are packaged here.
- **Silkscreen, Archivo, and Sometype Mono fonts**: distributed under their SIL Open Font Licenses. Binaries, full license texts, exact source URLs, and hashes are retained in `games/rare-rush/assets/fonts`.
- **Doppler SDK 1.0.43**: MIT-licensed EVM token-launch SDK by Whetstone Research. The full [license](licenses/doppler-sdk-MIT.txt) is retained and included in the site credits. Upstream: <https://github.com/whetstoneresearch/doppler-sdk>.
- **Vercel Blob 2.8.0**: server-side storage SDK; its license is retained in the installed package. No storage credentials are included in the browser bundle.
- **React, React DOM, viem, esbuild, TypeScript, Playwright, and their dependencies**: retain the licenses in their installed packages. Browser bundles retain dependency license notices. See `package-lock.json` for pinned versions and integrity hashes.

The static build emits `credits.txt` with SDK attribution, the SDK license, and font license texts. No new blanket license is asserted for Rare Friends branding or for original XIBOT application code.
