import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
  #items = new Map();
  getItem(key) { return this.#items.has(key) ? this.#items.get(key) : null; }
  setItem(key, value) { this.#items.set(key, String(value)); }
}
globalThis.localStorage = new MemoryStorage();

const { APK_SERVICE_URL, APK_API_KEY } = await import("../project/editor/state/ApkBuildConfig.js");
const { ensureAndroidServerKey, getActiveAndroidServer, androidExportHeaders, androidExportEndpoint } =
  await import("../project/editor/state/ServerConfig.js");

assert.equal(APK_SERVICE_URL, "https://apk--build-server.replit.app");
assert.ok(APK_API_KEY.length > 0);

globalThis.fetch = async () => { throw new Error("no key-issuing request expected when APK_API_KEY is set"); };

const server = getActiveAndroidServer();
assert.equal(server.serverUrl, APK_SERVICE_URL);
assert.equal(server.apiKey, APK_API_KEY);
assert.equal(server.managedKey, false);
assert.doesNotMatch(server.label, /vaelis|replit|server/i, "UI label must not expose the server name");

assert.equal((await ensureAndroidServerKey(server)).apiKey, APK_API_KEY);
assert.equal(androidExportHeaders(server)["X-Api-Key"], APK_API_KEY);
assert.equal(androidExportEndpoint("My Game", server), APK_SERVICE_URL + "/api/v1/build?name=My%20Game");

// A stale saved key must never override the configured one.
localStorage.setItem("realot.androidBuildServers", JSON.stringify({
  servers: [{ id: "apk-builder", serverUrl: APK_SERVICE_URL, apiKey: "stale", managedKey: true }],
  activeId: "apk-builder",
}));
assert.equal(getActiveAndroidServer().apiKey, APK_API_KEY);

const exportWindow = await readFile(new URL("../project/editor/panels/ExportWindow.js", import.meta.url), "utf8");
assert.doesNotMatch(exportWindow, /vaelis|replit/i);

console.log("Android server config tests passed.");
