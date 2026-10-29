// Moments AR: a creator's real, cut-out video standing in the fan's room.
//
// Two modes:
//  - Camera mode (every phone, iPhone included): live rear camera, the creator stands in front,
//    held in place by the gyroscope; one tap records the moment to a shareable video.
//  - Floor AR (Chrome on Android, WebXR): the creator is anchored to the detected floor.
//
// Clips are "stacked alpha" MP4s (colour on top, mask below) made by prep_ar.py.

import * as THREE from "./vendor/three.module.min.js";

const params = new URLSearchParams(location.search);
const creatorId = params.get("c") || "presenter";
const base = `creators/${creatorId}/`;
const $ = (id) => document.getElementById(id);

const manifest = await (await fetch(base + "manifest.json")).json();
$("title").textContent = `${manifest.display_name}, in your room`;
$("sub").textContent = "Point your camera at your room. They'll appear in front of you, say hi and play your message, and you can record it.";
for (const [key, label] of Object.entries(manifest.occasions)) $("occasion").add(new Option(label, key));
if (params.get("name")) $("name").value = params.get("name");
if (params.get("occ")) $("occasion").value = params.get("occ");

const xrSupported = !!(navigator.xr && await navigator.xr.isSessionSupported("immersive-ar").catch(() => false));
$("startXR").hidden = !xrSupported;
$("note").textContent = xrSupported
  ? "Floor AR pins them to your floor; record it with your phone's screen recorder."
  : "";
$("start").disabled = false;

// ------------------------------------------------------------------ clip playlist

const video = document.createElement("video");
video.playsInline = true;
video.crossOrigin = "anonymous";
video.preload = "auto";

function playlist() {
  // A fan-typed name only selects a clip the creator recorded; anything else gets the generic one.
  const key = $("name").value.trim().toLowerCase().replace(/[^a-z]/g, "");
  const nameClip = manifest.names.includes(key) ? `names/${key}.mp4` : "names/_generic.mp4";
  return [base + nameClip, base + `occasions/${$("occasion").value}.mp4`];
}

let queue = [];
let onPlaylistEnd = null;
function playFrom(list) {
  queue = list.slice(1);
  video.src = list[0];
  return video.play();
}
video.addEventListener("ended", () => {
  if (queue.length) { video.src = queue.shift(); video.play(); return; }
  onPlaylistEnd?.();
});

// ------------------------------------------------------------------ the creator, as a hologram

const texture = new THREE.VideoTexture(video);
texture.minFilter = THREE.LinearFilter;
texture.generateMipmaps = false;

const H = manifest.height_m;           // visible height of the person in the clip
const W = H * manifest.aspect;
const BASE = manifest.base_m || 0;      // clips cut above the feet float this high
const FADE = BASE > 0 ? 0.16 : 0.0;     // ...and dissolve into the light at the bottom

const bodyMaterial = new THREE.ShaderMaterial({
  uniforms: {
    map: { value: texture },
    brightness: { value: 1.0 },
    reveal: { value: 0.0 },
    fade: { value: FADE },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D map;
    uniform float brightness, reveal, fade;
    varying vec2 vUv;
    void main() {
      vec3 colour = texture2D(map, vec2(vUv.x, 0.5 + vUv.y * 0.5)).rgb;  // top half
      float a = texture2D(map, vec2(vUv.x, vUv.y * 0.5)).r;             // bottom half = mask
      if (fade > 0.0) a *= smoothstep(0.0, fade, vUv.y);
      // Materialise from the base upward, with a bright edge on the way.
      float edge = reveal * 1.1 - vUv.y;
      a *= smoothstep(0.0, 0.04, edge);
      vec3 glow = vec3(0.75, 0.9, 1.0) * (1.0 - smoothstep(0.0, 0.08, edge)) * step(reveal, 0.999);
      if (a < 0.01) discard;
      gl_FragColor = vec4((colour * brightness + glow) * a, a);         // premultiplied
    }`,
  transparent: true,
  premultipliedAlpha: true,
  depthWrite: false,
});

function radialTexture(stops) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [at, colour] of stops) grad.addColorStop(at, colour);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

const creator = new THREE.Group();
// The pivot turns to face the viewer; inside it the clip is shifted so the person's legs
// (not the middle of the frame) sit over the floor marker.
const body = new THREE.Group();
const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), bodyMaterial);
plane.position.set((0.5 - (manifest.anchor_x ?? 0.5)) * W, BASE + H / 2, 0);
body.add(plane);
creator.add(body);

// Soft contact shadow.
const shadow = new THREE.Mesh(
  new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({
    map: radialTexture([[0, "rgba(0,0,0,0.5)"], [1, "rgba(0,0,0,0)"]]), transparent: true, depthWrite: false,
  }),
);
shadow.position.y = 0.003;
creator.add(shadow);

// Hologram base: a glowing ring and a faint beam up to where the clip begins.
const ringMat = new THREE.MeshBasicMaterial({
  map: radialTexture([[0, "rgba(140,200,255,0)"], [0.55, "rgba(140,200,255,0.0)"], [0.72, "rgba(190,230,255,0.7)"],
                      [0.8, "rgba(140,200,255,0.35)"], [1, "rgba(140,200,255,0)"]]),
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
const ring = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62).rotateX(-Math.PI / 2), ringMat);
ring.position.y = 0.006;
const beamCanvas = document.createElement("canvas");
beamCanvas.width = 4; beamCanvas.height = 128;
{
  const g = beamCanvas.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, "rgba(160,215,255,0)");
  grad.addColorStop(1, "rgba(160,215,255,0.09)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
}
const beam = new THREE.Mesh(
  new THREE.CylinderGeometry(0.2, 0.24, BASE + H * 0.2, 48, 1, true),
  new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(beamCanvas), transparent: true, depthWrite: false,
                                blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
);
beam.position.y = (BASE + H * 0.2) / 2;
if (BASE > 0) creator.add(ring, beam);

const camPos = new THREE.Vector3();
function faceCamera(camera) {
  camera.getWorldPosition(camPos);
  body.rotation.y = Math.atan2(camPos.x - creator.position.x, camPos.z - creator.position.z);
}

let revealStart = 0;
function animateHologram(now) {
  const t = Math.min((now - revealStart) / 900, 1);
  bodyMaterial.uniforms.reveal.value = t;
  ringMat.opacity = 0.6 + 0.2 * Math.sin(now / 400);
}

// ------------------------------------------------------------------ renderer + scene

const glCanvas = $("gl");
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
scene.add(creator);

// Unlock sound and video inside the user's tap.
async function primeVideo() {
  await playFrom(playlist()).catch(() => {});
  video.pause();
  video.currentTime = 0;
}

function showExperience(on) {
  $("setup").hidden = on;
  $("stage").hidden = !on;
  $("hud").hidden = !on;
}

$("start").addEventListener("click", startCamera);
$("startXR").addEventListener("click", startXR);

// ------------------------------------------------------------------ camera mode (all phones)

const EYE = 1.4;        // phone height above the floor, metres
const DIST = 2.3;       // where the creator first appears
let camStream = null;
let orientation = null; // latest DeviceOrientationEvent values
let yawZero = null;

async function startCamera() {
  $("start").disabled = true;
  // iOS asks for motion permission; it must happen inside the tap.
  const motionAsk = typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission
    ? DeviceOrientationEvent.requestPermission().catch(() => "denied") : Promise.resolve("granted");
  const primed = primeVideo();
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch (e) {
    $("note").textContent = "Camera access is needed. Allow the camera for this site and try again.";
    $("start").disabled = false;
    return;
  }
  if ((await motionAsk) === "granted") {
    addEventListener("deviceorientation", (e) => { if (e.alpha !== null) orientation = e; });
  }
  await primed;

  const cam = $("cam");
  cam.srcObject = camStream;
  await cam.play();
  showExperience(true);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 50);
  camera.position.set(0, EYE, 0);
  creator.position.set(0, 0, -DIST);
  creator.visible = true;

  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    // Phone main cameras see about 62° vertically in portrait, about 48° in landscape.
    camera.fov = camera.aspect < 1 ? 62 : 48;
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener("resize", resize);

  // Drag to move them across the floor.
  const ray = new THREE.Raycaster();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  let dragging = false;
  const moveTo = (e) => {
    const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(floor, hit) && hit.distanceTo(camera.position) < 8) {
      creator.position.set(hit.x, 0, hit.z);
    }
  };
  const stage = $("stage");
  stage.onpointerdown = (e) => { dragging = true; moveTo(e); };
  stage.onpointermove = (e) => { if (dragging) moveTo(e); };
  stage.onpointerup = stage.onpointercancel = () => { dragging = false; };

  const euler = new THREE.Euler();
  const q = new THREE.Quaternion();
  const screenTilt = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // camera looks out of the back
  const zee = new THREE.Vector3(0, 0, 1);
  const lightProbe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  lightProbe.canvas.width = lightProbe.canvas.height = 8;
  let lastProbe = 0;

  revealStart = performance.now();
  playFrom(playlist());

  renderer.setAnimationLoop((now) => {
    if (orientation) {
      // Standard device-orientation to camera rotation, with the first heading as "straight ahead".
      const deg = THREE.MathUtils.DEG2RAD;
      if (yawZero === null) yawZero = orientation.alpha;
      const screenAngle = (screen.orientation?.angle ?? window.orientation ?? 0) * deg;
      euler.set(orientation.beta * deg, (orientation.alpha - yawZero) * deg, -orientation.gamma * deg, "YXZ");
      q.setFromEuler(euler).multiply(screenTilt);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(zee, -screenAngle));
      camera.quaternion.slerp(q, 0.35);
    } else {
      // No gyroscope (desktop): look slightly down at them.
      camera.lookAt(creator.position.x, EYE * 0.6, creator.position.z);
    }
    // Match their brightness to the room every half second.
    if (now - lastProbe > 500 && $("cam").readyState >= 2) {
      lastProbe = now;
      lightProbe.drawImage($("cam"), 0, 0, 8, 8);
      const px = lightProbe.getImageData(0, 0, 8, 8).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      const luma = sum / 64 / 255;
      bodyMaterial.uniforms.brightness.value = THREE.MathUtils.clamp(0.7 + luma * 0.7, 0.75, 1.1);
    }
    animateHologram(now);
    faceCamera(camera);
    renderer.render(scene, camera);
    if (recorder?.state === "recording") drawRecordingFrame();
  });

  $("replay").onclick = () => { revealStart = performance.now(); playFrom(playlist()); };
  $("rec").onclick = () => (recorder?.state === "recording" ? stopRecording() : startRecording());
  $("close").onclick = () => location.reload();
}

// ------------------------------------------------------------------ recording (camera mode)

let recorder = null;
let chunks = [];
let recCanvas, recCtx, audioCtx, audioDest, timerStart;

function pickMime() {
  const options = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
  return options.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || "";
}

function drawRecordingFrame() {
  // Camera image, cropped like object-fit: cover, then the 3D layer on top.
  const cam = $("cam");
  const cw = recCanvas.width, ch = recCanvas.height;
  const s = Math.max(cw / cam.videoWidth, ch / cam.videoHeight);
  const w = cam.videoWidth * s, h = cam.videoHeight * s;
  recCtx.drawImage(cam, (cw - w) / 2, (ch - h) / 2, w, h);
  recCtx.drawImage(glCanvas, 0, 0, cw, ch);
  $("timer").textContent = "REC " + ((performance.now() - timerStart) / 1000).toFixed(0) + "s";
}

function startRecording() {
  if (!window.MediaRecorder) {
    alert("Recording isn't supported in this browser. Use your phone's screen recorder instead.");
    return;
  }
  const scale = Math.min(1, 1920 / Math.max(innerWidth, innerHeight) / (devicePixelRatio || 1)) * (devicePixelRatio || 1);
  recCanvas = document.createElement("canvas");
  recCanvas.width = Math.round(innerWidth * scale / 2) * 2;
  recCanvas.height = Math.round(innerHeight * scale / 2) * 2;
  recCtx = recCanvas.getContext("2d");

  const stream = recCanvas.captureStream(30);
  if (!audioCtx) {
    audioCtx = new AudioContext();
    const src = audioCtx.createMediaElementSource(video);
    audioDest = audioCtx.createMediaStreamDestination();
    src.connect(audioCtx.destination);
    src.connect(audioDest);
  }
  audioCtx.resume();
  for (const t of audioDest.stream.getAudioTracks()) stream.addTrack(t);

  chunks = [];
  const mimeType = pickMime();
  recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : undefined);
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = showResult;
  recorder.start(250);
  timerStart = performance.now();
  $("rec").classList.add("on");
  $("timer").hidden = false;

  // Record exactly one full moment: restart it, stop shortly after it ends.
  revealStart = performance.now();
  onPlaylistEnd = () => setTimeout(stopRecording, 600);
  playFrom(playlist());
}

function stopRecording() {
  onPlaylistEnd = null;
  if (recorder?.state === "recording") recorder.stop();
  $("rec").classList.remove("on");
  $("timer").hidden = true;
}

let lastFile = null;
function showResult() {
  const type = recorder.mimeType || "video/webm";
  const ext = type.includes("mp4") ? "mp4" : "webm";
  const blob = new Blob(chunks, { type });
  lastFile = new File([blob], `moment-${manifest.display_name.split(" ")[0].toLowerCase()}.${ext}`, { type });
  window.__lastRecording = lastFile;  // for automated tests
  $("clip").src = URL.createObjectURL(blob);
  $("result").hidden = false;
}

$("share").onclick = async () => {
  if (navigator.canShare?.({ files: [lastFile] })) {
    try { await navigator.share({ files: [lastFile], title: "My moment" }); return; } catch { /* fall back */ }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(lastFile);
  a.download = lastFile.name;
  a.click();
};
$("again").onclick = () => { $("result").hidden = true; startRecording(); };

// ------------------------------------------------------------------ floor AR (Android, WebXR)

async function startXR() {
  await primeVideo();
  const hud = $("hud");
  const session = await navigator.xr.requestSession("immersive-ar", {
    requiredFeatures: ["hit-test"],
    optionalFeatures: ["dom-overlay"],
    domOverlay: { root: hud },
  });
  $("setup").hidden = true;
  hud.hidden = false;
  $("rec").hidden = true;  // the camera image isn't available to pages in WebXR; use the screen recorder
  $("hint").textContent = "Point at the floor and move your phone slowly";
  hud.addEventListener("beforexrselect", (e) => e.preventDefault());

  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local");
  renderer.setSize(innerWidth, innerHeight, false);
  $("stage").hidden = false;
  $("cam").hidden = true;
  await renderer.xr.setSession(session);

  const camera = new THREE.PerspectiveCamera();
  creator.visible = false;

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.14, 0.17, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  const viewerSpace = await session.requestReferenceSpace("viewer");
  const hitSource = await session.requestHitTestSource({ space: viewerSpace });

  const controller = renderer.xr.getController(0);
  controller.addEventListener("select", () => {
    if (!reticle.visible) return;
    const first = !creator.visible;
    creator.position.setFromMatrixPosition(reticle.matrix);
    creator.visible = true;
    $("hint").textContent = "Tap the floor to move them";
    if (first) { revealStart = performance.now(); playFrom(playlist()); }
  });
  scene.add(controller);

  $("replay").onclick = () => { revealStart = performance.now(); playFrom(playlist()); };
  $("close").onclick = () => session.end();
  session.addEventListener("end", () => location.reload());

  let hinted = false;
  renderer.setAnimationLoop((now, frame) => {
    const hits = frame ? frame.getHitTestResults(hitSource) : [];
    reticle.visible = hits.length > 0;
    if (hits.length) {
      reticle.matrix.fromArray(hits[0].getPose(renderer.xr.getReferenceSpace()).transform.matrix);
      if (!hinted && !creator.visible) { $("hint").textContent = "Tap to place them here"; hinted = true; }
    }
    animateHologram(now);
    faceCamera(renderer.xr.getCamera());
    renderer.render(scene, camera);
  });
}
