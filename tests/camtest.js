const { chromium } = require('playwright');
const fs = require('fs');
const S = process.argv[2];
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-video-capture=${S}/room.y4m`] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['camera'] });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  await p.goto('http://127.0.0.1:8766/ar/?name=Priya&occ=birthday');
  await p.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 20000 });
  await p.screenshot({ path: `${S}/m0-setup.png` });
  await p.click('#start');
  await p.waitForTimeout(400); await p.screenshot({ path: `${S}/m1-reveal.png` });
  await p.waitForTimeout(2500); await p.screenshot({ path: `${S}/m2-live.png` });
  // drag to the right
  await p.mouse.move(195, 700); await p.mouse.down(); await p.mouse.move(300, 640, { steps: 5 }); await p.mouse.up();
  await p.waitForTimeout(500); await p.screenshot({ path: `${S}/m3-moved.png` });
  await p.click('#rec');
  await p.waitForSelector('#result:not([hidden])', { timeout: 40000 });
  await p.screenshot({ path: `${S}/m4-result.png` });
  const info = await p.evaluate(async () => { const f = window.__lastRecording; const buf = new Uint8Array(await f.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { name: f.name, type: f.type, size: f.size, b64: btoa(s) }; });
  fs.writeFileSync(`${S}/${info.name}`, Buffer.from(info.b64, 'base64'));
  console.log('recording', info.name, info.type, info.size);
  console.log('errors:', errs);
  await b.close();
})();
