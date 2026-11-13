/**
 * Announcements.js
 * The bell in the top bar: notes from the developer. Click it to read them.
 *
 * - Messages come from the feedback Worker (GET /announcements), never straight
 *   from the feedback server, so no API key is ever in this file.
 * - The top bar re-renders on every state change, which recreates the bell
 *   button. So all state lives here, the panel lives on <body>, and
 *   createBell() just hands the top bar a fresh button that reflects it.
 * - Everything from the server is shown as text (never as HTML).
 */
window.RealotAnnouncements = (function () {
    'use strict';

    var SEEN_KEY = 'realot_announce_seen';
    var CACHE_KEY = 'realot_announce_cache';
    var POLL_MS = 5 * 60 * 1000;     // check for new announcements every 5 minutes
    var STALE_MS = 30 * 1000;        // opening the panel refreshes if the list is older than this
    var NEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // first visit: count the last 14 days as unread

    var state = { items: [], status: 'idle', open: false, lastFetch: 0 };
    var freshIds = {};               // ids that were unread when the panel was opened (get a "new" dot)
    var seen = loadSeen();           // ISO time of the newest announcement the visitor has already opened
    var panel = null;
    var inflight = false;
    var pollTimer = null;

    function apiBase() {
        var cfg = window.RealotHubConfig || {};
        return String(cfg.feedbackApiUrl || '').replace(/\/+$/, '');
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
            if (Array.isArray(list)) state.items = list.filter(validItem).slice(0, 30);
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

    function refresh(force) {
        var base = apiBase();
        if (!base || inflight) return;
        if (!force && Date.now() - state.lastFetch < STALE_MS) return;
        inflight = true;
        if (state.items.length === 0) { state.status = 'loading'; if (state.open) renderPanel(); }

        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        var timer = setTimeout(function () { if (controller) controller.abort(); }, 12000);
        fetch(base + '/announcements?limit=30', { headers: { Accept: 'application/json' }, signal: controller ? controller.signal : undefined })
            .then(function (res) { if (!res.ok) throw new Error('status ' + res.status); return res.json(); })
            .then(function (data) {
                var list = data && Array.isArray(data.items) ? data.items.filter(validItem) : null;
                if (!list) throw new Error('bad data');
                state.items = list.slice(0, 30);
                state.status = 'ok';
                state.lastFetch = Date.now();
                storageSet(CACHE_KEY, JSON.stringify(state.items));
            })
            .catch(function () { state.status = 'error'; })
            .then(function () {
                clearTimeout(timer);
                inflight = false;
                if (state.open) {
                    // Anything that arrived while the panel is open counts as new, then counts as read.
                    state.items.forEach(function (m) { if (isNew(m)) freshIds[m.id] = true; });
                    renderPanel();
                    markSeen();
                }
                updateBadges();
            });
    }

    function init() {
        if (!apiBase()) return;
        loadCache();
        updateBadges();
        setTimeout(function () { refresh(true); }, 800);            // after the first paint
        if (!pollTimer) pollTimer = setInterval(function () { if (!document.hidden) refresh(true); }, POLL_MS);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(false); });
        window.addEventListener('online', function () { refresh(true); });
    }

    return { init: init, createBell: createBell, refresh: refresh };
})();
