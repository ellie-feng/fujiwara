/*
 * Fujiwara — car sprite
 * ---------------------
 * The car is the supplied pixel-art image (assets/ndmiata.jpg). It ships on a
 * flat light-grey background, so on load we colour-key that out, crop to the
 * car, and cache the result on an offscreen canvas. Draw blits that sprite;
 * the night light layer adds a head/tail glow at anchor points derived from
 * the sprite's bounding box.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Car = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TARGET_W = 116;          // car width in the 320px scene
  var BG = [237, 237, 237];    // the image's flat background grey
  var BG_TOL = 22;

  var sprite = null;           // offscreen canvas, cropped to the car
  var sprW = 0, sprH = 0;
  var scale = 1, drawW = TARGET_W, drawH = 40;
  var ready = false;

  function keyAndCrop(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    var im = x.getImageData(0, 0, w, h);
    var d = im.data;
    var minx = w, miny = h, maxx = 0, maxy = 0;
    for (var p = 0; p < d.length; p += 4) {
      var r = d[p], g = d[p + 1], b = d[p + 2];
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      var isBg = (mx - mn) < 22 &&
        Math.abs(r - BG[0]) < BG_TOL && Math.abs(g - BG[1]) < BG_TOL && Math.abs(b - BG[2]) < BG_TOL;
      if (isBg) {
        d[p + 3] = 0;
      } else {
        var idx = p / 4;
        var px = idx % w, py = (idx / w) | 0;
        if (px < minx) minx = px; if (px > maxx) maxx = px;
        if (py < miny) miny = py; if (py > maxy) maxy = py;
      }
    }
    x.putImageData(im, 0, 0);

    var cw = Math.max(1, maxx - minx + 1), ch = Math.max(1, maxy - miny + 1);
    var out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    out.getContext('2d').drawImage(c, minx, miny, cw, ch, 0, 0, cw, ch);

    sprite = out; sprW = cw; sprH = ch;
    scale = TARGET_W / sprW;
    drawW = TARGET_W;
    drawH = Math.round(sprH * scale);
    ready = true;
  }

  var Car = {
    get WIDTH() { return drawW; },
    get HEIGHT() { return drawH; },
    ready: function () { return ready; },

    /** Kick off the async sprite load. `src` defaults to the bundled image. */
    load: function (src) {
      var img = new Image();
      img.onload = function () {
        try { keyAndCrop(img); } catch (e) { /* leave placeholder */ }
      };
      img.src = src || 'assets/ndmiata.jpg';
      return this;
    },

    /**
     * @param {number} groundX  ground-contact x (canvas px)
     * @param {number} groundY  ground-contact y (canvas px)
     * @param {object} o  { moving, bob, brake }  (bob is a phase, radians)
     */
    draw: function (ctx, groundX, groundY, o) {
      o = o || {};
      var bob = o.moving ? Math.round(Math.sin(o.bob || 0) * 0.6) : 0;
      var x = Math.round(groundX - drawW / 2);
      var y = Math.round(groundY - drawH - bob);

      // ground shadow
      ctx.fillStyle = 'rgba(8,8,14,0.38)';
      ctx.beginPath();
      ctx.ellipse(Math.round(groundX), groundY - 1, drawW * 0.46, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();

      if (ready) {
        var sm = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = true; // clean downscale of the source art
        ctx.drawImage(sprite, 0, 0, sprW, sprH, x, y, drawW, drawH);
        ctx.imageSmoothingEnabled = sm;
      } else {
        ctx.fillStyle = '#cd5b52';
        ctx.fillRect(x, y + drawH * 0.4, drawW, drawH * 0.5);
      }
    },

    /** Additive night light layer — call after the scene, before the vignette. */
    drawLights: function (ctx, groundX, groundY, o) {
      o = o || {};
      if ((o.headlights == null ? 1 : o.headlights) <= 0.01) {
        return; // daytime: no glow
      }
      var bob = o.moving ? Math.round(Math.sin(o.bob || 0) * 0.6) : 0;
      var topY = groundY - drawH - bob;
      var hx = groundX - drawW / 2 + drawW * 0.94;
      var hy = topY + drawH * 0.52;
      var tx = groundX - drawW / 2 + drawW * 0.05;
      var ty = topY + drawH * 0.48;
      var flick = 0.92 + 0.08 * Math.sin((o.bob || 0) * 0.7);

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // headlight beam + bloom
      var g = ctx.createLinearGradient(hx, hy, hx + 52, hy + 10);
      g.addColorStop(0, 'rgba(226,164,90,' + (0.32 * flick).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(226,164,90,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(hx, hy - 3); ctx.lineTo(hx + 54, hy + 4);
      ctx.lineTo(hx + 54, hy + 12); ctx.lineTo(hx, hy + 3);
      ctx.closePath(); ctx.fill();
      var b = ctx.createRadialGradient(hx, hy, 0, hx, hy, 5);
      b.addColorStop(0, 'rgba(236,230,211,' + (0.5 * flick).toFixed(3) + ')');
      b.addColorStop(1, 'rgba(236,230,211,0)');
      ctx.fillStyle = b;
      ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fill();

      // tail glow
      var tg = o.brake ? 0.7 : 0.36;
      var r = ctx.createRadialGradient(tx, ty, 0, tx, ty, 7);
      r.addColorStop(0, 'rgba(205,91,82,' + tg.toFixed(3) + ')');
      r.addColorStop(1, 'rgba(205,91,82,0)');
      ctx.fillStyle = r;
      ctx.beginPath(); ctx.arc(tx, ty, 7, 0, Math.PI * 2); ctx.fill();

      ctx.restore();
    }
  };

  return Car;
});
