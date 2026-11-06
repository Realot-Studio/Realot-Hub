/**
 * bridge-config.js — settings the engine's builder fills in.
 *
 * DEFAULT_RELAY_URL  The shared relay every user connects through. Users only
 *                    press AI → copy the link into their AI app → Connect.
 *                    (Users can deploy their own copy from the realot-bridge repo.)
 *
 * AI_MINUTES_PER_DAY How many minutes the AI may actively work on a project
 *                    per 24 hours while using the shared relay. Time only
 *                    counts while the AI is actually working (running tools);
 *                    being connected and idle is free. Users who host their
 *                    own relay have no limit.
 *
 * AI_IDLE_GRACE_SECONDS  Pauses up to this long between two AI tool calls still
 *                    count as "working" (the AI is thinking). Longer pauses
 *                    are free.
 *
 * RELAY_REPO_URL     GitHub address of the PUBLIC relay repository (the relay files
 *                    sit at the repo root, with wrangler.toml). Powers the
 *                    "host the relay yourself" button. The engine repo itself can
 *                    stay private. Leave empty to let users type an address in.
 */
export const DEFAULT_RELAY_URL = "https://realot-bridge.realot.workers.dev";
export const AI_MINUTES_PER_DAY = 30;
export const AI_IDLE_GRACE_SECONDS = 20;
export const RELAY_REPO_URL = "https://github.com/Realot-Studio/realot-bridge";
