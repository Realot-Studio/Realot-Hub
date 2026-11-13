# Realot — Client Distribution

This is the static Realot editor, runtime, player, and game exporter. It
does not include an Android SDK, Gradle, or an APK build server. Android APKs
are built by the external API server configured in the editor.

## Run the editor

Upload this folder to any static host that serves ES modules, JSON, WASM, and
the included vendor files. The included `_redirects` and `_headers` files configure Cloudflare Pages
(friendly `/editor` and `/play` routes, cache headers). For a local preview, use any static HTTP server, for
example:

```bash
python3 -m http.server 5000
```

Open `http://localhost:5000/` and choose **Open Editor**.

## Android APK export

The editor builds an HTML5 or PWA game ZIP in the browser, then sends that ZIP
to the Android build API. The service URL and API key are set in
`project/editor/state/ApkBuildConfig.js`. The permanent service key is **not** in
the editor: it is a secret (`APK_API_KEY`) in the Realot Worker, which the editor
reaches through the address in `js/data/hub-config.js`. To rotate the key run
`npx wrangler secret put APK_API_KEY` in the Worker folder. If no Worker address is
set, the editor falls back to requesting a temporary bearer key automatically.
These keys expire after 48 hours. Key issuance is public self-service, not user
authentication; anyone who can reach the service can request a temporary key.

```text
POST /api/v1/build?name=<url-encoded-game-title>
```

with the ZIP as the request body and the headers documented in
`project/editor/export/ANDROID_EXPORT_CONTRACT.md`.

For a different build server, use **Export → Android APK → Use a different
server** and enter the URL and key supplied by that server's owner. Never put
the permanent service key in this static client package.

The client package does not contain Android SDK files, Gradle files, Java
build scripts, or a local APK builder. The APK server is only needed while
creating the APK; the finished APK runs independently. This distribution is
preconfigured for the APK service, so users only need to click **Export
APK**; there is no custom-server or credential setup in the editor.

## Documentation and safety

- Engine documentation: https://realot-studio-documentation.pages.dev/ (linked from the hub's Learn tab).
- `SECURITY.md` — **read before sharing projects:** game scripts are not sandboxed; set up a separate play origin.
- `file-association/` — how to get the Realot icon on `.realot` project files.
- `tests/e2e-play-origin.py` — browser test for the Play window and its origin isolation.
- `THIRD_PARTY_LICENSES.md` — licenses for bundled libraries. Exported games include their own copy.

## Folder map

- `project/runtime/` — the game engine shipped with games
- `project/editor/` — the development editor and HTML5/PWA exporter
- `project/player/` — the standalone player
- `project/vendor/` — required local Pixi, Hammer, Rapier, Monaco, JSZip, and
  other vendor files
- `css/`, `icons/`, and `js/` — the engine hub client
- `sw.js` and `offline-manifest.json` — offline PWA support

## What is intentionally not included

This client distribution excludes the local Android SDK/Gradle tooling,
server-side APK builder, Node server, tests and verification utilities,
Replit configuration, Replit task/skill files, caches, workspace secrets, Git
metadata, temporary archives, and deployment-only server configuration.

## AI bridge (let any MCP-capable AI edit your project)
Press **AI** in the editor toolbar and follow the four steps (no terminal needed).
Details and safety notes: `relay/README.md`.


## Object pooling

See the engine documentation site: https://realot-studio-documentation.pages.dev/

## License

The source is available to read, download and run locally, but it is not open source. You may not publish, host, sell or redistribute the engine, use it as the base for another engine, or claim it as yours. Games you make with it are yours. Third-party licenses must be kept (see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)). Full terms: [LICENSE](LICENSE).
