import type {MapTransition, Phase, RunState, Pace} from './engine.ts';

export type Heading = 1 | -1;
const WIDTH=960;
const curve=(a:number,b:number,c:number,d:number,t:number)=>(1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*d;

type HeadingRoute=Pick<RunState,'seed'|'difficulty'|'phasePlan'>;
type HeadingRun=HeadingRoute&Pick<RunState,'_phaseIndex'>;
const headingPlans=new WeakMap<HeadingRoute,readonly Heading[]>();

/** Separate cosmetic seed stream: never consumes the engine RNG or depends on
 * mutable entry times. Replay, pause and rerender always keep the same exits. */
function cosmeticRandom(seed:string){
 let state=2166136261;
 for(const letter of seed)state=Math.imul(state^letter.charCodeAt(0),16777619)>>>0;
 return ()=>{
  state=(state+0x6d2b79f5)>>>0;
  let value=state;
  value=Math.imul(value^(value>>>15),value|1);
  value^=value+Math.imul(value^(value>>>7),value|61);
  return ((value^(value>>>14))>>>0)/4294967296;
 };
}

/** One immutable display heading per horizontal leg, including the opening.
 * Easy: rare late surprise. Normal: at most one leftward leg, usually late.
 * Degen: one or two leftward legs, with no every-exit ping-pong pattern.
 * Some routes stay right throughout. The physics route is never changed. */
export function headingPlan(run:HeadingRoute):readonly Heading[]{
 const cached=headingPlans.get(run);if(cached)return cached;
 const plan:Heading[]=run.phasePlan.filter(section=>section.phase==='side').map(()=>1);
 const random=cosmeticRandom(`rare-rush:surprise-exits:v1:${run.difficulty}:${run.seed.toLowerCase()}`);
 const chance=run.difficulty==='easy'?.35:run.difficulty==='normal'?.65:.90;
 if(plan.length>1&&random()<chance){
  if(run.difficulty==='easy')plan[plan.length-1]=-1;
  else if(run.difficulty==='normal')plan[random()<.30?1:plan.length-1]=-1;
  else {
   // Excludes left/right/left: even DEGEN retains a familiar exit or a
   // continued heading instead of reversing at all three shaft exits.
   const options:Heading[][]=[[-1,1,1],[1,-1,1],[1,1,-1],[-1,-1,1],[1,-1,-1]];
   const chosen=options[Math.floor(random()*options.length)];
   for(let index=1;index<plan.length;index++)plan[index]=chosen[index-1]??1;
  }
 }
 const frozen=Object.freeze(plan);headingPlans.set(run,frozen);return frozen;
}

export function headingFor(run:HeadingRun,index=run._phaseIndex,enabled=true):Heading{
 if(!enabled)return 1;
 const sideLeg=run.phasePlan.slice(0,index+1).filter(section=>section.phase==='side').length-1;
 return headingPlan(run)[Math.max(0,sideLeg)]??1;
}
export function projectX(x:number,width:number,phase:Phase,heading:Heading){
 return phase==='side'&&heading===-1?WIDTH-x-width:x;
}
export function phaseTransform(phase:Phase,heading:Heading){
 return phase==='side'&&heading===-1?'translate(960 0) scale(-1 1)':undefined;
}
/** Arrow keys stay screen-relative. Only horizontal pace changes sign; the
 * canonical controls produced here are what the unchanged replay consumes. */
export function canonicalAxis(axis:Pace,phase:Phase,heading:Heading):Pace{
 return (phase==='side'?axis*heading:axis) as Pace;
}

/** Join differently oriented map chunks by their openings, not by flipping
 * the whole screen. Camera and Friend share one continuous cubic path. */
export function presentationGeometry(travel:MapTransition,fromHeading:Heading,toHeading:Heading){
 const t=Math.max(0,Math.min(1,travel.progress));
 const vertical=travel.from==='side'?travel.to:travel.from;
 const sign=vertical==='up'?-1:1;
 const origin=travel.from==='side'
  ?{x:projectX(travel.gateX,0,'side',fromHeading)-480,y:sign*500}
  :{x:travel.gateX-projectX(80,0,'side',toHeading),y:sign*500};
 const from={...travel.fromPlayer,x:projectX(travel.fromPlayer.x,travel.fromPlayer.w,travel.from,fromHeading)};
 const to={x:origin.x+projectX(travel.toPlayer.x,travel.toPlayer.w,travel.to,toHeading),y:origin.y+travel.toPlayer.y};
 const gate=travel.from==='side'?projectX(travel.gateX,0,'side',fromHeading):travel.gateX;
 const cp1={x:gate-from.w/2,y:from.y+sign*(travel.from==='side'?95:80)};
 const cp2=travel.from==='side'?{x:to.x,y:to.y-sign*130}:{x:to.x-115*toHeading,y:to.y-100};
 const cameraT=t*t*(2-t),camera={x:origin.x*cameraT,y:origin.y*cameraT};
 const worldPlayer={x:curve(from.x,cp1.x,cp2.x,to.x,t),y:curve(from.y,cp1.y,cp2.y,to.y,t)};
 return {origin,camera,player:{x:worldPlayer.x-camera.x,y:worldPlayer.y-camera.y}};
}

/** Keep the uninterrupted shaft spin. Turning to face the new corridor is a
 * small local yaw during the exit; the entire map never squashes or flips. */
export function characterFacing(run:RunState,enabled=true,reducedMotion=false){
 const current=headingFor(run,run._phaseIndex,enabled);
 if(!run.transition||run.transition.to!=='side')return current;
 const previous=headingFor(run,run._phaseIndex-1,enabled);
 if(previous===current)return current;
 const t=Math.max(0,Math.min(1,run.transition.progress));
 if(reducedMotion)return t<.5?previous:current;
 return previous*Math.cos(Math.PI*t*t*(3-2*t));
}
