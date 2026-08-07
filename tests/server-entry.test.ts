// @ts-nocheck -- This test runs in Vitest's Node environment; the browser app
// intentionally does not install Node type declarations.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

interface MockPlayer {
  id: string;
  playerId: null;
  displayName: string;
  avatarUrl: null;
}

describe("Portals server room directory", () => {
  it("lists public rooms and enforces the join-in-progress option", () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const state: Record<string, unknown> = {};
    const sent: unknown[] = [];
    const intervals: Array<() => void> = [];
    const players: MockPlayer[] = ["one", "two", "three"].map((id) => ({
      id,
      playerId: null,
      displayName: id,
      avatarUrl: null,
    }));
    let now = 1_000;
    const FakeDate = class extends Date {
      static now(): number { return now; }
    };
    const server = {
      on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
      send: (message: unknown) => sent.push(message),
      setState: (key: string, value: unknown) => { state[key] = value; },
      getState: (key?: string) => key ? state[key] : state,
      players: () => players,
      kick: () => {},
      setInterval: (callback: () => void) => { intervals.push(callback); return intervals.length; },
      log: () => {},
    };
    const context = vm.createContext({ server, Date: FakeDate, Math, Object, Array, Map, Set, Number, String, Boolean, JSON });
    vm.runInContext(readFileSync("dist/server.js", "utf8"), context);
    const message = handlers.get("message");
    expect(message).toBeDefined();

    message?.({
      k: "create-room",
      room: "alpha",
      settings: { map: "classic", powerups: ["shield"], wormholes: true },
      public: true,
      joinInProgress: false,
    }, "one");
    expect(state["server:rooms"]).toEqual([["alpha", 1, 8, "classic", 0, 0, "endless"]]);

    message?.({ k: "join-room", room: "alpha" }, "two");
    expect(state["server:rooms"]).toEqual([["alpha", 2, 8, "classic", 1, 0, "endless"]]);
    message?.({ k: "join-room", room: "alpha" }, "three");
    expect(sent).toContainEqual({
      k: "room-error",
      to: "three",
      message: "MATCH IN PROGRESS — JOINING DISABLED",
    });

    now += 50;
    intervals[0]();
    expect(sent.some((value) => {
      return typeof value === "object" && value !== null && "k" in value && value.k === "s" && "r" in value && typeof value.r === "string";
    })).toBe(true);
  });

  it("keeps private rooms out of shared directory state", () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const state: Record<string, unknown> = {};
    const server = {
      on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
      send: () => {},
      setState: (key: string, value: unknown) => { state[key] = value; },
      getState: (key?: string) => key ? state[key] : state,
      players: () => [],
      kick: () => {},
      setInterval: () => 1,
      log: () => {},
    };
    const context = vm.createContext({ server, Date, Math, Object, Array, Map, Set, Number, String, Boolean, JSON });
    vm.runInContext(readFileSync("dist/server.js", "utf8"), context);
    handlers.get("message")?.({
      k: "create-room",
      room: "secret",
      settings: { map: "open", powerups: [], wormholes: false },
      public: false,
      joinInProgress: true,
    }, "owner");
    expect(state["server:rooms"]).toEqual([]);
  });
});
