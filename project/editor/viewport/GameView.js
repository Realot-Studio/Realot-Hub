/**
 * editor/viewport/GameView.js
 *
 * The embedded Game view: the "Game" tab next to "Scene" (like Unity). Press
 * Play and the game runs inside the editor instead of in a pop-up window.
 *
 * It is the SAME page the pop-up used (play-popup.html), loaded in an <iframe>.
 * That keeps one code path: the game still runs in its own JS realm with its
 * own PIXI renderer, the scene still arrives by postMessage, and the AI
 * playtest tools keep working. The only difference is who the "window" is.
 *
 * WHY THE IFRAME LIVES OUTSIDE #app
 * main.js rebuilds #app with innerHTML on every render. Moving or re-creating
 * an <iframe> reloads it, which would restart the game on every click. So the
 * iframe sits in a permanent host element on <body>, and after each render
 * syncGameView() lines that host up exactly over the empty
 * #game-view-slot placeholder the Game tab renders. Hidden tab, hidden host:
 * the game keeps running either way.
 *
 * EDITOR-ONLY FILE.
 */

import { editorState } from "../state/EditorState.js";

/** [value, label] pairs for the Game tab's aspect dropdown. */
export const GAME_ASPECT_OPTIONS = [
  ["free", "Free Aspect"],
  ["camera", "Main Camera"],
  ["16:9", "16:9"],
  ["16:10", "16:10"],
  ["4:3", "4:3"],
  ["3:2", "3:2"],
  ["9:16", "9:16 Portrait"],
];

const FIXED_ASPECTS = { "16:9": 16 / 9, "16:10": 16 / 10, "4:3": 4 / 3, "3:2": 3 / 2, "9:16": 9 / 16 };

let host = null;
let frame = null;
let active = false;        // a game is loaded in the frame
let observer = null;       // watches the current slot for size changes
let observedSlot = null;
let rafHandle = 0;
let watchdog = null;       // slow safety net for layout changes nothing else reported

/** Creates the permanent host + iframe the first time they are needed. */
function ensureHost() {
  if (host) return;
  host = document.createElement("div");
  host.id = "realot-game-host";
  // A real size even before the first layout pass: a 0x0 frame would boot the
  // renderer at 0x0. Hidden until syncGameView() has placed it.
  host.style.cssText =
    "position:fixed;left:0;top:0;width:960px;height:540px;z-index:2;background:#000;overflow:hidden;visibility:hidden;";

  frame = document.createElement("iframe");
  frame.id = "realot-game-frame";
  frame.title = "Game";
  frame.setAttribute("allow", "autoplay; fullscreen; gamepad; clipboard-write; accelerometer; gyroscope");
  frame.style.cssText = "display:block;width:100%;height:100%;border:0;background:#000;";
  frame.addEventListener("load", () => { if (active) focusGameFrame(); });
  host.appendChild(frame);
  document.body.appendChild(host);

  // While the mouse button is down in the editor (dragging a panel divider, a
  // gizmo, a slider...) the frame must not catch the pointer, or the drag
  // stops the moment the cursor crosses the game.
  document.addEventListener("pointerdown", () => { host.style.pointerEvents = "none"; }, true);
  const release = () => { host.style.pointerEvents = ""; };
  ["pointerup", "pointercancel", "dragend", "blur"].forEach((type) => window.addEventListener(type, release, true));

  if (typeof ResizeObserver === "function") observer = new ResizeObserver(schedulePlacement);
  window.addEventListener("resize", schedulePlacement);
  document.addEventListener("fullscreenchange", schedulePlacement);
}

function schedulePlacement() {
  if (rafHandle) return;
  rafHandle = requestAnimationFrame(place);
}

function hide() {
  if (host) host.style.visibility = "hidden";
}

/** Aspect ratio (width / height) the user asked for, or 0 for "fill the area". */
function wantedRatio(slot) {
  const choice = editorState.gameAspect || "free";
  if (choice === "camera") return parseFloat(slot.dataset.cameraRatio) || 0;
  return FIXED_ASPECTS[choice] || 0;
}

/** Moves the host over the slot (or hides it when there is no slot to cover). */
function place() {
  rafHandle = 0;
  if (!host) return;

  const slot = document.getElementById("game-view-slot");
  if (slot !== observedSlot) {
    if (observer) { observer.disconnect(); if (slot) observer.observe(slot); }
    observedSlot = slot;
  }

  if (!active || !slot) { hide(); return; }
  const r = slot.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) { hide(); return; } // mid-layout; keep the last geometry

  let { left, top, width, height } = r;
  const ratio = wantedRatio(slot);
  if (ratio > 0) {
    if (width / height > ratio) { const w = height * ratio; left += (width - w) / 2; width = w; }
    else { const h = width / ratio; top += (height - h) / 2; height = h; }
  }
  const s = host.style;
  s.left = Math.round(left) + "px";
  s.top = Math.round(top) + "px";
  s.width = Math.max(1, Math.round(width)) + "px";
  s.height = Math.max(1, Math.round(height)) + "px";
  s.visibility = "visible";
}

/**
 * Call after every editor render(): the Game tab's slot element was just
 * rebuilt, so line the host up with it again (and once more next frame, when
 * layout has fully settled).
 */
export function syncGameView() {
  if (!host) return;
  place();
  schedulePlacement();
}

/** Starts (or restarts) a game inside the Game view. */
export function loadGameFrame(url) {
  ensureHost();
  active = true;
  frame.src = url;
  place();
  if (!watchdog) watchdog = setInterval(schedulePlacement, 400);
}

/** Stops the embedded game and frees it. Safe to call when nothing is loaded. */
export function unloadGameFrame() {
  active = false;
  if (watchdog) { clearInterval(watchdog); watchdog = null; }
  if (frame) frame.src = "about:blank"; // tears down the game's renderer, audio and timers
  hide();
}

export function isGameFrameActive() {
  return active;
}

/** The embedded game's window, or null when nothing is running in it. */
export function getGameFrameWindow() {
  return active && frame ? frame.contentWindow : null;
}

/** Gives the game keyboard focus (so Space/arrows reach the game, not the editor). */
export function focusGameFrame() {
  if (!active || !frame) return;
  try { frame.focus(); } catch (_) { /* ignore */ }
  try { if (frame.contentWindow) frame.contentWindow.focus(); } catch (_) { /* ignore */ }
}
