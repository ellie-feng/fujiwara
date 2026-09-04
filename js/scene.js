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
  var HORIZON = 68;      // road top edge, higher up so the dash sits over clear road
  var GROUND_Y = 88;     // car wheel contact line (upper-middle of the frame)
  var DRIVE_SPEED = 1.5;      // slower cruise (was 2.6)
  var CAR_X_DRIVE = 118;
  var CAR_X_PARK = 150;
  var STATION_X = 176;

  var THEMES = {
    night: {
      sky: ['#171a2c', '#1e2138', '#282e4c', '#38406a'], // top -> horizon, crisp bands
      ridgeFar:  '#1b1e30', ridgeMid: '#151724', ridgeNear: '#0e0f18',
      ridgeShadeFar: '#262c48', ridgeShadeMid: '#1e2238', ridgeShadeNear: '#161a2c',
      ridgeRim: '#3a4066',
      pine: '#0b0c15',
      road: '#0b0c15', roadNear: '#101322', shoulder: PAL.c3, edgeFar: PAL.c5, edgeNear: PAL.c4,
      dash: PAL.c5, rail: PAL.c4, post: PAL.c3,
      lampPole: PAL.c3, lampHead: PAL.c8, lampGlow: true,
      stars: true,
      orbFill: PAL.c6, orbShade: PAL.c5, orbHalo: '#ece6d3', orbHaloA: 0.16, orbR: 10,
      vignette: 0.34,
      night: true
    },
    day: {
      sky: ['#5f9bcb', '#79add4', '#9fc7dc', '#c9dee2'],
      ridgeFar:  '#a7bec2', ridgeMid: '#8dab99', ridgeNear: '#6d8f75',
      ridgeShadeFar: '#c0d4d5', ridgeShadeMid: '#a6c1af', ridgeShadeNear: '#88a98e',
      ridgeRim: '#dcebe1',
      pine: '#3b5743',
      road: '#3e4350', roadNear: '#474d5d', shoulder: '#585d6b', edgeFar: '#e9e5cb', edgeNear: '#d7d3b8',
      dash: '#e9e5cb', rail: '#aeb4c0', post: '#7c8290',
      lampPole: '#8a8f9c', lampHead: '#6f7480', lampGlow: false,
      stars: false,
      orbFill: '#ffe7ad', orbShade: '#ffd98a', orbHalo: '#ffe7ad', orbHaloA: 0.22, orbR: 12,
      vignette: 0.12,
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
    var span = Math.max(2 * this.W, 1000);
    this.stars = [];
    var n = Math.round(this.W / 4);
    for (var i = 0; i < n; i++) {
      this.stars.push({ x: rnd() * this.W, y: rnd() * (HORIZON - 14), s: rnd() < 0.14 ? 2 : 1, p: rnd() * Math.PI * 2 });
    }
    // three ridge lines, near ones taller / jaggier
    this.ridgeFar  = this._ridge(rnd, span, 11, 22, 10);
    this.ridgeMid  = this._ridge(rnd, span, 18, 34, 7);
    this.ridgeNear = this._ridge(rnd, span, 26, 46, 5);
  };

  Scene.prototype.resize = function (w) {
    w = Math.max(240, Math.round(w) || BASE_W);
    if (w === this.W) return;
    this.W = w;
    this._build();
  };

  // A jagged ridge as a random walk in height — connected, natural, and
  // detailed enough to read as pixel mountains when rasterised per column.
  Scene.prototype._ridge = function (rnd, span, minH, maxH, step) {
    var pts = [], x = 0, h = minH + rnd() * (maxH - minH);
    while (x <= span) {
      h += (rnd() - 0.5) * (maxH - minH) * 0.4;
      if (h < minH) h = minH + (minH - h) * 0.3;
      if (h > maxH) h = maxH - (h - maxH) * 0.3;
      pts.push([x, HORIZON - h]);
      x += step * (0.8 + rnd() * 1.1);
    }
    pts.push([span, pts[pts.length - 1][1]]);
    return pts;
  };

  function ridgeYAt(pts, sx) {
    var lo = 0, hi = pts.length - 1;
    while (lo + 1 < hi) { var m = (lo + hi) >> 1; if (pts[m][0] <= sx) lo = m; else hi = m; }
    var a = pts[lo], b = pts[hi], w = b[0] - a[0];
    return a[1] + (b[1] - a[1]) * (w > 0 ? (sx - a[0]) / w : 0);
  }

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

    // sky — crisp horizontal bands (not a smooth gradient)
    var bh = HORIZON / T.sky.length;
    for (var b = 0; b < T.sky.length; b++) {
      ctx.fillStyle = T.sky[b];
      ctx.fillRect(0, Math.round(b * bh), W, Math.ceil(bh) + 1);
    }

    if (T.stars) {
      for (var i = 0; i < this.stars.length; i++) {
        var st = this.stars[i];
        ctx.globalAlpha = 0.3 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2 + st.p));
        ctx.fillStyle = PAL.c6;
        ctx.fillRect(st.x | 0, st.y | 0, st.s, st.s);
      }
      ctx.globalAlpha = 1;
    }

    // sun / moon — one dim halo disc (no big soft gradient), then the orb
    var ox = W - 62;
    ctx.globalAlpha = T.orbHaloA;
    ctx.fillStyle = T.orbHalo;
    ctx.beginPath(); ctx.arc(ox, 28, T.orbR + (T.night ? 5 : 9), 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = T.orbFill;
    ctx.beginPath(); ctx.arc(ox, 28, T.orbR, 0, Math.PI * 2); ctx.fill();
    if (T.night) {
      ctx.fillStyle = T.orbShade;
      ctx.beginPath(); ctx.arc(ox - 4, 25, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ox + 3, 31, 1.6, 0, Math.PI * 2); ctx.fill();
    }

    // ridgelines — rasterised per column so the edges stay crisp when upscaled
    this._drawRidge(ctx, this.ridgeFar,  this.distance * 0.10, T.ridgeFar,  T.ridgeShadeFar,  null);
    this._drawRidge(ctx, this.ridgeMid,  this.distance * 0.20, T.ridgeMid,  T.ridgeShadeMid,  T.night ? T.ridgeRim : null);
    this._drawRidge(ctx, this.ridgeNear, this.distance * 0.34, T.ridgeNear, T.ridgeShadeNear, T.ridgeRim);
    ctx.fillStyle = T.pine;
    repeat(W, this.distance * 0.34, 34, function (x) {
      Scene._pine(ctx, x + 7, HORIZON - 4, 6, 14);
      Scene._pine(ctx, x + 21, HORIZON - 2, 5, 10);
    });

    // road surface — two tones so it reads as receding tarmac, not a flat panel
    ctx.fillStyle = T.road;
    ctx.fillRect(0, HORIZON, W, H - HORIZON);
    ctx.fillStyle = T.roadNear;
    ctx.fillRect(0, HORIZON + 24, W, H - HORIZON - 24);
    ctx.fillStyle = T.shoulder; ctx.fillRect(0, HORIZON, W, 2);
    ctx.fillStyle = T.edgeFar; ctx.fillRect(0, HORIZON + 3, W, 1);
    ctx.fillStyle = T.edgeNear; ctx.fillRect(0, H - 4, W, 2);
    // centre line — small far dashes, plus faint big near dashes (scroll faster)
    ctx.fillStyle = T.dash;
    repeat(W, this.distance, 24, function (x) { ctx.fillRect(x, HORIZON + 15, 9, 2); });
    ctx.globalAlpha = 0.4;
    repeat(W, this.distance * 2.6, 68, function (x) { ctx.fillRect(x, H - 30, 22, 4); });
    ctx.globalAlpha = 1;

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
        var g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 8);
        g.addColorStop(0, 'rgba(226,164,90,0.26)'); g.addColorStop(1, 'rgba(226,164,90,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(lx, ly, 8, 0, Math.PI * 2); ctx.fill();
        var p = ctx.createRadialGradient(lx, HORIZON + 9, 0, lx, HORIZON + 9, 16);
        p.addColorStop(0, 'rgba(226,164,90,0.09)'); p.addColorStop(1, 'rgba(226,164,90,0)');
        ctx.fillStyle = p;
        ctx.beginPath(); ctx.ellipse(lx, HORIZON + 9, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
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

    // gentle vignette — only the corners, so it never washes the mountains
    var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.5, W / 2, H / 2, Math.max(W, H) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,' + T.vignette + ')');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  };

  // Rasterise the ridge one screen-column at a time: crisp vertical edges,
  // a lighter upper band for form, and an optional 1px rim on the skyline.
  Scene.prototype._drawRidge = function (ctx, pts, offset, color, shade, rim) {
    var W = this.W, span = pts[pts.length - 1][0];
    var off = ((offset % span) + span) % span;
    for (var x = 0; x < W; x++) {
      var y = Math.round(ridgeYAt(pts, (x + off) % span));
      var h = HORIZON - y;
      if (h <= 0) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, h);
      if (shade && h > 3) {
        ctx.fillStyle = shade;
        ctx.fillRect(x, y, 1, Math.max(1, (h * 0.38) | 0));
      }
      if (rim) {
        ctx.fillStyle = rim;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  };

  Scene._pine = function (ctx, x, baseY, w, h) {
    var steps = 5;
    for (var r = 0; r < steps; r++) {
      var ww = Math.max(1, Math.round((r + 1) / steps * w));
      var yy = baseY - Math.round((steps - r) / steps * h);
      ctx.fillRect(x - ww, yy, ww * 2, Math.ceil(h / steps) + 1);
    }
    ctx.fillRect(x - 1, baseY - 1, 2, 3); // trunk
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
