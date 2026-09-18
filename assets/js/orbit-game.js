(function () {
  'use strict';

  var lab = document.getElementById('orbit-lab');
  if (!lab || typeof window.OrbitEngine !== 'function') return;

  var $ = function (selector) { return document.querySelector(selector); };
  var canvas = $('#orbit-canvas');
  var context = canvas && canvas.getContext('2d');
  if (!canvas || !context) return;

  var intro = $('#orbit-intro');
  var overlay = $('#orbit-overlay');
  var startButton = $('#orbit-start');
  var retryButton = $('#orbit-retry');
  var resumeButton = $('#orbit-resume');
  var grabButton = $('#orbit-grab');
  var rewindButton = $('#orbit-rewind');
  var pauseButton = $('#orbit-pause');
  var closeButton = $('#orbit-close');
  var calmInput = $('#orbit-calm');
  var status = $('#orbit-status');
  var hint = $('#orbit-flight-hint');
  var scoreNode = $('#orbit-score');
  var comboNode = $('#orbit-combo');
  var distanceNode = $('#orbit-distance');
  var timeNode = $('#orbit-time');
  var bestNode = $('#orbit-best');
  var resultCode = $('#orbit-result-code');
  var resultTitle = $('#orbit-result-title');
  var resultCopy = $('#orbit-result-copy');
  var dpr = 1;
  var width = 0;
  var height = 0;
  var cameraY = 90;
  var cameraTarget = 90;
  var raf = 0;
  var lastFrame = 0;
  var mode = 'idle';
  var engine = null;
  var seed = 0;
  var pointerHeld = false;
  var keyboardHeld = false;
  var pointerId = null;
  var ghost = [];
  var ghostClock = -1;
  var lastEffectId = -1;
  var lastHud = '';
  var activeScrollTop = 0;
  var ignoreScrollUntil = 0;
  var storageKey = 'ziwei-orbit-best-v1';
  var record = readRecord();
  var calm = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var stars = [];
  var randomSeed = function () {
    if (window.crypto && window.crypto.getRandomValues) {
      var values = new Uint32Array(1);
      window.crypto.getRandomValues(values);
      return values[0] >>> 0;
    }
    return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  };

  function readRecord() {
    try {
      var value = JSON.parse(window.localStorage.getItem(storageKey) || 'null');
      if (!value || !Number.isFinite(value.score) || !Number.isFinite(value.seed) || !Array.isArray(value.ghost)) return null;
      value.ghost = value.ghost.filter(function (point) {
        return point && Number.isFinite(point.elapsed) && Number.isFinite(point.x) && Number.isFinite(point.y);
      }).slice(-900);
      return value;
    } catch (error) {
      return null;
    }
  }

  function formatScore(value) { return String(Math.max(0, Math.floor(value || 0))).padStart(4, '0'); }

  function updateBest() {
    if (bestNode) bestNode.textContent = formatScore(record ? record.score : 0);
  }

  function saveRecord(state) {
    if (!state || !Number.isFinite(state.score)) return;
    var candidate = { score: Math.floor(state.score), seed: seed, distance: Math.floor(state.distance || 0), ghost: ghost.slice(-900) };
    if (!record || candidate.score >= record.score) {
      record = candidate;
      try { window.localStorage.setItem(storageKey, JSON.stringify(candidate)); } catch (error) { /* storage is optional */ }
      updateBest();
    }
  }

  function makeStars() {
    var value = 0x5a17;
    for (var index = 0; index < 190; index += 1) {
      value = (value * 1664525 + 1013904223) >>> 0;
      stars.push({ x: ((value / 4294967296) - 0.5) * 620, y: ((value * 0.0000001) % 1) * 1700 - 500, size: 0.45 + ((value >>> 8) % 100) / 180, alpha: 0.2 + ((value >>> 17) % 100) / 130 });
    }
  }

  function resize() {
    var rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(0.016);
  }

  function worldToScreen(x, y) {
    var viewHeight = Math.max(430, height * 440 / Math.max(1, width));
    var scale = height / viewHeight;
    return { x: width * 0.5 + x * scale, y: height * 0.62 - (y - cameraY) * scale };
  }

  function setMode(next) {
    mode = next;
    lab.dataset.mode = next;
    if (intro) intro.hidden = next !== 'idle';
    if (overlay) overlay.hidden = next !== 'paused' && next !== 'over';
    if (grabButton) grabButton.disabled = next !== 'playing';
    if (pauseButton) pauseButton.disabled = next === 'idle';
    if (closeButton) closeButton.disabled = next === 'idle';
    if (rewindButton) rewindButton.disabled = next !== 'playing' || !engine || !engine.getState().rewindAvailable || engine.getState().elapsed < 2;
    if (startButton) startButton.disabled = next !== 'idle';
    if (next !== 'playing') {
      pointerHeld = false;
      keyboardHeld = false;
      pointerId = null;
      updateGrabVisual();
    }
  }

  function updateGrabVisual() {
    var pressed = pointerHeld || keyboardHeld;
    if (grabButton) grabButton.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  }

  function setStatus(text) {
    if (status && status.textContent !== text) status.textContent = text;
  }

  function announceEffect(state) {
    if (!state || !state.effect || state.effect.id === lastEffectId) return;
    lastEffectId = state.effect.id;
    if (typeof state.effect.text === 'string') setStatus(state.effect.text);
  }

  function updateHud(state) {
    var key = [state.score, state.combo, state.distance, Math.ceil(Math.max(0, 75 - state.elapsed))].join('|');
    if (key === lastHud) return;
    lastHud = key;
    if (scoreNode) scoreNode.textContent = formatScore(state.score);
    if (comboNode) comboNode.textContent = 'x' + Math.max(1, state.combo || 0);
    if (distanceNode) distanceNode.textContent = String(Math.max(0, Math.floor(state.distance || 0)));
    if (timeNode) timeNode.textContent = String(Math.ceil(Math.max(0, 75 - state.elapsed)));
  }

  function updateGhost(state) {
    if (ghostClock < 0 || state.elapsed - ghostClock >= 0.1) {
      ghostClock = state.elapsed;
      ghost.push(engine.snapshot());
      if (ghost.length > 900) ghost.shift();
    }
  }

  function startLoop() {
    if (!raf) {
      lastFrame = performance.now();
      raf = window.requestAnimationFrame(frame);
    }
  }

  function stopLoop() {
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
  }

  function frame(now) {
    raf = 0;
    if (mode !== 'playing' || !engine) return;
    var dt = Math.max(0.001, Math.min(0.05, (now - lastFrame) / 1000 || 0.016));
    lastFrame = now;
    engine.step(dt, pointerHeld || keyboardHeld);
    var state = engine.getState();
    updateHud(state);
    announceEffect(state);
    updateGhost(state);
    updateCamera(state, dt);
    draw(dt);
    if (state.phase !== 'running') finish(state);
    else {
      if (rewindButton) rewindButton.disabled = !state.rewindAvailable || state.elapsed < 2;
      raf = window.requestAnimationFrame(frame);
    }
  }

  function updateCamera(state, dt) {
    cameraTarget = state.ship.y + 70;
    var amount = calm ? 1 : 1 - Math.exp(-dt * 4.2);
    cameraY += (cameraTarget - cameraY) * amount;
  }

  function drawBackground(time) {
    var gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#071014');
    gradient.addColorStop(0.55, '#080d10');
    gradient.addColorStop(1, '#030608');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.save();
    for (var index = 0; index < stars.length; index += 1) {
      var star = stars[index];
      var wrappedY = ((star.y - cameraY * 0.12 + 720) % 1700) - 500;
      var point = worldToScreen(star.x, wrappedY);
      var shimmer = calm ? 1 : 0.8 + Math.sin(time * 0.0013 + index * 0.63) * 0.16;
      context.globalAlpha = Math.max(0.04, star.alpha * shimmer);
      context.fillStyle = index % 11 === 0 ? '#bde7f2' : '#79949e';
      context.fillRect(point.x, point.y, star.size, star.size);
    }
    context.restore();
    context.strokeStyle = 'rgba(134, 177, 186, 0.08)';
    context.lineWidth = 1;
    for (var line = -2; line <= 4; line += 1) {
      var y = worldToScreen(0, cameraY + line * 100).y;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
  }

  function drawBlackHole(state) {
    var point = worldToScreen(0, state.blackHoleY);
    var radius = Math.max(width * 0.38, 120);
    var glow = context.createRadialGradient(point.x, point.y, 3, point.x, point.y, radius);
    glow.addColorStop(0, 'rgba(245, 91, 99, 0.33)');
    glow.addColorStop(0.35, 'rgba(118, 38, 63, 0.16)');
    glow.addColorStop(1, 'rgba(40, 12, 27, 0)');
    context.fillStyle = glow;
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(245, 137, 126, 0.24)';
    context.setLineDash([3, 8]);
    context.beginPath();
    context.arc(point.x, point.y, 32, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = '#020305';
    context.beginPath();
    context.arc(point.x, point.y, 15, 0, Math.PI * 2);
    context.fill();
  }

  function drawGhost() {
    if (!record || record.seed !== seed || !record.ghost || record.ghost.length < 2) return;
    context.save();
    context.strokeStyle = 'rgba(156, 218, 238, 0.18)';
    context.lineWidth = 1;
    context.setLineDash([3, 7]);
    context.beginPath();
    record.ghost.forEach(function (point, index) {
      var screen = worldToScreen(point.x, point.y);
      if (index === 0) context.moveTo(screen.x, screen.y);
      else context.lineTo(screen.x, screen.y);
    });
    context.stroke();
    context.restore();
  }

  function drawRings(state) {
    state.rings.forEach(function (ring) {
      if (ring.collected) return;
      var point = worldToScreen(ring.x, ring.y);
      if (point.y < -60 || point.y > height + 60) return;
      context.save();
      context.translate(point.x, point.y);
      context.rotate(Math.sin(ring.id * 2.4) * 0.4);
      context.strokeStyle = '#f0c677';
      context.globalAlpha = 0.82;
      context.lineWidth = 2;
      context.beginPath();
      context.ellipse(0, 0, 13, 5, 0, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha = 0.22;
      context.lineWidth = 7;
      context.stroke();
      context.restore();
    });
  }

  function drawAsteroids(state) {
    state.asteroids.forEach(function (asteroid) {
      if (asteroid.destroyed) return;
      var point = worldToScreen(asteroid.x, asteroid.y);
      if (point.y < -50 || point.y > height + 50) return;
      context.save();
      context.translate(point.x, point.y);
      context.rotate(asteroid.id * 1.7);
      context.fillStyle = '#8d4a4e';
      context.strokeStyle = '#f5897e';
      context.lineWidth = 1;
      context.beginPath();
      for (var side = 0; side < 7; side += 1) {
        var angle = side / 7 * Math.PI * 2;
        var radius = asteroid.radius * (0.72 + (side % 3) * 0.13);
        var x = Math.cos(angle) * radius;
        var y = Math.sin(angle) * radius;
        if (side === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.closePath();
      context.fill();
      context.stroke();
      context.restore();
    });
  }

  function drawPlanets(state) {
    state.planets.forEach(function (planet) {
      var point = worldToScreen(planet.x, planet.y);
      if (point.y < -80 || point.y > height + 80) return;
      var isTarget = state.targetId === planet.id;
      var isOrbit = state.ship.orbitId === planet.id;
      context.save();
      if (isTarget || isOrbit) {
        context.strokeStyle = isOrbit ? 'rgba(156, 218, 238, 0.64)' : 'rgba(156, 218, 238, 0.34)';
        context.lineWidth = isOrbit ? 1.5 : 1;
        context.setLineDash(isOrbit ? [4, 5] : [2, 6]);
        context.beginPath();
        context.arc(point.x, point.y, planet.captureRadius * (state.powers.magnetUntil > state.elapsed ? 1.4 : 1) * (height / Math.max(430, height * 440 / Math.max(1, width))), 0, Math.PI * 2);
        context.stroke();
        context.setLineDash([]);
      }
      var radius = Math.max(7, planet.radius * height / Math.max(430, height * 440 / Math.max(1, width)));
      var planetGradient = context.createRadialGradient(point.x - radius * 0.35, point.y - radius * 0.4, 1, point.x, point.y, radius * 1.2);
      planetGradient.addColorStop(0, isOrbit ? '#d8f7ff' : '#b7d2d6');
      planetGradient.addColorStop(0.45, isTarget ? '#6d9ba5' : '#36535b');
      planetGradient.addColorStop(1, '#12242a');
      context.fillStyle = planetGradient;
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = isTarget ? '#9cdaee' : 'rgba(156, 218, 238, 0.25)';
      context.stroke();
      context.restore();
    });
  }

  function drawShip(state, time) {
    var ship = state.ship;
    var point = worldToScreen(ship.x, ship.y);
    var scale = height / Math.max(430, height * 440 / Math.max(1, width));
    if (!calm && state.trail && state.trail.length > 1) {
      context.save();
      context.strokeStyle = 'rgba(156, 218, 238, 0.35)';
      context.lineWidth = 1;
      context.beginPath();
      state.trail.forEach(function (trail, index) {
        var trailPoint = worldToScreen(trail.x, trail.y);
        if (index === 0) context.moveTo(trailPoint.x, trailPoint.y); else context.lineTo(trailPoint.x, trailPoint.y);
      });
      context.stroke();
      context.restore();
    }
    if (state.powers.echoUntil > state.elapsed) {
      context.fillStyle = 'rgba(240, 198, 119, 0.55)';
      context.beginPath();
      context.arc(point.x - 16, point.y + 7, 3, 0, Math.PI * 2);
      context.arc(point.x + 16, point.y - 7, 3, 0, Math.PI * 2);
      context.fill();
    }
    context.save();
    context.translate(point.x, point.y);
    context.rotate(ship.angle || 0);
    if (state.powers.shield) {
      context.strokeStyle = 'rgba(240, 198, 119, 0.65)';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(0, 0, 15 * scale + 6, 0, Math.PI * 2);
      context.stroke();
    }
    context.fillStyle = '#f2fbf8';
    context.strokeStyle = '#9cdaee';
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(12 * scale, 0);
    context.lineTo(-8 * scale, -6 * scale);
    context.lineTo(-5 * scale, 0);
    context.lineTo(-8 * scale, 6 * scale);
    context.closePath();
    context.fill();
    context.stroke();
    context.fillStyle = '#f0c677';
    context.fillRect(-9 * scale, -1.5 * scale, 4 * scale, 3 * scale);
    context.restore();
    if (!calm && mode === 'playing') {
      context.globalAlpha = 0.38 + Math.sin(time * 0.009) * 0.16;
      context.strokeStyle = '#9cdaee';
      context.beginPath();
      context.arc(point.x, point.y, 20 + Math.sin(time * 0.007) * 4, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha = 1;
    }
  }

  function drawLaunchGuide(state) {
    if (mode !== 'playing' || !state || state.ship.orbitId === null || !pointerHeld && !keyboardHeld) return;
    var ship = state.ship;
    var origin = worldToScreen(ship.x, ship.y);
    var vx = -Math.sin(ship.orbitAngle) * ship.orbitDirection;
    var vy = Math.cos(ship.orbitAngle) * ship.orbitDirection;
    var destination = worldToScreen(ship.x + vx * 85, ship.y + vy * 85);
    context.strokeStyle = 'rgba(156, 218, 238, 0.65)';
    context.setLineDash([3, 6]);
    context.beginPath();
    context.moveTo(origin.x, origin.y);
    context.lineTo(destination.x, destination.y);
    context.stroke();
    context.setLineDash([]);
  }

  function draw(dt) {
    var state = engine ? engine.getState() : { ship: { x: 0, y: 0, angle: 0 }, planets: [], rings: [], asteroids: [], blackHoleY: -330, trail: [], targetId: null, powers: { shield: 0, magnetUntil: 0, echoUntil: 0 }, elapsed: 0 };
    var now = performance.now();
    context.clearRect(0, 0, width, height);
    drawBackground(now);
    drawBlackHole(state);
    drawGhost();
    drawRings(state);
    drawAsteroids(state);
    drawPlanets(state);
    drawShip(state, now);
    drawLaunchGuide(state);
    if (hint) {
      var text = state.effect && typeof state.effect.text === 'string' ? state.effect.text : '';
      hint.textContent = mode === 'playing' && text ? text : '';
    }
  }

  function startRun(retry) {
    if (!retry || !seed) seed = seed || randomSeed();
    if (!engine) engine = new window.OrbitEngine({ seed: seed });
    else engine.reset(seed);
    ghost = [];
    ghostClock = -1;
    lastEffectId = -1;
    lastHud = '';
    cameraY = 90;
    cameraTarget = 90;
    setMode('playing');
    ignoreScrollUntil = performance.now() + 2000;
    var consoleNode = lab.querySelector('.orbit-console');
    if (consoleNode && consoleNode.scrollIntoView) consoleNode.scrollIntoView({ block: 'start', behavior: 'auto' });
    activeScrollTop = window.scrollY;
    canvas.focus({ preventScroll: true });
    startLoop();
    setStatus('航线已启动. 抓住亮圈, 松手换轨.');
    draw(0.016);
  }

  function finish(state) {
    stopLoop();
    saveRecord(state);
    setMode('over');
    if (state.phase === 'won') {
      resultCode.textContent = 'ESCAPE COMPLETE';
      resultTitle.textContent = '你穿过了黑洞边缘.';
      resultCopy.textContent = '信号 ' + formatScore(state.score) + ' · 航程 ' + Math.floor(state.distance) + ' m';
      setStatus('逃逸成功. 这条航线已经被保存.');
    } else {
      resultCode.textContent = state.reason === 'black-hole' ? 'EVENT HORIZON' : 'IMPACT DETECTED';
      resultTitle.textContent = state.reason === 'black-hole' ? '黑洞追上了你.' : '陨石击中了飞船.';
      resultCopy.textContent = '信号 ' + formatScore(state.score) + ' · 按倒带尝试救回这一局.';
      setStatus(state.effect && state.effect.text ? state.effect.text : '航线中断.');
    }
    retryButton.hidden = false;
    resumeButton.hidden = true;
    if (rewindButton) rewindButton.disabled = !state.rewindAvailable || state.elapsed < 0.3;
    draw(0.016);
  }

  function pauseRun(reason) {
    if (mode !== 'playing' || !engine || engine.getState().phase !== 'running') return;
    stopLoop();
    setMode('paused');
    resultCode.textContent = reason === 'away' ? 'FLIGHT PAUSED' : 'FLIGHT PAUSED';
    resultTitle.textContent = '航线已暂停';
    resultCopy.textContent = reason === 'away' ? '你离开了游戏区域. 准备好后继续.' : '准备好后, 继续出发.';
    retryButton.hidden = true;
    resumeButton.hidden = false;
    setStatus('航线暂停.');
    draw(0.016);
  }

  function resumeRun() {
    if (!engine || mode !== 'paused' || engine.getState().phase !== 'running') return;
    setMode('playing');
    ignoreScrollUntil = performance.now() + 2000;
    activeScrollTop = window.scrollY;
    startLoop();
    setStatus('继续飞行.');
  }

  function closeRun() {
    stopLoop();
    setMode('idle');
    if (engine) engine.reset(seed);
    cameraY = 90;
    cameraTarget = 90;
    retryButton.hidden = true;
    resumeButton.hidden = false;
    setStatus('等待起飞. 最佳成绩与航线只保存在当前浏览器.');
    draw(0.016);
  }

  function toggleHolding(value, event) {
    if (mode !== 'playing') return;
    if (event && event.type === 'pointerdown' && event.button !== undefined && event.button !== 0) return;
    pointerHeld = value;
    if (value && event && event.pointerId !== undefined) pointerId = event.pointerId;
    if (!value) pointerId = null;
    updateGrabVisual();
    if (event && event.cancelable) event.preventDefault();
    if (value) canvas.focus({ preventScroll: true });
  }

  function onPointerDown(event) {
    if (mode !== 'playing') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    toggleHolding(true, event);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (error) { /* optional */ }
  }

  function onPointerUp(event) {
    if (pointerId !== null && event.pointerId !== undefined && event.pointerId !== pointerId) return;
    toggleHolding(false, event);
  }

  function onKeyDown(event) {
    if (!lab.contains(document.activeElement)) return;
    if (event.code === 'Space' || event.key === ' ') {
      event.preventDefault();
      if (mode === 'playing') { keyboardHeld = true; updateGrabVisual(); }
    } else if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      rewindRun();
    } else if (event.key.toLowerCase() === 'p' || event.key === 'Escape') {
      event.preventDefault();
      if (mode === 'playing') pauseRun('manual'); else if (mode === 'paused') resumeRun();
    }
  }

  function onKeyUp(event) {
    if (!lab.contains(document.activeElement)) return;
    if (event.code === 'Space' || event.key === ' ') {
      event.preventDefault();
      keyboardHeld = false;
      updateGrabVisual();
    }
  }

  function rewindRun() {
    if (!engine) return;
    var current = engine.getState();
    var canRecover = mode === 'over' && current.phase === 'lost';
    if ((!canRecover && mode !== 'playing') || !current.rewindAvailable || current.elapsed < 0.3) return;
    if (engine.rewind()) {
      var state = engine.getState();
      ghost = ghost.filter(function (point) { return point.elapsed <= state.elapsed + 0.02; });
      if (canRecover) {
        retryButton.hidden = true;
        resumeButton.hidden = true;
        setMode('playing');
        ignoreScrollUntil = performance.now() + 2000;
        activeScrollTop = window.scrollY;
        startLoop();
      }
      updateHud(state);
      announceEffect(state);
      if (rewindButton) rewindButton.disabled = true;
      setStatus('时间倒回, 换个角度.');
      draw(0.016);
    }
  }

  startButton.addEventListener('click', function () { startRun(false); });
  retryButton.addEventListener('click', function () { startRun(true); });
  resumeButton.addEventListener('click', resumeRun);
  pauseButton.addEventListener('click', function () { if (mode === 'playing') pauseRun('manual'); else if (mode === 'paused') resumeRun(); });
  closeButton.addEventListener('click', closeRun);
  rewindButton.addEventListener('click', rewindRun);
  [canvas, grabButton].forEach(function (node) {
    node.addEventListener('pointerdown', onPointerDown);
    node.addEventListener('pointerup', onPointerUp);
    node.addEventListener('pointercancel', onPointerUp);
    node.addEventListener('lostpointercapture', onPointerUp);
  });
  window.addEventListener('pointerup', onPointerUp, { passive: false });
  window.addEventListener('pointercancel', onPointerUp, { passive: false });
  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp, { passive: false });
  window.addEventListener('blur', function () { if (mode === 'playing') pauseRun('away'); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && mode === 'playing') pauseRun('away'); });
  window.addEventListener('scroll', function () {
    if (mode === 'playing' && performance.now() > ignoreScrollUntil && Math.abs(window.scrollY - activeScrollTop) > 80) pauseRun('away');
  }, { passive: true });
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      if (entries[0] && !entries[0].isIntersecting && mode === 'playing') pauseRun('away');
    }, { threshold: 0.08 });
    observer.observe(lab);
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', stopLoop);
  window.addEventListener('pageshow', function (event) { if (event.persisted) { draw(0.016); if (mode === 'playing') pauseRun('away'); } });
  if (calmInput) {
    calmInput.checked = calm;
    lab.dataset.calm = calm ? 'true' : 'false';
    calmInput.addEventListener('change', function () { calm = calmInput.checked; lab.dataset.calm = calm ? 'true' : 'false'; draw(0.016); });
  }

  makeStars();
  seed = randomSeed();
  updateBest();
  resize();
  startButton.disabled = false;
  setMode('idle');
}());
