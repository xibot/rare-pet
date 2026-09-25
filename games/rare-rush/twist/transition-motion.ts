import type {Phase,RunState} from './engine.ts';
type Travel=NonNullable<RunState['transition']>;
type Point={x:number;y:number};
const direction=(phase:Phase)=>phase==='up'?-1:1;
const curve=(a:number,b:number,c:number,d:number,t:number)=>(1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*d;

const SHAFT_SPIN_SPEED=180; // One revolution every 2 seconds at full speed.
function verticalTurn(seconds:number){
 return {angle:SHAFT_SPIN_SPEED*Math.max(0,seconds),speed:SHAFT_SPIN_SPEED};
}

/** Cosmetic tumble for every mode. The engine clock keeps pause, replay and steering
 * independent of the animation. Suction and shaft share one uninterrupted angle;
 * only the exit eases upright, without winding back. */
export function continuousSpin(run:RunState,reducedMotion=false):number{
 if(reducedMotion)return 0;
 const travel=run.transition;
 if(travel&&travel.to==='side'){
  const previous=run.phasePlan[run._phaseIndex-1];
  if(!previous||previous.phase==='side')return 0;
  const start=verticalTurn(run.phaseEnteredAt-previous.start);
  // Leave enough turn for a monotonic Hermite curve at the incoming speed.
  const tangent=start.speed*travel.duration;
  const target=Math.ceil((start.angle+tangent/3)/360)*360;
  const t=Math.max(0,Math.min(1,travel.progress));
  const angle=start.angle+(target-start.angle)*t*t*(3-2*t)+tangent*t*(1-t)*(1-t);
  return direction(travel.from)*angle;
 }
 // Do not restart, ease, or align the angle when the entrance transition clears.
 return run.phase==='side'?0:direction(run.phase)*verticalTurn(run.elapsed-run.phaseEnteredAt).angle;
}

/** Neighboring map chunks have real offsets. The camera and Friend travel
 * through the same space; neither world is blended or replaced mid-bend. */
export function transitionGeometry(travel:Travel){
 const t=Math.max(0,Math.min(1,travel.progress));
 const origin:Point=travel.from==='side'
  ?{x:travel.gateX-480,y:direction(travel.to)*500}
  :{x:travel.gateX-80,y:direction(travel.from)*500};
 const from=travel.fromPlayer,to={x:origin.x+travel.toPlayer.x,y:origin.y+travel.toPlayer.y};
 const sign=direction(travel.from==='side'?travel.to:travel.from);
 const cp1=travel.from==='side'?{x:travel.gateX-from.w/2,y:from.y+sign*95}:{x:travel.gateX-from.w/2,y:from.y+sign*80};
 const cp2=travel.from==='side'?{x:to.x,y:to.y-sign*130}:{x:to.x-115,y:to.y-100};
 const cameraT=t*t*(2-t);
 const camera={x:origin.x*cameraT,y:origin.y*cameraT};
 const worldPlayer={x:curve(from.x,cp1.x,cp2.x,to.x,t),y:curve(from.y,cp1.y,cp2.y,to.y,t)};
 return{origin,camera,player:{x:worldPlayer.x-camera.x,y:worldPlayer.y-camera.y}};
}
