// Run from the folder containing index.html: node tests/unit-intellisense-names.mjs
// Tests the "don't make me guess" autocomplete: which string/name context the cursor is in, and the
// scanners that find names a script author invented (this.<variables>, handler parameter names).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const ROOT = resolve(process.argv[2] || process.cwd());
const src = readFileSync(ROOT + '/project/editor/scripting/ScriptIntelliSense.js', 'utf8');
// Pull a top-level function's source out of the module so it can be tested without Monaco.
const grab = (name) => {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  const end = src.indexOf('\n}\n', start) + 3;
  return src.slice(start, end);
};
const code = ['_isInsideOnMessageBody', '_detectStringContext', '_parseHandlerParams', '_getThisMembers']
  .map(grab).join('\n');
const f = new Function(code + '\nreturn { _detectStringContext, _parseHandlerParams, _getThisMembers };')();
let failed = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)); if (!ok) failed++; };
const ctx = (line, full) => f._detectStringContext(line, full || line);

// ---- string contexts (cursor right after the opening quote)
eq('sound.name == " → object names', ctx('if (sound.name == "'), 'entityName');
eq('s.tag === " → tags', ctx('if (s.tag === "'), 'entityTag');
eq('sound.is(" → name or tag', ctx('if (sound.is("'), 'nameOrTag');
eq('this.ear.canHear(" → name or tag', ctx('if (this.ear.canHear("'), 'nameOrTag');
eq('sound.clip == " → audio assets', ctx('if (sound.clip == "'), 'audioName');
eq('audio.audioKey = " → audio assets', ctx('this.audio.audioKey = "'), 'audioName');
eq('.texture = " → textures (assign)', ctx('this.sprite.texture = "'), 'textureName');
eq('.texture == " → textures (compare)', ctx('if (this.sprite.texture == "'), 'textureName');
eq('pool.get(" → pool names', ctx('var b = pool.get("'), 'poolName');
eq('pool.find(" → pool names', ctx('var p = pool.find("'), 'poolName');
eq('pool.create(" → scene objects', ctx('var p = pool.create("'), 'entityName');
eq('global[" → global names', ctx('var s = global["'), 'globalName');
eq('animator.currentClip === " → clips', ctx('if (this.animator.currentClip === "'), 'clipName');
eq('animator.play(" → clips (existing)', ctx('this.animator.play("'), 'clipName');
eq('scene.load(" → scenes (existing)', ctx('scene.load("'), 'sceneName');
eq('findFirst(" → objects (existing)', ctx('var e = findFirst("'), 'entityName');
eq('input.keyDown(" → keys (existing)', ctx('if (input.keyDown("'), 'keyCode');
eq('state.change(" → states (existing)', ctx('this.state.change("'), 'stateName');
eq('save.get(" → save keys (existing)', ctx('save.get("'), 'saveKey');
eq('message === " inside onMessage → messages (existing)', ctx('  if (message === "', 'function onMessage(message) {\n  if (message === "'), 'messageSent');
eq('plain text has no context', ctx('var x = "'), null);
eq('single quotes work too', ctx("if (sound.is('"), 'nameOrTag');
eq('partially typed text still matches', ctx('if (sound.is("Sir'), 'nameOrTag');

// ---- handler parameter names (any name, not just sound/other)
const hp = f._parseHandlerParams('function onHear(noise) {}\nfunction onLooseSound(gone) {}\nfunction onTriggerEnter(thing) {}\nfunction onCollisionStay(hit) {}\nfunction onUpdate(dt) {}');
eq('sound params found (plus the default name)', [...hp.sound].sort(), ['gone', 'noise', 'sound']);
eq('other params found (plus the default name)', [...hp.other].sort(), ['hit', 'other', 'thing']);

// ---- scanners
eq('this.<variables> are found', [...f._getThisMembers('function onStart() { this.speed = 5; this.hp = 3; }\nfunction onUpdate() { if (this.alive) this.speed++; }')].sort(), ['alive', 'hp', 'speed']);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
