import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildPetSite, createPetServer } from './pet-site.mjs';

const outdir = await mkdtemp(path.join(tmpdir(), 'rarepet-gif-'));
const artifact = path.resolve('artifacts/share-gif');
await mkdir(artifact, { recursive: true });
let server, browser;
const errors = [], external = [], downloads = [];
try {
  await buildPetSite({ outdir });
  server = createPetServer(outdir);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    if (url.origin === 'https://x.com' && url.pathname === '/intent/tweet') return route.fulfill({ contentType: 'text/html', body: 'Intercepted X composer. No post sent.' });
    external.push(url.href); return route.abort();
  });
  await context.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.gifQA = { created: 0, terminated: 0, svgs: [], wallet: [] };
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); window.gifQA.created++; }
      terminate() { window.gifQA.terminated++; return super.terminate(); }
    };
    const serialize = XMLSerializer.prototype.serializeToString;
    XMLSerializer.prototype.serializeToString = function(node) {
      const markup = serialize.call(this, node);
      if (node.querySelector?.('[data-share-slot="friend"]')) {
        window.gifQA.svgs.push({ body: node.querySelector('[data-genesis-body]')?.getAttribute('data-genesis-body'), classic: node.querySelector('[data-classic-island]')?.getAttribute('data-classic-island'), world: !!node.querySelector('[data-world-preset]') });
      }
      return markup;
    };
    window.ethereum = { on(){},removeListener(){},async request({method}) {
      window.gifQA.wallet.push(method);
      if(method==='eth_accounts') return []; if(method==='eth_chainId') return '0x1237';
      throw new Error('Sharing must not request '+method);
    }};
  });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  const share = () => page.getByRole('dialog', { name: 'A moment worth sharing.' });
  async function open() { await page.getByRole('button', { name: 'Share your Rare Friend on X' }).click(); await share().getByRole('button', { name: 'DOWNLOAD PNG' }).waitFor(); }
  async function ready(format='GIF') { const button=share().getByRole('button',{name:`DOWNLOAD ${format}`,exact:true});await page.waitForFunction(() => {const b=document.querySelector('.share-download');return b&&!b.disabled});await share().locator('.share-image img').evaluate(img=>img.decode());assert(await button.isEnabled()); }
  async function fits(root) {assert(await root.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'no dialog overflow');assert(await page.evaluate(()=>document.body.scrollWidth<=innerWidth+1),'no page overflow');}
  async function choose(collection) {
    await page.getByRole('button',{name:/CHOOSE FRIEND/}).click();const picker=page.locator('.friend-picker-dialog');
    assert.equal(await picker.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(0, 0, 0)');
    await picker.getByRole('button',{name:'PREVIEW FRIENDS',exact:true}).click();await picker.getByRole('button',{name:collection,exact:true}).click();await fits(picker);
    await picker.screenshot({path:path.join(artifact,`picker-${collection}-${page.viewportSize().width}.png`)});
    await picker.locator('.preview-picker button').first().click();
  }
  await page.goto(origin);await page.getByRole('heading',{name:'My RarePet.'}).waitFor();await page.evaluate(()=>document.fonts.ready);
  for(const width of [1440,390,320]) {
    await page.setViewportSize({width,height:1050});
    const metrics=await page.locator('.friend-status-actions').evaluate(el=>{
      const label=getComputedStyle(el.querySelector('.friend-status')),button=getComputedStyle(el.querySelector('.habitat-share-button')),icon=el.querySelector('.habitat-share-button svg').getBoundingClientRect();
      return {label:[label.fontSize,label.fontWeight,label.padding,label.letterSpacing],button:[button.fontSize,button.fontWeight,button.padding,button.letterSpacing],background:button.backgroundColor,border:button.borderTopColor,icon:icon.width,labelHeight:el.querySelector('.friend-status').getBoundingClientRect().height,buttonHeight:el.querySelector('button').getBoundingClientRect().height};
    });
    assert.deepEqual(metrics.button,metrics.label,'share typography and padding match greeting exactly');assert.equal(metrics.background,'rgba(0, 0, 0, 0)');assert.equal(metrics.border,'rgb(204, 255, 0)');assert.equal(metrics.icon,parseInt(metrics.label[0]));assert.equal(metrics.buttonHeight,metrics.labelHeight);
    await page.locator('.habitat-heading').screenshot({path:path.join(artifact,`share-label-${width}.png`)});
    await choose('Generations');
  }
  await page.goto(origin+'/launch/');await page.locator('.launch-page-card').waitFor();
  assert.equal(await page.locator('.launch-page-card').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(0, 0, 0)');
  assert.equal(await page.locator('.launch-primary').evaluate(el=>getComputedStyle(el).color),'rgb(0, 0, 0)','lime primary buttons use readable black text');
  await page.screenshot({path:path.join(artifact,'launch-dark-320.png'),fullPage:true});
  await page.goto(origin);await page.getByRole('heading',{name:'My RarePet.'}).waitFor();
  await page.setViewportSize({width:1440,height:1050});
  for(const collection of ['Generations','Genesis']) {
    await choose(collection);
    if(collection==='Genesis') {await page.getByRole('button',{name:/CHANGE BODY/}).click();await page.getByRole('button',{name:'Classic',exact:true}).click();await page.getByRole('button',{name:'Rare',exact:true}).click();}
    const body=collection==='Genesis'?await page.locator('.pet-portrait [data-genesis-body]').getAttribute('data-genesis-body'):null;
    await open();await ready('PNG');await share().getByRole('button',{name:'ANIMATED GIF',exact:true}).click();
    const storage=await page.evaluate(()=>JSON.stringify(localStorage));
    for(const action of ['Pet','Feed','Poop']) {
      await share().getByRole('button',{name:action,exact:true}).click();const started=Date.now();await ready();await fits(share());
      const event=page.waitForEvent('download');await share().getByRole('button',{name:'DOWNLOAD GIF',exact:true}).click();const file=await event;
      assert.equal(await file.failure(),null);assert.match(file.suggestedFilename(),new RegExp(`^rarepet-${collection.toLowerCase()}-.*-${action.toLowerCase()}-800\\.gif$`));
      const name=`${collection.toLowerCase()}-${action.toLowerCase()}`,filePath=path.join(artifact,`${name}.gif`);await file.saveAs(filePath);const bytes=await readFile(filePath);
      assert.equal(bytes.subarray(0,6).toString(),'GIF89a');assert.equal(bytes.readUInt16LE(6),800);assert.equal(bytes.readUInt16LE(8),800);assert(bytes.length>15000&&bytes.length<5*1024*1024,'detailed GIF stays under5MiB');assert.equal(bytes.at(-1),0x3b,'completed stream');
      const decoded=await share().locator('.share-image img').evaluate(async img=>{
        const data=await (await fetch(img.src)).arrayBuffer();const decoder=new ImageDecoder({data,type:'image/gif'});await decoder.tracks.ready;
        const track=decoder.tracks.selectedTrack;const canvas=document.createElement('canvas');canvas.width=canvas.height=800;const ctx=canvas.getContext('2d');
        const sheet=document.createElement('canvas');sheet.width=sheet.height=1600;const sc=sheet.getContext('2d');const hashes=[],timing=[],coverage=[];
        for(let i=0;i<track.frameCount;i++){const {image}=await decoder.decode({frameIndex:i});ctx.drawImage(image,0,0);timing.push(image.duration);image.close();const pixels=ctx.getImageData(0,0,800,800).data;let hash=2166136261,lit=0;for(let p=0;p<pixels.length;p+=4){hash=Math.imul(hash^pixels[p]^pixels[p+1]^pixels[p+2],16777619);if(pixels[p]+pixels[p+1]+pixels[p+2]>60)lit++;}hashes.push(hash);coverage.push(lit);if(i%12===0)sc.drawImage(canvas,(i/12%2)*800,Math.floor(i/24)*800);}
        const result={count:track.frameCount,repeat:track.repetitionCount===Infinity?'infinite':track.repetitionCount,hashes,timing,minLit:Math.min(...coverage),sheet:sheet.toDataURL('image/png')};decoder.close();return result;
      });
      assert.equal(decoded.count,48);assert.equal(decoded.repeat,'infinite');assert.equal(new Set(decoded.timing).size,1);assert.equal(decoded.timing[0],50000);assert(new Set(decoded.hashes).size>=32,'genuinely moving frames');assert(decoded.minLit>15000,'art and speech remain visible throughout');
      await writeFile(path.join(artifact,`${name}-frames.png`),Buffer.from(decoded.sheet.split(',')[1],'base64'));
      if(body) assert.equal(await page.evaluate(()=>window.gifQA.svgs.at(-1).body),body,'selected Genesis body preserved');
      assert.equal(await page.evaluate(()=>JSON.stringify(localStorage)),storage,'GIF does not mutate care/preferences');
      downloads.push({name,bytes:bytes.length,renderMs:Date.now()-started,frames:decoded.count});console.log(`${name}: ${bytes.length} bytes,48 decoded frames,800px,2.4s loop`);
    }
    // X gets the selected GIF rather than silently reverting to PNG.
    const event=page.waitForEvent('download'),popupEvent=page.waitForEvent('popup');await share().getByRole('link',{name:'DOWNLOAD + SHARE ON X'}).click();const[file,popup]=await Promise.all([event,popupEvent]);assert(file.suggestedFilename().endsWith('.gif'));await popup.waitForLoadState();await popup.close();
    await share().getByRole('button',{name:'Close sharing'}).click();
  }
  await open();await ready('PNG');await share().getByRole('button',{name:'ANIMATED GIF',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.share-image')?.textContent?.match(/GIF.*[1-9]/));
  await share().getByRole('button',{name:'STILL PNG',exact:true}).click();await ready('PNG');await page.waitForTimeout(250);assert.match(await share().locator('.share-image-meta').innerText(),/2000 × 2000 PNG/);
  await share().getByRole('button',{name:'ANIMATED GIF',exact:true}).click();await share().getByRole('button',{name:'Close sharing'}).click();
  await page.waitForFunction(()=>window.gifQA.created===window.gifQA.terminated);
  await page.route('**/share-gif-worker.js',route=>route.fulfill({contentType:'application/javascript',body:'throw new Error("Fixture worker startup failure")'}));
  await open();await share().getByRole('button',{name:'ANIMATED GIF',exact:true}).click();await share().getByRole('alert').waitFor();
  assert(await share().getByRole('button',{name:'DOWNLOAD GIF',exact:true}).isDisabled());
  await page.unroute('**/share-gif-worker.js');await share().getByRole('button',{name:'TRY AGAIN',exact:true}).click();await ready();await share().getByRole('button',{name:'Close sharing'}).click();
  await page.setViewportSize({width:320,height:900});await open();await share().getByRole('button',{name:'ANIMATED GIF',exact:true}).click();await ready();await fits(share());await share().screenshot({path:path.join(artifact,'share-gif-320.png')});await share().getByRole('button',{name:'Close sharing'}).click();
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert((await page.evaluate(()=>window.gifQA.wallet)).every(method=>['eth_accounts','eth_chainId'].includes(method)));
  await writeFile(path.join(artifact,'results.json'),JSON.stringify(downloads,null,2));
  // Preserve the entire existing2000px still-image regression with this exact build.
  if (!process.argv.includes('--gif-only')) await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/test-pet-share.mjs'],{stdio:'inherit',env:{...process.env,RAREPET_TEST_URL:origin}});child.on('exit',code=>code===0?resolve():reject(new Error(`PNG regression exited ${code}`)));child.on('error',reject)});
  console.log('GIF actions/decoding/downloads/cancellation, dark picker, exact badge styling passed; PNG regression runs unless --gif-only is supplied.');
} finally {
  await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(outdir,{recursive:true,force:true});
}
