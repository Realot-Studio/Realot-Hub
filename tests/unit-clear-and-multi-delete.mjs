// Clear Scene, confirmations (objects / folders / assets) and multi-select delete in the Project panel, through the REAL editor event handlers.
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
const { CAMERA, Camera } = await import("../project/runtime/components/Camera.js");
const { registerSpriteAsset, getSpriteAsset, registerAudioAsset: _ra } = await import("../project/runtime/assets/AssetRegistry.js");
const { SPRITE_RENDERER, SpriteRenderer } = await import("../project/runtime/components/SpriteRenderer.js");
const { editorState } = await import("../project/editor/state/EditorState.js");
let renders = 0; mod.attachEditorEvents(() => { renders++; }, () => {});

const world = new World(); editorState.world = world;
let confirms = []; let confirmAnswer = true;
window.confirm = (msg) => { confirms.push(msg); return confirmAnswer; };
const T = (e) => e.getComponent(TRANSFORM);
const mk = (n) => { const e = world.createEntity(n, "Untagged"); e.addComponent(TRANSFORM, new Transform({ x: 0, y: 0 })); return e; };
const cam = world.createEntity("Main Camera", "MainCamera"); cam.addComponent(TRANSFORM, new Transform({})); cam.addComponent(CAMERA, new Camera({}));
let fails = 0; const ok = (n, cond, x = "") => { console.log((cond ? "PASS " : "FAIL ") + n + (cond ? "" : " " + x)); if (!cond) fails++; };
const click = (action, data = {}, mods = {}, extra = {}) => { const tgt = { dataset: { action, ...data }, tagName: "DIV", closest: (sel) => (sel === "[data-action]" ? tgt : null), ...extra }; (listeners["click"] || []).forEach((f) => f({ target: tgt, preventDefault() {}, stopPropagation() {}, ...mods })); };
const key = (k) => (listeners["keydown"] || []).forEach((f) => f({ key: k, target: { tagName: "DIV", isContentEditable: false, closest: () => null }, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault() {}, stopPropagation() {} }));
const press = (inGrid) => (listeners["pointerdown"] || []).forEach((f) => f({ target: { closest: (sel) => (inGrid && sel === ".proj-grid" ? {} : null) } }));
const names = () => world.getAllEntities().map((e) => e.name).sort();

// scenes stub
let sceneList = [{ id: "s1", name: "Level 1" }, { id: "s2", name: "Level 2" }, { id: "s3", name: "Level 3" }]; let activeScene = "s1"; const deletedScenes = [];
editorState.game = { getSceneList: () => sceneList.slice(), getActiveSceneId: () => activeScene, deleteScene: (id) => { if (sceneList.length <= 1) return false; sceneList = sceneList.filter((s) => s.id !== id); deletedScenes.push(id); if (id === activeScene) activeScene = sceneList[0].id; return true; } };

// ---------------- Edit > Clear Scene ----------------
for (let i = 0; i < 8; i++) mk("Obj" + i);
const f1 = world.createHierarchyFolder("Enemies", null); const f2 = world.createHierarchyFolder("Props", null);
world.moveEntityToFolder(world.getAllEntities()[1].id, f1.id); cam.folderId = f2.id;       // even the camera sits in a folder
editorState.selectedIds = [world.getAllEntities()[1].id]; editorState.selectedId = world.getAllEntities()[1].id;
confirmAnswer = false; confirms = [];
click("clear-scene");
ok("Clear Scene asks first (and names the scene + counts)", confirms.length === 1 && /Clear scene "Level 1"/.test(confirms[0]) && /8 objects and 2 folders/.test(confirms[0]), confirms[0]);
ok("answering Cancel deletes nothing", world.getAllEntities().length === 9 && world.hierarchyFolders.length === 2);
confirmAnswer = true; confirms = []; editorState.assetSelection = { folder: null, ids: [], anchorId: null };
click("clear-scene");
ok("after OK: only the Camera is left", names().join() === "Main Camera", names().join());
ok("all folders removed and the camera is no longer inside one", world.hierarchyFolders.length === 0 && (cam.folderId === null || cam.folderId === undefined), String(cam.folderId));
ok("selection cleared", editorState.selectedIds.length === 0);
const { performUndoRedo } = await import("../project/editor/state/UndoManager.js");
let undone = false; try { undone = performUndoRedo("undo"); } catch (e) { console.log("(undo check skipped:", e.message.split("\n")[0] + ")"); }
if (undone) ok("one Ctrl+Z brings the whole scene back", world.getAllEntities().length === 9, String(world.getAllEntities().length));
confirms = []; for (const e of world.getAllEntities()) if (e !== cam) world.destroyEntity(e.id);
for (const f of world.hierarchyFolders.slice()) world.deleteHierarchyFolder(f.id);
click("clear-scene"); ok("already-empty scene: no question, just a message", confirms.length === 0 && /already empty/.test(editorState.logs.at(-1).text || editorState.logs.at(-1).message || JSON.stringify(editorState.logs.at(-1))));

// ---------------- deleting many objects from the Hierarchy ----------------
const many = Array.from({ length: 6 }, (_, i) => mk("M" + i)); const few = [mk("F0"), mk("F1")];
editorState.selectedIds = few.map((e) => e.id); editorState.selectedId = few[0].id; confirms = [];
key("Delete"); ok("2 objects: deleted instantly, no question", confirms.length === 0 && !world.getEntity(few[0].id));
editorState.selectedIds = many.map((e) => e.id); editorState.selectedId = many[0].id; confirmAnswer = false; confirms = [];
key("Delete"); ok("6 objects: asks first; Cancel keeps them", confirms.length === 1 && /Delete 6 objects/.test(confirms[0]) && many.every((e) => world.getEntity(e.id)));
confirmAnswer = true; confirms = []; key("Delete"); ok("OK deletes all 6", many.every((e) => !world.getEntity(e.id)));

// ---------------- deleting a Hierarchy folder ----------------
const fd = world.createHierarchyFolder("Boss", null); const inside = mk("InsideBoss"); world.moveEntityToFolder(inside.id, fd.id);
confirmAnswer = false; confirms = []; click("delete-hierarchy-folder", { folderId: fd.id });
ok("folder: asks, Cancel keeps it", confirms.length === 1 && /Delete folder "Boss"/.test(confirms[0]) && !!world.getHierarchyFolder(fd.id));
confirmAnswer = true; click("delete-hierarchy-folder", { folderId: fd.id });
ok("folder: OK removes the folder but NOT the object inside", !world.getHierarchyFolder(fd.id) && !!world.getEntity(inside.id));

// ---------------- Project panel: select several sprites and delete ----------------
for (let i = 1; i <= 6; i++) registerSpriteAsset({ key: "spr_" + i, name: "Sprite " + i, dataUrl: "data:," });
editorState.bottomTab = "project"; editorState.projectFolder = "sprites";
document.querySelectorAll = (sel) => (sel === ".proj-grid .asset-item[data-asset-id]" ? [1, 2, 3, 4, 5, 6].map((i) => ({ dataset: { assetId: "spr_" + i } })) : sel === ".hierarchy-tree .entity-row" ? [] : []);
const tile = (id) => ({ dataset: { assetId: id, action: "drag-sprite-asset" }, closest: (s) => (s === "[data-asset-id]" ? tile.cache[id] : s === "[data-action]" ? tile.cache[id] : s === ".proj-grid" ? {} : null), tagName: "DIV" });
tile.cache = {}; ["spr_1","spr_2","spr_3","spr_4","spr_5","spr_6"].forEach((id) => { tile.cache[id] = tile(id); });
const tileClick = (id, mods = {}) => { const t = tile.cache[id]; (listeners["click"] || []).forEach((f) => f({ target: t, preventDefault() {}, stopPropagation() {}, ...mods })); };
press(true); tileClick("spr_2");
ok("plain click selects one tile", editorState.assetSelection.ids.join() === "spr_2" && editorState.assetSelection.folder === "sprites");
tileClick("spr_5", { shiftKey: true });
ok("Shift+click selects the range 2..5", editorState.assetSelection.ids.join() === "spr_2,spr_3,spr_4,spr_5", editorState.assetSelection.ids.join());
tileClick("spr_3", { ctrlKey: true }); ok("Ctrl+click removes one from the selection", editorState.assetSelection.ids.join() === "spr_2,spr_4,spr_5");
confirmAnswer = false; confirms = []; press(true); key("Delete");
ok("Delete key in the grid asks once and names them", confirms.length === 1 && /Delete 3 sprites\?/.test(confirms[0]) && /Sprite 2/.test(confirms[0]) && !!getSpriteAsset("spr_2"), confirms[0]);
ok("scene objects untouched by an asset Delete", !!world.getEntity(inside.id));
confirmAnswer = true; confirms = []; press(true); key("Delete");
ok("OK deletes exactly the selected sprites", !getSpriteAsset("spr_2") && !getSpriteAsset("spr_4") && !getSpriteAsset("spr_5") && !!getSpriteAsset("spr_3") && !!getSpriteAsset("spr_1"));
ok("selection cleared afterwards", editorState.assetSelection.ids.length === 0);
// button path
tileClick("spr_1"); tileClick("spr_6", { ctrlKey: true }); confirms = []; click("delete-selected-assets");
ok("'Delete N selected' button works too", /Delete 2 sprites/.test(confirms[0]) && !getSpriteAsset("spr_1") && !getSpriteAsset("spr_6") && !!getSpriteAsset("spr_3"));
// Delete with focus OUTSIDE the grid goes to scene objects, never assets
const keepMe = mk("KeepMe"); editorState.selectedIds = [keepMe.id]; editorState.selectedId = keepMe.id; tileClick("spr_3"); press(false); confirms = []; key("Delete");
ok("Delete outside the grid deletes the scene object, not the selected asset", !world.getEntity(keepMe.id) && !!getSpriteAsset("spr_3"));
// blank-area click clears selection; folder switch clears it
tileClick("spr_3"); (listeners["click"] || []).forEach((f) => f({ target: { dataset: {}, tagName: "DIV", closest: (s) => (s === ".proj-grid" ? {} : null) }, preventDefault() {} }));
ok("click on empty grid space clears the selection", editorState.assetSelection.ids.length === 0);
tileClick("spr_3"); click("select-project-folder", { folder: "audio" }); ok("switching folders clears the selection", editorState.assetSelection.ids.length === 0);

// ---------------- scenes ----------------
editorState.projectFolder = "scenes";
const stile = (id) => { const t = { dataset: { assetId: id, action: "select-scene-file", sceneId: id }, tagName: "DIV", closest: (s) => (s === "[data-asset-id]" || s === "[data-action]" ? t : s === ".proj-grid" ? {} : null) }; return t; };
document.querySelectorAll = (sel) => (sel === ".proj-grid .asset-item[data-asset-id]" ? ["s1", "s2", "s3"].map((id) => ({ dataset: { assetId: id } })) : []);
const sclick = (id, mods = {}) => (listeners["click"] || []).forEach((f) => f({ target: stile(id), preventDefault() {}, stopPropagation() {}, ...mods }));
sclick("s1"); sclick("s3", { shiftKey: true }); confirms = []; click("delete-selected-assets");
ok("all scenes selected: refused, nothing asked, nothing deleted", confirms.length === 0 && deletedScenes.length === 0 && sceneList.length === 3, JSON.stringify(deletedScenes));
editorState.assetSelection = { folder: "scenes", ids: ["s1", "s3"], anchorId: "s1" }; confirmAnswer = true; confirms = []; click("delete-selected-assets");
ok("2 of 3 scenes: one question, the open scene is deleted last", /Delete 2 scenes/.test(confirms[0]) && deletedScenes.join() === "s3,s1" && sceneList.map((s) => s.id).join() === "s2", deletedScenes.join());
console.log(fails ? fails + " FAILED" : "ALL CLEAR-SCENE / MULTI-DELETE TESTS PASSED");
