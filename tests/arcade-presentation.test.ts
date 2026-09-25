import test from 'node:test';
import assert from 'node:assert/strict';
import {createRun,stepRun,demoControls,setPace,setSliding,jump,FIXED_STEP,type RunState,type Pace} from '../games/rare-rush/twist/engine.ts';
import {headingPlan,headingFor,projectX,presentationGeometry,canonicalAxis,characterFacing} from '../games/rare-rush/twist/presentation.ts';
import {transitionGeometry} from '../games/rare-rush/twist/transition-motion.ts';


type Frame={tick:number;pace:Pace;jump:boolean;slide:boolean};
const recordings=new WeakMap<RunState,Frame[]>();
function createRecordedRun(seed:string,mode:'easy'|'normal'|'degen'){
 const run=createRun(seed,mode);recordings.set(run,[]);return run;
}
function stepRecordedRun(run:RunState,dt:number,controls:()=>{axis:Pace;jump:boolean;slide:boolean}){
 const input=controls();
 recordings.get(run)!.push({tick:run._tick,pace:input.axis,jump:input.jump,slide:input.slide});
 setSliding(run,input.slide);setPace(run,input.axis);if(input.jump)jump(run);
 stepRun(run,dt);
}
const replayFor=(run:RunState)=>recordings.get(run)!;

const near=(a:number,b:number,message='geometry joins')=>assert(Math.abs(a-b)<1e-7,`${message}: ${a} != ${b}`);
const modes=['easy','normal','degen'] as const;
const seedFor=(n:number)=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const comparisonSeeds={easy:[0,3],normal:[0,2],degen:[1,4]};
for(const mode of modes)for(const n of comparisonSeeds[mode]){
 const seed=seedFor(n);
 test(`${mode} reverse exits preserve collision results, timing and canonical inputs (${seed.slice(-4)})`,()=>{
  const original=createRecordedRun(seed,mode),mirrored=createRecordedRun(seed,mode);
  const transitions=new Set<string>(),sides=new Map<number,number>();
  while(mirrored.status==='running'){
   const before=JSON.stringify(mirrored),heading=headingFor(mirrored);
   const tr=mirrored.transition;
   if(tr){
    const fromHeading=headingFor(mirrored,mirrored._phaseIndex-1);
    const first=presentationGeometry({...tr,progress:0},fromHeading,heading);
    const last=presentationGeometry({...tr,progress:1},fromHeading,heading);
    near(first.player.x,projectX(tr.fromPlayer.x,tr.fromPlayer.w,tr.from,fromHeading));near(first.player.y,tr.fromPlayer.y);
    near(last.player.x,projectX(tr.toPlayer.x,tr.toPlayer.w,tr.to,heading));near(last.player.y,tr.toPlayer.y);
    const ordinary=presentationGeometry(tr,1,1),baseline=transitionGeometry(tr);
    near(ordinary.player.x,baseline.player.x);near(ordinary.player.y,baseline.player.y);
    transitions.add(`${tr.from}-${tr.to}`);
    characterFacing(mirrored);
   }else if(mirrored.phase==='side')sides.set(mirrored._phaseIndex,heading);
   assert.equal(JSON.stringify(mirrored),before,'projection must never mutate verified state');
   stepRecordedRun(original,FIXED_STEP,()=>demoControls(original));
   stepRecordedRun(mirrored,FIXED_STEP,()=>{
    const input=demoControls(mirrored),h=headingFor(mirrored);
    const screen=canonicalAxis(input.axis,mirrored.phase,h);
    return {...input,axis:canonicalAxis(screen,mirrored.phase,h)};
   });
  }
  assert.deepEqual(mirrored,original);assert.deepEqual(replayFor(mirrored),replayFor(original));
  assert.deepEqual([...sides.values()],headingPlan(mirrored));
  assert.equal(transitions.size,4);

 });
}
test('surprises remain occasional, start right, and scale with difficulty',()=>{
 const frequencies:number[]=[];
 for(const mode of modes){
  let reversed=0,lateNormal=0,earlyNormal=0;
  const patterns=new Set<string>();
  for(let n=0;n<512;n++){
   const run=createRecordedRun(seedFor(n),mode),before=JSON.stringify(run),plan=headingPlan(run);
   assert.equal(JSON.stringify(run),before,'planning does not consume game randomness');
   assert.equal(plan[0],1);assert(Object.isFrozen(plan));
   const left=plan.filter(h=>h===-1).length;
   assert(left<=(mode==='degen'?2:1));
   if(mode==='easy')assert(plan.slice(0,-1).every(h=>h===1),'Easy saves reversals for its final corridor');
   if(mode==='degen')assert.notDeepEqual(plan,[1,-1,1,-1],'avoid predictable every-exit ping-pong');
   if(left)reversed++;
   if(mode==='normal'){if(plan[1]===-1)earlyNormal++;if(plan.at(-1)===-1)lateNormal++;}
   patterns.add(plan.join(','));
   // Actual shaft contact adjusts entry times. Neither this nor recreating a
   // replay can change its cosmetic plan or consume the physics RNG.
   const replay=structuredClone(run);
   for(const section of replay.phasePlan){section.start+=.37;section.end+=.37;}
   assert.deepEqual(headingPlan(replay),plan);
   for(let index=0;index<run.phasePlan.length;index++){
    assert.equal(headingFor(run,index,false),1,'Original comparison stays right');
    if(run.phasePlan[index].phase!=='side')assert.equal(headingFor(run,index),headingFor(run,index-1));
   }
  }
  const expected=mode==='easy'?.35:mode==='normal'?.65:.90;
  assert(Math.abs(reversed/512-expected)<.08,`${mode}: ${reversed}/512 surprise routes`);
  assert(patterns.has(mode==='degen'?'1,1,1,1':'1,1,1'),'some routes stay entirely right');
  assert(patterns.size>1,'other routes contain a surprise');
  if(mode==='normal')assert(lateNormal>earlyNormal,'Normal favors a later surprise');
  frequencies.push(reversed/512);
 }
 assert(frequencies[0]<frequencies[1]&&frequencies[1]<frequencies[2]);
});
test('screen-relative controls accelerate toward left and keep shaft steering literal',()=>{
 assert.equal(canonicalAxis(-1,'side',-1),1);assert.equal(canonicalAxis(1,'side',-1),-1);
 for(const phase of ['up','down'] as const){assert.equal(canonicalAxis(-1,phase,-1),-1);assert.equal(canonicalAxis(1,phase,-1),1);}
});
