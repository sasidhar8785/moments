// Moments web AR: place a creator's real, cut-out video on the fan's floor (WebXR hit-test).
// Clips are "stacked alpha" MP4s (colour on top, mask below) made by prep_ar.py.
// Browsers without WebXR AR (iPhone Safari, desktop) get a 3D preview instead.

import * as THREE from "./vendor/three.module.min.js";

const params = new URLSearchParams(location.search);
const creatorId = params.get("c") || "robot";
const base = `creators/${creatorId}/`;
const $ = (id) => document.getElementById(id);

const manifest = await (await fetch(base + "manifest.json")).json();
$("title").textContent = `${manifest.display_name}, in your room`;
$("sub").textContent = "They'll appear right where you tap on your floor, say your name and play your message.";
for (const [key, label] of Object.entries(manifest.occasions)) {
  $("occasion").add(new Option(label, key));
}
if (params.get("name")) $("name").value = params.get("name");
if (params.get("occ")) $("occasion").value = params.get("occ");

const arSupported = !!(navigator.xr && await navigator.xr.isSessionSupported("immersive-ar").catch(() => false));
$("start").textContent = arSupported ? "Start AR" : "Preview";
$("note").textContent = arSupported
  ? "Tip: use your phone's screen recorder to save the moment."
  : "Live AR needs Chrome on an Android phone. This browser shows a 3D preview instead.";
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
function playFrom(list) {
  queue = list.slice(1);
  video.src = list[0];
  return video.play();
}
video.addEventListener("ended", () => {
  if (queue.length) { video.src = queue.shift(); video.play(); }
});

// ------------------------------------------------------------------ creator "hologram"

const texture = new THREE.VideoTexture(video);
texture.minFilter = THREE.LinearFilter;
texture.generateMipmaps = false;

const material = new THREE.ShaderMaterial({
  uniforms: { map: { value: texture }, brightness: { value: 1.0 } },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D map;
    uniform float brightness;
    varying vec2 vUv;
    void main() {
      vec3 colour = texture2D(map, vec2(vUv.x, 0.5 + vUv.y * 0.5)).rgb;  // top half
      float a = texture2D(map, vec2(vUv.x, vUv.y * 0.5)).r;             // bottom half = mask
      if (a < 0.02) discard;
      gl_FragColor = vec4(colour * brightness, a);                      // already premultiplied
    }`,
  transparent: true,
  premultipliedAlpha: true,
  depthWrite: false,
});

const creator = new THREE.Group();
const h = manifest.height_m;
const w = h * manifest.aspect;
const body = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
body.position.y = h / 2;
creator.add(body);

// Soft contact shadow on the floor.
const shadowCanvas = document.createElement("canvas");
shadowCanvas.width = shadowCanvas.height = 128;
const g = shadowCanvas.getContext("2d");
const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
grad.addColorStop(0, "rgba(0,0,0,0.55)");
grad.addColorStop(1, "rgba(0,0,0,0)");
g.fillStyle = grad;
g.fillRect(0, 0, 128, 128);
const shadow = new THREE.Mesh(
  new THREE.PlaneGeometry(h * 0.55, h * 0.25),
  new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }),
);
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = 0.002;
creator.add(shadow);

// Turn to face the viewer (around the vertical axis only, so they stay upright).
const camPos = new THREE.Vector3();
function faceCamera(camera) {
  camera.getWorldPosition(camPos);
  creator.rotation.y = Math.atan2(camPos.x - creator.position.x, camPos.z - creator.position.z);
}

// ------------------------------------------------------------------ renderer

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.add(creator);

$("start").addEventListener("click", () => (arSupported ? startAR() : startPreview()));

// ------------------------------------------------------------------ live AR (WebXR)

async function startAR() {
  // Unlock sound and playback inside the tap, then wait for placement.
  await playFrom(playlist()).catch(() => {});
  video.pause();
  video.currentTime = 0;

  const overlay = $("overlay");
  const session = await navigator.xr.requestSession("immersive-ar", {
    requiredFeatures: ["hit-test"],
    optionalFeatures: ["dom-overlay"],
    domOverlay: { root: overlay },
  });
  overlay.style.display = "block";
  // Taps on our buttons must not also place the creator.
  overlay.addEventListener("beforexrselect", (e) => e.preventDefault());

  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local");
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);
  await renderer.xr.setSession(session);

  const camera = new THREE.PerspectiveCamera();
  creator.visible = false;

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.12, 0.15, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  const viewerSpace = await session.requestReferenceSpace("viewer");
  const hitSource = await session.requestHitTestSource({ space: viewerSpace });

  const placeHere = () => {
    if (!reticle.visible) return;
    creator.position.setFromMatrixPosition(reticle.matrix);
    creator.visible = true;
    $("hint").textContent = "Tap the floor to move them";
    if (video.paused) playFrom(playlist());
  };
  const controller = renderer.xr.getController(0);
  controller.addEventListener("select", placeHere);
  scene.add(controller);

  $("replay").onclick = () => playFrom(playlist());
  $("exit").onclick = () => session.end();
  session.addEventListener("end", () => {
    video.pause();
    overlay.style.display = "none";
    renderer.setAnimationLoop(null);
    renderer.domElement.remove();
  });

  let hinted = false;
  renderer.setAnimationLoop((_, frame) => {
    const hits = frame ? frame.getHitTestResults(hitSource) : [];
    if (hits.length) {
      const pose = hits[0].getPose(renderer.xr.getReferenceSpace());
      reticle.visible = true;  // stays on after placing, so the fan can tap to move them
      reticle.matrix.fromArray(pose.transform.matrix);
      if (!hinted && !creator.visible) { $("hint").textContent = "Tap to place them here"; hinted = true; }
    } else {
      reticle.visible = false;
    }
    faceCamera(renderer.xr.getCamera(camera));
    renderer.render(scene, camera);
  });
}

// ------------------------------------------------------------------ 3D preview (no AR)

function startPreview() {
  const canvas = $("preview");
  canvas.style.display = "block";
  const { width, height } = canvas.getBoundingClientRect();
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  r.setSize(width, height, false);

  const camera = new THREE.PerspectiveCamera(50, width / height, 0.05, 50);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x8a7a68 }),
  );
  floor.position.y = -0.001;
  scene.add(floor);
  scene.add(new THREE.GridHelper(6, 24, 0x5d5145, 0x6e6152));
  creator.position.set(0, 0, 0);

  playFrom(playlist());
  $("start").textContent = "Replay";
  $("start").onclick = () => playFrom(playlist());

  const t0 = performance.now();
  r.setAnimationLoop(() => {
    const t = (performance.now() - t0) / 1000;
    const ang = Math.sin(t * 0.4) * 0.6;
    camera.position.set(Math.sin(ang) * 2.6, 1.3, Math.cos(ang) * 2.6);
    camera.lookAt(0, h * 0.5, 0);
    faceCamera(camera);
    r.render(scene, camera);
  });
}
