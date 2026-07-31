# Phase 0: Flight Laboratory

## Current scope

Build a small, local browser sandbox that establishes the core flight feel before considering the larger game.

The sandbox includes:

- minimalist vector-style visuals made from simple shapes;
- a top-down orthographic camera that follows the ship;
- thrust, reverse thrust, rotation, momentum, and a speed cap;
- an afterburner that increases acceleration and speed while consuming energy;
- automatic energy recharge;
- basic forward-firing bullets that consume energy;
- room-code multiplayer using the hosted Portals SDK;
- interpolated remote ships and relayed projectile events;
- local damage, death, and respawn for lightweight multiplayer combat;
- an offline practice fallback when the Portals transport is unavailable;
- world boundaries and a few solid obstacles;
- ship-to-wall collision and bounce response;
- a diagnostics overlay for velocity, position, energy, and simulation state;
- editable movement constants for rapid tuning;
- reset and pause controls;
- automated tests for the simulation rules.

## Controls

| Input | Action |
| --- | --- |
| W / Up | Thrust |
| S / Down | Reverse thrust |
| A / Left | Rotate left |
| D / Right | Rotate right |
| Shift | Afterburner while thrusting |
| Space | Fire bullets |
| Mouse wheel | Zoom camera in or out |
| Backquote | Toggle diagnostics and tuning |
| P | Pause |
| R | Reset ship |

## Success criteria

Phase 0 is complete when:

- the ship is satisfying and predictable to fly;
- momentum and wall collisions behave consistently at different frame rates;
- afterburning creates a meaningful speed-versus-energy tradeoff;
- movement constants can be tuned without changing source code;
- simulation tests pass;
- the sandbox runs smoothly in a current desktop browser.

## Deliberately deferred

Authoritative server logic, competitive rankings, pickups, additional ship types, teams, objectives, content pipelines, configurable zones, and production art/audio are not part of Phase 0. This multiplayer test uses Portals' client-reported relay model and should be treated as trust-light gameplay.
