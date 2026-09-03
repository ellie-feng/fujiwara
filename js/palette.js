/*
 * Fujiwara — shared limited palette
 * ---------------------------------
 * A deliberately small night ramp (cool blues + two warm accents) used by
 * every layer: scene, car sprite and HUD. Keeping it in one place means the
 * canvas and the CSS never drift apart.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PAL = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return {
    c0: '#10111c', // ink / outlines / deepest shadow
    c1: '#20233a', // sky top
    c2: '#333a5f', // sky at horizon / far ridge / glass
    c3: '#474f79', // near ridge
    c4: '#5b6591', // road / guardrail
    c5: '#8e9bbd', // lane dashes / haze / dim text
    c6: '#ece6d3', // moon, stars, primary text
    c7: '#cd5b52', // Miata red / tail lamps (warm accent)
    c8: '#e2a45a', // street lamps / headlights / fuel gauge (warm secondary)

    // car-specific red ramp derived from c7
    carDark: '#8a3f42',
    carMid:  '#cd5b52',
    carLite: '#e58c72'
  };
});
