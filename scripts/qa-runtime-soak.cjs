/* Foreground Edge rendering, actual keyboard events, Web Audio diagnostics and
 * menu-churn soak. Uses isolated storage and an owned local production server. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const pw=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/runtime-soak');
fs.mkdirSync(out,{recursive:true});
const report={startedAt:new Date().toISOString(),mode:'headed',samples:[],diagnostics:[],audio:[],actions:0};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const action=(page,name)=>page.locator(`[data-action="${name}"]:visible`).first();
const screen=(page,name)=>page.waitForSelector(`#ui-root[data-screen="${name}"]`,{state:'attached'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser,page;
async function sample(label,frames=600){
  const data=await page.evaluate(async frames=>{
    let previous=performance.now();const values=[];
    await new Promise(resolve=>{const tick=now=>{values.push(now-previous);previous=now;if(values.length<frames)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});
    values.shift();values.sort((a,b)=>a-b);
    return {frames:values.length,medianMs:values[Math.floor(values.length*.5)],p95Ms:values[Math.floor(values.length*.95)],p99Ms:values[Math.floor(values.length*.99)],over50ms:values.filter(v=>v>50).length,canvases:[...document.querySelectorAll('canvas')].map(c=>({id:c.id,width:c.width,height:c.height})),screen:document.querySelector('#ui-root').dataset.screen};
  },frames);
  report.samples.push({label,...data});save();console.log('SAMPLE '+label+' '+JSON.stringify(data));return data;
}
(async()=>{
  try{
    const port=8784,base=`http://127.0.0.1:${port}/`;let ready=false,serverError='';
    server=spawn(process.execPath,[path.join(root,'scripts/serve.mjs'),'--port',String(port),'--root',path.join(root,'dist')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    server.stdout.on('data',d=>{if(String(d).includes('Local:'))ready=true;});server.stderr.on('data',d=>serverError+=String(d));
    for(let i=0;i<100&&!ready&&server.exitCode===null;i++)await sleep(50);assert(ready,serverError);
    browser=await pw.chromium.launch({headless:false,executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--window-size=1340,860']});
    report.browser=browser.version();
    const browserSession=await browser.newBrowserCDPSession(),system=await browserSession.send('SystemInfo.getInfo');
    report.gpu={devices:system.gpu.devices,features:system.gpu.featureStatus};
    const ctx=await browser.newContext({viewport:{width:1280,height:720}});page=await ctx.newPage();page.setDefaultTimeout(10000);
    page.on('pageerror',e=>report.diagnostics.push({type:'pageerror',message:e.message}));
    page.on('console',m=>{if(['warning','error'].includes(m.type()))report.diagnostics.push({type:m.type(),message:m.text()});});
    page.on('response',r=>{if(r.status()>=400)report.diagnostics.push({type:'http',url:r.url(),status:r.status()});});
    const session=await ctx.newCDPSession(page);await session.send('WebAudio.enable');
    session.on('WebAudio.contextCreated',e=>report.audio.push(e.context));
    session.on('WebAudio.contextChanged',e=>{const index=report.audio.findIndex(c=>c.contextId===e.context.contextId);if(index>=0)report.audio[index]=e.context;});
    await page.goto(base,{waitUntil:'networkidle'});await screen(page,'title');await page.locator('.loading-screen').waitFor({state:'hidden'});
    await action(page,'chapter-select').click();await action(page,'demo-select').click();await page.locator('[data-action="demo-start"][data-chapter-id="close-hatch"]').click();
    await screen(page,'none');await page.locator('.loading-screen').waitFor({state:'hidden'});await page.bringToFront();
    await page.screenshot({path:path.join(out,'headed-standard.png')});
    console.log('READY headed production gameplay; beginning baseline');save();
    await sample('foreground-standard',1200);
    await session.send('HeapProfiler.collectGarbage');
    report.before={dom:await session.send('Memory.getDOMCounters'),heap:await session.send('Runtime.getHeapUsage')};save();
    const start=Date.now(),duration=Number(process.env.QA_RUNTIME_MS||60000);
    assert(Number.isFinite(duration)&&duration>=10000&&duration<=600000);
    let cycles=0;
    while(Date.now()-start<duration){
      if(cycles%5===0){
        await action(page,'pause').click();await screen(page,'pause');await action(page,'map-open').click();await screen(page,'map');
        await action(page,'overlay-back').click();await screen(page,'pause');await action(page,'resume-play').click();await screen(page,'none');report.actions+=4;
      }
      await page.keyboard.down('d');await page.waitForTimeout(90);await page.keyboard.up('d');
      await page.keyboard.down('a');await page.waitForTimeout(90);await page.keyboard.up('a');report.actions+=4;
      if(cycles%9===0){await page.keyboard.press('Space');report.actions++;}
      cycles++;
      if(cycles%50===0){console.log('SOAK '+JSON.stringify({cycles,actions:report.actions,elapsedMs:Date.now()-start}));save();}
      assert.equal(await page.locator('#ui-root').getAttribute('data-screen'),'none');
    }
    report.soak={durationMs:Date.now()-start,cycles,actions:report.actions};
    await session.send('HeapProfiler.collectGarbage');report.after={dom:await session.send('Memory.getDOMCounters'),heap:await session.send('Runtime.getHeapUsage')};
    assert(report.after.dom.nodes<=report.before.dom.nodes+64,JSON.stringify({before:report.before.dom,after:report.after.dom}));
    assert(report.after.dom.jsEventListeners<=report.before.dom.jsEventListeners+5,'Event listeners accumulated');
    for(const context of report.audio)if(context.contextType==='realtime')context.realtime=await session.send('WebAudio.getRealtimeData',{contextId:context.contextId});
    assert(report.audio.some(a=>a.contextState==='running'),'No running real Web Audio context after user input');
    await sample('foreground-after-soak',1200);
    await action(page,'pause').click();await action(page,'settings-open').click();await page.locator('[data-tab="system"]').click();
    await page.locator('[data-setting="quality"]').selectOption('low');await action(page,'settings-back').click();await screen(page,'pause');await action(page,'resume-play').click();await screen(page,'none');
    await page.screenshot({path:path.join(out,'headed-low.png')});await sample('foreground-low',600);
    assert.deepEqual(report.diagnostics,[]);report.status='passed';
  }catch(error){report.status='failed';report.error=error.stack;console.error(error.stack);if(page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
  finally{if(browser)await browser.close();if(server)server.kill();report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,actions:report.actions,report:path.join(out,'report.json')}));if(report.status!=='passed')process.exitCode=1;}
})();
