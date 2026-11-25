/**
 * runtime/scripting/SoundInfo.js
 *
 * The beginner-friendly `sound` object handed to onHear(sound) / onHearSound(sound) and
 * onLoseSound(sound) / onLooseSound(sound).
 *
 *   function onHear(sound) {
 *     if (sound.name == "Siren") debug.log("I hear the siren " + sound.distance + " away");
 *   }
 *   function onLoseSound(sound) {
 *     if (sound.is("Siren")) debug.log("The siren faded out");
 *   }
 *
 * `sound` IS the 3D Audio Source's entity (so sound.name, sound.tag, sound.x, sound.y, sound.id and
 * everything else on an entity keep working exactly like before), plus these sound-specific extras:
 *
 *   sound.clip       audio asset the source plays (its Audio Source "audioKey"), or "" if none
 *   sound.volume     the source's base volume, 0 to 1
 *   sound.pitch      the source's pitch
 *   sound.loop       true if the source loops
 *   sound.distance   how far the source is from the listener right now, in world units
 *   sound.destroyed  true if the source entity no longer exists (see below)
 *   sound.is(x)      true if the source's name OR tag equals x (case-insensitive)
 *   sound.entity     the full entity (same object as `sound` for a live source; null once destroyed)
 *   sound.listener   the entity that is listening (this script's own entity)
 *
 * A source that is destroyed while in range has no entity any more. Instead of handing the script
 * `null` (which crashes `sound.name`), onLoseSound receives a frozen snapshot taken when the sound
 * was first heard: name, tag, id, x, y, clip, volume, pitch and loop still work, destroyed is true,
 * and entity is null.
 *
 * RUNTIME-ONLY FILE.
 */

import { AUDIO_SOURCE } from "../components/AudioSource.js";
import { TRANSFORM } from "../components/Transform.js";

/** Members added on top of the entity (kept in one list so editor autocomplete and docs can match it). */
export const SOUND_EXTRA_MEMBERS = ["clip", "volume", "pitch", "loop", "distance", "destroyed", "is", "entity", "listener"];

/** Remember what a source looked like so onLoseSound can still describe it after it is destroyed. */
export function snapshotSound(sourceEntity) {
  const audio = sourceEntity.getComponent(AUDIO_SOURCE);
  const t = sourceEntity.getComponent(TRANSFORM);
  return {
    id: sourceEntity.id,
    name: sourceEntity.name,
    tag: sourceEntity.tag || "",
    x: t ? t.x : 0,
    y: t ? t.y : 0,
    clip: audio && audio.audioKey ? String(audio.audioKey) : "",
    volume: audio ? audio.volume : 0,
    pitch: audio && audio.pitch != null ? audio.pitch : 1,
    loop: audio ? !!audio.loop : false,
  };
}

function matches(name, tag, wanted) {
  if (wanted === null || wanted === undefined) return false;
  const w = String(wanted).trim().toLowerCase();
  if (!w) return false;
  return String(name || "").toLowerCase() === w || String(tag || "").toLowerCase() === w;
}

function distanceBetween(listenerEntity, x, y) {
  const lt = listenerEntity && listenerEntity.getComponent(TRANSFORM);
  if (!lt) return 0;
  return Math.hypot(x - lt.x, y - lt.y);
}

/**
 * @param {object|null} sourceEntity     the live Audio Source entity, or null if it was destroyed
 * @param {object|null} sourceContext    scriptApi.createEntityContext(sourceEntity), or null
 * @param {object|null} listenerEntity   the listening entity
 * @param {object|null} listenerContext  scriptApi.createEntityContext(listenerEntity), or null
 * @param {object|null} remembered       snapshotSound() result from when it was first heard
 */
export function createSoundInfo(sourceEntity, sourceContext, listenerEntity, listenerContext, remembered) {
  // ---- source already destroyed: a frozen snapshot, never null
  if (!sourceEntity || !sourceContext) {
    const snap = remembered || { id: "", name: "", tag: "", x: 0, y: 0, clip: "", volume: 0, pitch: 1, loop: false };
    return Object.freeze({
      id: snap.id, name: snap.name, tag: snap.tag, x: snap.x, y: snap.y,
      clip: snap.clip, volume: snap.volume, pitch: snap.pitch, loop: snap.loop,
      distance: distanceBetween(listenerEntity, snap.x, snap.y),
      destroyed: true,
      entity: null,
      listener: listenerContext || null,
      is: function (wanted) { return matches(snap.name, snap.tag, wanted); },
    });
  }

  // ---- live source: the entity itself, plus the extras
  const extras = {
    get clip() { const a = sourceEntity.getComponent(AUDIO_SOURCE); return a && a.audioKey ? String(a.audioKey) : ""; },
    get volume() { const a = sourceEntity.getComponent(AUDIO_SOURCE); return a ? a.volume : 0; },
    get pitch() { const a = sourceEntity.getComponent(AUDIO_SOURCE); return a && a.pitch != null ? a.pitch : 1; },
    get loop() { const a = sourceEntity.getComponent(AUDIO_SOURCE); return a ? !!a.loop : false; },
    get distance() {
      const t = sourceEntity.getComponent(TRANSFORM);
      return t ? distanceBetween(listenerEntity, t.x, t.y) : 0;
    },
    get destroyed() { return false; },
    get entity() { return sourceContext; },
    get listener() { return listenerContext || null; },
    is: function (wanted) { return matches(sourceEntity.name, sourceEntity.tag, wanted); },
  };
  return new Proxy(sourceContext, {
    get: function (target, prop) {
      if (typeof prop === "string" && Object.prototype.hasOwnProperty.call(extras, prop)) return extras[prop];
      return Reflect.get(target, prop, target);
    },
    set: function (target, prop, value) {
      if (typeof prop === "string" && Object.prototype.hasOwnProperty.call(extras, prop)) {
        throw new Error("sound." + prop + " is read-only.");
      }
      return Reflect.set(target, prop, value, target);
    },
    has: function (target, prop) {
      return (typeof prop === "string" && Object.prototype.hasOwnProperty.call(extras, prop)) || Reflect.has(target, prop);
    },
  });
}
