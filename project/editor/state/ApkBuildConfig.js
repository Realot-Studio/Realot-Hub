// Android APK build service settings. This is the ONE place to edit.
//
// NOTE: this is a static editor, so anything in this file can be read by a visitor
// who opens the page's files. The key can be revoked or rotated on the build
// service at any time; to change it, edit it here.

export const APK_SERVICE_URL = "https://apk--build-server.replit.app";
export const APK_API_KEY = "zk_live_CgVMJ9dp1dBVDrAGL93yBMLVZlHZm0ty";

/** Per-browser APK export allowance: this many exports in any rolling window. */
export const APK_EXPORT_LIMIT = 3;
export const APK_EXPORT_WINDOW_DAYS = 14;
