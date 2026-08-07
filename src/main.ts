import * as THREE from "three";
import "./style.css";
import { ArcadeAudio } from "./audio";
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
const arcadeAudio = new ArcadeAudio();

app.innerHTML = `
  <canvas id="game" aria-label="VECTORFALL multiplayer space combat"></canvas>
  <section class="hud" aria-live="polite">
    <div class="energy-label"><span>ENERGY</span><output id="energy-value">100</output></div>
    <div class="energy-track"><div id="energy-fill"></div></div>
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
    <div><span>SECTOR</span><strong id="sector-name">CLASSIC</strong></div>
    <div><span>PILOTS</span><strong id="player-count">1</strong></div>
    <button id="leave-room" type="button">LEAVE</button>
    <div id="practice-controls" class="practice-controls hidden">
      <button id="add-cpu" type="button">ADD CPU</button>
      <button id="remove-cpu" type="button">REMOVE CPU</button>
    </div>
    <ul id="roster"></ul>
  </section>
  <section id="chat-panel" class="voice-panel hidden" aria-label="Voice chat controls">
    <div class="chat-heading"><span>VOICE</span><span id="voice-status">VOICE OFF</span></div>
    <div id="chat-log" class="chat-log hidden" role="log" aria-live="polite" aria-label="Chat messages"></div>
    <form id="chat-form" class="chat-form hidden">
      <input id="chat-input" maxlength="300" autocomplete="off" placeholder="MESSAGE…" aria-label="Chat message" />
      <button type="submit">SEND</button>
    </form>
    <div class="voice-controls">
      <span>MIC</span><button id="voice-toggle" type="button">ENABLE VOICE</button>
    </div>
  </section>
  <section id="powerup-tray" class="powerup-tray hidden" aria-label="Active powerups" aria-live="polite">
    <div class="powerup-tray-heading">ACTIVE SYSTEMS</div>
    <div class="powerup-cards">
      <article id="shield-powerup-card" class="powerup-card shield-card hidden">
        <span class="powerup-card-icon">◇</span>
        <div class="powerup-card-details">
          <div><strong>SHIELD</strong><output id="shield-powerup-value">100 HP</output></div>
          <div class="powerup-card-track"><div id="shield-powerup-fill"></div></div>
        </div>
      </article>
      <article id="triple-powerup-card" class="powerup-card triple-card hidden">
        <span class="powerup-card-icon">Ⅲ</span>
        <div class="powerup-card-details">
          <div><strong>TRIPLE</strong><output id="triple-powerup-value">18.0s</output></div>
          <div class="powerup-card-track"><div id="triple-powerup-fill"></div></div>
        </div>
      </article>
      <article id="missile-powerup-card" class="powerup-card missile-card hidden">
        <span class="powerup-card-icon">➤</span>
        <div class="powerup-card-details">
          <div><strong>HOMING</strong><output id="missile-powerup-value">7.0s</output></div>
          <div class="powerup-card-track"><div id="missile-powerup-fill"></div></div>
        </div>
      </article>
      <article id="laser-powerup-card" class="powerup-card laser-card hidden">
        <span class="powerup-card-icon">━</span>
        <div class="powerup-card-details">
          <div><strong>LASER</strong><output id="laser-powerup-value">12.0s</output></div>
          <div class="powerup-card-track"><div id="laser-powerup-fill"></div></div>
        </div>
      </article>
    </div>
  </section>
  <aside id="diagnostics" class="diagnostics hidden">
    <div class="panel-heading"><span>FLIGHT TUNING</span><button id="reset-tuning">RESET</button></div>
    <div id="tuning-controls"></div>
    <p>Settings affect only your local ship.</p>
  </aside>
  <button id="help-button" class="help-button" type="button" aria-label="Open controls" aria-haspopup="dialog" aria-controls="controls-modal" aria-expanded="false">?</button>
  <button id="settings-button" class="settings-button hidden" type="button" aria-label="Open settings" aria-haspopup="dialog" aria-controls="settings-modal" aria-expanded="false">⚙</button>
  <section id="controls-modal" class="controls-modal hidden" role="dialog" aria-modal="true" aria-labelledby="controls-title">
    <div class="controls-card">
      <div class="controls-heading">
        <div><span class="eyebrow">PILOT MANUAL</span><h2 id="controls-title">FLIGHT CONTROLS</h2></div>
        <button id="close-controls" class="close-controls" type="button" aria-label="Close controls">×</button>
      </div>
      <div class="controls-grid">
        <section>
          <h3>KEYBOARD / MOUSE</h3>
          <div class="control-list">
            <div><kbd>WASD / ARROWS</kbd><span>FLY</span></div>
            <div><kbd>SHIFT</kbd><span>BOOST</span></div>
            <div><kbd>SPACE</kbd><span>FIRE</span></div>
            <div><kbd>WHEEL</kbd><span>ZOOM</span></div>
            <div><kbd>P</kbd><span>PAUSE</span></div>
            <div id="tune-control"><kbd>\`</kbd><span>FLIGHT TUNING</span></div>
          </div>
        </section>
        <section>
          <h3>GAMEPAD</h3>
          <div class="control-list">
            <div><kbd>LEFT STICK / D-PAD</kbd><span>FLY</span></div>
            <div><kbd>RT</kbd><span>BOOST</span></div>
            <div><kbd>A / RB</kbd><span>FIRE</span></div>
            <div><kbd>MENU</kbd><span>PAUSE</span></div>
          </div>
        </section>
      </div>
    </div>
  </section>
  <section id="settings-modal" class="controls-modal hidden" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <div class="controls-card settings-card">
      <div class="controls-heading">
        <div><span class="eyebrow">SYSTEM MENU</span><h2 id="settings-title">SETTINGS</h2></div>
        <button id="close-settings" class="close-controls" type="button" aria-label="Close settings">×</button>
      </div>
      <button id="settings-leave-match" class="settings-leave-match" type="button">LEAVE MATCH</button>
    </div>
  </section>
  <section id="leaderboard" class="leaderboard hidden" aria-label="Match leaderboard">
    <div class="leaderboard-heading"><span>LEADERBOARD</span><button id="expand-leaderboard" type="button" aria-label="Expand leaderboard">↗</button></div>
    <ol id="leaderboard-top-five"></ol>
  </section>
  <section id="leaderboard-modal" class="controls-modal hidden" role="dialog" aria-modal="true" aria-labelledby="leaderboard-title">
    <div class="controls-card leaderboard-card">
      <div class="controls-heading">
        <div><span class="eyebrow">MATCH STANDINGS</span><h2 id="leaderboard-title">LEADERBOARD</h2></div>
        <button id="close-leaderboard" class="close-controls" type="button" aria-label="Close leaderboard">×</button>
      </div>
      <ol id="leaderboard-all" class="leaderboard-all"></ol>
    </div>
  </section>
  <div id="winner-celebration" class="winner-celebration hidden" aria-live="assertive">
    <strong id="winner-message"></strong>
    <div id="confetti" class="confetti" aria-hidden="true"></div>
  </div>
  <div id="paused" class="paused hidden">PAUSED</div>
  <section id="lobby" class="lobby">
    <div class="lobby-art" aria-hidden="true"></div>
    <div class="arcade-brand">
      <span class="arcade-kicker">WARLYWARE PRESENTS</span>
      <h1 id="lobby-title"><span>VECTOR</span><span>FALL</span></h1>
      <div class="arcade-subtitle"><i></i><span>VECTOR COMBAT</span><i></i></div>
    </div>
    <div id="lobby-card" class="lobby-card" role="group" aria-labelledby="mode-title">
      <div class="lobby-card-heading">
        <span class="eyebrow">PILOT ACCESS</span>
        <span class="cabinet-lights" aria-hidden="true"><i></i><i></i><i></i></span>
      </div>
      <div id="lobby-main-menu" class="lobby-menu-view">
        <h2 id="mode-title">SELECT FLIGHT MODE</h2>
        <p>Establish a new combat sector, join an active frequency, or enter solo simulation.</p>
        <button id="open-create-menu" type="button"><span>CREATE GAME</span><small>HOST</small></button>
        <button id="open-join-menu" class="secondary" type="button"><span>JOIN GAME</span><small>CODE</small></button>
        <button id="open-rooms-menu" class="secondary" type="button"><span>PUBLIC GAMES</span><small>LIST</small></button>
        <button id="offline-mode" class="secondary practice-button" type="button"><span>PRACTICE</span><small>CPU</small></button>
      </div>
      <div id="lobby-create-menu" class="lobby-menu-view hidden">
        <button class="lobby-back" data-lobby-back type="button">‹ BACK</button>
        <h2>CREATE GAME</h2>
        <p>Configure a combat sector, then share its generated room code with other pilots.</p>
        <label for="create-map">SECTOR MAP</label>
        <select id="create-map">
          <option value="classic">CLASSIC ARENA</option>
          <option value="crossroads">CROSSROADS</option>
          <option value="open">OPEN VOID</option>
        </select>
        <label for="create-game-mode">GAME MODE</label>
        <select id="create-game-mode">
          <option value="endless">ENDLESS</option>
          <option value="top-score">TOP SCORE</option>
        </select>
        <div id="score-to-win-field" class="score-to-win-field hidden">
          <label for="create-score-to-win">POINTS NEEDED TO WIN</label>
          <input id="create-score-to-win" type="number" min="1" max="100" step="1" value="5" />
        </div>
        <span class="lobby-field-label">ACTIVE POWERUPS</span>
        <div class="powerup-options">
          <label>
            <input id="create-shield" type="checkbox" checked />
            <span><strong>SHIELD</strong><small>Absorbs incoming weapon damage until its charge is depleted.</small></span>
          </label>
          <label>
            <input id="create-triple" type="checkbox" checked />
            <span><strong>TRIPLE CANNON</strong><small>Fires a three-projectile spread for 18 seconds.</small></span>
          </label>
          <label>
            <input id="create-missile" type="checkbox" checked />
            <span><strong>HOMING MISSILES</strong><small>Launches guided projectiles that steer toward the nearest enemy.</small></span>
          </label>
          <label>
            <input id="create-laser" type="checkbox" checked />
            <span><strong>LASERS</strong><small>Upgrades the cannon with fast, high-damage energy bolts.</small></span>
          </label>
        </div>
        <span class="lobby-field-label">GAMEPLAY OPTIONS</span>
        <div class="powerup-options game-options">
          <label>
            <input id="create-wormholes" type="checkbox" checked />
            <span><strong>WORMHOLES</strong><small>Periodically opens linked rifts that transport ships across the arena.</small></span>
          </label>
          <label>
            <input id="create-public" type="checkbox" checked />
            <span><strong>PUBLIC GAME</strong><small>Lists this game in the public room browser and allows Quick Match to find it.</small></span>
          </label>
          <label>
            <input id="create-join-progress" type="checkbox" checked />
            <span><strong>ALLOW JOIN IN PROGRESS</strong><small>Allows additional pilots to enter after the match has reached two players.</small></span>
          </label>
        </div>
        <label for="create-room-code">ROOM CODE</label>
        <div class="arcade-input-frame">
          <span aria-hidden="true">CH</span>
          <input id="create-room-code" maxlength="48" autocomplete="off" />
        </div>
        <button id="create-room" type="button"><span>CREATE SECTOR</span><small>HOST</small></button>
      </div>
      <div id="lobby-join-menu" class="lobby-menu-view hidden">
        <button class="lobby-back" data-lobby-back type="button">‹ BACK</button>
        <h2>JOIN GAME</h2>
        <p>Enter the room code transmitted by the pilot who created the game.</p>
        <label for="room-code">ROOM CODE</label>
        <div class="arcade-input-frame">
          <span aria-hidden="true">CH</span>
          <input id="room-code" maxlength="48" autocomplete="off" placeholder="ALPHA-7" />
        </div>
        <button id="join-room" type="button"><span>JOIN SECTOR</span><small>1P</small></button>
      </div>
      <div id="lobby-rooms-menu" class="lobby-menu-view hidden">
        <button class="lobby-back" data-lobby-back type="button">‹ BACK</button>
        <h2>PUBLIC GAMES</h2>
        <p>Select a live global match or use Quick Match to find the best available room.</p>
        <button id="rooms-quick-match" type="button"><span>QUICK MATCH</span><small>AUTO</small></button>
        <div id="room-list" class="room-list" aria-live="polite"></div>
        <button id="refresh-rooms" class="secondary" type="button"><span>REFRESH LIST</span><small>↻</small></button>
      </div>
      <output id="connection-message">SYSTEM READY // INSERT CALLSIGN</output>
    </div>
    <div class="arcade-footer"><span>© VECTORFALL SYSTEMS</span><span>WASD / GAMEPAD READY</span></div>
  </section>
`;

const canvas = getElement<HTMLCanvasElement>("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x070a0f);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 160);
camera.position.z = 60;
const cameraTarget = new THREE.Vector3();
const minCameraZoom = 0.55;
const maxCameraZoom = 2.25;

const worldWidth = 1600;
const worldHeight = 1100;
type ArenaMapId = "classic" | "crossroads" | "open";

const arenaBoundary: Rect[] = [
  { x: -800, y: -550, width: 1600, height: 28 },
  { x: -800, y: 522, width: 1600, height: 28 },
  { x: -800, y: -550, width: 28, height: 1100 },
  { x: 772, y: -550, width: 28, height: 1100 },
];
const arenaMaps: Record<ArenaMapId, Rect[]> = {
  classic: [
    ...arenaBoundary,
    { x: -320, y: -220, width: 40, height: 440 },
    { x: 280, y: -220, width: 40, height: 440 },
    { x: -120, y: 250, width: 240, height: 36 },
    { x: -120, y: -286, width: 240, height: 36 },
  ],
  crossroads: [
    ...arenaBoundary,
    { x: -500, y: -18, width: 360, height: 36 },
    { x: 140, y: -18, width: 360, height: 36 },
    { x: -18, y: -390, width: 36, height: 250 },
    { x: -18, y: 140, width: 36, height: 250 },
    { x: -470, y: -330, width: 100, height: 70 },
    { x: 370, y: 260, width: 100, height: 70 },
  ],
  open: [
    ...arenaBoundary,
    { x: -420, y: -280, width: 110, height: 70 },
    { x: 310, y: -280, width: 110, height: 70 },
    { x: -420, y: 210, width: 110, height: 70 },
    { x: 310, y: 210, width: 110, height: 70 },
  ],
};
let activeMapId: ArenaMapId = "classic";
let walls: Rect[] = arenaMaps[activeMapId].map((wall) => ({ ...wall }));
const wallGroup = new THREE.Group();
scene.add(wallGroup);

interface StarLayer {
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  material: THREE.PointsMaterial;
  parallax: number;
  timeOffset: number;
  twinkleSpeed: number;
  baseOpacity: number;
  baseSize: number;
}

const starLayers: StarLayer[] = [];

createBackground();
createWalls();

interface ShipVisual {
  group: THREE.Group;
  exhaust: THREE.Group;
  shield: THREE.Group;
}

type PowerupType = "shield" | "triple" | "missile" | "laser";
type WeaponType = "standard" | "missile" | "laser";

interface GameSettings {
  map: ArenaMapId;
  powerups: PowerupType[];
  wormholes: boolean;
  gameMode: "endless" | "top-score";
  scoreToWin: number;
}

interface Powerup {
  id: string;
  type: PowerupType;
  position: Vec2;
  visual: THREE.Group;
  phase: number;
}

interface WormholePair {
  id: string;
  color: number;
  first: Vec2;
  second: Vec2;
  visual: THREE.Group;
  age: number;
  phase: number;
}

interface WormholeExit {
  pair: WormholePair;
  entryIndex: 0 | 1;
  entry: Vec2;
  destination: Vec2;
}

interface WormholeTransit {
  start: Vec2;
  destination: Vec2;
  remaining: number;
}

interface WormholeJumpParticle {
  mesh: THREE.Mesh;
  delay: number;
  travelDuration: number;
  phase: number;
  lateral: number;
  size: number;
  spin: number;
}

interface WormholeJumpEffect {
  group: THREE.Group;
  particles: WormholeJumpParticle[];
  start: Vec2;
  end: Vec2;
  age: number;
  duration: number;
}

interface RemotePilot {
  state: ShipState;
  visual: ShipVisual;
  visualReady: boolean;
  shield: number;
  tripleShotTimer: number;
  homingMissileTimer: number;
  laserTimer: number;
  thrusting: boolean;
  boosting: boolean;
  respawning: boolean;
  isCpu: boolean;
  cpuRespawnTimer: number;
  cpuWeaponCooldown: number;
  wormholeCooldown: number;
  transiting: boolean;
  wormholeTransit: WormholeTransit | null;
}

interface RenderedBullet {
  state: BulletState;
  mesh: THREE.Mesh;
  weapon: WeaponType;
  networkId?: number;
}

interface LaserBeamEffect {
  group: THREE.Group;
  materials: THREE.MeshBasicMaterial[];
  age: number;
  duration: number;
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
const laserBeams: LaserBeamEffect[] = [];
const powerups = new Map<string, Powerup>();
const wormholePairs = new Map<string, WormholePair>();
const bulletGeometry = new THREE.CircleGeometry(2.7, 8);
const localBulletMaterial = new THREE.MeshBasicMaterial({ color: 0x8ee8ff });
const remoteBulletMaterial = new THREE.MeshBasicMaterial({ color: 0xff6f88 });
const missileGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(7, 0, 0),
  new THREE.Vector3(-5, 4, 0),
  new THREE.Vector3(-2, 0, 0),
  new THREE.Vector3(-5, -4, 0),
]);
missileGeometry.setIndex([0, 1, 2, 0, 2, 3]);
missileGeometry.computeVertexNormals();
const localMissileMaterial = new THREE.MeshBasicMaterial({ color: 0xffd166 });
const remoteMissileMaterial = new THREE.MeshBasicMaterial({ color: 0xff765e });
const laserBeamGeometry = new THREE.PlaneGeometry(1, 1);
const explosionPixelGeometry = new THREE.PlaneGeometry(1, 1);
const explosionColors = [0xffffff, 0xfff1a6, 0xffd166, 0xff8c42, 0xff5577, 0x69ddff];
const explosions: ExplosionEffect[] = [];
const wormholeJumpEffects: WormholeJumpEffect[] = [];
const shieldCapacity = 100;
const tripleShotDuration = 18;
const homingMissileDuration = 7;
const laserDuration = 12;
const laserEnergyMultiplier = 1.2;
const maxActivePowerups = 4;
const powerupSpawnMinimum = 10;
const powerupSpawnMaximum = 30;
const wormholeRadius = 28;
const wormholeLifetime = 20;
const wormholeFadeInDuration = 1.25;
const wormholeFadeOutDuration = 1.75;
const wormholeTransitDuration = 1.02;
const maxActiveWormholePairs = 3;
const wormholeSpawnMinimum = 10;
const wormholeSpawnMaximum = 20;
const wormholeColors = [
  0x69ddff,
  0xff5577,
  0xffd166,
  0xc77dff,
  0x7ee787,
  0xffa85c,
];

let config: FlightConfig = { ...DEFAULT_FLIGHT_CONFIG };
let localId = "local";
let ship = createLocalShip();
let shipShield = 0;
let tripleShotTimer = 0;
let homingMissileTimer = 0;
let laserTimer = 0;
let paused = false;
let showDiagnostics = false;
let collidedThisFrame = false;
let weaponCooldown = 0;
let respawnTimer = 0;
let joined = false;
let netConnected = false;
let offline = false;
let serverAuthorityActive = false;
let serverFallbackActive = false;
let logicalRoomMode = false;
let hasReceivedServerSnapshot = false;
let lastServerSnapshotAt = 0;
let serverInputSequence = 0;
let serverInputElapsed = 0;
let lastServerInputMask = -1;
let lastServerFire = false;
let activeRoom = "";
let activeRoomCode = "";
let activeRoomStream = "";
let activeChannel = "";
let voiceJoined = false;
let voiceJoinToken = 0;
const speakingIds = new Set<string>();
let networkAccumulator = 0;
const networkInterval = 0.12;
let cpuCounter = 0;
let cameraShake = 0;
let powerupCounter = 0;
let powerupSpawnTimer = randomPowerupDelay();
let wormholeCounter = 0;
let wormholeSpawnTimer = randomWormholeDelay();
let wormholeCooldown = 0;
let wormholeTransit: WormholeTransit | null = null;
let activeGameSettings: GameSettings = {
  map: "classic",
  powerups: ["shield", "triple", "missile", "laser"],
  wormholes: true,
  gameMode: "endless",
  scoreToWin: 5,
};
let isGameCreator = false;
let pendingRoomRequest = false;
let roomRequestToken = 0;
const currentRoomPlayerIds = new Set<string>();
const unknownEnemyNumbers = new Map<string, number>();
let unknownEnemyCounter = 0;
const playerScores = new Map<string, number>();
let leaderboardModalOpen = false;
let winnerCelebrationTimer: number | undefined;

interface PublicRoomListing {
  code: string;
  players: number;
  capacity: number;
  map: ArenaMapId;
  active: boolean;
  allowJoinInProgress: boolean;
}

let publicRoomListings: PublicRoomListing[] = [];

const input: FlightInput = {
  thrust: false,
  reverse: false,
  turnLeft: false,
  turnRight: false,
  boost: false,
};

const energyFill = getElement<HTMLElement>("energy-fill");
const energyValue = getElement<HTMLElement>("energy-value");
const powerupTray = getElement<HTMLElement>("powerup-tray");
const shieldPowerupCard = getElement<HTMLElement>("shield-powerup-card");
const shieldPowerupValue = getElement<HTMLOutputElement>("shield-powerup-value");
const shieldPowerupFill = getElement<HTMLElement>("shield-powerup-fill");
const triplePowerupCard = getElement<HTMLElement>("triple-powerup-card");
const triplePowerupValue = getElement<HTMLOutputElement>("triple-powerup-value");
const triplePowerupFill = getElement<HTMLElement>("triple-powerup-fill");
const missilePowerupCard = getElement<HTMLElement>("missile-powerup-card");
const missilePowerupValue = getElement<HTMLOutputElement>("missile-powerup-value");
const missilePowerupFill = getElement<HTMLElement>("missile-powerup-fill");
const laserPowerupCard = getElement<HTMLElement>("laser-powerup-card");
const laserPowerupValue = getElement<HTMLOutputElement>("laser-powerup-value");
const laserPowerupFill = getElement<HTMLElement>("laser-powerup-fill");
const enemyHud = getElement<HTMLElement>("enemy-hud");
const enemyName = getElement<HTMLElement>("enemy-name");
const enemyEnergyFill = getElement<HTMLElement>("enemy-energy-fill");
const enemyEnergyValue = getElement<HTMLElement>("enemy-energy-value");
const speedValue = getElement<HTMLElement>("speed");
const positionValue = getElement<HTMLElement>("position");
const stateValue = getElement<HTMLElement>("state");
const diagnosticsPanel = getElement<HTMLElement>("diagnostics");
const pausedOverlay = getElement<HTMLElement>("paused");
const helpButton = getElement<HTMLButtonElement>("help-button");
const controlsModal = getElement<HTMLElement>("controls-modal");
const closeControlsButton = getElement<HTMLButtonElement>("close-controls");
const tuningControls = getElement<HTMLElement>("tuning-controls");
const lobby = getElement<HTMLElement>("lobby");
const lobbyCard = getElement<HTMLElement>("lobby-card");
const lobbyMainMenu = getElement<HTMLElement>("lobby-main-menu");
const lobbyCreateMenu = getElement<HTMLElement>("lobby-create-menu");
const lobbyJoinMenu = getElement<HTMLElement>("lobby-join-menu");
const lobbyRoomsMenu = getElement<HTMLElement>("lobby-rooms-menu");
const openCreateMenuButton = getElement<HTMLButtonElement>("open-create-menu");
const openJoinMenuButton = getElement<HTMLButtonElement>("open-join-menu");
const openRoomsMenuButton = getElement<HTMLButtonElement>("open-rooms-menu");
const roomsQuickMatchButton = getElement<HTMLButtonElement>("rooms-quick-match");
const refreshRoomsButton = getElement<HTMLButtonElement>("refresh-rooms");
const roomList = getElement<HTMLElement>("room-list");
const createRoomButton = getElement<HTMLButtonElement>("create-room");
const createRoomCodeInput = getElement<HTMLInputElement>("create-room-code");
const createMapSelect = getElement<HTMLSelectElement>("create-map");
const createGameModeSelect = getElement<HTMLSelectElement>("create-game-mode");
const scoreToWinField = getElement<HTMLElement>("score-to-win-field");
const createScoreToWinInput = getElement<HTMLInputElement>("create-score-to-win");
const createShieldInput = getElement<HTMLInputElement>("create-shield");
const createTripleInput = getElement<HTMLInputElement>("create-triple");
const createMissileInput = getElement<HTMLInputElement>("create-missile");
const createLaserInput = getElement<HTMLInputElement>("create-laser");
const createWormholesInput = getElement<HTMLInputElement>("create-wormholes");
const createPublicInput = getElement<HTMLInputElement>("create-public");
const createJoinProgressInput = getElement<HTMLInputElement>("create-join-progress");
const roomCodeInput = getElement<HTMLInputElement>("room-code");
const joinButton = getElement<HTMLButtonElement>("join-room");
const offlineButton = getElement<HTMLButtonElement>("offline-mode");
const connectionMessage = getElement<HTMLOutputElement>("connection-message");
const sessionPanel = getElement<HTMLElement>("session-panel");
const roomName = getElement<HTMLElement>("room-name");
const sectorName = getElement<HTMLElement>("sector-name");
const playerCount = getElement<HTMLElement>("player-count");
const roster = getElement<HTMLUListElement>("roster");
const practiceControls = getElement<HTMLElement>("practice-controls");
const addCpuButton = getElement<HTMLButtonElement>("add-cpu");
const removeCpuButton = getElement<HTMLButtonElement>("remove-cpu");
const chatPanel = getElement<HTMLElement>("chat-panel");
const chatLog = getElement<HTMLElement>("chat-log");
const chatForm = getElement<HTMLFormElement>("chat-form");
const chatInput = getElement<HTMLInputElement>("chat-input");
const voiceStatus = getElement<HTMLElement>("voice-status");
const voiceToggle = getElement<HTMLButtonElement>("voice-toggle");
const settingsButton = getElement<HTMLButtonElement>("settings-button");
const settingsModal = getElement<HTMLElement>("settings-modal");
const closeSettingsButton = getElement<HTMLButtonElement>("close-settings");
const settingsLeaveMatchButton = getElement<HTMLButtonElement>("settings-leave-match");
const leaderboard = getElement<HTMLElement>("leaderboard");
const leaderboardTopFive = getElement<HTMLOListElement>("leaderboard-top-five");
const expandLeaderboardButton = getElement<HTMLButtonElement>("expand-leaderboard");
const leaderboardModal = getElement<HTMLElement>("leaderboard-modal");
const closeLeaderboardButton = getElement<HTMLButtonElement>("close-leaderboard");
const leaderboardAll = getElement<HTMLOListElement>("leaderboard-all");
const winnerCelebration = getElement<HTMLElement>("winner-celebration");
const winnerMessage = getElement<HTMLElement>("winner-message");
const confetti = getElement<HTMLElement>("confetti");
const portalsNet = window.Portals?.net;
const portalsVoice = window.Portals?.voice;
const voiceChatEnabled = false;

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
setupVoiceEvents();

if (!import.meta.env.DEV) {
  getElement<HTMLElement>("tune-control").classList.add("hidden");
}

openCreateMenuButton.addEventListener("click", () => {
  createRoomCodeInput.value = generateRoomCode();
  setLobbyMenu("create");
});
openJoinMenuButton.addEventListener("click", () => setLobbyMenu("join"));
openRoomsMenuButton.addEventListener("click", () => void openRoomBrowser());
roomsQuickMatchButton.addEventListener("click", () => void quickMatch());
refreshRoomsButton.addEventListener("click", () => void refreshRoomDirectory());
document.querySelectorAll<HTMLButtonElement>("[data-lobby-back]").forEach((button) => {
  button.addEventListener("click", () => setLobbyMenu("main"));
});
createRoomButton.addEventListener("click", () => void createGame());
createGameModeSelect.addEventListener("change", () => {
  scoreToWinField.classList.toggle("hidden", createGameModeSelect.value !== "top-score");
});
createRoomCodeInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  void createGame();
});
joinButton.addEventListener("click", () => void joinRoom(roomCodeInput.value));
roomCodeInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  void joinRoom(roomCodeInput.value);
});

offlineButton.addEventListener("click", () => startOffline());
getElement<HTMLButtonElement>("leave-room").addEventListener("click", () => leaveRoom());
settingsButton.addEventListener("click", () => setSettingsModalVisible(true));
closeSettingsButton.addEventListener("click", () => setSettingsModalVisible(false));
settingsModal.addEventListener("pointerdown", (event) => {
  if (event.target === settingsModal) setSettingsModalVisible(false);
});
settingsLeaveMatchButton.addEventListener("click", () => {
  setSettingsModalVisible(false);
  leaveRoom();
});
expandLeaderboardButton.addEventListener("click", () => setLeaderboardModalVisible(true));
closeLeaderboardButton.addEventListener("click", () => setLeaderboardModalVisible(false));
leaderboardModal.addEventListener("pointerdown", (event) => {
  if (event.target === leaderboardModal) setLeaderboardModalVisible(false);
});
addCpuButton.addEventListener("click", () => spawnCpu());
removeCpuButton.addEventListener("click", () => removeCpu());
chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendChatMessage();
});
voiceToggle.addEventListener("click", () => {
  if (voiceJoined) {
    toggleVoiceMute();
  } else {
    void startVoice(activeChannel);
  }
});
helpButton.addEventListener("click", () => setControlsModalVisible(true));
closeControlsButton.addEventListener("click", () => setControlsModalVisible(false));
controlsModal.addEventListener("pointerdown", (event) => {
  if (event.target === controlsModal) setControlsModalVisible(false);
});
getElement<HTMLButtonElement>("reset-tuning").addEventListener("click", () => {
  config = { ...DEFAULT_FLIGHT_CONFIG };
  ship.energy = Math.min(ship.energy, config.maxEnergy);
  renderTuningControls();
});

if (!portalsNet) {
  connectionMessage.textContent = "PORTALS SDK UNAVAILABLE — OFFLINE PRACTICE ONLY";
  joinButton.disabled = true;
  createRoomButton.disabled = true;
  openRoomsMenuButton.disabled = true;
  roomsQuickMatchButton.disabled = true;
  refreshRoomsButton.disabled = true;
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
let controlsModalOpen = false;
let settingsModalOpen = false;
window.addEventListener("keydown", (event) => {
  arcadeAudio.unlock();
  if (event.code === "Escape" && settingsModalOpen) {
    event.preventDefault();
    setSettingsModalVisible(false);
    return;
  }
  if (event.code === "Escape" && leaderboardModalOpen) {
    event.preventDefault();
    setLeaderboardModalVisible(false);
    return;
  }
  if (event.code === "Escape" && controlsModalOpen) {
    event.preventDefault();
    setControlsModalVisible(false);
    return;
  }
  if (controlsModalOpen || settingsModalOpen || leaderboardModalOpen) return;
  if (isTextEntryTarget(event.target)) return;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
    event.preventDefault();
  }
  if (event.repeat && ["KeyP", "Backquote"].includes(event.code)) return;
  heldKeys.add(event.code);
  if (event.code === "KeyP") togglePause();
  if (event.code === "Backquote") toggleDiagnostics();
  updateInput();
});
window.addEventListener("pointerdown", () => arcadeAudio.unlock(), { once: true });
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

function setupVoiceEvents(): void {
  if (!voiceChatEnabled || !portalsVoice) {
    renderVoiceUnavailable();
    return;
  }
  renderVoiceOff();
  portalsVoice.on("participantjoin", (_participant, _participants) => {
    refreshCurrentRoster();
  });
  portalsVoice.on("participantleave", (participant, _participants) => {
    speakingIds.delete(participant.id);
    refreshCurrentRoster();
  });
  portalsVoice.on("speaking", (ids) => {
    speakingIds.clear();
    for (const id of ids) speakingIds.add(id);
    refreshCurrentRoster();
  });
  portalsVoice.on("status", (status) => {
    if (status !== "disconnected") return;
    voiceJoined = false;
    speakingIds.clear();
    renderVoiceOff();
    if (joined && portalsNet) {
      refreshCurrentRoster();
      appendChatSystem("VOICE DISCONNECTED — TRY ENABLE VOICE");
    }
  });
}

async function startVoice(channel: string): Promise<void> {
  if (!voiceChatEnabled || !portalsVoice || !joined || !channel || voiceJoined) return;
  const token = ++voiceJoinToken;
  voiceStatus.textContent = "VOICE CONNECTING…";
  voiceToggle.disabled = true;
  try {
    await portalsVoice.join({ channel });
    if (token !== voiceJoinToken || !joined) {
      leaveVoiceSafely("Could not leave stale Portals voice session");
      return;
    }
    voiceJoined = true;
    speakingIds.clear();
    refreshCurrentRoster();
    // Voice is receive-ready, but microphone transmission is always opt-in.
    portalsVoice.setMuted(true);
    renderVoiceLive(true);
  } catch (error) {
    if (token !== voiceJoinToken) return;
    voiceJoined = false;
    renderVoiceOff();
    console.info("Portals voice unavailable", error);
  } finally {
    if (token === voiceJoinToken) voiceToggle.disabled = !portalsVoice;
  }
}

function stopVoice(): void {
  voiceJoinToken += 1;
  speakingIds.clear();
  const wasJoined = voiceJoined;
  voiceJoined = false;
  if (wasJoined && portalsVoice) {
    leaveVoiceSafely("Could not leave Portals voice session");
  }
  if (portalsVoice) renderVoiceOff();
  else renderVoiceUnavailable();
}

function toggleVoiceMute(): void {
  if (!portalsVoice || !voiceJoined) return;
  const muted = !portalsVoice.muted();
  portalsVoice.setMuted(muted);
  renderVoiceLive(muted);
}

function leaveVoiceSafely(message: string): void {
  if (!portalsVoice) return;
  void Promise.resolve(portalsVoice.leave()).catch((error: unknown) => {
    console.warn(message, error);
  });
}

function renderVoiceUnavailable(): void {
  voiceJoined = false;
  voiceStatus.textContent = "VOICE UNAVAILABLE";
  voiceToggle.textContent = "UNAVAILABLE";
  voiceToggle.disabled = true;
}

function renderVoiceOff(): void {
  voiceStatus.textContent = "VOICE OFF";
  voiceToggle.textContent = "ENABLE VOICE";
  voiceToggle.disabled = !portalsVoice;
}

function renderVoiceLive(muted: boolean): void {
  voiceStatus.textContent = muted ? "VOICE MUTED" : "VOICE LIVE";
  voiceToggle.textContent = muted ? "UNMUTE MIC" : "MUTE MIC";
  voiceToggle.disabled = false;
}

function setLobbyMenu(view: "main" | "create" | "join" | "rooms"): void {
  lobbyCard.classList.toggle("create-dialog", view === "create" || view === "rooms");
  lobbyMainMenu.classList.toggle("hidden", view !== "main");
  lobbyCreateMenu.classList.toggle("hidden", view !== "create");
  lobbyJoinMenu.classList.toggle("hidden", view !== "join");
  lobbyRoomsMenu.classList.toggle("hidden", view !== "rooms");
  connectionMessage.textContent = portalsNet
    ? "SYSTEM READY // INSERT CALLSIGN"
    : "PORTALS SDK UNAVAILABLE — OFFLINE PRACTICE ONLY";
  if (view === "join") window.setTimeout(() => roomCodeInput.focus(), 0);
  if (view === "rooms") renderRoomDirectory();
}

function generateRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "VF-";
  for (let index = 0; index < 5; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

async function createGame(): Promise<void> {
  const powerups: PowerupType[] = [];
  if (createShieldInput.checked) powerups.push("shield");
  if (createTripleInput.checked) powerups.push("triple");
  if (createMissileInput.checked) powerups.push("missile");
  if (createLaserInput.checked) powerups.push("laser");
  const map = isArenaMapId(createMapSelect.value) ? createMapSelect.value : "classic";
  const gameMode = createGameModeSelect.value === "top-score" ? "top-score" : "endless";
  const scoreToWin = clampNumber(Math.round(Number(createScoreToWinInput.value) || 5), 1, 100);
  createScoreToWinInput.value = String(scoreToWin);
  await joinRoom(createRoomCodeInput.value, {
    map,
    powerups,
    wormholes: createWormholesInput.checked,
    gameMode,
    scoreToWin,
  }, {
    isPublic: createPublicInput.checked,
    allowJoinInProgress: createJoinProgressInput.checked,
  });
}

function setupMultiplayerEvents(): void {
  if (!portalsNet) return;
  portalsNet.on("message", handleNetworkMessage);
  portalsNet.on("playerjoin", () => {});
  portalsNet.on("playerleave", (player) => {
    speakingIds.delete(player.id);
    if (currentRoomPlayerIds.delete(player.id)) {
      removeRemotePilot(player.id);
      refreshCurrentRoster();
    }
  });
  portalsNet.on("status", (status) => {
    console.info("Portals multiplayer status", status);
    if (status !== "disconnected") return;
    joined = false;
    netConnected = false;
    pendingRoomRequest = false;
    roomRequestToken += 1;
    resetServerAuthorityState();
    activeChannel = "";
    activeRoomCode = "";
    activeRoomStream = "";
    currentRoomPlayerIds.clear();
    resetUnknownEnemyNumbers();
    connectionMessage.textContent = "CONNECTION LOST — JOIN AGAIN";
    showLobby();
    settingsButton.classList.add("hidden");
    leaderboard.classList.add("hidden");
    leaderboardModal.classList.add("hidden");
    leaderboardModalOpen = false;
    hideWinnerCelebration();
    settingsModal.classList.add("hidden");
    settingsModalOpen = false;
    clearRemotePilots();
    clearExplosions();
    resetPowerupState();
    resetWormholeState();
    stopVoice();
    clearChat();
    setChatVisible(false);
  });
  portalsNet.on("state", (key, value) => {
    if (key === "server:rooms") {
      receiveRoomDirectory(value);
      return;
    }
    if (key === "server:ready" && isRecord(value)) {
      serverAuthorityActive = value.authority === "server";
      if (joined && serverAuthorityActive && !hasReceivedServerSnapshot) {
        connectionMessage.textContent = "SERVER READY — SYNCHRONIZING…";
      }
    }
  });
}

async function joinRoom(
  rawCode: string,
  createdSettings?: GameSettings,
  options?: { isPublic: boolean; allowJoinInProgress: boolean },
): Promise<void> {
  if (!portalsNet) return;
  const code = normalizeRoomCode(rawCode);
  if (!code) {
    connectionMessage.textContent = "USE LETTERS, NUMBERS, DASHES, OR UNDERSCORES";
    return;
  }

  joinButton.disabled = true;
  createRoomButton.disabled = true;
  offlineButton.disabled = true;
  connectionMessage.textContent = "CONNECTING…";
  isGameCreator = Boolean(createdSettings);
  try {
    await ensureGlobalConnection();
    connectionMessage.textContent = createdSettings ? "CREATING GAME…" : "JOINING GAME…";
    queueRoomRequest(createdSettings ? {
      k: "create-room",
      room: code,
      settings: createdSettings,
      public: options?.isPublic !== false,
      joinInProgress: options?.allowJoinInProgress !== false,
    } : { k: "join-room", room: code });
  } catch (error) {
    isGameCreator = false;
    const detail = describeError(error);
    const hostHint = window.parent === window
      ? "OPEN THE GAME THROUGH ITS PORTALS GAME PAGE, NOT THE DIRECT DRAFT URL"
      : detail;
    connectionMessage.textContent = `JOIN FAILED — ${hostHint}`;
    console.error("Portals multiplayer join failed", {
      error,
      detail,
      embeddedInPortalsHost: window.parent !== window,
      room: code,
    });
  } finally {
    joinButton.disabled = false;
    createRoomButton.disabled = !portalsNet;
    offlineButton.disabled = false;
  }
}

async function ensureGlobalConnection(): Promise<void> {
  if (!portalsNet) throw new Error("Portals multiplayer unavailable");
  if (netConnected && portalsNet.self()) {
    localId = portalsNet.self()!.id;
    return;
  }
  const session = await portalsNet.join({ channel: "global:vectorfall" });
  netConnected = true;
  localId = session.self.id;
  serverAuthorityActive = isRecord(session.state["server:ready"]);
  receiveRoomDirectory(session.state["server:rooms"]);
}

async function openRoomBrowser(): Promise<void> {
  setLobbyMenu("rooms");
  await refreshRoomDirectory();
}

async function refreshRoomDirectory(): Promise<void> {
  if (!portalsNet) return;
  refreshRoomsButton.disabled = true;
  connectionMessage.textContent = "CONTACTING GLOBAL DIRECTORY…";
  try {
    await ensureGlobalConnection();
    receiveRoomDirectory(portalsNet.getState("server:rooms"));
    connectionMessage.textContent = "GLOBAL DIRECTORY ONLINE";
  } catch (error) {
    connectionMessage.textContent = `DIRECTORY UNAVAILABLE — ${describeError(error)}`;
  } finally {
    refreshRoomsButton.disabled = false;
  }
}

async function quickMatch(): Promise<void> {
  if (!portalsNet || pendingRoomRequest) return;
  connectionMessage.textContent = "SEARCHING FOR MATCH…";
  try {
    await ensureGlobalConnection();
    isGameCreator = false;
    queueRoomRequest({ k: "matchmake" });
  } catch (error) {
    connectionMessage.textContent = `MATCHMAKING UNAVAILABLE — ${describeError(error)}`;
  }
}

function receiveRoomDirectory(value: unknown): void {
  if (!Array.isArray(value)) return;
  publicRoomListings = value.flatMap((row): PublicRoomListing[] => {
    if (
      !Array.isArray(row) || typeof row[0] !== "string" ||
      !Number.isInteger(row[1]) || !Number.isInteger(row[2]) ||
      !isArenaMapId(row[3]) || (row[4] !== 0 && row[4] !== 1) ||
      (row[5] !== 0 && row[5] !== 1)
    ) return [];
    return [{
      code: row[0],
      players: row[1],
      capacity: row[2],
      map: row[3],
      active: row[4] === 1,
      allowJoinInProgress: row[5] === 1,
    }];
  });
  renderRoomDirectory();
}

function queueRoomRequest(payload: Record<string, unknown>): void {
  if (!portalsNet) return;
  pendingRoomRequest = true;
  roomRequestToken += 1;
  const token = roomRequestToken;
  let attempts = 0;
  const sendAttempt = (): void => {
    if (!pendingRoomRequest || token !== roomRequestToken || !portalsNet) return;
    attempts += 1;
    portalsNet.send(payload);
    if (attempts >= 6) {
      window.setTimeout(() => {
        if (!pendingRoomRequest || token !== roomRequestToken) return;
        pendingRoomRequest = false;
        connectionMessage.textContent = "GAME SERVER UNAVAILABLE — TRY AGAIN OR PRACTICE OFFLINE";
      }, 500);
      return;
    }
    window.setTimeout(sendAttempt, 500);
  };
  sendAttempt();
}

function renderRoomDirectory(): void {
  roomList.replaceChildren();
  if (publicRoomListings.length === 0) {
    const empty = document.createElement("p");
    empty.className = "room-list-empty";
    empty.textContent = netConnected ? "NO PUBLIC GAMES — QUICK MATCH WILL CREATE ONE" : "CONNECT TO LOAD PUBLIC GAMES";
    roomList.append(empty);
    return;
  }
  for (const room of publicRoomListings) {
    const row = document.createElement("article");
    row.className = "room-list-item";
    const details = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = room.code.toUpperCase();
    const meta = document.createElement("span");
    const joinable = room.players < room.capacity && (!room.active || room.allowJoinInProgress);
    meta.textContent = `${room.map.toUpperCase()} · ${room.players}/${room.capacity} · ${room.active ? "IN PROGRESS" : "WAITING"}`;
    details.append(title, meta);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = joinable ? "JOIN" : "LOCKED";
    button.disabled = !joinable;
    button.addEventListener("click", () => void joinRoom(room.code));
    row.append(details, button);
    roomList.append(row);
  }
}

function completeServerRoomJoin(data: Record<string, unknown>): void {
  if (data.to !== localId || typeof data.room !== "string" || typeof data.stream !== "string") return;
  const settings = readClientGameSettings(data.settings);
  if (!settings) return;
  pendingRoomRequest = false;
  roomRequestToken += 1;
  activeRoomCode = normalizeRoomCode(data.room);
  activeRoomStream = data.stream.slice(0, 96);
  activeRoom = activeRoomCode.toUpperCase();
  activeChannel = `global:vectorfall-${activeRoomCode}`;
  joined = true;
  offline = false;
  resetServerAuthorityState();
  logicalRoomMode = true;
  serverAuthorityActive = true;
  lastServerSnapshotAt = performance.now();
  applyGameSettings(settings, false);
  resetPowerupState();
  resetWormholeState();
  clearRemotePilots();
  clearBullets();
  clearLaserBeams();
  clearExplosions();
  currentRoomPlayerIds.clear();
  resetUnknownEnemyNumbers();
  localVisual.group.visible = false;
  respawnTimer = 1;
  roomName.textContent = activeRoom;
  sessionPanel.classList.remove("practice-session");
  sessionPanel.classList.add("hidden");
  settingsButton.classList.remove("hidden");
  leaderboard.classList.remove("hidden");
  playerScores.clear();
  renderLeaderboard();
  hideWinnerCelebration();
  practiceControls.classList.add("hidden");
  lobby.classList.add("hidden");
  clearChat();
  setChatVisible(false);
  appendChatSystem(`CONNECTED TO ${activeRoom}`);
  connectionMessage.textContent = "SERVER READY — SYNCHRONIZING…";
}

function readClientGameSettings(value: unknown): GameSettings | null {
  if (!isRecord(value) || !isArenaMapId(value.map) || !Array.isArray(value.powerups)) return null;
  return {
    map: value.map,
    powerups: value.powerups.filter(isPowerupType),
    wormholes: value.wormholes !== false,
    gameMode: value.gameMode === "top-score" ? "top-score" : "endless",
    scoreToWin: Number.isInteger(value.scoreToWin)
      ? clampNumber(value.scoreToWin as number, 1, 100)
      : 5,
  };
}

function startOffline(): void {
  if (joined && portalsNet) portalsNet.send({ k: "leave-room" });
  pendingRoomRequest = false;
  roomRequestToken += 1;
  stopVoice();
  activeChannel = "";
  clearChat();
  setChatVisible(false);
  joined = false;
  offline = true;
  resetServerAuthorityState();
  isGameCreator = false;
  applyGameSettings({
    map: "classic",
    powerups: ["shield", "triple", "missile", "laser"],
    wormholes: true,
    gameMode: "endless",
    scoreToWin: 5,
  }, false);
  localId = "local";
  activeRoomCode = "";
  activeRoomStream = "";
  currentRoomPlayerIds.clear();
  resetUnknownEnemyNumbers();
  activeRoom = "OFFLINE";
  clearRemotePilots();
  clearExplosions();
  resetPowerupState();
  resetWormholeState();
  respawnLocalShip();
  updateRoster([]);
  roomName.textContent = "OFFLINE";
  sessionPanel.classList.add("practice-session");
  sessionPanel.classList.remove("hidden");
  settingsButton.classList.add("hidden");
  leaderboard.classList.add("hidden");
  leaderboardModal.classList.add("hidden");
  leaderboardModalOpen = false;
  playerScores.clear();
  hideWinnerCelebration();
  practiceControls.classList.remove("hidden");
  lobby.classList.add("hidden");
}

function leaveRoom(): void {
  if (joined && portalsNet) portalsNet.send({ k: "leave-room" });
  pendingRoomRequest = false;
  roomRequestToken += 1;
  stopVoice();
  activeChannel = "";
  clearChat();
  setChatVisible(false);
  joined = false;
  offline = false;
  resetServerAuthorityState();
  isGameCreator = false;
  activeRoom = "";
  activeRoomCode = "";
  activeRoomStream = "";
  currentRoomPlayerIds.clear();
  resetUnknownEnemyNumbers();
  clearRemotePilots();
  clearBullets();
  clearLaserBeams();
  clearExplosions();
  clearPowerups();
  clearWormholes();
  clearWormholeJumpEffects();
  practiceControls.classList.add("hidden");
  sessionPanel.classList.remove("practice-session");
  sessionPanel.classList.add("hidden");
  settingsButton.classList.add("hidden");
  leaderboard.classList.add("hidden");
  leaderboardModal.classList.add("hidden");
  leaderboardModalOpen = false;
  playerScores.clear();
  hideWinnerCelebration();
  settingsModal.classList.add("hidden");
  settingsModalOpen = false;
  showLobby();
}

function showLobby(): void {
  lobby.classList.remove("hidden");
  sessionPanel.classList.add("hidden");
  setLobbyMenu("main");
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
    item.classList.toggle("speaking", speakingIds.has(player.id));
    roster.append(item);
  }
  playerCount.textContent = String(players.length);
}

function refreshCurrentRoster(): void {
  if (!joined || !portalsNet) return;
  const players = portalsNet.players().filter((player) => currentRoomPlayerIds.has(player.id));
  const self = portalsNet.self();
  if (self && currentRoomPlayerIds.has(self.id) && !players.some((player) => player.id === self.id)) {
    players.unshift(self);
  }
  updateRoster(players);
}

function resetServerAuthorityState(): void {
  serverAuthorityActive = false;
  serverFallbackActive = false;
  logicalRoomMode = false;
  hasReceivedServerSnapshot = false;
  lastServerSnapshotAt = 0;
  serverInputSequence = 0;
  serverInputElapsed = 0;
  lastServerInputMask = -1;
  lastServerFire = false;
}

function handleNetworkMessage(data: unknown, fromId: string): void {
  if (!isRecord(data)) return;
  if (data.k === "room-joined") {
    completeServerRoomJoin(data);
    return;
  }
  if (data.k === "room-error" && data.to === localId && typeof data.message === "string") {
    pendingRoomRequest = false;
    roomRequestToken += 1;
    isGameCreator = false;
    connectionMessage.textContent = data.message.slice(0, 100).toUpperCase();
    return;
  }
  if (!joined) return;
  if (data.k === "s" && data.sv === 1) {
    if (data.r !== activeRoomStream) return;
    receiveServerSnapshot(data);
    return;
  }
  if (data.kind === "chat") {
    if (data.room !== activeRoomStream) return;
    receiveChatMessage(fromId, data);
    return;
  }
  // Once the room server is present it is the sole gameplay authority. Older
  // peer gameplay packets are deliberately ignored, while chat remains peer-to-peer.
  if (serverAuthorityActive || typeof data.kind !== "string") return;
  if (data.kind === "game-settings") receiveGameSettings(data);
  if (data.kind === "game-settings-request") broadcastGameSettings();
  if (data.kind === "state") updateRemoteState(fromId, data);
  if (data.kind === "shot") receiveRemoteShot(fromId, data);
  if (data.kind === "laser-shot") receiveRemoteLaserShot(fromId, data);
  if (data.kind === "powerup-spawn") receivePowerupSpawn(data);
  if (data.kind === "powerup-pickup") receivePowerupPickup(data);
  if (data.kind === "powerup-sync") receivePowerupSync(data);
  if (data.kind === "powerup-sync-request" && isPowerupAuthority()) broadcastPowerupSync();
  if (data.kind === "wormhole-spawn") receiveWormholeSpawn(data);
  if (data.kind === "wormhole-remove") receiveWormholeRemove(data);
  if (data.kind === "wormhole-sync") receiveWormholeSync(data);
  if (data.kind === "wormhole-jump") receiveWormholeJump(fromId, data);
  if (data.kind === "wormhole-sync-request" && isPowerupAuthority()) broadcastWormholeSync();
}

function receiveServerSnapshot(data: Record<string, unknown>): void {
  if (
    !Array.isArray(data.settings) || !Array.isArray(data.ships) ||
    !Array.isArray(data.bullets) || !Array.isArray(data.powerups) ||
    !Array.isArray(data.wormholes) || !Array.isArray(data.events)
  ) return;

  const settings = data.settings;
  if (!isArenaMapId(settings[0]) || !Number.isInteger(settings[1])) return;
  if (serverFallbackActive) {
    clearBullets();
    clearLaserBeams();
    clearPowerups();
    clearWormholes();
  }
  const powerupMask = settings[1] as number;
  const enabledPowerups: PowerupType[] = ["shield", "triple", "missile", "laser"]
    .filter((_type, index) => Boolean(powerupMask & (1 << index))) as PowerupType[];
  applyGameSettings({
    map: settings[0],
    powerups: enabledPowerups,
    wormholes: settings[2] === 1,
    gameMode: settings[3] === 1 ? "top-score" : "endless",
    scoreToWin: isFiniteNumber(settings[4]) ? clampNumber(settings[4], 1, 100) : 5,
  }, false);

  const firstSnapshot = !hasReceivedServerSnapshot;
  serverAuthorityActive = true;
  serverFallbackActive = false;
  hasReceivedServerSnapshot = true;
  lastServerSnapshotAt = performance.now();
  connectionMessage.textContent = "SERVER AUTHORITATIVE";

  const seenShips = new Set<string>();
  for (const row of data.ships) {
    if (!isServerShipRow(row)) continue;
    const [id, x, y, vx, vy, angle, energy, shield, triple, missile, activeLaser, respawn, transit, _lastSequence, inputMask, score] = row;
    seenShips.add(id);
    playerScores.set(id, score);
    if (id === localId) {
      const mustSnap = firstSnapshot || respawnTimer > 0 || wormholeTransit !== null;
      if (mustSnap) {
        ship.position.x = x;
        ship.position.y = y;
        ship.velocity.x = vx;
        ship.velocity.y = vy;
        ship.angle = angle;
        snapVisualToState(localVisual, ship);
        cameraTarget.set(x, y, 0);
      } else {
        ship.position.x += (x - ship.position.x) * 0.35;
        ship.position.y += (y - ship.position.y) * 0.35;
        ship.velocity.x += (vx - ship.velocity.x) * 0.45;
        ship.velocity.y += (vy - ship.velocity.y) * 0.45;
        ship.angle += normalizeAngle(angle - ship.angle) * 0.4;
      }
      ship.energy = clampNumber(energy, 0, config.maxEnergy);
      shipShield = clampNumber(shield, 0, shieldCapacity);
      tripleShotTimer = clampNumber(triple, 0, tripleShotDuration);
      homingMissileTimer = clampNumber(missile, 0, homingMissileDuration);
      laserTimer = clampNumber(activeLaser, 0, laserDuration);
      respawnTimer = Math.max(0, respawn);
      if (transit > 0 && !wormholeTransit) {
        wormholeTransit = { start: { ...ship.position }, destination: { ...ship.position }, remaining: transit };
      } else if (transit <= 0) {
        wormholeTransit = null;
      } else if (wormholeTransit) {
        wormholeTransit.remaining = transit;
      }
      localVisual.group.visible = respawn <= 0 && transit <= 0;
      continue;
    }
    updateRemoteState(id, {
      x, y, vx, vy, angle, energy, shield,
      tripleShotTimer: triple,
      homingMissileTimer: missile,
      laserTimer: activeLaser,
      thrusting: Boolean(inputMask & 1),
      boosting: Boolean(inputMask & 1) && Boolean(inputMask & 16),
      respawning: respawn > 0,
      transiting: transit > 0,
    });
  }
  for (const id of [...remotePilots.keys()]) {
    if (!seenShips.has(id)) removeRemotePilot(id);
  }
  for (const id of [...playerScores.keys()]) {
    if (!seenShips.has(id)) playerScores.delete(id);
  }
  currentRoomPlayerIds.clear();
  for (const id of seenShips) currentRoomPlayerIds.add(id);
  refreshCurrentRoster();
  renderLeaderboard();

  const seenBullets = new Set<number>();
  for (const row of data.bullets) {
    if (!isServerBulletRow(row)) continue;
    const [id, owner, weapon, x, y, vx, vy, lifetime] = row;
    seenBullets.add(id);
    const current = bullets.find((bullet) => bullet.networkId === id);
    if (current) {
      current.state.position.x = x;
      current.state.position.y = y;
      current.state.velocity.x = vx;
      current.state.velocity.y = vy;
      current.state.lifetime = lifetime;
    } else {
      addBullet({ position: { x, y }, velocity: { x: vx, y: vy }, lifetime, owner }, owner === localId, weapon, id);
    }
  }
  for (let index = bullets.length - 1; index >= 0; index -= 1) {
    if (bullets[index].networkId !== undefined && !seenBullets.has(bullets[index].networkId!)) removeBullet(index);
  }

  const seenPowerups = new Set<string>();
  for (const row of data.powerups) {
    if (!isServerPowerupRow(row)) continue;
    const id = `server-powerup-${row[0]}`;
    seenPowerups.add(id);
    if (!powerups.has(id)) createPowerup(id, row[1], { x: row[2], y: row[3] });
  }
  for (const id of [...powerups.keys()]) {
    if (id.startsWith("server-powerup-") && !seenPowerups.has(id)) removePowerup(id);
  }

  const seenWormholes = new Set<string>();
  for (const row of data.wormholes) {
    if (!isServerWormholeRow(row)) continue;
    const id = `server-wormhole-${row[0]}`;
    seenWormholes.add(id);
    const pair = wormholePairs.get(id);
    if (pair) pair.age = row[6];
    else createWormholePair(id, row[1], { x: row[2], y: row[3] }, { x: row[4], y: row[5] }, row[6]);
  }
  for (const id of [...wormholePairs.keys()]) {
    if (id.startsWith("server-wormhole-") && !seenWormholes.has(id)) removeWormholePair(id);
  }

  for (const event of data.events) processServerEvent(event);
}

function processServerEvent(event: unknown): void {
  if (!Array.isArray(event) || typeof event[0] !== "string") return;
  const kind = event[0];
  if (kind === "death" && typeof event[1] === "string" && isFiniteNumber(event[2]) && isFiniteNumber(event[3])) {
    spawnExplosion({ x: event[2], y: event[3] }, event[1] === localId);
  } else if (kind === "fire" && typeof event[1] === "string" && isWeaponType(event[2])) {
    const pilot = event[1] === localId ? ship : remotePilots.get(event[1])?.state;
    playWeaponFireSound(event[2], event[3] === 3, pilot ? soundVolumeAt(pilot.position) : 0.45);
  } else if (kind === "laser" && typeof event[1] === "string" && event.slice(2, 6).every(isFiniteNumber)) {
    spawnLaserBeam({ x: event[2] as number, y: event[3] as number }, { x: event[4] as number, y: event[5] as number }, event[1] === localId);
  } else if (kind === "hit" && typeof event[1] === "string") {
    const pilot = event[1] === localId ? ship : remotePilots.get(event[1])?.state;
    const volume = pilot ? soundVolumeAt(pilot.position) : 0.5;
    if (event[3] === 1) arcadeAudio.shieldHit(volume); else arcadeAudio.hullHit(volume);
  } else if (kind === "pickup" && typeof event[1] === "string" && isPowerupType(event[3])) {
    const pilot = event[1] === localId ? ship : remotePilots.get(event[1])?.state;
    arcadeAudio.powerup(event[3], pilot ? soundVolumeAt(pilot.position) : 0.45);
  } else if (kind === "wormhole-enter" && typeof event[1] === "string" && Number.isInteger(event[2])) {
    const pair = wormholePairs.get(`server-wormhole-${event[2]}`);
    if (!pair) return;
    const first = event[3] === 0;
    const start = first ? pair.first : pair.second;
    const destination = first ? pair.second : pair.first;
    spawnWormholeJumpEffect(start, destination, pair.color);
    arcadeAudio.wormholeEnter(soundVolumeAt(start));
    if (event[1] === localId) {
      wormholeTransit = { start: { ...start }, destination: { ...destination }, remaining: wormholeTransitDuration };
      localVisual.group.visible = false;
    }
  } else if (kind === "wormhole-exit" && event[1] === localId) {
    wormholeTransit = null;
    localVisual.group.visible = respawnTimer <= 0;
    arcadeAudio.wormholeExit();
  } else if (kind === "win" && typeof event[1] === "string") {
    showWinnerCelebration(event[1]);
  }
}

function isServerShipRow(value: unknown): value is [string, ...number[]] {
  return Array.isArray(value) && value.length >= 16 && typeof value[0] === "string" && value.slice(1, 16).every(isFiniteNumber);
}

function isServerBulletRow(value: unknown): value is [number, string, WeaponType, number, number, number, number, number] {
  return Array.isArray(value) && value.length >= 8 && Number.isInteger(value[0]) && typeof value[1] === "string" && isWeaponType(value[2]) && value.slice(3, 8).every(isFiniteNumber);
}

function isServerPowerupRow(value: unknown): value is [number, PowerupType, number, number] {
  return Array.isArray(value) && value.length >= 4 && Number.isInteger(value[0]) && isPowerupType(value[1]) && value.slice(2, 4).every(isFiniteNumber);
}

function isServerWormholeRow(value: unknown): value is [number, number, number, number, number, number, number] {
  return Array.isArray(value) && value.length >= 7 && Number.isInteger(value[0]) && value.slice(1, 7).every(isFiniteNumber);
}

function sendChatMessage(): void {
  const text = chatInput.value.trim().slice(0, 300);
  chatInput.value = "";
  if (!text || !joined || !portalsNet) return;
  portalsNet.send({ kind: "chat", room: activeRoomStream, text });
  appendChatMessage(localId, chatDisplayName(localId), text);
}

function receiveChatMessage(fromId: string, data: Record<string, unknown>): void {
  if (typeof data.text !== "string") return;
  const text = data.text.trim().slice(0, 300);
  if (!text) return;
  appendChatMessage(fromId, chatDisplayName(fromId), text);
}

function chatDisplayName(id: string): string {
  const player = portalsNet?.players().find((candidate) => candidate.id === id)
    ?? (portalsNet?.self()?.id === id ? portalsNet.self() : null);
  return player?.displayName || `PILOT ${id.slice(0, 6)}`;
}

function multiplayerDisplayName(id: string): string | null {
  const player = portalsNet?.players().find((candidate) => candidate.id === id)
    ?? (portalsNet?.self()?.id === id ? portalsNet.self() : null);
  const name = player?.displayName?.trim();
  return name || null;
}

function unknownEnemyName(id: string): string {
  let number = unknownEnemyNumbers.get(id);
  if (number === undefined) {
    unknownEnemyCounter += 1;
    number = unknownEnemyCounter;
    unknownEnemyNumbers.set(id, number);
  }
  return `Unkown Enemy ${number}`;
}

function resetUnknownEnemyNumbers(): void {
  unknownEnemyNumbers.clear();
  unknownEnemyCounter = 0;
}

function leaderboardPlayerName(id: string): string {
  return multiplayerDisplayName(id) ?? (id === localId ? "You" : unknownEnemyName(id));
}

function renderLeaderboard(): void {
  const standings = [...playerScores.entries()].sort((first, second) => {
    return second[1] - first[1] || leaderboardPlayerName(first[0]).localeCompare(leaderboardPlayerName(second[0]));
  });
  renderLeaderboardRows(leaderboardTopFive, standings.slice(0, 5));
  renderLeaderboardRows(leaderboardAll, standings);
}

function renderLeaderboardRows(
  target: HTMLOListElement,
  standings: Array<[string, number]>,
): void {
  target.replaceChildren();
  standings.forEach(([id, score], index) => {
    const row = document.createElement("li");
    const name = document.createElement("span");
    const value = document.createElement("strong");
    name.textContent = `${index + 1}. ${leaderboardPlayerName(id)}`;
    value.textContent = String(score);
    row.classList.toggle("local-player", id === localId);
    row.append(name, value);
    target.append(row);
  });
}

function setLeaderboardModalVisible(visible: boolean): void {
  leaderboardModalOpen = visible;
  leaderboardModal.classList.toggle("hidden", !visible);
  expandLeaderboardButton.setAttribute("aria-expanded", String(visible));
  if (visible) {
    heldKeys.clear();
    resetGamepadInput();
    updateInput();
    renderLeaderboard();
    closeLeaderboardButton.focus();
  } else if (!leaderboard.classList.contains("hidden")) {
    expandLeaderboardButton.focus();
  }
}

function showWinnerCelebration(winnerId: string): void {
  const name = leaderboardPlayerName(winnerId);
  winnerMessage.textContent = `${name} Wins!`;
  confetti.replaceChildren();
  const colors = ["#69ddff", "#ff5577", "#ffd166", "#c77dff", "#7ee787", "#ffffff"];
  for (let index = 0; index < 72; index += 1) {
    const piece = document.createElement("i");
    piece.style.setProperty("--x", `${Math.random() * 100}vw`);
    piece.style.setProperty("--drift", `${(Math.random() - 0.5) * 240}px`);
    piece.style.setProperty("--delay", `${Math.random() * 0.65}s`);
    piece.style.setProperty("--duration", `${1.8 + Math.random() * 1.5}s`);
    piece.style.setProperty("--color", colors[index % colors.length]);
    confetti.append(piece);
  }
  winnerCelebration.classList.remove("hidden");
  arcadeAudio.win();
  window.clearTimeout(winnerCelebrationTimer);
  winnerCelebrationTimer = window.setTimeout(() => {
    winnerCelebration.classList.add("hidden");
    confetti.replaceChildren();
  }, 3600);
}

function hideWinnerCelebration(): void {
  window.clearTimeout(winnerCelebrationTimer);
  winnerCelebration.classList.add("hidden");
  confetti.replaceChildren();
}

function appendChatMessage(senderId: string, senderName: string, text: string): void {
  const line = document.createElement("div");
  line.className = "chat-line";
  line.dataset.senderId = senderId;
  const name = document.createElement("strong");
  name.textContent = senderName;
  const body = document.createElement("span");
  body.textContent = ` ${text}`;
  line.append(name, body);
  appendChatLine(line);
}

function appendChatSystem(text: string): void {
  const line = document.createElement("div");
  line.className = "chat-line chat-system";
  line.textContent = text;
  appendChatLine(line);
}

function appendChatLine(line: HTMLElement): void {
  chatLog.append(line);
  while (chatLog.childElementCount > 60) chatLog.firstElementChild?.remove();
  chatLog.scrollTop = chatLog.scrollHeight;
}

function clearChat(): void {
  chatLog.replaceChildren();
  chatInput.value = "";
}

function setChatVisible(visible: boolean): void {
  chatPanel.classList.toggle("hidden", !visible);
}

function updateRemoteState(fromId: string, data: Record<string, unknown>): void {
  const values = [data.x, data.y, data.vx, data.vy, data.angle, data.energy];
  if (!values.every(isFiniteNumber)) return;
  const pilot = getOrCreateRemotePilot(fromId);
  const wasRespawning = pilot.respawning;
  const wasTransiting = pilot.transiting;
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
  pilot.homingMissileTimer = isFiniteNumber(data.homingMissileTimer)
    ? clampNumber(data.homingMissileTimer, 0, homingMissileDuration)
    : pilot.homingMissileTimer;
  pilot.laserTimer = isFiniteNumber(data.laserTimer)
    ? clampNumber(data.laserTimer, 0, laserDuration)
    : pilot.laserTimer;
  pilot.thrusting = data.thrusting === true;
  pilot.boosting = data.boosting === true;
  pilot.respawning = data.respawning === true;
  pilot.transiting = data.transiting === true;
  if (wasSpawned && pilot.respawning) spawnExplosion(pilot.state.position);
  if (pilot.respawning) {
    pilot.visualReady = false;
  } else if (!pilot.visualReady || wasRespawning || (wasTransiting && !pilot.transiting)) {
    snapVisualToState(pilot.visual, pilot.state);
    pilot.visualReady = true;
  }
  if (wasTransiting && !pilot.transiting) {
    arcadeAudio.wormholeExit(soundVolumeAt(pilot.state.position));
  }
  pilot.visual.group.visible = pilot.visualReady && !pilot.respawning && !pilot.transiting;
}

function receiveRemoteShot(fromId: string, data: Record<string, unknown>): void {
  const values = [data.x, data.y, data.vx, data.vy, data.lifetime];
  if (!values.every(isFiniteNumber)) return;
  const weapon = isWeaponType(data.weapon) ? data.weapon : "standard";
  if (weapon === "laser") {
    const start = {
      x: clampNumber(data.x as number, -2000, 2000),
      y: clampNumber(data.y as number, -2000, 2000),
    };
    const velocity = { x: data.vx as number, y: data.vy as number };
    const magnitude = Math.hypot(velocity.x, velocity.y);
    if (magnitude < 1) return;
    const end = traceLaserEnd(start, {
      x: velocity.x / magnitude,
      y: velocity.y / magnitude,
    });
    spawnLaserBeam(start, end, false);
    applyLaserHit(fromId, start, end);
    arcadeAudio.laserFire(soundVolumeAt(start) * 0.55);
    return;
  }
  addBullet(
    {
      position: {
        x: clampNumber(data.x as number, -2000, 2000),
        y: clampNumber(data.y as number, -2000, 2000),
      },
      velocity: {
        x: clampNumber(data.vx as number, -1800, 1800),
        y: clampNumber(data.vy as number, -1800, 1800),
      },
      lifetime: clampNumber(data.lifetime as number, 0, 2),
      owner: fromId,
    },
    false,
    weapon,
  );
  playWeaponFireSound(weapon, false, soundVolumeAt({ x: data.x as number, y: data.y as number }) * 0.55);
}

function receiveRemoteLaserShot(fromId: string, data: Record<string, unknown>): void {
  const values = [data.x1, data.y1, data.x2, data.y2];
  if (!values.every(isFiniteNumber)) return;
  const start = {
    x: clampNumber(data.x1 as number, -2400, 2400),
    y: clampNumber(data.y1 as number, -2400, 2400),
  };
  const end = {
    x: clampNumber(data.x2 as number, -2400, 2400),
    y: clampNumber(data.y2 as number, -2400, 2400),
  };
  spawnLaserBeam(start, end, false);
  applyLaserHit(fromId, start, end);
  arcadeAudio.laserFire(soundVolumeAt(start) * 0.55);
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
  const powerup = powerups.get(data.id);
  if (powerup) {
    arcadeAudio.powerup(powerup.type, soundVolumeAt(powerup.position) * 0.55);
  }
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

function receiveWormholeSpawn(data: Record<string, unknown>): void {
  if (
    typeof data.id !== "string" ||
    !isFiniteNumber(data.color) ||
    !isFiniteNumber(data.x1) ||
    !isFiniteNumber(data.y1) ||
    !isFiniteNumber(data.x2) ||
    !isFiniteNumber(data.y2)
  ) return;
  createWormholePair(
    data.id,
    clampWormholeColor(data.color),
    {
      x: clampNumber(data.x1, -worldWidth / 2, worldWidth / 2),
      y: clampNumber(data.y1, -worldHeight / 2, worldHeight / 2),
    },
    {
      x: clampNumber(data.x2, -worldWidth / 2, worldWidth / 2),
      y: clampNumber(data.y2, -worldHeight / 2, worldHeight / 2),
    },
  );
}

function receiveWormholeRemove(data: Record<string, unknown>): void {
  if (typeof data.id !== "string") return;
  removeWormholePair(data.id);
}

function receiveWormholeJump(fromId: string, data: Record<string, unknown>): void {
  if (typeof data.id !== "string" || (data.entry !== 0 && data.entry !== 1)) return;
  const pair = wormholePairs.get(data.id);
  if (!pair) return;
  const entryIndex = data.entry;
  spawnWormholeJumpEffect(
    entryIndex === 0 ? pair.first : pair.second,
    entryIndex === 0 ? pair.second : pair.first,
    pair.color,
  );
  arcadeAudio.wormholeEnter(
    soundVolumeAt(entryIndex === 0 ? pair.first : pair.second) * 0.7,
  );
  const pilot = remotePilots.get(fromId);
  if (pilot) {
    pilot.transiting = true;
    pilot.visual.group.visible = false;
  }
}

function receiveWormholeSync(data: Record<string, unknown>): void {
  if (!Array.isArray(data.items)) return;
  clearWormholes();
  for (const item of data.items) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      !isFiniteNumber(item.color) ||
      !isFiniteNumber(item.x1) ||
      !isFiniteNumber(item.y1) ||
      !isFiniteNumber(item.x2) ||
      !isFiniteNumber(item.y2) ||
      !isFiniteNumber(item.remaining)
    ) continue;
    const remaining = clampNumber(item.remaining, 0, wormholeLifetime);
    createWormholePair(
      item.id,
      clampWormholeColor(item.color),
      {
        x: clampNumber(item.x1, -worldWidth / 2, worldWidth / 2),
        y: clampNumber(item.y1, -worldHeight / 2, worldHeight / 2),
      },
      {
        x: clampNumber(item.x2, -worldWidth / 2, worldWidth / 2),
        y: clampNumber(item.y2, -worldHeight / 2, worldHeight / 2),
      },
      wormholeLifetime - remaining,
    );
  }
}

function broadcastWormholeSync(): void {
  if (!joined || !portalsNet || !isPowerupAuthority()) return;
  portalsNet.send({
    kind: "wormhole-sync",
    items: [...wormholePairs.values()].map((pair) => ({
      id: pair.id,
      color: pair.color,
      x1: roundNetworkValue(pair.first.x),
      y1: roundNetworkValue(pair.first.y),
      x2: roundNetworkValue(pair.second.x),
      y2: roundNetworkValue(pair.second.y),
      remaining: roundNetworkValue(Math.max(0, wormholeLifetime - pair.age)),
    })),
  });
}

function broadcastGameSettings(): void {
  if (!joined || !portalsNet) return;
  portalsNet.send({
    kind: "game-settings",
    map: activeGameSettings.map,
    powerups: [...activeGameSettings.powerups],
    wormholes: activeGameSettings.wormholes,
    gameMode: activeGameSettings.gameMode,
    scoreToWin: activeGameSettings.scoreToWin,
  });
}

function receiveGameSettings(data: Record<string, unknown>): void {
  if (!isArenaMapId(data.map) || !Array.isArray(data.powerups)) return;
  const powerups = data.powerups.filter(isPowerupType);
  const wormholes = typeof data.wormholes === "boolean" ? data.wormholes : true;
  const gameMode = data.gameMode === "top-score" ? "top-score" : "endless";
  const scoreToWin = isFiniteNumber(data.scoreToWin) ? clampNumber(data.scoreToWin, 1, 100) : 5;
  applyGameSettings({ map: data.map, powerups, wormholes, gameMode, scoreToWin });
  if (joined && portalsNet) {
    portalsNet.send({ kind: "powerup-sync-request" });
    portalsNet.send({ kind: "wormhole-sync-request" });
  }
}

function isArenaMapId(value: unknown): value is ArenaMapId {
  return value === "classic" || value === "crossroads" || value === "open";
}

function applyGameSettings(settings: GameSettings, respawn = true): void {
  const powerups = [...new Set(settings.powerups)].filter(isPowerupType);
  const unchanged =
    activeGameSettings.map === settings.map &&
    activeGameSettings.wormholes === settings.wormholes &&
    activeGameSettings.gameMode === settings.gameMode &&
    activeGameSettings.scoreToWin === settings.scoreToWin &&
    activeGameSettings.powerups.length === powerups.length &&
    activeGameSettings.powerups.every((type) => powerups.includes(type));
  if (unchanged) return;

  const mapChanged = activeMapId !== settings.map;
  activeGameSettings = {
    map: settings.map,
    powerups,
    wormholes: settings.wormholes,
    gameMode: settings.gameMode,
    scoreToWin: settings.scoreToWin,
  };
  sectorName.textContent = settings.map === "classic"
    ? "CLASSIC"
    : settings.map === "crossroads"
      ? "CROSSROADS"
      : "OPEN VOID";
  if (mapChanged) {
    activeMapId = settings.map;
    walls = arenaMaps[activeMapId].map((wall) => ({ ...wall }));
    createWalls();
  }
  resetPowerupState();
  resetWormholeState();
  clearBullets();
  if (respawn && (joined || offline)) respawnLocalShip();
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
    homingMissileTimer: roundNetworkValue(homingMissileTimer),
    laserTimer: roundNetworkValue(laserTimer),
    thrusting: input.thrust,
    boosting: input.thrust && input.boost && ship.energy > 0,
    respawning: respawnTimer > 0,
    transiting: wormholeTransit !== null,
  });
}

function broadcastShot(bullet: BulletState, weapon: WeaponType): void {
  if (!joined || !portalsNet) return;
  portalsNet.send({
    kind: "shot",
    x: roundNetworkValue(bullet.position.x),
    y: roundNetworkValue(bullet.position.y),
    vx: roundNetworkValue(bullet.velocity.x),
    vy: roundNetworkValue(bullet.velocity.y),
    lifetime: bullet.lifetime,
    weapon,
  });
}

function broadcastLaserShot(start: Vec2, end: Vec2): void {
  if (!joined || !portalsNet) return;
  portalsNet.send({
    kind: "laser-shot",
    x1: roundNetworkValue(start.x),
    y1: roundNetworkValue(start.y),
    x2: roundNetworkValue(end.x),
    y2: roundNetworkValue(end.y),
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
    homingMissileTimer: 0,
    laserTimer: 0,
    thrusting: false,
    boosting: false,
    respawning: false,
    isCpu: false,
    cpuRespawnTimer: 0,
    cpuWeaponCooldown: 0,
    wormholeCooldown: 0,
    transiting: false,
    wormholeTransit: null,
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
    homingMissileTimer: 0,
    laserTimer: 0,
    thrusting: false,
    boosting: false,
    respawning: false,
    isCpu: true,
    cpuRespawnTimer: 0,
    cpuWeaponCooldown: 0,
    wormholeCooldown: 0,
    transiting: false,
    wormholeTransit: null,
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
  if (controlsModalOpen || settingsModalOpen || leaderboardModalOpen) {
    resetGamepadInput();
    updateInput();
    return;
  }
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
  if (pauseDown && !gamepadPauseWasDown) togglePause();
  gamepadPauseWasDown = pauseDown;
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
    const insideWormhole = [...wormholePairs.values()].some((pair) =>
      distanceSquared(position, pair.first) < (wormholeRadius + config.shipRadius + 8) ** 2 ||
      distanceSquared(position, pair.second) < (wormholeRadius + config.shipRadius + 8) ** 2,
    );
    if (!insideWall && !insideWormhole) {
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
  homingMissileTimer = 0;
  laserTimer = 0;
  wormholeCooldown = 0;
  wormholeTransit = null;
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
  homingMissileTimer = 0;
  laserTimer = 0;
  wormholeCooldown = 0;
  wormholeTransit = null;
  ship.energy = 0;
  respawnTimer = 1.25;
  localVisual.group.visible = false;
  clearBullets();
  networkAccumulator = networkInterval;
}

function addBullet(
  state: BulletState,
  isLocal: boolean,
  weapon: WeaponType = "standard",
  networkId?: number,
): void {
  const geometry = weapon === "missile"
    ? missileGeometry
    : bulletGeometry;
  const material = weapon === "missile"
    ? isLocal ? localMissileMaterial : remoteMissileMaterial
    : isLocal ? localBulletMaterial : remoteBulletMaterial;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = 1;
  scene.add(mesh);
  bullets.push({ state, mesh, weapon, networkId });
}

function fireVolley(
  shipState: ShipState,
  owner: string,
  tripleShot: boolean,
  weapon: WeaponType,
): BulletState[] {
  const angleOffsets = tripleShot ? [-0.18, 0, 0.18] : [0];
  const volleyCost = config.bulletEnergyCost * angleOffsets.length;
  if (shipState.energy < volleyCost) return [];
  const shots: BulletState[] = [];
  for (const angleOffset of angleOffsets) {
    const bullet = fireBullet(shipState, config, owner, angleOffset);
    if (!bullet) return [];
    const angle = shipState.angle + angleOffset;
    if (weapon === "missile") {
      bullet.velocity.x = shipState.velocity.x + Math.cos(angle) * config.bulletSpeed * 0.72;
      bullet.velocity.y = shipState.velocity.y + Math.sin(angle) * config.bulletSpeed * 0.72;
      bullet.lifetime *= 1.65;
    }
    shots.push(bullet);
  }
  return shots;
}

function fireLaserVolley(
  shipState: ShipState,
  owner: string,
  tripleShot: boolean,
  isLocal: boolean,
): boolean {
  const angleOffsets = tripleShot ? [-0.18, 0, 0.18] : [0];
  const volleyCost = config.bulletEnergyCost * laserEnergyMultiplier * angleOffsets.length;
  if (shipState.energy < volleyCost) return false;
  shipState.energy -= volleyCost;
  for (const angleOffset of angleOffsets) {
    const angle = shipState.angle + angleOffset;
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    const start = {
      x: shipState.position.x + direction.x * (config.shipRadius + 6),
      y: shipState.position.y + direction.y * (config.shipRadius + 6),
    };
    const end = traceLaserEnd(start, direction);
    spawnLaserBeam(start, end, isLocal);
    applyLaserHit(owner, start, end);
    if (owner === localId) broadcastLaserShot(start, end);
  }
  return true;
}

function traceLaserEnd(start: Vec2, direction: Vec2): Vec2 {
  let distance = 2200;
  for (const wall of walls) {
    const hitDistance = rayRectDistance(start, direction, wall);
    if (hitDistance !== null && hitDistance < distance) distance = Math.max(0, hitDistance - 1);
  }
  return {
    x: start.x + direction.x * distance,
    y: start.y + direction.y * distance,
  };
}

function rayRectDistance(origin: Vec2, direction: Vec2, rect: Rect): number | null {
  let near = Number.NEGATIVE_INFINITY;
  let far = Number.POSITIVE_INFINITY;
  for (const [position, velocity, minimum, maximum] of [
    [origin.x, direction.x, rect.x, rect.x + rect.width],
    [origin.y, direction.y, rect.y, rect.y + rect.height],
  ] as const) {
    if (Math.abs(velocity) < 1e-8) {
      if (position < minimum || position > maximum) return null;
      continue;
    }
    const first = (minimum - position) / velocity;
    const second = (maximum - position) / velocity;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) return null;
  }
  if (far < 0) return null;
  return near >= 0 ? near : far;
}

function spawnLaserBeam(start: Vec2, end: Vec2, isLocal: boolean): void {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return;
  const group = new THREE.Group();
  group.position.set((start.x + end.x) / 2, (start.y + end.y) / 2, 2.2);
  group.rotation.z = Math.atan2(dy, dx);
  const color = isLocal ? 0x8dfff1 : 0xff61dc;
  const outerMaterial = glowMaterial(color, 0.22);
  const coreMaterial = glowMaterial(0xffffff, 0.95);
  const outer = new THREE.Mesh(laserBeamGeometry, outerMaterial);
  outer.scale.set(length, 9, 1);
  const core = new THREE.Mesh(laserBeamGeometry, coreMaterial);
  core.scale.set(length, 2.2, 1);
  group.add(outer, core);
  scene.add(group);
  laserBeams.push({
    group,
    materials: [outerMaterial, coreMaterial],
    age: 0,
    duration: 0.14,
  });
}

function applyLaserHit(owner: string, start: Vec2, end: Vec2): void {
  let closest: { distance: number; pilot?: RemotePilot; local?: true } | null = null;
  if (owner !== localId && respawnTimer === 0 && !wormholeTransit) {
    const distance = segmentCircleHitDistance(start, end, ship.position, config.shipRadius);
    if (distance !== null) closest = { distance, local: true };
  }

  const ownerPilot = remotePilots.get(owner);
  if (owner === localId || ownerPilot?.isCpu === true) {
    for (const [id, pilot] of remotePilots) {
      if (id === owner || pilot.respawning || pilot.transiting) continue;
      if (owner !== localId && !pilot.isCpu) continue;
      const distance = segmentCircleHitDistance(
        start,
        end,
        pilot.state.position,
        config.shipRadius,
      );
      if (distance === null || (closest && distance >= closest.distance)) continue;
      closest = { distance, pilot };
    }
  }
  if (!closest) return;

  if (closest.local) {
    const shielded = shipShield > 0;
    shipShield = applyDamage(ship, shipShield, weaponDamage("laser"));
    if (shielded) arcadeAudio.shieldHit();
    else arcadeAudio.hullHit();
    if (ship.energy === 0) destroyLocalShip();
    return;
  }

  const pilot = closest.pilot;
  if (!pilot) return;
  const hitVolume = soundVolumeAt(pilot.state.position) * 0.72;
  if (!pilot.isCpu) {
    if (pilot.shield > 0) arcadeAudio.shieldHit(hitVolume);
    else arcadeAudio.hullHit(hitVolume);
    return;
  }
  const shielded = pilot.shield > 0;
  pilot.shield = applyDamage(pilot.state, pilot.shield, weaponDamage("laser"));
  if (shielded) arcadeAudio.shieldHit(hitVolume);
  else arcadeAudio.hullHit(hitVolume);
  if (pilot.state.energy === 0) destroyCpuPilot(pilot);
}

function segmentCircleHitDistance(
  start: Vec2,
  end: Vec2,
  center: Vec2,
  radius: number,
): number | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return null;
  const progress = THREE.MathUtils.clamp(
    ((center.x - start.x) * dx + (center.y - start.y) * dy) / lengthSquared,
    0,
    1,
  );
  const nearestX = start.x + dx * progress;
  const nearestY = start.y + dy * progress;
  const offsetX = center.x - nearestX;
  const offsetY = center.y - nearestY;
  if (offsetX * offsetX + offsetY * offsetY > radius * radius) return null;
  return Math.sqrt(lengthSquared) * progress;
}

function destroyCpuPilot(pilot: RemotePilot): void {
  spawnExplosion(pilot.state.position);
  pilot.shield = 0;
  pilot.tripleShotTimer = 0;
  pilot.homingMissileTimer = 0;
  pilot.laserTimer = 0;
  pilot.wormholeCooldown = 0;
  pilot.transiting = false;
  pilot.wormholeTransit = null;
  pilot.respawning = true;
  pilot.cpuRespawnTimer = 1.25;
  pilot.visualReady = false;
  pilot.visual.group.visible = false;
}

function activeWeapon(missileTimer: number, activeLaserTimer: number): WeaponType {
  if (activeLaserTimer > 0) return "laser";
  if (missileTimer > 0) return "missile";
  return "standard";
}

function weaponDamage(weapon: WeaponType): number {
  if (weapon === "laser") return config.bulletDamage * 1.6;
  if (weapon === "missile") return config.bulletDamage * 1.3;
  return config.bulletDamage;
}

function weaponCollisionRadius(weapon: WeaponType): number {
  return weapon === "missile" ? 4 : 2.7;
}

function weaponCooldownFor(weapon: WeaponType): number {
  if (weapon === "laser") return config.bulletCooldown * 0.58;
  if (weapon === "missile") return config.bulletCooldown * 1.45;
  return config.bulletCooldown;
}

function playWeaponFireSound(
  weapon: WeaponType,
  tripleShot: boolean,
  volume = 1,
): void {
  if (weapon === "missile") arcadeAudio.missileFire(volume);
  else if (weapon === "laser") arcadeAudio.laserFire(volume);
  else arcadeAudio.fire(tripleShot, volume);
}

function steerHomingMissile(bullet: RenderedBullet, deltaSeconds: number): void {
  const target = findHomingTarget(bullet.state);
  if (!target) return;
  const offsetX = target.x - bullet.state.position.x;
  const offsetY = target.y - bullet.state.position.y;
  if (offsetX === 0 && offsetY === 0) return;
  const speed = Math.hypot(bullet.state.velocity.x, bullet.state.velocity.y);
  if (speed < 1) return;
  const currentAngle = Math.atan2(bullet.state.velocity.y, bullet.state.velocity.x);
  const targetAngle = Math.atan2(offsetY, offsetX);
  const turn = THREE.MathUtils.clamp(
    normalizeAngle(targetAngle - currentAngle),
    -3.4 * deltaSeconds,
    3.4 * deltaSeconds,
  );
  bullet.state.velocity.x = Math.cos(currentAngle + turn) * speed;
  bullet.state.velocity.y = Math.sin(currentAngle + turn) * speed;
}

function findHomingTarget(bullet: BulletState): Vec2 | null {
  let target: Vec2 | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  if (bullet.owner !== localId && respawnTimer === 0 && !wormholeTransit) {
    target = ship.position;
    closestDistance = distanceSquared(bullet.position, ship.position);
  }

  const ownerPilot = remotePilots.get(bullet.owner);
  if (bullet.owner !== localId && ownerPilot?.isCpu !== true) return target;
  for (const [id, pilot] of remotePilots) {
    if (id === bullet.owner || pilot.respawning || pilot.transiting) continue;
    const distance = distanceSquared(bullet.position, pilot.state.position);
    if (distance >= closestDistance) continue;
    target = pilot.state.position;
    closestDistance = distance;
  }
  return target;
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

function updateLaserBeams(deltaSeconds: number): void {
  for (let index = laserBeams.length - 1; index >= 0; index -= 1) {
    const beam = laserBeams[index];
    beam.age += deltaSeconds;
    const fade = 1 - THREE.MathUtils.clamp(beam.age / beam.duration, 0, 1);
    beam.materials[0].opacity = 0.22 * fade;
    beam.materials[1].opacity = 0.95 * Math.sqrt(fade);
    if (beam.age < beam.duration) continue;
    scene.remove(beam.group);
    for (const material of beam.materials) material.dispose();
    laserBeams.splice(index, 1);
  }
}

function clearLaserBeams(): void {
  for (const beam of laserBeams) {
    scene.remove(beam.group);
    for (const material of beam.materials) material.dispose();
  }
  laserBeams.length = 0;
}

function randomPowerupDelay(): number {
  return powerupSpawnMinimum + Math.random() * (powerupSpawnMaximum - powerupSpawnMinimum);
}

function randomWormholeDelay(): number {
  return wormholeSpawnMinimum + Math.random() * (wormholeSpawnMaximum - wormholeSpawnMinimum);
}

function resetPowerupState(): void {
  clearPowerups();
  powerupCounter = 0;
  powerupSpawnTimer = randomPowerupDelay();
}

function resetWormholeState(): void {
  clearWormholes();
  clearWormholeJumpEffects();
  wormholeCounter = 0;
  wormholeSpawnTimer = randomWormholeDelay();
  wormholeCooldown = 0;
  wormholeTransit = null;
}

function isPowerupAuthority(): boolean {
  if (offline) return true;
  if (!joined || !portalsNet) return false;
  const playerIds = [localId, ...portalsNet.players().map((player) => player.id)];
  playerIds.sort();
  return playerIds[0] === localId;
}

function isPowerupType(value: unknown): value is PowerupType {
  return value === "shield" || value === "triple" || value === "missile" || value === "laser";
}

function isWeaponType(value: unknown): value is WeaponType {
  return value === "standard" || value === "missile" || value === "laser";
}

function stepPowerups(): void {
  if (isPowerupAuthority() && activeGameSettings.powerups.length > 0) {
    powerupSpawnTimer -= fixedStep;
    if (powerupSpawnTimer <= 0) {
      if (powerups.size < maxActivePowerups) spawnPowerup();
      powerupSpawnTimer = randomPowerupDelay();
    }
  }

  if (respawnTimer === 0 && !wormholeTransit) {
    const localPickup = findPowerupAt(ship.position);
    if (localPickup) collectPowerupForLocal(localPickup);
  }

  if (!offline) return;
  for (const [id, pilot] of remotePilots) {
    if (!pilot.isCpu || pilot.respawning || pilot.transiting) continue;
    const pickup = findPowerupAt(pilot.state.position);
    if (pickup) collectPowerupForPilot(id, pilot, pickup);
  }
}

function stepWormholes(): void {
  if (!activeGameSettings.wormholes) return;
  wormholeCooldown = Math.max(0, wormholeCooldown - fixedStep);
  if (wormholeTransit) {
    wormholeTransit.remaining = Math.max(0, wormholeTransit.remaining - fixedStep);
    if (wormholeTransit.remaining === 0) {
      teleportShipThroughWormhole(ship, wormholeTransit.destination);
      arcadeAudio.wormholeExit();
      wormholeTransit = null;
      wormholeCooldown = 0.4;
      localVisual.group.visible = true;
      networkAccumulator = networkInterval;
    }
  }

  const authority = isPowerupAuthority();
  if (authority) {
    wormholeSpawnTimer -= fixedStep;
    if (wormholeSpawnTimer <= 0) {
      if (wormholePairs.size < maxActiveWormholePairs) spawnWormholePair();
      wormholeSpawnTimer = randomWormholeDelay();
    }
  }

  for (const [id, pair] of [...wormholePairs.entries()]) {
    pair.age += fixedStep;
    if (pair.age < wormholeLifetime) continue;
    removeWormholePair(id);
    if (authority && joined && portalsNet) {
      portalsNet.send({ kind: "wormhole-remove", id });
    }
  }

  if (respawnTimer === 0 && !wormholeTransit && wormholeCooldown === 0) {
    const exit = findWormholeExit(ship.position);
    if (exit) {
      triggerWormholeJump(exit, true);
      wormholeTransit = {
        start: { ...exit.entry },
        destination: { ...exit.destination },
        remaining: wormholeTransitDuration,
      };
      localVisual.group.visible = false;
      networkAccumulator = networkInterval;
    }
  }

  if (!offline) return;
  for (const pilot of remotePilots.values()) {
    if (!pilot.isCpu || pilot.respawning) continue;
    pilot.wormholeCooldown = Math.max(0, pilot.wormholeCooldown - fixedStep);
    if (pilot.wormholeTransit) {
      pilot.wormholeTransit.remaining = Math.max(
        0,
        pilot.wormholeTransit.remaining - fixedStep,
      );
      if (pilot.wormholeTransit.remaining === 0) {
        teleportShipThroughWormhole(pilot.state, pilot.wormholeTransit.destination);
        arcadeAudio.wormholeExit(soundVolumeAt(pilot.state.position) * 0.7);
        pilot.wormholeTransit = null;
        pilot.transiting = false;
        pilot.wormholeCooldown = 0.4;
        snapVisualToState(pilot.visual, pilot.state);
        pilot.visual.group.visible = true;
      }
      continue;
    }
    if (pilot.wormholeCooldown > 0) continue;
    const exit = findWormholeExit(pilot.state.position);
    if (!exit) continue;
    triggerWormholeJump(exit, false);
    pilot.wormholeTransit = {
      start: { ...exit.entry },
      destination: { ...exit.destination },
      remaining: wormholeTransitDuration,
    };
    pilot.transiting = true;
    pilot.visual.group.visible = false;
  }
}

function findWormholeExit(position: Vec2): WormholeExit | undefined {
  const collisionRadius = wormholeRadius + config.shipRadius;
  const collisionDistance = collisionRadius * collisionRadius;
  for (const pair of wormholePairs.values()) {
    if (!isWormholeFullyFormed(pair)) continue;
    if (distanceSquared(position, pair.first) <= collisionDistance) {
      return { pair, entryIndex: 0, entry: pair.first, destination: pair.second };
    }
    if (distanceSquared(position, pair.second) <= collisionDistance) {
      return { pair, entryIndex: 1, entry: pair.second, destination: pair.first };
    }
  }
  return undefined;
}

function isWormholeFullyFormed(pair: WormholePair): boolean {
  return pair.age >= wormholeFadeInDuration &&
    pair.age <= wormholeLifetime - wormholeFadeOutDuration;
}

function triggerWormholeJump(exit: WormholeExit, broadcast: boolean): void {
  spawnWormholeJumpEffect(exit.entry, exit.destination, exit.pair.color);
  arcadeAudio.wormholeEnter(soundVolumeAt(exit.entry));
  if (broadcast && joined && portalsNet) {
    portalsNet.send({
      kind: "wormhole-jump",
      id: exit.pair.id,
      entry: exit.entryIndex,
    });
  }
}

function teleportShipThroughWormhole(state: ShipState, destination: Vec2): void {
  const speed = speedOf(state);
  const direction = speed > 1
    ? { x: state.velocity.x / speed, y: state.velocity.y / speed }
    : { x: Math.cos(state.angle), y: Math.sin(state.angle) };
  const exitDistance = wormholeRadius + config.shipRadius + 8;
  state.position.x = destination.x + direction.x * exitDistance;
  state.position.y = destination.y + direction.y * exitDistance;
}

function spawnWormholePair(): void {
  const positions = findRandomWormholePair();
  if (!positions) return;
  wormholeCounter += 1;
  const id = `wormhole-${wormholeCounter}`;
  const color = nextWormholeColor();
  createWormholePair(id, color, positions.first, positions.second);
  if (joined && portalsNet) {
    portalsNet.send({
      kind: "wormhole-spawn",
      id,
      color,
      x1: roundNetworkValue(positions.first.x),
      y1: roundNetworkValue(positions.first.y),
      x2: roundNetworkValue(positions.second.x),
      y2: roundNetworkValue(positions.second.y),
    });
  }
}

function findRandomWormholePair(): { first: Vec2; second: Vec2 } | null {
  const margin = wormholeRadius + config.shipRadius + 24;
  const minX = -worldWidth / 2 + margin;
  const maxX = worldWidth / 2 - margin;
  const minY = -worldHeight / 2 + margin;
  const maxY = worldHeight / 2 - margin;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const first = {
      x: minX + Math.random() * (maxX - minX),
      y: minY + Math.random() * (maxY - minY),
    };
    if (!isWormholePositionClear(first)) continue;
    for (let pairAttempt = 0; pairAttempt < 40; pairAttempt += 1) {
      const second = {
        x: minX + Math.random() * (maxX - minX),
        y: minY + Math.random() * (maxY - minY),
      };
      if (distanceSquared(first, second) < 320 * 320) continue;
      if (!isWormholePositionClear(second)) continue;
      return { first, second };
    }
  }
  return null;
}

function isWormholePositionClear(position: Vec2): boolean {
  if (walls.some((wall) =>
    circleIntersectsRect(position, wormholeRadius + config.shipRadius * 2 + 8, wall),
  )) {
    return false;
  }
  if ([...powerups.values()].some((powerup) =>
    distanceSquared(position, powerup.position) < (wormholeRadius + 32) ** 2,
  )) return false;
  return [...wormholePairs.values()].every((pair) =>
    distanceSquared(position, pair.first) >= (wormholeRadius * 2.5) ** 2 &&
    distanceSquared(position, pair.second) >= (wormholeRadius * 2.5) ** 2,
  );
}

function nextWormholeColor(): number {
  const usedColors = new Set([...wormholePairs.values()].map((pair) => pair.color));
  return wormholeColors.find((color) => !usedColors.has(color)) ??
    wormholeColors[wormholeCounter % wormholeColors.length];
}

function clampWormholeColor(color: number): number {
  return Math.round(clampNumber(color, 0, 0xffffff));
}

function findPowerupAt(position: Vec2): Powerup | undefined {
  return [...powerups.values()].find((powerup) =>
    circlesIntersect(position, config.shipRadius, powerup.position, 18),
  );
}

function spawnPowerup(): void {
  if (activeGameSettings.powerups.length === 0) return;
  const position = findRandomPowerupPosition();
  if (!position) return;
  powerupCounter += 1;
  const type = activeGameSettings.powerups[
    Math.floor(Math.random() * activeGameSettings.powerups.length)
  ];
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

function createWormholePair(
  id: string,
  color: number,
  first: Vec2,
  second: Vec2,
  age = 0,
): void {
  if (wormholePairs.has(id)) return;
  const visual = createWormholeVisual(color, first, second);
  scene.add(visual);
  wormholePairs.set(id, {
    id,
    color,
    first: { ...first },
    second: { ...second },
    visual,
    age: clampNumber(age, 0, wormholeLifetime),
    phase: Math.random() * Math.PI * 2,
  });
}

function removeWormholePair(id: string): void {
  const pair = wormholePairs.get(id);
  if (!pair) return;
  scene.remove(pair.visual);
  disposeWormholeVisual(pair.visual);
  wormholePairs.delete(id);
}

function clearWormholes(): void {
  for (const id of [...wormholePairs.keys()]) removeWormholePair(id);
}

function collectPowerupForLocal(powerup: Powerup): void {
  arcadeAudio.powerup(powerup.type);
  applyPowerup(
    powerup.type,
    shipShield,
    tripleShotTimer,
    homingMissileTimer,
    laserTimer,
    (shield, triple, missile, activeLaser) => {
    shipShield = shield;
    tripleShotTimer = triple;
      homingMissileTimer = missile;
      laserTimer = activeLaser;
    },
  );
  removePowerup(powerup.id);
  if (joined && portalsNet) {
    portalsNet.send({ kind: "powerup-pickup", id: powerup.id, picker: localId });
  }
}

function collectPowerupForPilot(id: string, pilot: RemotePilot, powerup?: Powerup): void {
  const pickup = powerup ?? findPowerupAt(pilot.state.position);
  if (!pickup) return;
  arcadeAudio.powerup(pickup.type, soundVolumeAt(pilot.state.position) * 0.65);
  applyPowerup(
    pickup.type,
    pilot.shield,
    pilot.tripleShotTimer,
    pilot.homingMissileTimer,
    pilot.laserTimer,
    (shield, triple, missile, activeLaser) => {
      pilot.shield = shield;
      pilot.tripleShotTimer = triple;
      pilot.homingMissileTimer = missile;
      pilot.laserTimer = activeLaser;
    },
  );
  removePowerup(pickup.id);
  if (joined && portalsNet) {
    portalsNet.send({ kind: "powerup-pickup", id: pickup.id, picker: id });
  }
}

function applyPowerup(
  type: PowerupType,
  currentShield: number,
  currentTripleTimer: number,
  currentMissileTimer: number,
  currentLaserTimer: number,
  setValues: (
    shield: number,
    tripleTimer: number,
    missileTimer: number,
    activeLaserTimer: number,
  ) => void,
): void {
  if (type === "shield") {
    setValues(shieldCapacity, currentTripleTimer, currentMissileTimer, currentLaserTimer);
  } else if (type === "triple") {
    setValues(
      currentShield,
      Math.max(currentTripleTimer, tripleShotDuration),
      currentMissileTimer,
      currentLaserTimer,
    );
  } else if (type === "missile") {
    setValues(
      currentShield,
      currentTripleTimer,
      Math.max(currentMissileTimer, homingMissileDuration),
      0,
    );
  } else {
    setValues(
      currentShield,
      currentTripleTimer,
      0,
      Math.max(currentLaserTimer, laserDuration),
    );
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
  const color = type === "shield"
    ? 0xc8f5ff
    : type === "triple"
      ? 0xffd166
      : type === "missile"
        ? 0xff8f70
        : 0x8dfff1;
  const accent = type === "shield"
    ? 0x69ddff
    : type === "triple"
      ? 0xff7a45
      : type === "missile"
        ? 0xff405f
        : 0x35d7ff;
  const aura = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    glowMaterial(color, 0.16),
  );
  aura.name = "aura";
  aura.rotation.z = Math.PI / 4;
  group.add(aura);

  const radiance = new THREE.Mesh(
    new THREE.PlaneGeometry(43, 43),
    glowMaterial(color, 0.065),
  );
  radiance.name = "radiance";
  radiance.rotation.z = Math.PI / 4;
  radiance.position.z = -0.2;
  group.add(radiance);

  const crystal = new THREE.Group();
  crystal.name = "crystal";
  crystal.add(
    createDiamondLoop(13, 18, color, 0.95),
    createDiamondLoop(8, 12, accent, 0.55),
  );
  const crystalCore = new THREE.Mesh(
    new THREE.PlaneGeometry(11, 11),
    glowMaterial(color, 0.3),
  );
  crystalCore.rotation.z = Math.PI / 4;
  crystal.add(crystalCore);
  group.add(crystal);

  const sparkleField = new THREE.Group();
  sparkleField.name = "sparkle-field";
  for (let index = 0; index < 10; index += 1) {
    const sparkle = new THREE.Mesh(
      createSparkleGeometry(2.2 + (index % 3) * 0.7),
      glowMaterial(index % 4 === 0 ? 0xffffff : accent, 0.9),
    );
    sparkle.userData.phase = (index / 10) * Math.PI * 2 + Math.random() * 0.35;
    sparkle.userData.radius = 17 + Math.random() * 11;
    sparkle.userData.speed = (index % 2 === 0 ? 1 : -1) * (0.35 + Math.random() * 0.45);
    sparkle.userData.verticalScale = 0.65 + Math.random() * 0.35;
    sparkleField.add(sparkle);
  }
  group.add(sparkleField);

  const icon = new THREE.Group();
  icon.name = "icon";

  if (type === "shield") {
    icon.add(
      new THREE.Mesh(new THREE.CircleGeometry(7.5, 20), glowMaterial(0xffffff, 0.22)),
      new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 9, 0.3),
          new THREE.Vector3(7, 6, 0.3),
          new THREE.Vector3(6, -2, 0.3),
          new THREE.Vector3(0, -9, 0.3),
          new THREE.Vector3(-6, -2, 0.3),
          new THREE.Vector3(-7, 6, 0.3),
        ]),
        glowLineMaterial(0xffffff, 0.95),
      ),
    );
  } else if (type === "triple") {
    for (const x of [-6, 0, 6]) {
      const barrel = new THREE.Mesh(
        new THREE.PlaneGeometry(3.5, 12),
        glowMaterial(x === 0 ? 0xffffff : accent, 0.9),
      );
      barrel.position.set(x, 0, 0.3);
      icon.add(barrel);
    }
    const muzzle = new THREE.Mesh(new THREE.CircleGeometry(3.2, 12), glowMaterial(color, 0.75));
    muzzle.position.y = 7;
    icon.add(muzzle);
  } else if (type === "missile") {
    const missile = new THREE.Mesh(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 10, 0.3),
        new THREE.Vector3(-5, -6, 0.3),
        new THREE.Vector3(0, -3, 0.3),
        new THREE.Vector3(5, -6, 0.3),
      ]).setIndex([0, 1, 2, 0, 2, 3]),
      glowMaterial(color, 0.95),
    );
    icon.add(missile);
    const exhaust = new THREE.Mesh(new THREE.PlaneGeometry(4, 7), glowMaterial(accent, 0.8));
    exhaust.position.y = -8;
    icon.add(exhaust);
  } else {
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(4, 20), glowMaterial(0xffffff, 0.95));
    icon.add(beam);
    for (const x of [-5, 5]) {
      const rail = new THREE.Mesh(new THREE.PlaneGeometry(2, 15), glowMaterial(accent, 0.65));
      rail.position.x = x;
      icon.add(rail);
    }
  }
  group.add(icon);
  return group;
}

function createDiamondLoop(
  halfWidth: number,
  halfHeight: number,
  color: number,
  opacity: number,
): THREE.LineLoop {
  return new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, halfHeight, 0.25),
      new THREE.Vector3(halfWidth, 0, 0.25),
      new THREE.Vector3(0, -halfHeight, 0.25),
      new THREE.Vector3(-halfWidth, 0, 0.25),
    ]),
    glowLineMaterial(color, opacity),
  );
}

function createSparkleGeometry(radius: number): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2 + Math.PI / 2;
    const pointRadius = index % 2 === 0 ? radius : radius * 0.2;
    const x = Math.cos(angle) * pointRadius;
    const y = Math.sin(angle) * pointRadius;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function glowMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.userData.baseOpacity = opacity;
  return material;
}

function glowLineMaterial(color: number, opacity: number): THREE.LineBasicMaterial {
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  material.userData.baseOpacity = opacity;
  return material;
}

function fadeMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.userData.baseOpacity = opacity;
  return material;
}

function createRadialLoop(
  radius: number,
  segments: number,
  color: number,
  opacity: number,
  ripple = 0,
): THREE.LineLoop {
  const points = Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    const pointRadius = radius + (index % 2 === 0 ? ripple : -ripple);
    return new THREE.Vector3(
      Math.cos(angle) * pointRadius,
      Math.sin(angle) * pointRadius,
      0.25,
    );
  });
  return new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    glowLineMaterial(color, opacity),
  );
}

function createOrganicRing(
  radius: number,
  wobble: number,
  phase: number,
  color: number,
  opacity: number,
  tubeRadius: number,
): THREE.Mesh {
  const points = Array.from({ length: 48 }, (_, index) => {
    const angle = (index / 48) * Math.PI * 2;
    const ripple =
      Math.sin(angle * 3 + phase) * wobble +
      Math.sin(angle * 7 - phase * 0.7) * wobble * 0.32;
    const pointRadius = radius + ripple;
    return new THREE.Vector3(
      Math.cos(angle) * pointRadius,
      Math.sin(angle) * pointRadius,
      Math.sin(angle * 2 + phase) * wobble * 0.38,
    );
  });
  const curve = new THREE.CatmullRomCurve3(points, true, "catmullrom", 0.45);
  return new THREE.Mesh(
    new THREE.TubeGeometry(curve, 72, tubeRadius, 6, true),
    glowMaterial(color, opacity),
  );
}

function createOrganicDisc(
  radius: number,
  wobble: number,
  phase: number,
  color: number,
  opacity: number,
  additive = true,
): THREE.Mesh {
  const shape = new THREE.Shape();
  for (let index = 0; index < 48; index += 1) {
    const angle = (index / 48) * Math.PI * 2;
    const pointRadius = radius +
      Math.sin(angle * 4 + phase) * wobble +
      Math.sin(angle * 9 - phase) * wobble * 0.25;
    const x = Math.cos(angle) * pointRadius;
    const y = Math.sin(angle) * pointRadius;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    additive ? glowMaterial(color, opacity) : fadeMaterial(color, opacity),
  );
}

function createWormholeTendril(
  phase: number,
  color: number,
  opacity: number,
): THREE.Mesh {
  const points = Array.from({ length: 24 }, (_, index) => {
    const progress = index / 23;
    const angle = phase + progress * Math.PI * 1.35;
    const radius = 7 + progress * 22 + Math.sin(progress * Math.PI * 3 + phase) * 1.6;
    return new THREE.Vector3(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      1 + Math.sin(progress * Math.PI + phase) * 3.5,
    );
  });
  const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.5);
  return new THREE.Mesh(
    new THREE.TubeGeometry(curve, 32, 0.7, 5, false),
    glowMaterial(color, opacity),
  );
}

function createWormholeVisual(color: number, first: Vec2, second: Vec2): THREE.Group {
  const group = new THREE.Group();
  group.position.z = 0.45;
  group.add(createWormholeHoleVisual(color, first), createWormholeHoleVisual(color, second));
  return group;
}

function createWormholeHoleVisual(color: number, position: Vec2): THREE.Group {
  const hole = new THREE.Group();
  hole.position.set(position.x, position.y, 0);
  const edgeColor = new THREE.Color(color).multiplyScalar(0.72).getHex();
  const deepColor = new THREE.Color(color).multiplyScalar(0.16).getHex();
  const innerColor = new THREE.Color(color).offsetHSL(0.02, -0.1, 0.1).getHex();

  const assembly = new THREE.Group();
  assembly.name = "rift-assembly";
  assembly.rotation.set(Math.PI * 0.12, 0, Math.PI * 0.16);

  const haze = createOrganicDisc(48, 5.5, 0.4, edgeColor, 0.018);
  haze.name = "rift-haze";
  haze.position.z = -5;

  const membrane = new THREE.Group();
  membrane.name = "rift-membrane";
  const shadow = createOrganicDisc(33, 4.2, 1.8, 0x010207, 0.94, false);
  shadow.position.z = -2.5;
  membrane.add(shadow);
  for (let index = 0; index < 4; index += 1) {
    const layer = createOrganicDisc(
      30 - index * 4.7,
      3.4 - index * 0.5,
      0.7 + index * 1.4,
      index % 2 === 0 ? deepColor : edgeColor,
      0.032 + index * 0.009,
    );
    layer.position.z = -1 + index * 1.15;
    membrane.add(layer);
  }

  const lips = new THREE.Group();
  lips.name = "rift-lips";
  lips.add(
    createOrganicRing(33, 4.5, 0.2, deepColor, 0.78, 3.8),
    createOrganicRing(32, 5.2, 2.7, edgeColor, 0.22, 1.35),
    createOrganicRing(28, 3.8, 4.4, innerColor, 0.14, 0.8),
  );

  const filaments = new THREE.Group();
  filaments.name = "rift-filaments";
  for (let index = 0; index < 9; index += 1) {
    const filament = createWormholeTendril(
      (index / 9) * Math.PI * 2 + (index % 2) * 0.23,
      index % 3 === 0 ? innerColor : edgeColor,
      0.11 + (index % 4) * 0.025,
    );
    filament.scale.setScalar(0.86 + (index % 3) * 0.07);
    filaments.add(filament);
  }

  const folds = new THREE.Group();
  folds.name = "rift-folds";
  folds.add(
    createOrganicRing(20, 3.1, 1.3, edgeColor, 0.25, 0.95),
    createOrganicRing(13, 2.2, 3.9, innerColor, 0.18, 0.65),
  );

  const core = createOrganicDisc(9, 2.1, 5.3, 0x000104, 0.98, false);
  core.name = "rift-core";
  core.position.z = 4;

  const motes = new THREE.Group();
  motes.name = "rift-motes";
  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * Math.PI * 2 + (index % 3) * 0.17;
    const radius = 19 + (index % 5) * 4.2;
    const mote = new THREE.Mesh(
      new THREE.SphereGeometry(0.35 + (index % 3) * 0.18, 5, 4),
      glowMaterial(index % 5 === 0 ? innerColor : edgeColor, 0.28),
    );
    mote.position.set(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      Math.sin(angle * 2.4) * 3 + 2,
    );
    mote.userData.phase = index * 1.73;
    motes.add(mote);
  }

  const crown = new THREE.Group();
  crown.name = "rift-crown";
  for (let index = 0; index < 3; index += 1) {
    const wisp = createWormholeTendril(
      index * (Math.PI * 2 / 3) + 0.8,
      innerColor,
      0.1,
    );
    wisp.scale.setScalar(1.18 + index * 0.08);
    crown.add(wisp);
  }

  assembly.add(haze, membrane, lips, filaments, folds, core, motes, crown);
  hole.add(assembly);
  hole.scale.setScalar(0.55);
  setVisualOpacity(hole, 0);
  return hole;
}

function updatePowerupVisuals(frameDelta: number): void {
  const time = performance.now() * 0.004;
  for (const powerup of powerups.values()) {
    const floatPhase = time * 0.72 + powerup.phase;
    const verticalMotion = Math.sin(floatPhase);
    const landingSquash = Math.pow(Math.max(0, -verticalMotion), 6);
    const pulse = 1 + Math.sin(time * 1.2 + powerup.phase) * 0.04;
    const baseScale = 1.2 * pulse;
    powerup.visual.scale.set(
      baseScale * (1 + landingSquash * 0.07),
      baseScale * (1 - landingSquash * 0.09),
      baseScale,
    );
    powerup.visual.position.set(
      powerup.position.x + Math.sin(time * 0.38 + powerup.phase) * 3.5,
      powerup.position.y + verticalMotion * 6.5,
      2 + Math.sin(time * 0.5 + powerup.phase) * 0.4,
    );
    const crystal = powerup.visual.getObjectByName("crystal");
    const icon = powerup.visual.getObjectByName("icon");
    if (crystal) crystal.rotation.z = Math.sin(time * 0.45 + powerup.phase) * 0.14;
    if (icon) {
      icon.rotation.z = -Math.sin(time * 0.45 + powerup.phase) * 0.08;
      icon.scale.setScalar(1 + Math.sin(time * 1.4 + powerup.phase) * 0.06);
    }
    const aura = powerup.visual.getObjectByName("aura");
    if (aura) {
      aura.rotation.z += frameDelta * (powerup.type === "shield" ? 0.25 : -0.25);
      aura.scale.setScalar(0.88 + Math.sin(time * 1.2 + powerup.phase) * 0.1);
    }
    const radiance = powerup.visual.getObjectByName("radiance");
    if (radiance) {
      radiance.rotation.z -= frameDelta * (powerup.type === "shield" ? 0.12 : -0.12);
      radiance.scale.setScalar(0.92 + Math.sin(time * 0.8 + powerup.phase) * 0.12);
    }
    const sparkleField = powerup.visual.getObjectByName("sparkle-field");
    if (sparkleField) {
      sparkleField.children.forEach((sparkle, index) => {
        const angle = time * sparkle.userData.speed + sparkle.userData.phase + powerup.phase;
        sparkle.position.set(
          Math.cos(angle) * sparkle.userData.radius,
          Math.sin(angle) * sparkle.userData.radius * sparkle.userData.verticalScale,
          0.4,
        );
        sparkle.rotation.z -= frameDelta * sparkle.userData.speed * 1.8;
        const twinkle = 0.2 + Math.pow(Math.max(0, Math.sin(time * 2.4 + index)), 2) * 0.8;
        sparkle.scale.setScalar(0.45 + twinkle * 0.8);
        const material = (sparkle as THREE.Mesh).material as THREE.MeshBasicMaterial;
        material.opacity = material.userData.baseOpacity * twinkle;
      });
    }
  }
}

function updateWormholeVisuals(frameDelta: number): void {
  const time = performance.now() * 0.003;
  for (const pair of wormholePairs.values()) {
    const fadeIn = smoothStep01(pair.age / wormholeFadeInDuration);
    const fadeOut = smoothStep01((wormholeLifetime - pair.age) / wormholeFadeOutDuration);
    const visibility = fadeIn * fadeOut;
    const pulse = 1 + Math.sin(time * 1.4 + pair.phase) * 0.07;
    pair.visual.children.forEach((object, index) => {
      const hole = object as THREE.Group;
      const direction = index === 0 ? 1 : -1;
      const assembly = hole.getObjectByName("rift-assembly");
      const membrane = hole.getObjectByName("rift-membrane");
      const lips = hole.getObjectByName("rift-lips");
      const filaments = hole.getObjectByName("rift-filaments");
      const folds = hole.getObjectByName("rift-folds");
      const motes = hole.getObjectByName("rift-motes");
      const crown = hole.getObjectByName("rift-crown");
      const haze = hole.getObjectByName("rift-haze");
      const core = hole.getObjectByName("rift-core");
      if (assembly) {
        assembly.rotation.y = Math.sin(time * 0.23 + pair.phase + index) * 0.035;
      }
      if (membrane) {
        membrane.rotation.z += frameDelta * 0.07 * direction;
        membrane.children.forEach((layer, layerIndex) => {
          const breathe = 1 + Math.sin(
            time * (0.55 + layerIndex * 0.08) + pair.phase + layerIndex,
          ) * 0.025;
          layer.scale.setScalar(breathe);
        });
      }
      if (lips) {
        lips.rotation.z -= frameDelta * 0.045 * direction;
        lips.scale.setScalar(1 + Math.sin(time * 0.72 + pair.phase) * 0.02);
      }
      if (filaments) filaments.rotation.z += frameDelta * 0.28 * direction;
      if (folds) folds.rotation.z -= frameDelta * 0.46 * direction;
      if (crown) crown.rotation.z += frameDelta * 0.11 * direction;
      if (motes) {
        motes.rotation.z -= frameDelta * 0.16 * direction;
        motes.children.forEach((mote) => {
          const flicker = 0.35 + Math.pow(
            0.5 + Math.sin(time * 1.7 + mote.userData.phase + pair.phase) * 0.5,
            3,
          ) * 0.65;
          mote.scale.setScalar(flicker);
        });
      }
      if (haze) haze.scale.setScalar(0.96 + Math.sin(time * 0.65 + pair.phase + index) * 0.045);
      if (core) core.scale.setScalar(0.9 + Math.sin(time * 0.9 + pair.phase) * 0.06);
      hole.scale.setScalar((0.55 + fadeIn * 0.45) * pulse * (0.9 + fadeOut * 0.1));
      setVisualOpacity(hole, visibility);
    });
  }
}

function smoothStep01(value: number): number {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function setVisualOpacity(root: THREE.Object3D, multiplier: number): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.LineLoop)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const baseOpacity = material.userData.baseOpacity;
      if (typeof baseOpacity === "number") material.opacity = baseOpacity * multiplier;
    }
  });
}

function spawnWormholeJumpEffect(start: Vec2, end: Vec2, color: number): void {
  const group = new THREE.Group();
  group.position.z = 2.5;
  const brightColor = new THREE.Color(color).offsetHSL(0, 0, 0.2).getHex();
  const particles = Array.from({ length: 32 }, (_, index): WormholeJumpParticle => {
    const material = new THREE.MeshBasicMaterial({
      color: index % 5 === 0 ? brightColor : color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(explosionPixelGeometry, material);
    mesh.rotation.z = Math.PI / 4 + Math.random() * Math.PI;
    mesh.visible = false;
    group.add(mesh);
    return {
      mesh,
      delay: (index / 32) * 0.28 + Math.random() * 0.035,
      travelDuration: 0.52 + Math.random() * 0.18,
      phase: Math.random() * Math.PI * 2,
      lateral: 4 + Math.random() * 10,
      size: 2 + Math.random() * 3.5,
      spin: (Math.random() - 0.5) * 10,
    };
  });
  scene.add(group);
  wormholeJumpEffects.push({
    group,
    particles,
    start: { ...start },
    end: { ...end },
    age: 0,
    duration: 1.02,
  });
}

function updateWormholeJumpEffects(deltaSeconds: number): void {
  for (let index = wormholeJumpEffects.length - 1; index >= 0; index -= 1) {
    const effect = wormholeJumpEffects[index];
    effect.age += deltaSeconds;
    const deltaX = effect.end.x - effect.start.x;
    const deltaY = effect.end.y - effect.start.y;
    const distance = Math.hypot(deltaX, deltaY) || 1;
    const normalX = -deltaY / distance;
    const normalY = deltaX / distance;

    for (const particle of effect.particles) {
      const progress = (effect.age - particle.delay) / particle.travelDuration;
      if (progress < 0 || progress > 1) {
        particle.mesh.visible = false;
        continue;
      }
      particle.mesh.visible = true;
      const eased = progress * progress * (3 - 2 * progress);
      const glow = Math.sin(progress * Math.PI);
      const wave = Math.sin(progress * Math.PI * 5 + particle.phase) * particle.lateral * glow;
      particle.mesh.position.set(
        effect.start.x + deltaX * eased + normalX * wave,
        effect.start.y + deltaY * eased + normalY * wave,
        0,
      );
      particle.mesh.rotation.z += particle.spin * deltaSeconds;
      particle.mesh.scale.setScalar(particle.size * (0.35 + glow));
      (particle.mesh.material as THREE.MeshBasicMaterial).opacity = glow * 0.9;
    }

    if (effect.age >= effect.duration) removeWormholeJumpEffect(index);
  }
}

function removeWormholeJumpEffect(index: number): void {
  const effect = wormholeJumpEffects[index];
  scene.remove(effect.group);
  for (const particle of effect.particles) {
    (particle.mesh.material as THREE.Material).dispose();
  }
  wormholeJumpEffects.splice(index, 1);
}

function clearWormholeJumpEffects(): void {
  for (let index = wormholeJumpEffects.length - 1; index >= 0; index -= 1) {
    removeWormholeJumpEffect(index);
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

function disposeWormholeVisual(group: THREE.Group): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.LineLoop)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}

function spawnExplosion(position: Vec2, shakeCamera = false): void {
  if (shakeCamera) cameraShake = Math.min(8, cameraShake + 4);
  arcadeAudio.explosion(shakeCamera ? 1 : soundVolumeAt(position) * 0.78);
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

function setControlsModalVisible(visible: boolean): void {
  controlsModalOpen = visible;
  controlsModal.classList.toggle("hidden", !visible);
  helpButton.setAttribute("aria-expanded", String(visible));
  if (visible) {
    heldKeys.clear();
    resetGamepadInput();
    updateInput();
    closeControlsButton.focus();
  } else {
    helpButton.focus();
  }
}

function setSettingsModalVisible(visible: boolean): void {
  settingsModalOpen = visible;
  settingsModal.classList.toggle("hidden", !visible);
  settingsButton.setAttribute("aria-expanded", String(visible));
  if (visible) {
    heldKeys.clear();
    resetGamepadInput();
    updateInput();
    closeSettingsButton.focus();
  } else if (!settingsButton.classList.contains("hidden")) {
    settingsButton.focus();
  }
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
  if (joined && !serverFallbackActive) {
    simulateHostedFixedStep();
    return;
  }
  if (respawnTimer > 0) {
    respawnTimer = Math.max(0, respawnTimer - fixedStep);
    if (respawnTimer === 0) respawnLocalShip();
  } else if (!wormholeTransit) {
    stepShip(ship, input, config, fixedStep);
    const collisionSpeed = speedOf(ship);
    for (const wall of walls) {
      const collided = resolveCircleAgainstRect(
        ship,
        wall,
        config.shipRadius,
        config.wallRestitution,
      );
      if (collided && !collidedThisFrame) arcadeAudio.impact(collisionSpeed);
      collidedThisFrame = collided || collidedThisFrame;
    }

    weaponCooldown = Math.max(0, weaponCooldown - fixedStep);
    tripleShotTimer = Math.max(0, tripleShotTimer - fixedStep);
    homingMissileTimer = Math.max(0, homingMissileTimer - fixedStep);
    laserTimer = Math.max(0, laserTimer - fixedStep);
    if ((heldKeys.has("Space") || gamepadFire) && weaponCooldown <= 0) {
      const weapon = activeWeapon(homingMissileTimer, laserTimer);
      if (weapon === "laser") {
        const fired = fireLaserVolley(ship, localId, tripleShotTimer > 0, true);
        if (fired) {
          playWeaponFireSound(weapon, tripleShotTimer > 0);
          weaponCooldown = weaponCooldownFor(weapon);
        }
      } else {
        const shots = fireVolley(ship, localId, tripleShotTimer > 0, weapon);
        if (shots.length > 0) {
        playWeaponFireSound(weapon, tripleShotTimer > 0);
        for (const state of shots) {
          addBullet(state, true, weapon);
          broadcastShot(state, weapon);
        }
        weaponCooldown = weaponCooldownFor(weapon);
        }
      }
    }
  }

  stepCpuPilots();
  stepPowerups();
  stepWormholes();

  for (let index = bullets.length - 1; index >= 0; index -= 1) {
    const bullet = bullets[index];
    if (bullet.weapon === "missile") steerHomingMissile(bullet, fixedStep);
    stepBullet(bullet.state, fixedStep);
    const collisionRadius = weaponCollisionRadius(bullet.weapon);
    for (const wall of walls) {
      if (resolveBulletAgainstRect(bullet.state, wall, collisionRadius, config.wallRestitution)) {
        arcadeAudio.ricochet(soundVolumeAt(bullet.state.position) * 0.7);
      }
    }
    const hitLocal =
      bullet.state.owner !== localId &&
      respawnTimer === 0 &&
      !wormholeTransit &&
      circlesIntersect(bullet.state.position, collisionRadius, ship.position, config.shipRadius);
    const ownerPilot = remotePilots.get(bullet.state.owner);
    const canHitRemotePilot =
      bullet.state.owner === localId || ownerPilot?.isCpu === true;
    const hitRemotePilot = canHitRemotePilot
      ? [...remotePilots.entries()].find(
          ([id, pilot]) =>
            id !== bullet.state.owner &&
            !pilot.respawning &&
            !pilot.transiting &&
            (bullet.state.owner === localId || ownerPilot?.isCpu === true) &&
            circlesIntersect(
              bullet.state.position,
              collisionRadius,
              pilot.state.position,
              config.shipRadius,
            ),
        )?.[1]
      : undefined;
    const hitRemote = Boolean(hitRemotePilot);

    if (hitLocal) {
      const shielded = shipShield > 0;
      shipShield = applyDamage(ship, shipShield, weaponDamage(bullet.weapon));
      if (shielded) arcadeAudio.shieldHit();
      else arcadeAudio.hullHit();
      if (ship.energy === 0) {
        destroyLocalShip();
        return;
      }
    }
    if (hitRemotePilot?.isCpu) {
      const shielded = hitRemotePilot.shield > 0;
      hitRemotePilot.shield = applyDamage(
        hitRemotePilot.state,
        hitRemotePilot.shield,
        weaponDamage(bullet.weapon),
      );
      const hitVolume = soundVolumeAt(hitRemotePilot.state.position) * 0.72;
      if (shielded) arcadeAudio.shieldHit(hitVolume);
      else arcadeAudio.hullHit(hitVolume);
      if (hitRemotePilot.state.energy === 0) {
        destroyCpuPilot(hitRemotePilot);
      }
    } else if (hitRemotePilot) {
      const hitVolume = soundVolumeAt(hitRemotePilot.state.position) * 0.72;
      if (hitRemotePilot.shield > 0) arcadeAudio.shieldHit(hitVolume);
      else arcadeAudio.hullHit(hitVolume);
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

function simulateHostedFixedStep(): void {
  serverInputElapsed += fixedStep;
  sendServerInput();
  if (!hasReceivedServerSnapshot) {
    localVisual.group.visible = false;
    if (performance.now() - lastServerSnapshotAt > 1500) {
      if (logicalRoomMode) connectionMessage.textContent = "WAITING FOR SERVER SNAPSHOT…";
      else activatePeerFallback();
    }
    return;
  }

  if (respawnTimer <= 0 && !wormholeTransit) {
    // Predict only the local ship for responsive controls. Every server snapshot
    // gently reconciles this state and remains authoritative for combat/results.
    stepShip(ship, input, config, fixedStep);
    for (const wall of walls) {
      resolveCircleAgainstRect(ship, wall, config.shipRadius, config.wallRestitution);
    }
  }

  for (const bullet of bullets) {
    if (bullet.weapon === "missile") steerHomingMissile(bullet, fixedStep);
    stepBullet(bullet.state, fixedStep);
    for (const wall of walls) {
      resolveBulletAgainstRect(
        bullet.state,
        wall,
        weaponCollisionRadius(bullet.weapon),
        config.wallRestitution,
      );
    }
  }
  for (const pair of wormholePairs.values()) pair.age += fixedStep;

  if (lastServerSnapshotAt > 0 && performance.now() - lastServerSnapshotAt > 1500) {
    if (logicalRoomMode) connectionMessage.textContent = "SERVER SYNC INTERRUPTED…";
    else activatePeerFallback();
  }
}

function activatePeerFallback(): void {
  if (serverFallbackActive || !joined) return;
  serverAuthorityActive = false;
  serverFallbackActive = true;
  connectionMessage.textContent = "SERVER UNAVAILABLE — PEER FALLBACK";
  if (!hasReceivedServerSnapshot) respawnLocalShip();
  else localVisual.group.visible = respawnTimer <= 0 && !wormholeTransit;
  if (!portalsNet) return;
  if (isGameCreator) broadcastGameSettings();
  else {
    portalsNet.send({ kind: "game-settings-request" });
    portalsNet.send({ kind: "powerup-sync-request" });
    portalsNet.send({ kind: "wormhole-sync-request" });
  }
}

function sendServerInput(force = false): void {
  if (!joined || !portalsNet) return;
  const mask =
    Number(input.thrust) |
    (Number(input.reverse) << 1) |
    (Number(input.turnLeft) << 2) |
    (Number(input.turnRight) << 3) |
    (Number(input.boost) << 4);
  const firing = heldKeys.has("Space") || gamepadFire;
  const changed = mask !== lastServerInputMask || firing !== lastServerFire;
  if (!force && serverInputElapsed < (changed ? 0.025 : 0.1)) return;
  serverInputElapsed = 0;
  lastServerInputMask = mask;
  lastServerFire = firing;
  serverInputSequence += 1;
  portalsNet.send({ k: "i", q: serverInputSequence, m: mask, f: firing });
}

function stepCpuPilots(): void {
  if (!offline) return;
  for (const [cpuId, pilot] of remotePilots) {
    if (!pilot.isCpu) continue;
    pilot.cpuWeaponCooldown = Math.max(0, pilot.cpuWeaponCooldown - fixedStep);
    pilot.tripleShotTimer = Math.max(0, pilot.tripleShotTimer - fixedStep);
    pilot.homingMissileTimer = Math.max(0, pilot.homingMissileTimer - fixedStep);
    pilot.laserTimer = Math.max(0, pilot.laserTimer - fixedStep);

    if (pilot.cpuRespawnTimer > 0) {
      pilot.cpuRespawnTimer = Math.max(0, pilot.cpuRespawnTimer - fixedStep);
      if (pilot.cpuRespawnTimer === 0) {
        pilot.state = createCpuShip();
        pilot.shield = 0;
        pilot.tripleShotTimer = 0;
        pilot.homingMissileTimer = 0;
        pilot.laserTimer = 0;
        pilot.wormholeCooldown = 0;
        pilot.transiting = false;
        pilot.wormholeTransit = null;
        snapVisualToState(pilot.visual, pilot.state);
        pilot.visualReady = true;
        pilot.respawning = false;
        pilot.visual.group.visible = true;
      }
      continue;
    }

    if (pilot.transiting) {
      pilot.thrusting = false;
      pilot.boosting = false;
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
      const weapon = activeWeapon(pilot.homingMissileTimer, pilot.laserTimer);
      if (weapon === "laser") {
        const fired = fireLaserVolley(pilot.state, cpuId, pilot.tripleShotTimer > 0, false);
        if (fired) {
          playWeaponFireSound(
            weapon,
            pilot.tripleShotTimer > 0,
            soundVolumeAt(pilot.state.position) * 0.5,
          );
          pilot.cpuWeaponCooldown = weaponCooldownFor(weapon);
        }
      } else {
        const shots = fireVolley(pilot.state, cpuId, pilot.tripleShotTimer > 0, weapon);
        if (shots.length > 0) {
        playWeaponFireSound(
          weapon,
          pilot.tripleShotTimer > 0,
          soundVolumeAt(pilot.state.position) * 0.5,
        );
        for (const bullet of shots) addBullet(bullet, false, weapon);
        pilot.cpuWeaponCooldown = weaponCooldownFor(weapon);
        }
      }
    }
  }
}

function findCpuTarget(cpuId: string, cpu: ShipState): ShipState | null {
  let target: ShipState | null = respawnTimer === 0 && !wormholeTransit ? ship : null;
  let closestDistance = target
    ? distanceSquared(cpu.position, target.position)
    : Number.POSITIVE_INFINITY;

  for (const [id, pilot] of remotePilots) {
    if (id === cpuId || !pilot.isCpu || pilot.respawning || pilot.transiting) continue;
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

function soundVolumeAt(position: Vec2): number {
  const distance = Math.sqrt(distanceSquared(position, ship.position));
  return THREE.MathUtils.clamp(1 - distance / 900, 0.08, 1);
}

function updateEnemyEnergyHud(): void {
  let target: [string, RemotePilot] | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const entry of remotePilots.entries()) {
    const [, pilot] = entry;
    if (pilot.respawning || pilot.transiting || !pilot.visualReady) continue;
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
  const displayName = multiplayerDisplayName(id);
  const label = pilot.isCpu
    ? `CPU ${id.replace("cpu-", "")}`
    : displayName
      ? `Enemy ${displayName}`
      : unknownEnemyName(id);
  enemyName.textContent = label;
  enemyEnergyValue.textContent = Math.round(pilot.state.energy).toString().padStart(3, "0");
  enemyEnergyFill.style.width = `${energyPercent}%`;
  enemyEnergyFill.classList.toggle("low", energyPercent < 25);
  enemyHud.classList.remove("hidden");
}

function renderWorld(frameDelta: number): void {
  const renderTime = performance.now() * 0.001;
  localVisual.group.position.set(ship.position.x, ship.position.y, 1);
  localVisual.group.rotation.z = ship.angle;
  localVisual.group.visible = respawnTimer === 0 && !wormholeTransit;
  updateShieldVisual(localVisual, shipShield);
  const boosting = input.boost && input.thrust && ship.energy > 0 && !paused;
  updateThrusterVisual(
    localVisual,
    input.thrust && !paused && respawnTimer === 0 && !wormholeTransit,
    boosting,
    renderTime,
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
    updateThrusterVisual(
      pilot.visual,
      pilot.thrusting && !pilot.respawning && !pilot.transiting && !paused,
      pilot.boosting,
      renderTime,
    );
  }

  for (const bullet of bullets) {
    bullet.mesh.position.set(bullet.state.position.x, bullet.state.position.y, 1);
    if (bullet.weapon !== "standard") {
      bullet.mesh.rotation.z = Math.atan2(bullet.state.velocity.y, bullet.state.velocity.x);
    }
  }

  if (!paused) updateExplosions(frameDelta);
  if (!paused) updateLaserBeams(frameDelta);
  if (!paused) updatePowerupVisuals(frameDelta);
  if (!paused) updateWormholeVisuals(frameDelta);
  if (!paused) updateWormholeJumpEffects(frameDelta);

  if (wormholeTransit) {
    const jumpProgress = 1 - wormholeTransit.remaining / wormholeTransitDuration;
    const travelProgress = smoothStep01(jumpProgress);
    cameraTarget.set(
      THREE.MathUtils.lerp(
        wormholeTransit.start.x,
        wormholeTransit.destination.x,
        travelProgress,
      ),
      THREE.MathUtils.lerp(
        wormholeTransit.start.y,
        wormholeTransit.destination.y,
        travelProgress,
      ),
      0,
    );
    const jumpCameraLerp = 1 - Math.exp(-18 * frameDelta);
    camera.position.x += (cameraTarget.x - camera.position.x) * jumpCameraLerp;
    camera.position.y += (cameraTarget.y - camera.position.y) * jumpCameraLerp;
  } else {
    cameraTarget.set(ship.position.x, ship.position.y, 0);
    const cameraLerp = 1 - Math.exp(-5 * frameDelta);
    camera.position.x += (cameraTarget.x - camera.position.x) * cameraLerp;
    camera.position.y += (cameraTarget.y - camera.position.y) * cameraLerp;
  }
  if (!paused && cameraShake > 0) {
    camera.position.x += (Math.random() - 0.5) * cameraShake;
    camera.position.y += (Math.random() - 0.5) * cameraShake;
  }
  updateStarfield();

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
  updatePowerupTray();
  speedValue.textContent = Math.round(speedOf(ship)).toString().padStart(3, "0");
  positionValue.textContent = `${Math.round(ship.position.x)}, ${Math.round(ship.position.y)}`;
  stateValue.textContent = !joined && !offline
    ? "WAITING"
    : paused
      ? "PAUSED"
      : respawnTimer > 0
        ? `RESPAWN ${respawnTimer.toFixed(1)}`
        : wormholeTransit
          ? "JUMP"
          : collidedThisFrame
            ? "IMPACT"
            : boosting
              ? "BOOST"
              : input.thrust || input.reverse
                ? "THRUST"
                : "DRIFT";

  renderer.render(scene, camera);
}

function updatePowerupTray(): void {
  const inSession = joined || offline;
  const shieldActive = inSession && shipShield > 0;
  const tripleActive = inSession && tripleShotTimer > 0;
  const missileActive = inSession && homingMissileTimer > 0;
  const laserActive = inSession && laserTimer > 0;
  const anyActive = shieldActive || tripleActive || missileActive || laserActive;
  powerupTray.classList.toggle("hidden", !anyActive);
  shieldPowerupCard.classList.toggle("hidden", !shieldActive);
  triplePowerupCard.classList.toggle("hidden", !tripleActive);
  missilePowerupCard.classList.toggle("hidden", !missileActive);
  laserPowerupCard.classList.toggle("hidden", !laserActive);
  chatPanel.classList.toggle("powerups-active", anyActive);

  if (shieldActive) {
    const shieldPercent = THREE.MathUtils.clamp(shipShield / shieldCapacity, 0, 1) * 100;
    shieldPowerupValue.textContent = `${Math.ceil(shipShield)} HP`;
    shieldPowerupFill.style.width = `${shieldPercent}%`;
    shieldPowerupCard.classList.toggle("expiring", shieldPercent <= 25);
  }

  if (tripleActive) {
    const triplePercent = THREE.MathUtils.clamp(tripleShotTimer / tripleShotDuration, 0, 1) * 100;
    triplePowerupValue.textContent = `${tripleShotTimer.toFixed(1)}s`;
    triplePowerupFill.style.width = `${triplePercent}%`;
    triplePowerupCard.classList.toggle("expiring", tripleShotTimer <= 3);
  }

  if (missileActive) {
    const missilePercent = THREE.MathUtils.clamp(
      homingMissileTimer / homingMissileDuration,
      0,
      1,
    ) * 100;
    missilePowerupValue.textContent = `${homingMissileTimer.toFixed(1)}s`;
    missilePowerupFill.style.width = `${missilePercent}%`;
    missilePowerupCard.classList.toggle("expiring", homingMissileTimer <= 3);
  }

  if (laserActive) {
    const laserPercent = THREE.MathUtils.clamp(laserTimer / laserDuration, 0, 1) * 100;
    laserPowerupValue.textContent = `${laserTimer.toFixed(1)}s`;
    laserPowerupFill.style.width = `${laserPercent}%`;
    laserPowerupCard.classList.toggle("expiring", laserTimer <= 3);
  }
}

function snapVisualToState(visual: ShipVisual, state: ShipState): void {
  visual.group.position.set(state.position.x, state.position.y, 1);
  visual.group.rotation.z = state.angle;
}

function updateShieldVisual(visual: ShipVisual, shield: number): void {
  const strength = THREE.MathUtils.clamp(shield / shieldCapacity, 0, 1);
  visual.shield.visible = strength > 0;
  if (strength === 0) return;

  const time = performance.now() * 0.001;
  const shade = 0.42 + strength * 0.58;
  const damagedFlicker = strength < 0.35 ? 0.82 + Math.sin(time * 24) * 0.12 : 1;
  const fieldStrength = (0.4 + strength * 0.6) * damagedFlicker;
  setVisualOpacity(visual.shield, fieldStrength);
  visual.shield.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.LineLoop)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshBasicMaterial || material instanceof THREE.LineBasicMaterial) {
        material.color.setRGB(shade, shade, shade);
      }
    }
  });

  const outer = visual.shield.getObjectByName("shield-outer");
  const inner = visual.shield.getObjectByName("shield-inner");
  const bubble = visual.shield.getObjectByName("shield-bubble");
  const grid = visual.shield.getObjectByName("shield-grid");
  const twinkles = visual.shield.getObjectByName("shield-twinkles");
  if (outer) outer.rotation.z = time * 0.42;
  if (inner) inner.rotation.z = -time * 0.68;
  if (grid) {
    grid.rotation.x = time * 0.12;
    grid.rotation.y = time * 0.18;
  }
  if (bubble) {
    bubble.scale.setScalar(0.98 + Math.sin(time * 3.4) * 0.035);
    const sphereMaterial = (bubble as THREE.Mesh).material as THREE.ShaderMaterial;
    sphereMaterial.uniforms.time.value = time;
    sphereMaterial.uniforms.visibility.value = fieldStrength;
    (sphereMaterial.uniforms.tint.value as THREE.Color).setRGB(shade, shade, shade);
  }
  if (twinkles) {
    twinkles.children.forEach((object) => {
      const twinkle = object as THREE.Mesh;
      const cycle = 0.5 + Math.sin(
        time * twinkle.userData.twinkleSpeed + twinkle.userData.twinklePhase,
      ) * 0.5;
      const glint = Math.pow(cycle, 7);
      const driftAngle = time * twinkle.userData.driftSpeed + twinkle.userData.twinklePhase;
      twinkle.position.set(
        twinkle.userData.originX + Math.cos(driftAngle) * 0.8,
        twinkle.userData.originY + Math.sin(driftAngle * 0.83) * 0.8,
        twinkle.userData.originZ + Math.sin(driftAngle * 0.6) * 0.5,
      );
      twinkle.rotation.z = driftAngle * 0.4;
      twinkle.scale.setScalar(0.35 + glint * 0.9);
      const material = twinkle.material as THREE.MeshBasicMaterial;
      const depthBrightness = THREE.MathUtils.clamp(
        0.45 + (twinkle.position.z / 27) * 0.35,
        0.18,
        0.8,
      );
      material.opacity =
        material.userData.baseOpacity * fieldStrength * (0.04 + glint * 0.4) * depthBrightness;
      const twinkleShade = shade + (1 - shade) * glint * 0.6;
      material.color.setRGB(twinkleShade, twinkleShade, twinkleShade);
    });
  }
  visual.shield.scale.setScalar(1 + Math.sin(time * 2.2) * 0.025);
}

function createShieldSphereMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tint: { value: new THREE.Color(0xffffff) },
      visibility: { value: 0 },
      time: { value: 0 },
    },
    vertexShader: `
      varying vec3 sphereNormal;
      varying vec3 spherePosition;

      void main() {
        sphereNormal = normalize(normalMatrix * normal);
        spherePosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 tint;
      uniform float visibility;
      uniform float time;
      varying vec3 sphereNormal;
      varying vec3 spherePosition;

      void main() {
        vec3 normal = normalize(sphereNormal);
        float rim = pow(1.0 - abs(normal.z), 2.35);
        vec3 lightDirection = normalize(vec3(-0.55, 0.7, 0.85));
        float highlight = pow(max(dot(normal, lightDirection), 0.0), 15.0);
        float energyGrain = 0.5 + 0.5 * sin(
          spherePosition.x * 0.24 + spherePosition.y * 0.18 + time * 1.8
        );
        float alpha = (0.012 + rim * 0.16 + highlight * 0.11 + energyGrain * 0.008)
          * visibility;
        vec3 color = tint * (0.68 + rim * 0.3 + highlight * 0.4);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  });
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
  const exhaust = createThrusterVisual(exhaustColor);
  const shield = new THREE.Group();
  const bubble = new THREE.Mesh(
    new THREE.SphereGeometry(26, 36, 22),
    createShieldSphereMaterial(),
  );
  bubble.name = "shield-bubble";

  const gridMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.09,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    wireframe: true,
  });
  gridMaterial.userData.baseOpacity = 0.09;
  const sphereGrid = new THREE.Mesh(new THREE.SphereGeometry(26.6, 16, 10), gridMaterial);
  sphereGrid.name = "shield-grid";

  const outerShield = new THREE.Group();
  outerShield.name = "shield-outer";
  outerShield.rotation.x = Math.PI * 0.34;
  outerShield.add(createRadialLoop(27.8, 40, 0xffffff, 0.24));

  const innerShield = new THREE.Group();
  innerShield.name = "shield-inner";
  innerShield.rotation.y = Math.PI * 0.42;
  innerShield.add(createRadialLoop(26.9, 40, 0xffffff, 0.17));

  const shieldTwinkles = new THREE.Group();
  shieldTwinkles.name = "shield-twinkles";
  for (let index = 0; index < 18; index += 1) {
    const theta = Math.random() * Math.PI * 2;
    const vertical = Math.random() * 2 - 1;
    const radius = Math.cbrt(Math.random()) * 27;
    const horizontal = Math.sqrt(1 - vertical * vertical);
    const twinkle = new THREE.Mesh(
      createSparkleGeometry(0.8 + Math.random() * 0.9),
      glowMaterial(0xffffff, 0.38),
    );
    twinkle.userData.originX = Math.cos(theta) * horizontal * radius;
    twinkle.userData.originY = Math.sin(theta) * horizontal * radius;
    twinkle.userData.originZ = vertical * radius;
    twinkle.userData.twinklePhase = Math.random() * Math.PI * 2;
    twinkle.userData.twinkleSpeed = 1.2 + Math.random() * 2.2;
    twinkle.userData.driftSpeed = (Math.random() - 0.5) * 0.6;
    shieldTwinkles.add(twinkle);
  }
  shield.add(bubble, sphereGrid, shieldTwinkles, innerShield, outerShield);
  setVisualOpacity(shield, 0);
  shield.visible = false;
  group.add(mesh, edges, exhaust, shield);
  return { group, exhaust, shield };
}

function createThrusterVisual(exhaustColor: number): THREE.Group {
  const exhaust = new THREE.Group();
  exhaust.name = "thruster-fire";
  exhaust.userData.phase = Math.random() * Math.PI * 2;

  const plumeHaze = createFlameMesh(55, 14, exhaustColor, 0.035);
  plumeHaze.name = "thruster-haze";
  plumeHaze.position.z = -0.12;

  const outerFlame = createFlameMesh(43, 11.5, 0xff542d, 0.17);
  outerFlame.name = "thruster-outer";
  const middleFlame = createFlameMesh(34, 7.5, 0xffb52e, 0.25);
  middleFlame.name = "thruster-middle";
  middleFlame.position.z = 0.05;
  const coreColor = new THREE.Color(exhaustColor).lerp(new THREE.Color(0xfff4c2), 0.72).getHex();
  const coreFlame = createFlameMesh(24, 4.2, coreColor, 0.38);
  coreFlame.name = "thruster-core";
  coreFlame.position.z = 0.1;

  const flameTongues = new THREE.Group();
  flameTongues.name = "thruster-tongues";
  const tongueColors = [0xff6535, 0xff8c42, 0xffc857, coreColor];
  for (let index = 0; index < 4; index += 1) {
    const tongue = createFlameMesh(
      29 + index * 4.5,
      3.4 + (index % 2) * 1.2,
      tongueColors[index],
      0.07 + index * 0.018,
    );
    tongue.userData.phase = Math.random() * Math.PI * 2;
    tongue.userData.offset = (index - 1.5) * 2.3;
    tongue.position.z = 0.12 + index * 0.01;
    flameTongues.add(tongue);
  }

  const shockDiamonds = new THREE.Group();
  shockDiamonds.name = "thruster-diamonds";
  for (let index = 0; index < 4; index += 1) {
    const diamond = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2 - index * 0.45, 4.2 - index * 0.45),
      glowMaterial(index === 0 ? 0xffffff : coreColor, 0.11 - index * 0.012),
    );
    diamond.rotation.z = Math.PI / 4;
    diamond.position.set(-18 - index * 8.5, 0, 0.22);
    diamond.userData.phase = index * 1.4;
    shockDiamonds.add(diamond);
  }

  const sparks = new THREE.Group();
  sparks.name = "thruster-sparks";
  for (let index = 0; index < 20; index += 1) {
    const spark = new THREE.Mesh(
      createSparkleGeometry(0.55 + Math.random() * 0.8),
      glowMaterial(index % 5 === 0 ? 0xfff4c2 : 0xff8c42, 0.4),
    );
    spark.userData.phase = Math.random();
    spark.userData.speed = 0.75 + Math.random() * 0.8;
    spark.userData.lateral = (Math.random() - 0.5) * 10;
    spark.userData.drift = (Math.random() - 0.5) * 4;
    sparks.add(spark);
  }

  exhaust.add(
    plumeHaze,
    outerFlame,
    middleFlame,
    flameTongues,
    coreFlame,
    shockDiamonds,
    sparks,
  );
  exhaust.visible = false;
  return exhaust;
}

function createFlameMesh(
  length: number,
  halfWidth: number,
  color: number,
  opacity: number,
): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-10, 0);
  shape.bezierCurveTo(-14, halfWidth, -length * 0.72, halfWidth * 0.85, -length, 0);
  shape.bezierCurveTo(-length * 0.7, -halfWidth * 0.72, -14, -halfWidth, -10, 0);
  return new THREE.Mesh(new THREE.ShapeGeometry(shape), glowMaterial(color, opacity));
}

function updateThrusterVisual(
  visual: ShipVisual,
  active: boolean,
  boosting: boolean,
  time: number,
): void {
  const exhaust = visual.exhaust;
  exhaust.visible = active;
  if (!active) return;

  const phase = exhaust.userData.phase as number;
  const boostScale = boosting ? 1.68 : 1;
  const rapidFlicker = Math.sin(time * 29 + phase) * 0.11;
  const slowFlicker = Math.sin(time * 11.7 + phase * 1.7) * 0.13;
  const outer = exhaust.getObjectByName("thruster-outer");
  const middle = exhaust.getObjectByName("thruster-middle");
  const core = exhaust.getObjectByName("thruster-core");
  const haze = exhaust.getObjectByName("thruster-haze");
  if (outer) outer.scale.set(boostScale * (1 + rapidFlicker), 1 + slowFlicker, 1);
  if (middle) middle.scale.set(boostScale * (0.96 - slowFlicker * 0.35), 1 - rapidFlicker, 1);
  if (core) core.scale.set(boostScale * (1.04 + slowFlicker * 0.45), 1 + rapidFlicker * 0.5, 1);
  if (haze) {
    haze.scale.set(
      boostScale * (0.94 + Math.sin(time * 7.4 + phase) * 0.09),
      0.96 + Math.sin(time * 5.3 + phase) * 0.12,
      1,
    );
  }
  const tongues = exhaust.getObjectByName("thruster-tongues");
  if (tongues) {
    tongues.children.forEach((tongue, index) => {
      const wave = Math.sin(time * (15 + index * 2.7) + tongue.userData.phase);
      tongue.position.y = tongue.userData.offset + wave * 1.8;
      tongue.rotation.z = wave * 0.055;
      tongue.scale.set(
        boostScale * (0.86 + wave * 0.12 + index * 0.035),
        0.82 + Math.sin(time * 12.3 + index) * 0.18,
        1,
      );
    });
  }

  const diamonds = exhaust.getObjectByName("thruster-diamonds");
  if (diamonds) {
    diamonds.children.forEach((object, index) => {
      const diamond = object as THREE.Mesh;
      const flicker = 0.5 + Math.sin(time * 21 + diamond.userData.phase) * 0.5;
      diamond.position.x = -18 - index * (boosting ? 11 : 8.5);
      diamond.scale.setScalar(0.55 + flicker * 0.65);
      const material = diamond.material as THREE.MeshBasicMaterial;
      material.opacity = material.userData.baseOpacity * (0.35 + flicker * 0.65);
    });
  }

  const sparks = exhaust.getObjectByName("thruster-sparks");
  if (!sparks) return;
  sparks.children.forEach((object, index) => {
    const spark = object as THREE.Mesh;
    const travel = (time * spark.userData.speed + spark.userData.phase) % 1;
    const length = (boosting ? 76 : 48) * travel;
    const fade = Math.sin(travel * Math.PI);
    spark.position.set(
      -13 - length,
      spark.userData.lateral * travel + Math.sin(time * 9 + index) * 1.15 + spark.userData.drift,
      0.18,
    );
    spark.rotation.z = time * (index % 2 === 0 ? 2.5 : -2.5) + index;
    spark.scale.setScalar((0.28 + fade * 0.82) * (boosting ? 1.3 : 1));
    const material = spark.material as THREE.MeshBasicMaterial;
    material.opacity = material.userData.baseOpacity * fade * (boosting ? 0.92 : 0.62);
  });
}

function createBackground(): void {
  let seed = 83492791;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  for (let index = 0; index < 4; index += 1) {
    createStarLayer(
      275,
      0.055 + index * 0.01,
      -20 + index * 0.35,
      index % 2 === 0 ? 0x52677e : 0x60758a,
      0.72,
      1.15,
      random,
    );
  }
  for (let index = 0; index < 3; index += 1) {
    createStarLayer(
      175,
      0.16 + index * 0.018,
      -12 + index * 0.4,
      index === 1 ? 0x91a9bd : 0x7892aa,
      0.88,
      1.7,
      random,
    );
  }

  const grid = new THREE.GridHelper(worldWidth, 32, 0x162433, 0x101923);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -1;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.32;
  scene.add(grid);
}

function createStarLayer(
  count: number,
  parallax: number,
  depth: number,
  color: number,
  opacity: number,
  baseSize: number,
  random: () => number,
): void {
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (random() - 0.5) * worldWidth * 2.5;
    positions[index * 3 + 1] = (random() - 0.5) * worldHeight * 2.5;
    positions[index * 3 + 2] = 0;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color,
    size: baseSize,
    sizeAttenuation: false,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.position.z = depth;
  points.frustumCulled = false;
  scene.add(points);
  starLayers.push({
    points,
    material,
    parallax,
    timeOffset: random() * Math.PI * 2,
    twinkleSpeed: 0.45 + random() * 0.65,
    baseOpacity: opacity * (0.72 + random() * 0.28),
    baseSize: baseSize * (0.72 + random() * 0.55),
  });
}

function updateStarfield(): void {
  const time = performance.now() * 0.001;
  for (const layer of starLayers) {
    layer.points.position.x = camera.position.x * (1 - layer.parallax);
    layer.points.position.y = camera.position.y * (1 - layer.parallax);
    const shimmer = 0.88 + Math.sin(time * layer.twinkleSpeed + layer.timeOffset) * 0.12;
    layer.material.opacity = layer.baseOpacity * shimmer;
    layer.material.size = layer.baseSize * (0.97 + shimmer * 0.03);
  }
}

function createWalls(): void {
  wallGroup.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.LineSegments)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
  wallGroup.clear();
  const wallMaterial = new THREE.MeshBasicMaterial({ color: 0x17232e });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x426278 });
  for (const wall of walls) {
    const geometry = new THREE.PlaneGeometry(wall.width, wall.height);
    const mesh = new THREE.Mesh(geometry, wallMaterial);
    mesh.position.set(wall.x + wall.width / 2, wall.y + wall.height / 2, 0);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial));
    wallGroup.add(mesh);
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

function isTextEntryTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
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
