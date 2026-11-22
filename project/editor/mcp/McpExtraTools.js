/**
 * McpExtraTools.js — second-generation AI bridge tools:
 *   knowledge   search_docs, get_script_api, get_recipe, validate_script
 *   query       find_entities, get_selection, get_hierarchy, move_entities_to_folder
 *   viewport    get_viewport_camera, set_viewport_camera, focus_entity
 *   settings    get_engine_settings, update_engine_settings
 *   scripts     search_scripts, replace_in_scripts, rename_script
 *   safety      snapshot_project, list_snapshots, restore_snapshot, delete_snapshot
 *   power       batch (many tool calls, optional rollback), editor_eval (opt-in)
 *   telemetry   get_performance
 * Plus the internal __resources_list / __resources_read used for MCP resources.
 *
 * Dispatched from AiBridge.js. Returns null for names it does not own.
 * ctx = { runTool(name,args), allowEval:boolean, readOnly:boolean }
 */
import { editorState, markDirty, pushLog } from "../state/EditorState.js";
import { snapshotNow } from "../state/UndoManager.js";
import { diffDigests, formatDiff } from "./McpDiff.js";
import { getEngineSettings, setEngineSettings, GAME_FPS_OPTIONS } from "../state/EngineSettings.js";
import { getAllScripts, getScriptSource, saveScript, scriptExists, replaceAllScripts } from "../scripting/ScriptStorage.js";
import { syncScriptSourcesInWorld } from "../scripting/ScriptSync.js";
import { renameScriptEverywhere } from "../panels/ScriptEditorWindow.js";
import { getViewportCamera, syncAfterExternalSceneChange } from "../viewport/SceneViewport.js";
import { TRANSFORM } from "../../runtime/components/Transform.js";
import { COMPONENT_REGISTRY } from "../../runtime/scene/SceneSerializer.js";
import {
  searchDocs, getScriptApi, getRecipe, listResources, readResource,
  knownScriptGlobals, LIFECYCLE_FUNCTIONS, ENTITY_SHORTCUT_NAMES, suggest,
} from "./McpDocs.js";

const text = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const round = (n) => Math.round(n * 100) / 100;
const MAX_SNAPSHOTS = 10;
const MAX_BATCH = 50;
const snapshots = new Map(); // id -> { id, label, at, scenes, scripts, activeSceneId }
let snapshotCounter = 0;

function world() {
  if (!editorState.world) throw new Error("Open a Realot project in the editor first.");
  return editorState.world;
}
function game() {
  if (!editorState.game) throw new Error("The editor's game instance is not ready yet.");
  return editorState.game;
}
function changed(note) {
  markDirty();
  pushLog("log", "AI: " + note);
  if (typeof editorState.renderFn === "function") editorState.renderFn();
}
function needWrite(ctx, tool) {
  if (ctx && ctx.readOnly) throw new Error("Read-only mode is on. Ask the user to turn it off in the AI panel to allow " + tool + ".");
}
function entitySummary(e) {
  const t = e.getComponent(TRANSFORM);
  return {
    id: e.id, name: e.name, tag: e.tag || "", active: e.active !== false,
    folderId: e.folderId || null, components: Array.from(e.components.keys()),
    x: t ? round(t.x) : undefined, y: t ? round(t.y) : undefined,
  };
}
function needEntity(id) {
  if (typeof id !== "string" || !id.trim()) throw new Error("entity_id must be a non-empty entity id.");
  const e = world().getEntity(id);
  if (!e) throw new Error("No entity with id '" + id + "'. Use find_entities or list_entities." + suggest(id, world().getAllEntities().map((x) => x.id)));
  return e;
}

// ------------------------------------------------------------------ snapshots
function takeSnapshot(label) {
  const g = game();
  g.saveActiveScene();
  const snap = {
    id: "snap-" + (++snapshotCounter),
    label: String(label || "").slice(0, 120) || "snapshot " + snapshotCounter,
    at: Date.now(),
    activeSceneId: g.getActiveSceneId(),
    scenes: JSON.parse(JSON.stringify(g.getAllScenesData())),
    scripts: Object.fromEntries(getAllScripts().map((n) => [n, getScriptSource(n)])),
  };
  snapshots.set(snap.id, snap);
  while (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value);
  return snap;
}
function restoreSnapshot(snap) {
  const g = game();
  const ok = g.replaceAllScenesAndLoad(JSON.parse(JSON.stringify(snap.scenes)), snap.activeSceneId);
  if (ok === false) throw new Error("The editor refused to load the snapshot's scenes.");
  replaceAllScripts(snap.scripts);
  try { syncScriptSourcesInWorld(world()); } catch (_) { /* scripts re-sync on next edit */ }
  syncAfterExternalSceneChange();
  changed("restored snapshot '" + snap.label + "'");
}
const snapInfo = (s) => ({
  id: s.id, label: s.label, createdAt: new Date(s.at).toISOString(),
  scenes: s.scenes.length, scripts: Object.keys(s.scripts).length,
});

// ------------------------------------------------------------------ validate_script
const KEYWORDS = new Set("if else for while do switch case break continue return function var let const new delete typeof instanceof in of void this null true false try catch finally throw class extends super default yield await async static get set with debugger".split(" "));
function stripNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, '""');
}
function validateScriptSource(source, label) {
  const errors = [];
  const warnings = [];
  try { new Function(source); } catch (e) { errors.push("Syntax error: " + String((e && e.message) || e)); }
  const clean = stripNoise(source);
  if (/^\s*import\s/m.test(clean) || /^\s*export\s/m.test(clean)) errors.push("Scripts are plain JavaScript: no import/export statements.");
  if (/^\s*class\s+\w+/m.test(clean)) warnings.push("Scripts should not use classes; use functions and fields on 'this'.");

  const declared = new Set();
  for (const m of clean.matchAll(/\b(?:function)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of clean.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of clean.matchAll(/\b(?:var|let|const)\s*[\[{]([^\]}]*)[\]}]/g)) m[1].split(",").forEach((p) => declared.add(p.split(":").pop().split("=")[0].trim()));
  const addParams = (list) => list.split(",").forEach((p) => { const n = p.split("=")[0].replace(/[.\s{}\[\]]/g, "").trim(); if (n) declared.add(n); });
  for (const m of clean.matchAll(/function\s*[\w$]*\s*\(([^)]*)\)/g)) addParams(m[1]);
  for (const m of clean.matchAll(/\(([^()]*)\)\s*=>/g)) addParams(m[1]);
  for (const m of clean.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) declared.add(m[1]);
  for (const m of clean.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);

  // Lifecycle functions: flag near-miss names and arrow-function lifecycles.
  for (const m of clean.matchAll(/\bfunction\s+(on[A-Z]\w*)/g)) {
    if (!LIFECYCLE_FUNCTIONS.includes(m[1])) warnings.push("'" + m[1] + "' is not a lifecycle function the engine calls." + suggest(m[1], LIFECYCLE_FUNCTIONS));
  }
  for (const m of clean.matchAll(/\b(?:const|let|var)\s+(on[A-Z]\w*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/g)) {
    warnings.push("'" + m[1] + "' is an arrow function; use 'function " + m[1] + "() {}' so 'this' is the entity.");
  }
  if (!LIFECYCLE_FUNCTIONS.some((n) => new RegExp("\\bfunction\\s+" + n + "\\b").test(clean))) {
    warnings.push("No lifecycle function found (onStart, onUpdate, onClick, ...): nothing will run.");
  }

  // Unknown free function calls (heuristic).
  const known = knownScriptGlobals();
  const seen = new Set();
  for (const m of clean.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[2];
    if (KEYWORDS.has(name) || declared.has(name) || known.has(name) || LIFECYCLE_FUNCTIONS.includes(name) || seen.has(name)) continue;
    seen.add(name);
    const hint = name === "find" ? " ('find' was removed; use findFirst(name))." : suggest(name, [...known, ...declared]);
    warnings.push("Unknown function '" + name + "()' — not a script global or declared here." + hint);
  }
  // Unknown shortcuts on this.
  for (const m of clean.matchAll(/\bthis\.(\w+)\b/g)) {
    const n = m[1];
    if (/^(x|y|z|rotation|scaleX|scaleY|name|tag|id|active|destroy)$/.test(n) || ENTITY_SHORTCUT_NAMES.includes(n)) continue;
    // Anything else is user state (this.hp = 100) — only warn on near-misses of shortcuts.
    const near = suggest(n, ENTITY_SHORTCUT_NAMES);
    if (near && !declaredOnThis(clean, n)) warnings.push("this." + n + " is not an entity shortcut." + near);
  }
  return { script: label || null, ok: errors.length === 0, errors, warnings, note: "Warnings are heuristic (static scan); errors are certain." };
}
function declaredOnThis(clean, n) { return new RegExp("\\bthis\\." + n + "\\s*=").test(clean); }

// ------------------------------------------------------------------ batch
async function runBatch(args, ctx) {
  const ops = args.operations;
  if (!Array.isArray(ops) || !ops.length) throw new Error("operations must be a non-empty array of {tool, arguments}.");
  if (ops.length > MAX_BATCH) throw new Error("A batch can hold at most " + MAX_BATCH + " operations.");
  for (const op of ops) {
    if (!op || typeof op.tool !== "string") throw new Error("Every operation needs a 'tool' name.");
    if (["batch", "restore_snapshot", "begin_asset_upload", "append_asset_upload_chunk", "complete_asset_upload", "export_game", "set_playing", "play_restart"].includes(op.tool)) {
      throw new Error("'" + op.tool + "' cannot run inside a batch. Call it on its own.");
    }
  }
  const stopOnError = args.stop_on_error !== false;
  const rollback = args.rollback_on_error !== false;
  const safety = rollback ? takeSnapshot("before batch") : null;
  const results = [];
  const extraContent = [];
  const digestBefore = ctx.digest ? ctx.digest() : null;
  const wantShots = args.screenshots === true && typeof ctx.takeScreenshot === "function";
  const shotImages = async (label) => {
    try { const r = await ctx.takeScreenshot(); (r.content || []).filter((p) => p.type === "image").forEach((p) => extraContent.push({ type: "text", text: label }, p)); } catch (_) { /* screenshots are best-effort */ }
  };
  if (wantShots) await shotImages("BEFORE the batch:");
  let failed = null;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    let res;
    try { res = await ctx.runTool(op.tool, op.arguments || {}); } catch (e) { res = { isError: true, content: [{ type: "text", text: String((e && e.message) || e) }] }; }
    const parts = Array.isArray(res && res.content) ? res.content : [];
    const textOut = parts.filter((p) => p.type === "text").map((p) => p.text).join("\n");
    parts.filter((p) => p.type === "image").forEach((p) => extraContent.push(p));
    const ok = !(res && res.isError);
    results.push({ index: i, tool: op.tool, ok, output: textOut.length > 3000 ? textOut.slice(0, 3000) + "… (truncated)" : textOut });
    if (!ok) { failed = failed || { index: i, tool: op.tool }; if (stopOnError) break; }
  }
  let rolledBack = false;
  if (failed && rollback && safety) {
    try { restoreSnapshot(safety); rolledBack = true; } catch (e) { results.push({ rollbackError: String((e && e.message) || e) }); }
  }
  if (safety) snapshots.delete(safety.id);
  if (wantShots) await shotImages("AFTER the batch:");
  const digestAfter = ctx.digest ? ctx.digest() : null;
  const summary = {
    changes: digestBefore && digestAfter ? formatDiff(diffDigests(digestBefore, digestAfter)).replace(/^CHANGES: /, "") : "unavailable (project too large to compare)",
    ran: results.filter((r) => r.tool).length, total: ops.length, failed, rolledBack,
    note: rolledBack ? "A failure rolled the project back to how it was before the batch (scenes + scripts; undo history was reset)."
      : failed ? "Stopped at the first failure; earlier operations were kept. Use undo or restore_snapshot to revert." : "All operations succeeded.",
    results,
  };
  const out = { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }, ...extraContent], isError: !!failed };
  return out;
}

// ------------------------------------------------------------------ editor_eval
async function runEval(args, ctx) {
  if (!ctx.allowEval) {
    throw new Error("editor_eval is disabled. Ask the user to enable 'Allow raw editor code (editor_eval)' in the AI panel if they want this.");
  }
  needWrite(ctx, "editor_eval");
  const code = typeof args.code === "string" ? args.code : "";
  if (!code.trim() || code.length > 20000) throw new Error("code must be 1-20000 characters of JavaScript.");
  const api = {
    editorState, world: world(), game: game(), COMPONENT_REGISTRY, snapshotNow,
    getAllScripts, getScriptSource, saveScript, markDirty, pushLog,
    render: () => { if (editorState.renderFn) editorState.renderFn(); },
  };
  pushLog("warn", "AI ran editor_eval (" + code.length + " chars).");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  let fn;
  try { fn = new AsyncFunction("api", "with (api) { " + (/\breturn\b/.test(code) ? code : "return (" + code.replace(/;\s*$/, "") + ");") + "\n}"); }
  catch (_) { fn = new AsyncFunction("api", "with (api) { " + code + "\n}"); }
  const value = await fn(api);
  markDirty();
  if (editorState.renderFn) editorState.renderFn();
  let out;
  try { out = JSON.stringify(value === undefined ? null : value, (k, v) => (typeof v === "function" ? "[function]" : v), 2); } catch (e) { out = String(value); }
  if (out && out.length > 20000) out = out.slice(0, 20000) + "… (truncated)";
  return text(out === undefined ? "null" : out);
}

// ------------------------------------------------------------------ performance
function sampleFps(ms = 600) {
  return new Promise((resolve) => {
    let frames = 0; const start = performance.now();
    const tick = (t) => { frames++; if (t - start >= ms) resolve((frames * 1000) / (t - start)); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}

// ------------------------------------------------------------------ dispatcher
export async function runMcpExtraTool(name, a = {}, ctx = {}) {
  switch (name) {
    // ---------- knowledge
    case "search_docs": return text({ query: a.query, results: searchDocs(a.query, a.limit) });
    case "get_script_api": return text(getScriptApi(a.topic));
    case "get_recipe": return text(getRecipe(a.name));
    case "validate_script": {
      if (typeof a.source === "string") return text(validateScriptSource(a.source, a.name || null));
      if (typeof a.name === "string") {
        if (!scriptExists(a.name)) throw new Error("No script named '" + a.name + "'. Use list_scripts." + suggest(a.name, getAllScripts()));
        return text(validateScriptSource(getScriptSource(a.name), a.name));
      }
      return text({ scripts: getAllScripts().map((n) => { const r = validateScriptSource(getScriptSource(n), n); return { script: n, ok: r.ok, errors: r.errors, warnings: r.warnings }; }) });
    }
    case "__resources_list": return text(listResources());
    case "__resources_read": return text(readResource(a.uri));

    // ---------- query
    case "find_entities": {
      let list = world().getAllEntities();
      if (a.name !== undefined) list = list.filter((e) => e.name === a.name);
      if (a.name_contains) list = list.filter((e) => e.name.toLowerCase().includes(String(a.name_contains).toLowerCase()));
      if (a.tag !== undefined) list = list.filter((e) => (e.tag || "") === a.tag);
      if (a.component) {
        if (!COMPONENT_REGISTRY[a.component]) throw new Error("Unknown component '" + a.component + "'." + suggest(a.component, Object.keys(COMPONENT_REGISTRY)));
        list = list.filter((e) => e.components.has(a.component));
      }
      if (a.active !== undefined) list = list.filter((e) => (e.active !== false) === !!a.active);
      if (a.near && Number.isFinite(a.near.x) && Number.isFinite(a.near.y)) {
        const r = Number.isFinite(a.near.radius) ? a.near.radius : 200;
        list = list.filter((e) => { const t = e.getComponent(TRANSFORM); return t && Math.hypot(t.x - a.near.x, t.y - a.near.y) <= r; });
      }
      const limit = Math.max(1, Math.min(Number(a.limit) || 100, 500));
      return text({ total: list.length, entities: list.slice(0, limit).map(entitySummary) });
    }
    case "get_selection": {
      const ids = (editorState.selectedIds && editorState.selectedIds.length ? editorState.selectedIds : editorState.selectedId ? [editorState.selectedId] : []);
      return text({ selectedIds: ids, entities: ids.map((id) => world().getEntity(id)).filter(Boolean).map(entitySummary) });
    }
    case "get_hierarchy": {
      const folders = world().hierarchyFolders || [];
      const all = world().getAllEntities();
      const node = (f) => ({
        id: f.id, name: f.name,
        entities: all.filter((e) => e.folderId === f.id).map(entitySummary),
        children: folders.filter((c) => c.parentId === f.id).map(node),
      });
      const ids = new Set(folders.map((f) => f.id));
      return text({
        folders: folders.filter((f) => !f.parentId || !ids.has(f.parentId)).map(node),
        unfiledEntities: all.filter((e) => !e.folderId || !ids.has(e.folderId)).map(entitySummary),
        note: "Realot's hierarchy is folders of entities (no entity-to-entity parenting).",
      });
    }
    case "move_entities_to_folder": {
      needWrite(ctx, name);
      const ids = Array.isArray(a.entity_ids) ? a.entity_ids : [];
      if (!ids.length) throw new Error("entity_ids must be a non-empty array.");
      let folderId = null;
      if (a.folder_id !== undefined && a.folder_id !== null) {
        if (!world().getHierarchyFolder(a.folder_id)) throw new Error("No folder '" + a.folder_id + "'. Use list_folders.");
        folderId = a.folder_id;
      }
      const targets = ids.map(needEntity);
      snapshotNow("scene");
      for (const e of targets) e.folderId = folderId;
      changed("moved " + targets.length + " entities to " + (folderId || "the top level"));
      return text({ moved: targets.map((e) => e.id), folderId });
    }

    // ---------- viewport
    case "get_viewport_camera": {
      const cam = getViewportCamera();
      if (!cam) throw new Error("The scene viewport is not ready.");
      const b = cam.getVisibleWorldBounds();
      return text({ zoomPercent: cam.zoomPercent, visibleWorldBounds: { minX: round(b.minX), minY: round(b.minY), maxX: round(b.maxX), maxY: round(b.maxY) }, centerX: round((b.minX + b.maxX) / 2), centerY: round((b.minY + b.maxY) / 2) });
    }
    case "set_viewport_camera": {
      const cam = getViewportCamera();
      if (!cam) throw new Error("The scene viewport is not ready.");
      const b = cam.getVisibleWorldBounds();
      const x = Number.isFinite(a.x) ? a.x : (b.minX + b.maxX) / 2;
      const y = Number.isFinite(a.y) ? a.y : (b.minY + b.maxY) / 2;
      const scale = Number.isFinite(a.zoom_percent) ? Math.min(600, Math.max(14, a.zoom_percent)) / 100 : cam.worldContainer.scale.x;
      const el = cam.pixiApp.view;
      cam.worldContainer.scale.set(scale);
      cam.worldContainer.x = (el.clientWidth || el.width) / 2 - x * scale;
      cam.worldContainer.y = (el.clientHeight || el.height) / 2 - y * scale;
      cam.updateZoomLabel();
      return text({ centeredOn: { x, y }, zoomPercent: cam.zoomPercent });
    }
    case "focus_entity": {
      const cam = getViewportCamera();
      if (!cam) throw new Error("The scene viewport is not ready.");
      const e = needEntity(a.entity_id);
      const t = e.getComponent(TRANSFORM);
      if (!t) throw new Error("That entity has no Transform.");
      const half = Number.isFinite(a.half_width) && a.half_width > 0 ? a.half_width : 40 * Math.max(Math.abs(t.scaleX), Math.abs(t.scaleY), 0.2);
      cam.focusOn(t.x, t.y, half, Number.isFinite(a.half_height) && a.half_height > 0 ? a.half_height : half);
      if (a.select !== false) { editorState.selectedId = e.id; editorState.selectedIds = [e.id]; if (editorState.renderFn) editorState.renderFn(); }
      return text({ focused: e.id, zoomPercent: cam.zoomPercent });
    }

    // ---------- settings
    case "get_engine_settings": return text(getEngineSettings());
    case "update_engine_settings": {
      needWrite(ctx, name);
      const patch = a.patch;
      if (!patch || typeof patch !== "object" || Array.isArray(patch) || !Object.keys(patch).length) throw new Error("patch must be a non-empty object.");
      const current = getEngineSettings();
      const clean = {};
      for (const [k, v] of Object.entries(patch)) {
        if (!(k in current)) throw new Error("Unknown setting '" + k + "'. Valid: " + Object.keys(current).join(", ") + "." + suggest(k, Object.keys(current)));
        if (typeof current[k] === "boolean") { if (typeof v !== "boolean") throw new Error(k + " must be true or false."); }
        else if (k === "gameFps") { if (!GAME_FPS_OPTIONS.includes(v)) throw new Error("gameFps must be one of " + GAME_FPS_OPTIONS.join(", ") + " (0 = unlimited)."); }
        else if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 1000) throw new Error(k + " must be a positive number.");
        clean[k] = v;
      }
      const merged = setEngineSettings(clean);
      pushLog("log", "AI: updated engine settings (" + Object.keys(clean).join(", ") + ")");
      return text(merged);
    }

    // ---------- scripts
    case "search_scripts": {
      const q = String(a.query || "");
      if (!q) throw new Error("query is required.");
      let re;
      try { re = a.regex ? new RegExp(q, a.case_sensitive ? "g" : "gi") : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), a.case_sensitive ? "g" : "gi"); }
      catch (e) { throw new Error("Invalid regular expression: " + e.message); }
      const matches = [];
      for (const n of getAllScripts()) {
        getScriptSource(n).split("\n").forEach((line, i) => { re.lastIndex = 0; if (re.test(line) && matches.length < 200) matches.push({ script: n, line: i + 1, text: line.trim().slice(0, 200) }); });
      }
      return text({ query: q, matchCount: matches.length, matches });
    }
    case "replace_in_scripts": {
      const find = String(a.find || "");
      if (!find) throw new Error("find is required.");
      const dry = a.dry_run !== false;
      if (!dry) needWrite(ctx, name);
      const names = Array.isArray(a.scripts) && a.scripts.length ? a.scripts : getAllScripts();
      let re;
      try { re = a.regex ? new RegExp(find, "g") : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"); } catch (e) { throw new Error("Invalid regular expression: " + e.message); }
      const report = [];
      for (const n of names) {
        if (!scriptExists(n)) throw new Error("No script named '" + n + "'." + suggest(n, getAllScripts()));
        const src = getScriptSource(n);
        const count = (src.match(re) || []).length;
        if (!count) continue;
        report.push({ script: n, replacements: count });
        if (!dry) saveScript(n, src.replace(re, String(a.replace ?? "")));
      }
      if (!dry && report.length) { syncScriptSourcesInWorld(world()); changed("replaced '" + find + "' in " + report.length + " script(s)"); }
      return text({ dryRun: dry, changed: report, note: dry ? "Nothing was changed. Call again with dry_run:false to apply." : "Applied. Script changes are not part of undo; use restore_snapshot if you took one." });
    }
    case "rename_script": {
      needWrite(ctx, name);
      if (!scriptExists(a.old_name)) throw new Error("No script named '" + a.old_name + "'." + suggest(a.old_name, getAllScripts()));
      if (!renameScriptEverywhere(a.old_name, a.new_name)) throw new Error("Could not rename: the new name is empty, unchanged, or already used.");
      changed("renamed script '" + a.old_name + "' to '" + a.new_name + "'");
      return text({ renamed: { from: a.old_name, to: a.new_name } });
    }

    // ---------- snapshots
    case "snapshot_project": return text({ created: snapInfo(takeSnapshot(a.label)), note: "Covers all scenes and scripts. Assets, prefabs, tags and physics layers are not included. Snapshots live in memory until the editor tab closes (max " + MAX_SNAPSHOTS + ")." });
    case "list_snapshots": return text({ snapshots: [...snapshots.values()].map(snapInfo) });
    case "restore_snapshot": {
      needWrite(ctx, name);
      const snap = snapshots.get(a.snapshot_id);
      if (!snap) throw new Error("No snapshot '" + a.snapshot_id + "'. Use list_snapshots.");
      restoreSnapshot(snap);
      return text({ restored: snapInfo(snap), note: "Undo history was reset." });
    }
    case "delete_snapshot": return text({ deleted: snapshots.delete(a.snapshot_id) });

    // ---------- power tools
    case "batch": return await runBatch(a, ctx);
    case "editor_eval": return await runEval(a, ctx);

    // ---------- telemetry
    case "get_performance": {
      const fps = await sampleFps(Number(a.sample_ms) > 0 ? Math.min(Number(a.sample_ms), 3000) : 600);
      const mem = performance && performance.memory ? { usedMB: round(performance.memory.usedJSHeapSize / 1048576), limitMB: round(performance.memory.jsHeapSizeLimit / 1048576) } : null;
      const entities = world().getAllEntities();
      const byComponent = {};
      for (const e of entities) for (const k of e.components.keys()) byComponent[k] = (byComponent[k] || 0) + 1;
      return text({ editorFps: round(fps), entityCount: entities.length, componentCounts: byComponent, jsHeap: mem, playing: !!editorState.isPlaying, note: "FPS is the editor tab's frame rate during sampling. For game logic timing use play_eval inside a running game." });
    }
    default: return null;
  }
}
