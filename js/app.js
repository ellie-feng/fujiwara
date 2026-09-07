/*
 * Fujiwara — app wiring
 * ---------------------
 * Binds the pure PomodoroTimer to the Scene renderer and the digital dash.
 *   - big readout  = time remaining (MM:SS)
 *   - progress bar = session progress
 *   - box 1        = lifetime study minutes (persisted)
 *   - box 2 / 3    = study / break length steppers
 *   - box 4        = day / night scene toggle
 */
(function () {
  'use strict';

  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem('fujiwara.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('fujiwara.' + k, String(v)); } catch (e) {} }
  };

  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d');

  Car.load();
  var scene = new Scene();

  // Match the internal buffer to the viewport aspect (fixed 180px tall) so the
  // scene fills the window without a heavy horizontal crop.
  function fitCanvas() {
    var vw = window.innerWidth || 320, vh = window.innerHeight || 180;
    var w = Math.round(Scene.H * vw / vh);
    if (!isFinite(w) || w < 248) w = 248;
    if (w > 640) w = 640;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== Scene.H) canvas.height = Scene.H;
    ctx.imageSmoothingEnabled = false; // resizing the canvas resets ctx state
    scene.resize(w);
  }
  fitCanvas();
  var fitT = 0;
  window.addEventListener('resize', function () {
    clearTimeout(fitT);
    fitT = setTimeout(fitCanvas, 120);
  });

  var elClock = document.getElementById('clock');
  var elPhase = document.getElementById('phase');
  var elProgress = document.getElementById('progress');
  var elTotal = document.getElementById('total-min');
  var elFocusVal = document.getElementById('focus-val');
  var elBreakVal = document.getElementById('break-val');
  var elSceneBtn = document.getElementById('btn-scene');
  var elSceneIcon = document.getElementById('scene-icon');
  var elSceneVal = document.getElementById('scene-val');
  var elPlayPause = document.getElementById('btn-playpause');
  var elReset = document.getElementById('btn-reset');
  var elSkip = document.getElementById('btn-skip');

  var PHASE_LABEL = { focus: 'FOCUS', break: 'BREAK', longBreak: 'LONG BREAK' };

  // ---- pixel-art transport icons (rect-per-pixel SVG, crisp edges) ----
  var ICONS = {
    play: [
      '#......',
      '##.....',
      '###....',
      '####...',
      '#####..',
      '######.',
      '#####..',
      '####...',
      '###....',
      '##.....',
      '#......'
    ],
    pause: [
      '##...##',
      '##...##',
      '##...##',
      '##...##',
      '##...##',
      '##...##',
      '##...##',
      '##...##',
      '##...##',
      '##...##',
      '##...##'
    ],
    skip: [
      '#.......##',
      '##......##',
      '###.....##',
      '####....##',
      '#####...##',
      '######..##',
      '#####...##',
      '####....##',
      '###.....##',
      '##......##',
      '#.......##'
    ],
    reset: [
      '..#######....',
      '.####...###..',
      '.###.....###.',
      '.##.......###',
      '.##......####',
      '.##.......###',
      '.##........#.',
      '.##..........',
      '.##.......##.',
      '.###.....###.',
      '.####...####.',
      '..#########..'
    ]
  };

  function pxSprite(rows) {
    var h = rows.length, w = rows[0].length, cells = '';
    for (var y = 0; y < h; y++) {
      var x = 0;
      while (x < w) {
        if (rows[y].charAt(x) === '#') {
          var start = x;
          while (x < w && rows[y].charAt(x) === '#') x++;
          cells += '<rect x="' + start + '" y="' + y + '" width="' + (x - start) + '" height="1"/>';
        } else { x++; }
      }
    }
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" shape-rendering="crispEdges" aria-hidden="true">' + cells + '</svg>';
  }

  document.getElementById('btn-skip').innerHTML = pxSprite(ICONS.skip);
  document.getElementById('btn-reset').innerHTML = pxSprite(ICONS.reset);
  document.getElementById('btn-playpause').innerHTML =
    '<span class="i-play">' + pxSprite(ICONS.play) + '</span>' +
    '<span class="i-pause">' + pxSprite(ICONS.pause) + '</span>';

  // ---- fuel-gauge segments (focus drains the tank, a break refills it) ----
  var SEG_N = 30;
  var elFuelPct = document.getElementById('fuel-pct');
  var segs = [];
  for (var s = 0; s < SEG_N; s++) {
    var el = document.createElement('span');
    el.className = 'seg';
    elProgress.appendChild(el);
    segs.push(el);
  }

  // ---- persisted settings ----
  var focusMin = clampInt(LS.get('focusMin', 25), 1, 180, 25);
  var breakMin = clampInt(LS.get('breakMin', 5), 1, 60, 5);
  var totalFocusMs = Math.max(0, parseInt(LS.get('totalFocusMs', 0), 10) || 0);
  var sceneMode = LS.get('sceneMode', 'night') === 'day' ? 'day' : 'night';

  scene.setSceneMode(sceneMode);
  applySceneChrome();

  function clampInt(v, lo, hi, dflt) {
    v = parseInt(v, 10);
    if (!isFinite(v)) v = dflt;
    return Math.min(hi, Math.max(lo, v));
  }

  var timer = new PomodoroTimer({
    focusMs: focusMin * 60000,
    breakMs: breakMin * 60000,
    autoStartNext: true, // focus -> break -> focus rolls on without a click
    onPhase: function (state) {
      scene.setPhase(state.phase);
      document.body.dataset.phase = state.phase === 'focus' ? 'focus' : 'break';
      renderHUD(state);
      ping(state.phase);
    },
    onTick: renderHUD
  });

  // ---- lifetime study-minute accumulator ----
  var lastRem = null, lastPhase = 'focus', persistAcc = 0;
  function accumulate(state) {
    if (state.phase === 'focus' && lastPhase === 'focus' &&
        lastRem != null && state.remainingMs < lastRem) {
      var d = lastRem - state.remainingMs;
      totalFocusMs += d;
      persistAcc += d;
      if (persistAcc > 15000) { LS.set('totalFocusMs', totalFocusMs); persistAcc = 0; }
    }
    lastRem = state.remainingMs;
    lastPhase = state.phase;
  }

  // ---- HUD render ----
  function renderHUD(state) {
    accumulate(state);

    elClock.textContent = PomodoroTimer.formatClock(state.remainingMs);
    elPhase.textContent = PHASE_LABEL[state.phase] || state.phase;
    document.title = PomodoroTimer.formatClock(state.remainingMs) + ' · ' +
      (PHASE_LABEL[state.phase] || state.phase) + ' — Fujiwara';

    // fuel: a focus block burns the tank down; a break tops it back up
    var fuel = (state.phase === 'focus') ? (1 - state.progress) : state.progress;
    var lit = Math.round(fuel * SEG_N);
    var lowTank = fuel <= 0.25;
    for (var i = 0; i < SEG_N; i++) {
      var on = i < lit;
      segs[i].classList.toggle('on', on);
      segs[i].classList.toggle('low', on && lowTank);
    }
    elFuelPct.textContent = Math.round(fuel * 100) + '%';
    elProgress.setAttribute('aria-valuenow', Math.round(fuel * 100));

    elTotal.textContent = Math.floor(totalFocusMs / 60000).toLocaleString();

    elPlayPause.classList.toggle('running', state.running);
    elPlayPause.setAttribute('aria-pressed', String(state.running));

    setConfigLocked(state.running);
  }

  function renderConfig() {
    if (document.activeElement !== elFocusVal) elFocusVal.value = focusMin;
    if (document.activeElement !== elBreakVal) elBreakVal.value = breakMin;
  }

  // Study / break lengths can't be changed mid-session — grey them out while
  // the timer is running; edits resume when it's paused.
  var configLocked = null;
  var steppers = document.querySelectorAll('.box.stepper');
  function setConfigLocked(locked) {
    if (locked === configLocked) return;
    configLocked = locked;
    elFocusVal.disabled = locked;
    elBreakVal.disabled = locked;
    document.querySelectorAll('.adj').forEach(function (b) { b.disabled = locked; });
    steppers.forEach(function (b) { b.classList.toggle('locked', locked); });
  }

  function applySceneChrome() {
    var day = scene.mode === 'day';
    elSceneIcon.textContent = day ? '☀' : '☾';
    elSceneVal.textContent = day ? 'DAY' : 'NIGHT';
  }

  // ---- phase-change blip ----
  var actx = null;
  function ping(phase) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square';
      o.frequency.value = phase === 'focus' ? 523 : 392;
      g.gain.value = 0.04;
      o.connect(g); g.connect(actx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.25);
      o.stop(actx.currentTime + 0.26);
    } catch (e) {}
  }

  // ---- controls ----
  elPlayPause.addEventListener('click', function () {
    timer.toggle();
    scene.setRunning(timer.running);
    if (actx && actx.state === 'suspended') actx.resume();
    renderHUD(timer.getState());
  });
  elReset.addEventListener('click', function () {
    timer.reset();
    scene.setRunning(false);
    scene.setPhase('focus');
    document.body.dataset.phase = 'focus';
    renderHUD(timer.getState());
  });
  elSkip.addEventListener('click', function () {
    timer.skip();
    scene.setRunning(timer.running);
    renderHUD(timer.getState());
  });

  function setFocusMin(v) {
    focusMin = clampInt(v, 1, 180, focusMin);
    LS.set('focusMin', focusMin);
    timer.configure({ focusMs: focusMin * 60000 });
    renderConfig();
    renderHUD(timer.getState());
  }
  function setBreakMin(v) {
    breakMin = clampInt(v, 1, 60, breakMin);
    LS.set('breakMin', breakMin);
    timer.configure({ breakMs: breakMin * 60000 });
    renderConfig();
    renderHUD(timer.getState());
  }

  // steppers
  document.querySelectorAll('.adj').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var dir = parseInt(btn.dataset.dir, 10);
      if (btn.dataset.adj === 'focus') setFocusMin(focusMin + dir);
      else setBreakMin(breakMin + dir);
    });
  });

  // typed entry
  function wireNum(el, apply) {
    el.addEventListener('focus', function () { el.select(); });
    el.addEventListener('change', function () { apply(el.value); });
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter') el.blur(); });
  }
  wireNum(elFocusVal, setFocusMin);
  wireNum(elBreakVal, setBreakMin);

  elSceneBtn.addEventListener('click', function () {
    var mode = scene.toggleSceneMode();
    LS.set('sceneMode', mode);
    applySceneChrome();
  });

  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
    if (e.code === 'Space') { e.preventDefault(); elPlayPause.click(); }
    else if (e.key === 'r' || e.key === 'R') elReset.click();
    else if (e.key === 's' || e.key === 'S') elSkip.click();
  });

  // ---- clock via setInterval so it keeps wall-clock time when backgrounded ----
  setInterval(function () { timer.update(performance.now()); }, 250);
  function persistNow() { LS.set('totalFocusMs', totalFocusMs); persistAcc = 0; }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { persistNow(); }
    else { timer.update(performance.now()); last = performance.now(); }
  });
  window.addEventListener('pagehide', persistNow);

  // ---- render loop ----
  var last = performance.now();
  function frame(now) {
    var dt = now - last;
    last = now;
    scene.setRunning(timer.running);
    scene.update(dt);
    scene.render(ctx);
    requestAnimationFrame(frame);
  }

  renderConfig();
  renderHUD(timer.getState());
  scene.render(ctx);
  requestAnimationFrame(frame);

  // ?autostart (also ?play / ?demo) — begin the countdown on load, so an
  // embed shows a live session without the viewer touching anything.
  var qs = new URLSearchParams(location.search);
  if (qs.has('autostart') || qs.has('play') || qs.has('demo')) {
    timer.start();
    scene.setRunning(true);
    renderHUD(timer.getState());
  }

  window.Fujiwara = { timer: timer, scene: scene };
})();
