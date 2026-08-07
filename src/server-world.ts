import {
  DEFAULT_FLIGHT_CONFIG,
  circleIntersectsRect,
  circlesIntersect,
  createShip,
  fireBullet,
  resolveBulletAgainstRect,
  resolveCircleAgainstRect,
  speedOf,
  stepBullet,
  stepShip,
  type BulletState,
  type FlightInput,
  type FlightConfig,
  type Rect,
  type ShipState,
  type Vec2,
} from "./simulation";

export type ArenaMapId = "classic" | "crossroads" | "open";
export type PowerupType =
  | "shield"
  | "triple"
  | "missile"
  | "laser"
  | "phase"
  | "afterburner"
  | "gravity"
  | "reflector"
  | "fuel"
  | "overcharge";
export type WeaponType = "standard" | "missile" | "laser";
export type GameMode = "endless" | "top-score" | "timed";

export interface ServerGameSettings {
  map: ArenaMapId;
  powerups: PowerupType[];
  wormholes: boolean;
  gameMode: GameMode;
  scoreToWin: number;
  matchDurationSeconds: number;
}

export interface ServerInputMessage {
  q: number;
  m: number;
  f: boolean;
}

interface ServerPlayer {
  id: string;
  state: ShipState;
  input: FlightInput;
  firing: boolean;
  lastInputAt: number;
  lastSequence: number;
  shield: number;
  tripleTimer: number;
  missileTimer: number;
  laserTimer: number;
  phaseTimer: number;
  afterburnerTimer: number;
  reflectorTimer: number;
  weaponCooldown: number;
  respawnTimer: number;
  wormholeCooldown: number;
  transit: { destination: Vec2; remaining: number } | null;
  score: number;
  spectator: boolean;
}

interface ServerBullet {
  id: number;
  state: BulletState;
  weapon: WeaponType;
}

interface ServerPowerup {
  id: number;
  type: PowerupType;
  position: Vec2;
}

interface ServerGravityMine {
  id: number;
  owner: string;
  position: Vec2;
  timer: number;
}

interface ServerWormhole {
  id: number;
  color: number;
  first: Vec2;
  second: Vec2;
  age: number;
}

export interface ServerSnapshot {
  k: "s";
  sv: 1;
  tick: number;
  settings: [ArenaMapId, number, number, number, number, number];
  round: [number, number];
  ships: Array<[
    string, number, number, number, number, number, number, number,
    number, number, number, number, number, number, number, number,
    number, number, number, number,
  ]>;
  bullets: Array<[number, string, WeaponType, number, number, number, number, number]>;
  powerups: Array<[number, PowerupType, number, number]>;
  mines: Array<[number, string, number, number, number]>;
  wormholes: Array<[number, number, number, number, number, number, number]>;
  events: unknown[];
}

const config = DEFAULT_FLIGHT_CONFIG;
const afterburnerFlightConfig: FlightConfig = {
  ...config,
  thrust: config.thrust * 1.55,
  reverseThrust: config.reverseThrust * 1.3,
  maxSpeed: config.maxSpeed * 1.35,
  boostEnergyPerSecond: config.boostEnergyPerSecond * 0.7,
  energyRechargePerSecond: config.energyRechargePerSecond * 1.8,
};
const worldWidth = 1600;
const worldHeight = 1100;
const fixedStep = 1 / 120;
const shieldCapacity = 100;
const tripleDuration = 18;
const missileDuration = 7;
const laserDuration = 12;
const phaseDuration = 5;
const afterburnerDuration = 10;
const reflectorDuration = 8;
const gravityMineFuse = 3.2;
const gravityMinePullRadius = 190;
const gravityMineBlastRadius = 115;
const gravityMinePullAcceleration = 285;
const gravityMineDamage = 55;
const powerupRadius = 18;
const powerupSpawnMinimum = 10;
const powerupSpawnMaximum = 30;
const maxPowerups = 4;
const maxBullets = 64;
const roundIntermissionDuration = 15;
const wormholeRadius = 28;
const wormholeLifetime = 20;
const wormholeFadeIn = 1.25;
const wormholeFadeOut = 1.75;
const wormholeTransitDuration = 1.02;
const wormholeSpawnMinimum = 10;
const wormholeSpawnMaximum = 20;
const maxWormholePairs = 3;
const wormholeColors = [0x5ad9ff, 0xff7ad9, 0x9d7aff, 0x74f0b8, 0xffad66];

const arenaBoundary: Rect[] = [
  { x: -800, y: -550, width: 1600, height: 28 },
  { x: -800, y: 522, width: 1600, height: 28 },
  { x: -800, y: -550, width: 28, height: 1100 },
  { x: 772, y: -550, width: 28, height: 1100 },
];

export const serverArenaMaps: Record<ArenaMapId, Rect[]> = {
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

const defaultSettings: ServerGameSettings = {
  map: "classic",
  powerups: [
    "shield", "triple", "missile", "laser", "phase",
    "afterburner", "gravity", "reflector", "fuel", "overcharge",
  ],
  wormholes: true,
  gameMode: "endless",
  scoreToWin: 5,
  matchDurationSeconds: 180,
};

export class ServerWorld {
  readonly players = new Map<string, ServerPlayer>();
  readonly bullets: ServerBullet[] = [];
  readonly powerups = new Map<number, ServerPowerup>();
  readonly mines = new Map<number, ServerGravityMine>();
  readonly wormholes = new Map<number, ServerWormhole>();
  settings: ServerGameSettings = { ...defaultSettings, powerups: [...defaultSettings.powerups] };
  configured = false;
  tick = 0;
  private accumulator = 0;
  private bulletCounter = 0;
  private powerupCounter = 0;
  private mineCounter = 0;
  private wormholeCounter = 0;
  private powerupSpawnTimer = randomDelay(powerupSpawnMinimum, powerupSpawnMaximum);
  private wormholeSpawnTimer = randomDelay(wormholeSpawnMinimum, wormholeSpawnMaximum);
  private events: unknown[] = [];
  private now = 0;
  private roundEnded = false;
  private roundPhase: "countdown" | "playing" | "sudden-death" | "intermission" = "playing";
  private roundTimer = 0;

  startMatchCountdown(): void {
    this.roundPhase = "countdown";
    this.roundTimer = 3;
    this.bullets.length = 0;
    for (const player of this.players.values()) {
      player.input = emptyInput();
      player.firing = false;
    }
  }

  configure(value: unknown): boolean {
    if (this.configured || !isRecord(value) || !isArenaMapId(value.map)) return false;
    if (!Array.isArray(value.powerups)) return false;
    this.settings = {
      map: value.map,
      powerups: [...new Set(value.powerups.filter(isPowerupType))],
      wormholes: value.wormholes !== false,
      gameMode: isGameMode(value.gameMode) ? value.gameMode : "endless",
      scoreToWin: clamp(Number.isInteger(value.scoreToWin) ? value.scoreToWin as number : 5, 1, 100),
      matchDurationSeconds: clamp(
        Number.isFinite(value.matchDurationSeconds) ? Math.round(value.matchDurationSeconds as number) : 180,
        30,
        3600,
      ),
    };
    this.configured = true;
    this.bullets.length = 0;
    this.powerups.clear();
    this.mines.clear();
    this.wormholes.clear();
    for (const player of this.players.values()) this.respawn(player);
    return true;
  }

  addPlayer(id: string, now = Date.now()): boolean {
    if (this.players.has(id)) return true;
    if (this.players.size >= 8) return false;
    const state = createShip(config);
    const spawn = this.findSpawn();
    state.position = spawn.position;
    state.angle = spawn.angle;
    this.players.set(id, {
      id,
      state,
      input: emptyInput(),
      firing: false,
      lastInputAt: now,
      lastSequence: -1,
      shield: 0,
      tripleTimer: 0,
      missileTimer: 0,
      laserTimer: 0,
      phaseTimer: 0,
      afterburnerTimer: 0,
      reflectorTimer: 0,
      weaponCooldown: 0,
      respawnTimer: 0,
      wormholeCooldown: 0,
      transit: null,
      score: 0,
      spectator: this.roundPhase === "sudden-death" || this.roundPhase === "intermission" ||
        [...this.players.values()].some((player) => player.spectator),
    });
    this.events.push(["spawn", id, round(state.position.x), round(state.position.y)]);
    return true;
  }

  removePlayer(id: string): void {
    this.players.delete(id);
    for (let index = this.bullets.length - 1; index >= 0; index -= 1) {
      if (this.bullets[index].state.owner === id) this.bullets.splice(index, 1);
    }
    for (const [mineId, mine] of this.mines) {
      if (mine.owner === id) this.mines.delete(mineId);
    }
    if (this.roundPhase === "sudden-death") this.resolveSuddenDeathAfterDeparture();
  }

  setInput(id: string, message: ServerInputMessage, now = Date.now()): void {
    const player = this.players.get(id);
    if (!player || player.spectator || !Number.isInteger(message.q) || message.q <= player.lastSequence) return;
    if (!Number.isInteger(message.m) || message.m < 0 || message.m > 31) return;
    player.lastSequence = message.q;
    player.lastInputAt = now;
    player.input = {
      thrust: Boolean(message.m & 1),
      reverse: Boolean(message.m & 2),
      turnLeft: Boolean(message.m & 4),
      turnRight: Boolean(message.m & 8),
      boost: Boolean(message.m & 16),
    };
    player.firing = message.f === true;
  }

  step(deltaSeconds: number, now = Date.now()): void {
    this.now = now;
    this.accumulator += Math.min(0.1, Math.max(0, deltaSeconds));
    let substeps = 0;
    while (this.accumulator >= fixedStep && substeps < 12) {
      this.stepFixed();
      this.accumulator -= fixedStep;
      substeps += 1;
    }
    if (substeps === 12) this.accumulator = 0;
    this.tick += 1;
  }

  takeSnapshot(): ServerSnapshot {
    const powerupMask = this.settings.powerups.reduce(
      (mask, type) => mask | (1 << powerupTypes.indexOf(type)),
      0,
    );
    const snapshot: ServerSnapshot = {
      k: "s",
      sv: 1,
      tick: this.tick,
      settings: [
        this.settings.map,
        powerupMask,
        Number(this.settings.wormholes),
        this.settings.gameMode === "top-score" ? 1 : this.settings.gameMode === "timed" ? 2 : 0,
        this.settings.scoreToWin,
        this.settings.matchDurationSeconds,
      ],
      round: [
        this.roundPhase === "playing"
          ? 0
          : this.roundPhase === "countdown" ? 1 : this.roundPhase === "intermission" ? 2 : 3,
        round(this.roundTimer),
      ],
      ships: [...this.players.values()].map((player) => [
        player.id,
        round(player.state.position.x), round(player.state.position.y),
        round(player.state.velocity.x), round(player.state.velocity.y),
        round(player.state.angle), round(player.state.energy), round(player.shield),
        round(player.tripleTimer), round(player.missileTimer), round(player.laserTimer),
        round(player.phaseTimer), round(player.afterburnerTimer), round(player.reflectorTimer),
        round(player.respawnTimer), round(player.transit?.remaining ?? 0),
        player.lastSequence, inputMask(player.input), player.score, Number(player.spectator),
      ]),
      bullets: this.bullets.map((bullet) => [
        bullet.id, bullet.state.owner, bullet.weapon,
        round(bullet.state.position.x), round(bullet.state.position.y),
        round(bullet.state.velocity.x), round(bullet.state.velocity.y),
        round(bullet.state.lifetime),
      ]),
      powerups: [...this.powerups.values()].map((powerup) => [
        powerup.id, powerup.type, round(powerup.position.x), round(powerup.position.y),
      ]),
      mines: [...this.mines.values()].map((mine) => [
        mine.id, mine.owner, round(mine.position.x), round(mine.position.y), round(mine.timer),
      ]),
      wormholes: [...this.wormholes.values()].map((pair) => [
        pair.id, pair.color,
        round(pair.first.x), round(pair.first.y),
        round(pair.second.x), round(pair.second.y), round(pair.age),
      ]),
      events: this.events,
    };
    this.events = [];
    return snapshot;
  }

  private stepFixed(): void {
    this.roundEnded = false;
    if (this.roundPhase === "countdown" || this.roundPhase === "intermission") {
      this.roundTimer = Math.max(0, this.roundTimer - fixedStep);
      if (this.roundPhase === "intermission" && this.roundTimer <= 3) {
        this.roundPhase = "countdown";
        this.roundTimer = 3;
        this.events.push(["countdown", 3]);
      } else if (this.roundPhase === "countdown" && this.roundTimer === 0) {
        this.resetRound();
        this.roundPhase = "playing";
        this.events.push(["round-start"]);
      }
      return;
    }
    if (this.roundPhase === "playing" && this.settings.gameMode === "timed") {
      this.roundTimer = Math.max(0, this.roundTimer - fixedStep);
      if (this.roundTimer === 0) {
        this.finishTimedRegulation();
        return;
      }
    }
    for (const player of this.players.values()) this.stepPlayer(player);
    this.stepBullets();
    this.stepPowerups();
    this.stepGravityMines();
    this.stepWormholes();
  }

  private stepPlayer(player: ServerPlayer): void {
    if (player.spectator) return;
    if (this.now - player.lastInputAt > 700) {
      player.input = emptyInput();
      player.firing = false;
    }
    if (player.respawnTimer > 0) {
      player.respawnTimer = Math.max(0, player.respawnTimer - fixedStep);
      if (player.respawnTimer === 0) this.respawn(player);
      return;
    }
    if (player.transit) {
      player.transit.remaining = Math.max(0, player.transit.remaining - fixedStep);
      if (player.transit.remaining === 0) {
        this.teleport(player.state, player.transit.destination);
        player.transit = null;
        player.wormholeCooldown = 0.4;
        this.events.push(["wormhole-exit", player.id]);
      }
      return;
    }

    const flightConfig = player.afterburnerTimer > 0 ? afterburnerFlightConfig : config;
    stepShip(player.state, player.input, flightConfig, fixedStep);
    for (const [wallIndex, wall] of serverArenaMaps[this.settings.map].entries()) {
      if (player.phaseTimer > 0 && wallIndex >= arenaBoundary.length) continue;
      resolveCircleAgainstRect(player.state, wall, config.shipRadius, config.wallRestitution);
    }
    player.weaponCooldown = Math.max(0, player.weaponCooldown - fixedStep);
    player.tripleTimer = Math.max(0, player.tripleTimer - fixedStep);
    player.missileTimer = Math.max(0, player.missileTimer - fixedStep);
    player.laserTimer = Math.max(0, player.laserTimer - fixedStep);
    player.phaseTimer = Math.max(0, player.phaseTimer - fixedStep);
    player.afterburnerTimer = Math.max(0, player.afterburnerTimer - fixedStep);
    player.reflectorTimer = Math.max(0, player.reflectorTimer - fixedStep);
    player.wormholeCooldown = Math.max(0, player.wormholeCooldown - fixedStep);
    if (player.firing && player.weaponCooldown === 0) this.fire(player);
  }

  private fire(player: ServerPlayer): void {
    const weapon: WeaponType = player.laserTimer > 0
      ? "laser"
      : player.missileTimer > 0 ? "missile" : "standard";
    const offsets = player.tripleTimer > 0 ? [-0.18, 0, 0.18] : [0];
    const cost = config.bulletEnergyCost * offsets.length;
    if (player.state.energy < cost) return;
    if (weapon !== "laser" && this.bullets.length + offsets.length > maxBullets) return;
    if (weapon === "laser") {
      player.state.energy -= cost;
      for (const offset of offsets) {
        this.fireLaser(player, offset);
        if (this.roundEnded) break;
      }
    } else {
      for (const offset of offsets) {
        const bullet = fireBullet(player.state, config, player.id, offset);
        if (!bullet) break;
        if (weapon === "missile") {
          const angle = player.state.angle + offset;
          bullet.velocity.x = player.state.velocity.x + Math.cos(angle) * config.bulletSpeed * 0.72;
          bullet.velocity.y = player.state.velocity.y + Math.sin(angle) * config.bulletSpeed * 0.72;
          bullet.lifetime *= 1.65;
        }
        this.bulletCounter += 1;
        this.bullets.push({ id: this.bulletCounter, state: bullet, weapon });
      }
    }
    player.weaponCooldown = weapon === "laser"
      ? config.bulletCooldown * 0.58
      : weapon === "missile" ? config.bulletCooldown * 1.45 : config.bulletCooldown;
    this.events.push(["fire", player.id, weapon, offsets.length]);
  }

  private fireLaser(player: ServerPlayer, offset: number): void {
    const angle = player.state.angle + offset;
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    const start = {
      x: player.state.position.x + direction.x * (config.shipRadius + 6),
      y: player.state.position.y + direction.y * (config.shipRadius + 6),
    };
    const end = this.traceRay(start, direction);
    const target = this.firstPlayerOnSegment(player.id, start, end);
    if (target?.reflectorTimer && target.reflectorTimer > 0) {
      this.events.push(["reflect", target.id]);
    } else if (target) {
      this.damage(target, config.bulletDamage * 1.6, player.id);
    }
    this.events.push(["laser", player.id, round(start.x), round(start.y), round(end.x), round(end.y)]);
  }

  private stepBullets(): void {
    for (let index = this.bullets.length - 1; index >= 0; index -= 1) {
      const bullet = this.bullets[index];
      if (bullet.weapon === "missile") this.steerMissile(bullet);
      stepBullet(bullet.state, fixedStep);
      const radius = bullet.weapon === "missile" ? 4 : 2.7;
      for (const wall of serverArenaMaps[this.settings.map]) {
        resolveBulletAgainstRect(bullet.state, wall, radius, config.wallRestitution);
      }
      const hit = [...this.players.values()].find((player) =>
        player.id !== bullet.state.owner && !player.spectator &&
        player.respawnTimer === 0 && !player.transit &&
        player.phaseTimer <= 0 &&
        circlesIntersect(bullet.state.position, radius, player.state.position, config.shipRadius),
      );
      if (hit?.reflectorTimer && hit.reflectorTimer > 0) {
        this.reflectBullet(bullet, hit);
      } else if (hit) {
        this.damage(
          hit,
          bullet.weapon === "missile" ? config.bulletDamage * 1.3 : config.bulletDamage,
          bullet.state.owner,
        );
      }
      if (this.roundEnded) return;
      if ((hit && hit.reflectorTimer <= 0) || bullet.state.lifetime <= 0) this.bullets.splice(index, 1);
    }
  }

  private steerMissile(bullet: ServerBullet): void {
    let target: ServerPlayer | null = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const player of this.players.values()) {
      if (
        player.id === bullet.state.owner || player.spectator ||
        player.respawnTimer > 0 || player.transit ||
        player.phaseTimer > 0
      ) continue;
      const next = distanceSquared(bullet.state.position, player.state.position);
      if (next < distance) {
        distance = next;
        target = player;
      }
    }
    if (!target) return;
    const speed = Math.hypot(bullet.state.velocity.x, bullet.state.velocity.y);
    const current = Math.atan2(bullet.state.velocity.y, bullet.state.velocity.x);
    const desired = Math.atan2(
      target.state.position.y - bullet.state.position.y,
      target.state.position.x - bullet.state.position.x,
    );
    const turn = clamp(normalizeAngle(desired - current), -3.4 * fixedStep, 3.4 * fixedStep);
    bullet.state.velocity.x = Math.cos(current + turn) * speed;
    bullet.state.velocity.y = Math.sin(current + turn) * speed;
  }

  private damage(player: ServerPlayer, damage: number, attackerId: string): void {
    if (player.spectator || player.phaseTimer > 0) return;
    const absorbed = Math.min(player.shield, damage);
    player.shield -= absorbed;
    player.state.energy = Math.max(0, player.state.energy - (damage - absorbed));
    this.events.push(["hit", player.id, round(damage), Number(absorbed > 0)]);
    if (player.state.energy > 0) return;
    player.respawnTimer = 1.25;
    player.input = emptyInput();
    player.firing = false;
    player.transit = null;
    player.shield = 0;
    player.tripleTimer = 0;
    player.missileTimer = 0;
    player.laserTimer = 0;
    player.phaseTimer = 0;
    player.afterburnerTimer = 0;
    player.reflectorTimer = 0;
    player.score -= 1;
    const attacker = this.players.get(attackerId);
    if (attacker && attacker.id !== player.id) attacker.score += 1;
    this.events.push([
      "death",
      player.id,
      round(player.state.position.x),
      round(player.state.position.y),
      attackerId,
    ]);
    if (
      attacker && this.settings.gameMode === "top-score" &&
      attacker.score >= this.settings.scoreToWin
    ) {
      this.events.push(["win", attacker.id]);
      this.beginRoundIntermission();
    } else if (
      attacker && attacker.id !== player.id && !attacker.spectator &&
      this.roundPhase === "sudden-death"
    ) {
      this.events.push(["win", attacker.id]);
      this.beginRoundIntermission();
    }
  }

  private finishTimedRegulation(): void {
    const competitors = [...this.players.values()].filter((player) => !player.spectator);
    if (competitors.length === 0) {
      this.roundTimer = this.settings.matchDurationSeconds;
      return;
    }
    const highScore = Math.max(...competitors.map((player) => player.score));
    const leaders = competitors.filter((player) => player.score === highScore);
    if (leaders.length === 1) {
      this.events.push(["win", leaders[0].id]);
      this.beginRoundIntermission();
      return;
    }
    this.beginSuddenDeath(leaders.map((player) => player.id));
  }

  private beginSuddenDeath(contenderIds: string[]): void {
    const contenders = new Set(contenderIds);
    this.roundEnded = true;
    this.roundPhase = "sudden-death";
    this.roundTimer = 0;
    this.bullets.length = 0;
    this.powerups.clear();
    this.mines.clear();
    this.wormholes.clear();
    for (const player of this.players.values()) {
      player.input = emptyInput();
      player.firing = false;
      player.transit = null;
      player.spectator = !contenders.has(player.id);
      if (!player.spectator) {
        player.respawnTimer = 0;
        this.respawn(player);
      }
    }
    this.events.push(["sudden-death", ...contenderIds]);
  }

  private resolveSuddenDeathAfterDeparture(): void {
    const contenders = [...this.players.values()].filter((player) => !player.spectator);
    if (contenders.length === 1) {
      this.events.push(["win", contenders[0].id]);
      this.beginRoundIntermission();
      return;
    }
    if (contenders.length > 1 || this.players.size === 0) return;
    const remaining = [...this.players.values()];
    const highScore = Math.max(...remaining.map((player) => player.score));
    const leaders = remaining.filter((player) => player.score === highScore);
    if (leaders.length === 1) {
      leaders[0].spectator = false;
      this.events.push(["win", leaders[0].id]);
      this.beginRoundIntermission();
    } else {
      this.beginSuddenDeath(leaders.map((player) => player.id));
    }
  }

  private beginRoundIntermission(): void {
    this.roundEnded = true;
    this.roundPhase = "intermission";
    this.roundTimer = roundIntermissionDuration;
    this.bullets.length = 0;
    this.mines.clear();
    for (const player of this.players.values()) {
      player.input = emptyInput();
      player.firing = false;
    }
  }

  private resetRound(): void {
    this.roundEnded = true;
    this.bullets.length = 0;
    this.powerups.clear();
    this.mines.clear();
    this.wormholes.clear();
    for (const player of this.players.values()) {
      player.score = 0;
      player.shield = 0;
      player.tripleTimer = 0;
      player.missileTimer = 0;
      player.laserTimer = 0;
      player.phaseTimer = 0;
      player.afterburnerTimer = 0;
      player.reflectorTimer = 0;
      player.respawnTimer = 0;
      player.transit = null;
      player.spectator = false;
      this.respawn(player);
    }
    this.roundTimer = this.settings.gameMode === "timed"
      ? this.settings.matchDurationSeconds
      : 0;
  }

  private respawn(player: ServerPlayer): void {
    const spawn = this.findSpawn();
    player.state = createShip(config);
    player.state.position = spawn.position;
    player.state.angle = spawn.angle;
    player.shield = 0;
    player.tripleTimer = 0;
    player.missileTimer = 0;
    player.laserTimer = 0;
    player.phaseTimer = 0;
    player.afterburnerTimer = 0;
    player.reflectorTimer = 0;
    player.weaponCooldown = 0;
    player.wormholeCooldown = 0;
    this.events.push(["spawn", player.id, round(spawn.position.x), round(spawn.position.y)]);
  }

  private stepPowerups(): void {
    if (this.settings.powerups.length > 0) {
      this.powerupSpawnTimer -= fixedStep;
      if (this.powerupSpawnTimer <= 0) {
        if (this.powerups.size < maxPowerups) this.spawnPowerup();
        this.powerupSpawnTimer = randomDelay(powerupSpawnMinimum, powerupSpawnMaximum);
      }
    }
    for (const player of this.players.values()) {
      if (player.spectator || player.respawnTimer > 0 || player.transit) continue;
      for (const powerup of this.powerups.values()) {
        if (!circlesIntersect(player.state.position, config.shipRadius, powerup.position, powerupRadius)) continue;
        this.applyPowerup(player, powerup.type);
        this.powerups.delete(powerup.id);
        this.events.push(["pickup", player.id, powerup.id, powerup.type]);
        break;
      }
    }
  }

  private spawnPowerup(): void {
    const position = this.findOpenPosition(20, 75);
    if (!position) return;
    this.powerupCounter += 1;
    const type = this.settings.powerups[Math.floor(Math.random() * this.settings.powerups.length)];
    this.powerups.set(this.powerupCounter, { id: this.powerupCounter, type, position });
  }

  private applyPowerup(player: ServerPlayer, type: PowerupType): void {
    if (type === "shield") player.shield = shieldCapacity;
    if (type === "triple") player.tripleTimer = tripleDuration;
    if (type === "missile") {
      player.missileTimer = missileDuration;
      player.laserTimer = 0;
    }
    if (type === "laser") {
      player.laserTimer = laserDuration;
      player.missileTimer = 0;
    }
    if (type === "phase") player.phaseTimer = phaseDuration;
    if (type === "afterburner") player.afterburnerTimer = afterburnerDuration;
    if (type === "reflector") player.reflectorTimer = reflectorDuration;
    if (type === "gravity") this.deployGravityMine(player);
    if (type === "fuel") player.state.energy = config.maxEnergy;
    if (type === "overcharge") player.state.energy = config.maxEnergy * 2;
  }

  private deployGravityMine(player: ServerPlayer): void {
    this.mineCounter += 1;
    this.mines.set(this.mineCounter, {
      id: this.mineCounter,
      owner: player.id,
      position: { ...player.state.position },
      timer: gravityMineFuse,
    });
    this.events.push([
      "mine-deploy",
      player.id,
      this.mineCounter,
      round(player.state.position.x),
      round(player.state.position.y),
    ]);
  }

  private stepGravityMines(): void {
    for (const [id, mine] of this.mines) {
      mine.timer = Math.max(0, mine.timer - fixedStep);
      for (const player of this.players.values()) {
        if (
          player.id === mine.owner || player.spectator ||
          player.respawnTimer > 0 || player.transit ||
          player.phaseTimer > 0
        ) continue;
        const offsetX = mine.position.x - player.state.position.x;
        const offsetY = mine.position.y - player.state.position.y;
        const distance = Math.hypot(offsetX, offsetY);
        if (distance <= 0 || distance >= gravityMinePullRadius) continue;
        const acceleration = gravityMinePullAcceleration * (1 - distance / gravityMinePullRadius);
        player.state.velocity.x += (offsetX / distance) * acceleration * fixedStep;
        player.state.velocity.y += (offsetY / distance) * acceleration * fixedStep;
      }
      if (mine.timer > 0) continue;
      this.events.push(["mine-explode", mine.owner, round(mine.position.x), round(mine.position.y)]);
      for (const player of this.players.values()) {
        if (
          player.id === mine.owner || player.spectator ||
          player.respawnTimer > 0 || player.transit ||
          player.phaseTimer > 0
        ) continue;
        const distance = Math.sqrt(distanceSquared(mine.position, player.state.position));
        if (distance >= gravityMineBlastRadius) continue;
        this.damage(
          player,
          gravityMineDamage * (1 - distance / gravityMineBlastRadius * 0.45),
          mine.owner,
        );
        if (this.roundEnded) break;
      }
      this.mines.delete(id);
      if (this.roundEnded) return;
    }
  }

  private reflectBullet(bullet: ServerBullet, player: ServerPlayer): void {
    const speed = Math.max(1, Math.hypot(bullet.state.velocity.x, bullet.state.velocity.y));
    let offsetX = bullet.state.position.x - player.state.position.x;
    let offsetY = bullet.state.position.y - player.state.position.y;
    const offsetLength = Math.hypot(offsetX, offsetY);
    if (offsetLength < 0.01) {
      offsetX = -bullet.state.velocity.x / speed;
      offsetY = -bullet.state.velocity.y / speed;
    } else {
      offsetX /= offsetLength;
      offsetY /= offsetLength;
    }
    bullet.state.position.x = player.state.position.x + offsetX * (config.shipRadius + 6);
    bullet.state.position.y = player.state.position.y + offsetY * (config.shipRadius + 6);
    bullet.state.velocity.x = offsetX * speed;
    bullet.state.velocity.y = offsetY * speed;
    bullet.state.owner = player.id;
    this.events.push(["reflect", player.id]);
  }

  private stepWormholes(): void {
    if (!this.settings.wormholes) return;
    this.wormholeSpawnTimer -= fixedStep;
    if (this.wormholeSpawnTimer <= 0) {
      if (this.wormholes.size < maxWormholePairs) this.spawnWormhole();
      this.wormholeSpawnTimer = randomDelay(wormholeSpawnMinimum, wormholeSpawnMaximum);
    }
    for (const [id, pair] of this.wormholes) {
      pair.age += fixedStep;
      if (pair.age >= wormholeLifetime) this.wormholes.delete(id);
    }
    for (const player of this.players.values()) {
      if (
        player.spectator || player.respawnTimer > 0 || player.transit ||
        player.wormholeCooldown > 0
      ) continue;
      for (const pair of this.wormholes.values()) {
        if (pair.age < wormholeFadeIn || pair.age > wormholeLifetime - wormholeFadeOut) continue;
        const collisionDistance = (wormholeRadius + config.shipRadius) ** 2;
        const first = distanceSquared(player.state.position, pair.first) <= collisionDistance;
        const second = distanceSquared(player.state.position, pair.second) <= collisionDistance;
        if (!first && !second) continue;
        player.transit = {
          destination: { ...(first ? pair.second : pair.first) },
          remaining: wormholeTransitDuration,
        };
        this.events.push(["wormhole-enter", player.id, pair.id, first ? 0 : 1]);
        break;
      }
    }
  }

  private spawnWormhole(): void {
    const first = this.findOpenPosition(wormholeRadius + config.shipRadius * 2 + 8, 90);
    if (!first) return;
    let second: Vec2 | null = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = this.findOpenPosition(wormholeRadius + config.shipRadius * 2 + 8, 90);
      if (candidate && distanceSquared(first, candidate) >= 320 ** 2) {
        second = candidate;
        break;
      }
    }
    if (!second) return;
    this.wormholeCounter += 1;
    const color = wormholeColors[(this.wormholeCounter - 1) % wormholeColors.length];
    this.wormholes.set(this.wormholeCounter, {
      id: this.wormholeCounter,
      color,
      first,
      second,
      age: 0,
    });
  }

  private teleport(state: ShipState, destination: Vec2): void {
    const speed = speedOf(state);
    const direction = speed > 1
      ? { x: state.velocity.x / speed, y: state.velocity.y / speed }
      : { x: Math.cos(state.angle), y: Math.sin(state.angle) };
    const exitDistance = wormholeRadius + config.shipRadius + 8;
    state.position.x = destination.x + direction.x * exitDistance;
    state.position.y = destination.y + direction.y * exitDistance;
  }

  private traceRay(start: Vec2, direction: Vec2): Vec2 {
    let distance = 2200;
    for (const wall of serverArenaMaps[this.settings.map]) {
      const hit = rayRectDistance(start, direction, wall);
      if (hit !== null && hit < distance) distance = Math.max(0, hit - 1);
    }
    return { x: start.x + direction.x * distance, y: start.y + direction.y * distance };
  }

  private firstPlayerOnSegment(owner: string, start: Vec2, end: Vec2): ServerPlayer | null {
    let closest: ServerPlayer | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const player of this.players.values()) {
      if (
        player.id === owner || player.spectator || player.respawnTimer > 0 ||
        player.transit || player.phaseTimer > 0
      ) continue;
      const distance = segmentCircleHitDistance(start, end, player.state.position, config.shipRadius);
      if (distance !== null && distance < closestDistance) {
        closest = player;
        closestDistance = distance;
      }
    }
    return closest;
  }

  private findSpawn(): { position: Vec2; angle: number } {
    const position = this.findOpenPosition(config.shipRadius + 8, config.shipRadius * 4) ?? { x: 0, y: 0 };
    return { position, angle: Math.random() * Math.PI * 2 };
  }

  private findOpenPosition(radius: number, separation: number): Vec2 | null {
    const minX = -worldWidth / 2 + radius;
    const maxX = worldWidth / 2 - radius;
    const minY = -worldHeight / 2 + radius;
    const maxY = worldHeight / 2 - radius;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const position = {
        x: minX + Math.random() * (maxX - minX),
        y: minY + Math.random() * (maxY - minY),
      };
      if (serverArenaMaps[this.settings.map].some((wall) => circleIntersectsRect(position, radius, wall))) continue;
      if ([...this.players.values()].some((player) =>
        !player.spectator && player.respawnTimer === 0 &&
        distanceSquared(position, player.state.position) < separation ** 2,
      )) continue;
      if ([...this.powerups.values()].some((powerup) =>
        distanceSquared(position, powerup.position) < separation ** 2,
      )) continue;
      if ([...this.mines.values()].some((mine) =>
        distanceSquared(position, mine.position) <
          Math.max(separation, gravityMineBlastRadius + radius) ** 2,
      )) continue;
      return position;
    }
    return null;
  }
}

function emptyInput(): FlightInput {
  return { thrust: false, reverse: false, turnLeft: false, turnRight: false, boost: false };
}

function inputMask(input: FlightInput): number {
  return Number(input.thrust) |
    (Number(input.reverse) << 1) |
    (Number(input.turnLeft) << 2) |
    (Number(input.turnRight) << 3) |
    (Number(input.boost) << 4);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isArenaMapId(value: unknown): value is ArenaMapId {
  return value === "classic" || value === "crossroads" || value === "open";
}

function isGameMode(value: unknown): value is GameMode {
  return value === "endless" || value === "top-score" || value === "timed";
}

function isPowerupType(value: unknown): value is PowerupType {
  return powerupTypes.includes(value as PowerupType);
}

const powerupTypes: PowerupType[] = [
  "shield", "triple", "missile", "laser", "phase", "afterburner", "gravity", "reflector",
  "fuel", "overcharge",
];

function randomDelay(minimum: number, maximum: number): number {
  return minimum + Math.random() * (maximum - minimum);
}

function distanceSquared(first: Vec2, second: Vec2): number {
  const x = first.x - second.x;
  const y = first.y - second.y;
  return x * x + y * y;
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
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

function segmentCircleHitDistance(start: Vec2, end: Vec2, center: Vec2, radius: number): number | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return null;
  const progress = clamp(
    ((center.x - start.x) * dx + (center.y - start.y) * dy) / lengthSquared,
    0,
    1,
  );
  const offsetX = center.x - (start.x + dx * progress);
  const offsetY = center.y - (start.y + dy * progress);
  if (offsetX * offsetX + offsetY * offsetY > radius * radius) return null;
  return Math.sqrt(lengthSquared) * progress;
}
