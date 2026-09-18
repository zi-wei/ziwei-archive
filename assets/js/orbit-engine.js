(function (root, factory) {
  'use strict';
  const OrbitEngine = factory();
  if (typeof module === 'object' && module.exports) module.exports = OrbitEngine;
  else root.OrbitEngine = OrbitEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function randomFor(seed) {
    let value = seed >>> 0;
    return function () {
      value += 0x6D2B79F5;
      let result = Math.imul(value ^ value >>> 15, 1 | value);
      result ^= result + Math.imul(result ^ result >>> 7, 61 | result);
      return ((result ^ result >>> 14) >>> 0) / 4294967296;
    };
  }

  class OrbitEngine {
    constructor(options = {}) {
      this.seed = options.seed === undefined ? Date.now() : options.seed;
      this.reset();
    }

    reset(seed = this.seed) {
      this.seed = Number(seed) >>> 0;
      const random = randomFor(this.seed);
      const planets = [{ id: 0, x: 0, y: 0, radius: 22, captureRadius: 105 }];
      const rings = [];
      const asteroids = [];
      let y = 0;
      let previousX = 0;
      for (let index = 1; index <= 110; index += 1) {
        y += index < 3 ? 135 : 126 + random() * 36;
        const x = index === 1 ? 48 : clamp(previousX + (random() - 0.5) * 155, -110, 110);
        const radius = 18 + random() * 9;
        planets.push({ id: index, x, y, radius, captureRadius: 105 });
        rings.push({ id: index, x: index === 1 ? 64 : (previousX + x) * 0.5 + (random() - 0.5) * 24,
          y: y - 65, collected: false });
        if (index > 3) {
          const side = (previousX + x) > 0 ? -1 : 1;
          asteroids.push({ id: index, x: side * (122 + random() * 35),
            y: y - 65 + random() * 12, radius: 10 + random() * 7, destroyed: false });
          if (index % 5 === 0) {
            asteroids.push({ id: index + 100, x: -side * 166, y: y - 95, radius: 12, destroyed: false });
          }
        }
        previousX = x;
      }
      this._powerOrder = ['shield', 'magnet', 'echo'];
      for (let index = this._powerOrder.length - 1; index > 0; index -= 1) {
        const other = Math.floor(random() * (index + 1));
        [this._powerOrder[index], this._powerOrder[other]] = [this._powerOrder[other], this._powerOrder[index]];
      }
      const angle = -0.15;
      this.state = {
        phase: 'running', reason: '', elapsed: 0, distance: 0, score: 0,
        combo: 0, bestCombo: 0, rewindAvailable: true, captureCount: 0,
        ship: { x: Math.cos(angle) * 53, y: Math.sin(angle) * 53,
          vx: -Math.sin(angle) * 90.1, vy: Math.cos(angle) * 90.1,
          angle: angle + Math.PI / 2, orbitId: 0, orbitAngle: angle,
          orbitDirection: 1, orbitRadius: 53 },
        planets, rings, asteroids, blackHoleY: -330, trail: [], targetId: null,
        powers: { shield: 0, magnetUntil: 0, echoUntil: 0 },
        effect: { id: 0, type: 'ready', text: '按住绕行, 松开弹射' }
      };
      this._wasHolding = true;
      this._captureArmed = false;
      this._lastPlanet = -1;
      this._cooldownUntil = 0;
      this._lastCapture = -Infinity;
      this._visited = new Set([0]);
      this._grazed = new Set();
      this._highestY = 0;
      this._invincibleUntil = 0;
      this._rewindUsed = false;
      this._history = [];
      this._historyClock = 0;
      this._trailClock = 0;
      this._effectId = 0;
      this._remember();
      return this.state;
    }

    getState() { return this.state; }

    snapshot() {
      const state = this.state;
      return { elapsed: state.elapsed, x: state.ship.x, y: state.ship.y,
        angle: state.ship.angle, score: state.score, distance: state.distance, phase: state.phase };
    }

    _emit(type, text) {
      this.state.effect = { id: ++this._effectId, type, text };
    }

    _remember() {
      this._history.push({ state: clone(this.state), visited: [...this._visited], grazed: [...this._grazed],
        lastPlanet: this._lastPlanet, cooldownUntil: this._cooldownUntil,
        lastCapture: Number.isFinite(this._lastCapture) ? this._lastCapture : -999,
        highestY: this._highestY, invincibleUntil: this._invincibleUntil });
      const cutoff = this.state.elapsed - 2.3;
      while (this._history.length > 1 && this._history[1].state.elapsed < cutoff) this._history.shift();
    }

    rewind() {
      if (this._rewindUsed || this.state.elapsed < 0.3 || !this._history.length) return false;
      const targetTime = Math.max(0, this.state.elapsed - 2);
      let previous = this._history[0];
      for (const entry of this._history) {
        if (entry.state.elapsed > targetTime) break;
        previous = entry;
      }
      this.state = clone(previous.state);
      this.state.phase = 'running';
      this.state.reason = '';
      this.state.rewindAvailable = false;
      this._visited = new Set(previous.visited);
      this._grazed = new Set(previous.grazed);
      this._lastPlanet = previous.lastPlanet;
      this._cooldownUntil = previous.cooldownUntil;
      this._lastCapture = previous.lastCapture;
      this._highestY = previous.highestY;
      this._invincibleUntil = previous.invincibleUntil;
      this._rewindUsed = true;
      this._wasHolding = this.state.ship.orbitId !== null;
      this._captureArmed = false;
      this._history = [];
      this._historyClock = 0;
      this._emit('rewind', '时间倒回, 换个角度');
      this._remember();
      return true;
    }

    _launch() {
      const state = this.state;
      const ship = state.ship;
      const speed = 170 + Math.min(state.combo, 8) * 5;
      ship.vx = -Math.sin(ship.orbitAngle) * ship.orbitDirection * speed;
      ship.vy = Math.cos(ship.orbitAngle) * ship.orbitDirection * speed;
      ship.angle = Math.atan2(ship.vy, ship.vx);
      this._lastPlanet = ship.orbitId;
      this._cooldownUntil = state.elapsed + 0.7;
      ship.orbitId = null;
    }

    _target() {
      const state = this.state;
      const ship = state.ship;
      if (ship.orbitId !== null) return null;
      let nearest = null;
      let minimum = Infinity;
      for (const planet of state.planets) {
        if (planet.id === this._lastPlanet && state.elapsed < this._cooldownUntil) continue;
        const distance = Math.hypot(ship.x - planet.x, ship.y - planet.y);
        const range = planet.captureRadius * (state.powers.magnetUntil > state.elapsed ? 1.4 : 1);
        if (distance <= range && distance < minimum) {
          minimum = distance;
          nearest = planet;
        }
      }
      return nearest;
    }

    _capture(planet) {
      const state = this.state;
      const ship = state.ship;
      const dx = ship.x - planet.x;
      const dy = ship.y - planet.y;
      ship.orbitId = planet.id;
      ship.orbitAngle = Math.atan2(dy, dx);
      ship.orbitRadius = Math.max(planet.radius + 12, Math.hypot(dx, dy));
      ship.orbitDirection = dx * ship.vy - dy * ship.vx >= 0 ? 1 : -1;
      this._captureArmed = false;
      if (!this._visited.has(planet.id)) {
        this._visited.add(planet.id);
        state.captureCount += 1;
        state.combo = state.elapsed - this._lastCapture <= 4.5 ? state.combo + 1 : 1;
        state.bestCombo = Math.max(state.bestCombo, state.combo);
        state.score += 20 + state.combo * 10;
        this._lastCapture = state.elapsed;
        this._emit('capture', state.combo > 1 ? `精准弹射 x${state.combo}` : '引力锁定');
        if (state.captureCount % 4 === 0) {
          const power = this._powerOrder[(state.captureCount / 4 - 1) % 3];
          if (power === 'shield') state.powers.shield = 1;
          if (power === 'magnet') state.powers.magnetUntil = state.elapsed + 12;
          if (power === 'echo') state.powers.echoUntil = state.elapsed + 12;
          this._emit(power, { shield: '获得护盾: 抵挡一次撞击', magnet: '引力扩张: 抓取范围增加', echo: '信号分身: 自动收集附近信号' }[power]);
        }
      }
    }

    _lose(reason) {
      this.state.phase = 'lost';
      this.state.reason = reason;
      this._emit('crash', reason === 'black-hole' ? '被黑洞追上了' : '撞上了陨石');
    }

    step(dt, holding = false) {
      const state = this.state;
      if (state.phase !== 'running' || !Number.isFinite(dt) || dt <= 0) return state;
      const duration = Math.min(dt, 0.1);
      const pressed = Boolean(holding);
      if (pressed && !this._wasHolding) this._captureArmed = true;
      if (!pressed) {
        this._captureArmed = false;
        if (state.ship.orbitId !== null) this._launch();
      }
      this._wasHolding = pressed;
      const iterations = Math.ceil(duration * 120);
      const delta = duration / iterations;
      for (let index = 0; index < iterations && state.phase === 'running'; index += 1) {
        this._advance(delta, pressed);
      }
      return state;
    }

    _advance(dt, holding) {
      const state = this.state;
      const ship = state.ship;
      state.elapsed += dt;
      const target = this._target();
      if (holding && this._captureArmed && target) this._capture(target);
      if (ship.orbitId !== null) {
        const planet = state.planets.find((entry) => entry.id === ship.orbitId);
        const oldX = ship.x;
        const oldY = ship.y;
        ship.orbitAngle = (ship.orbitAngle + ship.orbitDirection * 1.7 * dt) % TAU;
        ship.orbitRadius += (planet.radius + 31 - ship.orbitRadius) * (1 - Math.exp(-dt * 5));
        ship.x = planet.x + Math.cos(ship.orbitAngle) * ship.orbitRadius;
        ship.y = planet.y + Math.sin(ship.orbitAngle) * ship.orbitRadius;
        ship.vx = (ship.x - oldX) / dt;
        ship.vy = (ship.y - oldY) / dt;
      } else {
        const speed = Math.hypot(ship.vx, ship.vy);
        if (speed > 42) {
          const drag = Math.max(42, speed * Math.exp(-dt * 0.36)) / speed;
          ship.vx *= drag;
          ship.vy *= drag;
        }
        ship.x += ship.vx * dt;
        ship.y += ship.vy * dt;
        if (Math.abs(ship.x) > 176) {
          ship.x = Math.sign(ship.x) * 176;
          ship.vx *= -1;
        }
      }
      ship.angle = Math.atan2(ship.vy, ship.vx);
      this._highestY = Math.max(this._highestY, ship.y);
      state.distance = Math.floor(this._highestY);
      state.blackHoleY = Math.max(-330 + state.elapsed * (27 + state.elapsed * 0.4), this._highestY - 420);
      if (state.elapsed - this._lastCapture > 4.5) state.combo = 0;

      const collectionRadius = state.powers.echoUntil > state.elapsed ? 82 : 19;
      for (const ring of state.rings) {
        if (!ring.collected && Math.hypot(ship.x - ring.x, ship.y - ring.y) < collectionRadius) {
          ring.collected = true;
          const bonus = 35 * Math.max(1, state.combo);
          state.score += bonus;
          this._emit('ring', `信号 +${bonus}`);
        }
      }
      const clearance = ship.y - state.blackHoleY;
      const band = Math.floor(this._highestY / 200);
      if (clearance > 24 && clearance < 76 && !this._grazed.has(band)) {
        this._grazed.add(band);
        state.score += 100;
        this._emit('graze', '黑洞擦边 +100');
      }
      for (const asteroid of state.asteroids) {
        if (asteroid.destroyed || state.elapsed < this._invincibleUntil) continue;
        if (Math.hypot(ship.x - asteroid.x, ship.y - asteroid.y) < asteroid.radius + 5) {
          if (state.powers.shield) {
            state.powers.shield = 0;
            asteroid.destroyed = true;
            this._invincibleUntil = state.elapsed + 0.7;
            this._emit('shield-break', '护盾挡住了撞击');
          } else this._lose('asteroid');
          break;
        }
      }
      if (state.phase === 'running' && clearance < 19) this._lose('black-hole');
      if (state.phase === 'running' && state.elapsed >= 75) {
        state.elapsed = 75;
        state.phase = 'won';
        state.score += 500;
        this._emit('win', '逃逸成功 +500');
      }
      const nearest = this._target();
      state.targetId = nearest ? nearest.id : null;
      this._trailClock += dt;
      this._historyClock += dt;
      if (this._trailClock >= 1 / 30) {
        this._trailClock %= 1 / 30;
        state.trail.push({ x: ship.x, y: ship.y });
        if (state.trail.length > 42) state.trail.shift();
      }
      if (this._historyClock >= 1 / 30 && state.phase === 'running') {
        this._historyClock %= 1 / 30;
        this._remember();
      }
    }
  }

  return OrbitEngine;
});
