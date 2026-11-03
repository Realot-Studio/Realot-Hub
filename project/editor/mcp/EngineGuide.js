/**
 * EngineGuide.js — the text returned by the get_engine_guide MCP tool.
 *
 * Short on purpose: it is what an AI reads BEFORE building a game, so it has to be
 * accurate and cover the mistakes that cost the most time. Full references live in
 * the documentation site (https://realot-studio-documentation.pages.dev/llms.txt). Keep every statement here true
 * to the engine source; if an API changes, change this file in the same commit.
 */

const OVERVIEW = `REALOT STUDIO — QUICK GUIDE FOR AI BUILDERS

ENGINE DOCUMENTATION RULE: This is the engine's full documentation: https://realot-studio-documentation.pages.dev/ . Use that website for all the information you want about the engine. If you are unsure, use the engine API. Maximize using the engine API and components instead of writing complicated code: the engine has already solved common problems with a simple API, so use it and the user is not overwhelmed with code you provide. Use that URL and open https://realot-studio-documentation.pages.dev/llms.txt , or https://realot-studio-documentation.pages.dev/llms-full.txt for the complete documentation in one file. If you do not know the path of a page, search within the documentation using https://realot-studio-documentation.pages.dev/api/search?q=... (paths look like https://realot-studio-documentation.pages.dev/docs/api/components/transform.html).

WORKFLOW THAT WORKS
1. get_editor_state, list_scenes, list_entities, list_assets: see what exists before changing anything.
2. Build: create_entity (with components), write_script + attach_script, paint_tilemap, etc. Use describe_component(type) to see a component's fields, defaults and allowed values.
3. check_project: static checks (Main Camera, missing scripts/assets, Rigidbody without Collider, script syntax).
4. Test like a player: play_restart, then play_input with key presses / clicks / waits / assert / screenshot. Read play_get_state for positions and script variables. get_console / play_get_errors for script errors.
5. Fix what you saw, clear_console, test again. Repeat until the screenshots and assertions show the game really works. save_project when done.

COORDINATES
+X is right, +Y is DOWN. Jumping up = negative Y. Rotation is degrees. Units are reference-resolution pixels (the Main Camera defines the resolution).

SCRIPTS (plain JavaScript, no imports, no classes)
- Functions the engine calls if you define them: onStart(), onUpdate(dt), onFixedUpdate(dt) (60 Hz), onClick(), onCollisionEnter/Stay/Exit(other), onTriggerEnter/Exit(other), onMessage(msg), onDestroy().
- 'this' is the entity: this.x, this.y, this.rotation, this.name, this.tag, this.destroy(). Store your own state on it: this.hp = 100 (visible to play_get_state as script variables). Plain 'let' variables at the top of a script also work but cannot be inspected from outside.
- Component shortcuts exist only when the entity has that component: this.sprite, this.shape, this.text, this.rigidbody, this.collider, this.controller, this.animator, this.camera, this.audio, this.navAgent.
- Globals: findFirst(name), findAll(name), findWithTag(tag), spawn(...), pool, input, mouse, touch, time, scene, physics, global (shared values across scripts), save (persistent), tween(), wait(seconds, fn), repeat(seconds, fn), sendMessage(), broadcastMessage(), debug, random, mathx, nav.
- Move with time: this.x += speed * time.deltaTime. Keys: input.keyDown("ArrowLeft"), input.keyPressed("Space") (true for one frame). Both key names ("a", " ") and codes ("KeyA", "Space") work.
- Ground/jump/walk for a platformer: add Rigidbody2D (Dynamic) + Collider2D, then a CharacterController component (or drive rigidbody velocity in a script). Walls and floors are Collider2D with a Static Rigidbody2D.
- Do not use arrow functions for methods that need 'this'. Use 'function name() {}'.

BUILDING A GOOD GAME
- Give the scene exactly one Main Camera. Put gameplay on named entities with tags (Player, Enemy, Coin...) so scripts can find them.
- Make a clear loop: goal, challenge, feedback (score text via TextRenderer, sound via AudioSource, tween/animation), win/lose, restart (scene.restart()).
- Use ShapeRenderer (Square, Circle, Triangle, Capsule) for quick placeholder visuals before sprites exist; they render fine and are easy to test.
- Test every mechanic you add with play_input and an assert, not just by looking at it once.

TESTING TOOLS (what they do)
- play_restart: fresh game from the current scene; leaves it paused so tests are deterministic.
- play_input actions: key_press {key, frames?}, hold {keys, frames|seconds}, key_down/key_up, wait {frames|seconds}, click/tap {x, y, space:"screen"|"world"} or {entity}, drag/swipe {from, to}, screenshot {label}, inspect {entity}, eval {expression}, assert {expression, message}, scene_load {name}.
- play_step: advance frames. play_screenshot: see the game as the player does.
- play_eval: run an expression with the script globals, e.g. findFirst("Player").hp  or  global.score.
Games run on a fixed time step while testing, so results are repeatable. 60 frames = 1 game second.`;

const TOPICS = {
  testing: `TESTING RECIPES
A. Does the player move?
  play_restart, then play_input actions: [{"type":"eval","expression":"(global.x0 = findFirst('Player').x)"}, {"type":"hold","keys":["right"],"seconds":1}, {"type":"assert","expression":"findFirst('Player').x > global.x0 + 20","message":"player moved right"}, {"type":"screenshot","label":"after moving"}]
B. Can the player jump? hold/press "space", then wait 20 frames and assert the player's y is lower (smaller) than before.
C. UI button: {"type":"click","entity":"PlayButton"} then assert scene or global state changed. For a spot on screen use {"type":"click","x":400,"y":300}. Coordinates default to screen pixels; add "space":"world" for world coordinates.
D. Win/lose: set up the situation (move the player next to the goal with play_eval "findFirst('Player').x = 900"), wait a few frames, then assert global.won === true or check the screenshot.
E. Regression pass: after any script change, play_restart again (play_restart reloads current scripts) and rerun the same actions.
Always check "newErrors" in the result: a script error means something is broken even if assertions passed.
If a click does nothing: entities need a Collider2D for onClick; UI components (TextInput, Joystick) use their own input.`,

  scripting: `SCRIPTING NOTES
- Lifecycle order: onStart (once) then onUpdate every frame. Clones from spawn()/pool run onClone first.
- Finding things: findFirst("Name"), findAll("Name"), findWithTag("Enemy"). They return live entity contexts: other.x, other.hp, other.destroy().
- Timers: wait(1.5, function () {...}) runs once; repeat(0.5, function () {...}) repeats; cancelWait/cancelRepeat. Call them from a lifecycle function.
- Messages: sendMessage(target, "name", data) and onMessage(msg) / broadcastMessage.
- Scenes: scene.load("Level 2"), scene.restart(), scene.pause()/resume().
- Physics: this.rigidbody.velocityX / velocityY, physics.raycast(x1, y1, x2, y2). Collision callbacks need Collider2D on both entities; triggers need isTrigger on the collider.
- Persistence: global.value = 1 lasts until the page reloads; save.set("best", 10) persists.
- Errors: a thrown error appears in get_console as "[Script Error] 'Script' line N". Fix the line, write_script again, play_restart.`,

  physics: `PHYSICS NOTES
- Body types: Dynamic (falls, collides), Kinematic (moved by code, pushes dynamics), Static (never moves: floors, walls).
- Gravity is 980 px/s² toward +Y (down the screen); Rigidbody2D.gravityScale scales it per body.
- A Rigidbody2D needs a Collider2D to collide. Layers: 16 named layers (list_physics_layers); a collider's mask says which layers it hits (set_collider_layer_filter).
- One-way platforms, joints and triggers are options on Collider2D / Joint2D (describe_component shows the fields).
- To test physics in play_input, wait enough frames (60 per second) for bodies to settle, then assert on positions.`,

  assets: `ASSET NOTES
- list_assets shows imported sprites/audio. To add one: begin_asset_upload, append_asset_upload_chunk (base64, sequential), complete_asset_upload.
- SpriteRenderer.spriteKey and AudioSource.audioKey refer to asset keys. check_project warns about keys that do not exist.
- No art available? Use ShapeRenderer (Square, Circle, Triangle, Capsule with a color) and TextRenderer; they are real, exportable components.`,

  ui: `UI NOTES
- Text on screen: TextRenderer (screenSpace true, the default, pins it to the screen like a HUD; false puts it in the world), TextInput, ChatLog, SpeechBubble, Joystick (mobile).
- HUD coordinates use the Main Camera's reference resolution, so they stay put across device sizes.
- Buttons: an entity with a visual + Collider2D and an onClick() script. Test with play_input click {entity}.`,
};

export const ENGINE_GUIDE = Object.freeze({ overview: OVERVIEW, topics: Object.freeze(TOPICS) });
