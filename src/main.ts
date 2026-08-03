import * as THREE from "three";
import "./style.css";
import {
  circleIntersectsRect,
  circlesIntersect,
  computeCpuCommand,
  createShip,
  DEFAULT_FLIGHT_CONFIG,
  fireBullet,
  type BulletState,
  type FlightConfig,
  type FlightInput,
  type Rect,
  type ShipState,
  type Vec2,
  resolveCircleAgainstRect,
  resolveBulletAgainstRect,
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
    <div id="powerup-status" class="powerup-status">NO POWERUP</div>
    <dl>
      <div><dt>SPEED</dt><dd id="speed">0</dd></div>
      <div><dt>POSITION</dt><dd id="position">0, 0</dd></div>
      <div><dt>STATE</dt><dd id="state">WAITING</dd></div>
    </dl>
  </section>
  <section id="enemy-hud" class="enemy-hud hidden" aria-live="polite">
    <div class="enemy-energy-label"><span id="enemy-name">ENEMY ENERGY</span><output id="enemy-energy-value">100</output></div>
    <div class="enemy-energy-track"><div id="enemy-energy-fill"></div></div>
  </section>
  <section id="session-panel" class="session-panel hidden">
    <div><span>ROOM</span><strong id="room-name">OFFLINE</strong></div>
    <div><span>PILOTS</span><strong id="player-count">1</strong></div>
    <button id="leave-room" type="button">LEAVE</button>
    <div id="practice-controls" class="practice-controls hidden">
      <button id="add-cpu" type="button">ADD CPU</button>
      <button id="remove-cpu" type="button">REMOVE CPU</button>
    </div>
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
    <span><kbd>GAMEPAD</kbd> STICK FLY · A/RB FIRE · RT BOOST</span>
    <span><kbd>WHEEL</kbd> ZOOM</span>
    <span><kbd>R</kbd> RESPAWN</span>
    <span><kbd>P</kbd> PAUSE</span>
    <span id="tune-control"><kbd>\`</kbd> TUNE</span>
  </div>
  <div id="paused" class="paused hidden">PAUSED</div>
  <section id="lobby" class="lobby">
    <div class="lobby-card" role="group" aria-labelledby="lobby-title">
      <span class="eyebrow">PORTALS MULTIPLAYER</span>
      <h1 id="lobby-title">JOIN FLIGHT SESSION</h1>
      <p>Enter the same room code as the pilots you want to fly with.</p>
      <label for="room-code">ROOM CODE</label>
      <input id="room-code" maxlength="48" autocomplete="off" placeholder="ALPHA-7" />
      <button id="join-room" type="button">JOIN ROOM</button>
      <button id="offline-mode" class="secondary" type="button">PRACTICE OFFLINE</button>
      <output id="connection-message">READY</output>
    </div>
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
  shield: THREE.LineLoop;
}

type PowerupType = "shield" | "triple";

interface Powerup {
  id: string;
  type: PowerupType;
  position: Vec2;
  visual: THREE.Group;
  phase: number;
}

interface RemotePilot {
  state: ShipState;
  visual: ShipVisual;
  visualReady: boolean;
  shield: number;
  tripleShotTimer: number;
  thrusting: boolean;
  boosting: boolean;
  respawning: boolean;
  isCpu: boolean;
  cpuRespawnTimer: number;
  cpuWeaponCooldown: number;
}

interface RenderedBullet {
  state: BulletState;
  mesh: THREE.Mesh;
}

interface ExplosionParticle {
  mesh: THREE.Mesh;
  velocity: Vec2;
  spin: number;
  size: number;
  stretch: number;
  delay: number;
}

interface ExplosionEffect {
  group: THREE.Group;
  particles: ExplosionParticle[];
  shockwave: THREE.LineLoop;
  shockwaveMaterial: THREE.LineBasicMaterial;
  echoShockwave: THREE.LineLoop;
  echoShockwaveMaterial: THREE.LineBasicMaterial;
  flash: THREE.Mesh;
  flashMaterial: THREE.MeshBasicMaterial;
  age: number;
  duration: number;
}

const localVisual = createShipVisual(0xe9f2ff, 0x75d7ff, 0x4bc8ff);
localVisual.group.visible = false;
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
const powerups = new Map<string, Powerup>();
const bulletGeometry = new THREE.CircleGeometry(2.7, 8);
const localBulletMaterial = new THREE.MeshBasicMaterial({ color: 0x8ee8ff });
const remoteBulletMaterial = new THREE.MeshBasicMaterial({ color: 0xff6f88 });
const explosionPixelGeometry = new THREE.PlaneGeometry(1, 1);
const explosionColors = [0xffffff, 0xfff1a6, 0xffd166, 0xff8c42, 0xff5577, 0x69ddff];
const explosions: ExplosionEffect[] = [];
const shieldCapacity = 100;
const tripleShotDuration = 18;
const maxActivePowerups = 4;
const powerupSpawnMinimum = 10;
const powerupSpawnMaximum = 30;

let config: FlightConfig = { ...DEFAULT_FLIGHT_CONFIG };
let localId = "local";
let ship = createLocalShip();
let shipShield = 0;
let tripleShotTimer = 0;
let paused = false;
let showDiagnostics = false;
let collidedThisFrame = false;
let weaponCooldown = 0;
let respawnTimer = 0;
let joined = false;
let offline = false;
let activeRoom = "";
let networkAccumulator = 0;
const networkInterval = 0.12;
let cpuCounter = 0;
let cameraShake = 0;
let powerupCounter = 0;
let powerupSpawnTimer = randomPowerupDelay();

const input: FlightInput = {
  thrust: false,
  reverse: false,
  turnLeft: false,
  turnRight: false,
  boost: false,
};

const energyFill = getElement<HTMLElement>("energy-fill");
const energyValue = getElement<HTMLElement>("energy-value");
const powerupStatus = getElement<HTMLElement>("powerup-status");
const enemyHud = getElement<HTMLElement>("enemy-hud");
const enemyName = getElement<HTMLElement>("enemy-name");
const enemyEnergyFill = getElement<HTMLElement>("enemy-energy-fill");
const enemyEnergyValue = getElement<HTMLElement>("enemy-energy-value");
const speedValue = getElement<HTMLElement>("speed");
const positionValue = getElement<HTMLElement>("position");
const stateValue = getElement<HTMLElement>("state");
const diagnosticsPanel = getElement<HTMLElement>("diagnostics");
const pausedOverlay = getElement<HTMLElement>("paused");
const tuningControls = getElement<HTMLElement>("tuning-controls");
const lobby = getElement<HTMLElement>("lobby");
const roomCodeInput = getElement<HTMLInputElement>("room-code");
const joinButton = getElement<HTMLButtonElement>("join-room");
const offlineButton = getElement<HTMLButtonElement>("offline-mode");
const connectionMessage = getElement<HTMLOutputElement>("connection-message");
const sessionPanel = getElement<HTMLElement>("session-panel");
const roomName = getElement<HTMLElement>("room-name");
const playerCount = getElement<HTMLElement>("player-count");
const roster = getElement<HTMLUListElement>("roster");
const practiceControls = getElement<HTMLElement>("practice-controls");
const addCpuButton = getElement<HTMLButtonElement>("add-cpu");
const removeCpuButton = getElement<HTMLButtonElement>("remove-cpu");
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

if (!import.meta.env.DEV) {
  getElement<HTMLElement>("tune-control").classList.add("hidden");
}

joinButton.addEventListener("click", () => void joinRoom(roomCodeInput.value));
roomCodeInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  void joinRoom(roomCodeInput.value);
});

offlineButton.addEventListener("click", () => startOffline());
getElement<HTMLButtonElement>("leave-room").addEventListener("click", () => leaveRoom());
addCpuButton.addEventListener("click", () => spawnCpu());
removeCpuButton.addEventListener("click", () => removeCpu());
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
let activeGamepadIndex: number | null = null;
let gamepadThrust = false;
let gamepadReverse = false;
let gamepadTurnLeft = false;
let gamepadTurnRight = false;
let gamepadBoost = false;
let gamepadFire = false;
let gamepadPauseWasDown = false;
let gamepadRespawnWasDown = false;
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
  resetGamepadInput();
  updateInput();
});
window.addEventListener("gamepadconnected", (event) => {
  if (activeGamepadIndex === null) activeGamepadIndex = event.gamepad.index;
});
window.addEventListener("gamepaddisconnected", (event) => {
  if (activeGamepadIndex !== event.gamepad.index) return;
  activeGamepadIndex = null;
  resetGamepadInput();
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
  portalsNet.on("playerjoin", (_player, players) => {
    updateRoster(players);
    broadcastPowerupSync();
  });
  portalsNet.on("playerleave", (player, players) => {
    removeRemotePilot(player.id);
    updateRoster(players);
  });
  portalsNet.on("status", (status) => {
    console.info("Portals multiplayer status", status);
    if (status !== "disconnected") return;
    joined = false;
    connectionMessage.textContent = "CONNECTION LOST — JOIN AGAIN";
    showLobby();
    clearRemotePilots();
    clearExplosions();
    resetPowerupState();
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
  const channel = `flight-${code}`;
  try {
    const session = await portalsNet.join({ channel });
    localId = session.self.id;
    activeRoom = code.toUpperCase();
    joined = true;
    offline = false;
    networkAccumulator = networkInterval;
    resetPowerupState();
    respawnLocalShip();
    updateRoster(session.players);
    requestPowerupSync();
    roomName.textContent = activeRoom;
    sessionPanel.classList.remove("hidden");
    practiceControls.classList.add("hidden");
    lobby.classList.add("hidden");
    connectionMessage.textContent = "CONNECTED";
  } catch (error) {
    const detail = describeError(error);
    const hostHint = window.parent === window
      ? "OPEN THE GAME THROUGH ITS PORTALS GAME PAGE, NOT THE DIRECT DRAFT URL"
      : detail;
    connectionMessage.textContent = `JOIN FAILED — ${hostHint}`;
    console.error("Portals multiplayer join failed", {
      error,
      detail,
      embeddedInPortalsHost: window.parent !== window,
      channel,
    });
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
  clearRemotePilots();
  clearExplosions();
  resetPowerupState();
  respawnLocalShip();
  updateRoster([]);
  roomName.textContent = "OFFLINE";
  sessionPanel.classList.remove("hidden");
  practiceControls.classList.remove("hidden");
  lobby.classList.add("hidden");
}

function leaveRoom(): void {
  if (joined) portalsNet?.leave();
  joined = false;
  offline = false;
  activeRoom = "";
  clearRemotePilots();
  clearBullets();
  clearExplosions();
  clearPowerups();
  practiceControls.classList.add("hidden");
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
    let count = 1;
    for (const [id, pilot] of remotePilots) {
      if (!pilot.isCpu) continue;
      const cpuItem = document.createElement("li");
      cpuItem.textContent = `CPU ${id.replace("cpu-", "")}`;
      roster.append(cpuItem);
      count += 1;
    }
    playerCount.textContent = String(count);
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
  if (data.kind === "powerup-spawn") receivePowerupSpawn(data);
  if (data.kind === "powerup-pickup") receivePowerupPickup(data);
  if (data.kind === "powerup-sync") receivePowerupSync(data);
  if (data.kind === "powerup-sync-request" && isPowerupAuthority()) broadcastPowerupSync();
}

function updateRemoteState(fromId: string, data: Record<string, unknown>): void {
  const values = [data.x, data.y, data.vx, data.vy, data.angle, data.energy];
  if (!values.every(isFiniteNumber)) return;
  const pilot = getOrCreateRemotePilot(fromId);
  const wasRespawning = pilot.respawning;
  const wasSpawned = pilot.visualReady && !wasRespawning;
  pilot.state.position.x = clampNumber(data.x as number, -2000, 2000);
  pilot.state.position.y = clampNumber(data.y as number, -2000, 2000);
  pilot.state.velocity.x = clampNumber(data.vx as number, -1000, 1000);
  pilot.state.velocity.y = clampNumber(data.vy as number, -1000, 1000);
  pilot.state.angle = data.angle as number;
  pilot.state.energy = clampNumber(data.energy as number, 0, config.maxEnergy);
  pilot.shield = isFiniteNumber(data.shield)
    ? clampNumber(data.shield, 0, shieldCapacity)
    : pilot.shield;
  pilot.tripleShotTimer = isFiniteNumber(data.tripleShotTimer)
    ? clampNumber(data.tripleShotTimer, 0, tripleShotDuration)
    : pilot.tripleShotTimer;
  pilot.thrusting = data.thrusting === true;
  pilot.boosting = data.boosting === true;
  pilot.respawning = data.respawning === true;
  if (wasSpawned && pilot.respawning) spawnExplosion(pilot.state.position);
  if (pilot.respawning) {
    pilot.visualReady = false;
  } else if (!pilot.visualReady || wasRespawning) {
    snapVisualToState(pilot.visual, pilot.state);
    pilot.visualReady = true;
  }
  pilot.visual.group.visible = pilot.visualReady && !pilot.respawning;
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

function receivePowerupSpawn(data: Record<string, unknown>): void {
  if (
    typeof data.id !== "string" ||
    !isPowerupType(data.type) ||
    !isFiniteNumber(data.x) ||
    !isFiniteNumber(data.y)
  ) return;
  createPowerup(data.id, data.type, {
    x: clampNumber(data.x, -worldWidth / 2, worldWidth / 2),
    y: clampNumber(data.y, -worldHeight / 2, worldHeight / 2),
  });
}

function receivePowerupPickup(data: Record<string, unknown>): void {
  if (typeof data.id !== "string") return;
  removePowerup(data.id);
}

function receivePowerupSync(data: Record<string, unknown>): void {
  if (!Array.isArray(data.items)) return;
  clearPowerups();
  for (const item of data.items) {
    if (!isRecord(item) || typeof item.id !== "string" || !isPowerupType(item.type)) continue;
    if (!isFiniteNumber(item.x) || !isFiniteNumber(item.y)) continue;
    createPowerup(item.id, item.type, {
      x: clampNumber(item.x, -worldWidth / 2, worldWidth / 2),
      y: clampNumber(item.y, -worldHeight / 2, worldHeight / 2),
    });
  }
}

function broadcastPowerupSync(): void {
  if (!joined || !portalsNet || !isPowerupAuthority()) return;
  portalsNet.send({
    kind: "powerup-sync",
    items: [...powerups.values()].map((powerup) => ({
      id: powerup.id,
      type: powerup.type,
      x: roundNetworkValue(powerup.position.x),
      y: roundNetworkValue(powerup.position.y),
    })),
  });
}

function requestPowerupSync(): void {
  if (!joined || !portalsNet) return;
  portalsNet.send({ kind: "powerup-sync-request" });
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
    shield: roundNetworkValue(shipShield),
    tripleShotTimer: roundNetworkValue(tripleShotTimer),
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
    visualReady: false,
    shield: 0,
    tripleShotTimer: 0,
    thrusting: false,
    boosting: false,
    respawning: false,
    isCpu: false,
    cpuRespawnTimer: 0,
    cpuWeaponCooldown: 0,
  };
  visual.group.visible = false;
  remotePilots.set(id, pilot);
  scene.add(visual.group);
  return pilot;
}

function spawnCpu(): void {
  if (!offline) return;
  cpuCounter += 1;
  const id = `cpu-${cpuCounter}`;
  const state = createCpuShip();
  const visual = createShipVisual(0xffd9df, colorFromId(id), 0xff7a8f);
  snapVisualToState(visual, state);
  const pilot: RemotePilot = {
    state,
    visual,
    visualReady: true,
    shield: 0,
    tripleShotTimer: 0,
    thrusting: false,
    boosting: false,
    respawning: false,
    isCpu: true,
    cpuRespawnTimer: 0,
    cpuWeaponCooldown: 0,
  };
  remotePilots.set(id, pilot);
  scene.add(pilot.visual.group);
  updateRoster([]);
}

function removeCpu(): void {
  if (!offline) return;
  const cpuId = [...remotePilots.keys()].reverse().find((id) => id.startsWith("cpu-"));
  if (cpuId) removeRemotePilot(cpuId);
  updateRoster([]);
}

function createCpuShip(): ShipState {
  const state = createShip(config);
  const spawn = findRandomSpawn();
  state.position = spawn.position;
  state.angle = spawn.angle;
  return state;
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
  input.thrust = heldKeys.has("KeyW") || heldKeys.has("ArrowUp") || gamepadThrust;
  input.reverse = heldKeys.has("KeyS") || heldKeys.has("ArrowDown") || gamepadReverse;
  input.turnLeft = heldKeys.has("KeyA") || heldKeys.has("ArrowLeft") || gamepadTurnLeft;
  input.turnRight = heldKeys.has("KeyD") || heldKeys.has("ArrowRight") || gamepadTurnRight;
  input.boost = heldKeys.has("ShiftLeft") || heldKeys.has("ShiftRight") || gamepadBoost;
}

function pollGamepad(): void {
  const gamepad = getActiveGamepad();
  if (!gamepad || document.visibilityState === "hidden") {
    resetGamepadInput();
    updateInput();
    return;
  }

  const horizontal = readGamepadAxis(gamepad.axes[0]);
  const vertical = readGamepadAxis(gamepad.axes[1]);
  const dpadUp = isGamepadButtonDown(gamepad, 12);
  const dpadDown = isGamepadButtonDown(gamepad, 13);
  const dpadLeft = isGamepadButtonDown(gamepad, 14);
  const dpadRight = isGamepadButtonDown(gamepad, 15);

  gamepadThrust = vertical < -0.2 || dpadUp;
  gamepadReverse = vertical > 0.2 || dpadDown;
  gamepadTurnLeft = horizontal < -0.2 || dpadLeft;
  gamepadTurnRight = horizontal > 0.2 || dpadRight;
  gamepadBoost = isGamepadButtonDown(gamepad, 7);
  gamepadFire = isGamepadButtonDown(gamepad, 0) || isGamepadButtonDown(gamepad, 5);

  const pauseDown = isGamepadButtonDown(gamepad, 9);
  const respawnDown = isGamepadButtonDown(gamepad, 3);
  if (pauseDown && !gamepadPauseWasDown) togglePause();
  if (respawnDown && !gamepadRespawnWasDown) respawnLocalShip();
  gamepadPauseWasDown = pauseDown;
  gamepadRespawnWasDown = respawnDown;
  updateInput();
}

function getActiveGamepad(): Gamepad | null {
  if (typeof navigator.getGamepads !== "function") return null;
  const gamepads = navigator.getGamepads();
  if (activeGamepadIndex !== null) {
    const active = gamepads[activeGamepadIndex];
    if (active?.connected) return active;
  }
  const next = gamepads.find((gamepad): gamepad is Gamepad =>
    gamepad !== null && gamepad.connected,
  );
  activeGamepadIndex = next?.index ?? null;
  return next ?? null;
}

function isGamepadButtonDown(gamepad: Gamepad, index: number): boolean {
  return gamepad.buttons[index]?.pressed === true;
}

function readGamepadAxis(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const deadzone = 0.18;
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  return Math.sign(value) * ((magnitude - deadzone) / (1 - deadzone));
}

function resetGamepadInput(): void {
  gamepadThrust = false;
  gamepadReverse = false;
  gamepadTurnLeft = false;
  gamepadTurnRight = false;
  gamepadBoost = false;
  gamepadFire = false;
  gamepadPauseWasDown = false;
  gamepadRespawnWasDown = false;
}

function createLocalShip(): ShipState {
  const state = createShip(config);
  const spawn = findRandomSpawn();
  state.position = spawn.position;
  state.angle = spawn.angle;
  return state;
}

function findRandomSpawn(): { position: { x: number; y: number }; angle: number } {
  const margin = config.shipRadius + 8;
  const minX = -worldWidth / 2 + margin;
  const maxX = worldWidth / 2 - margin;
  const minY = -worldHeight / 2 + margin;
  const maxY = worldHeight / 2 - margin;

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const position = {
      x: minX + Math.random() * (maxX - minX),
      y: minY + Math.random() * (maxY - minY),
    };
    const insideWall = walls.some((wall) =>
      circleIntersectsRect(position, config.shipRadius + 4, wall),
    );
    if (!insideWall) {
      return { position, angle: Math.random() * Math.PI * 2 };
    }
  }

  return {
    position: { x: 0, y: 0 },
    angle: Math.random() * Math.PI * 2,
  };
}

function respawnLocalShip(): void {
  ship = createLocalShip();
  shipShield = 0;
  tripleShotTimer = 0;
  snapVisualToState(localVisual, ship);
  respawnTimer = 0;
  weaponCooldown = 0;
  localVisual.group.visible = true;
  clearBullets();
  networkAccumulator = networkInterval;
  cameraTarget.set(ship.position.x, ship.position.y, 0);
}

function destroyLocalShip(): void {
  spawnExplosion(ship.position, true);
  shipShield = 0;
  tripleShotTimer = 0;
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

function fireVolley(shipState: ShipState, owner: string, tripleShot: boolean): BulletState[] {
  const angleOffsets = tripleShot ? [-0.18, 0, 0.18] : [0];
  const volleyCost = config.bulletEnergyCost * angleOffsets.length;
  if (shipState.energy < volleyCost) return [];
  const shots: BulletState[] = [];
  for (const angleOffset of angleOffsets) {
    const bullet = fireBullet(shipState, config, owner, angleOffset);
    if (!bullet) return [];
    shots.push(bullet);
  }
  return shots;
}

function applyDamage(shipState: ShipState, shield: number, damage: number): number {
  const absorbed = Math.min(shield, damage);
  shipState.energy = Math.max(0, shipState.energy - (damage - absorbed));
  return shield - absorbed;
}

function removeBullet(index: number): void {
  scene.remove(bullets[index].mesh);
  bullets.splice(index, 1);
}

function clearBullets(): void {
  for (const bullet of bullets) scene.remove(bullet.mesh);
  bullets.length = 0;
}

function randomPowerupDelay(): number {
  return powerupSpawnMinimum + Math.random() * (powerupSpawnMaximum - powerupSpawnMinimum);
}

function resetPowerupState(): void {
  clearPowerups();
  powerupCounter = 0;
  powerupSpawnTimer = randomPowerupDelay();
}

function isPowerupAuthority(): boolean {
  if (offline) return true;
  if (!joined || !portalsNet) return false;
  const playerIds = [localId, ...portalsNet.players().map((player) => player.id)];
  playerIds.sort();
  return playerIds[0] === localId;
}

function isPowerupType(value: unknown): value is PowerupType {
  return value === "shield" || value === "triple";
}

function stepPowerups(): void {
  if (isPowerupAuthority()) {
    powerupSpawnTimer -= fixedStep;
    if (powerupSpawnTimer <= 0) {
      if (powerups.size < maxActivePowerups) spawnPowerup();
      powerupSpawnTimer = randomPowerupDelay();
    }
  }

  if (respawnTimer === 0) {
    const localPickup = findPowerupAt(ship.position);
    if (localPickup) collectPowerupForLocal(localPickup);
  }

  if (!offline) return;
  for (const [id, pilot] of remotePilots) {
    if (!pilot.isCpu || pilot.respawning) continue;
    const pickup = findPowerupAt(pilot.state.position);
    if (pickup) collectPowerupForPilot(id, pilot, pickup);
  }
}

function findPowerupAt(position: Vec2): Powerup | undefined {
  return [...powerups.values()].find((powerup) =>
    circlesIntersect(position, config.shipRadius, powerup.position, 18),
  );
}

function spawnPowerup(): void {
  const position = findRandomPowerupPosition();
  if (!position) return;
  powerupCounter += 1;
  const type: PowerupType = Math.random() < 0.5 ? "shield" : "triple";
  const id = `powerup-${powerupCounter}`;
  createPowerup(id, type, position);
  if (joined && portalsNet) {
    portalsNet.send({
      kind: "powerup-spawn",
      id,
      type,
      x: roundNetworkValue(position.x),
      y: roundNetworkValue(position.y),
    });
  }
}

function findRandomPowerupPosition(): Vec2 | null {
  const margin = 38;
  const minX = -worldWidth / 2 + margin;
  const maxX = worldWidth / 2 - margin;
  const minY = -worldHeight / 2 + margin;
  const maxY = worldHeight / 2 - margin;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const position = {
      x: minX + Math.random() * (maxX - minX),
      y: minY + Math.random() * (maxY - minY),
    };
    if (walls.some((wall) => circleIntersectsRect(position, 20, wall))) continue;
    if ([...powerups.values()].some((powerup) =>
      distanceSquared(position, powerup.position) < 75 * 75,
    )) continue;
    return position;
  }
  return null;
}

function createPowerup(id: string, type: PowerupType, position: Vec2): void {
  if (powerups.has(id)) return;
  const visual = createPowerupVisual(type);
  visual.position.set(position.x, position.y, 2);
  scene.add(visual);
  powerups.set(id, {
    id,
    type,
    position: { ...position },
    visual,
    phase: Math.random() * Math.PI * 2,
  });
}

function collectPowerupForLocal(powerup: Powerup): void {
  applyPowerup(powerup.type, shipShield, tripleShotTimer, (shield, triple) => {
    shipShield = shield;
    tripleShotTimer = triple;
  });
  removePowerup(powerup.id);
  if (joined && portalsNet) {
    portalsNet.send({ kind: "powerup-pickup", id: powerup.id, picker: localId });
  }
}

function collectPowerupForPilot(id: string, pilot: RemotePilot, powerup?: Powerup): void {
  const pickup = powerup ?? findPowerupAt(pilot.state.position);
  if (!pickup) return;
  applyPowerup(pickup.type, pilot.shield, pilot.tripleShotTimer, (shield, triple) => {
    pilot.shield = shield;
    pilot.tripleShotTimer = triple;
  });
  removePowerup(pickup.id);
  if (joined && portalsNet) {
    portalsNet.send({ kind: "powerup-pickup", id: pickup.id, picker: id });
  }
}

function applyPowerup(
  type: PowerupType,
  currentShield: number,
  currentTripleTimer: number,
  setValues: (shield: number, tripleTimer: number) => void,
): void {
  if (type === "shield") {
    setValues(shieldCapacity, currentTripleTimer);
  } else {
    setValues(currentShield, Math.max(currentTripleTimer, tripleShotDuration));
  }
}

function removePowerup(id: string): void {
  const powerup = powerups.get(id);
  if (!powerup) return;
  scene.remove(powerup.visual);
  disposePowerupVisual(powerup.visual);
  powerups.delete(id);
}

function clearPowerups(): void {
  for (const id of [...powerups.keys()]) removePowerup(id);
}

function createPowerupVisual(type: PowerupType): THREE.Group {
  const group = new THREE.Group();
  const color = type === "shield" ? 0xffffff : 0xffd166;
  const points = Array.from({ length: 8 }, (_, index) => {
    const angle = (index / 8) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle) * 17, Math.sin(angle) * 17, 0);
  });
  group.add(
    new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    ),
  );

  const core = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 7),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  core.rotation.z = Math.PI / 4;
  group.add(core);

  if (type === "shield") {
    group.add(
      new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(
          [
            new THREE.Vector3(0, 7, 0),
            new THREE.Vector3(6, 0, 0),
            new THREE.Vector3(0, -7, 0),
            new THREE.Vector3(-6, 0, 0),
          ],
        ),
        new THREE.LineBasicMaterial({ color: 0x69ddff, transparent: true, opacity: 0.9 }),
      ),
    );
  } else {
    for (const x of [-6, 0, 6]) {
      group.add(
        new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(
            [
              new THREE.Vector3(x + 3, 0, 0),
              new THREE.Vector3(x, 4, 0),
              new THREE.Vector3(x - 3, 0, 0),
              new THREE.Vector3(x, -4, 0),
            ],
          ),
          new THREE.LineBasicMaterial({ color: 0xff8c42, transparent: true, opacity: 0.9 }),
        ),
      );
    }
  }
  return group;
}

function updatePowerupVisuals(frameDelta: number): void {
  const time = performance.now() * 0.004;
  for (const powerup of powerups.values()) {
    powerup.visual.rotation.z += frameDelta * (powerup.type === "shield" ? 0.7 : -0.9);
    const pulse = 1 + Math.sin(time + powerup.phase) * 0.1;
    powerup.visual.scale.setScalar(pulse);
  }
}

function disposePowerupVisual(group: THREE.Group): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.LineLoop)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}

function spawnExplosion(position: Vec2, shakeCamera = false): void {
  if (shakeCamera) cameraShake = Math.min(8, cameraShake + 4);
  const group = new THREE.Group();
  group.position.set(position.x, position.y, 3);

  const shockwavePoints = Array.from({ length: 8 }, (_, index) => {
    const angle = (index / 8) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
  });
  const shockwaveMaterial = new THREE.LineBasicMaterial({
    color: 0xffd166,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const shockwave = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(shockwavePoints),
    shockwaveMaterial,
  );
  shockwave.scale.setScalar(0.2);
  group.add(shockwave);

  const echoShockwaveMaterial = new THREE.LineBasicMaterial({
    color: 0xff5577,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const echoShockwave = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(shockwavePoints),
    echoShockwaveMaterial,
  );
  echoShockwave.scale.setScalar(0.15);
  group.add(echoShockwave);

  const flashMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const flash = new THREE.Mesh(explosionPixelGeometry, flashMaterial);
  flash.rotation.z = Math.PI / 4;
  flash.scale.set(24, 24, 1);
  group.add(flash);

  const particles: ExplosionParticle[] = [];
  for (let index = 0; index < 30; index += 1) {
    const angle = (index / 30) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
    const speed = 80 + Math.random() * 240;
    const size = 2 + Math.floor(Math.random() * 4);
    const stretch = index % 3 === 0 ? 2.2 : 1;
    const delay = index > 20 ? Math.random() * 0.1 : 0;
    const mesh = new THREE.Mesh(
      explosionPixelGeometry,
      new THREE.MeshBasicMaterial({
        color: explosionColors[index % explosionColors.length],
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    mesh.position.set((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7, 0);
    mesh.rotation.z = angle + Math.PI / 2;
    mesh.scale.set(size * stretch, size, 1);
    mesh.visible = delay === 0;
    group.add(mesh);
    particles.push({
      mesh,
      velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      spin: (Math.random() - 0.5) * 9,
      size,
      stretch,
      delay,
    });
  }

  scene.add(group);
  explosions.push({
    group,
    particles,
    shockwave,
    shockwaveMaterial,
    echoShockwave,
    echoShockwaveMaterial,
    flash,
    flashMaterial,
    age: 0,
    duration: 0.92,
  });
}

function updateExplosions(deltaSeconds: number): void {
  cameraShake = Math.max(0, cameraShake - deltaSeconds * 24);
  for (let index = explosions.length - 1; index >= 0; index -= 1) {
    const effect = explosions[index];
    effect.age += deltaSeconds;
    const waveProgress = Math.min(effect.age / 0.62, 1);
    const echoProgress = Math.max(0, Math.min((effect.age - 0.12) / 0.7, 1));
    effect.shockwave.scale.setScalar(0.2 + waveProgress * 22);
    effect.shockwaveMaterial.opacity = (1 - waveProgress) * 0.95;
    effect.echoShockwave.scale.setScalar(0.15 + echoProgress * 30);
    effect.echoShockwaveMaterial.opacity = (1 - echoProgress) * 0.7;

    const flashProgress = Math.min(effect.age / 0.18, 1);
    effect.flash.scale.setScalar(4 + (1 - flashProgress) * 22);
    effect.flashMaterial.opacity = (1 - flashProgress) ** 2 * 0.95;

    const drag = Math.max(0, 1 - deltaSeconds * 2.1);
    for (const particle of effect.particles) {
      if (effect.age < particle.delay) continue;
      particle.mesh.visible = true;
      particle.mesh.position.x += particle.velocity.x * deltaSeconds;
      particle.mesh.position.y += particle.velocity.y * deltaSeconds;
      particle.velocity.x *= drag;
      particle.velocity.y *= drag;
      particle.mesh.rotation.z += particle.spin * deltaSeconds;
      const particleProgress = Math.min(
        (effect.age - particle.delay) / (effect.duration - particle.delay),
        1,
      );
      const particleFade = 1 - particleProgress;
      particle.mesh.scale.set(
        particle.size * particle.stretch * (0.55 + particleFade * 0.45),
        particle.size * (0.55 + particleFade * 0.45),
        1,
      );
      (particle.mesh.material as THREE.MeshBasicMaterial).opacity = particleFade * 0.95;
    }

    if (effect.age >= effect.duration) removeExplosion(index);
  }
}

function removeExplosion(index: number): void {
  const effect = explosions[index];
  scene.remove(effect.group);
  effect.shockwave.geometry.dispose();
  effect.shockwaveMaterial.dispose();
  effect.echoShockwave.geometry.dispose();
  effect.echoShockwaveMaterial.dispose();
  effect.flashMaterial.dispose();
  for (const particle of effect.particles) {
    (particle.mesh.material as THREE.MeshBasicMaterial).dispose();
  }
  explosions.splice(index, 1);
}

function clearExplosions(): void {
  for (let index = explosions.length - 1; index >= 0; index -= 1) {
    removeExplosion(index);
  }
  cameraShake = 0;
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
      saveFlightConfig();
    });
    row.append(name, value, range);
    tuningControls.append(row);
  }
}

function formatTuningValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

let configSaveTimer: number | undefined;

function saveFlightConfig(): void {
  if (!import.meta.env.DEV) return;
  window.clearTimeout(configSaveTimer);
  configSaveTimer = window.setTimeout(() => {
    void fetch("/__flight-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }).then((response) => {
      if (!response.ok) throw new Error(`Config save failed (${response.status})`);
    }).catch((error: unknown) => {
      console.warn("Could not save local flight config", error);
    });
  }, 180);
}

const fixedStep = 1 / 120;
let accumulator = 0;
let previousTime = performance.now();

function frame(time: number): void {
  const frameDelta = Math.min((time - previousTime) / 1000, 0.1);
  previousTime = time;
  pollGamepad();

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
    tripleShotTimer = Math.max(0, tripleShotTimer - fixedStep);
    if ((heldKeys.has("Space") || gamepadFire) && weaponCooldown <= 0) {
      const shots = fireVolley(ship, localId, tripleShotTimer > 0);
      if (shots.length > 0) {
        for (const state of shots) {
          addBullet(state, true);
          broadcastShot(state);
        }
        weaponCooldown = config.bulletCooldown;
      }
    }
  }

  stepCpuPilots();
  stepPowerups();

  for (let index = bullets.length - 1; index >= 0; index -= 1) {
    const bullet = bullets[index];
    stepBullet(bullet.state, fixedStep);
    for (const wall of walls) {
      resolveBulletAgainstRect(bullet.state, wall, 2.7, config.wallRestitution);
    }
    const hitLocal =
      bullet.state.owner !== localId &&
      respawnTimer === 0 &&
      circlesIntersect(bullet.state.position, 2.7, ship.position, config.shipRadius);
    const ownerPilot = remotePilots.get(bullet.state.owner);
    const canHitRemotePilot =
      bullet.state.owner === localId || ownerPilot?.isCpu === true;
    const hitRemotePilot = canHitRemotePilot
      ? [...remotePilots.entries()].find(
          ([id, pilot]) =>
            id !== bullet.state.owner &&
            !pilot.respawning &&
            (bullet.state.owner === localId || ownerPilot?.isCpu === true) &&
            circlesIntersect(
              bullet.state.position,
              2.7,
              pilot.state.position,
              config.shipRadius,
            ),
        )?.[1]
      : undefined;
    const hitRemote = Boolean(hitRemotePilot);

    if (hitLocal) {
      shipShield = applyDamage(ship, shipShield, config.bulletDamage);
      if (ship.energy === 0) {
        destroyLocalShip();
        return;
      }
    }
    if (hitRemotePilot?.isCpu) {
      hitRemotePilot.shield = applyDamage(
        hitRemotePilot.state,
        hitRemotePilot.shield,
        config.bulletDamage,
      );
      if (hitRemotePilot.state.energy === 0) {
        spawnExplosion(hitRemotePilot.state.position);
        hitRemotePilot.shield = 0;
        hitRemotePilot.tripleShotTimer = 0;
        hitRemotePilot.respawning = true;
        hitRemotePilot.cpuRespawnTimer = 1.25;
        hitRemotePilot.visualReady = false;
        hitRemotePilot.visual.group.visible = false;
      }
    }
    if (bullet.state.lifetime <= 0 || hitLocal || hitRemote) {
      if (index < bullets.length) removeBullet(index);
    }
  }

  networkAccumulator += fixedStep;
  if (networkAccumulator >= networkInterval) {
    networkAccumulator %= networkInterval;
    broadcastState();
  }
}

function stepCpuPilots(): void {
  if (!offline) return;
  for (const [cpuId, pilot] of remotePilots) {
    if (!pilot.isCpu) continue;
    pilot.cpuWeaponCooldown = Math.max(0, pilot.cpuWeaponCooldown - fixedStep);
    pilot.tripleShotTimer = Math.max(0, pilot.tripleShotTimer - fixedStep);

    if (pilot.cpuRespawnTimer > 0) {
      pilot.cpuRespawnTimer = Math.max(0, pilot.cpuRespawnTimer - fixedStep);
      if (pilot.cpuRespawnTimer === 0) {
        pilot.state = createCpuShip();
        pilot.shield = 0;
        pilot.tripleShotTimer = 0;
        snapVisualToState(pilot.visual, pilot.state);
        pilot.visualReady = true;
        pilot.respawning = false;
        pilot.visual.group.visible = true;
      }
      continue;
    }

    const target = findCpuTarget(cpuId, pilot.state);
    if (!target) {
      pilot.thrusting = false;
      pilot.boosting = false;
      continue;
    }

    const command = computeCpuCommand(pilot.state, target, config);
    pilot.thrusting = command.input.thrust;
    pilot.boosting = command.input.boost;
    stepShip(pilot.state, command.input, config, fixedStep);
    for (const wall of walls) {
      resolveCircleAgainstRect(
        pilot.state,
        wall,
        config.shipRadius,
        config.wallRestitution,
      );
    }

    if (command.shouldFire && pilot.cpuWeaponCooldown <= 0) {
      const shots = fireVolley(pilot.state, cpuId, pilot.tripleShotTimer > 0);
      if (shots.length > 0) {
        for (const bullet of shots) addBullet(bullet, false);
        pilot.cpuWeaponCooldown = config.bulletCooldown;
      }
    }
  }
}

function findCpuTarget(cpuId: string, cpu: ShipState): ShipState | null {
  let target: ShipState | null = respawnTimer === 0 ? ship : null;
  let closestDistance = target
    ? distanceSquared(cpu.position, target.position)
    : Number.POSITIVE_INFINITY;

  for (const [id, pilot] of remotePilots) {
    if (id === cpuId || !pilot.isCpu || pilot.respawning) continue;
    const distance = distanceSquared(cpu.position, pilot.state.position);
    if (distance >= closestDistance) continue;
    target = pilot.state;
    closestDistance = distance;
  }
  return target;
}

function distanceSquared(first: Vec2, second: Vec2): number {
  const x = first.x - second.x;
  const y = first.y - second.y;
  return x * x + y * y;
}

function updateEnemyEnergyHud(): void {
  let target: [string, RemotePilot] | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const entry of remotePilots.entries()) {
    const [, pilot] = entry;
    if (pilot.respawning || !pilot.visualReady) continue;
    const distance = distanceSquared(ship.position, pilot.state.position);
    if (distance >= closestDistance) continue;
    closestDistance = distance;
    target = entry;
  }

  if (!target) {
    enemyHud.classList.add("hidden");
    return;
  }

  const [id, pilot] = target;
  const energyPercent = THREE.MathUtils.clamp(
    (pilot.state.energy / config.maxEnergy) * 100,
    0,
    100,
  );
  const label = pilot.isCpu ? `CPU ${id.replace("cpu-", "")}` : `ENEMY ${id.slice(0, 6)}`;
  enemyName.textContent = label;
  enemyEnergyValue.textContent = Math.round(pilot.state.energy).toString().padStart(3, "0");
  enemyEnergyFill.style.width = `${energyPercent}%`;
  enemyEnergyFill.classList.toggle("low", energyPercent < 25);
  enemyHud.classList.remove("hidden");
}

function renderWorld(frameDelta: number): void {
  localVisual.group.position.set(ship.position.x, ship.position.y, 1);
  localVisual.group.rotation.z = ship.angle;
  updateShieldVisual(localVisual, shipShield);
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
    updateShieldVisual(pilot.visual, pilot.shield);
    pilot.visual.exhaust.visible = pilot.thrusting && !pilot.respawning && !paused;
    pilot.visual.exhaust.scale.y = pilot.boosting ? 1.7 : 0.9;
  }

  for (const bullet of bullets) {
    bullet.mesh.position.set(bullet.state.position.x, bullet.state.position.y, 1);
  }

  if (!paused) updateExplosions(frameDelta);
  if (!paused) updatePowerupVisuals(frameDelta);

  cameraTarget.set(ship.position.x, ship.position.y, 0);
  const cameraLerp = 1 - Math.exp(-5 * frameDelta);
  camera.position.x += (cameraTarget.x - camera.position.x) * cameraLerp;
  camera.position.y += (cameraTarget.y - camera.position.y) * cameraLerp;
  if (!paused && cameraShake > 0) {
    camera.position.x += (Math.random() - 0.5) * cameraShake;
    camera.position.y += (Math.random() - 0.5) * cameraShake;
  }

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
  updateEnemyEnergyHud();
  const activePowerups = [];
  if (shipShield > 0) activePowerups.push(`SHIELD ${Math.ceil(shipShield)}`);
  if (tripleShotTimer > 0) activePowerups.push(`TRIPLE ${tripleShotTimer.toFixed(1)}s`);
  powerupStatus.textContent = activePowerups.join("  ·  ") || "NO POWERUP";
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

function snapVisualToState(visual: ShipVisual, state: ShipState): void {
  visual.group.position.set(state.position.x, state.position.y, 1);
  visual.group.rotation.z = state.angle;
}

function updateShieldVisual(visual: ShipVisual, shield: number): void {
  const strength = THREE.MathUtils.clamp(shield / shieldCapacity, 0, 1);
  visual.shield.visible = strength > 0;
  const material = visual.shield.material as THREE.LineBasicMaterial;
  const shade = 0.45 + strength * 0.55;
  material.color.setRGB(shade, shade, shade);
  material.opacity = 0.18 + strength * 0.62;
}

function createShipVisual(fill: number, outline: number, exhaustColor: number): ShipVisual {
  const group = new THREE.Group();
  const shipWidthScale = 1.2;
  const shape = new THREE.Shape()
    .moveTo(18, 0)
    .lineTo(-12, 10 * shipWidthScale)
    .lineTo(-7, 0)
    .lineTo(-12, -10 * shipWidthScale)
    .closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: fill }));
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: outline }),
  );
  const exhaust = new THREE.Mesh(
    new THREE.ConeGeometry(5 * shipWidthScale, 22, 3),
    new THREE.MeshBasicMaterial({ color: exhaustColor, transparent: true, opacity: 0.85 }),
  );
  exhaust.rotation.z = -Math.PI / 2;
  exhaust.position.x = -20;
  const shield = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 16 }, (_, index) => {
        const angle = (index / 16) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(angle) * 23, Math.sin(angle) * 23, 0.2);
      }),
    ),
    new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
    }),
  );
  shield.visible = false;
  group.add(mesh, edges, exhaust, shield);
  return { group, exhaust, shield };
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

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.toUpperCase();
  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "";
    const message = typeof error.message === "string" ? error.message : "";
    const combined = [code, message].filter(Boolean).join(": ");
    if (combined) return combined.toUpperCase();
  }
  if (typeof error === "string" && error) return error.toUpperCase();
  return "UNKNOWN PORTALS SDK ERROR — CHECK THE BROWSER CONSOLE";
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
