"""
End-to-end test of onHear(sound) / onLoseSound(sound) in the REAL editor and game (headless Chromium).

Serve the repo first, from the folder containing index.html:   python3 -m http.server 8001
Then run:                                                      python3 tests/e2e-hear-sound.py

It builds a Listener (Audio Listener, radius 300, plus a script) and a 3D Audio Source called "Siren", plays the
game, moves the Siren in range / out of range / in range again, destroys it while in range, and checks what the
script saw. The headless browser is slow (a few FPS), so everything is counted in frames, not seconds.
"""
import sys, json
from playwright.sync_api import sync_playwright
BASE = "http://127.0.0.1:8001"; res = []
def check(n, c, x=""):
    res.append(bool(c)); print(("PASS " if c else "FAIL ") + n + (("  -> " + str(x)[:170]) if x != "" else ""))

SCRIPT = """
var frame = 0;
function onHear(sound) {
  console.log("H_HEAR name=" + sound.name + " tag=" + sound.tag + " clip=" + sound.clip + " dist=" + Math.round(sound.distance) +
              " is=" + sound.is("siren") + " isTag=" + sound.is("Alarm") + " destroyed=" + sound.destroyed + " volume=" + sound.volume);
}
function onHearSound(sound) { console.log("H_HEARSOUND name=" + sound.name); }
function onLoseSound(sound) { console.log("H_LOSE name=" + sound.name + " destroyed=" + sound.destroyed + " is=" + sound.is("Siren") + " clip=" + sound.clip); }
function onLooseSound(sound) { console.log("H_LOOSE name=" + sound.name); }
function onUpdate() {
  frame++;
  var s = findFirst("Siren");
  if (frame == 10 && s) s.x = this.x + 60;     // comes into range
  if (frame == 30 && s) s.x = this.x + 5000;   // leaves range
  if (frame == 50 && s) s.x = this.x + 60;     // comes into range again
  if (frame == 70 && s) s.destroy();           // destroyed WHILE in range
  if (frame == 90) console.log("H_END");
}
"""

def logs(ed):
    return ed.evaluate("async()=>{const st=await import('/project/editor/state/EditorState.js'); return (st.editorState.logs||[]).map(l=>String(l.msg||''))}")

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"]); ctx = b.new_context(viewport={"width": 1500, "height": 950}, service_workers="block")
    pg = ctx.new_page(); pg.goto(BASE + "/index.html", wait_until="domcontentloaded", timeout=60000); pg.wait_for_timeout(1500)
    pg.click("text=New project"); pg.wait_for_timeout(500); pg.click('#modal-root .tpl-tile:has(.tpl-name:text-is("Physics Sandbox"))'); pg.wait_for_timeout(300)
    pg.click("button:has-text('Create project')"); pg.wait_for_timeout(5000)
    ed = ctx.pages[-1]; ed.wait_for_load_state("domcontentloaded"); errs = []; ed.on("pageerror", lambda e: errs.append(str(e)[:200]))
    ed.wait_for_selector("[data-action=toggle-play]", timeout=60000); ed.wait_for_timeout(2500)

    out = ed.evaluate("""async (script) => {
      const S = await import('/project/runtime/scene/SceneSerializer.js'), SS = await import('/project/editor/scripting/ScriptStorage.js');
      const Sync = await import('/project/editor/scripting/ScriptSync.js'), st = await import('/project/editor/state/EditorState.js');
      const world = st.editorState.world, o = {};
      const make = (name, tag, x, y, comps) => S.instantiateEntity(world, { name, tag, active: true, components: { Transform: { x, y }, ...comps } });
      const listener = make('Listener', '', 0, -2000, { AudioListener: { radius: 300 } });
      const siren = make('Siren', 'Alarm', 5000, -2000, { AudioSource: { audioKey: 'siren.mp3', is3D: true, autoplay: false, volume: 0.8 } });
      SS.saveScript('HearTest', script);
      listener.addComponent('Script', new S.COMPONENT_REGISTRY.Script({ scriptName: 'HearTest', source: script }));
      Sync.syncScriptSourcesInWorld(world);
      o.listener = listener.id; o.siren = siren.id; o.hasEar = !!listener.getComponent('AudioListener'); o.hasScript = !!listener.getComponent('Script');
      o.sirenIs3D = siren.getComponent('AudioSource').is3D;
      return o; }""", SCRIPT)
    print(json.dumps(out)[:600])
    check("entities and script were created", out.get("hasEar") and out.get("hasScript") and out.get("sirenIs3D"), out)

    # Play runs inside the editor (Game tab, an embedded frame); older builds opened a popup window instead.
    play = None
    ed.click('[data-action=toggle-play]')
    for _ in range(120):
        ed.wait_for_timeout(500)
        for pages in ([ed] + [pp for pp in ctx.pages if pp is not ed]):
            for fr in pages.frames:
                try:
                    if fr.evaluate("() => !!window.__realotGame"): play = fr; break
                except Exception: pass
            if play: break
        if play: break
    check("the game started", play is not None)
    if play:
        for _ in range(80):
            ed.wait_for_timeout(500)
            if any("H_END" in l for l in logs(ed)): break
        L = [l for l in logs(ed) if l.startswith("H_")]
        for l in L: print("   log:", l)
        hear = [l for l in L if l.startswith("H_HEAR ")]; hs = [l for l in L if l.startswith("H_HEARSOUND")]
        lose = [l for l in L if l.startswith("H_LOSE ")]; loose = [l for l in L if l.startswith("H_LOOSE")]
        check("onHear fired twice (entered range twice)", len(hear) == 2, len(hear))
        check("onHear: sound.name is the object name", all("name=Siren" in l for l in hear) and hear, hear[:1])
        check("onHear: sound.tag / sound.clip / sound.volume", hear and "tag=Alarm" in hear[0] and "clip=siren.mp3" in hear[0] and "volume=0.8" in hear[0], hear[:1])
        check("onHear: sound.distance is inside the 300 radius", hear and 0 < int(hear[0].split("dist=")[1].split()[0]) <= 300, hear[:1])
        check("onHear: sound.is() works for name and tag, destroyed is false", hear and "is=true" in hear[0] and "isTag=true" in hear[0] and "destroyed=false" in hear[0], hear[:1])
        check("onHearSound (original name) fires too", len(hs) == 2, len(hs))
        check("onLoseSound fired twice (left range, then destroyed in range)", len(lose) == 2, len(lose))
        check("onLoseSound after leaving range: normal sound", lose and "name=Siren" in lose[0] and "destroyed=false" in lose[0], lose[:1])
        check("onLoseSound after destroy(): still has name/clip, destroyed=true", len(lose) == 2 and "name=Siren" in lose[1] and "destroyed=true" in lose[1] and "is=true" in lose[1] and "clip=siren.mp3" in lose[1], lose[1:])
        check("onLooseSound (misspelling) fires as well", len(loose) == 2, len(loose))
        check("the game kept running to the end", any(l == "H_END" for l in L))
        ed.click('[data-action=toggle-play]')
    check("no uncaught page errors", not errs, errs[:2])
    b.close()
print("\n%d/%d passed" % (sum(res), len(res))); sys.exit(0 if all(res) else 1)
