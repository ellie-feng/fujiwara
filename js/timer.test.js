/*
 * Standalone tests for js/timer.js — no framework, no build step.
 * Open tests.html in a browser, or run with node:  node js/timer.test.js
 */
(function () {
  'use strict';

  var PomodoroTimer = (typeof module === 'object' && module.exports)
    ? require('./timer.js')
    : window.PomodoroTimer;

  var results = [];
  function assert(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: cond ? '' : (detail || '') });
  }
  function eq(name, actual, expected) {
    assert(name, actual === expected, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
  function near(name, actual, expected, tol) {
    tol = tol || 1;
    assert(name, Math.abs(actual - expected) <= tol, 'expected ~' + expected + ', got ' + actual);
  }

  var MIN = 60 * 1000;

  // --- initial state -------------------------------------------------------
  (function () {
    var t = new PomodoroTimer();
    var s = t.getState();
    eq('initial phase is focus', s.phase, 'focus');
    eq('initial not running', s.running, false);
    eq('initial remaining = 25min', s.remainingMs, 25 * MIN);
    eq('initial progress = 0', s.progress, 0);
    eq('initial completedFocus = 0', s.completedFocus, 0);
  })();

  // --- countdown ---------------------------------------------------------
  (function () {
    var t = new PomodoroTimer({ focusMs: 10 * MIN, breakMs: 2 * MIN });
    t.start();
    t.advance(3 * MIN);
    near('after 3min, 7min remain', t.getState().remainingMs, 7 * MIN);
    near('progress ~0.3', t.getState().progress, 0.3, 0.001);
  })();

  // --- pause halts advance ---------------------------------------------
  (function () {
    var fakeNow = 0;
    var t = new PomodoroTimer({ focusMs: 10 * MIN, now: function () { return fakeNow; } });
    t.start();
    fakeNow = 1000; t.update(fakeNow); // seed
    fakeNow = 61000; t.update(fakeNow); // +60s
    near('ran 60s', t.getState().remainingMs, 9 * MIN);
    t.pause();
    fakeNow = 600000; t.update(fakeNow); // long gap while paused
    near('paused: no further drain', t.getState().remainingMs, 9 * MIN);
  })();

  // --- focus -> break transition -------------------------------------
  (function () {
    var phases = [];
    var completes = 0;
    var t = new PomodoroTimer({
      focusMs: 5 * MIN, breakMs: 1 * MIN,
      onPhase: function (s) { phases.push(s.phase); },
      onComplete: function () { completes++; }
    });
    t.start();
    t.advance(5 * MIN);
    eq('transitioned to break', t.getState().phase, 'break');
    eq('onPhase fired with break', phases[phases.length - 1], 'break');
    eq('onComplete fired once', completes, 1);
    eq('completedFocus incremented', t.getState().completedFocus, 1);
    eq('break duration loaded', t.getState().remainingMs, 1 * MIN);
    eq('auto-pauses at transition by default', t.getState().running, false);
  })();

  // --- carry-over time applies to next phase ------------------------
  (function () {
    var t = new PomodoroTimer({ focusMs: 5 * MIN, breakMs: 1 * MIN, autoStartNext: true });
    t.start();
    t.advance(5 * MIN + 20 * 1000); // 20s past the end
    eq('still on break', t.getState().phase, 'break');
    near('carry-over consumed from break', t.getState().remainingMs, 1 * MIN - 20 * 1000);
  })();

  // --- long break every 4th focus ---------------------------------
  (function () {
    var t = new PomodoroTimer({
      focusMs: 1 * MIN, breakMs: 1 * MIN, longBreakMs: 3 * MIN,
      longBreakEvery: 4, autoStartNext: true
    });
    t.start();
    var seen = [];
    for (var i = 0; i < 8; i++) { t.advance(1 * MIN); seen.push(t.getState().phase); }
    // sequence: break, focus, break, focus, break, focus, longBreak, focus
    eq('1st rest is short break', seen[0], 'break');
    eq('2nd rest is short break', seen[2], 'break');
    eq('3rd rest is short break', seen[4], 'break');
    eq('4th rest is long break', seen[6], 'longBreak');
  })();

  // --- skip ---------------------------------------------------------
  (function () {
    var t = new PomodoroTimer({ focusMs: 25 * MIN, breakMs: 5 * MIN });
    t.start();
    t.skip();
    eq('skip jumps to break', t.getState().phase, 'break');
    eq('skip loads full break', t.getState().remainingMs, 5 * MIN);
  })();

  // --- reset ------------------------------------------------------
  (function () {
    var t = new PomodoroTimer({ focusMs: 25 * MIN });
    t.start();
    t.advance(10 * MIN);
    t.skip();
    t.reset();
    var s = t.getState();
    eq('reset -> focus', s.phase, 'focus');
    eq('reset -> not running', s.running, false);
    eq('reset -> full clock', s.remainingMs, 25 * MIN);
    eq('reset -> completedFocus 0', s.completedFocus, 0);
  })();

  // --- configure while idle updates clock ----------------------
  (function () {
    var t = new PomodoroTimer();
    t.configure({ focusMs: 50 * MIN });
    eq('configure updates idle clock', t.getState().remainingMs, 50 * MIN);
    t.configure({ focusMs: -1 });
    eq('invalid duration ignored', t.getState().remainingMs, 50 * MIN);
  })();

  // --- formatClock -------------------------------------------
  (function () {
    eq('format 25:00', PomodoroTimer.formatClock(25 * MIN), '25:00');
    eq('format 04:05', PomodoroTimer.formatClock(4 * MIN + 5000), '04:05');
    eq('format 00:00', PomodoroTimer.formatClock(0), '00:00');
    eq('format rounds up partial second', PomodoroTimer.formatClock(1), '00:01');
  })();

  // --- report -------------------------------------------------
  var passed = results.filter(function (r) { return r.pass; }).length;
  var total = results.length;
  var summary = passed + ' / ' + total + ' passed';

  if (typeof document !== 'undefined') {
    var el = document.getElementById('results');
    if (el) {
      el.innerHTML = results.map(function (r) {
        return '<div class="row ' + (r.pass ? 'ok' : 'fail') + '">' +
          '<span class="mark">' + (r.pass ? 'PASS' : 'FAIL') + '</span> ' +
          r.name + (r.detail ? ' <em>(' + r.detail + ')</em>' : '') + '</div>';
      }).join('');
    }
    var sEl = document.getElementById('summary');
    if (sEl) {
      sEl.textContent = summary;
      sEl.className = (passed === total) ? 'ok' : 'fail';
    }
  }

  if (typeof console !== 'undefined') {
    results.forEach(function (r) {
      console[r.pass ? 'log' : 'error']((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.detail ? ' — ' + r.detail : ''));
    });
    console.log(summary);
  }

  if (typeof process !== 'undefined' && process.exit) {
    process.exit(passed === total ? 0 : 1);
  }
})();
