import {
  ServerWorld,
  type ServerGameSettings,
  type ServerInputMessage,
} from "./server-world";

interface ServerPlayerIdentity {
  id: string;
  playerId: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface PortalsServerRuntime {
  on(
    event: "playerjoin" | "playerleave",
    handler: (player: ServerPlayerIdentity, players: ServerPlayerIdentity[]) => void,
  ): void;
  on(event: "message", handler: (data: unknown, fromId: string) => void): void;
  send(data: unknown): void;
  setState(key: string, value: unknown): void;
  getState(key?: string): unknown;
  players(): ServerPlayerIdentity[];
  kick(id: string): void;
  setInterval(callback: () => void, milliseconds: number): number;
  log(...values: unknown[]): void;
}

interface MatchRoom {
  code: string;
  streamId: string;
  ownerId: string;
  world: ServerWorld;
  isPublic: boolean;
  allowJoinInProgress: boolean;
  active: boolean;
  createdAt: number;
}

declare const server: PortalsServerRuntime;

const rooms = new Map<string, MatchRoom>();
const playerRooms = new Map<string, string>();
let previousTime = Date.now();
let directoryAccumulator = 0;
let snapshotCursor = 0;
const maxRooms = 6;
const snapshotsPerTick = 2;

server.setState("server:ready", {
  protocol: 2,
  tickRate: 20,
  authority: "server",
  directory: true,
});
publishDirectory();

server.on("playerleave", (player) => leaveRoom(player.id));
server.on("message", (data, fromId) => {
  if (!isRecord(data)) return;
  if (data.k === "create-room") {
    createRoom(fromId, data);
    return;
  }
  if (data.k === "join-room" && typeof data.room === "string") {
    joinRoom(fromId, data.room);
    return;
  }
  if (data.k === "matchmake") {
    matchmake(fromId);
    return;
  }
  if (data.k === "leave-room") {
    leaveRoom(fromId);
    return;
  }
  if (data.k === "i" && isInputMessage(data)) {
    roomForPlayer(fromId)?.world.setInput(fromId, { q: data.q, m: data.m, f: data.f });
  }
});

server.setInterval(() => {
  const now = Date.now();
  const deltaSeconds = Math.min(0.1, Math.max(0, (now - previousTime) / 1000));
  previousTime = now;
  const activeRooms = [...rooms.values()];
  for (const room of activeRooms) room.world.step(deltaSeconds, now);
  const snapshotCount = Math.min(snapshotsPerTick, activeRooms.length);
  for (let index = 0; index < snapshotCount; index += 1) {
    const room = activeRooms[(snapshotCursor + index) % activeRooms.length];
    server.send({ ...room.world.takeSnapshot(), r: room.streamId });
  }
  if (activeRooms.length > 0) snapshotCursor = (snapshotCursor + snapshotCount) % activeRooms.length;
  directoryAccumulator += deltaSeconds;
  if (directoryAccumulator >= 1) {
    directoryAccumulator %= 1;
    publishDirectory();
  }
}, 50);

function createRoom(fromId: string, data: Record<string, unknown>): void {
  const code = normalizeRoomCode(data.room);
  if (!code) return sendError(fromId, "INVALID ROOM CODE");
  if (rooms.has(code)) return sendError(fromId, "ROOM CODE ALREADY EXISTS");
  if (rooms.size >= maxRooms) return sendError(fromId, "GLOBAL ROOM LIMIT REACHED");
  const settings = readSettings(data.settings);
  if (!settings) return sendError(fromId, "INVALID GAME SETTINGS");

  leaveRoom(fromId, false);
  const world = new ServerWorld();
  world.configure(settings);
  world.addPlayer(fromId);
  const room: MatchRoom = {
    code,
    streamId: generateStreamId(),
    ownerId: fromId,
    world,
    isPublic: data.public !== false,
    allowJoinInProgress: data.joinInProgress !== false,
    active: false,
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  playerRooms.set(fromId, code);
  acknowledgeJoin(fromId, room);
  publishDirectory();
}

function joinRoom(fromId: string, rawCode: string): void {
  const code = normalizeRoomCode(rawCode);
  const room = code ? rooms.get(code) : undefined;
  if (!room) return sendError(fromId, "ROOM NOT FOUND");
  if (room.world.players.size >= 8) return sendError(fromId, "ROOM IS FULL");
  if (room.active && !room.allowJoinInProgress) {
    return sendError(fromId, "MATCH IN PROGRESS — JOINING DISABLED");
  }
  leaveRoom(fromId, false);
  if (!room.world.addPlayer(fromId)) return sendError(fromId, "ROOM IS FULL");
  playerRooms.set(fromId, room.code);
  if (room.world.players.size >= 2) room.active = true;
  acknowledgeJoin(fromId, room);
  publishDirectory();
}

function matchmake(fromId: string): void {
  const candidates = [...rooms.values()]
    .filter((room) => room.isPublic && room.world.players.size < 8)
    .filter((room) => !room.active || room.allowJoinInProgress)
    .sort((first, second) => {
      if (first.active !== second.active) return Number(first.active) - Number(second.active);
      return second.world.players.size - first.world.players.size;
    });
  const candidate = candidates[0];
  if (candidate) {
    joinRoom(fromId, candidate.code);
    return;
  }
  createRoom(fromId, {
    room: generateRoomCode(),
    settings: {
      map: "classic",
      powerups: ["shield", "triple", "missile", "laser"],
      wormholes: true,
    },
    public: true,
    joinInProgress: true,
  });
}

function leaveRoom(playerId: string, publish = true): void {
  const code = playerRooms.get(playerId);
  if (!code) return;
  playerRooms.delete(playerId);
  const room = rooms.get(code);
  if (!room) return;
  room.world.removePlayer(playerId);
  if (room.world.players.size === 0) {
    rooms.delete(code);
  } else if (room.ownerId === playerId) {
    room.ownerId = room.world.players.keys().next().value ?? "";
  }
  if (publish) publishDirectory();
}

function acknowledgeJoin(playerId: string, room: MatchRoom): void {
  server.send({
    k: "room-joined",
    to: playerId,
    room: room.code,
    stream: room.streamId,
    settings: room.world.settings,
    public: room.isPublic,
    joinInProgress: room.allowJoinInProgress,
    active: room.active,
  });
}

function sendError(playerId: string, message: string): void {
  server.send({ k: "room-error", to: playerId, message });
}

function publishDirectory(): void {
  const directory = [...rooms.values()]
    .filter((room) => room.isPublic)
    .sort((first, second) => first.createdAt - second.createdAt)
    .slice(0, 32)
    .map((room) => [
      room.code,
      room.world.players.size,
      8,
      room.world.settings.map,
      Number(room.active),
      Number(room.allowJoinInProgress),
    ]);
  server.setState("server:rooms", directory);
}

function roomForPlayer(playerId: string): MatchRoom | undefined {
  const code = playerRooms.get(playerId);
  return code ? rooms.get(code) : undefined;
}

function readSettings(value: unknown): ServerGameSettings | null {
  if (!isRecord(value) || !isArenaMapId(value.map) || !Array.isArray(value.powerups)) return null;
  return {
    map: value.map,
    powerups: value.powerups.filter(isPowerupType),
    wormholes: value.wormholes !== false,
  };
}

function normalizeRoomCode(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 48)
    : "";
}

function generateRoomCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = "vf-";
    for (let index = 0; index < 5; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return `vf-${Date.now().toString(36).slice(-6)}`;
}

function generateStreamId(): string {
  return `match-${Date.now().toString(36)}-${Math.floor(Math.random() * 0x7fffffff).toString(36)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInputMessage(value: Record<string, unknown>): value is Record<string, unknown> & ServerInputMessage {
  return Number.isInteger(value.q) && Number.isInteger(value.m) && typeof value.f === "boolean";
}

function isArenaMapId(value: unknown): value is ServerGameSettings["map"] {
  return value === "classic" || value === "crossroads" || value === "open";
}

function isPowerupType(value: unknown): value is ServerGameSettings["powerups"][number] {
  return value === "shield" || value === "triple" || value === "missile" || value === "laser";
}
