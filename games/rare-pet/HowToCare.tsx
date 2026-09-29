import { Icon } from './art';
import { actionAvailability, DAY, duration, type CareState, type TimedAction } from './care';
import { shortInterval, type CareRules } from './care-policy';
import './how-to-care.css';

type GuideAction = { id: TimedAction; name: string; hint: string; gain: string; schedule: string };
type HowToCareProps = {
  actions: readonly GuideAction[];
  preview: boolean;
  invalid: boolean;
  careKnown: boolean;
  careConfigured: boolean;
  launchConfigured: boolean;
  launchEligible: boolean;
  launchReadyAt: number | null;
  playEligible: boolean;
  rules: CareRules;
  state: CareState;
  now: number;
  rarityRemaining: number;
  nextRarityPoints: number;
};

export function HowToCare({ actions, preview, invalid, careKnown, careConfigured, launchConfigured, launchEligible,
  launchReadyAt, playEligible, rules, state, now, rarityRemaining, nextRarityPoints }: HowToCareProps) {
  const known = careKnown && !invalid;
  const hasPet = known && state.lastPetAt >= 0;
  const readyAt = hasPet ? state.policy?.petSchedule.nextAvailableAt ?? state.lastPetAt + DAY : 0;
  const deadline = hasPet ? state.policy?.petSchedule.graceDeadline ?? readyAt + rules.petGrace : 0;
  const cooldown = hasPet ? readyAt - state.lastPetAt : DAY;
  const grace = hasPet ? Math.max(0, deadline - readyAt) : rules.petGrace;
  const missed = hasPet && now > deadline;
  const pausedPet = known && !rules.actions.pet.enabled;
  const mode = preview ? 'PREVIEW · THIS DEVICE' : invalid ? 'CHOOSE YOUR FRIEND' : !careConfigured ? 'ONCHAIN CARE NOT CONFIGURED'
    : known ? `ONCHAIN CARE · RULES V${state.policy?.version}` : 'LOADING YOUR CARE RULES';
  const totalsKnown = known && !!state.lifetime;

  function card(action: GuideAction) {
    if (action.id === 'play' && !preview) return { ...action, gain: 'XP SOON', schedule: 'PRACTICE MODE',
      hint: playEligible ? 'Play Rare Rush with your Friend. XP rewards come later.' : 'Choose a Genesis or hardwired Generations Friend to play.',
      status: playEligible ? 'PLAY FOR FUN' : 'ELIGIBLE FRIEND NEEDED', muted: true };
    if (action.id === 'launch') return { ...action, hint: preview ? 'Explore the launch form. Preview earns no Brain.' : 'A confirmed launch through your Friend earns Brain.',
      status: preview ? 'PREVIEW FORM · NO BRAIN' : !launchConfigured ? 'NOT CONFIGURED' : !launchEligible ? 'RARE WALLET NEEDED'
        : launchReadyAt === null ? 'CHECKING LAUNCH' : launchReadyAt > now ? `READY IN ${duration(launchReadyAt - now)}` : 'READY',
      muted: preview || !launchConfigured || !launchEligible };
    if (!known) return { ...action, gain: 'Reward policy unavailable', schedule: action.id === 'pet' ? '1 EVERY 24H · FIXED' : 'AWAITING POLICY',
      status: invalid ? 'CHOOSE FRIEND' : careConfigured ? 'LOADING CARE' : 'NOT CONFIGURED', muted: true };
    const available = actionAvailability(state, action.id, now);
    const enabled = rules.actions[action.id].enabled;
    return { ...action, hint: action.id === 'play' ? 'Finish a run to earn preview XP.' : action.hint,
      status: !enabled ? 'PAUSED' : available.remaining ? action.id === 'play' ? `${available.remaining}/${rules.actions.play.dailyLimit} READY` : 'READY'
        : available.waitSeconds ? `READY IN ${duration(available.waitSeconds)}` : 'REFRESHING', muted: !enabled };
  }

  return <div className="care-guide">
    <div className="care-guide-intro"><div><span className="care-guide-eyebrow">YOUR DAILY RITUAL</span><h3>A little love goes a long way.</h3><p>Care when each action is ready. Come back for your Friend.</p></div><span className={`care-guide-mode${preview ? ' is-preview' : ''}`}>{mode}</span></div>

    <div className="care-guide-cards" aria-label="Care actions and current rules">{actions.map(action => {
      const item = card(action);
      return <article key={item.id} className={`care-guide-card care-guide-${item.id}${item.muted ? ' is-muted' : ''}`}>
        <div className="care-guide-card-heading"><span><Icon name={item.id}/></span><h4>{item.name}</h4></div>
        <b className="care-guide-gain">{item.gain}{preview && item.id !== 'launch' && <small>PREVIEW POINTS</small>}</b>
        <span className="care-guide-timing">{item.schedule}</span><p>{item.hint}</p><span className="care-guide-ready">{item.status}</span>
      </article>;
    })}</div>
    <p className="care-guide-caption">Separate timers. Rolling 24-hour limits. No midnight reset.</p>

    <section className="care-guide-bond" aria-labelledby="care-guide-bond-title">
      <div className="care-guide-section-heading"><h4 id="care-guide-bond-title">KEEP YOUR BOND</h4><span>{hasPet ? 'YOUR SAVED CARE WINDOW' : known ? 'AFTER YOUR FIRST PET' : 'PET STAYS ONCE EVERY 24H'}</span></div>
      {known ? <><ol className="care-guide-timeline"><li><span>01 · PET</span><b>0H</b><small>Start the next cycle</small></li><li><span>02 · READY AGAIN</span><b>{shortInterval(cooldown)}</b><small>Pet unlocks</small></li><li><span>03 · BOND DEADLINE</span><b>{shortInterval(cooldown + grace)}</b><small>{shortInterval(grace)} grace after unlock</small></li></ol>
        <p className={`care-guide-deadline${missed ? ' is-missed' : ''}`}>{pausedPet ? 'Pet is currently paused. Your saved care deadline still applies.'
          : missed ? 'This care window was missed. Your next Pet starts a new streak.'
          : hasPet ? readyAt > now ? `Next Pet in ${duration(readyAt - now)}.` : `Pet within ${duration(Math.max(0, deadline - now))} to keep your streak.`
          : 'Your first Pet starts a streak. Pet again on or before the bond deadline.'}
          {hasPet && <> <span>Saved deadline: <time dateTime={new Date(deadline * 1000).toISOString()}>{new Date(deadline * 1000).toLocaleString()}</time>.</span></>}</p></>
        : <p>Your Friend’s grace window and current deadline appear after its verified care record loads. Preview lets you try the care loop now.</p>}
    </section>

    <div className="care-guide-achievements" aria-label="Streak and earned history">
      <div><span>CURRENT STREAK</span><b>{known ? state.streak.toLocaleString() : '—'}<small>{known ? state.streak === 1 ? 'PET IN A ROW' : 'PETS IN A ROW' : 'AWAITING CARE'}</small></b><p>Missing the bond deadline resets your current streak and streak Rarity.</p></div>
      <div><span>NEXT RARITY</span><b>{known ? `+${nextRarityPoints}` : '—'}<small>{known ? `${rarityRemaining} MORE PET${rarityRemaining === 1 ? '' : 'S'}` : 'AWAITING POLICY'}</small></b><p>Pet on time to reach your next milestone.</p></div>
      <div><span>{preview ? 'PREVIEW RARITY' : 'LIFETIME RARITY'}</span><b>{totalsKnown ? state.lifetime!.rarity.toLocaleString() : '—'}<small>{preview ? 'LIFETIME · THIS DEVICE' : totalsKnown ? 'EARNED & RECORDED' : 'AWAITING CARE'}</small></b><p>{preview ? state.lifetime?.complete === false ? 'Tracks new care since history was added. Reset Preview clears it.' : 'Saved on this device. Reset Preview clears these totals.' : 'Missed care never erases lifetime earned totals or confirmed action records.'}</p></div>
    </div>

    <details className="care-guide-details"><summary>A FEW THINGS TO KNOW <span aria-hidden="true">+</span></summary><div>
      <p><b>{preview ? 'Practice care.' : 'Onchain care.'}</b> {preview ? 'Preview points stay on this device and have no onchain value.' : careConfigured ? 'Pet, Feed and Poop ask for a wallet transaction. The owner pays ETH gas; care is saved after confirmation.' : 'Live care is not configured in this build. Owned Friends do not receive simulated preview points.'} Original NFT traits stay unchanged.</p>
      <p><b>Your bond has its own clock.</b> Feed, Play and Poop do not extend the Pet deadline. {known ? `After a missed window, Kinship loses ${hasPet ? state.policy?.petSchedule.decayPoints ?? rules.decayPoints : rules.decayPoints} point(s), then again every ${shortInterval(hasPet ? state.policy?.petSchedule.decayInterval || rules.decayInterval : rules.decayInterval)}, down to zero.` : 'Kinship decay follows the saved care policy.'}</p>
      <p><b>Rules can evolve.</b> Pet stays once every 24 hours. Future reward points and Feed, Play and Poop timers or caps can change after a public 24-hour rule delay. Actions can be paused. Running cooldowns, Pet windows and the next Rarity milestone keep their saved terms. Confirmed rewards and history stay recorded.</p>
      <p><b>Launch is separate.</b> +1 Brain per confirmed Friend launch, once every 24 hours. Yourself launches and preview forms earn no Friend Brain. Playing with an owned Friend is practice until verified onchain XP is connected.</p>
      <p><b>A little 8-bit company.</b> Switch MUSIC and FX on above the habitat. Each has its own toggle, and your choices are remembered. The habitat music pauses during Play; onchain care and launch celebrations wait for confirmation.</p>
    </div></details>
    <a className="care-guide-docs" href="/docs/">EXPLORE THE FULL GUIDE <span aria-hidden="true">↗</span></a>
  </div>;
}
