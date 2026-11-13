// Android APK build service settings. This is the ONE place to edit.
//
// THE PERMANENT SERVICE KEY IS NOT IN THIS FILE (or anywhere in the editor).
// It is stored as a secret in the Realot Worker (the feedback-worker folder:
// secret APK_API_KEY). The editor sends its build requests to that Worker; the
// Worker adds the real key and passes them on to the build service. Anything in
// this file can be read by every visitor, so a key here would not be a secret.
//
// The Worker's address is set once, in js/data/hub-config.js (feedbackApiUrl),
// and shared with the hub's bug report page and announcements bell.
//
// If no Worker address is set, the editor falls back to talking to the build
// service directly with the short-lived self-service keys it can issue
// (see ServerConfig.js), so exporting still works, just without your key.

/** The build service itself (used directly only when no Worker address is set). */
const DIRECT_SERVICE_URL = "https://apk--build-server.replit.app";

const _workerUrl =
  (typeof window !== "undefined" &&
    window.RealotHubConfig &&
    typeof window.RealotHubConfig.feedbackApiUrl === "string" &&
    window.RealotHubConfig.feedbackApiUrl.trim().replace(/\/+$/, "")) ||
  "";

/** Where build requests go: the Worker when it is configured, otherwise the service directly. */
export const APK_SERVICE_URL = _workerUrl || DIRECT_SERVICE_URL;

/**
 * Sent as the X-Api-Key header. This is only a PLACEHOLDER that tells the editor
 * "a key is handled for me": the Worker replaces it with the real key on every
 * request. Empty = no Worker, use self-service temporary keys.
 */
export const APK_API_KEY = _workerUrl ? "via-worker" : "";

/** Per-browser APK export allowance: this many exports in any rolling window. */
export const APK_EXPORT_LIMIT = 3;
export const APK_EXPORT_WINDOW_DAYS = 14;
