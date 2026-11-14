/**
 * Announcements.js
 * The bell in the top bar: notes from the developer. Click it to read them.
 *
 * - Messages come straight from the feedback server (GET /api/developer-messages,
 *   with the key from js/data/hub-config.js), checked every 15 seconds while the
 *   page is visible. A new message shows a pop-up notification and a red number.
 * - The top bar re-renders on every state change, which recreates the bell
 *   button. So all state lives here, the panel lives on <body>, and
 *   createBell() just hands the top bar a fresh button that reflects it.
 * - Everything from the server is shown as text (never as HTML).
 */
window.RealotAnnouncements = (function () {
    'use strict';

    var SEEN_KEY = 'realot_announce_seen';
    var CACHE_KEY = 'realot_announce_cache';
    var POLL_MS = 15 * 1000;         // check for new announcements every 15 seconds (while the page is visible)
    var STALE_MS = 5 * 1000;         // opening the panel refreshes if the list is older than this
    var EPOCH = '1970-01-01T00:00:00.000Z';
    var MAX_KEEP = 50;               // newest announcements kept in the list
    var NEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // first visit: count the last 14 days as unread

    var state = { items: [], status: 'idle', open: false, lastFetch: 0, loadedOnce: false };
    var freshIds = {};               // ids that were unread when the panel was opened (get a "new" dot)
    var seen = loadSeen();           // ISO time of the newest announcement the visitor has already opened
    var panel = null;
    var inflight = false;
    var pollTimer = null;

    function apiBase() {
        var cfg = window.RealotHubConfig || {};
        // Both the address and the key are needed; without them the bell says "not connected".
        return cfg.feedbackApiKey ? String(cfg.feedbackApiUrl || '').replace(/\/+$/, '') : '';
    }

    function storageGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
    function storageSet(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* private mode: fine */ } }

    function loadSeen() {
        var saved = storageGet(SEEN_KEY);
        if (saved && !isNaN(Date.parse(saved))) return saved;
        return new Date(Date.now() - NEW_WINDOW_MS).toISOString();
    }

    function loadCache() {
        try {
            var list = JSON.parse(storageGet(CACHE_KEY) || '[]');
            if (Array.isArray(list)) state.items = list.filter(validItem).slice(0, MAX_KEEP);
        } catch (e) { /* ignore a damaged cache */ }
    }

    function validItem(m) {
        return m && typeof m.id === 'string' && typeof m.createdAt === 'string' && !isNaN(Date.parse(m.createdAt));
    }

    function isNew(item) { return Date.parse(item.createdAt) > Date.parse(seen); }
    function unreadCount() { return state.items.filter(isNew).length; }

    /* ---------------- bell button ---------------- */

    function updateBadges() {
        var count = unreadCount();
        var bells = document.querySelectorAll('.ann-bell');
        for (var i = 0; i < bells.length; i++) {
            var badge = bells[i].querySelector('.ann-badge');
            if (!badge) continue;
            badge.textContent = count > 9 ? '9+' : String(count);
            badge.hidden = count === 0;
            bells[i].setAttribute('aria-expanded', String(state.open));
            bells[i].setAttribute('aria-label', count > 0 ? 'Announcements, ' + count + ' new' : 'Announcements');
        }
    }

    function createBell() {
        var el = window.RealotDom.el;
        var btn = el('button', {
            type: 'button',
            class: 'topbar-icon-btn ann-bell',
            title: 'Announcements from the developer',
            'aria-haspopup': 'dialog',
            'aria-expanded': String(state.open),
            onClick: function (e) { toggle(e.currentTarget); }
        }, [
            el('span', { html: '<svg data-lucide="bell"></svg>' }),
            el('span', { class: 'ann-badge', hidden: 'hidden' }, [''])
        ]);
        // Fill in the badge right away (the node isn't in the page yet, so update it directly).
        var count = unreadCount();
        var badge = btn.querySelector('.ann-badge');
        if (count > 0) { badge.textContent = count > 9 ? '9+' : String(count); badge.removeAttribute('hidden'); }
        return btn;
    }

    /* ---------------- panel ---------------- */

    function ensurePanel() {
        if (panel) return panel;
        panel = document.createElement('div');
        panel.className = 'ann-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Announcements');
        panel.tabIndex = -1;
        panel.hidden = true;
        document.body.appendChild(panel);

        document.addEventListener('pointerdown', function (e) {
            if (!state.open) return;
            if (panel.contains(e.target) || (e.target.closest && e.target.closest('.ann-bell'))) return;
            close(false);
        }, true);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && state.open) { close(true); }
        });
        window.addEventListener('resize', position);
        return panel;
    }

    function position() {
        if (!panel || !state.open) return;
        var bell = document.querySelector('.ann-bell');
        if (!bell) return;
        var r = bell.getBoundingClientRect();
        var margin = 12;
        var width = Math.min(380, window.innerWidth - margin * 2);
        var right = Math.max(margin, window.innerWidth - r.right);
        panel.style.top = Math.round(r.bottom + 8) + 'px';
        panel.style.right = Math.round(Math.min(right, window.innerWidth - width - margin)) + 'px';
        panel.style.maxHeight = Math.max(200, window.innerHeight - r.bottom - 24) + 'px';
    }

    function ago(iso) {
        var s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
        if (s < 60) return 'just now';
        if (s < 3600) return Math.floor(s / 60) + ' min ago';
        if (s < 86400) return Math.floor(s / 3600) + ' h ago';
        if (s < 86400 * 30) return Math.floor(s / 86400) + ' d ago';
        return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    /** Puts text into a node, turning http(s) links into real links (never interpreting HTML). */
    function addText(node, text) {
        var parts = String(text).split(/(https?:\/\/[^\s<>"]+)/g);
        parts.forEach(function (part, i) {
            if (i % 2 === 0) { if (part) node.appendChild(document.createTextNode(part)); return; }
            var trail = (part.match(/[.,;:!?)\]]+$/) || [''])[0];
            var url = part.slice(0, part.length - trail.length);
            var a = document.createElement('a');
            a.href = url; a.textContent = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
            node.appendChild(a);
            if (trail) node.appendChild(document.createTextNode(trail));
        });
    }

    function renderPanel() {
        if (!panel) return;
        var el = window.RealotDom.el;
        panel.textContent = '';

        var head = el('div', { class: 'ann-head' }, [
            el('div', { class: 'ann-title' }, ['Announcements']),
            el('button', { type: 'button', class: 'ann-x', title: 'Close', 'aria-label': 'Close announcements', onClick: function () { close(true); } }, ['\u00d7'])
        ]);
        var body = el('div', { class: 'ann-body' });

        if (!apiBase()) {
            body.append(el('div', { class: 'ann-empty' }, ['Announcements aren\u2019t connected yet.']));
        } else if (state.status === 'loading' && state.items.length === 0) {
            body.append(el('div', { class: 'ann-empty' }, ['Loading\u2026']));
        } else if (state.status === 'error' && state.items.length === 0) {
            body.append(el('div', { class: 'ann-empty' }, [
                'Couldn\u2019t load announcements.',
                el('button', { type: 'button', class: 'ann-retry', onClick: function () { refresh(true); } }, ['Try again'])
            ]));
        } else if (state.items.length === 0) {
            body.append(el('div', { class: 'ann-empty' }, ['No announcements yet. Check back soon!']));
        } else {
            state.items.forEach(function (item) {
                var card = el('article', { class: 'ann-item' + (freshIds[item.id] ? ' is-new' : '') });
                var top = el('div', { class: 'ann-item-top' }, [
                    el('h3', {}, [item.title || 'Announcement']),
                    el('time', { datetime: item.createdAt, title: new Date(item.createdAt).toLocaleString() }, [ago(item.createdAt)])
                ]);
                var text = el('p', { class: 'ann-text' });
                addText(text, item.message || '');
                card.append(top, text);
                body.append(card);
            });
            if (state.status === 'error') {
                body.append(el('div', { class: 'ann-note' }, ['Showing the last saved list. Couldn\u2019t refresh just now.']));
            }
        }
        panel.append(head, body);
    }

    function markSeen() {
        var newest = state.items.reduce(function (max, m) { return Math.max(max, Date.parse(m.createdAt)); }, 0);
        if (newest > Date.parse(seen)) { seen = new Date(newest).toISOString(); storageSet(SEEN_KEY, seen); }
        updateBadges();
    }

    function open(anchor) {
        ensurePanel();
        // Remember what was new at this moment, so those cards keep a "new" dot while the panel is open.
        freshIds = {};
        state.items.forEach(function (m) { if (isNew(m)) freshIds[m.id] = true; });
        state.open = true;
        renderPanel();
        panel.hidden = false;
        position();
        markSeen();
        updateBadges();
        try { panel.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        refresh(false);
    }

    function close(returnFocus) {
        if (!state.open) return;
        state.open = false;
        if (panel) panel.hidden = true;
        updateBadges();
        if (returnFocus) { var bell = document.querySelector('.ann-bell'); if (bell) bell.focus(); }
    }

    function toggle(anchor) { if (state.open) close(true); else open(anchor); }

    /* ---------------- loading ---------------- */

    /** Newest createdAt we already have: the next check only asks for anything after it. */
    function cursor() {
        var newest = state.items.reduce(function (max, m) { return Math.max(max, Date.parse(m.createdAt)); }, 0);
        return newest > 0 ? new Date(newest).toISOString() : EPOCH;
    }

    function cleanItem(m) {
        return {
            id: String(m.id),
            title: String(m.title == null ? '' : m.title).slice(0, 200),
            message: String(m.message == null ? '' : m.message).slice(0, 5000),
            createdAt: String(m.createdAt)
        };
    }

    function refresh(force) {
        var base = apiBase();
        if (!base || inflight) return;
        if (!force && Date.now() - state.lastFetch < STALE_MS) return;
        inflight = true;
        if (state.items.length === 0) { state.status = 'loading'; if (state.open) renderPanel(); }

        var url = base + '/api/developer-messages?after=' + encodeURIComponent(cursor()) + '&limit=100';
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        var timer = setTimeout(function () { if (controller) controller.abort(); }, 12000);
        var arrived = [];
        fetch(url, {
            headers: { Accept: 'application/json', Authorization: 'Bearer ' + window.RealotHubConfig.feedbackApiKey },
            signal: controller ? controller.signal : undefined
        })
            .then(function (res) { if (!res.ok) throw new Error('status ' + res.status); return res.json(); })
            .then(function (data) {
                var list = Array.isArray(data) ? data : (data && (data.items || data.messages));
                if (!Array.isArray(list)) throw new Error('bad data');
                var known = {};
                state.items.forEach(function (m) { known[m.id] = true; });
                list.filter(validItem).forEach(function (raw) {
                    var item = cleanItem(raw);
                    if (known[item.id]) return;       // already have it (the server may repeat the boundary message)
                    known[item.id] = true;
                    state.items.push(item);
                    arrived.push(item);
                });
                state.items.sort(function (a, b) { return Date.parse(b.createdAt) - Date.parse(a.createdAt); });
                state.items = state.items.slice(0, MAX_KEEP);
                state.status = 'ok';
                state.lastFetch = Date.now();
                storageSet(CACHE_KEY, JSON.stringify(state.items));
            })
            .catch(function () { state.status = 'error'; })
            .then(function () {
                clearTimeout(timer);
                inflight = false;
                var firstLoad = !state.loadedOnce && state.status === 'ok';
                if (state.status === 'ok') state.loadedOnce = true;
                if (state.open) {
                    // Anything that arrived while the panel is open counts as new, then counts as read.
                    state.items.forEach(function (m) { if (isNew(m)) freshIds[m.id] = true; });
                    renderPanel();
                    markSeen();
                } else {
                    announceArrivals(arrived, firstLoad);
                }
                updateBadges();
            });
    }

    /** Pop-up notification: one per message that arrives while the page is open, or a summary on first load. */
    function announceArrivals(arrived, firstLoad) {
        var fresh = arrived.filter(isNew);
        if (fresh.length === 0) return;
        if (firstLoad || fresh.length > 3) {
            var n = unreadCount();
            showToast(n === 1 ? (fresh[0].title || 'New announcement') : n + ' new announcements',
                      n === 1 ? fresh[0].message : 'Click to read them.');
            return;
        }
        fresh.slice().reverse().forEach(function (m) { showToast(m.title || 'New announcement', m.message); });
    }

    /* ---------------- pop-up notifications ---------------- */

    var toastHost = null;

    function showToast(title, text) {
        if (!document.body) return;
        if (!toastHost) {
            toastHost = document.createElement('div');
            toastHost.className = 'ann-toasts';
            toastHost.setAttribute('aria-live', 'polite');
            document.body.appendChild(toastHost);
        }
        var toast = document.createElement('div');
        toast.className = 'ann-toast';
        toast.setAttribute('role', 'status');

        var head = document.createElement('div'); head.className = 'ann-toast-title'; head.textContent = title || 'New announcement';
        var body = document.createElement('div'); body.className = 'ann-toast-text'; body.textContent = String(text || '').slice(0, 140);
        var x = document.createElement('button'); x.type = 'button'; x.className = 'ann-toast-x'; x.setAttribute('aria-label', 'Dismiss'); x.textContent = '\u00d7';
        toast.appendChild(head); toast.appendChild(body); toast.appendChild(x);

        function remove() { if (toast.parentNode) toast.parentNode.removeChild(toast); }
        x.addEventListener('click', function (e) { if (e.stopPropagation) e.stopPropagation(); remove(); });
        toast.addEventListener('click', function () {
            remove();
            var bell = document.querySelector('.ann-bell');
            if (!state.open) open(bell);
        });
        toastHost.appendChild(toast);
        while (toastHost.children && toastHost.children.length > 3) toastHost.removeChild(toastHost.children[0]);
        setTimeout(remove, 9000);
    }

    function init() {
        if (!apiBase()) return;
        loadCache();
        updateBadges();
        setTimeout(function () { refresh(true); }, 800);            // after the first paint
        if (!pollTimer) pollTimer = setInterval(function () { if (!document.hidden) refresh(true); }, POLL_MS);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(true); });
        window.addEventListener('online', function () { refresh(true); });
    }

    return { init: init, createBell: createBell, refresh: refresh };
})();
