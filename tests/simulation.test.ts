import { describe, expect, it } from "vitest";
import {
  createShip,
  circleIntersectsRect,
  circlesIntersect,
  DEFAULT_FLIGHT_CONFIG,
  fireBullet,
  type FlightInput,
  resolveCircleAgainstRect,
  speedOf,
  stepBullet,
  stepShip,
} from "../src/simulation";

const idleInput: FlightInput = {
  thrust: false,
  reverse: false,
  turnLeft: false,
  turnRight: false,
  boost: false,
};

describe("flight simulation", () => {
  it("retains momentum while drifting", () => {
    const ship = createShip();
    ship.velocity = { x: 80, y: -25 };

    stepShip(ship, idleInput, DEFAULT_FLIGHT_CONFIG, 0.5);

    expect(ship.velocity).toEqual({ x: 80, y: -25 });
    expect(ship.position.x).toBe(40);
    expect(ship.position.y).toBe(-12.5);
  });

  it("spends energy while boosting and recharges while idle", () => {
    const ship = createShip();
    const boosting = { ...idleInput, thrust: true, boost: true };

    stepShip(ship, boosting, DEFAULT_FLIGHT_CONFIG, 1);
    expect(ship.energy).toBe(72);

    stepShip(ship, idleInput, DEFAULT_FLIGHT_CONFIG, 1);
    expect(ship.energy).toBe(89);
  });

  it("caps normal and boosted speed", () => {
    const ship = createShip();
    ship.velocity.x = 1000;

    stepShip(ship, idleInput, DEFAULT_FLIGHT_CONFIG, 1 / 120);
    expect(speedOf(ship)).toBeCloseTo(DEFAULT_FLIGHT_CONFIG.maxSpeed);

    ship.velocity.x = 1000;
    stepShip(
      ship,
      { ...idleInput, thrust: true, boost: true },
      DEFAULT_FLIGHT_CONFIG,
      1 / 120,
    );
    expect(speedOf(ship)).toBeCloseTo(
      DEFAULT_FLIGHT_CONFIG.maxSpeed * DEFAULT_FLIGHT_CONFIG.boostSpeedMultiplier,
    );
  });

  it("pushes the ship out of a wall and reflects inward velocity", () => {
    const ship = createShip();
    ship.position = { x: -5, y: 50 };
    ship.velocity = { x: 40, y: 0 };

    const collided = resolveCircleAgainstRect(
      ship,
      { x: 0, y: 0, width: 20, height: 100 },
      10,
      0.25,
    );

    expect(collided).toBe(true);
    expect(ship.position.x).toBe(-10);
    expect(ship.velocity.x).toBe(-10);
  });

  it("fully ejects a ship whose center is inside a wall", () => {
    const ship = createShip();
    ship.position = { x: 5, y: 50 };
    ship.velocity = { x: 20, y: 0 };

    resolveCircleAgainstRect(
      ship,
      { x: 0, y: 0, width: 20, height: 100 },
      10,
      0,
    );

    expect(ship.position.x).toBe(-10);
    expect(ship.velocity.x).toBe(0);
  });

  it("fires bullets forward with inherited ship velocity and an energy cost", () => {
    const ship = createShip();
    ship.angle = 0;
    ship.velocity = { x: 20, y: -5 };

    const bullet = fireBullet(ship, DEFAULT_FLIGHT_CONFIG);

    expect(bullet).not.toBeNull();
    expect(ship.energy).toBe(94);
    expect(bullet?.velocity.x).toBe(540);
    expect(bullet?.velocity.y).toBe(-5);
    expect(bullet?.position.x).toBe(19);
  });

  it("advances bullets, expires them, and detects wall contact", () => {
    const ship = createShip();
    ship.angle = 0;
    const bullet = fireBullet(ship, DEFAULT_FLIGHT_CONFIG);
    if (!bullet) throw new Error("Expected a bullet");

    stepBullet(bullet, 0.1);

    expect(bullet.position.x).toBe(71);
    expect(bullet.lifetime).toBeCloseTo(1.05);
    expect(
      circleIntersectsRect(bullet.position, 3, { x: 70, y: -10, width: 20, height: 20 }),
    ).toBe(true);
  });

  it("detects bullet overlap with a ship", () => {
    expect(circlesIntersect({ x: 0, y: 0 }, 3, { x: 15, y: 0 }, 13)).toBe(true);
    expect(circlesIntersect({ x: 0, y: 0 }, 3, { x: 17, y: 0 }, 13)).toBe(false);
  });
});
