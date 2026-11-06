/**
 * editor/viewport/PlayRemote.js
 *
 * Editor-side half of the AI playtest channel. McpPlayTools.js calls
 * sendPlayCommand() to ask the Play popup (play-probe.js) to do something and
 * gets the answer back as a Promise; main.js routes the popup's replies here
 * through handlePlayRemoteMessage(). Also remembers when the popup last
 * finished booting so a tool can wait for a fresh game after a restart.
 *
 * Everything the popup sends is untrusted (game scripts produce it), so
 * results are size-checked and never executed.
 */
import { postToPlayWindow, isPlayWindowOpen } from "./PlayWindow.js";

const pending = new Map();        // id -> { resolve, reject, timer }
let nextId = 1;
let bootedAt = 0;
const bootWaiters = new Set();
const MAX_RESULT_CHARS = 600_000; // base64 images dominate; the relay caps editor messages at 2 MB

/** Called by main.js for every trusted message from the play popup. Returns true if it handled it. */
export function handlePlayRemoteMessage(data) {
  if (!data || typeof data !== "object") return false;
  if (data.type === "realot_play_booted") {
    bootedAt = Date.now();
    for (const fn of Array.from(bootWaiters)) fn();
    return true;
  }
  if (data.type === "realot_play_cmd_result") {
    const entry = pending.get(data.id);
    if (!entry) return true;
    pending.delete(data.id);
    clearTimeout(entry.timer);
    if (data.ok) entry.resolve({ result: data.result, images: Array.isArray(data.images) ? data.images : [] });
    else entry.reject(new Error(String(data.error || "The game reported an error.")));
    return true;
  }
  return false;
}

/** Resolves once the popup reports a boot that happened after `sinceMs` (Date.now() value). */
export function waitForPlayBoot(sinceMs, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (bootedAt > sinceMs) { resolve(); return; }
    const done = () => { if (bootedAt > sinceMs) { cleanup(); resolve(); } };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(isPlayWindowOpen()
        ? "The game started but did not finish loading within " + Math.round(timeoutMs / 1000) + " s. Check get_console for errors."
        : "The game did not start. Ask the user to press Play once in the editor, then try again."));
    }, timeoutMs);
    function cleanup() { clearTimeout(timer); bootWaiters.delete(done); }
    bootWaiters.add(done);
  });
}

/**
 * Asks the running game to perform a command.
 * @param {string} op     see play-probe.js (state, entity, step, input, screenshot, eval, ...)
 * @param {object} [args]
 * @param {number} [timeoutMs]
 * @returns {Promise<{result:any, images:Array<{data:string,mimeType:string,label?:string}>}>}
 */
export function sendPlayCommand(op, args = {}, timeoutMs = 22000) {
  return new Promise((resolve, reject) => {
    if (!isPlayWindowOpen()) {
      reject(new Error("The game is not running. Call play_restart first (it starts the game and waits until it is ready)."));
      return;
    }
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("The game did not answer within " + Math.round(timeoutMs / 1000) + " s. It may be frozen in an infinite loop, or still loading. Check get_console."));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => {
        const size = JSON.stringify(v.result || {}).length + v.images.reduce((n, im) => n + String(im.data || "").length, 0);
        if (size > MAX_RESULT_CHARS) reject(new Error("The result was too large to send back. Ask for fewer screenshots or a smaller max_width."));
        else resolve(v);
      },
      reject,
      timer,
    });
    if (!postToPlayWindow({ type: "realot_play_cmd", id, op, args })) {
      pending.delete(id);
      clearTimeout(timer);
      reject(new Error("Could not reach the game window."));
    }
  });
}
