import { describe, expect, it } from "vitest";
import { ServerWorld } from "../src/server-world";

function advance(world: ServerWorld, seconds: number, startAt = 0): void {
  const frames = Math.ceil(seconds * 10);
  for (let frame = 1; frame <= frames; frame += 1) {
    world.step(0.1, startAt + frame * 100);
  }
}

describe("authoritative server world", () => {
  it("accepts the first room configuration and publishes its compact settings", () => {
    const world = new ServerWorld();
    expect(world.configure({ map: "open", powerups: ["shield", "laser"], wormholes: false })).toBe(true);
    expect(world.configure({ map: "classic", powerups: [], wormholes: true })).toBe(false);

    const snapshot = world.takeSnapshot();
    expect(snapshot.settings).toEqual(["open", 0b1001, 0, 0, 5, 180]);
  });

  it("respawns existing pilots when the owner selects a different arena", () => {
    const world = new ServerWorld();
    world.addPlayer("pilot");
    world.takeSnapshot();
    world.configure({ map: "crossroads", powerups: [], wormholes: false });
    const snapshot = world.takeSnapshot();

    expect(snapshot.settings[0]).toBe("crossroads");
    expect(snapshot.events.some((event) => Array.isArray(event) && event[0] === "spawn")).toBe(true);
  });

  it("moves players from sequenced input and acknowledges the last input", () => {
    const world = new ServerWorld();
    world.configure({ map: "open", powerups: [], wormholes: false });
    world.addPlayer("pilot", 0);
    const before = world.takeSnapshot().ships[0];

    world.setInput("pilot", { q: 7, m: 17, f: false }, 0);
    for (let frame = 1; frame <= 10; frame += 1) world.step(0.05, frame * 50);
    const after = world.takeSnapshot().ships[0];

    expect(Math.hypot(after[1] - before[1], after[2] - before[2])).toBeGreaterThan(1);
    expect(after[16]).toBe(7);
    expect(after[17]).toBe(17);
  });

  it("ignores the retired reverse input bit", () => {
    const world = new ServerWorld();
    world.configure({ map: "open", powerups: [], wormholes: false });
    world.addPlayer("pilot", 0);
    const pilot = world.players.get("pilot")!;
    pilot.state.position = { x: 0, y: 0 };
    pilot.state.velocity = { x: 0, y: 0 };
    pilot.state.angle = 0;

    world.setInput("pilot", { q: 1, m: 2, f: false }, 0);
    world.step(0.1, 100);

    expect(pilot.state.velocity).toEqual({ x: 0, y: 0 });
    expect(world.takeSnapshot().ships[0][17]).toBe(0);
  });

  it("rejects stale input and caps a match at eight pilots", () => {
    const world = new ServerWorld();
    for (let index = 0; index < 8; index += 1) {
      expect(world.addPlayer(`pilot-${index}`)).toBe(true);
    }
    expect(world.addPlayer("pilot-8")).toBe(false);

    world.setInput("pilot-0", { q: 4, m: 8, f: false });
    world.setInput("pilot-0", { q: 3, m: 1, f: true });
    const pilot = world.takeSnapshot().ships.find((ship) => ship[0] === "pilot-0");
    expect(pilot?.[16]).toBe(4);
  });

  it("creates weapons on the server instead of trusting client projectiles", () => {
    const world = new ServerWorld();
    world.configure({ map: "open", powerups: [], wormholes: false });
    world.addPlayer("pilot", 0);
    world.takeSnapshot();
    world.setInput("pilot", { q: 1, m: 0, f: true }, 0);
    world.step(0.05, 50);

    const snapshot = world.takeSnapshot();
    expect(snapshot.bullets.length).toBeGreaterThan(0);
    expect(snapshot.events).toContainEqual(["fire", "pilot", "standard", 1]);
  });

  it("charges the standard per-shot energy cost for a laser", () => {
    const world = new ServerWorld();
    world.configure({ map: "open", powerups: [], wormholes: false });
    world.addPlayer("laser-pilot", 0);
    world.takeSnapshot();
    const pilot = world.players.get("laser-pilot")!;
    pilot.laserTimer = 1;
    pilot.state.energy = 100;
    world.setInput("laser-pilot", { q: 1, m: 0, f: true }, 0);
    world.step(0.009, 9);

    expect(world.takeSnapshot().ships[0][6]).toBe(95);
  });

  it("protects newly spawned pilots from damage for one second", () => {
    const world = new ServerWorld();
    world.configure({ map: "open", powerups: [], wormholes: false });
    world.addPlayer("attacker", 0);
    world.addPlayer("protected", 0);
    world.takeSnapshot();
    const attacker = world.players.get("attacker")!;
    const protectedPilot = world.players.get("protected")!;
    attacker.state.position = { x: 0, y: 0 };
    attacker.state.velocity = { x: 0, y: 0 };
    attacker.state.angle = 0;
    protectedPilot.state.position = { x: 36, y: 0 };
    protectedPilot.state.velocity = { x: 0, y: 0 };
    protectedPilot.state.energy = 1;

    world.setInput("attacker", { q: 1, m: 0, f: true }, 0);
    world.step(0.1, 100);
    expect(protectedPilot.state.energy).toBeGreaterThan(1);
    expect(protectedPilot.respawnTimer).toBe(0);
    expect(world.takeSnapshot().ships.find((ship) => ship[0] === "protected")?.[20]).toBeGreaterThan(0.8);

    world.setInput("attacker", { q: 2, m: 0, f: false }, 100);
    advance(world, 1.1, 100);
    attacker.state.position = { x: 0, y: 0 };
    attacker.state.velocity = { x: 0, y: 0 };
    attacker.state.angle = 0;
    protectedPilot.state.position = { x: 36, y: 0 };
    protectedPilot.state.velocity = { x: 0, y: 0 };
    protectedPilot.state.energy = 1;
    world.setInput("attacker", { q: 3, m: 0, f: true }, 1_200);
    world.step(0.1, 1_300);

    expect(protectedPilot.respawnTimer).toBeGreaterThan(0);
  });

  it("keeps phase-shifted pilots intangible to projectiles", () => {
    const world = new ServerWorld();
    world.configure({ map: "open", powerups: [], wormholes: false });
    world.addPlayer("attacker", 0);
    world.addPlayer("phased", 0);
    world.takeSnapshot();
    const attacker = world.players.get("attacker")!;
    const phased = world.players.get("phased")!;
    attacker.state.position = { x: 0, y: 0 };
    attacker.state.velocity = { x: 0, y: 0 };
    attacker.state.angle = 0;
    phased.state.position = { x: 36, y: 0 };
    phased.state.velocity = { x: 0, y: 0 };
    phased.state.energy = 100;
    phased.phaseTimer = 1;
    phased.spawnProtectionTimer = 0;
    world.setInput("attacker", { q: 1, m: 0, f: true }, 0);
    world.step(0.1, 100);

    expect(phased.state.energy).toBe(100);
    expect(phased.respawnTimer).toBe(0);
  });

  it("accelerates ships faster while afterburner is active", () => {
    const normalWorld = new ServerWorld();
    normalWorld.configure({ map: "open", powerups: [], wormholes: false });
    normalWorld.addPlayer("pilot", 0);
    const normal = normalWorld.players.get("pilot")!;
    normalWorld.setInput("pilot", { q: 1, m: 1, f: false }, 0);
    normalWorld.step(0.1, 100);

    const boostedWorld = new ServerWorld();
    boostedWorld.configure({ map: "open", powerups: [], wormholes: false });
    boostedWorld.addPlayer("pilot", 0);
    const boosted = boostedWorld.players.get("pilot")!;
    boosted.afterburnerTimer = 1;
    boostedWorld.setInput("pilot", { q: 1, m: 1, f: false }, 0);
    boostedWorld.step(0.1, 100);

    expect(Math.hypot(boosted.state.velocity.x, boosted.state.velocity.y)).toBeGreaterThan(
      Math.hypot(normal.state.velocity.x, normal.state.velocity.y) * 1.4,
    );
  });

  it("reflects projectiles without damaging the protected pilot", () => {
    const world = new ServerWorld();
    world.configure({ map: "open", powerups: [], wormholes: false });
    world.addPlayer("attacker", 0);
    world.addPlayer("reflector", 0);
    world.takeSnapshot();
    const attacker = world.players.get("attacker")!;
    const reflector = world.players.get("reflector")!;
    attacker.state.position = { x: 0, y: 0 };
    attacker.state.velocity = { x: 0, y: 0 };
    attacker.state.angle = 0;
    reflector.state.position = { x: 36, y: 0 };
    reflector.state.velocity = { x: 0, y: 0 };
    reflector.state.energy = 100;
    reflector.reflectorTimer = 1;
    reflector.spawnProtectionTimer = 0;
    world.setInput("attacker", { q: 1, m: 0, f: true }, 0);
    world.step(0.1, 100);

    const snapshot = world.takeSnapshot();
    expect(reflector.state.energy).toBe(100);
    expect(snapshot.events).toContainEqual(["reflect", "reflector"]);
  });

  it("pulls enemies into gravity mines and applies blast damage", () => {
    const world = new ServerWorld();
    world.configure({ map: "open", powerups: [], wormholes: false });
    world.addPlayer("owner", 0);
    world.addPlayer("victim", 0);
    world.takeSnapshot();
    const owner = world.players.get("owner")!;
    const victim = world.players.get("victim")!;
    owner.state.position = { x: 300, y: 300 };
    victim.state.position = { x: 80, y: 0 };
    victim.state.velocity = { x: 0, y: 0 };
    victim.state.energy = 100;
    victim.spawnProtectionTimer = 0;
    world.mines.set(1, { id: 1, owner: "owner", position: { x: 0, y: 0 }, timer: 0.05 });
    world.step(0.1, 100);

    const snapshot = world.takeSnapshot();
    expect(victim.state.velocity.x).toBeLessThan(0);
    expect(victim.state.energy).toBeLessThan(100);
    expect(snapshot.events).toContainEqual(["mine-explode", "owner", 0, 0]);
  });

  it("activates each new effect when its arena pickup is collected", () => {
    const world = new ServerWorld();
    world.configure({
      map: "open",
      powerups: ["phase", "afterburner", "gravity", "reflector"],
      wormholes: false,
    });
    world.addPlayer("pilot", 0);
    const pilot = world.players.get("pilot")!;

    for (const [id, type] of [
      [1, "phase"],
      [2, "afterburner"],
      [3, "reflector"],
      [4, "gravity"],
    ] as const) {
      world.powerups.set(id, { id, type, position: { ...pilot.state.position } });
      world.step(0.01, id * 10);
    }

    expect(pilot.phaseTimer).toBeGreaterThan(4.9);
    expect(pilot.afterburnerTimer).toBeGreaterThan(9.9);
    expect(pilot.reflectorTimer).toBeGreaterThan(7.9);
    expect(world.mines.size).toBe(1);
    expect(world.takeSnapshot().settings[1]).toBe(0b11110000);
  });

  it("refills and overcharges ship energy from instant pickups", () => {
    const world = new ServerWorld();
    world.configure({
      map: "open",
      powerups: ["fuel", "overcharge"],
      wormholes: false,
    });
    world.addPlayer("pilot", 0);
    const pilot = world.players.get("pilot")!;

    pilot.state.energy = 32;
    world.powerups.set(1, { id: 1, type: "fuel", position: { ...pilot.state.position } });
    world.step(0.01, 10);
    expect(pilot.state.energy).toBe(100);

    world.powerups.set(2, { id: 2, type: "overcharge", position: { ...pilot.state.position } });
    world.step(0.01, 20);
    expect(pilot.state.energy).toBe(200);
    world.step(0.1, 120);
    expect(pilot.state.energy).toBe(200);
    expect(world.takeSnapshot().settings[1]).toBe(0b1100000000);
  });

  it("awards kills, penalizes deaths, and resets a completed top-score round", () => {
    const world = new ServerWorld();
    world.configure({
      map: "open",
      powerups: [],
      wormholes: false,
      gameMode: "top-score",
      scoreToWin: 1,
    });
    world.addPlayer("winner", 0);
    world.addPlayer("victim", 0);
    world.takeSnapshot();
    const winner = world.players.get("winner")!;
    const victim = world.players.get("victim")!;
    winner.state.position = { x: 0, y: 0 };
    winner.state.velocity = { x: 0, y: 0 };
    winner.state.angle = 0;
    victim.state.position = { x: 36, y: 0 };
    victim.state.velocity = { x: 0, y: 0 };
    victim.state.energy = 1;
    victim.spawnProtectionTimer = 0;
    world.setInput("winner", { q: 1, m: 0, f: true }, 0);
    world.step(0.1, 100);

    const winningSnapshot = world.takeSnapshot();
    expect(winningSnapshot.events).toContainEqual(["win", "winner"]);
    expect(winningSnapshot.round[0]).toBe(2);
    expect(winningSnapshot.round[1]).toBeGreaterThan(14.8);
    expect(winningSnapshot.round[1]).toBeLessThanOrEqual(15);
    expect(winningSnapshot.ships.find((ship) => ship[0] === "winner")?.[18]).toBe(1);
    for (let frame = 1; frame <= 155; frame += 1) world.step(0.1, 100 + frame * 100);
    expect(world.takeSnapshot().ships.every((ship) => ship[18] === 0)).toBe(true);
  });

  it("freezes the world for the three-second opening countdown", () => {
    const world = new ServerWorld();
    world.addPlayer("pilot", 0);
    world.startMatchCountdown();
    const before = world.takeSnapshot();
    world.setInput("pilot", { q: 1, m: 1, f: false }, 0);
    for (let frame = 1; frame <= 20; frame += 1) world.step(0.1, frame * 100);
    const during = world.takeSnapshot();
    expect(during.round[0]).toBe(1);
    expect(during.ships[0][1]).toBe(before.ships[0][1]);
    for (let frame = 21; frame <= 32; frame += 1) world.step(0.1, frame * 100);
    expect(world.takeSnapshot().round[0]).toBe(0);
  });

  it("keeps kill and death scores during endless play", () => {
    const world = new ServerWorld();
    world.configure({
      map: "open",
      powerups: [],
      wormholes: false,
      gameMode: "endless",
      scoreToWin: 5,
    });
    world.addPlayer("attacker", 0);
    world.addPlayer("victim", 0);
    world.takeSnapshot();
    const attacker = world.players.get("attacker")!;
    const victim = world.players.get("victim")!;
    attacker.state.position = { x: 0, y: 0 };
    attacker.state.velocity = { x: 0, y: 0 };
    attacker.state.angle = 0;
    victim.state.position = { x: 36, y: 0 };
    victim.state.velocity = { x: 0, y: 0 };
    victim.state.energy = 1;
    victim.spawnProtectionTimer = 0;
    world.setInput("attacker", { q: 1, m: 0, f: true }, 0);
    world.step(0.1, 100);

    const ships = world.takeSnapshot().ships;
    expect(ships.find((ship) => ship[0] === "attacker")?.[18]).toBe(1);
    expect(ships.find((ship) => ship[0] === "victim")?.[18]).toBe(-1);
  });

  it("ends a timed match with the sole highest-scoring pilot", () => {
    const world = new ServerWorld();
    world.configure({
      map: "open",
      powerups: [],
      wormholes: false,
      gameMode: "timed",
      matchDurationSeconds: 30,
    });
    world.addPlayer("leader", 0);
    world.addPlayer("runner-up", 0);
    world.startMatchCountdown();
    advance(world, 3.1);
    world.players.get("leader")!.score = 4;
    world.players.get("runner-up")!.score = 2;
    advance(world, 30.1, 4_000);

    const snapshot = world.takeSnapshot();
    expect(snapshot.events).toContainEqual(["win", "leader"]);
    expect(snapshot.round[0]).toBe(2);
  });

  it("spectates nonleaders in timed sudden death and awards the next kill", () => {
    const world = new ServerWorld();
    world.configure({
      map: "open",
      powerups: [],
      wormholes: false,
      gameMode: "timed",
      matchDurationSeconds: 30,
    });
    world.addPlayer("alpha", 0);
    world.addPlayer("bravo", 0);
    world.addPlayer("charlie", 0);
    world.startMatchCountdown();
    advance(world, 3.1);
    world.players.get("alpha")!.score = 3;
    world.players.get("bravo")!.score = 3;
    world.players.get("charlie")!.score = 1;
    advance(world, 30.1, 4_000);

    const suddenDeath = world.takeSnapshot();
    expect(suddenDeath.round[0]).toBe(3);
    expect(suddenDeath.ships.find((ship) => ship[0] === "alpha")?.[19]).toBe(0);
    expect(suddenDeath.ships.find((ship) => ship[0] === "bravo")?.[19]).toBe(0);
    expect(suddenDeath.ships.find((ship) => ship[0] === "charlie")?.[19]).toBe(1);

    const alpha = world.players.get("alpha")!;
    const bravo = world.players.get("bravo")!;
    alpha.state.position = { x: 0, y: 0 };
    alpha.state.velocity = { x: 0, y: 0 };
    alpha.state.angle = 0;
    bravo.state.position = { x: 36, y: 0 };
    bravo.state.velocity = { x: 0, y: 0 };
    bravo.state.energy = 1;
    bravo.spawnProtectionTimer = 0;
    world.setInput("alpha", { q: 1, m: 0, f: true }, 35_000);
    world.step(0.1, 35_100);

    const winner = world.takeSnapshot();
    expect(winner.events).toContainEqual(["win", "alpha"]);
    expect(winner.round[0]).toBe(2);
  });
});
