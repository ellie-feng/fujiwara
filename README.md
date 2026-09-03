# Fujiwara

A pixel-art **pomodoro timer** with a night-run theme. Full-screen: you're
looking out the windscreen of a red **ND Mazda MX-5** as it drives side-on over
a scrolling parallax touge backdrop, with a **VDO-style digital dash** across the
bottom. When a break starts the car eases off the road and pulls into a **gas
station** or a **drive-through** (the two alternate); when the break ends it
pulls back out and the run resumes.

The dash is a green-LCD cluster:

- **big readout** = time remaining (MM:SS)
- **progress bar** = session progress, redline near the end
- **box 1** = lifetime study minutes (persisted in `localStorage`)
- **box 2 / 3** = study / break length steppers (▲ ▼)
- **box 4** = day / night scene toggle

The car is the supplied pixel-art image (`assets/ndmiata.jpg`); its flat grey
background is colour-keyed out and cropped at load. Limited retro palette
(`js/palette.js`) — a cool ramp with two warm accents — is shared by the
scene and the HUD, with a separate daytime theme in `js/scene.js`.

The scene's internal buffer is a fixed 180px tall and flexes its width to the
window aspect, so it fills the viewport without a heavy crop.

No build step, no dependencies. Open `index.html`.

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Controls

| Action        | Button        | Key     |
| ------------- | ------------- | ------- |
| Start / pause | ▶ START / ❚❚  | `Space` |
| Skip phase    | SKIP ▶▶        | `S`     |
| Reset         | RESET         | `R`     |

Focus / break lengths are configurable in the panel (default **25 / 5** min).
Every 4th focus block is followed by a longer break.

The HUD shows the countdown in a pixel font, a **fuel gauge** that drains over a
focus block and refuels on a break, a **trip meter** (8.6 km per completed run —
the length of Akina's downhill), and a dot per completed pomodoro.

## Project layout

```
index.html         markup + digital dash
styles.css         full-bleed canvas + green-LCD cluster styling
js/palette.js       the shared limited colour ramp
js/timer.js         PomodoroTimer — pure state machine, no DOM, no timers of its own
js/car.js           loads assets/ndmiata.jpg, keys out the bg, blits it + night lights
js/scene.js         night parallax world, break destinations, scene state machine
js/app.js           wires the timer to the scene and the dash
js/timer.test.js    standalone assertions for the timer
tests.html          runs the timer tests in the browser
assets/ndmiata.jpg  reference the car sprite was built from
assets/86.jpg       earlier AE86 reference (unused)
```

### Architecture note

`js/timer.js` is deliberately independent of the visual layer. It never touches
the DOM and owns no interval/rAF loop — the host advances it with
`timer.update(now)` (frame-driven) or `timer.advance(deltaMs)` (tests). `app.js`
drives it from a `setInterval` so the countdown keeps real wall-clock time even
when the tab is backgrounded, while the scene renders from `requestAnimationFrame`
and simply eases toward whatever visual state the current phase implies.

## Tests

```bash
node js/timer.test.js      # exit 0 on pass
```

or open `tests.html` in a browser.

## Scope

v1 is the visual + timer core only. Not included yet: todo list, Spotify widget,
livery customization, day/weather variants.
