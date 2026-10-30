// Feeds synthetic phone-orientation readings and checks the creator stays fixed in the room.
const { chromium } = require('playwright');
const S = process.argv[2];
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-video-capture=${S}/room.y4m`] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['camera'] });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8766/ar/?occ=birthday');
  await p.waitForFunction(() => !document.getElementById('start').disabled);
  await p.click('#start');
  await p.waitForFunction(() => window.__moments);

  const send = (alpha, beta, gamma) => p.evaluate(([a, b, g]) =>
    window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: a, beta: b, gamma: g, absolute: false })), [alpha, beta, gamma]);
  // Where the creator's chest (1.0 m up, at their position) lands on screen, in CSS px.
  const where = () => p.evaluate(() => {
    const { THREE, camera, creator } = window.__moments;
    const v = new THREE.Vector3(creator.position.x, 1.0, creator.position.z).project(camera);
    return { x: Math.round((v.x + 1) / 2 * innerWidth), y: Math.round((1 - v.y) / 2 * innerHeight), inFront: v.z < 1 };
  });
  const settle = async (a, b, g) => { for (let i = 0; i < 25; i++) { await send(a, b, g); await p.waitForTimeout(40); } };

  const A0 = 120;  // arbitrary compass heading when the experience starts
  const cases = [
    ['upright, facing them      ', A0, 90, 0],
    ['turn right 10°            ', A0 - 10, 90, 0],
    ['turn right 20°            ', A0 - 20, 90, 0],
    ['turn left 10°             ', A0 + 10, 90, 0],
    ['tilt down 10°             ', A0, 80, 0],
    ['tilt up 10°               ', A0, 100, 0],
    ['roll right 10°            ', A0, 90, 10],
    ['turn around 180°          ', A0 - 180, 90, 0],
  ];
  const f = (844 / 2) / Math.tan(31 * Math.PI / 180);  // focal length in px for a 62° vertical view
  console.log('expected shift for 10° ≈', Math.round(f * Math.tan(10 * Math.PI / 180)), 'px');
  for (const [label, a, bb, g] of cases) {
    await settle(a, bb, g);
    const w = await where();
    console.log(label, JSON.stringify(w));
    if (label.startsWith('upright') || label.startsWith('turn right 20')) await p.screenshot({ path: `${S}/gyro-${a}.png` });
  }
  console.log('errors:', errs);
  await b.close();
})();
