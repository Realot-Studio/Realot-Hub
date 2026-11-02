/**
 * editor/viewport/play-probe.js
 *
 * Runs INSIDE the Play popup (installed by play-popup.js after the game has
 * booted). It is the "hands and eyes" of the AI bridge: the editor sends a
 * command by postMessage, this file performs it against the live game and
 * answers with a result. Everything is deterministic — frames are stepped
 * synchronously with GameLoop.step() instead of waiting for
 * requestAnimationFrame, which browsers throttle when the popup is hidden.
 *
 * Commands (see editor/mcp/McpPlayTools.js for the tool wrappers):
 *   state       scene, time, frame count, globals, entity list
 *   entity      one entity in full (components + script variables)
 *   step        advance N frames
 *   pause/resume
 *   input       run a sequence of keyboard / mouse / touch / wait / assert /
 *               screenshot actions and report what happened
 *   screenshot  render the game and return a JPEG/PNG
 *   eval        run a JavaScript expression with the script globals in scope
 *
 * Imports nothing from /editor; talks to the editor only through the
 * postToEditor / fromEditor helpers handed in by play-popup.js.
 */

const MAX_FRAMES_PER_COMMAND = 3600;      // one minute at 60 fps
const MAX_COMMAND_MS = 15000;             // stay under the relay's 25 s tool timeout
let budgetMs = MAX_COMMAND_MS;            // per-command budget; the editor may ask for less
const MAX_IMAGES_PER_COMMAND = 4;
const DEFAULT_DT = 1 / 60;
const MAX_STRING = 300;
const MAX_ARRAY = 40;
const MAX_DEPTH = 4;

const NAMED_KEYS = {
  left: ["ArrowLeft", "ArrowLeft"], right: ["ArrowRight", "ArrowRight"],
  up: ["ArrowUp", "ArrowUp"], down: ["ArrowDown", "ArrowDown"],
  space: [" ", "Space"], spacebar: [" ", "Space"],
  enter: ["Enter", "Enter"], return: ["Enter", "Enter"],
  escape: ["Escape", "Escape"], esc: ["Escape", "Escape"],
  tab: ["Tab", "Tab"], backspace: ["Backspace", "Backspace"], delete: ["Delete", "Delete"],
  shift: ["Shift", "ShiftLeft"], ctrl: ["Control", "ControlLeft"], control: ["Control", "ControlLeft"],
  alt: ["Alt", "AltLeft"],
};

/** "left", "Space", "a", "KeyA", "ArrowUp", "5" -> { key, code } as a real keyboard reports them. */
function resolveKey(name) {
  const raw = String(name == null ? "" : name);
  if (!raw) throw new Error("A key name is required (for example \"ArrowLeft\", \"left\", \"Space\", \"a\").");
  const named = NAMED_KEYS[raw.toLowerCase()];
  if (named) return { key: named[0], code: named[1] };
  if (raw === " ") return { key: " ", code: "Space" };
  if (/^Key[A-Z]$/.test(raw)) return { key: raw.slice(3).toLowerCase(), code: raw };
  if (/^Digit[0-9]$/.test(raw)) return { key: raw.slice(5), code: raw };
  if (/^[a-z]$/i.test(raw)) return { key: raw, code: "Key" + raw.toUpperCase() };
  if (/^[0-9]$/.test(raw)) return { key: raw, code: "Digit" + raw };
  return { key: raw, code: raw };
}

/** JSON-safe, size-bounded copy of any value (no functions, no cycles, no private _fields). */
function plain(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === "number") return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : String(value);
  if (t === "boolean") return value;
  if (t === "string") return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + "…(" + value.length + " chars)" : value;
  if (t === "function" || t === "symbol") return undefined;
  if (t === "bigint") return String(value);
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? "[array(" + value.length + ")]" : "[object]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (value instanceof Map) value = Object.fromEntries(Array.from(value.entries()).slice(0, MAX_ARRAY).map(([k, v]) => [String(k), v]));
  else if (value instanceof Set) value = Array.from(value).slice(0, MAX_ARRAY);
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((v) => { const p = plain(v, depth + 1, seen); return p === undefined ? null : p; });
    if (value.length > MAX_ARRAY) out.push("…+" + (value.length - MAX_ARRAY) + " more");
    return out;
  }
  const out = {};
  let n = 0;
  for (const key of Object.keys(value)) {
    if (key.startsWith("_") || key === "__proto__") continue;
    let v;
    try { v = value[key]; } catch (_) { continue; }
    const p = plain(v, depth + 1, seen);
    if (p === undefined) continue;
    out[key] = p;
    if (++n >= 60) { out["…"] = "more fields omitted"; break; }
  }
  return out;
}

/**
 * @param {object} deps
 * @param {object} deps.game        the running createGame() instance
 * @param {object} deps.pixiApp     the PIXI.Application the game renders into
 * @param {(msg:object)=>void} deps.postToEditor
 * @param {(e:MessageEvent)=>boolean} deps.fromEditor
 */
export function installPlayProbe({ game, pixiApp, postToEditor, fromEditor }) {
  const world = game.world;
  const loop = game.loop;
  const api = game.scriptApi;
  const canvas = pixiApp.view;
  const stats = { frames: 0, gameTime: 0 };
  const errors = [];   // script / engine errors seen since the probe was installed

  // Count every simulated frame, whether it came from requestAnimationFrame or from step().
  const realUpdate = world.update.bind(world);
  world.update = function (dt) {
    stats.frames++;
    stats.gameTime += dt;
    return realUpdate(dt);
  };
  if (game.scriptSystem && typeof game.scriptSystem.onError === "function") {
    game.scriptSystem.onError(function (err) {
      errors.push({ script: err.scriptName, line: err.line, method: err.method, message: String(err.message).slice(0, 400), frame: stats.frames });
      if (errors.length > 50) errors.shift();
    });
  }
  window.addEventListener("error", (e) => {
    errors.push({ script: "(engine)", line: e.lineno, method: "runtime", message: String(e.message).slice(0, 400), frame: stats.frames });
    if (errors.length > 50) errors.shift();
  });

  // ------------------------------------------------------------------ helpers
  const timeUp = (t0) => performance.now() - t0 > budgetMs;

  function stepFrames(count, dt, t0) {
    const n = Math.max(0, Math.min(MAX_FRAMES_PER_COMMAND, Math.floor(Number(count) || 0)));
    let done = 0;
    for (; done < n; done++) {
      if (timeUp(t0)) break;
      loop.step(dt);
    }
    return done;
  }

  function framesFrom(action, dt) {
    if (action.frames != null) return Math.max(0, Math.floor(Number(action.frames)));
    if (action.seconds != null) return Math.max(0, Math.round(Number(action.seconds) / dt));
    return null;
  }

  /** world / screen point -> client coordinates on the canvas element. */
  function toClient(point, space) {
    const rect = canvas.getBoundingClientRect();
    const logicalW = pixiApp.screen.width || rect.width;
    const logicalH = pixiApp.screen.height || rect.height;
    let sx = Number(point.x), sy = Number(point.y);
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) throw new Error("x and y must be numbers.");
    if (space === "world") {
      const layer = game.getDebugLayer && game.getDebugLayer();
      const container = layer && layer.parent;
      if (!container) throw new Error("World coordinates are not available in this scene.");
      const g = container.toGlobal(new PIXI.Point(sx, sy));
      sx = g.x; sy = g.y;
    }
    return { clientX: rect.left + sx * (rect.width / logicalW), clientY: rect.top + sy * (rect.height / logicalH), screenX: sx, screenY: sy };
  }

  function entityScreenPoint(ent) {
    const t = ent.getComponent("Transform");
    if (!t) throw new Error("Entity '" + ent.name + "' has no Transform.");
    return { x: t.x, y: t.y };
  }

  function findEntity(ref) {
    if (ref == null || ref === "") throw new Error("An entity id or name is required.");
    const byId = world.getEntity(String(ref));
    if (byId) return byId;
    const byName = world.findFirstByName ? world.findFirstByName(String(ref)) : null;
    if (byName) return byName;
    throw new Error("No entity with id or name '" + ref + "' in the running scene. Use play_get_state to list entities.");
  }

  function key(type, name) {
    const k = resolveKey(name);
    document.dispatchEvent(new KeyboardEvent(type, { key: k.key, code: k.code, bubbles: true, cancelable: true }));
  }

  function pointer(type, point, space, opts) {
    const c = toClient(point, space);
    const o = Object.assign({ pointerId: 1, pointerType: "mouse", button: 0, buttons: 0 }, opts || {});
    const ev = new PointerEvent(type, {
      pointerId: o.pointerId, pointerType: o.pointerType, button: o.button, buttons: o.buttons,
      clientX: c.clientX, clientY: c.clientY, isPrimary: true, bubbles: true, cancelable: true,
    });
    canvas.dispatchEvent(ev);
    return c;
  }

  function lerpPoint(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }

  function pointFrom(action, which) {
    const src = which ? action[which] : action;
    if (!src || typeof src !== "object") throw new Error("Provide x and y" + (which ? " in '" + which + "'" : "") + " (or an entity).");
    if (src.entity != null) return { point: entityScreenPoint(findEntity(src.entity)), space: "world" };
    if (src.x == null || src.y == null) throw new Error("Provide x and y" + (which ? " in '" + which + "'" : "") + " (or an entity).");
    return { point: { x: src.x, y: src.y }, space: (action.space || src.space || "screen") === "world" ? "world" : "screen" };
  }

  // ---------------------------------------------------------------- screenshot
  function capture(opts) {
    opts = opts || {};
    try { pixiApp.render(); } catch (_) { /* keep going: the last drawn frame is still on the canvas */ }
    const maxW = Math.max(160, Math.min(1600, Math.floor(Number(opts.max_width) || 960)));
    const scale = Math.min(1, maxW / canvas.width);
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(canvas.width * scale));
    out.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    const png = opts.format === "png";
    const url = out.toDataURL(png ? "image/png" : "image/jpeg", 0.8);
    const data = url.split(",")[1] || "";
    if (data.length < 1000) throw new Error("The game image came back blank. The game may still be loading — try again.");
    return { data, mimeType: png ? "image/png" : "image/jpeg", width: out.width, height: out.height, label: opts.label || null };
  }

  // ---------------------------------------------------------------- inspection
  function entityBrief(e) {
    const t = e.getComponent("Transform");
    const rb = e.getComponent("Rigidbody2D");
    const out = { id: e.id, name: e.name, tag: e.tag || "", active: e.active !== false, components: Array.from(e.components.keys()) };
    if (t) { out.x = Math.round(t.x * 100) / 100; out.y = Math.round(t.y * 100) / 100; if (t.rotation) out.rotation = Math.round(t.rotation * 100) / 100; }
    if (rb && (rb.velocityX || rb.velocityY)) { out.vx = Math.round(rb.velocityX * 100) / 100; out.vy = Math.round(rb.velocityY * 100) / 100; }
    const ctx = api._contexts && api._contexts.get(e.id);
    if (ctx) {
      const vars = scriptVars(ctx);
      if (Object.keys(vars).length) out.vars = vars;
    }
    return out;
  }

  /** Values a script stored on `this` (this.score = 0 ...). Internal engine fields start with "_". */
  function scriptVars(ctx) {
    const vars = {};
    for (const k of Object.keys(ctx)) {
      if (k.startsWith("_")) continue;
      let v;
      try { v = ctx[k]; } catch (_) { continue; }
      if (typeof v === "function") continue;
      const p = plain(v, 2);
      if (p !== undefined) vars[k] = p;
    }
    return vars;
  }

  function entityFull(e) {
    const components = {};
    for (const [type, comp] of e.components.entries()) components[type] = plain(comp, 1);
    const out = { id: e.id, name: e.name, tag: e.tag || "", active: e.active !== false, components };
    const ctx = api._contexts && api._contexts.get(e.id);
    if (ctx) out.scriptVariables = scriptVars(ctx);
    return out;
  }

  function globalsDump() {
    const out = {};
    if (api._globals && typeof api._globals.entries === "function") {
      let n = 0;
      for (const [k, v] of api._globals.entries()) {
        const p = plain(v, 2);
        if (p !== undefined) out[String(k)] = p;
        if (++n >= 60) break;
      }
    }
    return out;
  }

  function summary() {
    return {
      scene: world.sceneName,
      frame: stats.frames,
      gameTimeSeconds: Math.round(stats.gameTime * 1000) / 1000,
      paused: loop.isPaused,
      timeScale: world.timeScale || 1,
      entityCount: world.getAllEntities().length,
      screen: { width: pixiApp.screen.width, height: pixiApp.screen.height },
    };
  }

  function stateCommand(args) {
    const f = args.filter || {};
    const limit = Math.max(1, Math.min(200, Math.floor(Number(args.limit) || 60)));
    let list = world.getAllEntities();
    if (f.name) list = list.filter((e) => e.name === f.name || (typeof e.name === "string" && e.name.toLowerCase().includes(String(f.name).toLowerCase())));
    if (f.tag) list = list.filter((e) => e.tag === f.tag);
    if (f.component) list = list.filter((e) => e.hasComponent(f.component));
    if (f.active_only) list = list.filter((e) => e.active !== false);
    return Object.assign(summary(), {
      matched: list.length,
      entities: list.slice(0, limit).map(entityBrief),
      globals: globalsDump(),
      errorsSinceStart: errors.slice(-10),
    });
  }

  // ---------------------------------------------------------------- eval
  function evaluate(expression) {
    if (typeof expression !== "string" || !expression.trim()) throw new Error("expression must be a non-empty string.");
    if (expression.length > 4000) throw new Error("expression is too long (limit 4000 characters).");
    const globals = api.getGlobals();
    const names = Object.keys(globals).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
    const values = names.map((n) => globals[n]);
    // A single expression works as-is; for several statements, finish with an explicit `return`.
    let fn;
    try { fn = new Function(...names, "game", "world", "\"use strict\"; return (" + expression + "\n);"); }
    catch (_) { fn = new Function(...names, "game", "world", "\"use strict\";\n" + expression); }
    return fn(...values, game, world);
  }

  // ---------------------------------------------------------------- input sequence
  function runInput(args) {
    const t0 = performance.now();
    const dt = Math.max(1 / 240, Math.min(0.1, Number(args.dt) || DEFAULT_DT));
    const actions = Array.isArray(args.actions) ? args.actions : [];
    if (!actions.length) throw new Error("actions must be a non-empty array.");
    if (actions.length > 120) throw new Error("At most 120 actions per call.");
    loop.pause();                      // we drive time ourselves from here on
    const held = new Set();
    const heldPointers = new Map();
    const images = [];
    const log = [];
    let stopped = null;
    let assertionsFailed = 0;
    const startFrame = stats.frames;
    const errorsBefore = errors.length;

    function wait(frames) { return stepFrames(frames, dt, t0); }

    for (let i = 0; i < actions.length; i++) {
      const a = actions[i] || {};
      const type = String(a.type || "");
      const entry = { i, type };
      try {
        if (timeUp(t0)) { stopped = "time budget reached before action " + i; break; }
        switch (type) {
          case "key_down": key("keydown", a.key); held.add(String(a.key)); break;
          case "key_up": key("keyup", a.key); held.delete(String(a.key)); break;
          case "key_press": {
            // down, hold for N frames (default 6 ≈ 0.1 s), release, one frame for the release to register
            key("keydown", a.key);
            entry.frames = wait(framesFrom(a, dt) ?? 6);
            key("keyup", a.key);
            wait(1);
            break;
          }
          case "hold": {
            const keys = Array.isArray(a.keys) ? a.keys : [a.key];
            for (const k of keys) key("keydown", k);
            entry.frames = wait(framesFrom(a, dt) ?? 30);
            for (const k of keys) key("keyup", k);
            wait(1);
            break;
          }
          case "wait": entry.frames = wait(framesFrom(a, dt) ?? 1); break;
          case "mouse_move": { const p = pointFrom(a); pointer("pointermove", p.point, p.space); break; }
          case "mouse_down": { const p = pointFrom(a); const b = a.button || 0; pointer("pointerdown", p.point, p.space, { button: b, buttons: 1 << b }); break; }
          case "mouse_up": { const p = pointFrom(a); pointer("pointerup", p.point, p.space, { button: a.button || 0, buttons: 0 }); break; }
          case "click": {
            const p = pointFrom(a); const b = a.button || 0;
            pointer("pointermove", p.point, p.space);
            wait(1);
            pointer("pointerdown", p.point, p.space, { button: b, buttons: 1 << b });
            entry.frames = wait(framesFrom(a, dt) ?? 3);
            pointer("pointerup", p.point, p.space, { button: b, buttons: 0 });
            wait(1);
            break;
          }
          case "drag": {
            const from = pointFrom(a, "from"), to = pointFrom(a, "to");
            if (from.space !== to.space) to.space = from.space;
            const n = Math.max(2, framesFrom(a, dt) ?? 20);
            pointer("pointermove", from.point, from.space);
            wait(1);
            pointer("pointerdown", from.point, from.space, { button: 0, buttons: 1 });
            for (let s = 1; s <= n; s++) { pointer("pointermove", lerpPoint(from.point, to.point, s / n), from.space, { buttons: 1 }); wait(1); }
            pointer("pointerup", to.point, from.space, { button: 0, buttons: 0 });
            wait(1);
            break;
          }
          case "touch_down": { const p = pointFrom(a); const id = a.id || 2; heldPointers.set(id, p.space); pointer("pointerdown", p.point, p.space, { pointerType: "touch", pointerId: id, buttons: 1 }); break; }
          case "touch_move": { const p = pointFrom(a); const id = a.id || 2; pointer("pointermove", p.point, p.space, { pointerType: "touch", pointerId: id, buttons: 1 }); break; }
          case "touch_up": { const p = pointFrom(a); const id = a.id || 2; heldPointers.delete(id); pointer("pointerup", p.point, p.space, { pointerType: "touch", pointerId: id, buttons: 0 }); break; }
          case "tap": {
            const p = pointFrom(a); const id = a.id || 2;
            pointer("pointerdown", p.point, p.space, { pointerType: "touch", pointerId: id, buttons: 1 });
            entry.frames = wait(framesFrom(a, dt) ?? 3);
            pointer("pointerup", p.point, p.space, { pointerType: "touch", pointerId: id, buttons: 0 });
            wait(1);
            break;
          }
          case "swipe": {
            const from = pointFrom(a, "from"), to = pointFrom(a, "to"); const id = a.id || 2;
            if (from.space !== to.space) to.space = from.space;
            const n = Math.max(2, framesFrom(a, dt) ?? 12);
            pointer("pointerdown", from.point, from.space, { pointerType: "touch", pointerId: id, buttons: 1 });
            for (let s = 1; s <= n; s++) { wait(1); pointer("pointermove", lerpPoint(from.point, to.point, s / n), from.space, { pointerType: "touch", pointerId: id, buttons: 1 }); }
            pointer("pointerup", to.point, from.space, { pointerType: "touch", pointerId: id, buttons: 0 });
            wait(1);
            break;
          }
          case "scene_load": {
            evaluate("scene.load(" + JSON.stringify(String(a.name || "")) + ")");
            entry.frames = wait(framesFrom(a, dt) ?? 3);
            break;
          }
          case "screenshot": {
            if (images.length >= MAX_IMAGES_PER_COMMAND) throw new Error("At most " + MAX_IMAGES_PER_COMMAND + " screenshots per call. Split the test into several calls.");
            const img = capture({ max_width: a.max_width || args.max_width || 800, label: a.label || "step " + i, format: a.format });
            images.push(img);
            entry.image = images.length - 1;
            entry.label = img.label;
            break;
          }
          case "inspect": {
            if (a.entity != null) entry.entity = entityFull(findEntity(a.entity));
            else entry.state = stateCommand({ filter: a.filter, limit: a.limit || 30 });
            break;
          }
          case "eval": entry.value = plain(evaluate(a.expression)); break;
          case "assert": {
            const v = evaluate(a.expression);
            entry.passed = !!v;
            entry.expression = String(a.expression).slice(0, 200);
            if (a.message) entry.message = String(a.message).slice(0, 200);
            if (!entry.passed) { assertionsFailed++; entry.actual = plain(v); }
            break;
          }
          default:
            throw new Error("Unknown action type '" + type + "'. Valid: key_down, key_up, key_press, hold, wait, mouse_move, mouse_down, mouse_up, click, drag, touch_down, touch_move, touch_up, tap, swipe, scene_load, screenshot, inspect, eval, assert.");
        }
        entry.ok = entry.passed === false ? false : true;
      } catch (e) {
        entry.ok = false;
        entry.error = String(e && e.message || e).slice(0, 500);
        if (a.continue_on_error !== true && type !== "assert") { log.push(entry); stopped = "stopped at action " + i + ": " + entry.error; break; }
      }
      log.push(entry);
    }

    // Never leave keys / fingers stuck down after a test sequence.
    for (const k of held) { try { key("keyup", k); } catch (_) {} }
    for (const [id, space] of heldPointers) { try { pointer("pointerup", { x: 0, y: 0 }, space === "world" ? "screen" : space, { pointerType: "touch", pointerId: id }); } catch (_) {} }
    if (args.keep_paused === false) loop.resume();

    return {
      actions: log,
      stopped,
      assertionsFailed,
      framesAdvanced: stats.frames - startFrame,
      newErrors: errors.slice(errorsBefore),
      summary: summary(),
      __images: images,
    };
  }

  // ---------------------------------------------------------------- command router
  async function handle(op, args) {
    const t0 = performance.now();
    budgetMs = Math.max(1000, Math.min(MAX_COMMAND_MS, Number(args.budget_ms) || MAX_COMMAND_MS));
    switch (op) {
      case "state": return stateCommand(args);
      case "entity": return entityFull(findEntity(args.entity));
      case "pause": loop.pause(); return summary();
      case "resume": loop.resume(); return summary();
      case "step": {
        loop.pause();
        const dt = Math.max(1 / 240, Math.min(0.1, Number(args.dt) || DEFAULT_DT));
        const frames = framesFrom(args, dt) ?? 1;
        const done = stepFrames(frames, dt, t0);
        return Object.assign({ framesAdvanced: done, requested: frames }, summary());
      }
      case "screenshot": return Object.assign(summary(), { __images: [capture(args)] });
      case "eval": return { value: plain(evaluate(args.expression)), summary: summary() };
      case "input": return runInput(args);
      case "errors": return { errors: errors.slice(-(Math.max(1, Math.min(50, Number(args.limit) || 20)))), frame: stats.frames };
      default: throw new Error("Unknown play command '" + op + "'.");
    }
  }

  window.addEventListener("message", function (e) {
    if (!fromEditor(e) || e.data.type !== "realot_play_cmd") return;
    const id = e.data.id;
    Promise.resolve()
      .then(() => handle(String(e.data.op || ""), (e.data.args && typeof e.data.args === "object") ? e.data.args : {}))
      .then((result) => {
        const images = result && result.__images;
        if (result && result.__images) delete result.__images;
        postToEditor({ type: "realot_play_cmd_result", id, ok: true, result, images: images || [] });
      })
      .catch((err) => postToEditor({ type: "realot_play_cmd_result", id, ok: false, error: String(err && err.message || err).slice(0, 1000) }));
  });

  postToEditor({ type: "realot_play_booted", at: Date.now() });
}
