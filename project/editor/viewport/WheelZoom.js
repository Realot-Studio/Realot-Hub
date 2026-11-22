/**
 * editor/viewport/WheelZoom.js
 *
 * Device-independent zoom factor from a WheelEvent.
 *
 * Why: Chromebook, Windows precision touchpads, mice and Mac trackpads all
 * report wheel input differently (pixel vs line deltas, tiny vs huge deltas,
 * 60-120+ events/sec, pinch arriving as ctrl+wheel). Applying a fixed step
 * per event made zoom speed depend on the device. Instead we convert every
 * event to a normalized pixel delta and zoom exponentially in proportion to
 * it, so the same physical gesture distance gives the same zoom everywhere.
 */

const LINE_PX = 16;      // Firefox / some mice report lines
const PAGE_PX = 400;     // page-scroll mice
const MAX_DELTA_PX = 120; // clamp one event so a single huge notch can't jump
const WHEEL_SENSITIVITY = 0.0015; // ln-zoom per px (120px notch ~ 20%)
const PINCH_MULTIPLIER = 3;       // pinch (ctrl+wheel) reports small deltas

/** @param {WheelEvent} e @returns {number} multiplicative zoom factor (>1 = in) */
export function wheelZoomFactor(e, sensitivity = WHEEL_SENSITIVITY) {
  let d = e.deltaY;
  // Some devices send horizontal-dominant deltas; use the larger axis.
  if (Math.abs(e.deltaX) > Math.abs(d)) d = e.deltaX;
  if (e.deltaMode === 1) d *= LINE_PX;
  else if (e.deltaMode === 2) d *= PAGE_PX;
  d = Math.max(-MAX_DELTA_PX, Math.min(MAX_DELTA_PX, d));
  if (e.ctrlKey) d *= PINCH_MULTIPLIER; // pinch gesture
  return Math.exp(-d * sensitivity);
}
