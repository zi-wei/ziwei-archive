(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var INTRO_DURATION = 5000;

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function lerp(start, end, amount) {
    return start + (end - start) * amount;
  }

  function smootherstep(value) {
    var t = clamp(value, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function createRandom(seed) {
    var value = seed >>> 0;
    return function () {
      value += 0x6d2b79f5;
      var result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  function AppleStarfield(canvas, imageUrl) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    this.imageUrl = imageUrl;
    this.source = null;
    this.targetPoints = [];
    this.particles = [];
    this.frame = 0;
    this.introStart = 0;
    this.visible = true;
    this.destroyed = false;
    this.pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
    this.scrollY = window.scrollY || 0;
    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.pointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    this.reduceMotion = this.motionQuery.matches;
    this.boundResize = this.resize.bind(this);
    this.boundPointer = this.onPointer.bind(this);
    this.boundScroll = this.onScroll.bind(this);
    this.boundVisibility = this.onVisibility.bind(this);
    this.boundMotion = this.onMotionChange.bind(this);
    this.observer = null;
  }

  AppleStarfield.prototype.start = function () {
    var self = this;
    this.resize();
    window.addEventListener('resize', this.boundResize, { passive: true });
    window.addEventListener('pointermove', this.boundPointer, { passive: true });
    window.addEventListener('scroll', this.boundScroll, { passive: true });
    document.addEventListener('visibilitychange', this.boundVisibility);
    if (this.motionQuery.addEventListener) {
      this.motionQuery.addEventListener('change', this.boundMotion);
    }
    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver(function (entries) {
        self.visible = entries[0] ? entries[0].isIntersecting : true;
      }, { rootMargin: '120px 0px' });
      this.observer.observe(this.canvas);
    }

    var image = new Image();
    image.decoding = 'async';
    image.src = this.imageUrl || '';
    image.onload = function () {
      if (self.destroyed) return;
      self.source = image;
      self.targetPoints = self.extractTargetPoints(image);
      self.createParticles();
      self.introStart = performance.now();
      if (self.reduceMotion) {
        self.drawFrame(self.introStart + INTRO_DURATION);
        self.canvas.dataset.ready = 'true';
      } else {
        self.animate();
      }
    };
    image.onerror = function () {
      if (self.destroyed) return;
      self.targetPoints = self.createFallbackTargets();
      self.createParticles();
      self.introStart = performance.now();
      if (self.reduceMotion) {
        self.drawFrame(self.introStart + INTRO_DURATION);
        self.canvas.dataset.ready = 'true';
      } else {
        self.animate();
      }
    };
  };

  AppleStarfield.prototype.extractTargetPoints = function (image) {
    var size = 240;
    var probe = document.createElement('canvas');
    probe.width = size;
    probe.height = size;
    var context = probe.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, size, size);
    var pixels = context.getImageData(0, 0, size, size).data;
    var minX = size;
    var minY = size;
    var maxX = 0;
    var maxY = 0;
    var x;
    var y;

    for (y = 0; y < size; y += 1) {
      for (x = 0; x < size; x += 1) {
        var boundIndex = (y * size + x) * 4;
        var boundLuminance = (
          pixels[boundIndex]
          + pixels[boundIndex + 1]
          + pixels[boundIndex + 2]
        ) / 3;
        if (boundLuminance < 150) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (minX >= maxX || minY >= maxY) return this.createFallbackTargets();

    var cropWidth = maxX - minX + 1;
    var cropHeight = maxY - minY + 1;
    var centerX = (minX + maxX) / 2;
    var centerY = (minY + maxY) / 2;
    var points = [];
    for (y = minY; y <= maxY; y += 1) {
      for (x = minX; x <= maxX; x += 1) {
        var index = (y * size + x) * 4;
        var luminance = (
          pixels[index] * 0.299
          + pixels[index + 1] * 0.587
          + pixels[index + 2] * 0.114
        );
        if (luminance < 128) {
          points.push({
            x: (x - centerX) / cropWidth,
            y: (y - centerY) / cropWidth,
            edge: (
              x === minX
              || x === maxX
              || y === minY
              || y === maxY
              || this.isLightPixel(pixels, size, x - 1, y)
              || this.isLightPixel(pixels, size, x + 1, y)
              || this.isLightPixel(pixels, size, x, y - 1)
              || this.isLightPixel(pixels, size, x, y + 1)
            ),
          });
        }
      }
    }

    return points.length > 100 ? points : this.createFallbackTargets(cropHeight / cropWidth);
  };

  AppleStarfield.prototype.isLightPixel = function (pixels, size, x, y) {
    if (x < 0 || x >= size || y < 0 || y >= size) return true;
    var index = (y * size + x) * 4;
    return (
      pixels[index] * 0.299
      + pixels[index + 1] * 0.587
      + pixels[index + 2] * 0.114
    ) >= 128;
  };

  AppleStarfield.prototype.createFallbackTargets = function () {
    var points = [];
    for (var y = -58; y <= 58; y += 2) {
      for (var x = -52; x <= 52; x += 2) {
        var normalizedX = x / 52;
        var normalizedY = y / 58;
        var body = normalizedX * normalizedX + normalizedY * normalizedY < 1;
        var stem = x > -12 && x < -5 && y > -76 && y < -50;
        if (body || stem) {
          points.push({ x: x / 110, y: y / 110, edge: false });
        }
      }
    }
    return points;
  };

  AppleStarfield.prototype.createParticles = function () {
    var random = createRandom(1741);
    var cssWidth = this.canvas.width / this.pixelRatio;
    var count = cssWidth < 600 ? 2100 : 3600;
    var points = this.targetPoints;
    this.particles = [];

    for (var index = 0; index < count; index += 1) {
      var point = points[Math.floor(random() * points.length)];
      var highlight = random() < (point.edge ? 0.16 : 0.055);
      var colorSeed = random();
      this.particles.push({
        targetX: point.x + (random() - 0.5) * 0.008,
        targetY: point.y + (random() - 0.5) * 0.008,
        scatterX: random(),
        scatterY: random(),
        size: highlight ? 1.25 + random() * 1.8 : 0.45 + random() * 0.9,
        alpha: highlight ? 0.72 + random() * 0.24 : 0.28 + random() * 0.5,
        delay: 0.08 + random() * 0.24,
        duration: 0.56 + random() * 0.16,
        arc: 0.32 + random() * 0.3,
        phase: random() * TAU,
        speed: 0.35 + random() * 0.55,
        background: random() < 0.085,
        highlight: highlight,
        color: colorSeed < 0.045
          ? '80,232,154'
          : colorSeed < 0.11
            ? '148,190,230'
            : '232,232,228',
      });
    }
  };

  AppleStarfield.prototype.resize = function () {
    if (!this.context) return;
    var rect = this.canvas.getBoundingClientRect();
    var nextRatio = Math.min(window.devicePixelRatio || 1, 1.6);
    var width = Math.max(1, Math.floor(rect.width * nextRatio));
    var height = Math.max(1, Math.floor(rect.height * nextRatio));
    var crossedBreakpoint = Boolean(this.pixelRatio)
      && ((this.canvas.width / this.pixelRatio < 600) !== (rect.width < 600));
    this.pixelRatio = nextRatio;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    if (crossedBreakpoint && this.targetPoints.length) this.createParticles();
    if (this.targetPoints.length) {
      this.drawFrame(this.reduceMotion ? this.introStart + INTRO_DURATION : performance.now());
    }
  };

  AppleStarfield.prototype.onPointer = function (event) {
    if (this.reduceMotion || !this.pointerQuery.matches) return;
    var rect = this.canvas.getBoundingClientRect();
    this.pointer.targetX = clamp((event.clientX - rect.left) / rect.width - 0.5, -0.5, 0.5) * 22;
    this.pointer.targetY = clamp((event.clientY - rect.top) / rect.height - 0.5, -0.5, 0.5) * 14;
  };

  AppleStarfield.prototype.onScroll = function () {
    this.scrollY = window.scrollY || 0;
  };

  AppleStarfield.prototype.onVisibility = function () {
    this.visible = !document.hidden;
  };

  AppleStarfield.prototype.onMotionChange = function (event) {
    this.reduceMotion = event.matches;
    this.pointer.targetX = 0;
    this.pointer.targetY = 0;
    if (this.reduceMotion) {
      this.drawFrame(this.introStart + INTRO_DURATION);
    } else if (this.particles.length) {
      this.animate();
    }
  };

  AppleStarfield.prototype.animate = function () {
    var self = this;
    if (this.destroyed || this.reduceMotion) return;
    this.frame = requestAnimationFrame(function (time) {
      if (self.visible && !document.hidden) self.drawFrame(time);
      self.animate();
    });
  };

  AppleStarfield.prototype.drawFrame = function (time) {
    if (!this.context || !this.particles.length) return;
    var ratio = this.pixelRatio || 1;
    var cssWidth = this.canvas.width / ratio;
    var cssHeight = this.canvas.height / ratio;
    var context = this.context;
    var elapsed = Math.max(0, time - this.introStart);
    var introProgress = this.reduceMotion ? 1 : clamp(elapsed / INTRO_DURATION, 0, 1);
    var scrollStart = cssHeight * 0.16;
    var scrollScatter = this.reduceMotion
      ? smootherstep(clamp((this.scrollY - scrollStart) / (cssHeight * 0.72), 0, 1))
      : smootherstep(clamp((this.scrollY - scrollStart) / (cssHeight * 0.72), 0, 1));
    var targetWidth = Math.min(
      cssWidth * (cssWidth < 600 ? 0.78 : 0.49),
      cssHeight * (cssWidth < 600 ? 0.42 : 0.58),
    );
    var centerX = cssWidth * 0.5;
    var centerY = cssHeight * (cssWidth < 600 ? 0.47 : 0.46);

    this.pointer.x += (this.pointer.targetX - this.pointer.x) * 0.055;
    this.pointer.y += (this.pointer.targetY - this.pointer.y) * 0.055;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#080909';
    context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    context.scale(ratio, ratio);
    context.globalCompositeOperation = 'lighter';

    for (var index = 0; index < this.particles.length; index += 1) {
      var particle = this.particles[index];
      var local = clamp(
        (introProgress - particle.delay) / particle.duration,
        0,
        1,
      );
      var smoothPull = smootherstep(local);
      var pull = (smoothPull + Math.sin(smoothPull * Math.PI * 0.5)) * 0.5;
      if (particle.background) pull = 0;

      var scatterX = particle.scatterX * cssWidth;
      var scatterY = particle.scatterY * cssHeight;
      var deltaX = scatterX - centerX;
      var deltaY = scatterY - centerY;
      var angle = Math.sin(pull * Math.PI) * particle.arc;
      var rotatedX = centerX + deltaX * Math.cos(angle) - deltaY * Math.sin(angle);
      var rotatedY = centerY + deltaX * Math.sin(angle) + deltaY * Math.cos(angle);
      var targetX = centerX + particle.targetX * targetWidth + this.pointer.x;
      var targetY = centerY + particle.targetY * targetWidth + this.pointer.y;
      var formedX = lerp(rotatedX, targetX, pull);
      var formedY = lerp(rotatedY, targetY, pull);
      var x = lerp(formedX, scatterX, scrollScatter);
      var y = lerp(formedY, scatterY, scrollScatter);

      var reveal = particle.background
        ? 0.35
        : smootherstep(clamp(introProgress * 5 - particle.delay * 2, 0, 1));
      var twinkle = 0.84 + Math.sin(time * 0.001 * particle.speed + particle.phase) * 0.16;
      var alpha = particle.alpha * reveal * twinkle * (1 - scrollScatter * 0.55);
      var size = particle.size * (0.72 + pull * 0.36);
      context.fillStyle = 'rgba(' + particle.color + ',' + alpha.toFixed(3) + ')';

      if (size < 1.15) {
        context.fillRect(x, y, 1, 1);
      } else {
        context.beginPath();
        context.arc(x, y, size, 0, TAU);
        context.fill();
        if (particle.highlight && size > 1.8) {
          context.fillRect(x - size * 2.4, y - 0.35, size * 4.8, 0.7);
          context.fillRect(x - 0.35, y - size * 2.4, 0.7, size * 4.8);
        }
      }
    }

    context.globalCompositeOperation = 'source-over';
    if (this.reduceMotion || elapsed >= 750) this.canvas.dataset.ready = 'true';
    if (introProgress >= 1) this.canvas.dataset.formation = 'complete';
  };

  AppleStarfield.prototype.destroy = function () {
    this.destroyed = true;
    window.removeEventListener('resize', this.boundResize);
    window.removeEventListener('pointermove', this.boundPointer);
    window.removeEventListener('scroll', this.boundScroll);
    document.removeEventListener('visibilitychange', this.boundVisibility);
    if (this.motionQuery.removeEventListener) {
      this.motionQuery.removeEventListener('change', this.boundMotion);
    }
    if (this.observer) this.observer.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
  };

  window.AppleStarfield = AppleStarfield;
}());
