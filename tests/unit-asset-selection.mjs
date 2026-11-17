import assert from "node:assert/strict";
const A = await import("../project/editor/state/AssetSelection.js");

// ---- confirmation wording
assert.match(A.buildDeleteMessage("sprite", ["hero"]), /^Delete sprite "hero"\? .*missing-texture.* This can't be undone\.$/);
const many = A.buildDeleteMessage("sprite", Array.from({ length: 12 }, (_, i) => "s" + i));
assert.match(many, /^Delete 12 sprites\?/); assert.match(many, /• s0\n/); assert.match(many, /…and 4 more$/);
assert.ok(!many.includes("s8"), "only the first 8 names are listed");
assert.match(A.buildDeleteMessage("scene", ["A", "B"]), /Delete 2 scenes\?.*Everything placed in them/s);
assert.match(A.buildDeleteMessage("audio", ["a"]), /audio clip "a"/);
assert.match(A.buildDeleteMessage("script", ["x", "y"]), /Delete 2 scripts\?/);
assert.match(A.buildDeleteMessage("prefab", ["p"]), /prefab "p"/);
assert.equal(A.buildDeleteMessage("sprite", []), "");
const clear = A.buildClearSceneMessage("Level 1", 42, 3);
assert.match(clear, /Clear scene "Level 1"\?/); assert.match(clear, /42 objects and 3 folders/); assert.match(clear, /NOT deleted/); assert.match(clear, /Ctrl\+Z/); assert.match(clear, /Camera is kept/);
assert.match(A.buildClearSceneMessage("S", 1, 0), /1 object placed/);
assert.match(A.buildDeleteFolderMessage("Enemies"), /Enemies.*NOT deleted/s);
assert.match(A.buildDeleteObjectsMessage(30), /Delete 30 objects/);

// ---- which folder holds which kind
assert.equal(A.FOLDER_ASSET_KIND.sprites, "sprite"); assert.equal(A.FOLDER_ASSET_KIND.animations, "sprite"); assert.equal(A.FOLDER_ASSET_KIND.tiles, "sprite");
assert.equal(A.FOLDER_ASSET_KIND.scenes, "scene");

// ---- scene deletion plan: never all scenes, open scene last
assert.deepEqual(A.planSceneDeletion(["s1", "s2", "s3"], ["s1", "s2", "s3"], "s1"), { blocked: true, order: [] });
assert.deepEqual(A.planSceneDeletion(["s1", "s2", "s3"], ["s1", "s3"], "s1"), { blocked: false, order: ["s3", "s1"] });
assert.deepEqual(A.planSceneDeletion(["s1", "s2"], ["s2", "ghost"], "s1"), { blocked: false, order: ["s2"] });
assert.equal(A.planSceneDeletion(["s1"], ["s1"], "s1").blocked, true);

// ---- tiles get ids/kinds and the selected look; ids with special characters round-trip
const grid =
  '<div class="asset-item" draggable="true" data-action="drag-sprite-asset" data-sprite-key="sprite_1_a&amp;b" title="x"><div class="asset-thumb"><button class="asset-delete-btn" data-action="delete-sprite-asset" data-sprite-key="sprite_1_a&amp;b"></button></div></div>' +
  '<div class="asset-item scene-file-item active" data-action="select-scene-file" data-scene-id="scene2">x</div>' +
  '<div class="asset-item" data-action="open-script-from-folder" data-script="Player">x</div>' +
  '<div class="asset-item" data-action="drag-audio-asset" data-audio-key="aud_1">x</div>' +
  '<div class="asset-item" data-action="drag-prefab-asset" data-prefab-id="pf1">x</div>' +
  '<div class="asset-empty-hint">nothing</div>';
const out = A.decorateAssetTiles(grid, new Set(["sprite_1_a&b", "Player"]));
assert.match(out, /class="asset-item multi-selected" draggable="true" data-action="drag-sprite-asset" data-sprite-key="sprite_1_a&amp;b" title="x" data-asset-kind="sprite" data-asset-id="sprite_1_a&amp;b"/);
assert.match(out, /class="asset-item scene-file-item active" data-action="select-scene-file" data-scene-id="scene2" data-asset-kind="scene" data-asset-id="scene2"/);
assert.match(out, /class="asset-item multi-selected" data-action="open-script-from-folder" data-script="Player" data-asset-kind="script"/);
assert.match(out, /data-asset-kind="audio" data-asset-id="aud_1"/); assert.match(out, /data-asset-kind="prefab" data-asset-id="pf1"/);
assert.equal((out.match(/multi-selected/g) || []).length, 2, "only the two selected tiles are highlighted");
assert.ok(out.includes('<div class="asset-empty-hint">nothing</div>'), "non-tile markup untouched");
assert.ok(!/<button[^>]*data-asset-id/.test(out), "delete buttons are not treated as tiles");
assert.equal(A.decorateAssetTiles(grid, []).includes("multi-selected"), false);
console.log("Asset selection helper tests passed.");
