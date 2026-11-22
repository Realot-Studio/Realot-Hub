/**
 * McpDocs.js — offline engine knowledge for the AI bridge.
 *
 * Everything here is generated from the engine itself so it cannot drift:
 *   - component reference: instantiated from COMPONENT_REGISTRY (real defaults)
 *   - script API: script-api-index.json, built from ScriptAPI.js by
 *     scripts/build-script-api-index.mjs
 *   - guide / topics: EngineGuide.js
 * Powers the MCP resources (resources/list + resources/read), search_docs,
 * get_script_api and validate_script.
 */
import { ENGINE_GUIDE } from "./EngineGuide.js";
import { COMPONENT_REGISTRY } from "../../runtime/scene/SceneSerializer.js";
import SCRIPT_API from "./script-api-index.js";

// Names that exist in every script besides the generated API globals.
const ENTITY_SHORTCUTS = ["sprite", "shape", "text", "rigidbody", "collider", "controller", "animator", "camera", "audio", "navAgent"];
const LIFECYCLE = ["onStart", "onUpdate", "onFixedUpdate", "onClick", "onCollisionEnter", "onCollisionStay", "onCollisionExit", "onTriggerEnter", "onTriggerExit", "onMessage", "onDestroy", "onClone"];

/** Recipes use only APIs documented in the guide / script API index. */
const RECIPES = {
  "platformer-player": `PLATFORMER PLAYER
1. create_entity "Player" tag "Player" with Rigidbody2D (Dynamic), Collider2D, ShapeRenderer or SpriteRenderer, and a CharacterController (see describe_component CharacterController).
2. Floors/walls: entities with Collider2D + a Static Rigidbody2D.
3. Or drive it from a script:
   function onUpdate(dt) {
     let vx = 0;
     if (input.keyDown("ArrowLeft")) vx -= 200;
     if (input.keyDown("ArrowRight")) vx += 200;
     this.rigidbody.velocityX = vx;
     if (input.keyPressed("Space")) this.rigidbody.velocityY = -450; // up is negative Y
   }
4. Test: play_restart, play_input hold ["right"] 1s, assert findFirst('Player').x grew.`,
  "collectible-and-score": `COLLECTIBLE + SCORE
- Coin: entity tag "Coin", Collider2D with isTrigger on, plus a script:
   function onTriggerEnter(other) { if (other.tag === "Player") { global.score = (global.score || 0) + 1; this.destroy(); } }
- The Player needs a Collider2D (and a Rigidbody2D) for triggers to fire.
- Show the score with a TextRenderer (screenSpace true) updated from a script reading global.score.
- Test: move the player onto the coin with play_eval, then assert global.score === 1.`,
  "win-lose-restart": `WIN / LOSE / RESTART
- Track state in global (global.won, global.lives). On lose: show a TextRenderer, then wait(2, function () { scene.restart(); }).
- Next level: scene.load("Level 2") (create_scene first; names must match exactly).`,
  "timers-and-spawning": `TIMERS + SPAWNING
- wait(1.5, fn) once; repeat(0.5, fn) repeatedly; cancelWait/cancelRepeat to stop. Start them from a lifecycle function (onStart).
- spawn(nameOrTagOrEntity, opts) clones an entity; clones run onClone first. Use pool for frequent spawns.`,
  "enemy-chase-nav": `ENEMY CHASE WITH NAVIGATION
- Add a NavWorld2D covering the level, bake_navworld (or paint_navigation_cells), then give the enemy a NavAgent2D (describe_component NavAgent2D) and drive its target from a script.
- nav.findPath / nav.isWalkable exist for manual pathing (get_script_api nav).`,
  "ui-buttons": `UI BUTTON
- Entity with a visual (ShapeRenderer/SpriteRenderer + TextRenderer), a Collider2D and: function onClick() { scene.load("Game"); }
- Test with play_input {"type":"click","entity":"PlayButton"}.`,
};

function describeFields(type) {
  const Ctor = COMPONENT_REGISTRY[type];
  if (!Ctor) return null;
  let inst;
  try { inst = new Ctor({}); } catch (_) { return { type, fields: {} }; }
  const fields = {};
  for (const [k, v] of Object.entries(inst)) {
    if (k.startsWith("_")) continue;
    const t = Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
    let d = v;
    try { d = JSON.stringify(v); } catch (_) { d = String(v); }
    fields[k] = { type: t, default: d && d.length > 120 ? d.slice(0, 117) + "..." : d };
  }
  return { type, fields };
}

function componentMarkdown(type) {
  const info = describeFields(type);
  if (!info) return null;
  const lines = [`# Component: ${type}`, "", "Fields (type, default). Use describe_component for allowed enum values.", ""];
  for (const [k, f] of Object.entries(info.fields)) lines.push(`- ${k}: ${f.type} = ${f.default}`);
  return lines.join("\n");
}

function apiMarkdown(name) {
  const g = SCRIPT_API.globals[name];
  if (!g) return null;
  const lines = [`# Script global: ${name}`, ""];
  if (g.signature) lines.push("`" + g.signature + "`");
  if (g.doc) lines.push(g.doc);
  for (const m of Object.values(g.members || {})) lines.push("", "- `" + m.signature + "`" + (m.doc ? " — " + m.doc : ""));
  return lines.join("\n");
}

function apiOverviewMarkdown() {
  const lines = ["# Realot script API (generated from the engine source)", "",
    "Lifecycle: " + LIFECYCLE.join(", "), "",
    "Entity shortcuts on `this` (only when the entity has the component): " + ENTITY_SHORTCUTS.join(", "), "", "Globals:"];
  for (const [name, g] of Object.entries(SCRIPT_API.globals)) {
    const members = Object.keys(g.members || {});
    lines.push("- " + (g.signature || name) + (members.length ? " — members: " + members.join(", ") : "") + (g.doc ? "\n    " + g.doc.slice(0, 160) : ""));
  }
  lines.push("", "Also available: time.deltaTime, global (shared values), tween(target, properties, duration, easing, onComplete).");
  return lines.join("\n");
}

/** All known script-visible global names, for validate_script. */
export function knownScriptGlobals() {
  return new Set([...Object.keys(SCRIPT_API.globals), "time", "global", "save", "tween", "debug", "this", "console", "Math", "JSON", "Date", "Array", "Object", "Number", "String", "Boolean", "parseInt", "parseFloat", "isNaN", "isFinite", "undefined", "NaN", "Infinity", "setTimeout", "clearTimeout", "Map", "Set", "Promise", "Error", "RegExp", "Symbol"]);
}
export const LIFECYCLE_FUNCTIONS = LIFECYCLE;
export const ENTITY_SHORTCUT_NAMES = ENTITY_SHORTCUTS;

/** MCP resources: [{uri,name,description,mimeType}] */
export function listResources() {
  const out = [
    { uri: "realot://guide/overview", name: "Engine guide", description: "Workflow, coordinates, scripting basics, testing tools.", mimeType: "text/plain" },
    { uri: "realot://api/script", name: "Script API overview", description: "Every script global and lifecycle function, generated from the engine.", mimeType: "text/markdown" },
  ];
  for (const t of Object.keys(ENGINE_GUIDE.topics)) out.push({ uri: "realot://guide/" + t, name: "Guide: " + t, description: "Engine guide topic.", mimeType: "text/plain" });
  for (const g of Object.keys(SCRIPT_API.globals)) out.push({ uri: "realot://api/script/" + g, name: "Script global: " + g, description: "Signature and docs for " + g + ".", mimeType: "text/markdown" });
  for (const c of Object.keys(COMPONENT_REGISTRY)) out.push({ uri: "realot://components/" + c, name: "Component: " + c, description: "Fields and defaults of " + c + ".", mimeType: "text/markdown" });
  for (const r of Object.keys(RECIPES)) out.push({ uri: "realot://recipes/" + r, name: "Recipe: " + r, description: "Tested building recipe.", mimeType: "text/plain" });
  return out;
}

export function readResource(uri) {
  const m = /^realot:\/\/([^/]+)(?:\/(.+))?$/.exec(String(uri || ""));
  if (!m) throw new Error("Unknown resource uri: " + uri);
  const [, kind, rest] = m;
  let body = null;
  if (kind === "guide") body = rest === "overview" ? ENGINE_GUIDE.overview : ENGINE_GUIDE.topics[rest];
  else if (kind === "api") body = (!rest || rest === "script") ? apiOverviewMarkdown() : rest.startsWith("script/") ? apiMarkdown(rest.slice(7)) : null;
  else if (kind === "components") body = rest ? componentMarkdown(rest) : null;
  else if (kind === "recipes") body = rest ? RECIPES[rest] : null;
  if (!body) throw new Error("Unknown resource uri: " + uri);
  return { uri, mimeType: "text/plain", text: body };
}

/** Keyword search across guide, topics, recipes, script API and components. */
export function searchDocs(query, limit = 8) {
  const terms = String(query || "").toLowerCase().split(/[^a-z0-9_.]+/).filter(Boolean);
  if (!terms.length) throw new Error("query must contain at least one word.");
  const docs = [];
  docs.push({ uri: "realot://guide/overview", title: "Engine guide", text: ENGINE_GUIDE.overview });
  for (const [k, v] of Object.entries(ENGINE_GUIDE.topics)) docs.push({ uri: "realot://guide/" + k, title: "Guide: " + k, text: v });
  for (const [k, v] of Object.entries(RECIPES)) docs.push({ uri: "realot://recipes/" + k, title: "Recipe: " + k, text: v });
  for (const [name, g] of Object.entries(SCRIPT_API.globals)) {
    docs.push({ uri: "realot://api/script/" + name, title: "Script global: " + name, text: apiMarkdown(name) });
  }
  for (const c of Object.keys(COMPONENT_REGISTRY)) docs.push({ uri: "realot://components/" + c, title: "Component: " + c, text: componentMarkdown(c) || c });
  const scored = [];
  for (const d of docs) {
    const hay = (d.title + " " + d.text).toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (d.title.toLowerCase().includes(t)) score += 5;
      let idx = 0, hits = 0;
      while ((idx = hay.indexOf(t, idx)) !== -1 && hits < 10) { hits++; idx += t.length; }
      score += hits;
    }
    if (score > 0) {
      const lower = d.text.toLowerCase();
      const at = Math.max(0, Math.min(...terms.map((t) => { const i = lower.indexOf(t); return i < 0 ? 1e9 : i; })));
      scored.push({ uri: d.uri, title: d.title, score, snippet: d.text.slice(Math.max(0, at - 80), at + 320).replace(/\s+/g, " ").trim() });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, Math.min(limit, 20)));
}

export function getScriptApi(topic) {
  if (!topic) return apiOverviewMarkdown();
  const key = String(topic).replace(/\(\)$/, "").split(".")[0];
  const md = apiMarkdown(key);
  if (md) return md;
  const names = Object.keys(SCRIPT_API.globals);
  throw new Error("No script global '" + topic + "'." + suggest(key, names));
}

export function getRecipe(name) {
  if (!name) return "Recipes: " + Object.keys(RECIPES).join(", ");
  if (!RECIPES[name]) throw new Error("No recipe '" + name + "'. Available: " + Object.keys(RECIPES).join(", "));
  return RECIPES[name];
}

// ---- "did you mean" helper, shared with the bridge's error messages ----
function distance(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
}
export function suggest(input, options) {
  const x = String(input || "").toLowerCase();
  const best = options.map((o) => ({ o, s: distance(x, o.toLowerCase()) })).sort((p, q) => p.s - q.s)[0];
  return best && best.s <= Math.max(2, Math.floor(x.length / 3)) ? " Did you mean '" + best.o + "'?" : "";
}
