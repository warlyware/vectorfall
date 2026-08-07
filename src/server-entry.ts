import { ServerWorld, type ServerInputMessage } from "./server-world";

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

declare const server: PortalsServerRuntime;

const world = new ServerWorld();
let previousTime = Date.now();
let checkpointAccumulator = 0;
let roomOwnerId: string | null = server.players()[0]?.id ?? null;

for (const player of server.players()) addPlayer(player.id);

server.setState("server:ready", { protocol: 1, tickRate: 20, authority: "server" });
server.setState("server:settings", world.settings);

server.on("playerjoin", (player) => {
  if (!roomOwnerId) roomOwnerId = player.id;
  addPlayer(player.id);
});
server.on("playerleave", (player, players) => {
  world.removePlayer(player.id);
  if (player.id === roomOwnerId && !world.configured) roomOwnerId = players[0]?.id ?? null;
});
server.on("message", (data, fromId) => {
  if (!isRecord(data)) return;
  if (data.k === "i" && isInputMessage(data)) {
    world.setInput(fromId, { q: data.q, m: data.m, f: data.f });
    return;
  }
  if (data.k === "config" && fromId === roomOwnerId && world.configure(data.settings)) {
    server.setState("server:settings", world.settings);
    server.log("configured match", world.settings);
  }
});

server.setInterval(() => {
  const now = Date.now();
  const deltaSeconds = Math.min(0.1, Math.max(0, (now - previousTime) / 1000));
  previousTime = now;
  world.step(deltaSeconds, now);
  const snapshot = world.takeSnapshot();
  server.send(snapshot);
  checkpointAccumulator += deltaSeconds;
  if (checkpointAccumulator >= 1) {
    checkpointAccumulator %= 1;
    server.setState("server:checkpoint", {
      tick: snapshot.tick,
      settings: snapshot.settings,
      ships: snapshot.ships,
    });
  }
}, 50);

function addPlayer(id: string): void {
  if (world.addPlayer(id)) return;
  server.kick(id);
  server.log("kicked player because match is full", id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInputMessage(value: Record<string, unknown>): value is Record<string, unknown> & ServerInputMessage {
  return Number.isInteger(value.q) && Number.isInteger(value.m) && typeof value.f === "boolean";
}
