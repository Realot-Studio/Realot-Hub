/**
 * editor/panels/InspectorMulti.js
 *
 * The Inspector when MORE THAN ONE object is selected (Unity-style multi-edit).
 *
 * WHAT THE USER SEES
 *  - Only components that EVERY selected object has are shown.
 *  - A field whose value is the same on all of them shows that value; a field
 *    that differs shows a dash ("-").
 *  - Changing a field sets it on every selected object (see
 *    applyFieldChangeToSelection in EditorEvents.js).
 *
 * HOW IT WORKS
 * The Inspector panel already knows how to draw ONE object (renderEntityInspector
 * in Inspector.js) and every editable control it draws carries a data-field
 * attribute. So instead of teaching all 2000 lines of it about multi-select,
 * this module draws the Inspector for each selected object, compares the
 * controls that have the same data-field, and rewrites the primary object's HTML:
 * unshared sections are dropped, differing controls are marked as "mixed",
 * and controls that act on a single object (rename, add/remove component...) are
 * removed. It works on plain HTML text with no DOM, so it can be tested on its own.
 *
 * EDITOR-ONLY FILE.
 */

const DASH = "&#8212;";

/** Components whose editors are built around single-object actions (script
 *  variables, animation clips, tile painting, nav baking). They are not offered
 *  for multi-edit; select one object to edit them. */
export const MULTI_EXCLUDED_SECTIONS = new Set([
  "script",
  "spriteanimation",
  "tileset",
  "tilemap",
  "navworld2d",
  "navagent2d",
]);

/** Beyond this many selected objects, values are not compared (it would make every
 *  click in the editor slow); the first object's values are shown instead. */
export const MULTI_COMPARE_LIMIT = 200;

/* ---------------- small HTML helpers ---------------- */

/** Index just after the </div> that closes the <div> starting at `start`. */
function closeOfDiv(html, start) {
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m[0] === "</div>") {
      depth--;
      if (depth === 0) return m.index + 6;
    } else {
      depth++;
    }
  }
  return html.length;
}

/** Every component section in the HTML: { key, start, end }. */
function sectionRanges(html) {
  const out = [];
  const re = /<div class="section" data-section-key="([^"]+)">/g;
  let m;
  while ((m = re.exec(html))) {
    const end = closeOfDiv(html, m.index);
    out.push({ key: m[1], start: m.index, end });
    re.lastIndex = end;
  }
  return out;
}

function attr(tag, name) {
  const m = new RegExp("(?:^|\\s)" + name + '="([^"]*)"').exec(tag);
  return m ? m[1] : null;
}

const hasChecked = (tag) => /\schecked(?=[\s/>=])/.test(tag);

// One pass finds both kinds of editable control: <select data-field=...>...</select> and <input data-field=...>.
const FIELD_RE =
  /<select\b([^>]*?)\bdata-field="([^"]+)"([^>]*)>([\s\S]*?)<\/select>|<input\b([^>]*?)\bdata-field="([^"]+)"([^>]*)>/g;

/** A short string that changes whenever the control's value changes. */
function signatureOfMatch(m) {
  if (m[2] !== undefined) {
    // select: the selected option's value (or the first option's, like the browser)
    const options = m[4].match(/<option\b[^>]*>/g) || [];
    const picked = options.find((o) => /\sselected(?=[\s>=])/.test(o)) || options[0] || "";
    return "select:" + (attr(picked, "value") || "");
  }
  const tag = m[5] + " " + m[7];
  const type = attr(tag, "type") || "text";
  if (type === "checkbox") return "checkbox:" + (hasChecked(tag) ? "1" : "0");
  return type + ":" + (attr(tag, "value") || "");
}

/** Map of "field|axis#n" -> signature for every editable control in the HTML. */
function fieldSignatures(html) {
  const sigs = new Map();
  const counts = {};
  FIELD_RE.lastIndex = 0;
  let m;
  while ((m = FIELD_RE.exec(html))) {
    const field = m[2] !== undefined ? m[2] : m[6];
    const tag = m[2] !== undefined ? m[1] + " " + m[3] : m[5] + " " + m[7];
    const base = field + "|" + (attr(tag, "data-axis") || "");
    counts[base] = (counts[base] || 0) + 1;
    sigs.set(base + "#" + counts[base], signatureOfMatch(m));
  }
  return sigs;
}

function addClass(tag, cls) {
  if (/\sclass="/.test(tag)) return tag.replace(/\sclass="([^"]*)"/, (_, c) => ' class="' + c + " " + cls + '"');
  return tag.replace(/^<(input|select)/, '<$1 class="' + cls + '"');
}

/** Rewrites the primary HTML so every control in `mixedKeys` shows as "different values". */
function markMixed(html, mixedKeys) {
  const counts = {};
  FIELD_RE.lastIndex = 0;
  return html.replace(FIELD_RE, (whole, sA, fieldA, sB, content, iA, fieldI, iB) => {
    const isSelect = fieldA !== undefined;
    const field = isSelect ? fieldA : fieldI;
    const tagAttrs = isSelect ? sA + " " + sB : iA + " " + iB;
    const base = field + "|" + (attr(tagAttrs, "data-axis") || "");
    counts[base] = (counts[base] || 0) + 1;
    if (!mixedKeys.has(base + "#" + counts[base])) return whole;

    if (isSelect) {
      const open = whole.slice(0, whole.indexOf(">") + 1);
      const cleaned = content.replace(/\sselected(?=[\s>=])/g, "");
      const newOpen = addClass(open, "mixed").replace(/>$/, ' data-mixed="1">');
      return newOpen + '<option value="" selected disabled hidden>' + DASH + "</option>" + cleaned + "</select>";
    }
    let tag = whole;
    const type = attr(tagAttrs, "type") || "text";
    if (type === "checkbox") {
      tag = tag.replace(/\schecked(?=[\s/>=])/, "");
    } else {
      tag = tag.replace(/\svalue="[^"]*"/, ' value=""');
      tag = tag.replace(/\s*(\/?)>$/, ' placeholder="' + DASH + '"$1>');
    }
    tag = addClass(tag, "mixed");
    return tag.replace(/\s*(\/?)>$/, ' data-mixed="1"$1>');
  });
}

const removeAll = (html, re) => html.replace(re, "");

/** Removes a <div> (and everything inside it) that starts with the given opening text. */
function removeDivStartingWith(html, opening) {
  let out = html;
  let at;
  while ((at = out.indexOf(opening)) !== -1) {
    out = out.slice(0, at) + out.slice(closeOfDiv(out, at));
  }
  return out;
}

/**
 * Builds the Inspector HTML for a multi-selection.
 *
 * @param {Array<{active:boolean}>} entities all selected objects (the primary included)
 * @param {object} primary the primary selected object (the one the Inspector normally shows)
 * @param {(entity:object)=>string} renderOne draws the normal single-object Inspector
 * @returns {string}
 */
export function buildMultiInspectorHtml(entities, primary, renderOne) {
  const count = entities.length;
  let html = renderOne(primary);
  const compare = count <= MULTI_COMPARE_LIMIT;
  const others = compare ? entities.filter((e) => e !== primary).map(renderOne) : [];

  // 1) Keep only the sections that every selected object has.
  const keysOf = (h) => new Set(sectionRanges(h).map((r) => r.key));
  const common = keysOf(html);
  for (const other of others) {
    const k = keysOf(other);
    for (const key of [...common]) if (!k.has(key)) common.delete(key);
  }
  const ranges = sectionRanges(html);
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i];
    if (!common.has(r.key) || MULTI_EXCLUDED_SECTIONS.has(r.key)) html = html.slice(0, r.start) + html.slice(r.end);
  }

  // 2) Mark every control whose value differs between the selected objects.
  if (compare && others.length) {
    const mine = fieldSignatures(html);
    const theirs = others.map(fieldSignatures);
    const mixed = new Set();
    for (const [key, sig] of mine) {
      if (theirs.some((t) => t.get(key) !== sig)) mixed.add(key);
    }
    if (mixed.size) html = markMixed(html, mixed);
  }

  // 3) Take out everything that only makes sense for ONE object.
  html = removeAll(html, /<button[^>]*data-action="remove-component"[^>]*>[\s\S]*?<\/button>/g);
  html = removeAll(html, /<button[^>]*data-action="create-prefab"[^>]*>[\s\S]*?<\/button>/g);
  html = removeAll(html, /<button[^>]*data-action="delete-tag"[^>]*>[\s\S]*?<\/button>/g);
  html = removeAll(html, /<div class="addcomp-wrap">[\s\S]*?<\/button><\/div>/g);
  html = removeAll(html, /<div class="animwin-wrap">[\s\S]*?<\/button><\/div>/g);
  html = removeDivStartingWith(html, '<div class="prefab-strip">');
  html = html.replace(
    /<input type="text" class="obj-name-input"[^>]*\/>/,
    '<div class="obj-name-input multi-name">' + count + " objects</div>"
  );

  // The "active" checkbox: one state for all, or "mixed" when they differ.
  const activeCount = entities.filter((e) => e.active).length;
  if (activeCount !== 0 && activeCount !== count) {
    html = html.replace(
      /<input type="checkbox"(?: checked)? data-action="toggle-entity-active" \/>/,
      '<input type="checkbox" class="mixed" data-mixed="1" data-action="toggle-entity-active" />'
    );
  }

  // 4) A short explanation at the top.
  const note =
    '<div class="multi-edit-note"><b>' + count + " objects selected</b>" +
    "<span>Only components shared by all of them are shown. A dash means the values differ. " +
    "Changing a value changes it on every selected object." +
    (compare ? "" : " (Too many objects to compare: showing the first one's values.)") +
    "</span></div>";
  html = html.replace('<div class="inspector-body">', '<div class="inspector-body">' + note);
  return html;
}

/**
 * Call after the Inspector HTML is in the page: a "mixed" checkbox is drawn
 * half-checked, which HTML can only do from script.
 * @param {ParentNode} root
 */
export function applyMixedIndicators(root) {
  const scope = root || document;
  const boxes = scope.querySelectorAll('input[type="checkbox"][data-mixed="1"]');
  for (let i = 0; i < boxes.length; i++) boxes[i].indeterminate = true;
}
