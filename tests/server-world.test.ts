import { describe, expect, it } from "vitest";
import { ServerWorld } from "../src/server-world";

describe("authoritative server world", () => {
  it("accepts the first room configuration and publishes its compact settings", () => {
    const world = new ServerWorld();
    expect(world.configure({ map: "open", powerups: ["shield", "laser"], wormholes: false })).toBe(true);
    expect(world.configure({ map: "classic", powerups: [], wormholes: true })).toBe(false);

    const snapshot = world.takeSnapshot();
    expect(snapshot.settings).toEqual(["open", 0b1001, 0]);
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
    expect(after[13]).toBe(7);
    expect(after[14]).toBe(17);
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
    expect(pilot?.[13]).toBe(4);
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
});
