/**
 * LearnView.js
 * Documentation entry point. The engine documentation lives on its own site;
 * the hub only links to it (it is not bundled, so it is never out of date).
 */
const DOCS_URL = "https://realot-studio-documentation.pages.dev/";

window.RealotLearnView = {
    render() {
        const { el } = window.RealotDom;

        const card = (href, icon, label, desc) =>
            el('a', { class: 'learn-card', href, target: '_blank', rel: 'noopener' }, [
                el('div', { class: 'learn-icon' }, [el('span', { html: `<svg data-lucide="${icon}"></svg>` })]),
                el('div', {}, [
                    el('div', { class: 'learn-title' }, [label]),
                    el('div', { class: 'learn-desc' }, [desc])
                ])
            ]);

        return el('div', { class: 'section' }, [
            el('div', { class: 'section-head' }, [el('div', { class: 'section-title' }, ['Documentation'])]),
            el('div', { class: 'learn-grid' }, [
                card(DOCS_URL, 'book-open', 'Engine documentation', 'Guides, components and the full scripting API on the documentation site.')
            ])
        ]);
    }
};
