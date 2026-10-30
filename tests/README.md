# Browser tests (headless Chromium via Playwright)

Run with the web folder served on port 8766 (`cd web && python3 -m http.server 8766`).
Each script takes a work directory as its only argument.

| Script | Checks | Needs in the work directory |
|---|---|---|
| `camtest.js` | Camera mode: page loads, live view, drag, one-tap recording produces a video file | `room.y4m` (a portrait room video used as the fake camera) |
| `gyrotest.js` | Phone turning/tilting keeps the creator fixed in the room (on-screen shift matches the geometry) | `room.y4m` |
| `xrtest.js` | Floor AR (WebXR): session starts, floor found, tap places the creator, they stay put when you walk | `xr/iwer-bundle.js`: build `iwer-entry.js` with esbuild after `npm i iwer @iwer/sem esbuild` |

These run in an emulator, not on a phone: they catch broken code, not how it feels.
