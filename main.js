// MAC0623 — A1 Desktop Docking Testbed — STARTER
//
// Provided: scene setup, target-pose generation, the tolerance check, the
// trial state machine, and the CSV logger/downloader.
//
// You implement: the control mapping(s) that move/rotate the cube in
// response to input. Everything you need to touch is inside blocks marked
//   // ===== STUDENT TODO ===== ... // ===== END STUDENT TODO =====
// Do not need to touch anything outside those blocks to get a working
// baseline mapping — but you may, if your design requires it (e.g. extra
// HUD state for a second input mode). If you do, note it in your README.

import * as THREE from "three";
import { VRButton } from "three/addons/webxr/VRButton.js";

// ---------------------------------------------------------------------------
// Module-scope state — provided
//
// Populated once, by main() (via buildScene() for scene/cube/target), before
// any trial starts or any frame renders. Everything below this point —
// generateTargetPose(), checkTolerance(), updateControlMapping(), animate()
// — reads and writes these directly, the same way it would if they were
// still declared inline where they're first used.
// ---------------------------------------------------------------------------

let scene, camera, renderer, cube, target, xrRig, xrControllers;

/**
 * buildScene()
 *
 * Builds the static contents of the 3D scene: background color, lighting,
 * the reference grid/axes, the student-controlled cube, and the translucent
 * target mesh (the goal pose). Does not create the camera or renderer —
 * that's main()'s job — and does not start the render loop.
 *
 * Pure with respect to the rest of the app: it only touches the THREE.Scene
 * it creates and returns, so it's safe to read top-to-bottom on its own.
 *
 * @returns {{ scene: THREE.Scene, cube: THREE.Mesh, target: THREE.Mesh }}
 *   The new scene, plus direct references to the two meshes the rest of the
 *   app needs: `cube` (control mappings write to `cube.position` /
 *   `cube.quaternion`) and `target` (`generateTargetPose()` writes to it
 *   every trial).
 */
function buildScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1a);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(2, 4, 3);
  scene.add(dirLight);

  scene.add(new THREE.GridHelper(6, 24, 0x444444, 0x2a2a2a));
  scene.add(new THREE.AxesHelper(0.6));

  // Cube (student-controlled) and target (goal pose) share one geometry —
  // the target clones it so the two meshes can have independent materials
  // (opaque vs. translucent) without sharing a single Mesh instance.
  // Six distinct colors, one per BoxGeometry face (order +X -X +Y -Y +Z -Z),
  // so orientation is actually legible instead of a rotationally-symmetric
  // single-color cube. +Z is the bright "marked" face.
  const cubeGeometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
  const cubeFaceColors = [0x3f7fd6, 0x2c5aa0, 0xe0c341, 0xa08a2c, 0xff5c5c, 0x7a2f2f];

  const cube = new THREE.Mesh(
    cubeGeometry,
    cubeFaceColors.map((color) => new THREE.MeshStandardMaterial({ color }))
  );
  cube.position.set(0, 0.5, 0);
  scene.add(cube);

  const target = new THREE.Mesh(
    cubeGeometry.clone(),
    cubeFaceColors.map((color) => new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    }))
  );
  scene.add(target);

  return { scene, cube, target };
}

/**
 * main()
 *
 * Entry point for the whole app. Order matters here:
 *   1. Build the scene (`buildScene()`) — cube and target must exist before
 *      anything below tries to read their position/quaternion.
 *   2. Create the camera and renderer, and wire the window resize handler.
 *   3. Start the trial state machine (`startTrial()`), which generates the
 *      first target pose.
 *   4. Start the render loop (`animate()`).
 *
 * Called once, at the bottom of this file. Everything it sets up
 * (`scene`, `camera`, `renderer`, `cube`, `target`) is written into the
 * module-scope variables declared above, so the rest of the file can keep
 * referring to them as plain names instead of threading them through every
 * function call.
 */
function main() {
  ({ scene, cube, target } = buildScene());

  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.05,
    100
  );
  camera.position.set(0, 1.4, 4);
  camera.lookAt(0, 0.5, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  window.addEventListener("resize", handleWindowResize);

  setupWebXR();

  startTrial();
  // WebXR needs setAnimationLoop, not requestAnimationFrame — three.js
  // swaps the timing source automatically once an XR session starts.
  renderer.setAnimationLoop(animate);
}

/**
 * handleWindowResize()
 *
 * Keeps the camera's aspect ratio and the renderer's output size in sync
 * with the browser window. Registered as the "resize" listener in main().
 */
function handleWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ---------------------------------------------------------------------------
// Target-pose generation — provided
//
// Uses Shoemake's algorithm for a uniformly-random unit quaternion (uniform
// over SO(3)), rather than converting random Euler angles, which would bias
// the sampled orientations. Position is uniform within a bounding box in
// front of the camera.
// ---------------------------------------------------------------------------

function randomQuaternionShoemake() {
  const u1 = Math.random();
  const u2 = Math.random();
  const u3 = Math.random();

  const sqrt1MinusU1 = Math.sqrt(1 - u1);
  const sqrtU1 = Math.sqrt(u1);

  const theta1 = 2 * Math.PI * u2;
  const theta2 = 2 * Math.PI * u3;

  return new THREE.Quaternion(
    sqrt1MinusU1 * Math.sin(theta1),
    sqrt1MinusU1 * Math.cos(theta1),
    sqrtU1 * Math.sin(theta2),
    sqrtU1 * Math.cos(theta2)
  );
}

const TARGET_BOUNDS = {
  x: [-1.0, 1.0],
  y: [0.2, 1.6],
  z: [-0.6, 0.6],
};

function randomInRange([min, max]) {
  return min + Math.random() * (max - min);
}

function generateTargetPose() {
  target.position.set(
    randomInRange(TARGET_BOUNDS.x),
    randomInRange(TARGET_BOUNDS.y),
    randomInRange(TARGET_BOUNDS.z)
  );
  target.quaternion.copy(randomQuaternionShoemake());
}

// ---------------------------------------------------------------------------
// Tolerance check — provided
//
// Position tolerance: 0.05 units (world units == meters, at this scene
// scale). Orientation tolerance: 10 degrees, measured via
// Quaternion.angleTo(), which is robust to double-cover (q and -q represent
// the same rotation) — do not compute orientation error from Euler angles.
// ---------------------------------------------------------------------------

const POSITION_TOLERANCE = 0.05;
const ORIENTATION_TOLERANCE_DEG = 10;

// World pose — while the cube is attached to a controller its local
// position/quaternion are in controller space, so docking checks must
// read the world transform (same values as local when parented to scene).
const _cubeWorldPos = new THREE.Vector3();
const _cubeWorldQuat = new THREE.Quaternion();

function getCubeWorldPose() {
  cube.getWorldPosition(_cubeWorldPos);
  cube.getWorldQuaternion(_cubeWorldQuat);
  return { position: _cubeWorldPos, quaternion: _cubeWorldQuat };
}

function checkTolerance() {
  const { position, quaternion } = getCubeWorldPose();
  const positionError = position.distanceTo(target.position);
  const orientationErrorRad = quaternion.angleTo(target.quaternion);
  const orientationErrorDeg = THREE.MathUtils.radToDeg(orientationErrorRad);

  const withinTolerance =
    positionError <= POSITION_TOLERANCE &&
    orientationErrorDeg <= ORIENTATION_TOLERANCE_DEG;

  return { positionError, orientationErrorDeg, withinTolerance };
}

// ---------------------------------------------------------------------------
// HUD references — provided
// ---------------------------------------------------------------------------

const participantIdInput = document.getElementById("participantId");
const mappingSelect = document.getElementById("mappingSelect");
const trialCountEl = document.getElementById("trialCount");
const confirmBtn = document.getElementById("confirmBtn");
const downloadBtn = document.getElementById("downloadBtn");
const statusEl = document.getElementById("status");

// ---------------------------------------------------------------------------
// Trial state machine — provided
//
// presentation_order counts trials within the *current* mapping selection
// since the page loaded — it does not reset when you switch mapping in the
// dropdown mid-session, since order-of-presentation across mappings is part
// of what you're counterbalancing across participants (see A1's ABBA
// counterbalancing note). trial_number is a simple running counter of every
// trial confirmed this session, regardless of mapping.
// ---------------------------------------------------------------------------

let trialNumber = 0;
let presentationOrderByMapping = {
  "vr-grab": 0,
  "vr-trackball": 0,
  "vr-gizmo": 0,
  "desktop-1": 0,
  "desktop-2": 0,
};
let trialStartTime = performance.now();
let pathLength = 0; // accumulated cube-position travel distance this trial
// Placeholder — cube doesn't exist yet at module-load time (main() creates
// it via buildScene()). startTrial() calls lastCubePosition.copy(cube.position)
// before this value is ever read, so the zero vector here is never used.
let lastCubePosition = new THREE.Vector3();

// ===== STUDENT TODO =====
// Increment this from your own mapping code every time the user switches
// input mode (e.g. toggling translate/rotate mode in the baseline mapping).
// It is read (and reset) when a trial is confirmed.
let modeSwitches = 0;
// ===== END STUDENT TODO =====

const rows = [];
const CSV_HEADER = [
  "participant_id",
  "mapping",
  "trial_number",
  "presentation_order",
  "completion_time_s",
  "final_position_error",
  "final_orientation_error_deg",
  "mode_switches",
  "path_length",
];

function currentMapping() {
  return mappingSelect.value;
}

function isVrGrabMapping() {
  return currentMapping() === "vr-grab";
}

function isVrTrackballMapping() {
  return currentMapping() === "vr-trackball";
}

function isVrGizmoMapping() {
  return currentMapping() === "vr-gizmo";
}

function startTrial() {
  trialStartTime = performance.now();
  pathLength = 0;
  lastCubePosition.copy(getCubeWorldPose().position);
  modeSwitches = 0;
  lastTrackballMode = null;
  lastGizmoHandle = null;
  generateTargetPose();
  trialCountEl.textContent = `Trial ${trialNumber + 1}`;
}

function confirmTrial() {
  const { positionError, orientationErrorDeg } = checkTolerance();
  const completionTimeS = (performance.now() - trialStartTime) / 1000;
  const mapping = currentMapping();

  trialNumber += 1;
  presentationOrderByMapping[mapping] = (presentationOrderByMapping[mapping] || 0) + 1;

  rows.push({
    participant_id: participantIdInput.value.trim() || "UNKNOWN",
    mapping,
    trial_number: trialNumber,
    presentation_order: presentationOrderByMapping[mapping],
    completion_time_s: completionTimeS.toFixed(3),
    final_position_error: positionError.toFixed(4),
    final_orientation_error_deg: orientationErrorDeg.toFixed(2),
    mode_switches: modeSwitches,
    path_length: pathLength.toFixed(4),
  });

  startTrial();
}

confirmBtn.addEventListener("click", confirmTrial);
window.addEventListener("keydown", handleKeydown);

/**
 * handleKeydown(e)
 *
 * Keyboard shortcut for Confirm: Enter does the same thing as clicking
 * #confirmBtn. Registered as the "keydown" listener above.
 */
function handleKeydown(e) {
  if (e.key === "Enter") confirmTrial();
}

// ---------------------------------------------------------------------------
// CSV download — provided
// ---------------------------------------------------------------------------

function buildCsv() {
  const lines = [CSV_HEADER.join(",")];
  for (const row of rows) {
    lines.push(
      CSV_HEADER.map(function (key) {
        return row[key];
      }).join(",")
    );
  }
  return lines.join("\n");
}

downloadBtn.addEventListener("click", handleDownloadClick);

/**
 * handleDownloadClick()
 *
 * Builds the CSV from `rows` (via buildCsv()), then triggers a browser
 * download through a temporary Blob URL and an off-DOM `<a>` click.
 * Registered as the "click" listener on #downloadBtn above.
 */
function handleDownloadClick() {
  const csv = buildCsv();
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const pid = participantIdInput.value.trim() || "UNKNOWN";
  a.href = url;
  a.download = `a1_${pid}_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Status indicator — provided
// ---------------------------------------------------------------------------

function updateStatus() {
  const { positionError, orientationErrorDeg, withinTolerance } = checkTolerance();
  statusEl.textContent = `dPos ${positionError.toFixed(3)} | dRot ${orientationErrorDeg.toFixed(1)}deg`;
  statusEl.classList.toggle("in-tolerance", withinTolerance);
}

// ---------------------------------------------------------------------------
// Control mapping — STUDENT TODO
//
// updateControlMapping(delta) is called once per animation frame. This is
// where mouse/keyboard input should translate into changes to cube.position
// and cube.quaternion. The baseline mapping (mapping "1") is the translate-rotation
// toggled by TAB/Spacebar.
// Mapping "2" is your own design.
//
// Whatever you build:
//   - Read currentMapping() to branch between mapping 1 and mapping 2.
//   - Update cube.position / cube.quaternion directly.
//   - Increment modeSwitches whenever the user changes input mode.
//   - Accumulate pathLength (see the render loop below, which already does
//     this generically by measuring cube.position deltas frame-to-frame —
//     you likely don't need to touch that part).
//
// ===== STUDENT TODO =====

// Nothing here moves the cube yet, so it will sit still on load. Wire up
// your own mouse/keyboard listeners (mousemove, keydown/keyup, etc.) above
// this function as needed, and drive cube.position / cube.quaternion from
// updateControlMapping() below.

// GLOBAL VARIABLES
let isDragging = false;
let controlMode = "translate"; // "translate" or "rotate"
let mouseX = 0;
let mouseY = 0;
let dx = 0;
let dy = 0;
let dz = 0;
const keysDown = new Set();

// MAPPING 2
const CODE_W = "KeyW";
const CODE_A = "KeyA";
const CODE_S = "KeyS";
const CODE_D = "KeyD";
const CODE_Q = "KeyQ";
const CODE_E = "KeyE";
const CODE_SPACE = "Space";

const MAPPING2_MOVE_KEYS = [CODE_W, CODE_A, CODE_S, CODE_D, CODE_Q, CODE_E];

const MAPPING2_CODES = new Set([
  ...MAPPING2_MOVE_KEYS,
  CODE_SPACE,
]);

function trackMapping2Key(e, isDown) {
  if (!MAPPING2_CODES.has(e.code)) return;
  if (isDown) keysDown.add(e.code);
  else keysDown.delete(e.code);
}

// EVENT LISTENERS
window.addEventListener("pointerdown", (e) => {
  isDragging = true;
  mouseX = e.clientX;
  mouseY = e.clientY;
});

window.addEventListener("pointerup", () => {
  isDragging = false;
});

window.addEventListener("pointermove", (e) => {
  dx = e.clientX - mouseX;
  dy = e.clientY - mouseY;
  mouseX = e.clientX;
  mouseY = e.clientY;
});

// Capture phase so WASD is tracked even when a HUD input has focus.
document.addEventListener("keydown", (e) => {
  trackMapping2Key(e, true);

  if (e.code === CODE_SPACE && (currentMapping() === "desktop-1" || currentMapping() === "desktop-2")) {
    e.preventDefault();
    controlMode = controlMode === "translate" ? "rotate" : "translate";
    modeSwitches++;
  }
}, true);

document.addEventListener("keyup", (e) => {
  trackMapping2Key(e, false);
}, true);

mappingSelect.addEventListener("change", () => {
  keysDown.clear();
  releaseVrGrab();
  releaseGizmoDrag();
});

window.addEventListener("wheel", (e) => {
  if (currentMapping() !== "desktop-1") return;
  const scale = 0.0005;
  dz = -e.deltaY * scale;
});


function updateControlMapping(delta) {
  // VR grab owns the cube; desktop mappings must not fight the controller.
  if (renderer.xr.isPresenting) return;

  const mapping = currentMapping();

  if (mapping === "desktop-1") {
    const scale = 0.005;

    if (controlMode === "translate") {
      // 1. Translation in X and Y (Mouse dragging)
      if (isDragging) {
        cube.position.x += dx * scale;
        cube.position.y -= dy * scale;
        dx = 0;
        dy = 0;
      }

      // 2. Translation in Z (Mouse Wheel)
      if (dz !== 0) {
        cube.position.z += dz;
        dz = 0;
      }
    } else if (controlMode === "rotate") {
      // 1. Rotation in X and Y (Mouse dragging)
      if (isDragging) {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

        const qX = new THREE.Quaternion().setFromAxisAngle(up, dx * scale);
        const qY = new THREE.Quaternion().setFromAxisAngle(right, dy * scale);

        cube.quaternion.premultiply(qX);
        cube.quaternion.premultiply(qY);
        dx = 0;
        dy = 0;
      }

      // 2. Rotation in Z (Mouse Wheel)
      if (dz !== 0) {
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
        const qZ = new THREE.Quaternion().setFromAxisAngle(forward, dz);
        cube.quaternion.premultiply(qZ);

        dz = 0;
      }
    }
  } else if (mapping === "desktop-2") {
    const moveSpeed = 1.2;
    const rotSpeed = 2.5;
    const moveStep = moveSpeed * delta;
    const rotStep = rotSpeed * delta;

    if (controlMode === "translate") {
      if (keysDown.has(CODE_W)) cube.position.y += moveStep;
      if (keysDown.has(CODE_S)) cube.position.y -= moveStep;
      if (keysDown.has(CODE_A)) cube.position.x -= moveStep;
      if (keysDown.has(CODE_D)) cube.position.x += moveStep;
      if (keysDown.has(CODE_Q)) cube.position.z -= moveStep;
      if (keysDown.has(CODE_E)) cube.position.z += moveStep;
      return;
    }

    // Rotate mode — same keys as translate (WASD + Q/E)
    if (keysDown.has(CODE_W)) cube.rotation.x -= rotStep;
    if (keysDown.has(CODE_S)) cube.rotation.x += rotStep;
    if (keysDown.has(CODE_A)) cube.rotation.y += rotStep;
    if (keysDown.has(CODE_D)) cube.rotation.y -= rotStep;
    if (keysDown.has(CODE_Q)) cube.rotation.z += rotStep;
    if (keysDown.has(CODE_E)) cube.rotation.z -= rotStep;
  }
}

// ===== END STUDENT TODO =====


// WebXR overwrites camera.position with the headset pose at the tracking
// origin (0, 0, 0) — the same place the cube sits. Parent camera +
// controller to this rig and slide the rig back so you stand in front of
// the cube, not on top of it. Change XR_SPAWN_Z to move closer/farther.
const XR_SPAWN_Z = 1.2;

// VR trackball rotation gain: controller delta is scaled by this before
// being applied to the cube. Wrist twists in VR are larger and noisier than
// a desktop mouse drag on a virtual sphere, so gain < 1 avoids 1:1 overshoot
// while still feeling coupled to the hand. 0.6 ≈ a comfortable docking
// rotation from a modest wrist turn; document this in the A2 report.
const TRACKBALL_ROTATION_GAIN = 0.6;

// vr-grab: translate + rotate 1:1 about the cube origin (mode "full").
// vr-trackball: pose locked at selectstart — ray-on-cube = translate only,
// ray-in-air = rotate only (gain). attach() would orbit around the controller.
let vrGrabController = null;
let vrGrabMode = null; // "full" | "translate" | "rotate"
let lastTrackballMode = null;
const vrGrabPrevPos = new THREE.Vector3();
const vrGrabPrevQuat = new THREE.Quaternion();
const _vrGrabPos = new THREE.Vector3();
const _vrGrabQuat = new THREE.Quaternion();
const _vrGrabDeltaPos = new THREE.Vector3();
const _vrGrabDeltaQuat = new THREE.Quaternion();
const _vrGrabIdentityQuat = new THREE.Quaternion();
const _vrGrabScaledQuat = new THREE.Quaternion();

function captureVrGrabPose(controller) {
  controller.getWorldPosition(vrGrabPrevPos);
  controller.getWorldQuaternion(vrGrabPrevQuat);
}

function beginVrManipulation(controller, mode) {
  if (vrGrabController && vrGrabController !== controller) {
    vrGrabController.userData.selected = null;
  }
  vrGrabController = controller;
  vrGrabMode = mode;
  controller.userData.selected = cube;
  captureVrGrabPose(controller);
}

function releaseVrGrab(controller) {
  if (controller && vrGrabController !== controller) return;
  if (vrGrabController) vrGrabController.userData.selected = null;
  vrGrabController = null;
  vrGrabMode = null;
}

function updateVrGrab() {
  if (!vrGrabController || !vrGrabMode) return;
  if (!isVrGrabMapping() && !isVrTrackballMapping()) return;

  vrGrabController.getWorldPosition(_vrGrabPos);
  vrGrabController.getWorldQuaternion(_vrGrabQuat);

  _vrGrabDeltaQuat.copy(vrGrabPrevQuat).invert().premultiply(_vrGrabQuat);

  if (vrGrabMode === "full" || vrGrabMode === "translate") {
    cube.position.add(_vrGrabDeltaPos.subVectors(_vrGrabPos, vrGrabPrevPos));
  }

  if (vrGrabMode === "full") {
    cube.quaternion.premultiply(_vrGrabDeltaQuat);
  } else if (vrGrabMode === "rotate") {
    _vrGrabScaledQuat.slerpQuaternions(
      _vrGrabIdentityQuat,
      _vrGrabDeltaQuat,
      TRACKBALL_ROTATION_GAIN
    );
    cube.quaternion.premultiply(_vrGrabScaledQuat);
  }

  vrGrabPrevPos.copy(_vrGrabPos);
  vrGrabPrevQuat.copy(_vrGrabQuat);
}

const GIZMO_AXIS_COLORS = [0xff3344, 0x33cc55, 0x3388ff];

let gizmo = null;
let gizmoHandles = [];
let gizmoDrag = null;
let lastGizmoHandle = null;
const _gizmoAxis = new THREE.Vector3();
const _gizmoFrom = new THREE.Vector3();
const _gizmoTo = new THREE.Vector3();
const _gizmoCross = new THREE.Vector3();
const _gizmoDelta = new THREE.Vector3();
const _gizmoCtrlPos = new THREE.Vector3();

function gizmoHandleId(mesh) {
  return mesh.userData.kind + ":" + mesh.userData.axis;
}

function tagGizmoHandle(mesh, kind, axis) {
  mesh.userData.kind = kind;
  mesh.userData.axis = axis;
  gizmoHandles.push(mesh);
}

function cubeWorldAxis(axisIndex, target) {
  target.set(axisIndex === 0 ? 1 : 0, axisIndex === 1 ? 1 : 0, axisIndex === 2 ? 1 : 0);
  target.applyQuaternion(cube.quaternion);
  return target.normalize();
}

function highlightGizmo(handleId) {
  for (const mesh of gizmoHandles) {
    if (!mesh.material || !mesh.material.emissive) continue;
    mesh.material.emissive.setHex(gizmoHandleId(mesh) === handleId ? 0x666666 : 0x000000);
  }
}

function buildGizmo() {
  gizmo = new THREE.Group();
  gizmo.name = "gizmo";
  gizmoHandles = [];

  for (let axis = 0; axis < 3; axis++) {
    const color = GIZMO_AXIS_COLORS[axis];

    const arrow = new THREE.Group();
    const shaftMat = new THREE.MeshStandardMaterial({ color, metalness: 0.15, roughness: 0.45 });
    const headMat = shaftMat.clone();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.26, 10), shaftMat);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.09, 12), headMat);
    const start = 0.22;
    shaft.position.y = start + 0.13;
    head.position.y = start + 0.26 + 0.045;
    tagGizmoHandle(shaft, "translate", axis);
    tagGizmoHandle(head, "translate", axis);
    arrow.add(shaft, head);
    if (axis === 0) arrow.rotation.z = -Math.PI / 2;
    if (axis === 2) arrow.rotation.x = Math.PI / 2;
    gizmo.add(arrow);

    const ringMat = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.15,
      roughness: 0.45,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.018, 10, 48), ringMat);
    if (axis === 0) ring.rotation.y = Math.PI / 2;
    if (axis === 1) ring.rotation.x = Math.PI / 2;
    tagGizmoHandle(ring, "rotate", axis);
    gizmo.add(ring);

    const planeMat = new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), planeMat);
    const offset = 0.14;
    if (axis === 0) {
      plane.rotation.y = Math.PI / 2;
      plane.position.set(0, offset, offset);
    } else if (axis === 1) {
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(offset, 0, offset);
    } else {
      plane.position.set(offset, offset, 0);
    }
    tagGizmoHandle(plane, "plane", axis);
    gizmo.add(plane);
  }

  gizmo.visible = false;
  scene.add(gizmo);
}

function pickGizmoHandle(controller) {
  if (!gizmo || !gizmo.visible) return null;
  const hits = getIntersections(controller, [gizmo], true);
  for (const hit of hits) {
    if (hit.object.userData.kind) return hit.object;
  }
  return null;
}

function beginGizmoDrag(controller, handle) {
  const id = gizmoHandleId(handle);
  if (lastGizmoHandle && lastGizmoHandle !== id) modeSwitches++;
  lastGizmoHandle = id;

  cubeWorldAxis(handle.userData.axis, _gizmoAxis);
  controller.getWorldPosition(_gizmoCtrlPos);
  gizmoDrag = {
    controller,
    kind: handle.userData.kind,
    axis: handle.userData.axis,
    axisWorld: _gizmoAxis.clone(),
    prevPos: _gizmoCtrlPos.clone(),
  };
  controller.userData.selected = handle;
  highlightGizmo(id);
}

function releaseGizmoDrag(controller) {
  if (controller && gizmoDrag && gizmoDrag.controller !== controller) return;
  if (gizmoDrag && gizmoDrag.controller) gizmoDrag.controller.userData.selected = null;
  gizmoDrag = null;
  if (isVrGizmoMapping()) highlightGizmo(null);
}

function updateGizmoPose() {
  if (!gizmo) return;
  const show = isVrGizmoMapping();
  gizmo.visible = show;
  if (!show) return;
  gizmo.position.copy(cube.position);
  gizmo.quaternion.copy(cube.quaternion);
}

function updateGizmoDrag() {
  if (!isVrGizmoMapping() || !gizmoDrag) return;

  const { controller, kind, axisWorld, prevPos } = gizmoDrag;
  controller.getWorldPosition(_gizmoCtrlPos);
  _gizmoDelta.subVectors(_gizmoCtrlPos, prevPos);

  if (kind === "translate") {
    cube.position.addScaledVector(axisWorld, _gizmoDelta.dot(axisWorld));
  } else if (kind === "plane") {
    _gizmoDelta.projectOnPlane(axisWorld);
    cube.position.add(_gizmoDelta);
  } else if (kind === "rotate") {
    _gizmoFrom.subVectors(prevPos, cube.position).projectOnPlane(axisWorld);
    _gizmoTo.subVectors(_gizmoCtrlPos, cube.position).projectOnPlane(axisWorld);
    if (_gizmoFrom.lengthSq() > 1e-8 && _gizmoTo.lengthSq() > 1e-8) {
      const angle = Math.atan2(
        _gizmoCross.crossVectors(_gizmoFrom, _gizmoTo).dot(axisWorld),
        _gizmoFrom.dot(_gizmoTo)
      );
      cube.rotateOnWorldAxis(axisWorld, angle);
    }
  }

  prevPos.copy(_gizmoCtrlPos);
}

function updateGizmoHover() {
  if (!isVrGizmoMapping() || gizmoDrag || !xrControllers) return;
  let hovered = null;
  for (const controller of xrControllers) {
    hovered = pickGizmoHandle(controller);
    if (hovered) break;
  }
  highlightGizmo(hovered ? gizmoHandleId(hovered) : null);
}

function setupController(index, color) {
  const controller = renderer.xr.getController(index);
  controller.add(buildControllerRay(color));
  xrRig.add(controller);
  controller.addEventListener("selectstart", onGrabStart);
  controller.addEventListener("selectend", onGrabEnd);
  // Grip (squeeze) = Confirm trial — DOM #confirmBtn is not visible in immersive-vr.
  controller.addEventListener("squeezestart", onSqueezeConfirm);
  xrControllers.push(controller);

  const grip = renderer.xr.getControllerGrip(index);
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.02, 12, 8),
    new THREE.MeshBasicMaterial({ color })
  );
  grip.add(marker);
  xrRig.add(grip);

  return controller;
}

function setupWebXR() {
  renderer.xr.enabled = true;
  document.body.appendChild(VRButton.createButton(renderer));

  xrRig = new THREE.Group();
  xrRig.name = "xrRig";
  scene.add(xrRig);
  xrRig.add(camera);
  xrControllers = [];
  buildGizmo();

  // 0 = red (left in most Quest profiles), 1 = blue.
  const controller0 = setupController(0, 0xff6666);
  const controller1 = setupController(1, 0x66aaff);

  renderer.xr.addEventListener("sessionstart", () => {
    xrRig.position.set(0, 0, XR_SPAWN_Z);
  });

  renderer.xr.addEventListener("sessionend", () => {
    xrRig.position.set(0, 0, 0);
    camera.position.set(0, 1.4, 4);
    camera.quaternion.identity();
    camera.lookAt(0, 0.5, 0);
    if (cube.parent !== scene) scene.attach(cube);
    releaseVrGrab();
    releaseGizmoDrag();
    controller0.userData.selected = null;
    controller1.userData.selected = null;
    isDragging = false;
    dx = 0;
    dy = 0;
    dz = 0;
    keysDown.clear();
  });
}

function onGrabStart(event) {
  const controller = event.target;
  const hits = getIntersections(controller, [cube]);

  if (isVrGrabMapping()) {
    if (hits.length === 0) return;
    beginVrManipulation(controller, "full");
    return;
  }

  if (isVrTrackballMapping()) {
    const mode = hits.length > 0 ? "translate" : "rotate";
    if (lastTrackballMode && lastTrackballMode !== mode) modeSwitches++;
    lastTrackballMode = mode;
    beginVrManipulation(controller, mode);
    return;
  }

  if (isVrGizmoMapping()) {
    const handle = pickGizmoHandle(controller);
    if (!handle) return;
    beginGizmoDrag(controller, handle);
  }
}

function onGrabEnd(event) {
  releaseVrGrab(event.target);
  releaseGizmoDrag(event.target);
}

function onSqueezeConfirm() {
  if (!renderer.xr.isPresenting) return;
  confirmTrial();
}

function buildControllerRay(color) {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ color })
  );
  line.name = "ray";
  line.scale.z = 1.5;
  return line;
}

function getIntersections(controller, objects, recursive = false) {
  const tempMatrix = new THREE.Matrix4();
  tempMatrix.identity().extractRotation(controller.matrixWorld);

  const raycaster = new THREE.Raycaster();
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

  return raycaster.intersectObjects(objects, recursive);
}

// ===== END STUDENT TODO ================================================

// ---------------------------------------------------------------------------
// Render loop — provided
// ---------------------------------------------------------------------------

const clock = new THREE.Clock();

function animate() {
  const delta = clock.getDelta();

  updateControlMapping(delta);
  updateVrGrab();
  updateGizmoDrag();
  updateGizmoPose();
  updateGizmoHover();

  // Generic path-length accumulation — measures how far the cube has
  // physically travelled this trial, regardless of mapping. World space
  // so travel is correct while the cube is parented to a controller.
  const { position: cubeWorldPos } = getCubeWorldPose();
  pathLength += cubeWorldPos.distanceTo(lastCubePosition);
  lastCubePosition.copy(cubeWorldPos);

  updateStatus();
  renderer.render(scene, camera);
}

main();
