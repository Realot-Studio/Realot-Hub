/**
 * editor/state/AssetSelection.js
 *
 * Pure helpers for selecting and deleting SEVERAL project assets at once
 * (sprites, audio, scripts, prefabs, scenes) and for the wording of the
 * confirmation questions. No DOM and no editor state, so they can be tested alone.
 * Used by panels/BottomPanel.js (drawing) and state/EditorEvents.js (clicks, Delete key).
 */

/** Which asset kind each Project folder holds. */
export const FOLDER_ASSET_KIND = {
  scenes: "scene",
  sprites: "sprite",
  animations: "sprite", // animation frames and tiles are images in the same registry as sprites
  tiles: "sprite",
  audio: "audio",
  scripts: "script",
  prefabs: "prefab",
};

const KIND_TEXT = {
  sprite: {
    one: "sprite", many: "sprites",
    noteOne: "Any object still using it will show a missing-texture marker.",
    noteMany: "Any object still using one of them will show a missing-texture marker.",
  },
  audio: {
    one: "audio clip", many: "audio clips",
    noteOne: "Any object still using it will simply stop playing it.",
    noteMany: "Any object still using one of them will simply stop playing it.",
  },
  script: {
    one: "script", many: "scripts",
    noteOne: "Any object still using it will lose its script reference.",
    noteMany: "Any object still using one of them will lose its script reference.",
  },
  prefab: {
    one: "prefab", many: "prefabs",
    noteOne: "Objects already placed from it keep their current appearance but are no longer linked to it.",
    noteMany: "Objects already placed from them keep their current appearance but are no longer linked to them.",
  },
  scene: {
    one: "scene", many: "scenes",
    noteOne: "Everything placed in it is deleted with it. Your other assets are not touched.",
    noteMany: "Everything placed in them is deleted with them. Your other assets are not touched.",
  },
};

const LIST_LIMIT = 8;

/**
 * The question shown before deleting assets.
 * @param {"sprite"|"audio"|"script"|"prefab"|"scene"} kind
 * @param {string[]} names display names of everything about to be deleted
 */
export function buildDeleteMessage(kind, names) {
  const k = KIND_TEXT[kind];
  if (!k || names.length === 0) return "";
  if (names.length === 1) {
    return 'Delete ' + k.one + ' "' + names[0] + '"? ' + k.noteOne + " This can't be undone.";
  }
  const shown = names.slice(0, LIST_LIMIT).map((n) => "\u2022 " + n).join("\n");
  const more = names.length > LIST_LIMIT ? "\n\u2026and " + (names.length - LIST_LIMIT) + " more" : "";
  return "Delete " + names.length + " " + k.many + "? " + k.noteMany + " This can't be undone.\n\n" + shown + more;
}

/** The question shown before Edit > Clear Scene. */
export function buildClearSceneMessage(sceneName, objectCount, folderCount) {
  const things = objectCount + " object" + (objectCount === 1 ? "" : "s") +
    (folderCount > 0 ? " and " + folderCount + " folder" + (folderCount === 1 ? "" : "s") : "");
  return 'Clear scene "' + sceneName + '"?\n\n' +
    "This deletes " + things + " placed in this scene. The Camera is kept (a scene needs one).\n\n" +
    "Your sprites, audio, scripts, prefabs and other scenes are NOT deleted.\n" +
    "You can undo this with Ctrl+Z.";
}

/** The question shown before deleting many objects from the Hierarchy at once. */
export function buildDeleteObjectsMessage(count) {
  return "Delete " + count + " objects from this scene?\n\nYou can undo this with Ctrl+Z.";
}

/** The question shown before deleting a Hierarchy folder. */
export function buildDeleteFolderMessage(folderName) {
  return 'Delete folder "' + folderName + '"?\n\nThe objects inside it are NOT deleted: they move up one level.\nYou can undo this with Ctrl+Z.';
}

/**
 * Which scenes may be deleted together. A project always keeps at least one scene,
 * and the open scene goes last (deleting it makes the editor switch to another).
 * @returns {{blocked:boolean, order:string[]}}
 */
export function planSceneDeletion(allSceneIds, selectedIds, activeSceneId) {
  const wanted = selectedIds.filter((id) => allSceneIds.includes(id));
  if (wanted.length >= allSceneIds.length) return { blocked: true, order: [] };
  const order = wanted.filter((id) => id !== activeSceneId).concat(wanted.filter((id) => id === activeSceneId));
  return { blocked: false, order };
}

/* ---------- drawing: mark asset tiles as selectable / selected ---------- */

function unescapeAttr(s) {
  return String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

const TILE_RE = /<div class="(asset-item[^"]*)"([^>]*)>/g;
const ID_ATTRS = [
  ["data-sprite-key", "sprite"],
  ["data-audio-key", "audio"],
  ["data-prefab-id", "prefab"],
  ["data-script", "script"],
  ["data-scene-id", "scene"],
];

/**
 * Adds data-asset-kind / data-asset-id to every asset tile in a grid's HTML (taken from the
 * data attribute the tile already has) and a "multi-selected" class to selected ones.
 * @param {string} html the grid HTML
 * @param {Set<string>|string[]} selectedIds ids (not escaped) of the selected tiles
 */
export function decorateAssetTiles(html, selectedIds) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  return html.replace(TILE_RE, (whole, cls, attrs) => {
    for (const [name, kind] of ID_ATTRS) {
      const m = new RegExp("(?:^|\\s)" + name + '="([^"]*)"').exec(attrs);
      if (!m) continue;
      const id = unescapeAttr(m[1]);
      return '<div class="' + cls + (selected.has(id) ? " multi-selected" : "") + '"' + attrs +
        ' data-asset-kind="' + kind + '" data-asset-id="' + m[1] + '">';
    }
    return whole;
  });
}
