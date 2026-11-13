import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
  #items = new Map();
  getItem(key) { return this.#items.has(key) ? this.#items.get(key) : null; }
  setItem(key, value) { this.#items.set(key, String(value)); }
}
globalThis.localStorage = new MemoryStorage();

// With NO Worker address: direct service + self-service keys, and no key anywhere in the config.
const fallback = await import("../project/editor/state/ApkBuildConfig.js?no-worker");
assert.equal(fallback.APK_SERVICE_URL, "https://apk--build-server.replit.app");
assert.equal(fallback.APK_API_KEY, "");

// With a Worker address (set by js/data/hub-config.js before the editor loads): the Worker is the service.
const WORKER = "https://realot-feedback.example.workers.dev";
globalThis.window = { RealotHubConfig: { feedbackApiUrl: WORKER + "/" } };
const { APK_SERVICE_URL, APK_API_KEY } = await import("../project/editor/state/ApkBuildConfig.js?with-worker");
assert.equal(APK_SERVICE_URL, WORKER, "build requests go to the Worker (trailing slash trimmed)");
assert.doesNotMatch(APK_API_KEY, /_live_|_test_/, "no real key in the editor config");
const configSource = await readFile(new URL("../project/editor/state/ApkBuildConfig.js", import.meta.url), "utf8");
assert.doesNotMatch(configSource, /_live_|[A-Za-z0-9]{32,}/, "no key-like string in ApkBuildConfig.js");
const { ensureAndroidServerKey, getActiveAndroidServer, androidExportHeaders, androidExportEndpoint } =
  await import("../project/editor/state/ServerConfig.js");

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
