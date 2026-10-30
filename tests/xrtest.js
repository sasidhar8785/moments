const { chromium } = require('playwright');
const fs = require('fs');
const S = process.argv[2];
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript({ content: fs.readFileSync(`${S}/xr/iwer-bundle.js`, 'utf8') });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (['error','warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text().slice(0, 200)); });
  await p.goto('http://127.0.0.1:8766/ar/?occ=birthday');
  await p.waitForFunction(() => !document.getElementById('start').disabled);
  console.log('AR button visible:', await p.isVisible('#startXR'));
  await p.evaluate(() => window.__loadRoom());
  // Stand in the room at phone height, looking 40° down at the floor.
  await p.evaluate(() => {
    const d = window.__xrDevice;
    d.position.set(0, 1.4, 0);
    const a = -40 * Math.PI / 180;
    d.quaternion.set(Math.sin(a / 2), 0, 0, Math.cos(a / 2));
  });
  await p.evaluate(() => {
    const orig = navigator.xr.requestSession.bind(navigator.xr);
    navigator.xr.requestSession = async (...a) => { const s = await orig(...a); window.__sess = s; window.__ev = [];
      for (const t of ['selectstart','select','selectend','inputsourceschange']) s.addEventListener(t, (e) => window.__ev.push(t + ':' + (e.inputSource ? e.inputSource.handedness + '/' + e.inputSource.targetRayMode : (e.added||[]).map(i => i.handedness + '/' + i.targetRayMode).join(','))));
      return s; };
  });
  await p.click('#startXR');
  await p.waitForTimeout(3000);
  const st = () => p.evaluate(() => ({ hint: document.getElementById('hint').textContent,
    session: !!navigator.xr && document.getElementById('setup').hidden }));
  console.log('after start:', JSON.stringify(await st()));
  await p.screenshot({ path: `${S}/xr-1-findfloor.png` });
  // Tap = controller trigger press and release.
  for (const hand of ['right', 'left']) {
    const c = await p.evaluate((h) => !!window.__xrDevice.controllers[h], hand);
    if (!c) continue;
    await p.evaluate((h) => window.__xrDevice.controllers[h].updateButtonValue('trigger', 1), hand);
    await p.waitForTimeout(300);
    await p.evaluate((h) => window.__xrDevice.controllers[h].updateButtonValue('trigger', 0), hand);
    await p.waitForTimeout(300);
  }
  await p.waitForTimeout(2500);
  console.log('events:', JSON.stringify(await p.evaluate(() => window.__ev)));
  console.log('inputSources:', JSON.stringify(await p.evaluate(() => [...window.__sess.inputSources].map(i => [i.handedness, i.targetRayMode, i.gamepad && i.gamepad.buttons.length]))));
  console.log('state:', JSON.stringify(await p.evaluate(() => { const m = window.__moments; const c = window.__moments.renderer.xr.getController(0);
    return { creatorVisible: m.creator.visible, creatorPos: m.creator.position.toArray().map(v => +v.toFixed(2)), reticleVisible: m.reticle.visible,
             reticlePos: new m.THREE.Vector3().setFromMatrixPosition(m.reticle.matrix).toArray().map(v => +v.toFixed(2)),
             stats: m.stats }; })));
  console.log('after tap:', JSON.stringify(await st()));
  await p.screenshot({ path: `${S}/xr-2-placed.png` });
  // Walk 1 m to the side and look back: they should stay where they were placed.
  await p.evaluate(() => {
    const d = window.__xrDevice;
    d.position.set(1.0, 1.4, 0);
    const yaw = 25 * Math.PI / 180, pitch = -30 * Math.PI / 180;
    // yaw then pitch
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
  });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${S}/xr-3-walked.png` });
  console.log('errors:', errs.slice(0, 15));
  await b.close();
})();
