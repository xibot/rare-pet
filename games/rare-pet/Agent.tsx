import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, PetBrand, PetSprite, previewFriends } from './art';
import { getIsland, IslandArt } from './islands';
import { careContract, launchpadContract } from './config';
import './agent.css';

const skillUrl = 'https://rarepet.app/skills/rarepet/SKILL.md';
const skillZipUrl = 'https://rarepet.app/skills/rarepet.zip';
const installPromptStart = `Read ${skillUrl} and help me install the complete rarepet skill from `;
const installPromptEnd = '. Review its instructions and files before using it. Start with a read-only check; do not request private keys or sign any transactions.';
const installPrompt = `${installPromptStart}${skillZipUrl}${installPromptEnd}`;
const prompts = [
  { icon: 'pet', title: 'Plan today’s care', text: 'Use rarepet to check my Rare Friend’s traits and care timers. Tell me what is ready, what unlocks next, and when I should Pet again to keep my streak. Read-only first.' },
  { icon: 'wallet', title: 'Meet their Rare Wallet', text: 'Use rarepet to help me find my selected Rare Friend’s wallet address and review its tokens, NFTs and launched tokens. Keep my owner wallet and Rare Wallet balances separate.' },
  { icon: 'launch', title: 'Get a launch ready', text: 'Use rarepet to help me prepare a token launch as my Rare Friend. Ask me for the token image, name, ticker, pair and trading fee. Show me the creator wallet and fee split before any signature.' },
  { icon: 'trade', title: 'Review a trade', text: 'Use rarepet to help me review a Buy / Sell quote in RarePet. Confirm which wallet is trading, the pair, amount, slippage and minimum received. Wait for my approval before any wallet request.' },
] as const;
const generation = previewFriends.find(friend => friend.collection === 'generations' && friend.tokenId === '42')!;
const island = getIsland('circuit');

function AgentFriend() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const animation = window.setInterval(() => {
      if (!document.hidden && !motion.matches) setFrame(current => (current + 1) % 8);
    }, 280);
    return () => window.clearInterval(animation);
  }, []);
  return generation.collection === 'generations' ? <PetSprite sprites={generation.sprites} frame={frame}/> : null;
}

function SectionHeading({ number, label, title, children }: { number: string; label: string; title: string; children?: ReactNode }) {
  return <div className="agent-section-heading"><span className="agent-section-number">{number}</span><div><span className="agent-eyebrow">{label}</span><h2>{title}</h2>{children && <p>{children}</p>}</div></div>;
}

export function Agent() {
  const [copied, setCopied] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [setup, setSetup] = useState<'agent' | 'manual'>('agent');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  async function copy(text: string, label: string) {
    if (copyTimer.current) clearTimeout(copyTimer.current);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label); setCopyStatus(`${label} copied. Paste it into your agent.`);
      copyTimer.current = setTimeout(() => setCopied(null), 3500);
    } catch {
      setCopied(null); setCopyStatus('Copy is unavailable. Select the visible text and copy it manually.');
    }
  }
  const capabilities = [
    { icon: 'pet', label: 'Daily care', status: careContract ? 'ONCHAIN CARE' : 'PREVIEW CARE', description: 'Read traits and timers. Prepare Pet, Feed and Poop when your Friend is ready.', note: 'The live rules decide what is available.', href: '/docs/#care' },
    { icon: 'wallet', label: 'Rare Wallet', status: 'YOUR FRIEND’S ASSETS', description: 'Find their address. Review holdings, sends and creator-fee claims in the app.', note: 'You remain the wallet’s owner and signer.', href: '/docs/#rare-wallet' },
    { icon: 'launch', label: 'Token launches', status: launchpadContract ? 'LIVE IN THE APP' : 'FORM PREVIEW', description: 'Prepare the image, token details, pair and fees. Launch as yourself or your Friend.', note: 'Open LAUNCH from Daily Care.', href: '/docs/#launch' },
    { icon: 'trade', label: 'Buy / Sell', status: 'REVIEW BEFORE SIGNING', description: 'Explore tokens and review a quote using your owner wallet or Rare Wallet.', note: 'Check amounts, approvals and slippage.', href: '/docs/#market' },
    { icon: 'arrow', label: 'Make it yours', status: 'NO WALLET NEEDED', description: 'Explore Preview, choose an island and create a PNG or GIF worth sharing.', note: 'Cosmetics and exports do not perform care.', href: '/docs/#friends' },
    { icon: 'play', label: 'Play together', status: 'ONCHAIN XP SOON', description: 'Open Play for a game with your Friend. Owned Friends currently play for practice.', note: 'Preview XP stays on this device.', href: '/docs/#care' },
  ];
  return <div className="rarepet-app agent-app">
    <a className="agent-skip" href="#agent-main">Skip to agent guide</a>
    <div className="site-header-shell"><header className="site-header"><a className="site-logo" href="/" aria-label="RarePet home"><PetBrand/></a><nav aria-label="Main navigation"><a href="/">HOME</a><a href="/docs/">DOCS</a><a href="/agent/" aria-current="page">AGENT</a><a className="agent-header-cta" href="/">OPEN APP <span aria-hidden="true">↗</span></a></nav></header></div>
    <main className="agent-main" id="agent-main">
      <section className="agent-hero" aria-labelledby="agent-title">
        <div className="agent-hero-copy"><span className="agent-eyebrow"><span className="agent-pixel-dot" aria-hidden="true"/> RAREPET / THE AGENT SKILL</span><h1 id="agent-title">YOUR FRIEND.<br/><span>YOUR AGENT.</span></h1><p>A little help with the daily ritual.<br/>Give your agent the know-how to care for your Rare Friend, with you in control.</p><div className="agent-hero-actions"><a className="agent-primary" href="/skills/rarepet.zip" download="rarepet.zip">GET THE SKILL <span aria-hidden="true">↓</span></a><a className="agent-text-link" href="#start">HOW IT WORKS <span aria-hidden="true">↗</span></a></div><div className="agent-hero-tags"><span>GENESIS + GENERATIONS</span><span>OPEN SKILL</span><span>OWNER SIGNED</span></div></div>
        <div className="agent-hero-art"><div className="agent-art-bar"><span><span aria-hidden="true">✦</span> A FRIEND FOR EVERY DAY</span><span>RAREPET</span></div><div className="agent-scene" role="img" aria-label="A Generations Rare Friend on its Circuit island, saying care for me, human and agent."><span className="agent-scene-star first" aria-hidden="true">+</span><span className="agent-scene-star second" aria-hidden="true">✦</span><span className="agent-scene-star third" aria-hidden="true">+</span><div className="agent-scene-floor" style={{ aspectRatio: island.aspectRatio }}><IslandArt option={island}/><div className="agent-scene-friend" style={{ left: island.petX, top: island.petY, width: `${island.petRatio * 100}%` }} aria-hidden="true"><span className="agent-speech">a little help, a lot of love.</span><AgentFriend/></div></div><span className="agent-scene-caption">SAME FRIEND. A LITTLE EXTRA HELP.</span></div><div className="agent-art-flow" aria-label="Agent reads, agent prepares, owner reviews and signs"><span>READ</span><i aria-hidden="true">→</i><span>PREPARE</span><i aria-hidden="true">→</i><b>YOU SIGN</b></div></div>
      </section>
      <nav className="agent-jump-nav" aria-label="Agent guide sections"><a href="#start">GET STARTED</a><a href="#can-do">WHAT IT CAN HELP WITH</a><a href="#prompts">TRY A PROMPT</a><a href="#for-agents">FOR AGENTS</a></nav>
      <section className="agent-section" id="start">
        <SectionHeading number="01" label="TEACH YOUR AGENT SOMETHING RARE" title="Three steps. One happy Friend.">rarepet is a portable instruction pack. Add it to an agent that supports skills, or let your agent read the guide directly.</SectionHeading>
        <ol className="agent-start-steps"><li><span className="agent-step-index">01 / DOWNLOAD</span><div className="agent-step-mark" aria-hidden="true">↓</div><h3>Pick up the skill.</h3><p>Get the complete ZIP with the guide, references and optional care helper.</p><a href="/skills/rarepet.zip" download="rarepet.zip">DOWNLOAD RAREPET.ZIP <span aria-hidden="true">↗</span></a></li><li><span className="agent-step-index">02 / ADD</span><div className="agent-step-mark brackets" aria-hidden="true">[ ✦ ]</div><h3>Make introductions.</h3><p>Install it in your agent’s skills folder, or share the skill link so it can read along.</p><a href="#agent-setup">CHOOSE YOUR SETUP <span aria-hidden="true">↗</span></a></li><li><span className="agent-step-index">03 / ASK</span><div className="agent-step-mark" aria-hidden="true"><Icon name="pet"/></div><h3>Start with a check-in.</h3><p>Tell your agent which Friend is yours. Ask what’s ready before taking action.</p><a href="#prompts">PICK A FIRST PROMPT <span aria-hidden="true">↗</span></a></li></ol>
        <div className="agent-setup" id="agent-setup"><div className="agent-setup-heading"><span className="agent-eyebrow">MAKE IT YOURS</span><h3>A setup that fits your agent.</h3><p>No RarePet API key needed. Your agent supplies its own browser or local tools.</p></div><div className="agent-setup-content"><div className="agent-segmented" role="group" aria-label="Setup method"><button type="button" aria-pressed={setup === 'agent'} onClick={() => setSetup('agent')}>ASK MY AGENT</button><button type="button" aria-pressed={setup === 'manual'} onClick={() => setSetup('manual')}>INSTALL MANUALLY</button></div>{setup === 'agent' ? <div className="agent-setup-method"><p>Paste this into your agent. It can review the skill and help with installation.</p><div className="agent-copy-box"><p>{installPromptStart}<a className="agent-setup-download" href="/skills/rarepet.zip" download="rarepet.zip">{skillZipUrl}</a>{installPromptEnd}</p><button type="button" onClick={() => void copy(installPrompt, 'Setup prompt')}>{copied === 'Setup prompt' ? 'COPIED ✓' : 'COPY SETUP PROMPT'} <span aria-hidden="true">↗</span></button></div></div> : <div className="agent-setup-method"><ol><li>Download and unzip <b>rarepet.zip</b>.</li><li>Move the <b>rarepet</b> folder into your agent’s skills directory.</li><li>Start a new agent session and ask it to use <b>rarepet</b>.</li></ol><a className="agent-text-link" href="/skills/rarepet/SKILL.md" target="_blank" rel="noreferrer">READ THE SKILL FIRST ↗</a></div>}</div></div>
      </section>
      <section className="agent-section" id="can-do"><SectionHeading number="02" label="KNOW THE ROUTINE" title="Small tasks. More time with your Friend.">The skill explains RarePet’s existing features. What an agent can do depends on the tools you give it.</SectionHeading><div className="agent-capabilities">{capabilities.map(item => <article key={item.label}><div className="agent-capability-top"><Icon name={item.icon}/><span className={item.icon === 'play' ? 'soon' : ''}>{item.status}</span></div><h3>{item.label}</h3><p>{item.description}</p><small>{item.note}</small><a href={item.href} aria-label={`Read about ${item.label}`}>EXPLORE <span aria-hidden="true">↗</span></a></article>)}</div><div className="agent-owner-strip"><Icon name="wallet"/><div><h3>Your Friend. Your call.</h3><p>The agent can read and prepare. You review and sign wallet requests. Installing this skill grants no custody, spending permission or session keys.</p></div><span className="agent-owner-mark" aria-hidden="true">YOU<br/>SIGN ↗</span></div></section>
      <section className="agent-section" id="prompts"><SectionHeading number="03" label="COPY. PASTE. KEEP IT RARE." title="Give your agent a starting point.">Add your collection and token ID when you ask. A public wallet address is enough for a read-only check.</SectionHeading><div className="agent-prompt-grid">{prompts.map((prompt, index) => <article key={prompt.title}><div className="agent-prompt-top"><span>0{index + 1}</span><Icon name={prompt.icon}/></div><h3>{prompt.title}</h3><p>{prompt.text}</p><button type="button" onClick={() => void copy(prompt.text, prompt.title)} aria-label={`Copy prompt: ${prompt.title}`}>{copied === prompt.title ? 'COPIED ✓' : 'COPY PROMPT'} <span aria-hidden="true">↗</span></button></article>)}</div></section>
      <section className="agent-section agent-machine-section" id="for-agents"><SectionHeading number="04" label="HELLO, AGENT." title="Everything you need to read.">Start with the skill. Use the manifest and references for current capabilities, network details and signing boundaries.</SectionHeading><div className="agent-resource-grid"><a href="/skills/rarepet/SKILL.md" target="_blank" rel="noreferrer"><span>01 / INSTRUCTIONS</span><h3>SKILL.md <b aria-hidden="true">↗</b></h3><p>The entry point: care, app workflows and owner review.</p><code>/skills/rarepet/SKILL.md</code></a><a href="/agent/manifest.json" target="_blank" rel="noreferrer"><span>02 / MACHINE READABLE</span><h3>Manifest <b aria-hidden="true">↗</b></h3><p>Capabilities, links and the current integration map.</p><code>/agent/manifest.json</code></a><a href="/llms.txt" target="_blank" rel="noreferrer"><span>03 / QUICK DISCOVERY</span><h3>llms.txt <b aria-hidden="true">↗</b></h3><p>A plain-text introduction and paths to the right files.</p><code>/llms.txt</code></a></div><details className="agent-details"><summary>TOOLS, INSTALLATION & SIGNING DETAILS <span aria-hidden="true">+</span></summary><div><div><h3>Use what is available.</h3><p>Browser-capable agents can guide RarePet’s app workflows. The bundled Node helper reads care status and prepares unsigned Pet, Feed and Poop transactions. Follow its included reference for inputs and commands.</p><p>The skill does not run a hosted agent, install a wallet or keep an agent working in the background. Scheduling belongs to your agent’s own environment.</p></div><div><h3>Keep the owner in control.</h3><p>Read-only checks need no wallet signature. A care transaction, transfer, launch, fee claim or swap needs the owner’s review and wallet confirmation. Never share a seed phrase, private key or private RPC credential.</p><p>Check current ownership, network, recipient, amounts and live rules before a wallet request. Pause when something changes or a transaction is still pending.</p></div><div className="agent-codex-detail"><h3>Codex installation</h3><p>Unzip the complete package into <code>~/.codex/skills/rarepet/</code>. The entry file should be <code>~/.codex/skills/rarepet/SKILL.md</code>. Start a new session and invoke <code>$rarepet</code>. For other agents, follow their skill installation instructions.</p></div></div></details><div className="agent-download-strip"><div><span className="agent-eyebrow">A LITTLE CARE, WITH A LITTLE HELP.</span><h2>LET’S MAKE TODAY RARE.</h2></div><a className="agent-primary" href="/skills/rarepet.zip" download="rarepet.zip">DOWNLOAD RAREPET <span aria-hidden="true">↓</span></a></div></section>
      <footer className="agent-footer"><div><span>RARE PET BY XIBOT</span><small>ROBINHOOD CHAIN</small></div><p>A little pet, a little help, a lot of rare.</p><a href="/docs/">THE FIELD GUIDE ↗</a></footer><p className="credits"><a href="/credits.txt" target="_blank" rel="noreferrer">Rare Friends artwork · Built with FriendSDK</a></p>
      <div className="agent-sr-only" role="status" aria-live="polite" aria-atomic="true">{copyStatus}</div>
    </main>
  </div>;
}
