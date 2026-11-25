// Run from the folder containing index.html: node tests/unit-hear-sound.mjs
// Tests onHear(sound) / onHearSound(sound) / onLoseSound(sound) / onLooseSound(sound) and the friendly `sound` object.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = resolve(process.argv[2] || process.cwd());
const load = (rel) => import(pathToFileURL(ROOT + '/' + rel).href);

const { ScriptSystem } = await load('project/runtime/systems/ScriptSystem.js');
const { createSoundInfo, snapshotSound } = await load('project/runtime/scripting/SoundInfo.js');
const { TRANSFORM } = await load('project/runtime/components/Transform.js');
const { AUDIO_SOURCE } = await load('project/runtime/components/AudioSource.js');
let failed = 0;
const test = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); if (!ok) failed++; };

// ---- tiny fakes shaped like the real Entity / EntityContext
const makeEntity = (id, name, tag, x, y, audio) => {
  const comps = new Map([[TRANSFORM, { x, y }]]);
  if (audio) comps.set(AUDIO_SOURCE, audio);
  return { id, name, tag, getComponent: (t) => comps.get(t) };
};
const makeContext = (e) => ({
  _entity: e,
  get id() { return this._entity.id; }, get name() { return this._entity.name; }, get tag() { return this._entity.tag; },
  get x() { return this._entity.getComponent(TRANSFORM).x; }, set x(v) { this._entity.getComponent(TRANSFORM).x = v; },
  get y() { return this._entity.getComponent(TRANSFORM).y; },
  hp: 7,
});
const siren = makeEntity('siren-1', 'Siren', 'Alarm', 300, 400, { audioKey: 'siren.mp3', volume: 0.8, pitch: 1.5, loop: true, is3D: true });
const player = makeEntity('player-1', 'Player', 'Hero', 0, 0, null);
const entities = new Map([[siren.id, siren], [player.id, player]]);
const world = { getEntity: (id) => entities.get(id) || null };
const contexts = new Map();
const scriptApi = { createEntityContext: (e) => { if (!contexts.has(e.id)) contexts.set(e.id, makeContext(e)); return contexts.get(e.id); } };

// ---- 1. the engine compiles onHear / onLooseSound as real lifecycle handlers
const compileSystem = new ScriptSystem({});
const factory = compileSystem._compile('hear-compile-check',
  'function onHear(sound) { return "hear:" + sound.name; }\n' +
  'function onLooseSound(sound) { return "loose:" + sound.name; }\n' +
  'function onLoseSound(sound) { return "lose:" + sound.name; }\n' +
  'function onHearSound(sound) { return "hearSound:" + sound.name; }\n' +
  'function helper() { return 1; }');
const noop = () => {};
const handlers = factory(noop, noop, noop, noop, noop, noop, noop, {}, {}, {}, {}, [], {}, {}, {}, noop, {}, {}, {}, noop, noop, noop, noop, noop, noop, noop, noop, noop, {}, console, Math, {});
test('onHear is compiled as a lifecycle handler', typeof handlers.onHear === 'function');
test('onHearSound (original name) still compiled', typeof handlers.onHearSound === 'function');
test('onLoseSound still compiled', typeof handlers.onLoseSound === 'function');
test('onLooseSound (common misspelling) is compiled too', typeof handlers.onLooseSound === 'function');
test('a normal helper is not treated as a lifecycle handler', handlers.onFoo === undefined);

// ---- 2. the sound object for a live source
const sound = createSoundInfo(siren, scriptApi.createEntityContext(siren), player, scriptApi.createEntityContext(player), snapshotSound(siren));
test('sound.name is the object name', sound.name === 'Siren');
test('sound.tag works', sound.tag === 'Alarm');
test('sound.x / sound.y still work (it is the entity)', sound.x === 300 && sound.y === 400);
test('sound.clip is the audio asset name', sound.clip === 'siren.mp3');
test('sound.volume / pitch / loop come from the Audio Source', sound.volume === 0.8 && sound.pitch === 1.5 && sound.loop === true);
test('sound.distance is measured from the listener', Math.abs(sound.distance - 500) < 1e-9, String(sound.distance));
test('sound.destroyed is false for a live source', sound.destroyed === false);
test('sound.is() matches the name, ignoring case and spaces', sound.is('siren') && sound.is('  SIREN '));
test('sound.is() matches the tag', sound.is('alarm'));
test('sound.is() is false for something else', !sound.is('Enemy') && !sound.is('') && !sound.is(null));
test('sound.entity is the full entity and sound.listener is the listener', sound.entity === scriptApi.createEntityContext(siren) && sound.listener === scriptApi.createEntityContext(player));
test("custom variables on the source are still readable (sound.hp)", sound.hp === 7);
sound.x = 350;
test('writing sound.x moves the real entity', siren.getComponent(TRANSFORM).x === 350);
siren.getComponent(TRANSFORM).x = 300;
let threw = false; try { sound.clip = 'x'; } catch (e) { threw = /read-only/.test(e.message); }
test('assigning a read-only member gives a clear error', threw);
test("'distance' in sound is true", 'distance' in sound);

// ---- 3. a destroyed source gives a snapshot, never null
const ghost = createSoundInfo(null, null, player, scriptApi.createEntityContext(player), snapshotSound(siren));
test('destroyed source: sound is not null and keeps name/tag/clip', ghost && ghost.name === 'Siren' && ghost.tag === 'Alarm' && ghost.clip === 'siren.mp3');
test('destroyed source: sound.destroyed is true and entity is null', ghost.destroyed === true && ghost.entity === null);
test('destroyed source: sound.is() and distance still work', ghost.is('Siren') && Math.abs(ghost.distance - 500) < 1e-9);
const blank = createSoundInfo(null, null, null, null, null);
test('no information at all still gives a safe object', blank.destroyed === true && blank.name === '' && blank.is('x') === false);

// ---- 4. ScriptSystem fires the right handlers with the sound
const calls = [];
const system = new ScriptSystem(scriptApi);
const inst = (names) => ({ enabled: true, scriptName: 'T', context: { who: 'listener-script' },
  handlers: Object.fromEntries(names.map((n) => [n, function (s) { calls.push([n, s.name, s.destroyed, this.who]); }])) });
system.instances.set(player.id, [inst(['onHear', 'onHearSound', 'onLoseSound', 'onLooseSound'])]);
system.fireHearSound(player.id, siren.id, world);
test('hearing fires onHear and onHearSound with the sound', JSON.stringify(calls) === JSON.stringify([['onHear', 'Siren', false, 'listener-script'], ['onHearSound', 'Siren', false, 'listener-script']]), JSON.stringify(calls));
calls.length = 0;
system.fireLoseSound(player.id, siren.id, world);
test('losing fires onLoseSound and onLooseSound', JSON.stringify(calls.map((c) => c[0])) === JSON.stringify(['onLoseSound', 'onLooseSound']), JSON.stringify(calls));

// destroyed while in range: hear first (records a snapshot), then the entity disappears, then lose
calls.length = 0;
system.fireHearSound(player.id, siren.id, world);
entities.delete(siren.id);
calls.length = 0;
system.fireLoseSound(player.id, siren.id, world);
test('a source destroyed while in range: onLoseSound still gets its name', calls.length === 2 && calls[0][1] === 'Siren' && calls[0][2] === true, JSON.stringify(calls));
entities.set(siren.id, siren);

// a script that only defines onHear works, and one with a throwing handler does not break the other instances
const errors = []; system._errorCallback = (info) => errors.push(info);
calls.length = 0;
const bad = { enabled: true, scriptName: 'Bad', context: {}, handlers: { onHear() { throw new Error('boom'); } } };
const good = inst(['onHear']);
system.instances.set(player.id, [bad, good]);
system.fireHearSound(player.id, siren.id, world);
test('an error inside one onHear does not stop the next script', calls.length === 1 && calls[0][0] === 'onHear');
test('disabled script instances are skipped', (() => { calls.length = 0; good.enabled = false; system.fireHearSound(player.id, siren.id, world); return calls.length === 0; })());

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
