export interface Vec2 {
  x: number;
  y: number;
}

export interface ShipState {
  position: Vec2;
  velocity: Vec2;
  angle: number;
  energy: number;
}

export interface BulletState {
  position: Vec2;
  velocity: Vec2;
  lifetime: number;
  owner: string;
}

export interface FlightInput {
  thrust: boolean;
  reverse: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  boost: boolean;
}

export interface FlightConfig {
  thrust: number;
  reverseThrust: number;
  turnSpeed: number;
  maxSpeed: number;
  boostMultiplier: number;
  boostSpeedMultiplier: number;
  boostEnergyPerSecond: number;
  maxEnergy: number;
  energyRechargePerSecond: number;
  shipRadius: number;
  wallRestitution: number;
  bulletSpeed: number;
  bulletLifetime: number;
  bulletEnergyCost: number;
  bulletCooldown: number;
  bulletDamage: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_FLIGHT_CONFIG: FlightConfig = {
  thrust: 180,
  reverseThrust: 105,
  turnSpeed: 3.15,
  maxSpeed: 275,
  boostMultiplier: 1.8,
  boostSpeedMultiplier: 1.42,
  boostEnergyPerSecond: 28,
  maxEnergy: 100,
  energyRechargePerSecond: 17,
  shipRadius: 13,
  wallRestitution: 0.62,
  bulletSpeed: 520,
  bulletLifetime: 1.15,
  bulletEnergyCost: 6,
  bulletCooldown: 0.14,
  bulletDamage: 14,
};

export function createShip(config = DEFAULT_FLIGHT_CONFIG): ShipState {
  return {
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    angle: Math.PI / 2,
    energy: config.maxEnergy,
  };
}

export function speedOf(ship: ShipState): number {
  return Math.hypot(ship.velocity.x, ship.velocity.y);
}

export function fireBullet(
  ship: ShipState,
  config: FlightConfig,
  owner = "local",
): BulletState | null {
  if (ship.energy < config.bulletEnergyCost) return null;

  const forward = { x: Math.cos(ship.angle), y: Math.sin(ship.angle) };
  ship.energy -= config.bulletEnergyCost;

  return {
    position: {
      x: ship.position.x + forward.x * (config.shipRadius + 6),
      y: ship.position.y + forward.y * (config.shipRadius + 6),
    },
    velocity: {
      x: ship.velocity.x + forward.x * config.bulletSpeed,
      y: ship.velocity.y + forward.y * config.bulletSpeed,
    },
    lifetime: config.bulletLifetime,
    owner,
  };
}

export function stepBullet(bullet: BulletState, deltaSeconds: number): void {
  bullet.position.x += bullet.velocity.x * deltaSeconds;
  bullet.position.y += bullet.velocity.y * deltaSeconds;
  bullet.lifetime -= deltaSeconds;
}

export function circleIntersectsRect(position: Vec2, radius: number, rect: Rect): boolean {
  const nearestX = clamp(position.x, rect.x, rect.x + rect.width);
  const nearestY = clamp(position.y, rect.y, rect.y + rect.height);
  return Math.hypot(position.x - nearestX, position.y - nearestY) < radius;
}

export function circlesIntersect(
  first: Vec2,
  firstRadius: number,
  second: Vec2,
  secondRadius: number,
): boolean {
  return Math.hypot(first.x - second.x, first.y - second.y) < firstRadius + secondRadius;
}

export function stepShip(
  ship: ShipState,
  input: FlightInput,
  config: FlightConfig,
  deltaSeconds: number,
): void {
  const turn = Number(input.turnLeft) - Number(input.turnRight);
  ship.angle += turn * config.turnSpeed * deltaSeconds;

  const canBoost = input.boost && input.thrust && ship.energy > 0;
  const forward = { x: Math.cos(ship.angle), y: Math.sin(ship.angle) };
  let acceleration = 0;

  if (input.thrust) {
    acceleration += config.thrust * (canBoost ? config.boostMultiplier : 1);
  }
  if (input.reverse) {
    acceleration -= config.reverseThrust;
  }

  ship.velocity.x += forward.x * acceleration * deltaSeconds;
  ship.velocity.y += forward.y * acceleration * deltaSeconds;

  if (canBoost) {
    ship.energy = Math.max(0, ship.energy - config.boostEnergyPerSecond * deltaSeconds);
  } else {
    ship.energy = Math.min(
      config.maxEnergy,
      ship.energy + config.energyRechargePerSecond * deltaSeconds,
    );
  }

  const maxSpeed = config.maxSpeed * (canBoost ? config.boostSpeedMultiplier : 1);
  const speed = speedOf(ship);
  if (speed > maxSpeed) {
    const scale = maxSpeed / speed;
    ship.velocity.x *= scale;
    ship.velocity.y *= scale;
  }

  ship.position.x += ship.velocity.x * deltaSeconds;
  ship.position.y += ship.velocity.y * deltaSeconds;
}

export function resolveCircleAgainstRect(
  ship: ShipState,
  rect: Rect,
  radius: number,
  restitution: number,
): boolean {
  const nearestX = clamp(ship.position.x, rect.x, rect.x + rect.width);
  const nearestY = clamp(ship.position.y, rect.y, rect.y + rect.height);
  let offsetX = ship.position.x - nearestX;
  let offsetY = ship.position.y - nearestY;
  let distance = Math.hypot(offsetX, offsetY);
  let penetration: number;

  if (distance >= radius) return false;

  if (distance === 0) {
    const distances = [
      { distance: ship.position.x - rect.x, x: -1, y: 0 },
      { distance: rect.x + rect.width - ship.position.x, x: 1, y: 0 },
      { distance: ship.position.y - rect.y, x: 0, y: -1 },
      { distance: rect.y + rect.height - ship.position.y, x: 0, y: 1 },
    ];
    const closest = distances.reduce((best, current) =>
      current.distance < best.distance ? current : best,
    );
    offsetX = closest.x;
    offsetY = closest.y;
    penetration = closest.distance + radius;
    distance = 1;
  } else {
    penetration = radius - distance;
  }

  const normalX = offsetX / distance;
  const normalY = offsetY / distance;
  ship.position.x += normalX * penetration;
  ship.position.y += normalY * penetration;

  const inwardSpeed = ship.velocity.x * normalX + ship.velocity.y * normalY;
  if (inwardSpeed < 0) {
    ship.velocity.x -= (1 + restitution) * inwardSpeed * normalX;
    ship.velocity.y -= (1 + restitution) * inwardSpeed * normalY;
  }

  return true;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
