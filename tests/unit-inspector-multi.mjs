// Multi-select Inspector: draws the REAL Inspector for several objects and checks what
// the combined panel shows (shared sections, "different values" markers, removed single-object buttons).
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { body: { classList: { contains: () => false } }, addEventListener() {}, getElementById: () => null, querySelector: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, localStorage: globalThis.localStorage };

const { World } = await import("../project/runtime/core/World.js");
const { TRANSFORM, Transform } = await import("../project/runtime/components/Transform.js");
const { SPRITE_RENDERER, SpriteRenderer } = await import("../project/runtime/components/SpriteRenderer.js");
const { RIGIDBODY_2D, Rigidbody2D } = await import("../project/runtime/components/Rigidbody2D.js");
const { editorState } = await import("../project/editor/state/EditorState.js");
const { renderInspector } = await import("../project/editor/panels/Inspector.js");

const world = new World();
function make(name, { x, y, sprite, body, tag }) {
  const e = world.createEntity(name, tag || "Untagged");
  e.addComponent(TRANSFORM, new Transform({ x, y }));
  if (sprite) e.addComponent(SPRITE_RENDERER, new SpriteRenderer({ color: sprite }));
  if (body) e.addComponent(RIGIDBODY_2D, new Rigidbody2D({}));
  return e;
}
const a = make("A", { x: 10, y: 5, sprite: "#ff0000", body: true });
const b = make("B", { x: 10, y: 99, sprite: "#ff0000", body: true });
const c = make("C", { x: 10, y: 5, sprite: "#00ff00" });            // no Rigidbody2D

editorState.world = world;

// ---- single object: unchanged behaviour
editorState.selectedId = a.id; editorState.selectedIds = [a.id];
const single = renderInspector();
assert.match(single, /data-action="rename-entity"/, "single: name box present");
assert.match(single, /data-action="add-component"/, "single: Add Component present");
assert.match(single, /data-section-key="rigidbody"/, "single: Rigidbody section present");

// ---- two objects that both have Rigidbody
editorState.selectedId = b.id; editorState.selectedIds = [a.id, b.id];
const two = renderInspector();
assert.match(two, /2 objects selected/, "banner shown");
assert.doesNotMatch(two, /data-action="rename-entity"/, "name box removed (would rename everything)");
assert.doesNotMatch(two, /data-action="add-component"/, "Add Component removed");
assert.doesNotMatch(two, /data-action="remove-component"/, "remove-component buttons removed");
assert.match(two, /data-section-key="rigidbody"/, "shared Rigidbody section kept");
assert.match(two, /data-section-key="transform"/, "shared Transform kept");
const field = (html, f, axis) => new RegExp('<input[^>]*data-field="' + f + '"[^>]*' + (axis ? 'data-axis="' + axis + '"' : "") + "[^>]*>").exec(html);
const px = (html) => /<input[^>]*value="[^"]*"[^>]*data-field="Transform.position"[^>]*data-axis="x"[^>]*>/.exec(html)[0];
const py = (html) => /<input[^>]*value="[^"]*"[^>]*data-field="Transform.position"[^>]*data-axis="y"[^>]*>/.exec(html)[0];
assert.doesNotMatch(px(two), /data-mixed/, "X is the same (10) so it is NOT marked mixed");
assert.match(px(two), /value="10"/, "X shows the shared value");
assert.match(py(two), /data-mixed="1"/, "Y differs (5 vs 99) so it IS marked mixed");
assert.match(py(two), /value=""/, "mixed Y is blank");
assert.match(py(two), /placeholder="&#8212;"/, "mixed Y shows a dash");
assert.match(two, /type="color"[^>]*value="#ff0000"/, "same sprite colour shown");

// ---- add C (no Rigidbody): only shared sections remain
editorState.selectedId = c.id; editorState.selectedIds = [a.id, b.id, c.id];
const three = renderInspector();
assert.doesNotMatch(three, /data-section-key="rigidbody"/, "Rigidbody dropped: not every object has it");
assert.match(three, /data-section-key="sprite"/, "Sprite Renderer kept: all three have it");
assert.match(three, /type="color"[^>]*data-field="SpriteRenderer.color"[^>]*data-mixed="1"|data-mixed="1"[^>]*SpriteRenderer.color|SpriteRenderer.color[^>]*data-mixed="1"/, "sprite colour differs (red/red/green) so it is marked mixed");
assert.match(three, /3 objects selected/);

// ---- tags: differing tags => select marked mixed with a dash option
a.tag = "Player"; b.tag = "Enemy"; editorState.selectedId = b.id; editorState.selectedIds = [a.id, b.id];
const tagged = renderInspector();
assert.match(tagged, /<select[^>]*data-field="entity.tag"[^>]*data-mixed="1"/, "different tags -> mixed select");
assert.match(tagged, /<option value="" selected disabled hidden>&#8212;<\/option>/, "dash option present");
assert.equal((tagged.match(/ selected(?=[ >])/g) || []).filter(Boolean).length >= 1, true);

// ---- active checkbox: one on, one off => mixed
a.active = true; b.active = false;
const act = renderInspector();
assert.match(act, /<input type="checkbox" class="mixed" data-mixed="1" data-action="toggle-entity-active" \/>/, "active checkbox mixed");
a.active = true; b.active = true;
assert.match(renderInspector(), /<input type="checkbox" checked data-action="toggle-entity-active" \/>/, "all active: normal checked box");

// ---- unselected / stale ids never crash
editorState.selectedIds = [a.id, "does-not-exist"]; editorState.selectedId = a.id;
assert.match(renderInspector(), /data-action="rename-entity"/, "one real object left: behaves like single selection");

console.log("Inspector multi-select tests passed.");
