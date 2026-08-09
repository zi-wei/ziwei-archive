(function () {
  'use strict';

  var BAYER = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];

  function DitherField(canvas, imageUrl) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: true });
    this.imageUrl = imageUrl;
    this.source = null;
    this.crop = null;
    this.frame = 0;
    this.resizeObserver = null;
    this.pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.boundResize = this.resize.bind(this);
    this.boundPointer = this.onPointer.bind(this);
  }

  DitherField.prototype.start = function () {
    var self = this;
    this.resize();
    window.addEventListener('resize', this.boundResize, { passive: true });
    window.addEventListener('pointermove', this.boundPointer, { passive: true });
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(this.boundResize);
      this.resizeObserver.observe(this.canvas);
    }

    var image = new Image();
    image.decoding = 'async';
    image.src = this.imageUrl || '';
    image.onload = function () {
      self.source = image;
      self.crop = self.findCrop(image);
      self.resize();
      self.drawFrame(0);
      if (!self.reduceMotion) self.animate();
    };
    image.onerror = function () {
      self.drawFallback();
      if (!self.reduceMotion) self.animate();
    };
  };

  DitherField.prototype.destroy = function () {
    window.removeEventListener('resize', this.boundResize);
    window.removeEventListener('pointermove', this.boundPointer);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
  };

  DitherField.prototype.onPointer = function (event) {
    var rect = this.canvas.getBoundingClientRect();
    this.pointer.targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 18;
    this.pointer.targetY = ((event.clientY - rect.top) / rect.height - 0.5) * 12;
  };

  DitherField.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    var width = Math.max(1, Math.floor(rect.width * ratio));
    var height = Math.max(1, Math.floor(rect.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      if (this.source) this.drawFrame(0);
    }
  };

  DitherField.prototype.findCrop = function (image) {
    var size = 160;
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
    for (var y = 0; y < size; y += 1) {
      for (var x = 0; x < size; x += 1) {
        var at = (y * size + x) * 4;
        var luminance = (pixels[at] + pixels[at + 1] + pixels[at + 2]) / 3;
        if (luminance < 184) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (minX === size) return { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
    var padX = Math.max(5, Math.round((maxX - minX) * 0.08));
    var padY = Math.max(5, Math.round((maxY - minY) * 0.08));
    return {
      x: Math.max(0, Math.floor((minX - padX) * image.naturalWidth / size)),
      y: Math.max(0, Math.floor((minY - padY) * image.naturalHeight / size)),
      width: Math.min(image.naturalWidth, Math.ceil((maxX - minX + padX * 2) * image.naturalWidth / size)),
      height: Math.min(image.naturalHeight, Math.ceil((maxY - minY + padY * 2) * image.naturalHeight / size)),
    };
  };

  DitherField.prototype.animate = function () {
    var self = this;
    this.frame = requestAnimationFrame(function (time) {
      self.drawFrame(time);
      self.animate();
    });
  };

  DitherField.prototype.drawFrame = function (time) {
    if (!this.context) return;
    var width = this.canvas.width;
    var height = this.canvas.height;
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    var context = this.context;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#0b0b0b';
    context.fillRect(0, 0, width, height);
    context.scale(ratio, ratio);
    var cssWidth = width / ratio;
    var cssHeight = height / ratio;
    this.pointer.x += (this.pointer.targetX - this.pointer.x) * 0.035;
    this.pointer.y += (this.pointer.targetY - this.pointer.y) * 0.035;

    if (!this.source || !this.crop) {
      this.drawFallback(cssWidth, cssHeight);
      return;
    }

    var crop = this.crop;
    var targetSize = Math.min(cssWidth * 0.84, cssHeight * 0.92);
    var drawWidth = targetSize;
    var drawHeight = targetSize * crop.height / crop.width;
    var left = (cssWidth - drawWidth) / 2 + this.pointer.x;
    var top = Math.max(18, (cssHeight - drawHeight) / 2 - 18) + this.pointer.y;
    var sampleStep = cssWidth < 600 ? 4 : 5;
    var sampleCanvas = document.createElement('canvas');
    var sampleWidth = Math.max(1, Math.floor(drawWidth / sampleStep));
    var sampleHeight = Math.max(1, Math.floor(drawHeight / sampleStep));
    sampleCanvas.width = sampleWidth;
    sampleCanvas.height = sampleHeight;
    var sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
    sampleContext.drawImage(this.source, crop.x, crop.y, crop.width, crop.height, 0, 0, sampleWidth, sampleHeight);
    var pixels = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
    var drift = Math.sin(time * 0.0007) * 0.6;

    for (var y = 0; y < sampleHeight; y += 1) {
      for (var x = 0; x < sampleWidth; x += 1) {
        var at = (y * sampleWidth + x) * 4;
        var luminance = (pixels[at] * 0.299 + pixels[at + 1] * 0.587 + pixels[at + 2] * 0.114) / 255;
        var mask = Math.max(0, Math.min(1, 1 - luminance));
        if (mask < 0.035) continue;
        var grain = (Math.sin(x * 0.81 + y * 1.17 + drift) + Math.sin(y * 0.32 - x * 0.27)) * 0.07;
        var intensity = Math.max(0, Math.min(1, mask * (0.76 + grain)));
        var threshold = (BAYER[y % 4][x % 4] + 0.5) / 16;
        if (intensity < threshold) continue;
        var alpha = Math.min(0.88, 0.24 + intensity * 0.64);
        context.fillStyle = 'rgba(220,220,220,' + alpha.toFixed(3) + ')';
        context.fillRect(left + x * sampleStep, top + y * sampleStep, sampleStep - 1, sampleStep - 1);
      }
    }
  };

  DitherField.prototype.drawFallback = function (width, height) {
    if (!width || !height) {
      width = this.canvas.width;
      height = this.canvas.height;
    }
    var context = this.context;
    context.fillStyle = 'rgba(230,230,230,0.45)';
    var centerX = width / 2;
    var centerY = height / 2;
    for (var y = 0; y < height; y += 5) {
      for (var x = 0; x < width; x += 5) {
        var dx = (x - centerX) / (width * 0.33);
        var dy = (y - centerY) / (height * 0.42);
        if (dx * dx + dy * dy < 1 && (x + y) % 3 !== 0) context.fillRect(x, y, 3, 3);
      }
    }
  };

  window.DitherField = DitherField;
}());
