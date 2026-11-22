/**
 * McpDiff.js — "what did that tool just change?" for the AI bridge.
 *
 * captureDigest() records a cheap fingerprint of the project (entities with
 * per-component JSON, scripts, scene list); diffDigests(a, b) turns two
 * digests into a short human/AI readable summary. Pure functions over plain
 * data, so the diffing logic is unit-testable without the editor.
 */
const MAX_ENTITIES = 1500;   // beyond this a digest would cost too much per edit
const MAX_ENTITY_LINES = 12;
const MAX_CHANGES_PER_ENTITY = 6;

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return str.length + ":" + (h >>> 0).toString(36);
}
function json(v) { try { return JSON.stringify(v); } catch (_) { return "\"[unserializable]\""; } }

/** @returns {object|null} null when the project is too large to digest cheaply */
export function captureDigest(world, scripts, scenes) {
  if (!world) return null;
  const all = world.getAllEntities();
  if (all.length > MAX_ENTITIES) return null;
  const entities = {};
  for (const e of all) {
    const comps = {};
    for (const [type, c] of e.components.entries()) comps[type] = json(c);
    entities[e.id] = { name: e.name, tag: e.tag || "", active: e.active !== false, folderId: e.folderId || null, comps };
  }
  const scriptHashes = {};
  for (const [name, source] of Object.entries(scripts || {})) scriptHashes[name] = hash(String(source));
  return { entities, scripts: scriptHashes, scenes: scenes || { activeId: null, names: [] } };
}

const short = (v) => { const s = typeof v === "string" ? v : json(v); return s === undefined ? "undefined" : s.length > 40 ? s.slice(0, 37) + "..." : s; };

function componentChanges(type, beforeJson, afterJson) {
  let b, a;
  try { b = JSON.parse(beforeJson); a = JSON.parse(afterJson); } catch (_) { return [type + " changed"]; }
  const out = [];
  const keys = new Set([...Object.keys(b || {}), ...Object.keys(a || {})]);
  for (const k of keys) {
    if (k.startsWith("_")) continue;
    if (json(b[k]) !== json(a[k])) out.push(type + "." + k + ": " + short(b[k]) + " -> " + short(a[k]));
  }
  return out.length ? out : [type + " changed"];
}

/** @returns {object|null} null = nothing changed */
export function diffDigests(before, after) {
  if (!before || !after) return null;
  const added = [], removed = [], modified = [];
  for (const id of Object.keys(after.entities)) if (!before.entities[id]) added.push(id + " \"" + after.entities[id].name + "\"");
  for (const id of Object.keys(before.entities)) if (!after.entities[id]) removed.push(id + " \"" + before.entities[id].name + "\"");
  for (const id of Object.keys(after.entities)) {
    const b = before.entities[id], a = after.entities[id];
    if (!b) continue;
    const ch = [];
    for (const f of ["name", "tag", "active", "folderId"]) if (b[f] !== a[f]) ch.push(f + ": " + short(b[f]) + " -> " + short(a[f]));
    for (const t of Object.keys(a.comps)) {
      if (!(t in b.comps)) ch.push("+" + t);
      else if (b.comps[t] !== a.comps[t]) ch.push(...componentChanges(t, b.comps[t], a.comps[t]));
    }
    for (const t of Object.keys(b.comps)) if (!(t in a.comps)) ch.push("-" + t);
    if (ch.length) modified.push({ entity: id + " \"" + a.name + "\"", changes: ch.slice(0, MAX_CHANGES_PER_ENTITY).concat(ch.length > MAX_CHANGES_PER_ENTITY ? ["... +" + (ch.length - MAX_CHANGES_PER_ENTITY) + " more"] : []) });
  }
  const scriptsAdded = Object.keys(after.scripts).filter((n) => !(n in before.scripts));
  const scriptsRemoved = Object.keys(before.scripts).filter((n) => !(n in after.scripts));
  const scriptsChanged = Object.keys(after.scripts).filter((n) => n in before.scripts && before.scripts[n] !== after.scripts[n]);
  const sceneNote = before.scenes.activeId !== after.scenes.activeId || before.scenes.names.join("|") !== after.scenes.names.join("|")
    ? "scenes: " + before.scenes.names.join(", ") + " -> " + after.scenes.names.join(", ") + " (active " + before.scenes.activeId + " -> " + after.scenes.activeId + ")" : null;
  if (!added.length && !removed.length && !modified.length && !scriptsAdded.length && !scriptsRemoved.length && !scriptsChanged.length && !sceneNote) return null;
  const d = {};
  if (added.length) d.entitiesAdded = added.slice(0, MAX_ENTITY_LINES).concat(added.length > MAX_ENTITY_LINES ? ["... +" + (added.length - MAX_ENTITY_LINES) + " more"] : []);
  if (removed.length) d.entitiesRemoved = removed.slice(0, MAX_ENTITY_LINES).concat(removed.length > MAX_ENTITY_LINES ? ["... +" + (removed.length - MAX_ENTITY_LINES) + " more"] : []);
  if (modified.length) d.entitiesModified = modified.slice(0, MAX_ENTITY_LINES).concat(modified.length > MAX_ENTITY_LINES ? [{ entity: "... +" + (modified.length - MAX_ENTITY_LINES) + " more", changes: [] }] : []);
  if (scriptsAdded.length) d.scriptsAdded = scriptsAdded;
  if (scriptsRemoved.length) d.scriptsRemoved = scriptsRemoved;
  if (scriptsChanged.length) d.scriptsChanged = scriptsChanged;
  if (sceneNote) d.scenes = sceneNote;
  return d;
}

export function formatDiff(d) {
  return d ? "CHANGES: " + JSON.stringify(d) : "CHANGES: none (no scene or script data differs).";
}
