/**
 * McpPlayTools.js — MCP tools that let an AI actually PLAY and TEST the game
 * it is building, and a few discovery helpers that make building easier:
 *
 *   play_restart      start the game fresh and wait until it is running
 *   play_input        press keys / click / tap / drag / wait / assert / screenshot, in one call
 *   play_step         advance N frames (deterministic)
 *   play_screenshot   see the real game (not the editor viewport)
 *   play_get_state    entities, positions, velocities, script variables, `global` values
 *   play_get_entity   one entity in full
 *   play_eval         run a JavaScript expression inside the running game
 *   play_get_errors   script/engine errors raised while playing
 *   check_project     static checks: cameras, scripts, missing assets, physics setup
 *   describe_component  fields, defaults and allowed values of a component type
 *   duplicate_entities  copy entities (same as Ctrl+D)
 *   clear_console       empty the Console so the next test starts clean
 *   get_engine_guide    short, accurate cheat-sheet for building and testing games
 *
 * Dispatched from AiBridge.js after McpWorkflowTools. Returns null for tool names it
 * does not own. Play tools never change project data, so they also work in read-only mode.
 */
import { editorState, markDirty, pushLog } from "../state/EditorState.js";
import { snapshotNow } from "../state/UndoManager.js";
import { openPlayWindow, isPlayWindowOpen } from "../viewport/PlayWindow.js";
import { sendPlayCommand, waitForPlayBoot } from "../viewport/PlayRemote.js";
import { serializeEntity, instantiateEntity, COMPONENT_REGISTRY } from "../../runtime/scene/SceneSerializer.js";
import { getAllScripts, getScriptSource } from "../scripting/ScriptStorage.js";
import { stripCastSyntax } from "../../runtime/scripting/CastSyntax.js";
import { stripInspectSyntax } from "../../runtime/scripting/InspectSyntax.js";
import { getAllSpriteAssets, getAllFrameAssets, getTileAssets, getAllAudioAssets } from "../../runtime/assets/AssetRegistry.js";
import { ENUM_RULES, NUMBER_RULES } from "./ComponentRules.js";
import { ENGINE_GUIDE } from "./EngineGuide.js";

const TOOL_BUDGET_MS = 21000; // the relay gives a tool call 25 s in total
const text = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const fail = (message) => ({ isError: true, content: [{ type: "text", text: message }] });

function game() {
  if (!editorState.game) throw new Error("The editor's game instance is not ready yet.");
  return editorState.game;
}
function world() {
  if (!editorState.world) throw new Error("Open a Realot project in the editor first.");
  return editorState.world;
}
function rerender() { if (typeof editorState.renderFn === "function") editorState.renderFn(); }

/** Text result followed by the screenshots the game returned (each preceded by its label in the JSON). */
function withImages(payload, images) {
  const list = Array.isArray(images) ? images : [];
  if (list.length) payload.images = list.map((im, index) => ({ index, label: im.label || null, width: im.width, height: im.height }));
  const content = [{ type: "text", text: JSON.stringify(payload, null, 2) }];
  for (const im of list) content.push({ type: "image", data: im.data, mimeType: im.mimeType || "image/jpeg" });
  return { content };
}

function consoleTail(n = 8) {
  return (editorState.logs || []).slice(-n).map((l) => l.type + ": " + l.msg);
}

/** Starts (or reloads) the Play window with the current scene and waits for the game to boot. */
async function restartPlay(budgetMs = 9000) {
  const g = game();
  world();
  const startedAt = Date.now();
  editorState.isPlaying = true;
  editorState.isPaused = false;
  openPlayWindow(g);
  if (!isPlayWindowOpen()) {
    editorState.isPlaying = false;
    rerender();
    throw new Error("The game window could not open. Console: " + consoleTail(3).join(" | ") +
      " — if the browser blocked the popup, ask the user to allow popups for this site and press Play once.");
  }
  rerender();
  await waitForPlayBoot(startedAt, budgetMs);
}

/** The probe pauses the loop while it drives the game; mirror that in the editor's toolbar. */
function markPausedByProbe() {
  if (editorState.isPlaying && !editorState.isPaused) { editorState.isPaused = true; rerender(); }
}

// ------------------------------------------------------------------ static project checks
function syntaxProblem(name) {
  try {
    const source = getScriptSource(name) || "";
    new Function(stripCastSyntax(stripInspectSyntax(source))); // eslint-disable-line no-new-func
    return null;
  } catch (e) {
    return String(e && e.message || e).slice(0, 300);
  }
}

function checkProject() {
  const g = game();
  g.saveActiveScene();
  const scenes = g.getAllScenesData();
  const scripts = getAllScripts();
  const errors = [];
  const warnings = [];
  const attached = new Set();
  const spriteKeys = new Set([...getAllSpriteAssets(), ...getAllFrameAssets(), ...getTileAssets()].map((a) => a.key));
  const audioKeys = new Set(getAllAudioAssets().map((a) => a.key));

  for (const name of scripts) {
    const problem = syntaxProblem(name);
    if (problem) errors.push({ where: "script '" + name + "'", problem: "Syntax error: " + problem });
  }

  for (const scene of scenes) {
    const entities = (scene.data && scene.data.entities) || [];
    const label = "scene '" + scene.name + "'";
    const mains = entities.filter((e) => e.components && e.components.Camera && e.components.Camera.isMain);
    if (mains.length === 0) errors.push({ where: label, problem: "No Main Camera — the game cannot start. Add an entity with Transform + Camera and set isMain." });
    if (mains.length > 1) errors.push({ where: label, problem: "More than one Main Camera (" + mains.length + "). Only one is allowed." });
    if (entities.length === 0) warnings.push({ where: label, problem: "The scene has no entities." });
    for (const e of entities) {
      const c = e.components || {};
      const who = label + " › '" + e.name + "' (" + e.id + ")";
      if (c.Script) {
        const sn = c.Script.scriptName;
        if (sn) attached.add(sn);
        if (!sn) warnings.push({ where: who, problem: "Script component has no script selected." });
        else if (!scripts.includes(sn)) errors.push({ where: who, problem: "Script '" + sn + "' does not exist. Existing: " + (scripts.join(", ") || "(none)") });
        if (c.Script.enabled === false) warnings.push({ where: who, problem: "Script component is disabled." });
      }
      if (c.SpriteRenderer && c.SpriteRenderer.spriteKey && !spriteKeys.has(c.SpriteRenderer.spriteKey)) {
        warnings.push({ where: who, problem: "SpriteRenderer uses sprite '" + c.SpriteRenderer.spriteKey + "' which is not in the project assets (shows the pink missing-texture marker)." });
      }
      if (c.AudioSource && c.AudioSource.audioKey && !audioKeys.has(c.AudioSource.audioKey)) {
        warnings.push({ where: who, problem: "AudioSource uses clip '" + c.AudioSource.audioKey + "' which is not in the project assets." });
      }
      if (c.Rigidbody2D && !c.Collider2D) warnings.push({ where: who, problem: "Rigidbody2D without a Collider2D — it will not collide with anything." });
      if (c.CharacterController && !c.Rigidbody2D) warnings.push({ where: who, problem: "CharacterController without a Rigidbody2D — it cannot move." });
      if (c.NavAgent2D && !entities.some((o) => o.components && o.components.NavWorld2D)) warnings.push({ where: who, problem: "NavAgent2D but this scene has no NavWorld2D to walk on." });
    }
  }
  for (const name of scripts) {
    if (!attached.has(name)) warnings.push({ where: "script '" + name + "'", problem: "Not attached to any entity in any scene (it never runs unless spawned via a prefab)." });
  }
  return {
    ok: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings: warnings.slice(0, 60),
    scenes: scenes.map((s) => ({ name: s.name, entities: ((s.data && s.data.entities) || []).length })),
    scripts: scripts.length,
    next: errors.length ? "Fix the errors, then run check_project again, then play_restart." : "Looks structurally sound. Run play_restart and play_input to test behaviour.",
  };
}

// ------------------------------------------------------------------ component discovery
function describeComponent(type) {
  if (typeof type !== "string" || !Object.prototype.hasOwnProperty.call(COMPONENT_REGISTRY, type)) {
    throw new Error("Unknown component type '" + type + "'. Valid: " + Object.keys(COMPONENT_REGISTRY).join(", "));
  }
  const Cls = COMPONENT_REGISTRY[type];
  const defaults = new Cls({});
  const fields = {};
  for (const key of Object.keys(defaults)) {
    if (key.startsWith("_")) continue;
    const v = defaults[key];
    if (typeof v === "function") continue;
    const entry = { type: v === null ? "null (optional reference / set later)" : Array.isArray(v) ? "array" : typeof v, default: v };
    const allowed = ENUM_RULES[type] && ENUM_RULES[type][key];
    if (allowed) entry.allowed = allowed;
    const range = NUMBER_RULES[type] && NUMBER_RULES[type][key];
    if (range) entry.range = range;
    fields[key] = entry;
  }
  return { component: type, fieldCount: Object.keys(fields).length, fields, note: "Pass these as the 'components' of create_entity/add_component or the 'fields' of update_component. Unknown or wrongly typed fields are rejected with a list of valid ones." };
}

// ------------------------------------------------------------------ duplication
function duplicateEntities(a) {
  const ids = Array.isArray(a.ids) ? a.ids : (typeof a.id === "string" ? [a.id] : []);
  if (!ids.length) throw new Error("ids must be a non-empty array of entity ids (use list_entities).");
  if (ids.length > 50) throw new Error("At most 50 entities per call.");
  const copies = Math.max(1, Math.min(50, Math.floor(Number(a.count) || 1)));
  const dx = a.offset_x === undefined ? 32 : Number(a.offset_x);
  const dy = a.offset_y === undefined ? 0 : Number(a.offset_y);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error("offset_x and offset_y must be numbers.");
  const w = world();
  const sources = ids.map((id) => {
    const e = w.getEntity(String(id));
    if (!e) throw new Error("No entity with id '" + id + "'. Use list_entities.");
    return e;
  });
  snapshotNow("scene");
  const created = [];
  for (let n = 1; n <= copies; n++) {
    for (const src of sources) {
      const data = serializeEntity(src);
      const copy = instantiateEntity(w, data, src.name + " (Copy)");
      const t = copy.getComponent("Transform");
      if (t) { t.x += dx * n; t.y += dy * n; }
      created.push({ id: copy.id, name: copy.name, copiedFrom: src.id });
    }
  }
  markDirty();
  pushLog("log", "AI: duplicated " + sources.length + " entit" + (sources.length === 1 ? "y" : "ies") + " x" + copies);
  rerender();
  return { created };
}

/** Handles one tool call. Returns null when `name` is not one of this file's tools. */
export async function runMcpPlayTool(name, a) {
  switch (name) {
    case "get_engine_guide": {
      const topic = typeof a.topic === "string" ? a.topic.trim().toLowerCase() : "";
      if (!topic) return text(ENGINE_GUIDE.overview + "\n\nMore topics (ask with topic=...): " + Object.keys(ENGINE_GUIDE.topics).join(", "));
      const hit = ENGINE_GUIDE.topics[topic];
      if (!hit) return fail("Unknown topic '" + topic + "'. Topics: " + Object.keys(ENGINE_GUIDE.topics).join(", "));
      return text(hit);
    }

    case "describe_component":
      return text(describeComponent(a.type));

    case "check_project":
      return text(checkProject());

    case "duplicate_entities":
      return text(duplicateEntities(a));

    case "clear_console": {
      if (Array.isArray(editorState.logs)) editorState.logs.length = 0;
      rerender();
      return text({ cleared: true });
    }

    case "play_restart": {
      const t0 = Date.now();
      await restartPlay();
      const extraFrames = Math.max(0, Math.min(600, Math.floor(Number(a.settle_frames) || 10)));
      const { result, images } = await sendPlayCommand("step", { frames: extraFrames, budget_ms: 5000 }, 12000);
      markPausedByProbe();
      let shot = [];
      if (a.screenshot !== false) shot = (await sendPlayCommand("screenshot", { max_width: a.max_width || 800, label: "after start" }, 12000)).images;
      return withImages({
        started: true,
        note: "The game is running fresh and is PAUSED so you can act deterministically: use play_input / play_step to advance time. (set_paused paused=false lets it run in real time.)",
        elapsedMs: Date.now() - t0,
        state: result,
        console: consoleTail(6),
      }, shot.length ? shot : images);
    }

    case "play_get_state": {
      const { result } = await sendPlayCommand("state", { filter: a.filter, limit: a.limit });
      return text(result);
    }

    case "play_get_entity": {
      const { result } = await sendPlayCommand("entity", { entity: a.entity });
      return text(result);
    }

    case "play_step": {
      const { result } = await sendPlayCommand("step", { frames: a.frames, seconds: a.seconds, dt: a.dt, budget_ms: 15000 });
      markPausedByProbe();
      if (a.screenshot) {
        const shot = await sendPlayCommand("screenshot", { max_width: a.max_width || 800, label: "after step" });
        return withImages({ stepped: result }, shot.images);
      }
      return text({ stepped: result });
    }

    case "play_screenshot": {
      const { result, images } = await sendPlayCommand("screenshot", { max_width: a.max_width, format: a.format, label: a.label || "game" });
      return withImages({ scene: result.scene, frame: result.frame, gameTimeSeconds: result.gameTimeSeconds, paused: result.paused }, images);
    }

    case "play_eval": {
      const { result } = await sendPlayCommand("eval", { expression: a.expression });
      return text(result);
    }

    case "play_get_errors": {
      const { result } = await sendPlayCommand("errors", { limit: a.limit });
      return text(result);
    }

    case "play_input": {
      const started = Date.now();
      if (a.restart === true) await restartPlay(8000);
      else if (!isPlayWindowOpen()) throw new Error("The game is not running. Call play_restart first, or pass restart=true.");
      const budget = Math.max(3000, Math.min(15000, TOOL_BUDGET_MS - (Date.now() - started) - 1500));
      const { result, images } = await sendPlayCommand("input", { actions: a.actions, dt: a.dt, max_width: a.max_width, keep_paused: a.keep_paused, budget_ms: budget }, budget + 5000);
      if (a.keep_paused === false) { editorState.isPaused = false; rerender(); } else markPausedByProbe();
      const report = Object.assign({}, result);
      report.verdict = report.stopped ? "INCOMPLETE — " + report.stopped
        : report.assertionsFailed ? report.assertionsFailed + " assertion(s) FAILED"
        : (report.newErrors && report.newErrors.length) ? "Ran, but the game raised " + report.newErrors.length + " error(s)"
        : "OK";
      return withImages(report, images);
    }

    default:
      return null;
  }
}
