import { useState, type ReactNode } from 'react';
import { PetBrand, Icon, PetSprite, GenesisPetSprite, previewFriends, GENESIS_BODIES } from './art';
import { getIsland, IslandArt, islandOptions, type Island } from './islands';
import { careContract, launchpadContract } from './config';
import './docs.css';

export type DocsProps = { petGraceHours?: number };
const sections = [
  ['start', 'Start here'], ['modes', 'Pick a mode'], ['friends', 'Make it yours'],
  ['care', 'Daily care'], ['streaks', 'Keep a streak'], ['rare-wallet', 'Rare Wallet'],
  ['launch', 'Launch'], ['market', 'Trade'], ['agent', 'Agent'], ['onchain', 'Live & soon'],
] as const;
const generation = previewFriends.find(friend => friend.collection === 'generations' && friend.tokenId === '42')!;
const genesis = previewFriends.find(friend => friend.collection === 'genesis')!;
const actions = [
  { id: 'pet', name: 'Pet', time: '24', unit: 'HOURS', gain: '+1 Kinship', detail: 'A little love. A stronger bond.', tag: 'FIXED COOLDOWN' },
  { id: 'feed', name: 'Feed', time: '4', unit: 'HOURS', gain: '+1 Strength · +5 Stamina', detail: 'Good food. One happy Friend.', tag: 'STARTING RULE' },
  { id: 'play', name: 'Play', time: '3', unit: 'RUNS / 24H', gain: '+10 preview XP', detail: 'Finish a Rare Rush run to grow.', tag: 'WALLET XP SOON' },
  { id: 'launch', name: 'Launch', time: '24', unit: 'HOURS', gain: '+1 Brain', detail: 'Launch a token as your Friend.', tag: 'CONFIRMED RF LAUNCH' },
  { id: 'poop', name: 'Poop', time: '4', unit: 'HOURS', gain: '+1 Health', detail: 'A little break. Feeling fresh.', tag: 'STARTING RULE' },
] as const;
function SectionHead({ number, eyebrow, title, children }: { number: string; eyebrow: string; title: string; children?: ReactNode }) {
  return <div className="guide-section-head"><span className="guide-index-number">{number}</span><div><span className="docs-eyebrow">{eyebrow}</span><h2>{title}</h2>{children && <p>{children}</p>}</div></div>;
}
function More({ title, children }: { title: string; children: ReactNode }) {
  return <details className="guide-more"><summary>{title}<span aria-hidden="true">+</span></summary><div>{children}</div></details>;
}
function Scene({ island = 'garden', collection = 'generations', bodyIndex = 0, speech = 'gm, best friend.' }: { island?: Island; collection?: 'generations' | 'genesis'; bodyIndex?: number; speech?: string }) {
  const option = getIsland(island);
  return <div className="guide-scene" role="img" aria-label={`${collection === 'genesis' ? 'Genesis' : 'Generations'} Friend on the ${option.name} island`}>
    <span className="guide-star star-one" aria-hidden="true">+</span><span className="guide-star star-two" aria-hidden="true">✦</span>
    <div className="guide-scene-floor" style={{ aspectRatio: option.aspectRatio }}><IslandArt option={option}/>
      <div className="guide-scene-friend" style={{ left: option.petX, top: option.petY, width: `${option.petRatio * 100}%` }} aria-hidden="true">
        <span className="guide-speech">{speech}</span>
        {collection === 'genesis' ? <GenesisPetSprite portraitUrl={genesis.image} bodyId={GENESIS_BODIES[bodyIndex].id}/> : generation.collection === 'generations' && <PetSprite sprites={generation.sprites} frame={0}/>}
      </div>
    </div>
  </div>;
}
function Cosmetics() {
  const [island, setIsland] = useState<Island>('garden');
  const [collection, setCollection] = useState<'generations' | 'genesis'>('genesis');
  const [bodyIndex, setBodyIndex] = useState(0);
  return <div className="guide-cosmetics">
    <div className="guide-cosmetic-stage"><span className="guide-panel-label">TRY A LOOK / NO WALLET NEEDED</span><Scene island={island} collection={collection} bodyIndex={bodyIndex} speech="this place feels like me."/><span className="guide-scene-caption">{collection.toUpperCase()} / {getIsland(island).name.toUpperCase()}</span></div>
    <div className="guide-cosmetic-controls">
      <div className="guide-control-label"><span>01</span> YOUR FRIEND</div>
      <div className="guide-segmented" role="group" aria-label="Guide Friend collection">{(['genesis', 'generations'] as const).map(value => <button key={value} aria-pressed={collection === value} onClick={() => setCollection(value)}>{value === 'genesis' ? 'Genesis' : 'Generations'}</button>)}</div>
      <div className="guide-control-label"><span>02</span> YOUR ISLAND <small>11 LOOKS</small></div>
      <div className="guide-islands" role="group" aria-label="Guide island">{islandOptions.map(option => <button key={option.id} title={option.name} aria-label={option.name} aria-pressed={island === option.id} onClick={() => setIsland(option.id)}><IslandArt option={option}/><span>{option.name}</span></button>)}</div>
      <div className="guide-control-label"><span>03</span> YOUR BODY <small>GENESIS ONLY</small></div>
      <button className="guide-body-button" disabled={collection !== 'genesis'} onClick={() => setBodyIndex(index => (index + 1) % GENESIS_BODIES.length)}>TRY ANOTHER BODY <span aria-hidden="true">↻</span></button>
      <p className="guide-small">{collection === 'genesis' ? `${GENESIS_BODIES.length} cosmetic bodies. Your original portrait stays yours.` : 'Generations keeps its original full-body artwork.'}</p>
    </div>
  </div>;
}

export function Docs({ petGraceHours = 24 }: DocsProps) {
  const petDeadlineHours = 24 + petGraceHours;
  return <div className="rarepet-app docs-app">
    <a className="docs-skip" href="#docs-main">Skip to guide</a>
    <div className="site-header-shell"><header className="site-header"><a className="site-logo" href="/" aria-label="RarePet home"><PetBrand/></a><nav aria-label="Main navigation"><a className="docs-nav-link" href="/">HOME</a><a className="docs-nav-link" href="/docs/" aria-current="page">DOCS</a><a className="docs-nav-link" href="/agent/">AGENT</a><a className="guide-header-cta" href="/">MEET YOUR PET <span aria-hidden="true">↗</span></a></nav></header></div>
    <main className="docs-main" id="docs-main">
      <div className="docs-hero">
        <div className="guide-hero-copy"><span className="docs-eyebrow">THE RAREPET FIELD GUIDE / 01</span><h1>A LITTLE CARE.<br/><span>A LOT OF RARE.</span></h1><p>Every Rare Friend is a Rare Pet.<br/>Give yours a home, a daily ritual, and a little love.</p><a className="guide-primary-link" href="#start">LET’S GET YOU STARTED <span aria-hidden="true">↓</span></a><div className="guide-hero-facts"><span><b>5</b> CARE ACTIONS</span><span><b>7</b> GROWING TRAITS</span><span><b>1</b> RARE FRIEND</span></div></div>
        <div className="guide-hero-art"><div className="guide-art-top"><span>YOUR NEW DAILY RITUAL</span><span aria-hidden="true">✦</span></div><Scene/><div className="guide-art-bottom"><span>GENESIS + GENERATIONS</span><span>KEEP IT RARE ↗</span></div></div>
      </div>
      <nav className="guide-jump-nav" aria-label="Guide sections">{sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
      <div className="docs-content">
        <section id="start">
          <SectionHead number="01" eyebrow="THREE SMALL STEPS" title="Your Friend is waiting.">From first hello to your daily routine.</SectionHead>
          <ol className="guide-start-steps">
            <li><span className="guide-step-number">01</span><div className="guide-step-art" aria-hidden="true">{generation.collection === 'generations' && <PetSprite sprites={generation.sprites} frame={0}/>}</div><h3>Choose a Friend</h3><p>Try a sample in Preview, or connect your wallet to bring your own.</p><a href="#modes">PICK YOUR MODE ↗</a></li>
            <li><span className="guide-step-number">02</span><div className="guide-step-art island" aria-hidden="true"><IslandArt option={getIsland('garden')}/></div><h3>Make a home</h3><p>Pick an island. Give your Genesis Friend a cosmetic body.</p><a href="#friends">TRY A LOOK ↗</a></li>
            <li><span className="guide-step-number">03</span><div className="guide-step-art heart" aria-hidden="true"><Icon name="pet"/></div><h3>Come back for care</h3><p>Pet, feed, play and grow. Each action tells you when it’s ready.</p><a href="#care">MEET THE ROUTINE ↗</a></li>
          </ol>
        </section>
        <section id="modes">
          <SectionHead number="02" eyebrow="TWO WAYS TO PLAY" title="Try it. Then bring your own."/>
          <div className="guide-mode-grid">
            <div className="guide-mode-card"><span className="guide-chip">NO WALLET NEEDED</span><h3>Preview</h3><p>Meet a sample Friend and try the whole care routine.</p><ul><li>Free to explore. No signatures.</li><li>Care is saved on this device.</li><li>Reset your selected sample anytime.</li></ul><a href="/" className="guide-text-link">TRY RAREPET ↗</a></div>
            <div className="guide-mode-card owned"><span className="guide-chip">YOUR NFT. YOUR FRIEND.</span><h3>My Wallet</h3><p>Bring a Genesis or Generations Friend you own.</p><ul><li>Connect at the top right.</li><li>Open My Wallet or Choose Friend.</li><li>{careContract ? 'Confirm care in your wallet. It stays onchain.' : 'Onchain care is not enabled in this build.'}</li></ul><a href="/" className="guide-text-link">BRING YOUR FRIEND ↗</a></div>
          </div>
          <div className="guide-inline-tip"><Icon name="wallet"/><p><b>Need to disconnect?</b> Click your wallet address at the top right. <b>Choose Friend</b> is for selecting and refreshing your Friends.</p></div>
          <More title="Preview and wallet care stay separate"><p>Preview points live only on this device and have no onchain value. Connecting opens My Wallet. Your selected Friend is remembered on this device and verified again after a refresh. Disconnecting returns you to Preview. Reset Preview only clears the selected sample. Connecting a wallet does not perform care, transfer your NFT or grant preview points to an owned Friend.</p></More>
        </section>
        <section id="friends">
          <SectionHead number="03" eyebrow="A HOME WITH PERSONALITY" title="Same Friend. Your kind of space.">11 islands. 36 cosmetic bodies for Genesis. All you.</SectionHead>
          <Cosmetics/>
          <div className="guide-caption-row"><span>6 WORLDS + 5 CLASSIC FLOORS</span><p>Background islands match yours. Bodies and islands are cosmetic: your NFT artwork, metadata and care rewards stay unchanged.</p></div>
          <div className="guide-share-strip"><div><span className="guide-chip">SHARE ↗</span><h3>A moment worth keeping.</h3><p>Pick Pet, Feed, Play, Launch, Poop or Talk. Your Friend, island and speech bubble come along.</p></div><div className="guide-format"><b>PNG</b><span>2000 × 2000</span><small>STILL IMAGE</small></div><div className="guide-format"><b>GIF</b><span>800 × 800</span><small>2.4s LOOP</small></div></div>
          <More title="Sharing and cosmetic details"><p><b>A little 8-bit company.</b> Switch MUSIC on, then choose DAYDREAM (easygoing, 84 BPM) or PIXEL PARTY (playful, 128 BPM) with the buttons above the habitat. Each is an original 8-bit soundtrack. Pixel Party is the default. Track buttons are disabled while music is off. FX adds distinct care sounds and a special Rarity chime. Both start off; your track and sound choices are remembered. Audio starts after a tap and pauses in hidden tabs. The habitat music pauses during Play. Onchain care and launch celebrations wait for confirmation.</p><p>Open SHARE ↗ below your Friend’s greeting. Choose Talk for your Friend and a message, with no care effects. Add a custom speech-bubble message of up to 21 characters; it appears in both PNG and GIF exports. Leave it blank for the original message. Download the image on its own, or use Download + Share on X to open an editable post. Attach the downloaded PNG or GIF before posting. Making media never performs care or uses a cooldown.</p><p>Your island, Genesis body and last preview Friend are remembered on this device. Classic uses smaller background islands. Background islands follow separate paths from each other and can pass behind your main island. Genesis keeps its original portrait; Generations keeps its original artwork. Your chosen Genesis body follows your Friend into Play.</p></More>
        </section>
        <section id="care">
          <SectionHead number="04" eyebrow="THE DAILY ROUTINE" title="Small actions. Growing traits.">One timer per action. No shared midnight reset.</SectionHead>
          <div className="guide-care-grid">{actions.map(action => <div key={action.id} className="guide-care-card"><div className="guide-care-top"><Icon name={action.id}/><h3>{action.name}</h3></div><div className="guide-care-time"><b>{action.time}</b><span>{action.unit}</span></div><span className="guide-care-gain">{action.gain}</span><p>{action.detail}</p><small>{action.tag}</small></div>)}<a className="guide-care-card guide-care-streak" href="#streaks"><div className="guide-care-top"><span aria-hidden="true">✦</span><h3>Keep a streak</h3></div><div className="guide-care-time"><b>7</b><span>PETS IN A ROW</span></div><span className="guide-care-gain">+1 Rarity</span><p>Keep showing up for your Friend.</p><small>SEE HOW STREAKS WORK ↗</small></a></div>
          <div className="guide-two-notes"><p><b>These are the starting rules.</b> Your live dashboard shows the current rewards and countdowns.</p><p><b>PLAY · XP SOON</b> Owned Friends can play for practice. Onchain XP is coming later. Preview earns +10 XP after a completed run, up to 3 per rolling 24h.</p></div>
          {!careContract && <p className="guide-notice">This build supports Preview care. Onchain Pet, Feed and Poop are not configured.</p>}
          {!launchpadContract && <p className="guide-notice">Launch is preview-only in this build. No token or Brain reward is created.</p>}
          <More title="Exact cooldowns, rolling limits and Play eligibility"><p>Feed and Poop start with a four-hour cooldown and a limit of six actions per rolling 24 hours. Each completed, rewarded preview run takes one of three Play slots; that slot returns 24 hours later. An unfinished run earns no XP.</p><p>Play opens Rare Rush. Genesis and hardwired Generations Friends can play. Other Generations Friends can still receive care. Stamina currently accumulates as a trait; it is not spent to enter Play. Onchain Play rewards need a verified completion service and claim flow, which are not connected yet.</p><p>Live care asks for a wallet transaction and ETH for gas. The connected wallet must own the selected Friend. Preview care is local. Launch’s timer starts only after a successful Friend launch; launching as Yourself earns no Brain and has no Friend launch cooldown.</p></More>
          <div id="traits" className="guide-trait-strip"><span>YOUR SEVEN TRAITS</span><dl>{[['Kinship', 'Your bond'], ['Strength', 'Well fed'], ['Stamina', 'Growing energy'], ['Experience', 'Play & learn'], ['Brain', 'New ideas'], ['Health', 'Feeling fresh'], ['Rarity', 'Showing up']].map(([name, text]) => <div key={name}><dt>{name}</dt><dd>{text}</dd></div>)}</dl></div>
        </section>
        <section id="streaks">
          <SectionHead number="05" eyebrow="A LITTLE LOVE, EVERY DAY" title="Keep the bond going.">Your first Pet starts a streak. Here’s the starting schedule.</SectionHead>
          <div className="guide-pet-timeline" aria-label={`Starting Pet schedule: cooldown from zero to 24 hours, then grace until ${petDeadlineHours} hours`}><div><span>YOU PET</span><b>0h</b><p>Love delivered.<br/>Your cooldown starts.</p><Icon name="pet"/></div><div className="ready"><span>PET IS READY AGAIN</span><b>24h</b><p>Come back for care.<br/>{petGraceHours > 0 ? `${petGraceHours} hours of grace begin.` : 'Pet again when it unlocks.'}</p><span className="guide-timeline-arrow" aria-hidden="true">→</span></div><div><span>GRACE DEADLINE</span><b>{petDeadlineHours}h</b><p>Pet by this time<br/>to keep your streak.</p><span className="guide-timeline-arrow" aria-hidden="true">→</span></div></div>
          <div className="guide-streak-result"><div className="guide-seven-pets" aria-label="Seven consecutive pets earn one starting rarity point">{Array.from({ length: 7 }, (_, i) => <span key={i}>{i === 6 ? '✦' : <Icon name="pet"/>}</span>)}</div><div><b>7 IN A ROW <span>→ +1 RARITY</span></b><p>Every seven consecutive care cycles, under the starting rules.</p></div></div>
          <div className="guide-two-notes"><p><b>Miss the window?</b> Current streak and streak Rarity reset. Kinship starts to fall. Your next Pet starts a new streak.</p><p><b>Made progress before?</b> Your lifetime earned points and best streak stay recorded. Missing a day never erases them.</p></div>
          <More title="Grace windows, missed care and future rule changes"><p>The timeline above uses the starting rules. Your Friend’s dashboard shows its actual saved grace deadline. Pet on or before that deadline. Feed, Play and Poop do not extend it.</p><p>Under the starting rules, missing the deadline loses one Kinship; each further missed 24 hours loses another, down to zero. An administrator can update future care rewards and the Feed, Play and Poop timers and limits through a public 24-hour delay. Grace, decay and rarity rules can also change. Pet’s 24-hour cooldown and limit are fixed. Existing cooldowns and grace windows keep their saved deadlines; tighter limits or paused actions can affect what is available next.</p></More>
          <div id="history" className="guide-history"><div className="guide-history-mark" aria-hidden="true">✦</div><div><span className="docs-eyebrow">CARE TODAY. KEEP THE HISTORY.</span><h3>Your Friend remembers.</h3><p>Each accepted onchain action saves its time, owner, rules and earned points. That history follows the Friend when ownership changes.</p><div className="guide-history-tags"><span>LIFETIME POINTS</span><span>ACTION COUNTS</span><span>BEST STREAK</span></div><p className="guide-small">Future games and rarity-farming seasons can build on this record. Prize rewards are not live yet. Preview history stays on this device.</p></div></div>
        </section>
        <section id="rare-wallet">
          <SectionHead number="06" eyebrow="THEIR OWN WALLET" title="Your Friend has assets, too.">Open Rare Wallet in Daily Care to see and manage them.</SectionHead>
          <div className="guide-wallet-flow"><div><Icon name="wallet"/><h3>You</h3><span>SIGN + PAY ETH GAS</span><p>The connected NFT owner approves the action.</p></div><span className="guide-flow-arrow" aria-hidden="true">→</span><div className="friend-wallet"><span aria-hidden="true">{generation.collection === 'generations' && <PetSprite sprites={generation.sprites} frame={0}/>}</span><h3>Rare Wallet</h3><span>YOUR FRIEND’S ASSETS</span><p>Tokens and NFTs move from, or arrive in, this wallet.</p></div></div>
          <div className="guide-feature-row">{[['wallet', 'See holdings', 'Copy the address. View tokens, ETH and NFTs.'], ['arrow', 'Send assets', 'Send tokens or NFTs after reviewing the recipient.'], ['trade', 'Buy / Sell', 'Trade using this Friend’s balances.'], ['launch', 'Claim fees', 'Check creator fees from its launched tokens.']].map(([icon, title, description]) => <div key={title}><Icon name={icon}/><h3>{title}</h3><p>{description}</p></div>)}</div>
          <p className="guide-footnote">For Genesis and hardwired Generations Friends you own. No care cooldown. No trait change.</p>
          <More title="Finding assets, sending and claiming fees"><p>Refresh loads a new holdings snapshot. Load More continues incomplete discovery. If an asset is missing, check it by contract address and, for an NFT, token ID. Holdings are checked onchain; incomplete or unavailable data is shown explicitly.</p><p>Send Tokens supports ETH and ERC-20 assets. Send NFT supports ERC-721 and ERC-1155, including quantities. Before signing, check the full recipient, amount, asset and source wallet. RarePet rechecks ownership, balances and the transaction. The owner pays gas; the assets come from the Rare Wallet.</p><p>Tokens Launched lists contract addresses and explorer links. Check Fees reviews the creator’s available share; a confirmed claim sends it to the same Rare Wallet. Claims can include both tokens in the pool. Claims and swaps refresh holdings after confirmation. Changing account or network closes Rare Wallet and requires selecting the Friend again.</p></More>
        </section>
        <section id="launch">
          <SectionHead number="07" eyebrow="GIVE AN IDEA A TOKEN" title="Meet Rare Launchpad.">Open LAUNCH in Daily Care.</SectionHead>
          <p className="guide-footnote">Preview explores the form only: no token is created and no Brain is earned. A live launch needs a connected wallet.</p>
          <div className="guide-launch-modes"><div><span>LAUNCH AS</span><h3>Yourself</h3><p>Your wallet creates the token and receives creator fees.</p><small>NO NFT NEEDED · NO BRAIN REWARD</small></div><div><span>LAUNCH AS</span><h3>Your Rare Friend</h3><p>Your Friend’s Rare Wallet receives creator fees.</p><small>+1 BRAIN · ONE CONFIRMED LAUNCH / 24H</small></div></div>
          <ol className="guide-mini-steps"><li><span>01</span><b>Name it</b><p>Name + ticker + image.</p></li><li><span>02</span><b>Pair it</b><p>Choose a quote token.</p></li><li><span>03</span><b>Set fees</b><p>0.3%, 1% or 2%.</p></li><li><span>04</span><b>Review & launch</b><p>Confirm in your wallet.</p></li></ol>
          <div className="guide-pair-strip"><span>PAIR WITH</span><b>WETH</b><b>$RAREFRIENDS</b><b>USDG</b><b>cbBTC</b><b>STOCKS + ETFs</b></div>
          <div className="guide-fees"><div className="guide-fee-title"><h3>A share of every trading fee.</h3><p>From collected fees. Not from the token supply.</p></div><div className="guide-fee-bar" role="img" aria-label="Trading fees: 85 percent creator, 10 percent RarePet treasury, 5 percent Doppler"><span className="creator">85%</span><span className="treasury">10</span><span className="protocol">5</span></div><dl className="guide-fee-legend"><div><dt>85% CREATOR</dt><dd>Your wallet or your Friend’s wallet.</dd></div><div><dt>10% TREASURY</dt><dd>RarePet’s prize treasury.</dd></div><div><dt>5% DOPPLER</dt><dd>The launch protocol.</dd></div></dl></div>
          <p className="guide-notice">V1 pays creator fees. Token-holder rewards (HOLD & CLAIM) are not included.</p>
          <More title="Supply, starting price and launch details"><p>Each launch starts with one billion tokens assigned to the pool and no creator allocation. Its starting fully diluted value is approximately $10,000 after price and tick rounding. This is a starting price, not money raised or guaranteed market value.</p><p>The creator is the wallet chosen at launch. Your connected wallet authorizes the image upload, signs the launch and pays gas. After confirmation, a success popup shows your token and its contract address. Yourself launches have no daily Friend limit. A verified Friend launch earns +1 Brain and starts its fixed 24-hour cooldown. Its Brain record is separate from care history.</p><p>Images can be PNG, JPG or WebP and are cropped to 512 × 512 before publishing. Metadata stores the public image URL and SHA-256 content hash onchain. Files use content-based names that the upload service does not overwrite; availability still depends on storage.</p></More>
          <More title="How prices and fee claims work"><p>The reviewed router supports all 199 catalog pairs. WETH, USDG, cbBTC and supported stocks use verified Chainlink feeds; other stocks use Robinhood’s official bid/ask midpoint and the token’s onchain multiplier. $RAREFRIENDS uses a checked 30-minute average from its official WETH pool, converted with Chainlink ETH/USD, with liquidity and recent-activity checks. A price change above 1% needs a fresh review.</p><p>USDG uses its live USD price, not an assumed $1 peg. cbBTC is the Chainlink CCIP-bridged representation from Base. Stale, paused or unverifiable prices cannot prepare a launch.</p><p>Choose Check Fees on a launched token, review, then confirm. The creator share goes to the launch’s creator wallet and can arrive in both pool tokens. The review shows exact recipients and available amounts. Claims are separate transactions; they earn no Brain and use no launch slot. If creator and treasury share one address, their shares combine.</p></More>
          {!launchpadContract && <p className="guide-notice">This build lets you explore the launch form. Live launches and fee claims are not configured.</p>}
        </section>
        <section id="market">
          <SectionHead number="08" eyebrow="ALL INSIDE RAREPET" title="Find it. Buy it. Sell it.">Browse ecosystem tokens and RarePet launches without leaving the app.</SectionHead>
          <div className="guide-trade-path"><div><Icon name="trade"/><b>Find a token</b><p>Search or browse the token grid.</p></div><span aria-hidden="true">→</span><div><b>Buy or Sell</b><p>Enter the amount. Get a quote.</p></div><span aria-hidden="true">→</span><div><b>Review & confirm</b><p>Check minimum received and sign.</p></div></div>
          <div className="guide-mode-grid compact"><div className="guide-mode-card"><span className="guide-chip">DAILY CARE → BUY / SELL</span><h3>Your wallet trades.</h3><p>Spend and receive assets in your connected wallet.</p></div><div className="guide-mode-card owned"><span className="guide-chip">RARE WALLET → BUY / SELL</span><h3>Your Friend trades.</h3><p>Spend and receive assets in its Rare Wallet. You sign and pay gas.</p></div></div>
          <div className="guide-inline-tip"><Icon name="trade"/><p><b>No care cooldown. No trait changes.</b> Trading uses real assets, even when browsing from Preview. Listed tokens still need an available route and liquidity.</p></div>
          <More title="Quotes, approvals and available tokens"><p>Find a Token includes WETH, $RAREFRIENDS, USDG, cbBTC, supported Robinhood stock and ETF tokens, and RarePet launches. Buy spends the shown quote token; Sell receives it. Ecosystem pairs default to WETH, except WETH pairs with USDG. WETH pairs use WETH; keep ETH in the connected owner wallet for gas.</p><p>Review slippage and minimum received. Quotes load automatically without a wallet signature. Approve & Buy or Approve & Sell guides you through any required token approval, trading approval and the swap. Confirm each request in your wallet; the next step loads automatically. Your reviewed minimum stays protected, and a changed price or wallet stops the flow for a new review. A success card shows the amounts actually exchanged after confirmation. If a transaction is pending, check its status before starting another trade.</p><p>Ecosystem routes use available Uniswap liquidity; launched tokens use their Doppler pools. RarePet adds no trading fee. Existing pool fees and recipient splits still apply. The market lists supported routes and actual launch pairs, not every possible pairing.</p></More>
        </section>
        <section id="agent">
          <SectionHead number="09" eyebrow="YOUR FRIEND. YOUR AGENT." title="A little help with the daily ritual.">The rarepet skill teaches your agent how to check on your Friend, prepare care and find its way around the app.</SectionHead>
          <ol className="guide-agent-flow">
            <li><span className="guide-chip">01 / CHECK</span><Icon name="pet"/><h3>Know what’s ready.</h3><p>Read ownership, traits, streaks and live care timers. A public check needs no wallet signature.</p></li>
            <li><span className="guide-chip">02 / PREPARE</span><Icon name="wallet"/><h3>Plan a little care.</h3><p>Prepare Pet, Feed or Poop when it’s ready. The helper checks the rules and simulates the action.</p></li>
            <li><span className="guide-chip">03 / CARE</span><Icon name="arrow"/><h3>Sign. Confirm. Grow.</h3><p>Your wallet or an authorized agent wallet signs. Confirm the onchain result before counting the care.</p></li>
          </ol>
          <div className="guide-mode-grid guide-agent-setup">
            <div className="guide-mode-card"><span className="guide-chip">ASK MY AGENT</span><h3>Copy. Paste. Meet.</h3><p>Open the AGENT page, choose Ask My Agent and copy the setup prompt. Your agent can review the skill and help install it.</p><a href="/agent/#agent-setup" className="guide-text-link">GET THE SETUP PROMPT ↗</a></div>
            <div className="guide-mode-card"><span className="guide-chip">INSTALL MANUALLY</span><h3>Pick up the skill.</h3><p>Download and unzip rarepet.zip. Move the rarepet folder into your agent’s skills directory, then start a new session and ask it to use rarepet.</p><a className="guide-agent-download" href="/skills/rarepet.zip" download="rarepet.zip">https://rarepet.app/skills/rarepet.zip <span aria-hidden="true">↓</span></a></div>
          </div>
          <div className="guide-inline-tip"><Icon name="wallet"/><p><b>Your agent can own a Friend, too.</b> An agent whose wallet owns the RF can perform authorized care using its wallet tools. Its own scheduler or cron job can check timers and return when care is ready.</p></div>
          <More title="Scheduled care and what the skill includes"><p>Start with your Friend’s collection and token ID. The bundled helper reads care and prepares unsigned Pet, Feed and Poop transactions. It runs on Node.js 22 or later, with no npm dependencies or RarePet API key. The skill also guides Rare Wallet, launches, fee claims, trading and sharing through the app.</p><p>Scheduling, signing and sending belong to your agent’s own tools. Installing the skill does not create a wallet, grant transaction permission or start a background job. For recurring care, specify the Friend, allowed actions, gas budget and authorization expiry. Each run should recheck ownership and live timers, confirm submitted transactions and avoid retrying a pending action.</p><p>Launches, trades, transfers and fee claims need their own authorization. Owned Friends’ Play XP is still coming later; the skill cannot award it. The AGENT page includes copyable prompts for care, Rare Wallet, launches and trade reviews.</p></More>
          <nav className="guide-agent-resources" aria-label="Agent resources"><a href="/agent/">EXPLORE THE AGENT PAGE ↗</a><a href="/skills/rarepet/SKILL.md" target="_blank" rel="noreferrer">READ SKILL.md ↗</a><a href="/agent/manifest.json" target="_blank" rel="noreferrer">MANIFEST ↗</a><a href="/llms.txt" target="_blank" rel="noreferrer">llms.txt ↗</a></nav>
        </section>
        <section id="onchain">
          <SectionHead number="10" eyebrow="WHERE WE ARE TODAY" title="Ready now. More to come."/>
          <div className="guide-status-grid"><div><span className="guide-chip">READY NOW</span><h3>Make yourself at home.</h3><ul><li>Preview, islands & cosmetic bodies</li><li>PNG & GIF sharing</li><li>Wallet ownership & Rare Wallet</li><li>In-app Buy / Sell</li><li>{careContract ? 'Onchain Pet, Feed & Poop' : 'Onchain care not configured in this build'}</li><li>{launchpadContract ? 'Token launches & creator fee claims' : 'Launch form preview only in this build'}</li><li>AGENT page & downloadable rarepet skill</li></ul></div><div className="soon"><span className="guide-chip">COMING LATER</span><h3>Room to grow.</h3><ul><li>Verified onchain Play XP</li><li>Rarity-farming seasons & prizes</li></ul></div></div>
          <a className="guide-return" href="/"><span>YOUR FRIEND IS WAITING.</span><b>LET’S MAKE TODAY RARE.</b><span aria-hidden="true">↗</span></a>
        </section>
      </div>
      <footer className="docs-footer"><div className="docs-signature"><span>RARE PET BY XIBOT</span><small>ROBINHOOD CHAIN</small></div><p>A little pet, a little play, a lot of rare.</p><a href="https://rarefriends.com" target="_blank" rel="noreferrer">RARE FRIENDS ↗</a></footer><p className="credits"><a href="/credits.txt" target="_blank" rel="noreferrer">Rare Friends artwork · Built with FriendSDK</a></p>
    </main>
  </div>;
}
