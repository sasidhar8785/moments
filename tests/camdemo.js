// Screen-records the camera mode: open camera, she appears, drag her, record a moment.
const { chromium } = require('playwright');
const fs = require('fs');
const S = process.argv[2];
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-video-capture=${S}/room.y4m`] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['camera'],
    recordVideo: { dir: `${S}/vid-cam`, size: { width: 390, height: 844 } } });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:8766/ar/?occ=birthday');
  await p.waitForFunction(() => !document.getElementById('start').disabled);
  await p.fill('#name', 'Priya');
  await p.waitForTimeout(1200);
  // Phone held upright and steady, as a real gyroscope would report.
  await p.evaluate(() => setInterval(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',
    { alpha: 120, beta: 88, gamma: 0 })), 50));
  await p.click('#start');
  await p.waitForTimeout(3500);
  await p.mouse.move(195, 640); await p.mouse.down();
  await p.mouse.move(110, 600, { steps: 20 }); await p.mouse.move(250, 620, { steps: 25 }); await p.mouse.up();
  await p.waitForTimeout(1200);
  await p.click('#rec');
  await p.waitForSelector('#result:not([hidden])', { timeout: 40000 });
  await p.waitForTimeout(2500);
  const v = p.video();
  await ctx.close();
  fs.copyFileSync(await v.path(), `${S}/preview-camera.webm`);
  await b.close();
})();
