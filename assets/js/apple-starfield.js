(function () {
  'use strict';

  // OpenAI Astra archived shaders, captured 2026-09-04.
  // 1rfzm7jt1igp4.pretty:26-73, 886-917, 1681-1704: extracted GLSL helpers/core.
  // 0kyg3mclnp-m6.pretty:127-225: scroll damping, tilt, orthographic layout.
  // Apple geometry, native WebGL and compact bloom: personal-site adaptations.
  // Provenance and intentional differences: docs/starfield-rebuild.md.
  var STAR_VERTEX = `precision highp float;
attribute vec3 aTarget;
attribute vec4 aSeed;
attribute vec4 aStar;
attribute vec3 aColor;
uniform vec2 uWorld;
uniform vec2 uPointer;
uniform float uAppleSize;
uniform float uCenter;
uniform float uTime;
uniform float uIntro;
uniform float uReveal;
uniform float uScatter;
uniform float uPosition;
uniform float uTilt;
uniform float uSizeScale;
uniform float uPixelRatio;
uniform float uTextEdge;
uniform float uScrollDrift;
uniform float uMaxPointSize;
varying float vBrightness;
varying vec3 vColor;
varying float vLens;
varying float vOpacity;
varying float vRayStrength;
varying float vParticleDiameter;
  vec3 astraIntroMotion(
    vec3 position, vec3 scattered, float progress,
    float seed, float travelSeed
  ) {
    if (progress >= 1.0) return position;
    float start = 0.14 + seed * 0.18;
    float duration = 0.58 + travelSeed * 0.1;
    float local = clamp((progress - start) / duration, 0.0, 1.0);
    float smoothPull = local * local * local * (local * (local * 6.0 - 15.0) + 10.0);
    float pull = mix(smoothPull, sin(smoothPull * 3.14159265359 * 0.5), 0.5);
    float angle = sin(pull * 3.14159265359) * (0.44 + seed * 0.22);
    float c = cos(angle);
    float s = sin(angle);
    vec3 orbiting = vec3(
      scattered.x * c - scattered.y * s,
      scattered.x * s + scattered.y * c,
      scattered.z
    );
    return mix(orbiting, position, pull);
  }

  vec2 astraDispersedMotion(
    float time,
    float scatterX,
    float scatterY,
    float scatterZ,
    float scrollDrift,
    float strength
  ) {
    float depth = clamp(scatterZ, 0.0, 1.0);
    float motion = clamp(strength, 0.0, 1.0);
    float speed = mix(
      0.4,
      0.8,
      depth
    );
    float amount = mix(
      0.035,
      0.12,
      depth
    ) * motion;
    float phaseX = scatterX * 6.28318530718 + scatterY * 2.7;
    float phaseY = scatterY * 6.28318530718 + scatterZ * 3.1;
    float parallax = scrollDrift * mix(
      0.08,
      0.28,
      depth * depth
    ) * motion;

    return vec2(
      (sin(phaseX + time * speed) - sin(phaseX)) * amount,
      (cos(phaseY + time * speed * 0.73) - cos(phaseY)) * amount
        + parallax
    );
  }

void main() {
  float background = step(0.88, aSeed.w);
  vec2 span = uWorld * 1.12;
  float side = aSeed.x < 0.5 ? -1.0 : 1.0;
  float outerX = side * mix(uTextEdge, span.x * 0.5, sqrt(fract(aSeed.x * 2.0)));
  float center = uCenter * (1.0 - uPosition);
  vec3 scattered = vec3(
    mix(outerX, (aSeed.x - 0.5) * span.x, step(0.72, aStar.w)),
    (aSeed.y - 0.5) * span.y - center,
    (aSeed.z - 0.5) * 0.5
  );
  vec2 drift = astraDispersedMotion(uTime, aSeed.x, aSeed.y, aSeed.z, uScrollDrift, 1.0);
  // Bounded motion keeps interpolated destinations continuous at screen edges.
  scattered.xy += drift;
  scattered.y -= sin(uPosition * 3.14159265359) * (0.15 + aSeed.z * 0.25);
  vec3 opening = vec3((aSeed.xy - 0.5) * span, (aSeed.z - 0.5) * 0.5);
  opening.y -= center;
  opening.xy += drift;
  vec3 target = aTarget * uAppleSize;
  float alive = (1.0 - uScatter) * smoothstep(0.55, 1.0, uIntro);
  target.xy += vec2(sin(uTime * 0.4 + aSeed.y * 6.283185), cos(uTime * 0.3 + aSeed.x * 6.283185)) * 0.012 * alive;
  target = mix(target, opening, background);
  target = mix(target, scattered, uPosition);
  vec3 position = astraIntroMotion(target, opening, mix(uIntro, 1.0, background), aSeed.z, aSeed.y);
  float ct = cos(uTilt);
  float st = sin(uTilt);
  position.yz = vec2(position.y * ct - position.z * st, position.y * st + position.z * ct);
  position.xy += uPointer * (0.06 + aSeed.z * 0.1) * (1.0 - uPosition);
  position.y += center;
  gl_Position = vec4(position.xy * 2.0 / uWorld, -position.z / 20.0, 1.0);
  float twinkle = 0.86 + 0.14 * sin(aSeed.x * 6.283185 + uTime * (0.65 + aSeed.y * 0.7));
  float delay = aSeed.z * 0.015;
  float reveal = smoothstep(delay, 0.14 + delay, uReveal)
    * mix(0.2, 1.0, smoothstep(0.2, 1.0, uReveal));
  reveal = mix(reveal, min(reveal, 0.2), background * (1.0 - uScatter));
  vBrightness = aStar.y * twinkle * mix(1.0, 0.18, uScatter);
  vOpacity = aStar.z * (0.92 + twinkle * 0.08) * smoothstep(0.0, 0.2, reveal);
  vRayStrength = smoothstep(1.45, 2.8, aStar.y);
  vColor = aColor;
  vLens = 0.0;
  float sizeScale = mix(uSizeScale, 1.0, background * (1.0 - uScatter));
  vParticleDiameter = min(uMaxPointSize, uPixelRatio * (0.35 + aStar.x * 3.8)
    * (0.97 + twinkle * 0.03) * sizeScale * sqrt(reveal));
  gl_PointSize = max(vParticleDiameter, 4.0);
}`;
  var STAR_FRAGMENT = `precision highp float;

  varying float vBrightness;
  varying vec3 vColor;
  varying float vLens;
  varying float vOpacity;
  varying float vRayStrength;
    varying float vParticleDiameter;
  float astraCubicCoverage(float coordinate) {
    float x = abs(coordinate);
    if (x < 1.0) return (4.0 - 6.0 * x * x + 3.0 * x * x * x) / 6.0;
    float tail = max(2.0 - x, 0.0);
    return tail * tail * tail / 6.0;
  }
  float astraFilteredCore(vec2 pixel, float area) {
    return astraCubicCoverage(pixel.x) * astraCubicCoverage(pixel.y)
      * area * vParticleDiameter * vParticleDiameter;
  }


  void main() {
    vec2 pixel = (gl_PointCoord - vec2(0.5)) * max(vParticleDiameter, 4.0);
    vec2 point = pixel * 2.0 / max(vParticleDiameter, 0.0001);
    float distanceToCenter = length(point);
    float disc = 1.0 - smoothstep(0.08, 1.0, distanceToCenter);
    float core = pow(disc, 2.2);
    float horizontalRay = exp(-abs(point.y) * 28.0)
      * (1.0 - smoothstep(0.18, 1.0, abs(point.x)));
    float verticalRay = exp(-abs(point.x) * 28.0)
      * (1.0 - smoothstep(0.18, 1.0, abs(point.y)));
    float rays = max(horizontalRay, verticalRay) * 0.28 * vRayStrength;
    float resolved = smoothstep(2.0, 4.0, vParticleDiameter);
    float alpha = mix(astraFilteredCore(pixel, 0.150904), max(core, rays), resolved)
      * vOpacity;

    if (alpha <= 0.0) {
      discard;
    }

    float whiteCore = mix(0.59228, core, resolved)
      * smoothstep(0.9, 2.8, vBrightness)
      * 0.82;
    float colorEnergy = 1.0
      - min(vColor.r, min(vColor.g, vColor.b));
    vec3 emission = mix(vColor, vec3(1.0), whiteCore)
      * vBrightness
      * (1.0 + colorEnergy * 0.42);
    gl_FragColor = vec4(emission, alpha);
  }
`;
  var QUAD_VERTEX = `attribute vec2 aPosition;
varying vec2 vUv;
void main() { vUv = aPosition * 0.5 + 0.5; gl_Position = vec4(aPosition, 0.0, 1.0); }`;
  var BLUR_FRAGMENT = `precision mediump float;
varying vec2 vUv;
uniform sampler2D uTexture;
uniform vec2 uStep;
uniform float uThreshold;
vec3 sampleLight(vec2 uv) {
  vec3 color = texture2D(uTexture, uv).rgb;
  return color * smoothstep(uThreshold, uThreshold + 0.18, max(color.r, max(color.g, color.b)));
}
void main() {
  vec3 light = sampleLight(vUv) * 0.227027;
  light += sampleLight(vUv + uStep * 1.384615) * 0.316216;
  light += sampleLight(vUv - uStep * 1.384615) * 0.316216;
  light += sampleLight(vUv + uStep * 3.230769) * 0.070270;
  light += sampleLight(vUv - uStep * 3.230769) * 0.070270;
  gl_FragColor = vec4(light, 1.0);
}`;
  var COMPOSITE_FRAGMENT = `precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uGlow;
void main() {
  vec3 light = texture2D(uScene, vUv).rgb + texture2D(uGlow, vUv).rgb * 0.34;
  // Compact ACES fit; the source uses ACES_FILMIC after its optical passes.
  vec3 mapped = clamp((light * (2.51 * light + 0.03)) / (light * (2.43 * light + 0.59) + 0.14), 0.0, 1.0);
  mapped += vec3(0.002428, 0.002732, 0.002732);
  vec3 srgb = mix(mapped * 12.92, 1.055 * pow(mapped, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), mapped));
  gl_FragColor = vec4(srgb, 1.0);
}`;

  function clamp(v, low, high) { return Math.min(high, Math.max(low, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smootherstep(v) {
    var t = clamp(v, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  function smoothstep(v) { var t = clamp(v, 0, 1); return t * t * (3 - 2 * t); }
  function damp(current, target, speed, dt) {
    var next = lerp(current, target, 1 - Math.exp(-speed * dt));
    return Math.abs(next - target) < 0.0001 ? target : next;
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
  function linear(channel) {
    channel /= 255;
    return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  }

  function AppleStarfield(canvas, imageUrl) {
    this.canvas = canvas;
    this.imageUrl = imageUrl;
    this.hero = document.querySelector('.hero');
    this.stage = document.querySelector('.hero-stage');
    this.ambient = !this.stage;
    this.replayButton = document.querySelector('.apple-replay');
    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.pointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    this.reduceMotion = this.motionQuery.matches;
    this.pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
    this.targetPoints = [];
    this.targets = [];
    this.programs = [];
    this.buffers = [];
    this.frame = 0;
    this.lastTime = 0;
    this.time = 0;
    this.introElapsed = 0;
    this.introProgress = 0;
    this.replayElapsed = null;
    this.hasFormed = false;
    this.scroll = this.ambient ? 1.1875 : 0;
    this.positionScatter = this.ambient ? 1 : 0;
    this.sceneProgress = this.ambient ? 1 : 0;
    this.destroyed = false;
    this.lost = false;
    this.boundResize = this.resize.bind(this);
    this.boundPointer = this.onPointer.bind(this);
    this.boundPointerLeave = this.onPointerLeave.bind(this);
    this.boundScroll = this.onScroll.bind(this);
    this.boundVisibility = this.onVisibility.bind(this);
    this.boundMotion = this.onMotionChange.bind(this);
    this.boundReplay = this.replay.bind(this);
    this.boundLost = this.onContextLost.bind(this);
    this.boundRestored = this.onContextRestored.bind(this);
  }

  AppleStarfield.prototype.start = function () {
    var self = this;
    this.gl = this.canvas.getContext('webgl', { alpha: false, depth: false, antialias: false, powerPreference: 'low-power' });
    if (!this.gl) throw new Error('Starfield requires WebGL.');
    delete this.canvas.dataset.formation;
    delete this.canvas.dataset.ready;
    this.initGL();
    window.addEventListener('resize', this.boundResize, { passive: true });
    window.addEventListener('pointermove', this.boundPointer, { passive: true });
    document.documentElement.addEventListener('pointerleave', this.boundPointerLeave);
    window.addEventListener('scroll', this.boundScroll, { passive: true });
    document.addEventListener('visibilitychange', this.boundVisibility);
    this.canvas.addEventListener('webglcontextlost', this.boundLost);
    this.canvas.addEventListener('webglcontextrestored', this.boundRestored);
    this.motionQuery.addEventListener('change', this.boundMotion);
    if (this.replayButton) this.replayButton.addEventListener('click', this.boundReplay);
    this.resize();
    document.fonts.ready.then(function () { if (!self.destroyed) self.resize(); });
    function ready(points) {
      if (self.destroyed) return;
      self.targetPoints = points;
      self.createParticles();
      self.introElapsed = self.ambient || self.sceneProgress > 0.01 || self.reduceMotion ? 5 : 0;
      self.drawFrame(performance.now());
      self.animate();
    }
    if (this.ambient) { ready([{ x: 0, y: 0, edge: false }]); return; }
    var image = new Image();
    image.decoding = 'async';
    image.onload = function () { if (!self.destroyed) ready(self.extractTargetPoints(image)); };
    image.onerror = function () {
      if (!self.destroyed) { self.canvas.dataset.error = 'apple-image'; console.error('Unable to load apple geometry image.'); }
    };
    image.src = this.imageUrl;
  };

  AppleStarfield.prototype.program = function (vertex, fragment, uniforms) {
    var gl = this.gl;
    var shaders = [];
    function compile(type, source) {
      var shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        var error = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error('Starfield shader: ' + error);
      }
      shaders.push(shader);
      return shader;
    }
    var program = gl.createProgram();
    try {
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    } catch (error) {
      gl.deleteProgram(program);
      throw error;
    } finally {
      shaders.forEach(function (shader) { gl.deleteShader(shader); });
    }
    this.programs.push(program);
    var result = { program: program };
    uniforms.forEach(function (name) { result[name] = gl.getUniformLocation(program, name); });
    return result;
  };

  AppleStarfield.prototype.initGL = function () {
    var gl = this.gl;
    this.programs = [];
    this.buffers = [];
    this.targets = [];
    this.stars = this.program(STAR_VERTEX, STAR_FRAGMENT, [
      'uWorld', 'uPointer', 'uAppleSize', 'uCenter', 'uTime', 'uIntro', 'uReveal',
      'uScatter', 'uPosition', 'uTilt', 'uSizeScale', 'uPixelRatio', 'uTextEdge', 'uScrollDrift', 'uMaxPointSize'
    ]);
    this.blur = this.program(QUAD_VERTEX, BLUR_FRAGMENT, ['uTexture', 'uStep', 'uThreshold']);
    this.composite = this.program(QUAD_VERTEX, COMPOSITE_FRAGMENT, ['uScene', 'uGlow']);
    this.maxPointSize = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.quad = gl.createBuffer();
    this.buffers.push(this.quad);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.starBuffer = gl.createBuffer();
    this.buffers.push(this.starBuffer);
    this.attributes = [['aTarget', 3, 0], ['aSeed', 4, 3], ['aStar', 4, 7], ['aColor', 3, 11]].map(function (entry) {
      return [gl.getAttribLocation(this.stars.program, entry[0]), entry[1], entry[2]];
    }, this);
    this.blur.position = gl.getAttribLocation(this.blur.program, 'aPosition');
    this.composite.position = gl.getAttribLocation(this.composite.program, 'aPosition');
    this.canvas.dataset.renderer = 'webgl';
    gl.disable(gl.DEPTH_TEST);
  };

  AppleStarfield.prototype.createTarget = function (width, height) {
    var gl = this.gl;
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    var framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    var target = { texture: texture, framebuffer: framebuffer, width: width, height: height };
    this.targets.push(target);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete starfield framebuffer.');
    return target;
  };
  AppleStarfield.prototype.releaseTargets = function () {
    var gl = this.gl;
    this.targets.forEach(function (target) { gl.deleteTexture(target.texture); gl.deleteFramebuffer(target.framebuffer); });
    this.targets = [];
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
    if (this.lost || !this.targetPoints.length) return;
    var random = createRandom(1741);
    this.count = this.width < 600 ? 6800 : 12000;
    var data = new Float32Array(this.count * 14);
    // Archived Astra palette, 1rfzm7jt1igp4.pretty:2627-2680.
    var palette = [[109, 203, 244], [122, 177, 254], [248, 121, 21], [250, 153, 76], [245, 246, 251]];
    for (var i = 0; i < this.count; i += 1) {
      var point = this.targetPoints[Math.floor(random() * this.targetPoints.length)];
      var bright = random() < (point.edge ? 0.085 : 0.022);
      var size = bright ? 0.85 + 1.25 * random() : 0.12 + Math.pow(random(), 2.4) * 0.68;
      var brightness = bright ? 2 + 1.5 * random() : 0.56 + 0.78 * random();
      // Keep the archive white-dominant; reserve the source palette for bright stars.
      var seed = random();
      var color = palette[!bright ? 4 : seed < 0.36 ? 0 : seed < 0.52 ? 1 : seed < 0.64 ? 2 : seed < 0.74 ? 3 : 4];
      data.set([
        point.x + (random() - 0.5) * 0.005, -point.y + (random() - 0.5) * 0.005,
        (random() + random() - 1) * 0.09,
        random(), random(), random(), random(),
        size, brightness, 0.82 + random() * 0.16, random(),
        linear(color[0]), linear(color[1]), linear(color[2])
      ], i * 14);
    }
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.starBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.STATIC_DRAW);
  };

  AppleStarfield.prototype.resize = function () {
    if (this.destroyed || this.lost) return;
    var rect = this.canvas.getBoundingClientRect();
    var crossed = this.width && ((this.width < 600) !== (rect.width < 600));
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.width < 600 ? 1.5 : 2, this.maxTextureSize / this.width, this.maxTextureSize / this.height);
    var width = Math.floor(this.width * this.pixelRatio);
    var height = Math.floor(this.height * this.pixelRatio);
    if (this.canvas.width !== width || this.canvas.height !== height || !this.targets.length) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.releaseTargets();
      this.sceneTarget = this.createTarget(width, height);
      this.blurX = this.createTarget(Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2)));
      this.blurY = this.createTarget(this.blurX.width, this.blurX.height);
    }
    this.worldHeight = this.width / this.height < 0.72 ? 12.7 : 10.9;
    this.scale = this.height / this.worldHeight;
    this.targetWidth = 0;
    this.centerY = this.height * 0.5;
    if (this.stage) {
      var stageRect = this.stage.getBoundingClientRect();
      var stageTop = parseFloat(getComputedStyle(this.stage).top) || 0;
      var heading = this.stage.querySelector('.hero-heading');
      var lower = this.stage.querySelector('.hero-lower');
      var areaTop = heading.offsetTop + heading.offsetHeight + 22;
      var areaBottom = lower.offsetTop - 24;
      var contentTop = this.stage.querySelector('.hero-content').offsetTop;
      var available = Math.max(100, areaBottom - areaTop);
      this.targetWidth = Math.min(this.width * 0.76, available * 0.82, 500);
      this.centerY = stageTop + contentTop + areaTop + available * 0.5;
      this.sceneTop = this.hero.getBoundingClientRect().top + window.scrollY - stageTop;
      this.trackLength = Math.max(1, this.hero.offsetHeight - stageRect.height);
      this.stage.style.setProperty('--apple-size', (this.targetWidth * 1.12) + 'px');
      this.stage.style.setProperty('--apple-top', (this.centerY - stageTop - this.targetWidth * 0.56) + 'px');
    }
    if (crossed) this.createParticles();
    this.onScroll();
    if (this.count) this.drawFrame(performance.now());
  };
  AppleStarfield.prototype.onScroll = function () {
    this.scrollY = window.scrollY || 0;
    this.sceneProgress = this.ambient ? 1 : clamp((this.scrollY - this.sceneTop) / this.trackLength, 0, 1);
    this.canvas.dataset.sceneProgress = this.sceneProgress.toFixed(3);
    if (this.reduceMotion) this.drawFrame(performance.now());
  };
  AppleStarfield.prototype.onPointer = function (event) {
    if (this.reduceMotion || !this.pointerQuery.matches) return;
    this.pointer.targetX = (event.clientX / this.width - 0.5) * 2;
    this.pointer.targetY = (0.5 - event.clientY / this.height) * 2;
  };
  AppleStarfield.prototype.onPointerLeave = function () { this.pointer.targetX = 0; this.pointer.targetY = 0; };
  AppleStarfield.prototype.stop = function () {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lastTime = 0;
  };
  AppleStarfield.prototype.onVisibility = function () {
    this.stop();
    if (!document.hidden) this.animate();
  };
  AppleStarfield.prototype.onMotionChange = function (event) {
    this.reduceMotion = event.matches;
    this.stop();
    this.onPointerLeave();
    this.pointer.x = 0;
    this.pointer.y = 0;
    this.replayElapsed = null;
    this.introElapsed = 5;
    this.drawFrame(performance.now());
    this.animate();
  };
  AppleStarfield.prototype.replay = function () {
    if (this.destroyed || this.reduceMotion || !this.count || this.sceneProgress > 0.1) return;
    this.replayFrom = this.introProgress;
    this.replayReveal = this.revealProgress || 0;
    this.replayElapsed = 0;
    delete this.canvas.dataset.formation;
  };
  AppleStarfield.prototype.onContextLost = function (event) {
    event.preventDefault();
    this.lost = true;
    this.stop();
    delete this.canvas.dataset.ready;
  };
  AppleStarfield.prototype.onContextRestored = function () {
    if (this.destroyed) return;
    this.lost = false;
    this.initGL();
    this.createParticles();
    this.resize();
    this.animate();
  };
  AppleStarfield.prototype.animate = function () {
    var self = this;
    if (this.destroyed || this.lost || this.reduceMotion || document.hidden || this.frame || !this.count) return;
    this.frame = requestAnimationFrame(function (time) {
      self.frame = 0;
      self.drawFrame(time);
      self.animate();
    });
  };
  AppleStarfield.prototype.setState = function (name, value) {
    if (this.canvas.dataset[name] !== value) this.canvas.dataset[name] = value;
  };

  AppleStarfield.prototype.drawFrame = function (time) {
    if (this.destroyed || this.lost || !this.count) return;
    var dt = this.lastTime ? Math.min((time - this.lastTime) / 1000, 0.05) : 0;
    this.lastTime = time;
    if (this.reduceMotion || document.hidden) dt = 0;
    this.time += dt;
    this.introElapsed += dt;
    if (this.reduceMotion) this.introElapsed = 5;
    var intro = clamp(this.introElapsed / 5, 0, 1);
    if (this.replayElapsed !== null) {
      this.replayElapsed += dt;
      intro = this.replayElapsed < 0.8
        ? lerp(this.replayFrom, 0, smootherstep(this.replayElapsed / 0.8))
        : clamp((this.replayElapsed - 0.8) / 4.4, 0, 1);
      if (intro >= 1 && this.replayElapsed >= 0.8) this.replayElapsed = null;
    }
    this.introProgress = intro;
    this.revealProgress = this.hasFormed ? 1 : this.replayElapsed !== null
      ? lerp(this.replayReveal, 1, smootherstep((this.replayElapsed - 0.8) / 4.4))
      : intro;
    if (intro >= 1) { this.hasFormed = true; this.setState('formation', 'complete'); }
    var raw = this.sceneProgress * 1.1875;
    this.scroll = this.reduceMotion ? raw : damp(this.scroll, raw, 6, dt);
    var scatter = smootherstep((this.scroll - 0.375) / 0.8125);
    var target = smoothstep(smootherstep((raw - 0.375) / 0.8125));
    this.positionScatter = this.reduceMotion ? target : damp(this.positionScatter, target, 4, dt);
    var progress = clamp(this.scroll / 1.1875, 0, 1);
    var tilt = this.reduceMotion ? 0 : -52 * Math.PI / 180 * Math.sin(clamp(progress / 0.75, 0, 1) * Math.PI / 2)
      * (1 - smootherstep((progress - 0.75) / 0.25));
    this.pointer.x = damp(this.pointer.x, this.pointer.targetX, 5.5, dt);
    this.pointer.y = damp(this.pointer.y, this.pointer.targetY, 5.5, dt);
    this.setState('scatter', scatter.toFixed(3));
    this.setState('positionScatter', this.positionScatter.toFixed(3));
    this.setState('tilt', (tilt * 180 / Math.PI).toFixed(2));
    if (this.hero && this.lastCopy !== scatter.toFixed(3)) {
      this.lastCopy = scatter.toFixed(3);
      this.hero.style.setProperty('--hero-scatter', this.lastCopy);
      this.hero.style.setProperty('--hero-copy-alpha', clamp(1 - scatter * 1.18, 0, 1).toFixed(3));
      this.hero.style.setProperty('--hero-copy-shift', (scatter * 46).toFixed(1));
    }
    if (this.replayButton) this.replayButton.disabled = this.reduceMotion || this.sceneProgress > 0.1;
    var gl = this.gl;
    var stars = this.stars;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneTarget.framebuffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(stars.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffer);
    this.attributes.forEach(function (a) { gl.enableVertexAttribArray(a[0]); gl.vertexAttribPointer(a[0], a[1], gl.FLOAT, false, 56, a[2] * 4); });
    gl.uniform2f(stars.uWorld, this.width / this.scale, this.worldHeight);
    gl.uniform2f(stars.uPointer, this.pointer.x, this.pointer.y);
    gl.uniform1f(stars.uAppleSize, this.targetWidth / this.scale);
    gl.uniform1f(stars.uCenter, (this.height * 0.5 - this.centerY) / this.scale);
    gl.uniform1f(stars.uTime, this.time);
    gl.uniform1f(stars.uIntro, intro);
    gl.uniform1f(stars.uReveal, this.revealProgress);
    gl.uniform1f(stars.uScatter, scatter);
    gl.uniform1f(stars.uPosition, this.positionScatter);
    gl.uniform1f(stars.uTilt, tilt);
    gl.uniform1f(stars.uSizeScale, lerp(1, 0.45, smootherstep(this.scroll / 0.5)));
    gl.uniform1f(stars.uPixelRatio, this.pixelRatio);
    gl.uniform1f(stars.uTextEdge, Math.min(Math.min(676, Math.max(this.width - 48, 0)) * 0.5 + 48, this.width * 0.36) / this.scale);
    gl.uniform1f(stars.uScrollDrift, (this.scrollY || 0) / this.height * 0.4);
    gl.uniform1f(stars.uMaxPointSize, this.maxPointSize);
    gl.drawArrays(gl.POINTS, 0, this.count);
    this.attributes.forEach(function (a) { gl.disableVertexAttribArray(a[0]); });
    gl.disable(gl.BLEND);
    this.drawBlur(this.sceneTarget.texture, this.blurX, 1 / this.blurX.width, 0, 0.12);
    this.drawBlur(this.blurX.texture, this.blurY, 0, 1 / this.blurY.height, -0.18);
    var composite = this.composite;
    this.bindQuad(composite, null, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.texture);
    gl.uniform1i(composite.uScene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.blurY.texture);
    gl.uniform1i(composite.uGlow, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(composite.position);
    gl.activeTexture(gl.TEXTURE0);
    this.setState('ready', 'true');
  };
  AppleStarfield.prototype.bindQuad = function (program, target, width, height) {
    var gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, width, height);
    gl.useProgram(program.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(program.position);
    gl.vertexAttribPointer(program.position, 2, gl.FLOAT, false, 0, 0);
  };
  AppleStarfield.prototype.drawBlur = function (texture, target, x, y, threshold) {
    var gl = this.gl;
    var blur = this.blur;
    this.bindQuad(blur, target.framebuffer, target.width, target.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(blur.uTexture, 0);
    gl.uniform2f(blur.uStep, x, y);
    gl.uniform1f(blur.uThreshold, threshold);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(blur.position);
  };
  AppleStarfield.prototype.destroy = function () {
    this.destroyed = true;
    this.stop();
    window.removeEventListener('resize', this.boundResize);
    window.removeEventListener('pointermove', this.boundPointer);
    document.documentElement.removeEventListener('pointerleave', this.boundPointerLeave);
    window.removeEventListener('scroll', this.boundScroll);
    document.removeEventListener('visibilitychange', this.boundVisibility);
    this.canvas.removeEventListener('webglcontextlost', this.boundLost);
    this.canvas.removeEventListener('webglcontextrestored', this.boundRestored);
    this.motionQuery.removeEventListener('change', this.boundMotion);
    if (this.replayButton) this.replayButton.removeEventListener('click', this.boundReplay);
    if (this.gl && !this.lost) {
      this.releaseTargets();
      var gl = this.gl;
      this.buffers.forEach(function (b) { gl.deleteBuffer(b); });
      this.programs.forEach(function (p) { gl.deleteProgram(p); });
    }
  };
  window.AppleStarfield = AppleStarfield;
}());
