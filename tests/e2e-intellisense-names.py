"""
End-to-end test of the "don't make me guess" autocomplete in the REAL script editor (Monaco, headless Chromium).

Serve the repo first, from the folder containing index.html:   python3 -m http.server 8001
Then run:                                                      python3 tests/e2e-intellisense-names.py
"""
import sys, json
from playwright.sync_api import sync_playwright
BASE = "http://127.0.0.1:8001"; res = []
def check(n, c, x=""):
    res.append(bool(c)); print(("PASS " if c else "FAIL ") + n + (("  -> " + str(x)[:200]) if x != "" else ""))

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"]); ctx = b.new_context(viewport={"width": 1500, "height": 950}, service_workers="block")
    pg = ctx.new_page(); pg.goto(BASE + "/index.html", wait_until="domcontentloaded", timeout=60000); pg.wait_for_timeout(1500)
    pg.click("text=New project"); pg.wait_for_timeout(500); pg.click('#modal-root .tpl-tile:has(.tpl-name:text-is("Physics Sandbox"))'); pg.wait_for_timeout(300)
    pg.click("button:has-text('Create project')"); pg.wait_for_timeout(5000)
    ed = ctx.pages[-1]; ed.wait_for_load_state("domcontentloaded"); errs = []; ed.on("pageerror", lambda e: errs.append(str(e)[:200]))
    ed.wait_for_selector("[data-action=toggle-play]", timeout=60000); ed.wait_for_timeout(2500)

    # project content the completions should discover
    ed.evaluate("""async () => {
      const S = await import('/project/runtime/scene/SceneSerializer.js'), SS = await import('/project/editor/scripting/ScriptStorage.js');
      const st = await import('/project/editor/state/EditorState.js'), PL = await import('/project/editor/state/PhysicsLayers.js');
      const w = st.editorState.world;
      S.instantiateEntity(w, { name: 'Siren', tag: 'Alarm', active: true, components: { Transform: { x: 0, y: 0 } } });
      SS.saveScript('Helpers', 'function onStart() {\\n  global.score = 1;\\n  global["lives"] = 3;\\n  var bullets = pool.create("Bullet", {});\\n}');
      PL.setLayerName(1, 'Player');
    }""")

    # an Audio Listener object with a script: the hearing snippets are only offered on such an object
    lid = ed.evaluate("""async () => {
      const S = await import('/project/runtime/scene/SceneSerializer.js'), SS = await import('/project/editor/scripting/ScriptStorage.js');
      const st = await import('/project/editor/state/EditorState.js');
      SS.saveScript('ListenerScript', 'function onStart() {}');
      const l = S.instantiateEntity(st.editorState.world, { name: 'Listener', active: true, components: { Transform: { x: 0, y: 0 }, AudioListener: { radius: 300 } } });
      l.addComponent('Script', new S.COMPONENT_REGISTRY.Script({ scriptName: 'ListenerScript', source: 'function onStart() {}' }));
      st.editorState.renderFn && st.editorState.renderFn();
      return l.id; }""")
    ed.wait_for_timeout(600); opened = False
    ed.evaluate("(id)=>document.querySelector('[data-action=select-entity][data-id=\"'+id+'\"]')?.click()", lid); ed.wait_for_timeout(600)
    if ed.evaluate("!!document.querySelector('[data-action=open-script-editor]')"):
        ed.evaluate("document.querySelector('[data-action=open-script-editor]').click()"); opened = True
    check("opened the script editor", opened)
    ed.wait_for_selector(".monaco-editor", timeout=60000); ed.wait_for_timeout(2500)

    def suggest(text):
        ed.evaluate("""(t) => { const e = window.monaco.editor.getEditors()[0]; e.focus(); e.setValue(t); const m = e.getModel(); const l = m.getLineCount();
            e.setPosition({ lineNumber: l, column: m.getLineMaxColumn(l) }); e.trigger('t', 'editor.action.triggerSuggest', {}); }""", text)
        ed.wait_for_timeout(1600)
        labels = ed.evaluate("[...document.querySelectorAll('.suggest-widget .monaco-list-row')].map(r=>(r.getAttribute('aria-label')||r.innerText).replace(/\\s+/g,' ').trim())")
        ed.keyboard.press("Escape"); ed.wait_for_timeout(150)
        return labels
    has = lambda labels, *names: all(any(l.startswith(n) for l in labels) for n in names)

    # The suggestion list only renders its visible rows, so each check types a short prefix to bring the name into view.
    for prefix, want in [("na", "name"), ("ta", "tag"), ("cl", "clip"), ("dis", "distance"), ("is", "is(")]:
        L = suggest('function onHear(noise) {\n  noise.' + prefix)
        check("onHear(noise): 'noise." + prefix + "' offers " + want + " (any parameter name)", has(L, want), L[:6])
    L = suggest('function onHear(sound) {\n  if (sound.is("Sir')
    check('sound.is("Sir offers the scene object Siren', has(L, "Siren"), L[:6])
    L = suggest('function onHear(sound) {\n  if (sound.is("Ala')
    check('sound.is("Ala offers the TAG Alarm', has(L, "Alarm"), L[:6])
    L = suggest('function onLoseSound(sound) {\n  if (sound.name == "Sir')
    check('sound.name == "Sir offers the scene object Siren', has(L, "Siren"), L[:6])
    L = suggest('function onStart() {\n  this.speed = 5;\n  this.hp = 3;\n}\nfunction onUpdate() {\n  this.sp')
    check("this.sp offers your own variable speed", has(L, "speed"), L[:8])
    L = suggest('function onStart() {\n  this.speed = 5;\n  this.hp = 3;\n}\nfunction onUpdate() {\n  this.h')
    check("this.h offers your own variable hp", has(L, "hp"), L[:8])
    L = suggest('global.')
    check("global. lists names used anywhere in the project (score, lives)", has(L, "score", "lives"), L[:8])
    L = suggest('var x = global["')
    check('global[" lists the same names', has(L, "score", "lives"), L[:8])
    L = suggest('var b = pool.get("')
    check('pool.get(" lists pools created with pool.create (Bullet)', has(L, "Bullet"), L[:8])
    L = suggest('function helperThing() {}\nvar mySpeed = 3;\nfunction onUpdate() {\n  help')
    check("typing 'help' still offers your own function helperThing", has(L, "helperThing"), L[:8])
    L = suggest('function helperThing() {}\nvar mySpeed = 3;\nfunction onUpdate() {\n  mySp')
    check("typing 'mySp' still offers your own variable mySpeed", has(L, "mySpeed"), L[:8])
    L = suggest('physics.layer(')
    check("physics.layer( lists named layers as numbers (1 - Player)", any(("Player" in l and l.startswith("1")) for l in L), L[:8])
    L = suggest('function onHea')
    check("'function onHea' offers the onHear(sound) snippet", any("onHear(sound)" in l for l in L), L[:6])
    L = suggest('function onLoseS')
    check("'function onLoseS' offers the onLoseSound(sound) snippet", any("onLoseSound(sound)" in l for l in L), L[:6])

    # highlighting: engine words in a hearing script get colour classes
    ed.evaluate("""()=>{const e=window.monaco.editor.getEditors()[0]; e.setValue('function onHear(sound) {\\n  if (sound.distance < 5) {}\\n}\\nfunction onLooseSound(sound) {}');}""")
    ed.wait_for_timeout(1200)
    deco = ed.evaluate("""()=>{const e=window.monaco.editor.getEditors()[0]; const m=e.getModel(); return m.getAllDecorations().filter(d=>d.options.inlineClassName).map(d=>[m.getValueInRange(d.range), d.options.inlineClassName])}""")
    print("   decorations:", json.dumps(deco)[:400])
    words = {w for w, c in deco}
    check("highlighting: onHear and onLooseSound are coloured as engine callbacks", {"onHear", "onLooseSound"} <= words, sorted(words))
    check("highlighting: sound.distance member is coloured", "distance" in words, sorted(words))
    check("no uncaught page errors", not errs, errs[:2])
    b.close()
print("\n%d/%d passed" % (sum(res), len(res))); sys.exit(0 if all(res) else 1)
