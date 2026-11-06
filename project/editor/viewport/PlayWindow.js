/**
 * editor/viewport/PlayWindow.js
 *
 * "Play" starts a real, independent runtime instance of the game. By default
 * it runs inside the editor's Game tab (an iframe, see GameView.js); the
 * Game tab's "Open in window" button runs it in a separate browser popup
 * instead. Both load the same page (editor/viewport/play-popup.html +
 * play-popup.js) and speak the same postMessage protocol, so everything
 * below works for either; only "which window is the game in" differs.
 * The popup is sized to the Main Camera's exact export resolution via
 * runtime/core/CameraUtils.js — the SAME function the editor's
 * CameraGizmo.js uses to draw the camera frame, so the gizmo's edges in
 * the Scene view are exactly what play mode (and a real export) shows.
 *
 * The play page boots its own PIXI Application + World + createGame() from
 * runtime/index.js and loads the CURRENT in-editor scene (read straight
 * off the live game instance via getSceneData(), which is backed by
 * runtime/scene/SceneSerializer.js — no duplicate serialization logic
 * here, per RULES.txt section 6). No editor grid, no gizmos — exactly
 * the game, as it will play/export.
 */

import { CAMERA } from "../../runtime/components/Camera.js";
import { TRANSFORM } from "../../runtime/components/Transform.js";
import { getCameraResolution } from "../../runtime/core/CameraUtils.js";
import { getAllSpriteAssets, getAllFrameAssets, getAllAudioAssets } from "../../runtime/assets/AssetRegistry.js";
import { syncScriptSourcesInSceneData, syncScriptSourcesInScenes } from "../scripting/ScriptSync.js";
import { editorState, pushLog } from "../state/EditorState.js";
import { getAllScenesData } from "../../runtime/scene/SceneManager.js";
import { getAllPrefabs } from "../../runtime/prefabs/PrefabRegistry.js";
import { notifyPlayWindowChanged } from "../state/FocusScheduler.js";
import { getEngineSettings } from "../state/EngineSettings.js";
import { getNavAreaNames } from "../state/NavAreas.js";
import { loadGameFrame, unloadGameFrame, getGameFrameWindow } from "./GameView.js";

/** "embedded" = inside the Game tab, "popup" = separate window, null = not running. */
let playMode = null;
let playWin = null;        // the popup window (popup mode only)
let runCounter = 0;        // makes every start a fresh navigation, even to the same URL
let pendingPayload = null;
let playOrigin = window.location.origin;

/**
 * Which origin the play window should run on.
 *
 * Game scripts are ordinary page code, so the safest place to run them is an
 * origin that holds none of the editor's data. Deploy the SAME static folder
 * on a second hostname and put it in <meta name="realot-play-origin"> in
 * editor/index.html. Empty (the default) = same-origin play, as before.
 * Offline there is no way to reach another host, so fall back to same-origin.
 */
function resolvePlayOrigin() {
  const meta = document.querySelector('meta[name="realot-play-origin"]');
  const raw = meta && meta.content ? meta.content.trim() : "";
  if (!raw) return window.location.origin;
  let url;
  try { url = new URL(raw); } catch (_) {
    pushLog("warn", "Ignoring invalid play origin '" + raw + "' (using same-origin play).");
    return window.location.origin;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    pushLog("warn", "Ignoring play origin '" + raw + "': must be http(s). Using same-origin play.");
    return window.location.origin;
  }
  if (navigator.onLine === false) {
    pushLog("warn", "Offline: using same-origin play instead of " + url.origin + ".");
    return window.location.origin;
  }
  return url.origin;
}

function buildPlayUrl() {
  const local = new URL("./viewport/play-popup.html", window.location.href);
  const target = playOrigin === window.location.origin ? local : new URL(local.pathname, playOrigin);
  // Tells the popup which origin it may talk to (and accept payloads from).
  target.searchParams.set("editor", window.location.origin);
  // A different URL every run, so starting again is always a fresh load.
  target.searchParams.set("run", String(++runCounter));
  return target.toString();
}

/**
 * The window the game currently runs in (the Game tab's iframe or the popup),
 * or null when nothing is running. Every function below goes through this, so
 * none of them needs to care which mode is active.
 * @returns {Window|null}
 */
function currentTarget() {
  if (playMode === "embedded") return getGameFrameWindow();
  if (playMode === "popup" && playWin && !playWin.closed) return playWin;
  return null;
}

/** "embedded", "popup", or null when the game is not running. */
export function getPlayMode() {
  return currentTarget() ? playMode : null;
}

/**
 * True only for a message that came from THIS play window, on the origin we
 * opened it on. Everything the game sends is untrusted data (it is produced
 * by game scripts); this just stops other windows from injecting messages.
 * @param {MessageEvent} e
 */
export function isTrustedPlayMessage(e) {
  const target = currentTarget();
  return !!(target && e.source === target && e.origin === playOrigin);
}

/** Answers the game's "ready" message with the scene payload. */
export function sendPlayPayload() {
  const target = currentTarget();
  if (!target || !pendingPayload) return;
  try {
    target.postMessage({ type: "realot_play_payload", payload: pendingPayload }, playOrigin);
  } catch (err) {
    pushLog("error", "Could not send the scene to the game: " + (err && err.message ? err.message : err));
  }
}

export function isPlayWindowOpen() {
  return !!currentTarget();
}

/**
 * The window the game runs in, for FocusScheduler.js's focus polling.
 * A function (not an exported variable) so callers always see the current one.
 * @returns {Window|null}
 */
export function getPlayWindow() {
  return currentTarget();
}

/**
 * Pauses/resumes the running game loop. Safe to call whether or not a game is
 * running. Sent as a message because the game may live on a different origin
 * (see resolvePlayOrigin); one that hasn't finished booting applies the last
 * pause state once it has.
 * @param {boolean} paused
 */
export function setPlayWindowPaused(paused) {
  const target = currentTarget();
  if (!target) return;
  try { target.postMessage({ type: "realot_play_pause", paused: !!paused }, playOrigin); } catch (_) { /* mid-navigation */ }
}

/**
 * Sends one message to the running game on the origin it runs on. Used by
 * PlayRemote.js for the AI playtest commands. Returns false if no game is
 * running or the browser refused the message.
 * @param {object} message
 * @returns {boolean}
 */
export function postToPlayWindow(message) {
  const target = currentTarget();
  if (!target) return false;
  try { target.postMessage(message, playOrigin); return true; } catch (_) { return false; }
}

/** Stops whatever is running (either mode) and frees it. Safe to call anytime. */
export function closePlayWindow() {
  teardown();
  restoreViewportTab();
  notifyPlayWindowChanged();
}

/** Closes the popup / unloads the Game tab's frame. Leaves the viewport tab alone. */
function teardown() {
  if (playWin && !playWin.closed) playWin.close();
  playWin = null;
  unloadGameFrame();
  playMode = null;
}

/** Play switches to the Game tab; Stop puts the user back where they were. */
function restoreViewportTab() {
  const before = editorState.viewportTabBeforePlay;
  editorState.viewportTabBeforePlay = null;
  if (before && editorState.viewportTab === "game") editorState.viewportTab = before;
}

/**
 * Starts the game (or restarts it if it is already running) with the current
 * scene data, in an independent runtime instance.
 *
 * @param {ReturnType<import('../../runtime/index.js').createGame>} game
 *   the editor's live game instance (used only to read scene data via
 *   its public getSceneData() — never mutated).
 * @param {{mode?: "embedded"|"popup"}} [options]
 *   "embedded" (default) runs in the Game tab; "popup" opens a separate window
 *   sized to the Main Camera's resolution.
 */
export function openPlayWindow(game, options) {
  const mode = options && options.mode === "popup" ? "popup" : "embedded";
  const world = editorState.world;
  if (!world || !game) return;

  const mainCameraEntity = world.query(TRANSFORM, CAMERA).find((e) => e.getComponent(CAMERA).isMain);
  if (!mainCameraEntity) {
    pushLog("error", "Cannot enter Play mode: scene has no Main Camera.");
    return;
  }
  const camera = mainCameraEntity.getComponent(CAMERA);
  const { width, height } = getCameraResolution(camera);
  // Save the active scene first so its data slot in SceneManager is
  // current, then capture ALL scenes (with data) — the play popup needs
  // the full list so scene.load('Name') can find scenes by name.
  game.saveActiveScene();
  const sceneData = game.getSceneData();
  const allScenes = getAllScenesData(); // [{id,name,data}] — full payloads
  // Play must run exactly the code the script editor shows. Scripts live in
  // ScriptStorage; every scene carries a COPY that can be stale (edited while
  // another scene was active, imported from an older save...). Re-stamp them.
  syncScriptSourcesInSceneData(sceneData);
  syncScriptSourcesInScenes(allScenes);

  // The popup boots a completely separate JS module realm (its own
  // <script type="module"> import graph), so AssetManager.js's texture
  // cache there starts EMPTY — it never sees the textures the editor
  // registered. sceneData only carries spriteKey strings, not pixels,
  // so without this the popup falls back to the pink "missing texture"
  // marker for every imported sprite. Bundling the imported assets'
  // dataUrls here lets the popup rebuild real textures from the same
  // source bytes before it loads the scene.
  const spriteAssets = [...getAllSpriteAssets(), ...getAllFrameAssets()];

  // Same reasoning as spriteAssets above: the popup's AssetManager.js
  // module realm starts with an empty audio cache, so any imported
  // audio clip must be handed over as raw dataUrls here too, or every
  // AudioSource in the popup would silently resolve to nothing and
  // never play.
  const audioAssets = getAllAudioAssets();

  // The payload is handed over by postMessage when the popup says it is
  // ready (see sendPlayPayload) — NOT through a window global — so it works
  // across origins. gameFps travels the same way — see EngineSettings.js;
  // play-popup.js applies it to GameLoop's targetFps so the game's own frame
  // rate is never coupled to whatever the editor happens to be doing.
  // navAreaNames is the Edit → Nav Areas… name registry (see
  // editor/state/NavAreas.js) — passed through so nav.areaIndex()/
  // nav.areaMask() resolve the same names in Play mode that the editor shows.
  pendingPayload = { sceneData, allScenes, width, height, spriteAssets, audioAssets, gameFps: getEngineSettings().gameFps, navAreaNames: getNavAreaNames(), prefabs: getAllPrefabs() };
  playOrigin = resolvePlayOrigin();

  // Switching between the Game tab and a popup: stop the other one first, so
  // there is never more than one copy of the game running.
  if (playMode && playMode !== mode) teardown();

  if (mode === "embedded") {
    openEmbedded(camera, width, height);
  } else {
    openPopup(camera, width, height);
  }
}

/** Runs the game in the Game tab. Starting again simply reloads the frame. */
function openEmbedded(camera, width, height) {
  // Show the Game tab (and remember where to go back to when Play stops).
  if (editorState.viewportTab !== "game") {
    if (editorState.viewportTabBeforePlay == null) editorState.viewportTabBeforePlay = editorState.viewportTab;
    editorState.viewportTab = "game";
  }
  playMode = "embedded";
  loadGameFrame(buildPlayUrl());   // keyboard focus goes to the frame once it loads
  notifyPlayWindowChanged();
  pushLog("log", "Entered Play mode (" + camera.aspectMode + ", " + width + "x" + height + ").");
}

/** Runs the game in a separate browser window sized to the camera. */
function openPopup(camera, width, height) {
  // Coming out of the Game tab: put the viewport back where it was.
  restoreViewportTab();

  if (isPlayWindowOpen() && playMode === "popup") {
    // Assigning location works across origins; location.reload() does not.
    playWin.location.href = buildPlayUrl();
    playWin.focus();
    // A single synchronous focus() call is unreliable on ChromeOS, so
    // re-assert focus a beat later too.
    setTimeout(() => { if (playWin && !playWin.closed) playWin.focus(); }, 150);
    notifyPlayWindowChanged();
    return;
  }

  const availW = Math.max(320, (window.screen.availWidth || 1280) - 80);
  const availH = Math.max(320, (window.screen.availHeight || 800) - 120);
  const fitScale = Math.min(1, availW / width, availH / height);
  const winW = Math.round(width * fitScale);
  const winH = Math.round(height * fitScale);

  const features =
    "width=" + winW + ",height=" + winH + ",resizable=yes,scrollbars=no,status=no,toolbar=no,menubar=no,location=no";

  playWin = window.open(buildPlayUrl(), "realot_play", features);
  if (!playWin) {
    playMode = null;
    pushLog("error", "The game window was blocked by the browser's popup blocker. Allow popups for this site, or use the Game tab instead.");
    notifyPlayWindowChanged();
    return;
  }
  playMode = "popup";
  notifyPlayWindowChanged();
  // window.open() does NOT reliably hand keyboard focus to the new window on
  // every platform (ChromeOS in particular). The game's key listeners live on
  // the popup's own window, so an unfocused popup means scripts see no input.
  // A single call can still lose the race with the OS painting the window, so
  // re-assert focus a few times over the next second.
  playWin.focus();
  [150, 400, 800].forEach((delay) => {
    setTimeout(() => { if (playWin && !playWin.closed) playWin.focus(); }, delay);
  });

  pushLog("log", "Entered Play mode in a separate window (" + camera.aspectMode + ", " + width + "x" + height + ").");
}
