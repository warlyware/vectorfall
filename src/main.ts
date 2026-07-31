import * as THREE from "three";
import "./style.css";
import {
  circleIntersectsRect,
  circlesIntersect,
  createShip,
  DEFAULT_FLIGHT_CONFIG,
  fireBullet,
  type BulletState,
  type FlightConfig,
  type FlightInput,
  type Rect,
  type ShipState,
  resolveCircleAgainstRect,
  speedOf,
  stepBullet,
  stepShip,
} from "./simulation";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing application root");

app.innerHTML = `
  <canvas id="game" aria-label="Multiplayer top-down spaceship flight laboratory"></canvas>
  <header class="title"><span>FLIGHT LAB</span><small>MULTIPLAYER TEST</small></header>
  <section class="hud" aria-live="polite">
    <div class="energy-label"><span>ENERGY</span><output id="energy-value">100</output></div>
    <div class="energy-track"><div id="energy-fill"></div></div>
    <dl>
      <div><dt>SPEED</dt><dd id="speed">0</dd></div>
      <div><dt>POSITION</dt><dd id="position">0, 0</dd></div>
      <div><dt>STATE</dt><dd id="state">WAITING</dd></div>
    </dl>
  </section>
  <section id="session-panel" class="session-panel hidden">
    <div><span>ROOM</span><strong id="room-name">OFFLINE</strong></div>
    <div><span>PILOTS</span><strong id="player-count">1</strong></div>
    <button id="leave-room" type="button">LEAVE</button>
    <ul id="roster"></ul>
  </section>
  <aside id="diagnostics" class="diagnostics hidden">
    <div class="panel-heading"><span>FLIGHT TUNING</span><button id="reset-tuning">RESET</button></div>
    <div id="tuning-controls"></div>
    <p>Settings affect only your local ship.</p>
  </aside>
  <div class="controls">
    <span><kbd>WASD</kbd> / <kbd>ARROWS</kbd> FLY</span>
    <span><kbd>SHIFT</kbd> BOOST</span>
    <span><kbd>SPACE</kbd> FIRE</span>
    <span><kbd>WHEEL</kbd> ZOOM</span>
    <span><kbd>R</kbd> RESPAWN</span>
    <span><kbd>P</kbd> PAUSE</span>
    <span><kbd>\`</kbd> TUNE</span>
  </div>
  <div id="paused" class="paused hidden">PAUSED</div>
  <section id="lobby" class="lobby">
    <form id="room-form" class="lobby-card">
      <span class="eyebrow">PORTALS MULTIPLAYER</span>
      <h1>JOIN FLIGHT SESSION</h1>
      <p>Enter the same room code as the pilots you want to fly with.</p>
      <label for="room-code">ROOM CODE</label>
      <input id="room-code" name="room" maxlength="48" autocomplete="off" placeholder="ALPHA-7" required />
      <button id="join-room" type="submit">JOIN ROOM</button>
      <button id="offline-mode" class="secondary" type="button">PRACTICE OFFLINE</button>
      <output id="connection-message">READY</output>
    </form>
  </section>
`;

const canvas = getElement<HTMLCanvasElement>("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x070a0f);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
camera.position.z = 20;
const cameraTarget = new THREE.Vector3();
const minCameraZoom = 0.55;
const maxCameraZoom = 2.25;

const worldWidth = 1600;
const worldHeight = 1100;
const walls: Rect[] = [
  { x: -800, y: -550, width: 1600, height: 28 },
  { x: -800, y: 522, width: 1600, height: 28 },
  { x: -800, y: -550, width: 28, height: 1100 },
  { x: 772, y: -550, width: 28, height: 1100 },
  { x: -320, y: -220, width: 40, height: 440 },
  { x: 280, y: -220, width: 40, height: 440 },
  { x: -120, y: 250, width: 240, height: 36 },
  { x: -120, y: -286, width: 240, height: 36 },
];

createBackground();
createWalls();

interface ShipVisual {
  group: THREE.Group;
  exhaust: THREE.Mesh;
}

interface RemotePilot {
  state: ShipState;
  visual: ShipVisual;
  thrusting: boolean;
  boosting: boolean;
  respawning: boolean;
}

interface RenderedBullet {
  state: BulletState;
  mesh: THREE.Mesh;
}

const localVisual = createShipVisual(0xe9f2ff, 0x75d7ff, 0x4bc8ff);
scene.add(localVisual.group);

const diagnosticsGroup = new THREE.Group();
const velocityLine = makeLine(0x4bc8ff);
const headingLine = makeLine(0xffffff);
const collisionRing = new THREE.LineLoop(
  new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 40 }, (_, index) => {
      const angle = (index / 40) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * 13, Math.sin(angle) * 13, 0);
    }),
  ),
  new THREE.LineBasicMaterial({ color: 0x77ffb0, transparent: true, opacity: 0.55 }),
);
diagnosticsGroup.add(velocityLine, headingLine, collisionRing);
diagnosticsGroup.visible = false;
scene.add(diagnosticsGroup);

const remotePilots = new Map<string, RemotePilot>();
const bullets: RenderedBullet[] = [];
const bulletGeometry = new THREE.CircleGeometry(2.7, 8);
const localBulletMaterial = new THREE.MeshBasicMaterial({ color: 0x8ee8ff });
const remoteBulletMaterial = new THREE.MeshBasicMaterial({ color: 0xff6f88 });

let config: FlightConfig = { ...DEFAULT_FLIGHT_CONFIG };
let ship = createLocalShip();
let paused = false;
let showDiagnostics = false;
let collidedThisFrame = false;
let weaponCooldown = 0;
let respawnTimer = 0;
let joined = false;
let offline = false;
let localId = "local";
let activeRoom = "";
let networkAccumulator = 0;
const networkInterval = 0.12;

const input: FlightInput = {
  thrust: false,
  reverse: false,
  turnLeft: false,
  turnRight: false,
  boost: false,
};

const energyFill = getElement<HTMLElement>("energy-fill");
const energyValue = getElement<HTMLElement>("energy-value");
const speedValue = getElement<HTMLElement>("speed");
const positionValue = getElement<HTMLElement>("position");
const stateValue = getElement<HTMLElement>("state");
const diagnosticsPanel = getElement<HTMLElement>("diagnostics");
const pausedOverlay = getElement<HTMLElement>("paused");
const tuningControls = getElement<HTMLElement>("tuning-controls");
const lobby = getElement<HTMLElement>("lobby");
const roomForm = getElement<HTMLFormElement>("room-form");
const roomCodeInput = getElement<HTMLInputElement>("room-code");
const joinButton = getElement<HTMLButtonElement>("join-room");
const offlineButton = getElement<HTMLButtonElement>("offline-mode");
const connectionMessage = getElement<HTMLOutputElement>("connection-message");
const sessionPanel = getElement<HTMLElement>("session-panel");
const roomName = getElement<HTMLElement>("room-name");
const playerCount = getElement<HTMLElement>("player-count");
const roster = getElement<HTMLUListElement>("roster");
const portalsNet = window.Portals?.net;

const tuningFields: Array<{
  key: keyof FlightConfig;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: "thrust", label: "Forward thrust", min: 60, max: 360, step: 5 },
  { key: "reverseThrust", label: "Reverse thrust", min: 30, max: 240, step: 5 },
  { key: "turnSpeed", label: "Turn speed", min: 1, max: 6, step: 0.05 },
  { key: "maxSpeed", label: "Maximum speed", min: 100, max: 600, step: 5 },
  { key: "boostMultiplier", label: "Boost thrust", min: 1, max: 3, step: 0.05 },
  { key: "boostEnergyPerSecond", label: "Boost drain", min: 5, max: 70, step: 1 },
  { key: "energyRechargePerSecond", label: "Energy recharge", min: 2, max: 40, step: 1 },
  { key: "wallRestitution", label: "Wall bounce", min: 0, max: 1, step: 0.01 },
  { key: "bulletEnergyCost", label: "Bullet energy", min: 0, max: 20, step: 1 },
  { key: "bulletCooldown", label: "Fire interval", min: 0.05, max: 0.5, step: 0.01 },
  { key: "bulletDamage", label: "Bullet damage", min: 1, max: 40, step: 1 },
];

renderTuningControls();
setupMultiplayerEvents();

roomForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void joinRoom(roomCodeInput.value);
});

offlineButton.addEventListener("click", () => startOffline());
getElement<HTMLButtonElement>("leave-room").addEventListener("click", () => leaveRoom());
getElement<HTMLButtonElement>("reset-tuning").addEventListener("click", () => {
  config = { ...DEFAULT_FLIGHT_CONFIG };
  ship.energy = Math.min(ship.energy, config.maxEnergy);
  renderTuningControls();
});

if (!portalsNet) {
  connectionMessage.textContent = "PORTALS SDK UNAVAILABLE — OFFLINE PRACTICE ONLY";
  joinButton.disabled = true;
}

const heldKeys = new Set<string>();
window.addEventListener("keydown", (event) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
    event.preventDefault();
  }
  if (event.repeat && ["KeyR", "KeyP", "Backquote"].includes(event.code)) return;
  heldKeys.add(event.code);
  if (event.code === "KeyR") respawnLocalShip();
  if (event.code === "KeyP") togglePause();
  if (event.code === "Backquote") toggleDiagnostics();
  updateInput();
});
window.addEventListener("keyup", (event) => {
  heldKeys.delete(event.code);
  updateInput();
});
window.addEventListener("blur", () => {
  heldKeys.clear();
  updateInput();
});
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    camera.zoom = THREE.MathUtils.clamp(
      camera.zoom * Math.exp(-event.deltaY * 0.0012),
      minCameraZoom,
      maxCameraZoom,
    );
    camera.updateProjectionMatrix();
  },
  { passive: false },
);

function setupMultiplayerEvents(): void {
  if (!portalsNet) return;
  portalsNet.on("message", handleNetworkMessage);
  portalsNet.on("playerjoin", (_player, players) => updateRoster(players));
  portalsNet.on("playerleave", (player, players) => {
    removeRemotePilot(player.id);
    updateRoster(players);
  });
  portalsNet.on("status", (status) => {
    if (status !== "disconnected") return;
    joined = false;
    connectionMessage.textContent = "CONNECTION LOST — JOIN AGAIN";
    showLobby();
    clearRemotePilots();
  });
}

async function joinRoom(rawCode: string): Promise<void> {
  if (!portalsNet) return;
  const code = normalizeRoomCode(rawCode);
  if (!code) {
    connectionMessage.textContent = "USE LETTERS, NUMBERS, DASHES, OR UNDERSCORES";
    return;
  }

  joinButton.disabled = true;
  offlineButton.disabled = true;
  connectionMessage.textContent = "CONNECTING…";
  try {
    const channel = `flight-${code}`;
    const session = await portalsNet.join({ channel });
    localId = session.self.id;
    activeRoom = code.toUpperCase();
    joined = true;
    offline = false;
    networkAccumulator = networkInterval;
    respawnLocalShip();
    updateRoster(session.players);
    roomName.textContent = activeRoom;
    sessionPanel.classList.remove("hidden");
    lobby.classList.add("hidden");
    connectionMessage.textContent = "CONNECTED";
  } catch (error) {
    connectionMessage.textContent = "MULTIPLAYER UNAVAILABLE — TRY AGAIN OR PRACTICE OFFLINE";
    console.warn("Portals multiplayer join failed", error);
  } finally {
    joinButton.disabled = false;
    offlineButton.disabled = false;
  }
}

function startOffline(): void {
  joined = false;
  offline = true;
  localId = "local";
  activeRoom = "OFFLINE";
  respawnLocalShip();
  updateRoster([]);
  roomName.textContent = "OFFLINE";
  sessionPanel.classList.remove("hidden");
  lobby.classList.add("hidden");
}

function leaveRoom(): void {
  if (joined) portalsNet?.leave();
  joined = false;
  offline = false;
  activeRoom = "";
  clearRemotePilots();
  clearBullets();
  sessionPanel.classList.add("hidden");
  showLobby();
}

function showLobby(): void {
  lobby.classList.remove("hidden");
  sessionPanel.classList.add("hidden");
}

function normalizeRoomCode(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 48);
}

function updateRoster(players: PortalsPlayer[]): void {
  roster.replaceChildren();
  if (offline) {
    const item = document.createElement("li");
    item.textContent = "you (offline)";
    roster.append(item);
    playerCount.textContent = "1";
    return;
  }
  for (const player of players) {
    const item = document.createElement("li");
    const name = player.displayName || `pilot-${player.id.slice(0, 4)}`;
    item.textContent = player.id === localId ? `${name} (you)` : name;
    roster.append(item);
  }
  playerCount.textContent = String(players.length);
}

function handleNetworkMessage(data: unknown, fromId: string): void {
  if (!joined || !isRecord(data) || typeof data.kind !== "string") return;
  if (data.kind === "state") updateRemoteState(fromId, data);
  if (data.kind === "shot") receiveRemoteShot(fromId, data);
}

function updateRemoteState(fromId: string, data: Record<string, unknown>): void {
  const values = [data.x, data.y, data.vx, data.vy, data.angle, data.energy];
  if (!values.every(isFiniteNumber)) return;
  const pilot = getOrCreateRemotePilot(fromId);
  pilot.state.position.x = clampNumber(data.x as number, -2000, 2000);
  pilot.state.position.y = clampNumber(data.y as number, -2000, 2000);
  pilot.state.velocity.x = clampNumber(data.vx as number, -1000, 1000);
  pilot.state.velocity.y = clampNumber(data.vy as number, -1000, 1000);
  pilot.state.angle = data.angle as number;
  pilot.state.energy = clampNumber(data.energy as number, 0, config.maxEnergy);
  pilot.thrusting = data.thrusting === true;
  pilot.boosting = data.boosting === true;
  pilot.respawning = data.respawning === true;
  pilot.visual.group.visible = !pilot.respawning;
}

function receiveRemoteShot(fromId: string, data: Record<string, unknown>): void {
  const values = [data.x, data.y, data.vx, data.vy, data.lifetime];
  if (!values.every(isFiniteNumber)) return;
  addBullet(
    {
      position: {
        x: clampNumber(data.x as number, -2000, 2000),
        y: clampNumber(data.y as number, -2000, 2000),
      },
      velocity: {
        x: clampNumber(data.vx as number, -1200, 1200),
        y: clampNumber(data.vy as number, -1200, 1200),
      },
      lifetime: clampNumber(data.lifetime as number, 0, 2),
      owner: fromId,
    },
    false,
  );
}

function broadcastState(): void {
  if (!joined || !portalsNet) return;
  portalsNet.send({
    kind: "state",
    x: roundNetworkValue(ship.position.x),
    y: roundNetworkValue(ship.position.y),
    vx: roundNetworkValue(ship.velocity.x),
    vy: roundNetworkValue(ship.velocity.y),
    angle: roundNetworkValue(ship.angle),
    energy: roundNetworkValue(ship.energy),
    thrusting: input.thrust,
    boosting: input.thrust && input.boost && ship.energy > 0,
    respawning: respawnTimer > 0,
  });
}

function broadcastShot(bullet: BulletState): void {
  if (!joined || !portalsNet) return;
  portalsNet.send({
    kind: "shot",
    x: roundNetworkValue(bullet.position.x),
    y: roundNetworkValue(bullet.position.y),
    vx: roundNetworkValue(bullet.velocity.x),
    vy: roundNetworkValue(bullet.velocity.y),
    lifetime: bullet.lifetime,
  });
}

function getOrCreateRemotePilot(id: string): RemotePilot {
  const existing = remotePilots.get(id);
  if (existing) return existing;
  const visual = createShipVisual(0xffd9df, colorFromId(id), 0xff7a8f);
  const pilot: RemotePilot = {
    state: createShip(config),
    visual,
    thrusting: false,
    boosting: false,
    respawning: false,
  };
  remotePilots.set(id, pilot);
  scene.add(visual.group);
  return pilot;
}

function removeRemotePilot(id: string): void {
  const pilot = remotePilots.get(id);
  if (!pilot) return;
  scene.remove(pilot.visual.group);
  remotePilots.delete(id);
  for (let index = bullets.length - 1; index >= 0; index -= 1) {
    if (bullets[index].state.owner === id) removeBullet(index);
  }
}

function clearRemotePilots(): void {
  for (const pilot of remotePilots.values()) scene.remove(pilot.visual.group);
  remotePilots.clear();
}

function updateInput(): void {
  input.thrust = heldKeys.has("KeyW") || heldKeys.has("ArrowUp");
  input.reverse = heldKeys.has("KeyS") || heldKeys.has("ArrowDown");
  input.turnLeft = heldKeys.has("KeyA") || heldKeys.has("ArrowLeft");
  input.turnRight = heldKeys.has("KeyD") || heldKeys.has("ArrowRight");
  input.boost = heldKeys.has("ShiftLeft") || heldKeys.has("ShiftRight");
}

function createLocalShip(): ShipState {
  const state = createShip(config);
  const hash = hashString(localId);
  const spawnAngle = ((hash % 360) / 180) * Math.PI;
  state.position = {
    x: Math.cos(spawnAngle) * 155,
    y: Math.sin(spawnAngle) * 155,
  };
  state.angle = spawnAngle + Math.PI;
  return state;
}

function respawnLocalShip(): void {
  ship = createLocalShip();
  respawnTimer = 0;
  weaponCooldown = 0;
  localVisual.group.visible = true;
  clearBullets();
  networkAccumulator = networkInterval;
  cameraTarget.set(ship.position.x, ship.position.y, 0);
}

function destroyLocalShip(): void {
  ship.energy = 0;
  respawnTimer = 1.25;
  localVisual.group.visible = false;
  clearBullets();
  networkAccumulator = networkInterval;
}

function addBullet(state: BulletState, isLocal: boolean): void {
  const mesh = new THREE.Mesh(
    bulletGeometry,
    isLocal ? localBulletMaterial : remoteBulletMaterial,
  );
  mesh.position.z = 1;
  scene.add(mesh);
  bullets.push({ state, mesh });
}

function removeBullet(index: number): void {
  scene.remove(bullets[index].mesh);
  bullets.splice(index, 1);
}

function clearBullets(): void {
  for (const bullet of bullets) scene.remove(bullet.mesh);
  bullets.length = 0;
}

function togglePause(): void {
  paused = !paused;
  pausedOverlay.classList.toggle("hidden", !paused);
}

function toggleDiagnostics(): void {
  showDiagnostics = !showDiagnostics;
  diagnosticsPanel.classList.toggle("hidden", !showDiagnostics);
  diagnosticsGroup.visible = showDiagnostics;
}

function renderTuningControls(): void {
  tuningControls.replaceChildren();
  for (const field of tuningFields) {
    const row = document.createElement("label");
    const name = document.createElement("span");
    const value = document.createElement("output");
    const range = document.createElement("input");
    name.textContent = field.label;
    value.textContent = formatTuningValue(config[field.key]);
    range.type = "range";
    range.min = String(field.min);
    range.max = String(field.max);
    range.step = String(field.step);
    range.value = String(config[field.key]);
    range.addEventListener("input", () => {
      config[field.key] = Number(range.value);
      value.textContent = formatTuningValue(config[field.key]);
    });
    row.append(name, value, range);
    tuningControls.append(row);
  }
}

function formatTuningValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

const fixedStep = 1 / 120;
let accumulator = 0;
let previousTime = performance.now();

function frame(time: number): void {
  const frameDelta = Math.min((time - previousTime) / 1000, 0.1);
  previousTime = time;

  if (!paused && (joined || offline)) {
    accumulator += frameDelta;
    collidedThisFrame = false;
    while (accumulator >= fixedStep) {
      simulateFixedStep();
      accumulator -= fixedStep;
    }
  }

  renderWorld(frameDelta);
  requestAnimationFrame(frame);
}

function simulateFixedStep(): void {
  if (respawnTimer > 0) {
    respawnTimer = Math.max(0, respawnTimer - fixedStep);
    if (respawnTimer === 0) respawnLocalShip();
  } else {
    stepShip(ship, input, config, fixedStep);
    for (const wall of walls) {
      collidedThisFrame =
        resolveCircleAgainstRect(
          ship,
          wall,
          config.shipRadius,
          config.wallRestitution,
        ) || collidedThisFrame;
    }

    weaponCooldown = Math.max(0, weaponCooldown - fixedStep);
    if (heldKeys.has("Space") && weaponCooldown <= 0) {
      const state = fireBullet(ship, config, localId);
      if (state) {
        addBullet(state, true);
        broadcastShot(state);
        weaponCooldown = config.bulletCooldown;
      }
    }
  }

  for (let index = bullets.length - 1; index >= 0; index -= 1) {
    const bullet = bullets[index];
    stepBullet(bullet.state, fixedStep);
    const hitWall = walls.some((wall) =>
      circleIntersectsRect(bullet.state.position, 2.7, wall),
    );
    const hitLocal =
      bullet.state.owner !== localId &&
      respawnTimer === 0 &&
      circlesIntersect(bullet.state.position, 2.7, ship.position, config.shipRadius);
    const hitRemote =
      bullet.state.owner === localId &&
      [...remotePilots.values()].some(
        (pilot) =>
          !pilot.respawning &&
          circlesIntersect(
            bullet.state.position,
            2.7,
            pilot.state.position,
            config.shipRadius,
          ),
      );

    if (hitLocal) {
      ship.energy = Math.max(0, ship.energy - config.bulletDamage);
      if (ship.energy === 0) {
        destroyLocalShip();
        return;
      }
    }
    if (bullet.state.lifetime <= 0 || hitWall || hitLocal || hitRemote) {
      if (index < bullets.length) removeBullet(index);
    }
  }

  networkAccumulator += fixedStep;
  if (networkAccumulator >= networkInterval) {
    networkAccumulator %= networkInterval;
    broadcastState();
  }
}

function renderWorld(frameDelta: number): void {
  localVisual.group.position.set(ship.position.x, ship.position.y, 1);
  localVisual.group.rotation.z = ship.angle;
  const boosting = input.boost && input.thrust && ship.energy > 0 && !paused;
  localVisual.exhaust.visible = input.thrust && !paused && respawnTimer === 0;
  localVisual.exhaust.scale.y = boosting
    ? 1.7
    : 0.85 + Math.sin(performance.now() * 0.02) * 0.15;
  (localVisual.exhaust.material as THREE.MeshBasicMaterial).color.setHex(
    boosting ? 0xffd166 : 0x4bc8ff,
  );

  const interpolation = 1 - Math.exp(-12 * frameDelta);
  for (const pilot of remotePilots.values()) {
    pilot.visual.group.position.x +=
      (pilot.state.position.x - pilot.visual.group.position.x) * interpolation;
    pilot.visual.group.position.y +=
      (pilot.state.position.y - pilot.visual.group.position.y) * interpolation;
    const angleDifference = normalizeAngle(pilot.state.angle - pilot.visual.group.rotation.z);
    pilot.visual.group.rotation.z += angleDifference * interpolation;
    pilot.visual.exhaust.visible = pilot.thrusting && !pilot.respawning && !paused;
    pilot.visual.exhaust.scale.y = pilot.boosting ? 1.7 : 0.9;
  }

  for (const bullet of bullets) {
    bullet.mesh.position.set(bullet.state.position.x, bullet.state.position.y, 1);
  }

  cameraTarget.set(ship.position.x, ship.position.y, 0);
  const cameraLerp = 1 - Math.exp(-5 * frameDelta);
  camera.position.x += (cameraTarget.x - camera.position.x) * cameraLerp;
  camera.position.y += (cameraTarget.y - camera.position.y) * cameraLerp;

  diagnosticsGroup.position.set(ship.position.x, ship.position.y, 2);
  collisionRing.scale.setScalar(config.shipRadius / DEFAULT_FLIGHT_CONFIG.shipRadius);
  (collisionRing.material as THREE.LineBasicMaterial).color.setHex(
    collidedThisFrame ? 0xff5577 : 0x77ffb0,
  );
  updateLine(velocityLine, ship.velocity.x * 0.35, ship.velocity.y * 0.35);
  updateLine(headingLine, Math.cos(ship.angle) * 45, Math.sin(ship.angle) * 45);

  const energyPercent = Math.max(0, (ship.energy / config.maxEnergy) * 100);
  energyFill.style.width = `${energyPercent}%`;
  energyFill.classList.toggle("low", energyPercent < 25);
  energyValue.textContent = Math.round(ship.energy).toString().padStart(3, "0");
  speedValue.textContent = Math.round(speedOf(ship)).toString().padStart(3, "0");
  positionValue.textContent = `${Math.round(ship.position.x)}, ${Math.round(ship.position.y)}`;
  stateValue.textContent = !joined && !offline
    ? "WAITING"
    : paused
      ? "PAUSED"
      : respawnTimer > 0
        ? `RESPAWN ${respawnTimer.toFixed(1)}`
        : collidedThisFrame
          ? "IMPACT"
          : boosting
            ? "BOOST"
            : input.thrust || input.reverse
              ? "THRUST"
              : "DRIFT";

  renderer.render(scene, camera);
}

function createShipVisual(fill: number, outline: number, exhaustColor: number): ShipVisual {
  const group = new THREE.Group();
  const shape = new THREE.Shape()
    .moveTo(18, 0)
    .lineTo(-12, 10)
    .lineTo(-7, 0)
    .lineTo(-12, -10)
    .closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: fill }));
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: outline }),
  );
  const exhaust = new THREE.Mesh(
    new THREE.ConeGeometry(5, 22, 3),
    new THREE.MeshBasicMaterial({ color: exhaustColor, transparent: true, opacity: 0.85 }),
  );
  exhaust.rotation.z = -Math.PI / 2;
  exhaust.position.x = -20;
  group.add(mesh, edges, exhaust);
  return { group, exhaust };
}

function createBackground(): void {
  const stars = new Float32Array(900 * 3);
  let seed = 83492791;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let index = 0; index < 900; index += 1) {
    stars[index * 3] = (random() - 0.5) * worldWidth * 1.3;
    stars[index * 3 + 1] = (random() - 0.5) * worldHeight * 1.3;
    stars[index * 3 + 2] = -2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(stars, 3));
  scene.add(
    new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: 0x60738c, size: 1.4, sizeAttenuation: false }),
    ),
  );

  const grid = new THREE.GridHelper(worldWidth, 32, 0x162433, 0x101923);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -1;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.32;
  scene.add(grid);
}

function createWalls(): void {
  const wallMaterial = new THREE.MeshBasicMaterial({ color: 0x17232e });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x426278 });
  for (const wall of walls) {
    const geometry = new THREE.PlaneGeometry(wall.width, wall.height);
    const mesh = new THREE.Mesh(geometry, wallMaterial);
    mesh.position.set(wall.x + wall.width / 2, wall.y + wall.height / 2, 0);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial));
    scene.add(mesh);
  }
}

function makeLine(color: number): THREE.Line {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 }),
  );
}

function updateLine(line: THREE.Line, x: number, y: number): void {
  const attribute = line.geometry.getAttribute("position") as THREE.BufferAttribute;
  attribute.setXYZ(1, x, y, 0);
  attribute.needsUpdate = true;
}

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const viewHeight = 680;
  const viewWidth = viewHeight * (width / height);
  camera.left = -viewWidth / 2;
  camera.right = viewWidth / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundNetworkValue(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function colorFromId(id: string): number {
  const colors = [0xff5577, 0xffa85c, 0xc77dff, 0x7ee787, 0xff77d4];
  return colors[hashString(id) % colors.length];
}

window.addEventListener("resize", resize);
resize();
requestAnimationFrame(frame);
