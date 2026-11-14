/**
 * js/data/hub-config.js
 *
 * Settings for the hub's bug report page (report/index.html) and the announcements
 * bell (js/components/Announcements.js). They talk straight to your feedback server.
 *
 * NOTE: this file is PUBLIC (every visitor can read it), so the key below is visible to anyone
 * who looks. If it is ever abused, make a new key on the feedback server's API keys page, delete
 * the old one, and paste the new one here.
 *
 * Your feedback server must allow requests from your website (CORS): it has to answer with
 * "Access-Control-Allow-Origin" for your hub's address and allow the "Authorization" and
 * "Content-Type" headers. If the bell or report page says it can't reach the server, check the
 * browser console (F12): a "CORS" error means the server needs that setting.
 */
window.RealotHubConfig = {
    feedbackApiUrl: "https://developer-feedback-hub--vealis-service.replit.app",
    feedbackApiKey: "ef_live_33e9b611537234adcd36e7ba4fe544aebe4ac797983e827fc98a99084efc4ff6"
};
