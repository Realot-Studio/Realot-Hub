import assert from "node:assert/strict";
const { applyHierarchyClick } = await import("../project/editor/state/SelectionLogic.js");
const rows = ["a", "b", "c", "d", "e", "f"];
const empty = { selectedId: null, selectedIds: [], anchorId: null };
const click = (cur, id, keys = {}, visible = rows) => applyHierarchyClick(cur, id, keys, visible);

// plain click
let s = click(empty, "c");
assert.deepEqual(s, { selectedId: "c", selectedIds: ["c"], anchorId: "c" });
// Ctrl+click adds, Ctrl+click again removes
s = click(s, "e", { additive: true });
assert.deepEqual(s.selectedIds, ["c", "e"]); assert.equal(s.selectedId, "e"); assert.equal(s.anchorId, "e");
s = click(s, "a", { additive: true });
assert.deepEqual(s.selectedIds, ["c", "e", "a"]);
s = click(s, "e", { additive: true });
assert.deepEqual(s.selectedIds, ["c", "a"], "removed e"); assert.equal(s.selectedId, "a", "primary falls back to the last remaining");
s = click(s, "a", { additive: true }); s = click(s, "c", { additive: true });
assert.deepEqual(s.selectedIds, []); assert.equal(s.selectedId, null, "removing the last one leaves nothing selected");

// Shift+click range from the anchor, both directions
s = click(empty, "b");
s = click(s, "e", { shift: true });
assert.deepEqual(s.selectedIds, ["b", "c", "d", "e"]); assert.equal(s.selectedId, "e"); assert.equal(s.anchorId, "b");
s = click(s, "a", { shift: true });
assert.deepEqual(s.selectedIds, ["a", "b"], "range re-computed from the same anchor (replaces the old range)"); assert.equal(s.anchorId, "b");
s = click(s, "d", { shift: true });
assert.deepEqual(s.selectedIds, ["b", "c", "d"]);

// Shift+click with no anchor uses the current primary
s = click({ selectedId: "c", selectedIds: ["c"], anchorId: null }, "e", { shift: true });
assert.deepEqual(s.selectedIds, ["c", "d", "e"]);
// ...and with nothing selected it just selects the row
s = click(empty, "d", { shift: true });
assert.deepEqual(s.selectedIds, ["d"]);

// Ctrl+Shift: add the range to what is already selected
s = click(empty, "a"); s = click(s, "f", { additive: true });
s = applyHierarchyClick({ ...s, anchorId: "b" }, "d", { shift: true, additive: true }, rows);
assert.deepEqual(s.selectedIds.sort(), ["a", "b", "c", "d", "f"]);

// Rows hidden (collapsed folder / filter): the range only covers visible rows
const visible = ["a", "d", "f"];
s = click(click(empty, "a", {}, visible), "f", { shift: true }, visible);
assert.deepEqual(s.selectedIds, ["a", "d", "f"], "b, c, e are not visible so they are not selected");
// Anchor no longer visible: falls back to the primary, never crashes
s = click({ selectedId: "d", selectedIds: ["d"], anchorId: "gone" }, "f", { shift: true }, visible);
assert.deepEqual(s.selectedIds, ["d", "f"]);
// Clicked row not in the visible list: safe single select
s = click(empty, "zzz", { shift: true });
assert.deepEqual(s, { selectedId: "zzz", selectedIds: ["zzz"], anchorId: "zzz" });
// the input is never mutated
const input = { selectedId: "a", selectedIds: ["a"], anchorId: "a" }; const copy = JSON.stringify(input);
click(input, "c", { additive: true }); click(input, "c", { shift: true });
assert.equal(JSON.stringify(input), copy, "input state is not mutated");
console.log("Hierarchy selection tests passed.");
