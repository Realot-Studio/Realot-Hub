// Run from the folder containing index.html:  node tests/unit-game-loop-time-scale.mjs
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = resolve(process.argv[2] || process.cwd());
const load = (rel) => import(pathToFileURL(ROOT + '/' + rel).href);

let fakeNow = 0, rafCb = null;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
globalThis.cancelAnimationFrame = () => {};
globalThis.performance = { now: () => fakeNow };
const { GameLoop } = await load('project/runtime/core/GameLoop.js');
function make(scale) {
  const calls = { world: [], scripts: [], unscaled: [], tick: [] };
  const world = { timeScale: 1, update: (dt) => calls.world.push(dt) };
  const scriptSystem = { scriptApi: { time: { scale } }, update: (w, dt) => calls.scripts.push(dt), setUnscaledDelta: (v) => calls.unscaled.push(v) };
  const loop = new GameLoop(world, { scriptSystem, onTick: (dt) => calls.tick.push(dt) });
  loop.memoryWatchdog.update = () => {};
  loop.start(); return { loop, calls, world, scriptSystem };
}
function frame(ms) { fakeNow += ms; const cb = rafCb; cb(fakeNow); }
const near = (a, b) => Math.abs(a - b) < 1e-9;
let fail = 0; const T = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x !== '' ? '  -> ' + x : '')); if (!ok) fail++; };
for (const [scale, expect] of [[1, 0.016], [0.5, 0.008], [2, 0.032], [10, 0.16]]) {
  fakeNow = 0; const t = make(scale); frame(16);
  T(`scale ${scale}: world.update dt = ${expect}`, near(t.calls.world[0], expect), t.calls.world[0]);
  T(`scale ${scale}: onTick/unscaled get REAL dt (0.016)`, near(t.calls.tick[0], 0.016) && near(t.calls.unscaled[0], 0.016));
  T(`scale ${scale}: world.timeScale published`, t.world.timeScale === scale);
}
{ fakeNow = 0; const t = make(100); frame(16); T('scale 100 per-frame game time capped at 0.5 s', near(t.calls.world[0], 0.5), t.calls.world[0]); }
{ fakeNow = 0; const t = make(0); frame(16);
  T('scale 0: world still updates, with dt exactly 0 (render keeps running)', t.calls.world.length === 1 && t.calls.world[0] === 0);
  T('scale 0: scripts get REAL unscaled dt for menus', near(t.calls.unscaled[0], 0.016)); }
{ fakeNow = 0; const t = make(1); frame(500); T('tab-out spike clamped to 0.1 s at scale 1', near(t.calls.world[0], 0.1)); 
  t.scriptSystem.scriptApi.time.scale = 0.5; frame(500); T('0.1 s raw clamp then scaled -> 0.05 at scale 0.5', near(t.calls.world[1], 0.05), t.calls.world[1]); }
{ fakeNow = 0; for (const bad of [NaN, -3, 'x', undefined, Infinity]) { const t = make(bad); frame(16); T(`corrupt scale (${String(bad)}) falls back to 1`, near(t.calls.world[0], 0.016)); } }
{ fakeNow = 0; const t = make(2); t.loop.pause(); frame(16);
  T('hard pause still skips world.update (unchanged behavior)', t.calls.world.length === 0 && t.calls.scripts[0] === 0); }
{ fakeNow = 0; const t = make(1); t.loop.pause(); t.loop.step(1 / 30); t.loop.step();
  T('step() advances a paused loop by the exact dt asked for', near(t.calls.world[0], 1 / 30) && near(t.calls.world[1], 1 / 60), t.calls.world.join(','));
  T('step() publishes timeScale and reports the dt to onTick/unscaled', t.world.timeScale === 1 && near(t.calls.tick[0], 1 / 30) && near(t.calls.unscaled[0], 1 / 30));
  const t2 = make(2); t2.loop.step(0.01); T('step() applies time.scale via world.timeScale (dt is game time)', t2.world.timeScale === 2 && near(t2.calls.world[0], 0.01));
  const t3 = make(1); t3.loop.step(99); T('step() clamps a huge dt to 0.5 s', near(t3.calls.world[0], 0.5));
  const t4 = make(1); t4.loop.step(NaN); T('step(NaN) falls back to 1/60', near(t4.calls.world[0], 1 / 60)); }
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
