// Screen-records the floor-AR mode in the WebXR emulator while "walking" around the creator.
const { chromium } = require('playwright');
const fs = require('fs');
const S = process.argv[2];
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, recordVideo: { dir: `${S}/vid-xr`, size: { width: 390, height: 844 } } });
  await ctx.addInitScript({ content: fs.readFileSync(`${S}/xr/iwer-bundle.js`, 'utf8') });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:8766/ar/?occ=birthday');
  await p.waitForFunction(() => !document.getElementById('start').disabled);
  await p.waitForTimeout(1200);
  await p.evaluate(() => {
    window.__loadRoom();
    // Pose helper: stand at (x, 1.4, z) looking at a point.
    window.__look = (x, z, tx, ty, tz) => {
      const d = window.__xrDevice;
      d.position.set(x, 1.4, z);
      let fx = tx - x, fy = ty - 1.4, fz = tz - z;
      const n = Math.hypot(fx, fy, fz); fx /= n; fy /= n; fz /= n;
      const yaw = Math.atan2(-fx, -fz), pitch = Math.asin(fy);
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
      d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    };
    window.__look(0, 0, 0, 0, -1.67);  // looking down at the floor spot
  });
  await p.click('#startXR');
  await p.waitForFunction(() => window.__moments && window.__moments.reticle.visible, null, { timeout: 20000 });
  await p.waitForTimeout(1200);
  await p.evaluate(() => window.__xrDevice.controllers.right.updateButtonValue('trigger', 1));
  await p.waitForTimeout(200);
  await p.evaluate(() => window.__xrDevice.controllers.right.updateButtonValue('trigger', 0));
  await p.waitForFunction(() => window.__moments.creator.visible, null, { timeout: 5000 });
  // Ease the view up from the floor to her.
  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    await p.evaluate((ty) => window.__look(0, 0, 0, ty, -1.67), t * 1.0);
    await p.waitForTimeout(50);
  }
  await p.waitForTimeout(1500);
  // Walk in an arc around her: 2 m away, from straight ahead to 70° right, back, and 70° left.
  const T = [0, 1.0, -1.67], R = 1.9;
  const path = [];
  for (let i = 0; i <= 60; i++) path.push(70 * Math.sin(i / 60 * Math.PI / 2));
  for (let i = 0; i <= 120; i++) path.push(70 * Math.cos(i / 120 * Math.PI));
  for (let i = 0; i <= 60; i++) path.push(-70 * Math.cos(i / 60 * Math.PI / 2));
  for (const deg of path) {
    const a = deg * Math.PI / 180;
    await p.evaluate(([x, z, tx, ty, tz]) => window.__look(x, z, tx, ty, tz),
      [T[0] + R * Math.sin(a), T[2] + R * Math.cos(a), T[0], T[1], T[2]]);
    await p.waitForTimeout(45);
  }
  await p.waitForTimeout(800);
  const v = p.video();
  await ctx.close();
  fs.copyFileSync(await v.path(), `${S}/preview-floor-ar.webm`);
  await b.close();
})();
