/**
 * editor/panels/Viewport.js
 *
 * The Scene/Game tab bar. The Scene tab holds the viewport toolbar (2D toggle,
 * lighting, zoom label) wrapping the canvas mount point that SceneViewport.js
 * attaches a real PIXI Application to. The Game tab holds the game itself:
 * an empty "slot" that viewport/GameView.js lines the game's iframe up over
 * (the iframe cannot live in this markup, because every render() rebuilds it —
 * see GameView.js).
 */

import { icon } from "../icons/IconLibrary.js";
import { tabBtn } from "./UIComponents.js";
import { editorState } from "../state/EditorState.js";
import { getZoomPercent, isViewportRendererLost, isViewportRenderSyncFailed } from "../viewport/SceneViewport.js";
import { GAME_ASPECT_OPTIONS } from "../viewport/GameView.js";
import { getPlayMode } from "../viewport/PlayWindow.js";
import { CAMERA } from "../../runtime/components/Camera.js";
import { TRANSFORM } from "../../runtime/components/Transform.js";
import { getCameraResolution } from "../../runtime/core/CameraUtils.js";

/**
 * Banner shown over the canvas when the GPU/renderer has silently
 * stopped drawing — see SceneViewport.js's isViewportRendererLost() /
 * isViewportRenderSyncFailed() doc comments for why this can happen
 * (most commonly memory pressure) with the rest of the editor UI,
 * including zoom/pan, looking completely normal. Without a visible
 * banner here, this failure mode is invisible unless the Console tab
 * happens to be open. `_pixi-viewport-canvas` is rebuilt on every full
 * render() (see SceneViewport.js's detachViewportCanvas doc comment),
 * so this banner is markup rendered fresh each time, same as the rest
 * of this file — no separate DOM lifecycle to manage.
 */
function _rendererLostBanner() {
  const lost = isViewportRendererLost();
  const syncFailed = !lost && isViewportRenderSyncFailed();
  if (!lost && !syncFailed) return "";
  const msg = lost
    ? "Renderer lost (often caused by low GPU memory) \u2014 waiting for it to recover. Your scene is safe; try closing other tabs/apps to free up memory."
    : "Rendering hit an error and paused \u2014 check the Console tab for details. Your scene data is unaffected.";
  return '<div class="viewport-renderer-lost-banner">' + icon("alerttriangle", 14) + "<span>" + msg + "</span></div>";
}

/** The Main Camera's export resolution, or null when the scene has no Main Camera. */
function mainCameraResolution() {
  try {
    const world = editorState.world;
    const entity = world && world.query(TRANSFORM, CAMERA).find((e) => e.getComponent(CAMERA).isMain);
    if (!entity) return null;
    const { width, height } = getCameraResolution(entity.getComponent(CAMERA));
    return width > 0 && height > 0 ? { width, height } : null;
  } catch (_) {
    return null;
  }
}

/** The Game tab: a small toolbar and the slot the game's iframe is placed over. */
function renderGameTab() {
  const res = mainCameraResolution();
  const mode = getPlayMode();
  const aspect = editorState.gameAspect || "free";

  const options = GAME_ASPECT_OPTIONS.map(([value, label]) => {
    const text = value === "camera" && res ? label + " (" + res.width + "\u00d7" + res.height + ")" : label;
    return '<option value="' + value + '"' + (value === aspect ? " selected" : "") + ">" + text + "</option>";
  }).join("");

  let status = "";
  if (mode && editorState.isPaused) status = '<span class="game-status paused">Paused</span>';
  else if (mode) status = '<span class="game-status live">Playing</span>';

  let action = "";
  if (mode === "embedded") {
    action = '<button class="game-tool-btn" data-action="game-pop-out" title="Run the game in a separate window (restarts it)">' +
      icon("monitor", 10) + "<span>Open in window</span></button>";
  } else if (mode === "popup") {
    action = '<button class="game-tool-btn" data-action="game-dock" title="Run the game inside the editor again (restarts it)">' +
      icon("monitor", 10) + "<span>Show in editor</span></button>";
  }

  let placeholder = "";
  if (mode === "popup") {
    placeholder = "The game is running in a separate window.";
  } else if (!mode) {
    placeholder = editorState.isPlaying ? "Starting the game\u2026" : "Press Play to run your game here.";
  }

  return (
    '<div class="viewport-toolbar2 game-toolbar">' +
    '<select class="game-aspect-select" data-action="set-game-aspect" title="Aspect ratio of the Game view">' + options + "</select>" +
    '<div class="vsep"></div>' + status +
    '<span class="game-toolbar-spacer"></span>' + action +
    "</div>" +
    '<div class="viewport-canvas game-view" id="game-view-slot"' +
    (res ? ' data-camera-ratio="' + (res.width / res.height) + '"' : "") + ">" +
    (placeholder ? '<div class="game-view-empty">' + placeholder + "</div>" : "") +
    "</div>"
  );
}

export function renderViewport() {
  const showGame = editorState.viewportTab === "game";
  const gameTabExtra = editorState.isPlaying ? '<span class="game-tab-live" title="Game is running"></span>' : "";
  const tabs =
    '<div class="tabbar">' +
    tabBtn(!showGame, "Scene", "grid", "", "viewport-tab-scene") +
    tabBtn(showGame, "Game", "monitor", gameTabExtra, "viewport-tab-game") +
    "</div>";

  if (showGame) return '<div class="col-viewport-wrap">' + tabs + renderGameTab() + "</div>";

  const zoomPercent = getZoomPercent();
  return (
    '<div class="col-viewport-wrap">' +
    tabs +
    '<div class="viewport-toolbar2">' +
    "<button>2D</button><div class=\"vsep\"></div>" +
    "<button>" +
    icon("lightbulb", 10) +
    "</button>" +
    "<button>" +
    icon("info", 10) +
    "</button>" +
    '<div class="vsep"></div>' +
    '<span class="zoom-label" id="zoom-label">' +
    zoomPercent +
    "%</span>" +
    '<span class="pan-hint">' +
    (editorState.activeTool === "pan" ? "Drag to pan \u2022 Scroll to zoom" : "Select the Hand tool to pan \u2022 Scroll to zoom") +
    "</span>" +
    "</div>" +
    '<div class="viewport-canvas" id="pixi-viewport-canvas">' +
    _rendererLostBanner() +
    "</div>" +
    "</div>"
  );
}
