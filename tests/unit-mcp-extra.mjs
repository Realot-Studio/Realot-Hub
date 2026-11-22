// Unit tests for the AI bridge's offline knowledge + relay protocol additions.
//   node tests/unit-mcp-extra.mjs
import assert from "node:assert/strict";
const D = await import("../project/editor/mcp/McpDocs.js");
const core = await import("../relay/mcp-core.js");
const TOOLS = (await import("../relay/tools.json", { with: { type: "json" } })).default;

// ---- docs
assert.ok(D.listResources().length > 30, "resources are listed");
assert.equal(D.searchDocs("raycast")[0].uri, "realot://api/script/physics");
assert.match(D.readResource("realot://components/Collider2D").text, /shape/);
assert.match(D.getScriptApi("mouse"), /screenX/);
assert.throws(() => D.getScriptApi("physiks"), /Did you mean 'physics'/);
assert.throws(() => D.readResource("realot://nope/x"), /Unknown resource/);
assert.equal(D.suggest("Colider2D", ["Collider2D", "Rigidbody2D"]), " Did you mean 'Collider2D'?");

// ---- tools.json hygiene
const names = TOOLS.map((t) => t.name);
assert.equal(names.length, new Set(names).size, "no duplicate tool names");
for (const t of TOOLS) {
  assert.equal(t.inputSchema.type, "object", t.name);
  assert.equal(typeof t.annotations.readOnlyHint, "boolean", t.name + " has annotations");
}
for (const n of ["batch", "snapshot_project", "restore_snapshot", "search_docs", "validate_script", "editor_eval", "find_entities", "focus_entity"]) assert.ok(names.includes(n), n);
assert.equal(TOOLS.find((t) => t.name === "get_hierarchy").annotations.readOnlyHint, true);
assert.equal(TOOLS.find((t) => t.name === "editor_eval").annotations.destructiveHint, true);

// ---- relay protocol
const env = { callEditor: async (tool, args) => tool === "__resources_read"
  ? { content: [{ type: "text", text: JSON.stringify({ uri: args.uri, mimeType: "text/plain", text: "x" }) }] }
  : { content: [{ type: "text", text: "[]" }] } };
const rpc = (method, params) => core.handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, env);
const init = await rpc("initialize", { protocolVersion: "2025-06-18" });
assert.ok(init.result.capabilities.resources && init.result.capabilities.prompts);
assert.equal((await rpc("prompts/get", { name: "build_game", arguments: { idea: "pong" } })).result.messages[0].content.text.includes("pong"), true);
assert.equal((await rpc("prompts/get", { name: "build_game", arguments: {} })).error.code, -32602);
assert.equal((await rpc("resources/read", { uri: "http://evil" })).error.code, -32602);
assert.equal((await rpc("resources/read", { uri: "realot://guide/overview" })).result.contents[0].text, "x");

// ---- change diffs
const { captureDigest, diffDigests, formatDiff } = await import("../project/editor/mcp/McpDiff.js");
const ent = (id, name, comps) => ({ id, name, tag: "", active: true, folderId: null, components: new Map(Object.entries(comps)) });
const mk = (list) => ({ getAllEntities: () => list });
const scenes = { activeId: "scene1", names: ["Main"] };
const d1 = captureDigest(mk([ent("e1", "Player", { Transform: { x: 0, y: 0 } }), ent("e2", "Coin", {})]), { Move: "a" }, scenes);
const d2 = captureDigest(mk([ent("e1", "Hero", { Transform: { x: 40, y: 0 }, Collider2D: { shape: "Box" } }), ent("e3", "Wall", {})]), { Move: "b", New: "c" }, scenes);
const diff = diffDigests(d1, d2);
assert.deepEqual(diff.entitiesAdded, ['e3 "Wall"']);
assert.deepEqual(diff.entitiesRemoved, ['e2 "Coin"']);
assert.ok(diff.entitiesModified[0].changes.includes("Transform.x: 0 -> 40"));
assert.ok(diff.entitiesModified[0].changes.includes("+Collider2D"));
assert.ok(diff.entitiesModified[0].changes.some((c) => c.startsWith("name:")));
assert.deepEqual(diff.scriptsAdded, ["New"]); assert.deepEqual(diff.scriptsChanged, ["Move"]);
assert.equal(diffDigests(d1, d1), null);
assert.match(formatDiff(null), /none/);
assert.equal(captureDigest(mk(Array.from({ length: 1501 }, (_, i) => ent("x" + i, "n", {}))), {}, scenes), null, "huge scenes skip digesting");
assert.ok(TOOLS.some((t) => t.name === "play_record"));
console.log("unit-mcp-extra: ok");
