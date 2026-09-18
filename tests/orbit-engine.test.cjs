'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const OrbitEngine = require('../assets/js/orbit-engine.js');

function advance(engine, seconds, holding) {
  for (let frame = 0; frame < Math.ceil(seconds * 120); frame += 1) engine.step(1 / 120, holding);
}

function approach(engine, id) {
  const planet = engine.state.planets.find((entry) => entry.id === id);
  Object.assign(engine.state.ship, { x: planet.x + 70, y: planet.y, vx: 0, vy: 180, orbitId: null });
  engine.step(1 / 120, false);
  engine.step(1 / 120, true);
}

test('same seed gives reachable, bounded planet chains', () => {
  const engine = new OrbitEngine({ seed: 42 });
  assert.deepEqual(engine.state.planets, new OrbitEngine({ seed: 42 }).state.planets);
  assert.notDeepEqual(engine.state.planets, new OrbitEngine({ seed: 43 }).state.planets);
  for (let index = 1; index < engine.state.planets.length; index += 1) {
    const previous = engine.state.planets[index - 1];
    const next = engine.state.planets[index];
    assert.ok(Math.abs(next.x) <= 110);
    assert.ok(next.y - previous.y >= 126 && next.y - previous.y <= 162);
    assert.ok(Math.hypot(next.x - previous.x, next.y - previous.y) < 190);
  }
});

test('release launches tangentially upwards and holding again captures the next planet', () => {
  const engine = new OrbitEngine({ seed: 4 });
  const start = { ...engine.state.ship };
  engine.step(1 / 120, false);
  const ship = engine.state.ship;
  assert.equal(ship.orbitId, null);
  assert.ok(Math.abs(start.x * ship.vx + start.y * ship.vy) < 0.0001, 'launch velocity is tangent to the orbit');
  assert.ok(ship.vy > 160, 'first launch points toward the chain');
  advance(engine, 0.36, false);
  engine.step(1 / 120, true);
  assert.equal(ship.orbitId, 1);
  assert.equal(engine.state.captureCount, 1);
  const count = engine.state.captureCount;
  advance(engine, 0.2, true);
  assert.equal(ship.orbitId, 1);
  assert.equal(engine.state.captureCount, count, 'a continuous hold cannot repeatedly award capture');
  engine.step(1 / 120, false);
  engine.step(1 / 120, true);
  assert.notEqual(ship.orbitId, 1, 'release cannot immediately recapture the same planet');
});

test('holding can arm a rescue before a planet is in range', () => {
  const engine = new OrbitEngine({ seed: 4 });
  engine.step(1 / 120, false);
  engine.step(1 / 120, true);
  assert.equal(engine.state.ship.orbitId, null);
  advance(engine, 0.5, true);
  assert.equal(engine.state.ship.orbitId, 1);
});

test('clamps large frame deltas and rejects invalid time without damaging simulation', () => {
  const engine = new OrbitEngine({ seed: 1 });
  engine.step(100, false);
  assert.ok(engine.state.elapsed <= 0.100001);
  const snapshot = engine.snapshot();
  for (const value of [-1, 0, NaN, Infinity]) engine.step(value, true);
  assert.deepEqual(engine.snapshot(), snapshot);
  assert.ok(Number.isFinite(engine.state.ship.x));
});

test('world edge rebounds and remaining in an orbit lets the black hole catch up', () => {
  const edge = new OrbitEngine({ seed: 3 });
  Object.assign(edge.state.ship, { orbitId: null, x: 175, y: 0, vx: 170, vy: 0 });
  edge.step(0.03, false);
  assert.ok(edge.state.ship.x <= 176 && edge.state.ship.vx < 0);
  assert.equal(edge.state.phase, 'running');
  const idle = new OrbitEngine({ seed: 3 });
  advance(idle, 20, true);
  assert.equal(idle.state.phase, 'lost');
  assert.equal(idle.state.reason, 'black-hole');
});

test('surviving 75 seconds completes the run exactly once', () => {
  const engine = new OrbitEngine({ seed: 3 });
  Object.assign(engine.state.ship, { orbitId: null, y: 8000, vx: 0, vy: 0 });
  engine.state.elapsed = 74.98;
  engine.step(0.04, false);
  assert.equal(engine.state.phase, 'won');
  assert.equal(engine.state.elapsed, 75);
  assert.equal(engine.state.score, 500);
  engine.step(0.1, false);
  assert.equal(engine.state.score, 500);
});

test('rewind restores the earlier ship, collected rings and score, and can only be used once', () => {
  const engine = new OrbitEngine({ seed: 2 });
  engine.state.rings = [{ id: 999, x: 92, y: 260, collected: false }];
  advance(engine, 2.5, false);
  assert.ok(engine.state.rings[0].collected);
  assert.ok(engine.state.score > 0);
  const elapsed = engine.state.elapsed;
  assert.equal(engine.rewind(), true);
  assert.ok(elapsed - engine.state.elapsed >= 1.99 && elapsed - engine.state.elapsed < 2.04);
  assert.equal(engine.state.rings[0].collected, false);
  assert.equal(engine.state.score, 0);
  assert.equal(engine.state.rewindAvailable, false);
  advance(engine, 2, false);
  assert.equal(engine.state.score, 35, 'replaying the pickup does not duplicate the score');
  assert.equal(engine.rewind(), false);
});

test('death can be rewound to a playable earlier moment', () => {
  const engine = new OrbitEngine({ seed: 9 });
  advance(engine, 2.2, false);
  engine.state.asteroids.push({ id: 999, x: engine.state.ship.x, y: engine.state.ship.y, radius: 12 });
  engine.step(1 / 120, false);
  assert.equal(engine.state.phase, 'lost');
  assert.equal(engine.rewind(), true);
  assert.equal(engine.state.phase, 'running');
  assert.equal(engine.state.reason, '');
  engine.step(1 / 120, false);
  assert.equal(engine.state.phase, 'running');
});

test('a shield upgrade stops a collision and a magnet upgrade expands capture range', () => {
  const engine = new OrbitEngine({ seed: 4 });
  let id = 0;
  while (!engine.state.powers.shield && id < 12) approach(engine, ++id);
  assert.equal(engine.state.powers.shield, 1);
  engine.state.asteroids.push({ id: 999, x: engine.state.ship.x, y: engine.state.ship.y, radius: 15 });
  engine.step(1 / 120, true);
  assert.equal(engine.state.phase, 'running');
  assert.equal(engine.state.powers.shield, 0);
  assert.equal(engine.state.asteroids.find((entry) => entry.id === 999).destroyed, true);
  while (!engine.state.powers.magnetUntil && id < 12) approach(engine, ++id);
  assert.ok(engine.state.powers.magnetUntil > engine.state.elapsed);
  const next = engine.state.planets[id + 1];
  Object.assign(engine.state.ship, { x: next.x + (next.x >= 0 ? -130 : 130), y: next.y, vx: 0, vy: 0, orbitId: null });
  engine.step(1 / 120, false);
  engine.step(1 / 120, true);
  assert.equal(engine.state.ship.orbitId, next.id);
});

test('twelve unique captures grant the signal echo and revisiting does not farm upgrades', () => {
  const engine = new OrbitEngine({ seed: 8 });
  for (let id = 1; id <= 12; id += 1) approach(engine, id);
  assert.equal(engine.state.captureCount, 12);
  assert.ok(engine.state.powers.echoUntil > engine.state.elapsed);
  engine.state.rings.push({ id: 999, x: engine.state.ship.x - 60, y: engine.state.ship.y, collected: false });
  engine.step(1 / 120, true);
  assert.equal(engine.state.rings.find((entry) => entry.id === 999).collected, true);
  const count = engine.state.captureCount;
  approach(engine, 11);
  assert.equal(engine.state.captureCount, count);
});

test('first launch rewards a pickup and timing stays consistent across refresh rates', () => {
  const slow = new OrbitEngine({ seed: 15 });
  const fast = new OrbitEngine({ seed: 15 });
  for (let frame = 0; frame < 30; frame += 1) slow.step(1 / 60, false);
  for (let frame = 0; frame < 60; frame += 1) fast.step(1 / 120, false);
  assert.equal(slow.state.rings[0].collected, true);
  assert.equal(slow.state.score, 35);
  assert.ok(Math.abs(slow.state.ship.x - fast.state.ship.x) < 0.000001);
  assert.ok(Math.abs(slow.state.ship.y - fast.state.ship.y) < 0.000001);
});

test('remaining near a black-hole edge awards a single graze bonus', () => {
  const engine = new OrbitEngine({ seed: 15 });
  Object.assign(engine.state.ship, { x: 0, y: -260, vx: 0, vy: 0, orbitId: null });
  engine.step(1 / 120, false);
  assert.equal(engine.state.score, 100);
  advance(engine, 0.6, false);
  assert.equal(engine.state.score, 100);
  assert.equal(engine.state.phase, 'running');
});

test('upgrade order varies by route, repeats predictably, and always includes all three powers', () => {
  function sequence(seed) {
    const engine = new OrbitEngine({ seed });
    for (let id = 1; id <= 24; id += 1) approach(engine, id);
    const result = [...engine._powerOrder, ...engine._powerOrder];
    assert.deepEqual([...new Set(result.slice(0, 3))].sort(), ['echo', 'magnet', 'shield']);
    assert.deepEqual(result.slice(0, 3), result.slice(3, 6));
    return result;
  }
  const routes = [1, 2, 3, 4, 5, 6].map(sequence);
  assert.ok(new Set(routes.map((route) => route.join(','))).size > 1);
  assert.deepEqual(sequence(3), sequence(3));
});

test('doing nothing cannot win, even on a route without an early collision', () => {
  let blackHoleLosses = 0;
  for (let seed = 1; seed <= 8; seed += 1) {
    const engine = new OrbitEngine({ seed });
    advance(engine, 75, false);
    assert.equal(engine.state.phase, 'lost', `route ${seed} requires active input`);
    assert.ok(engine.state.elapsed < 75);
    if (engine.state.reason === 'black-hole') blackHoleLosses += 1;
  }
  assert.ok(blackHoleLosses > 0, 'drag and pursuit prevent idle wins independently of asteroid collisions');
});

test('timed one-button launches and captures can win a full unmodified route', () => {
  const engine = new OrbitEngine({ seed: 3 });
  for (let frame = 0; frame < 9100 && engine.state.phase === 'running'; frame += 1) {
    const state = engine.state;
    const ship = state.ship;
    let holding;
    if (ship.orbitId !== null) {
      const next = state.planets[ship.orbitId + 1];
      const dx = next.x - ship.x;
      const dy = next.y - ship.y;
      const tangentX = -Math.sin(ship.orbitAngle) * ship.orbitDirection;
      const tangentY = Math.cos(ship.orbitAngle) * ship.orbitDirection;
      holding = (tangentX * dx + tangentY * dy) / Math.hypot(dx, dy) < 0.99;
    } else holding = state.targetId !== null && state.targetId > state.captureCount;
    engine.step(1 / 120, holding);
  }
  assert.equal(engine.state.phase, 'won');
  assert.equal(engine.state.elapsed, 75);
  assert.ok(engine.state.captureCount > 30, 'the route is completed through repeated launches');
  assert.ok(engine.state.score > 500);
});
