// Drives the REAL editor event handlers with a multi-selection: Hierarchy Ctrl/Shift clicks, edits applied to every selected object, active checkbox, sprite picker.
const listeners = {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const noopEl = () => ({ addEventListener() {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, style: {}, appendChild() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [] });
globalThis.document = { head: { appendChild() {} }, body: { classList: { contains: () => false, add() {}, remove() {}, toggle() {} }, appendChild() {} }, documentElement: { style: {}, requestFullscreen() {} },
  addEventListener(t, f) { (listeners[t] ||= []).push(f); }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: noopEl, hasFocus: () => true, activeElement: null };
globalThis.window = { addEventListener() {}, localStorage: globalThis.localStorage, location: { origin: "http://x", search: "", href: "http://x/" }, prompt: () => "NewTag", confirm: () => true, innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "t", clipboard: {} }, configurable: true });
globalThis.requestAnimationFrame = () => 0; globalThis.cancelAnimationFrame = () => {};
globalThis.setInterval = () => 0;
let mod;
try { mod = await import("../project/editor/state/EditorEvents.js"); }
catch (e) { console.log("IMPORT FAILED:", e.message.split("\n")[0]); process.exit(2); }
const { World } = await import("../project/runtime/core/World.js");
const { TRANSFORM, Transform } = await import("../project/runtime/components/Transform.js");
const { SPRITE_RENDERER, SpriteRenderer } = await import("../project/runtime/components/SpriteRenderer.js");
const { editorState } = await import("../project/editor/state/EditorState.js");
let renders = 0; mod.attachEditorEvents(() => { renders++; }, () => {});
const world = new World(); editorState.world = world;
const mk = (n, x, y, withSprite) => { const e = world.createEntity(n, "Untagged"); e.addComponent(TRANSFORM, new Transform({ x, y })); if (withSprite) e.addComponent(SPRITE_RENDERER, new SpriteRenderer({ color: "#ff0000" })); return e; };
const a = mk("A", 1, 2, true), b = mk("B", 3, 4, true), c = mk("C", 5, 6, false);
let fails = 0; const ok = (n, cond, x = "") => { console.log((cond ? "PASS " : "FAIL ") + n + (cond ? "" : " " + x)); if (!cond) fails++; };
const fire = (type, target) => (listeners[type] || []).forEach((f) => f({ target, preventDefault() {}, stopPropagation() {} }));
const num = (field, axis, value) => ({ dataset: { field, axis }, value: String(value), type: "number", checked: false });

// single selection: unchanged behaviour
editorState.selectedId = a.id; editorState.selectedIds = [a.id];
fire("input", num("Transform.position", "x", 50)); fire("change", num("Transform.position", "x", 50));
ok("single: only A moved", a.getComponent(TRANSFORM).x === 50 && b.getComponent(TRANSFORM).x === 3);

// multi: one axis edit reaches every selected object; other axes untouched
editorState.selectedId = b.id; editorState.selectedIds = [a.id, b.id, c.id];
fire("input", num("Transform.position", "x", 7)); fire("change", num("Transform.position", "x", 7));
const T = (e) => e.getComponent(TRANSFORM);
ok("X set on all three", T(a).x === 7 && T(b).x === 7 && T(c).x === 7, [T(a).x, T(b).x, T(c).x].join());
ok("Y values left alone (still different)", T(a).y === 2 && T(b).y === 4 && T(c).y === 6, [T(a).y, T(b).y, T(c).y].join());
ok("primary selection restored after the edit", editorState.selectedId === b.id);

// component only some objects have: C (no sprite) is skipped, no crash
const colour = { dataset: { field: "SpriteRenderer.color" }, value: "#00ff00", type: "color", checked: false };
fire("input", colour); fire("change", colour);
ok("sprite colour set on A and B", a.getComponent(SPRITE_RENDERER).color === "#00ff00" && b.getComponent(SPRITE_RENDERER).color === "#00ff00");
ok("C (no sprite) skipped without error", c.getComponent(SPRITE_RENDERER) === undefined || c.getComponent(SPRITE_RENDERER) === null);

// tag: normal tag applies to all; "Add Tag..." prompts once and tags all
fire("change", { dataset: { field: "entity.tag" }, value: "Player", type: "select-one" });
ok("tag set on all", a.tag === "Player" && b.tag === "Player" && c.tag === "Player", [a.tag, b.tag, c.tag].join());
let prompts = 0; window.prompt = () => { prompts++; return "Boss"; };
fire("change", { dataset: { field: "entity.tag" }, value: "Add Tag...", type: "select-one" });
ok("'Add Tag...' asks once and tags every object", prompts === 1 && a.tag === "Boss" && b.tag === "Boss" && c.tag === "Boss", prompts + " " + [a.tag, b.tag, c.tag].join());

// stale ids in the selection never crash
editorState.selectedIds = [a.id, "gone", b.id]; editorState.selectedId = a.id;
fire("input", num("Transform.position", "y", 9)); fire("change", num("Transform.position", "y", 9));
ok("stale id ignored, real ones edited", T(a).y === 9 && T(b).y === 9);

// ---------------- clicks (Hierarchy + checkbox + sprite picker) ----------------
const rowsIds = [a.id, b.id, c.id];
document.querySelectorAll = (sel) => (sel === ".hierarchy-tree .entity-row" ? rowsIds.map((id) => ({ dataset: { id } })) : []);
const click = (action, data = {}, mods = {}) => { const tgt = { dataset: { action, ...data }, closest: (sel) => (sel === "[data-action]" ? tgt : null) }; (listeners["click"] || []).forEach((f) => f({ target: tgt, preventDefault() {}, stopPropagation() {}, ...mods })); };
click("select-entity", { id: a.id });
ok("click: plain click selects one", editorState.selectedIds.length === 1 && editorState.selectedId === a.id && editorState.selectionAnchorId === a.id);
click("select-entity", { id: c.id }, { ctrlKey: true });
ok("click: Ctrl adds", editorState.selectedIds.join() === [a.id, c.id].join() && editorState.selectedId === c.id);
click("select-entity", { id: c.id }, { ctrlKey: true });
ok("click: Ctrl again removes", editorState.selectedIds.join() === a.id && editorState.selectedId === a.id);
click("select-entity", { id: a.id });
click("select-entity", { id: c.id }, { shiftKey: true });
ok("click: Shift selects the range a..c", editorState.selectedIds.join() === rowsIds.join() && editorState.selectedId === c.id, editorState.selectedIds.join());
click("select-entity", { id: b.id }, { metaKey: true });
ok("click: Cmd (Mac) also toggles", !editorState.selectedIds.includes(b.id));
click("select-entity", { id: b.id }); ok("click: plain click collapses to one", editorState.selectedIds.length === 1);

// active checkbox on several objects
editorState.selectedId = a.id; editorState.selectedIds = [a.id, b.id, c.id];
a.active = true; b.active = false; c.active = true;
click("toggle-entity-active"); ok("active: mixed -> all on", a.active && b.active && c.active);
click("toggle-entity-active"); ok("active: all on -> all off", !a.active && !b.active && !c.active);
click("toggle-entity-active"); ok("active: all off -> all on", a.active && b.active && c.active);
editorState.selectedIds = [a.id]; editorState.selectedId = a.id; click("toggle-entity-active"); ok("active: single object flips only itself", !a.active && b.active);
a.active = true;

// sprite picker applies to every selected object that has a Sprite Renderer
editorState.selectedId = a.id; editorState.selectedIds = [a.id, b.id, c.id]; editorState.spritePickerTarget = "SpriteRenderer";
click("sprite-picker-choose", { spriteKey: "sprite_9_new" });
ok("sprite pick: A and B changed, C (no sprite renderer) untouched", a.getComponent(SPRITE_RENDERER).spriteKey === "sprite_9_new" && b.getComponent(SPRITE_RENDERER).spriteKey === "sprite_9_new");
console.log(fails ? fails + " FAILED" : "ALL EDIT-ALL TESTS PASSED");
