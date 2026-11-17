/**
 * editor/state/SelectionLogic.js
 *
 * What clicking a Hierarchy row does to the selection, as plain functions so the
 * rules can be tested without a browser:
 *
 *   plain click        select just this object
 *   Ctrl/Cmd + click   add this object to the selection, or remove it if already in it
 *   Shift + click      select every row from the anchor to this row (the anchor is the
 *                      row last clicked without Shift), like a file manager
 *   Ctrl + Shift       same range, but added to what was already selected
 *
 * The "primary" object (selectedId) is the one the Inspector shows and the gizmo
 * works on: the most recently clicked row.
 */

/**
 * @param {{selectedId:?string, selectedIds:string[], anchorId:?string}} current
 * @param {string} id the clicked row
 * @param {{shift?:boolean, additive?:boolean}} keys additive = Ctrl or Cmd
 * @param {string[]} visibleIds ids of the rows currently shown, top to bottom
 * @returns {{selectedId:?string, selectedIds:string[], anchorId:?string}}
 */
export function applyHierarchyClick(current, id, keys, visibleIds) {
  const single = { selectedId: id, selectedIds: [id], anchorId: id };

  if (keys.shift) {
    const anchor = visibleIds.includes(current.anchorId)
      ? current.anchorId
      : visibleIds.includes(current.selectedId) ? current.selectedId : id;
    const from = visibleIds.indexOf(anchor);
    const to = visibleIds.indexOf(id);
    if (from < 0 || to < 0) return single;
    const range = visibleIds.slice(Math.min(from, to), Math.max(from, to) + 1);
    const kept = keys.additive ? current.selectedIds.filter((x) => !range.includes(x)) : [];
    return { selectedId: id, selectedIds: kept.concat(range), anchorId: anchor };
  }

  if (keys.additive) {
    const ids = current.selectedIds.slice();
    const at = ids.indexOf(id);
    if (at >= 0) {
      ids.splice(at, 1);
      return { selectedId: ids.length ? ids[ids.length - 1] : null, selectedIds: ids, anchorId: current.anchorId };
    }
    ids.push(id);
    return { selectedId: id, selectedIds: ids, anchorId: id };
  }

  return single;
}
