/*
 * Fujiwara — Pomodoro timer logic
 * ---------------------------------
 * Pure state machine. No DOM, no timers of its own. The host drives it by
 * calling `update(nowMs)` once per frame (or `advance(deltaMs)` directly in
 * tests). This keeps the countdown fully deterministic and unit-testable
 * independent of the rendering layer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PomodoroTimer = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN = 60 * 1000;

  var DEFAULTS = {
    focusMs: 25 * MIN,
    breakMs: 5 * MIN,
    longBreakMs: 15 * MIN,
    longBreakEvery: 4, // every Nth focus is followed by a long break
    autoStartNext: false
  };

  function clampDuration(ms, fallback) {
    ms = Number(ms);
    if (!isFinite(ms) || ms <= 0) return fallback;
    return Math.round(ms);
  }

  function PomodoroTimer(options) {
    options = options || {};
    this._cfg = {
      focusMs: clampDuration(options.focusMs, DEFAULTS.focusMs),
      breakMs: clampDuration(options.breakMs, DEFAULTS.breakMs),
      longBreakMs: clampDuration(options.longBreakMs, DEFAULTS.longBreakMs),
      longBreakEvery: Math.max(1, Math.round(options.longBreakEvery || DEFAULTS.longBreakEvery)),
      autoStartNext: !!options.autoStartNext
    };

    // callbacks
    this.onTick = options.onTick || null;         // (state)          — every advance
    this.onPhase = options.onPhase || null;       // (state, prevPhase) — phase changed
    this.onComplete = options.onComplete || null; // (state)          — a focus block finished

    // injectable clock for tests
    this._now = options.now || function () {
      return (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
    };

    this.phase = 'focus';                 // 'focus' | 'break' | 'longBreak'
    this.running = false;
    this.remainingMs = this._cfg.focusMs;
    this.totalMs = this._cfg.focusMs;
    this.completedFocus = 0;              // pomodoros finished
    this._focusSinceLongBreak = 0;
    this._lastNow = null;
  }

  PomodoroTimer.prototype.durationFor = function (phase) {
    if (phase === 'break') return this._cfg.breakMs;
    if (phase === 'longBreak') return this._cfg.longBreakMs;
    return this._cfg.focusMs;
  };

  PomodoroTimer.prototype.getState = function () {
    var progress = this.totalMs > 0
      ? Math.min(1, Math.max(0, 1 - this.remainingMs / this.totalMs))
      : 0;
    return {
      phase: this.phase,
      isBreak: this.phase !== 'focus',
      running: this.running,
      remainingMs: Math.max(0, Math.round(this.remainingMs)),
      totalMs: this.totalMs,
      progress: progress,
      completedFocus: this.completedFocus
    };
  };

  PomodoroTimer.prototype.configure = function (patch) {
    patch = patch || {};
    if (patch.focusMs != null) this._cfg.focusMs = clampDuration(patch.focusMs, this._cfg.focusMs);
    if (patch.breakMs != null) this._cfg.breakMs = clampDuration(patch.breakMs, this._cfg.breakMs);
    if (patch.longBreakMs != null) this._cfg.longBreakMs = clampDuration(patch.longBreakMs, this._cfg.longBreakMs);
    if (patch.longBreakEvery != null) this._cfg.longBreakEvery = Math.max(1, Math.round(patch.longBreakEvery));
    if (patch.autoStartNext != null) this._cfg.autoStartNext = !!patch.autoStartNext;

    // If the current phase isn't running, keep its clock in sync with the new
    // duration so the UI reflects the change immediately.
    if (!this.running) {
      this.totalMs = this.durationFor(this.phase);
      this.remainingMs = this.totalMs;
      this._emitTick();
    }
    return this;
  };

  PomodoroTimer.prototype.getConfig = function () {
    return {
      focusMs: this._cfg.focusMs,
      breakMs: this._cfg.breakMs,
      longBreakMs: this._cfg.longBreakMs,
      longBreakEvery: this._cfg.longBreakEvery,
      autoStartNext: this._cfg.autoStartNext
    };
  };

  PomodoroTimer.prototype.start = function () {
    if (this.running) return this;
    this.running = true;
    this._lastNow = null; // seed on next update()
    this._emitTick();
    return this;
  };

  PomodoroTimer.prototype.pause = function () {
    this.running = false;
    this._lastNow = null;
    this._emitTick();
    return this;
  };

  PomodoroTimer.prototype.toggle = function () {
    return this.running ? this.pause() : this.start();
  };

  PomodoroTimer.prototype.reset = function () {
    this.running = false;
    this._lastNow = null;
    this.phase = 'focus';
    this.completedFocus = 0;
    this._focusSinceLongBreak = 0;
    this.totalMs = this._cfg.focusMs;
    this.remainingMs = this._cfg.focusMs;
    this._emitPhase('focus');
    this._emitTick();
    return this;
  };

  // Jump straight to the end of the current phase and transition.
  PomodoroTimer.prototype.skip = function () {
    this.remainingMs = 0;
    this._rollover();
    this._emitTick();
    return this;
  };

  // Frame-driven entry point. `nowMs` is a monotonic millisecond timestamp.
  PomodoroTimer.prototype.update = function (nowMs) {
    if (!this.running) return this.getState();
    if (nowMs == null) nowMs = this._now();
    if (this._lastNow == null) {
      this._lastNow = nowMs;
      return this.getState();
    }
    var delta = nowMs - this._lastNow;
    this._lastNow = nowMs;
    if (delta < 0) delta = 0; // guard against a clock that ran backwards
    return this.advance(delta);
  };

  // Deterministic core: subtract `deltaMs`, rolling phases over as needed.
  PomodoroTimer.prototype.advance = function (deltaMs) {
    deltaMs = Math.max(0, Number(deltaMs) || 0);
    this.remainingMs -= deltaMs;
    var guard = 0;
    while (this.remainingMs <= 0 && guard++ < 1000) {
      var carry = -this.remainingMs;
      this._rollover();
      this.remainingMs -= carry; // apply leftover time to the new phase
    }
    this._emitTick();
    return this.getState();
  };

  PomodoroTimer.prototype._rollover = function () {
    var prev = this.phase;
    var next;
    if (prev === 'focus') {
      this.completedFocus++;
      this._focusSinceLongBreak++;
      if (this._focusSinceLongBreak >= this._cfg.longBreakEvery) {
        this._focusSinceLongBreak = 0;
        next = 'longBreak';
      } else {
        next = 'break';
      }
    } else {
      next = 'focus';
    }

    this.phase = next;
    this.totalMs = this.durationFor(next);
    this.remainingMs = this.totalMs;

    if (!this._cfg.autoStartNext) {
      this.running = false;
      this._lastNow = null;
    }

    if (prev === 'focus' && typeof this.onComplete === 'function') {
      this.onComplete(this.getState());
    }
    this._emitPhase(prev);
  };

  PomodoroTimer.prototype._emitTick = function () {
    if (typeof this.onTick === 'function') this.onTick(this.getState());
  };

  PomodoroTimer.prototype._emitPhase = function (prevPhase) {
    if (typeof this.onPhase === 'function') this.onPhase(this.getState(), prevPhase);
  };

  // Formatting helper (kept here so tests and UI agree).
  PomodoroTimer.formatClock = function (ms) {
    ms = Math.max(0, Math.round(ms));
    var totalSeconds = Math.ceil(ms / 1000);
    var m = Math.floor(totalSeconds / 60);
    var s = totalSeconds % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  };

  PomodoroTimer.DEFAULTS = DEFAULTS;
  return PomodoroTimer;
});
