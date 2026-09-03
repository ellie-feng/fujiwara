/*
 * Fujiwara — scene renderer
 * -------------------------
 * Full-bleed parallax touge backdrop for the focus run, plus the two break
 * destinations (gas station / drive-through). A small state machine, driven
 * purely by the timer phase, eases the visual layer independently of the
 * countdown. Day / night is a manual toggle (setSceneMode).
 *
 * Internal height is a fixed 180px; width flexes to the viewport aspect
 * (resize()), so the scene fills the window without a heavy crop.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root.Car, root.PAL);
  else root.Scene = factory(root.Car, root.PAL);
})(typeof self !== 'undefined' ? self : this, function (Car, PAL) {
  'use strict';

  var BASE_W = 320, H = 180;
  var HORIZON = 76;
  var GROUND_Y = 104;
  var DRIVE_SPEED = 1.5;      // slower cruise (was 2.6)
  var CAR_X_DRIVE = 118;
  var CAR_X_PARK = 150;
  var STATION_X = 176;

  var THEMES = {
    night: {
      skyTop: PAL.c1, skyLow: PAL.c2,
      ridgeFar: PAL.c1, ridgeNear: PAL.c0, pine: '#0b0c15',
      road: '#0b0c15', shoulder: PAL.c3, edgeFar: PAL.c5, edgeNear: PAL.c4,
      dash: PAL.c5, rail: PAL.c4, post: PAL.c3,
      lampPole: PAL.c3, lampHead: PAL.c8, lampGlow: true,
      stars: true,
      orbFill: PAL.c6, orbShade: PAL.c5, orbGlow: 'rgba(236,230,211,0.32)', orbR: 10, glowR: 30,
      vignette: 0.5, scrim: 'rgba(10,11,21,0.72)',
      night: true
    },
    day: {
      skyTop: '#6ea3cf', skyLow: '#c2dae0',
      ridgeFar: '#9fb8bd', ridgeNear: '#6d8f75', pine: '#3b5743',
      road: '#3e4350', shoulder: '#585d6b', edgeFar: '#e9e5cb', edgeNear: '#d7d3b8',
      dash: '#e9e5cb', rail: '#aeb4c0', post: '#7c8290',
      lampPole: '#8a8f9c', lampHead: '#6f7480', lampGlow: false,
      stars: false,
      orbFill: '#ffe7ad', orbShade: '#ffd98a', orbGlow: 'rgba(255,231,173,0.55)', orbR: 12, glowR: 46,
      vignette: 0.22, scrim: 'rgba(20,24,32,0.6)',
      night: false
    }
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function Scene() {
    this.W = BASE_W;
    this.state = 'driving';
    this.phase = 'focus';
    this.mode = 'night';
    this.T = THEMES.night;
    this.running = false;
    this.speed = 0;
    this.distance = 0;
    this.carX = CAR_X_DRIVE;
    this.stationX = BASE_W + 140;
    this.breakKind = 'gas';
    this._breakCount = 0;
    this._t = 0;
    this._build();
  }

  Scene.prototype._build = function () {
    var rnd = mulberry32(20260903);
    var span = Math.max(2 * this.W, 900);
    this.stars = [];
    var n = Math.round(this.W / 4.5);
    for (var i = 0; i < n; i++) {
      this.stars.push({ x: rnd() * this.W, y: rnd() * (HORIZON - 14), s: rnd() < 0.14 ? 2 : 1, p: rnd() * Math.PI * 2 });
    }
    this.ridgeFar = this._ridge(rnd, span, 16, 30);
    this.ridgeNear = this._ridge(rnd, span, 24, 44);
  };

  Scene.prototype.resize = function (w) {
    w = Math.max(240, Math.round(w) || BASE_W);
    if (w === this.W) return;
    this.W = w;
    this._build();
  };

  Scene.prototype._ridge = function (rnd, span, minH, maxH) {
    var pts = [], x = 0;
    while (x <= span) { pts.push([x, HORIZON - (minH + rnd() * (maxH - minH))]); x += 16 + rnd() * 28; }
    pts.push([span, HORIZON - minH]);
    return pts;
  };

  // ---- state machine ----
  Scene.prototype.setPhase = function (phase) {
    this.phase = phase;
    if (phase === 'focus') {
      if (this.state === 'parked' || this.state === 'arriving') this.state = 'leaving';
    } else {
      this.breakKind = (this._breakCount % 2 === 0) ? 'gas' : 'drivethru';
      this._breakCount++;
      this.stationX = this.W + 140;
      this.state = 'arriving';
    }
  };
  Scene.prototype.isParked = function () { return this.state === 'parked'; };
  Scene.prototype.setRunning = function (b) { this.running = !!b; };
  Scene.prototype.setSceneMode = function (mode) {
    this.mode = (mode === 'day') ? 'day' : 'night';
    this.T = THEMES[this.mode];
  };
  Scene.prototype.toggleSceneMode = function () {
    this.setSceneMode(this.mode === 'night' ? 'day' : 'night');
    return this.mode;
  };

  // ---- update ----
  Scene.prototype.update = function (dtMs) {
    var f = Math.min(3, (dtMs || 16.667) / 16.667);
    this._t += (dtMs || 16.667) / 1000;

    var tS, tX, tSt;
    if (this.state === 'driving') {
      tS = this.running ? DRIVE_SPEED : 0; tX = CAR_X_DRIVE; tSt = this.W + 140;
    } else if (this.state === 'arriving' || this.state === 'parked') {
      tS = 0; tX = CAR_X_PARK; tSt = STATION_X;
    } else {
      tS = this.running ? DRIVE_SPEED : 0; tX = CAR_X_DRIVE; tSt = this.W + 160;
    }

    var kS = 1 - Math.pow(1 - 0.04, f);
    var kX = 1 - Math.pow(1 - 0.05, f);
    this.speed = lerp(this.speed, tS, kS);
    this.carX = lerp(this.carX, tX, kX);
    this.stationX = lerp(this.stationX, tSt, kX);
    this.distance += this.speed * f;

    if (this.state === 'arriving' && this.speed < 0.04 && Math.abs(this.stationX - STATION_X) < 1.2) {
      this.state = 'parked'; this.speed = 0;
    }
    if (this.state === 'leaving' && this.stationX > this.W + 120 &&
        (this.speed > DRIVE_SPEED - 0.12 || !this.running)) {
      this.state = 'driving';
    }
  };

  function repeat(w, offset, spacing, drawOne) {
    var start = -(((offset % spacing) + spacing) % spacing);
    for (var x = start - spacing; x < w + spacing; x += spacing) drawOne(x);
  }

  // ---- render ----
  Scene.prototype.render = function (ctx) {
    var T = this.T, t = this._t, W = this.W;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = T.skyTop;
    ctx.fillRect(0, 0, W, HORIZON - 16);
    ctx.fillStyle = T.skyLow;
    ctx.fillRect(0, HORIZON - 16, W, 16);

    if (T.stars) {
      for (var i = 0; i < this.stars.length; i++) {
        var st = this.stars[i];
        ctx.globalAlpha = 0.3 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2 + st.p));
        ctx.fillStyle = PAL.c6;
        ctx.fillRect(st.x | 0, st.y | 0, st.s, st.s);
      }
      ctx.globalAlpha = 1;
    }

    // sun / moon — kept clear of the right edge
    var ox = W - 62;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var og = ctx.createRadialGradient(ox, 28, 0, ox, 28, T.glowR);
    og.addColorStop(0, T.orbGlow);
    og.addColorStop(1, T.orbGlow.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = og;
    ctx.beginPath(); ctx.arc(ox, 28, T.glowR, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = T.orbFill;
    ctx.beginPath(); ctx.arc(ox, 28, T.orbR, 0, Math.PI * 2); ctx.fill();
    if (T.night) {
      ctx.fillStyle = T.orbShade;
      ctx.beginPath(); ctx.arc(ox - 4, 25, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ox + 3, 31, 1.6, 0, Math.PI * 2); ctx.fill();
    }

    this._drawRidge(ctx, this.ridgeFar, this.distance * 0.12, T.ridgeFar);
    this._drawRidge(ctx, this.ridgeNear, this.distance * 0.28, T.ridgeNear);
    ctx.fillStyle = T.pine;
    repeat(W, this.distance * 0.28, 36, function (x) {
      Scene._pine(ctx, x + 7, HORIZON - 5, 7, 15);
      Scene._pine(ctx, x + 22, HORIZON - 3, 5, 11);
    });

    ctx.fillStyle = T.road;
    ctx.fillRect(0, HORIZON, W, H - HORIZON);
    ctx.fillStyle = T.shoulder; ctx.fillRect(0, HORIZON, W, 2);
    ctx.fillStyle = T.edgeFar; ctx.fillRect(0, HORIZON + 3, W, 1);
    ctx.fillStyle = T.edgeNear; ctx.fillRect(0, H - 5, W, 2);
    ctx.fillStyle = T.dash;
    repeat(W, this.distance, 26, function (x) { ctx.fillRect(x, HORIZON + 20, 12, 3); });

    ctx.fillStyle = T.rail; ctx.fillRect(0, HORIZON - 7, W, 2);
    repeat(W, this.distance, 22, function (x) { ctx.fillStyle = T.post; ctx.fillRect(x, HORIZON - 7, 2, 7); });
    repeat(W, this.distance, 96, function (x) { Scene._lamp(ctx, x + 14, HORIZON, T); });

    if (this.stationX < W + 130) {
      if (this.breakKind === 'gas') Scene._gasStation(ctx, this.stationX, T);
      else Scene._driveThru(ctx, this.stationX, T);
    }

    Car.draw(ctx, this.carX, GROUND_Y, {
      moving: this.speed > 0.12,
      bob: this.distance * 0.16,
      brake: this.state === 'arriving'
    });

    if (T.lampGlow) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      repeat(W, this.distance, 96, function (x) {
        var lx = x + 24, ly = HORIZON - 34;
        var g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 12);
        g.addColorStop(0, 'rgba(226,164,90,0.30)'); g.addColorStop(1, 'rgba(226,164,90,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(lx, ly, 12, 0, Math.PI * 2); ctx.fill();
        var p = ctx.createRadialGradient(lx, HORIZON + 10, 0, lx, HORIZON + 10, 24);
        p.addColorStop(0, 'rgba(226,164,90,0.10)'); p.addColorStop(1, 'rgba(226,164,90,0)');
        ctx.fillStyle = p;
        ctx.beginPath(); ctx.ellipse(lx, HORIZON + 10, 24, 7, 0, 0, Math.PI * 2); ctx.fill();
      });
      ctx.restore();
    }
    if (this.stationX < W + 130) Scene._breakGlow(ctx, this.stationX, this.breakKind, T);

    Car.drawLights(ctx, this.carX, GROUND_Y, {
      headlights: T.night ? 1 : 0,
      moving: this.speed > 0.12,
      bob: this.distance * 0.16,
      brake: this.state === 'arriving'
    });

    var vg = ctx.createRadialGradient(W / 2, H / 2, 70, W / 2, H / 2, Math.max(190, W * 0.7));
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,' + T.vignette + ')');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    var sc = ctx.createLinearGradient(0, H - 90, 0, H);
    sc.addColorStop(0, T.scrim.replace(/[\d.]+\)$/, '0)'));
    sc.addColorStop(1, T.scrim);
    ctx.fillStyle = sc;
    ctx.fillRect(0, H - 90, W, 90);
  };

  Scene.prototype._drawRidge = function (ctx, pts, offset, color) {
    var span = pts[pts.length - 1][0];
    var ox = -((offset % span + span) % span);
    ctx.fillStyle = color;
    for (var pass = 0; pass < 3; pass++) {
      var base = ox + pass * span;
      if (base > this.W) break;
      ctx.beginPath();
      ctx.moveTo(base + pts[0][0], HORIZON);
      for (var i = 0; i < pts.length; i++) ctx.lineTo(base + pts[i][0], pts[i][1]);
      ctx.lineTo(base + span, HORIZON);
      ctx.closePath();
      ctx.fill();
    }
  };

  Scene._pine = function (ctx, x, baseY, w, h) {
    ctx.beginPath();
    ctx.moveTo(x, baseY - h); ctx.lineTo(x - w, baseY); ctx.lineTo(x + w, baseY);
    ctx.closePath(); ctx.fill();
  };

  Scene._lamp = function (ctx, x, roadTop, T) {
    ctx.fillStyle = T.lampPole;
    ctx.fillRect(x, roadTop - 38, 2, 38);
    ctx.fillRect(x, roadTop - 38, 11, 2);
    ctx.fillStyle = T.lampHead;
    ctx.fillRect(x + 9, roadTop - 38, 4, 3);
  };

  Scene._gasStation = function (ctx, x, T) {
    var g = GROUND_Y;
    ctx.fillStyle = T.night ? PAL.c1 : '#8a8f9c';
    ctx.fillRect(x - 12, g - 1, 100, 6);

    ctx.fillStyle = PAL.c5;
    ctx.fillRect(x + 2, g - 44, 4, 43);
    ctx.fillRect(x + 56, g - 44, 4, 43);

    ctx.fillStyle = PAL.c6;
    ctx.fillRect(x - 8, g - 50, 84, 6);
    ctx.fillStyle = PAL.c7;
    ctx.fillRect(x - 8, g - 44, 84, 2);
    ctx.fillStyle = PAL.c8;
    ctx.fillRect(x + 6, g - 44, 4, 1);
    ctx.fillRect(x + 32, g - 44, 4, 1);
    ctx.fillRect(x + 58, g - 44, 4, 1);

    ctx.fillStyle = PAL.c0; ctx.fillRect(x + 36, g - 3, 20, 4);
    ctx.fillStyle = PAL.c7; ctx.fillRect(x + 42, g - 21, 10, 18);
    ctx.fillStyle = PAL.c6; ctx.fillRect(x + 43, g - 20, 8, 2);
    ctx.fillStyle = PAL.c0; ctx.fillRect(x + 44, g - 17, 6, 5);
    ctx.fillStyle = PAL.c8; ctx.fillRect(x + 45, g - 16, 4, 3);
    ctx.fillStyle = PAL.c0; ctx.fillRect(x + 40, g - 14, 3, 10);

    ctx.fillStyle = T.night ? PAL.c1 : '#5c6270';
    ctx.fillRect(x + 60, g - 36, 32, 36);
    ctx.fillStyle = PAL.c0; ctx.fillRect(x + 58, g - 40, 36, 4);
    ctx.fillStyle = PAL.c8; ctx.fillRect(x + 64, g - 31, 16, 13);
    ctx.fillStyle = T.night ? PAL.c1 : '#5c6270';
    ctx.fillRect(x + 72, g - 31, 1, 13);
    ctx.fillRect(x + 64, g - 25, 16, 1);
    ctx.fillStyle = PAL.c0; ctx.fillRect(x + 83, g - 19, 7, 19);
    ctx.fillStyle = PAL.c0; ctx.fillRect(x + 63, g - 48, 22, 8);
    ctx.fillStyle = PAL.c8; ctx.fillRect(x + 65, g - 46, 18, 2);
    ctx.fillStyle = PAL.c5; ctx.fillRect(x + 65, g - 43, 18, 1);
  };

  Scene._driveThru = function (ctx, x, T) {
    var g = GROUND_Y;
    ctx.fillStyle = T.night ? PAL.c1 : '#8a8f9c';
    ctx.fillRect(x - 10, g - 1, 100, 6);
    ctx.fillStyle = PAL.c5;
    ctx.fillRect(x + 4, g + 1, 10, 2);
    ctx.fillRect(x + 12, g, 2, 4);

    ctx.fillStyle = PAL.c4; ctx.fillRect(x + 4, g - 28, 3, 26);
    ctx.fillStyle = PAL.c0; ctx.fillRect(x - 8, g - 52, 30, 26);
    ctx.fillStyle = PAL.c3; ctx.fillRect(x - 8, g - 52, 30, 5);
    ctx.fillStyle = PAL.c8; ctx.fillRect(x - 5, g - 50, 12, 2);
    for (var r = 0; r < 4; r++) {
      ctx.fillStyle = PAL.c5; ctx.fillRect(x - 5, g - 44 + r * 4, 16, 2);
      ctx.fillStyle = PAL.c8; ctx.fillRect(x + 13, g - 44 + r * 4, 5, 2);
    }
    ctx.fillStyle = PAL.c3; ctx.fillRect(x + 24, g - 16, 5, 14);
    ctx.fillStyle = PAL.c8; ctx.fillRect(x + 25, g - 13, 3, 3);

    ctx.fillStyle = T.night ? PAL.c1 : '#5c6270';
    ctx.fillRect(x + 38, g - 40, 54, 40);
    ctx.fillStyle = T.night ? PAL.c2 : '#6b7180';
    ctx.fillRect(x + 38, g - 40, 2, 40);
    ctx.fillStyle = PAL.c0; ctx.fillRect(x + 36, g - 44, 58, 5);
    ctx.fillStyle = PAL.c7; ctx.fillRect(x + 44, g - 28, 28, 4);
    ctx.fillStyle = PAL.c8; ctx.fillRect(x + 48, g - 24, 3, 1);
    ctx.fillRect(x + 64, g - 24, 3, 1);
    ctx.fillStyle = PAL.c8; ctx.fillRect(x + 48, g - 22, 20, 15);
    ctx.fillStyle = PAL.c6; ctx.fillRect(x + 48, g - 22, 20, 3);
    ctx.fillStyle = PAL.c4; ctx.fillRect(x + 48, g - 14, 20, 2);
    ctx.fillStyle = PAL.c0; ctx.fillRect(x + 57, g - 20, 4, 6);
    ctx.fillStyle = PAL.c0; ctx.fillRect(x + 74, g - 38, 14, 6);
    ctx.fillStyle = PAL.c7; ctx.fillRect(x + 76, g - 36, 10, 2);
  };

  Scene._breakGlow = function (ctx, x, kind, T) {
    if (!T.night) return;
    var g = GROUND_Y;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    function pool(px, py, rad, col) {
      var rg = ctx.createRadialGradient(px, py, 0, px, py, rad);
      rg.addColorStop(0, col); rg.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2); ctx.fill();
    }
    if (kind === 'gas') {
      [6, 32, 58].forEach(function (dx) {
        var cg = ctx.createLinearGradient(x + dx, g - 44, x + dx, g);
        cg.addColorStop(0, 'rgba(226,164,90,0.18)'); cg.addColorStop(1, 'rgba(226,164,90,0)');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.moveTo(x + dx - 1, g - 43); ctx.lineTo(x + dx + 4, g - 43);
        ctx.lineTo(x + dx + 12, g); ctx.lineTo(x + dx - 9, g);
        ctx.closePath(); ctx.fill();
      });
      pool(x + 30, g - 4, 42, 'rgba(226,164,90,0.22)');
      pool(x + 72, g - 22, 18, 'rgba(226,164,90,0.34)');
    } else {
      pool(x + 58, g - 14, 30, 'rgba(226,164,90,0.30)');
      pool(x + 6, g - 38, 16, 'rgba(226,164,90,0.22)');
    }
    ctx.restore();
  };

  Scene.W = BASE_W;
  Scene.H = H;
  Scene.GROUND_Y = GROUND_Y;
  return Scene;
});
