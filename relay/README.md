# Realot ⇄ AI bridge (relay)

The relay is the small free Cloudflare service that links any AI app that supports MCP connectors to an open Realot editor.

## How it is set up
The engine ships with the shared relay already built in (`DEFAULT_RELAY_URL` in `project/editor/bridge/bridge-config.js` is `https://realot-bridge.realot.workers.dev`).

**Your users:** open a project → press **AI** → copy the link → add it in their AI app (*Settings → Connectors / MCP servers → Add custom connector*) → press **Connect**. Each user gets their own private link; nobody can see anybody else's project.

**Time allowance:** on the shared relay the AI gets `AI_MINUTES_PER_DAY` active minutes per 24 hours (default 30, set in `bridge-config.js`). Only time the AI is actually working counts: a tool call running, plus up to `AI_IDLE_GRACE_SECONDS` of "thinking" between calls. Being connected while idle is free. When it runs out the panel says it resets every 24 hours. The limit is tracked in the user's browser, so it keeps honest users in line but isn't tamper-proof.

**More time:** at the bottom of the AI panel users can click to deploy their own copy of this relay to a free Cloudflare account, paste its `.workers.dev` address, and use it with no time limit. Set `RELAY_REPO_URL` in `bridge-config.js` to your engine's GitHub address so that button works in one click.

## Deploying / updating the shared relay (you, once)
1. Put the engine, including this `relay` folder, in your GitHub repo.
2. Deploy from Cloudflare (*Workers & Pages → Create → Import a repository*, root directory `relay`) or run `npx wrangler deploy` inside `relay`.
3. (Recommended) In Cloudflare → your worker → Settings → Variables, set `ALLOWED_ORIGINS` to your site, e.g. `https://yourname.github.io`, so only your engine can use the relay.

## Safety
* Nothing connects until the user presses **Connect**; the toolbar dot shows the state.
* The link contains a private key — anyone with it can edit that user's open project. **Make a new private link** replaces it.
* **Read-only** lets the AI look without changing anything. Every change can be undone with Ctrl+Z.
* Limits per user: 90 tool calls per minute and 256 KiB per request. Asset transfers use sequential chunks and are limited to 20 MiB per file.

## Cost
The relay runs on Cloudflare's **free plan**: it uses a SQLite-backed Durable Object (required on free) with WebSocket hibernation, so an open-but-idle editor costs almost nothing. Free limits are shared across all your users. If the engine grows, the paid Workers plan is about $5/month.

## What your AI can do

* **Scenes and scripts:** inspect and edit entities, components, scripts, play mode, console, and screenshots.
* **Assets:** list, rename, and delete sprites, animation frames (Animation Clips folder), tile images (Tiles folder) and audio; import image/audio files through a chunked upload of up to 20 MiB each.
* **Reuse existing images:** add any sprite, frame or tile to an animation clip, put one in a tileset slot, or cut one image into all 16 tile slots.
* **Animation:** open the animation editor, create/update/delete clips, import image sequences, GIFs, sprite sheets, and image ZIPs, then reorder or delete frames.
* **Tilemaps and tilesets:** import a custom 4×4 tileset sheet or individual tile image, edit tileset roles and dimensions, and paint/erase map cells.
* **Navigation and physics:** paint walkable/blocked navigation cells and areas, edit navigation bounds/costs, rename navigation/physics layers, and set Collider2D layer masks.
* **Undo, redo, and save:** project changes use the editor's history where supported.

## For developers
`mcp-core.js` (MCP protocol, shared) · `worker.js` (Cloudflare Worker + Durable Object) ·
`relay-node.mjs` (same relay for local testing: `npm install && npm run local`, address `http://localhost:8787`).


## Playtesting and discovery tools

The AI can play and test the game it builds, not just edit it:

* `play_restart`, `play_input`, `play_step` — start the game fresh and drive it with keys, clicks, taps, drags and waits on a fixed 60 fps time step (repeatable). `play_input` also takes `assert`, `eval`, `inspect` and `screenshot` steps and reports failed assertions and new script errors.
* `play_screenshot`, `play_get_state`, `play_get_entity`, `play_eval`, `play_get_errors` — see and read the running game (positions, velocities, `this.*` script variables, `global` values).
* `get_engine_guide`, `describe_component`, `check_project`, `duplicate_entities`, `clear_console` — learn the engine, validate the project, copy entities, reset the log.

Each tool call has a 25 second limit; split long tests into several `play_input` calls (the game keeps its state between calls). The browser must allow the Play popup.
