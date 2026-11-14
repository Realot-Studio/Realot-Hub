/**
 * js/data/hub-config.js
 *
 * The few settings the hub needs from the outside world. Loaded by index.html
 * (announcements bell) and report/index.html (bug report page).
 *
 * feedbackApiUrl: the address of your deployed Realot Worker (see the Worker's
 *   README), for example "https://realot-feedback.yourname.workers.dev".
 *   No trailing slash. One Worker serves three things: the bug report page,
 *   the announcements bell, and the editor's Android (APK) builds.
 *   Leave it empty and the bell and report page show a friendly "not set up
 *   yet" message, and APK export falls back to temporary self-service keys.
 *
 * This file is PUBLIC (every visitor can read it). Never put an API key here;
 * the key belongs in the Worker as a secret.
 */
window.RealotHubConfig = {
    feedbackApiUrl: "https://realot-worker.ethanbanyam.workers.dev"
};
