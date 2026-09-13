# Publishing checklist — remaining manual steps

Everything automatable is done: repo description + topics set, v0.9.0 and ChatSlim
v0.1.2 tagged and released, announcement drafts current. What's left needs a human:

## 1. Take the three screenshots (blocks everything else)

Use a **starter-pack or generic chat**, not your own story (no private names,
faces or text in anything public). In SillyTavern with Scene Director active:

- [ ] **Cards in the drawer** — Extensions → Scene Director showing a few Cast
      and Place cards. Save as `docs/screenshot-cards.png`.
- [ ] **Scan wizard** — the 🔍 Scan my chat results with proposed cards. Save as
      `docs/screenshot-scan-wizard.png`.
- [ ] **Stage in action** — a message with a scene header, HUD visible, 2–3 chips
      bottom-left. Save as `docs/screenshot-cast-strip.png`.

Crop tight, PNG, roughly 1200 px wide. The README already references exactly
those paths (README line ~90), so:

```bash
cd ~/scene-director
git add docs/screenshot-cards.png docs/screenshot-scan-wizard.png docs/screenshot-cast-strip.png
git commit -m "Add screenshots"
git push
```

Then delete the "Screenshot placeholders" blockquote line from README.md (keep
the three images), commit, push.

## 2. Post the announcements

Texts are in [ANNOUNCEMENT.md](ANNOUNCEMENT.md) — paste as-is, but attach/embed
the two screenshots (Discord: drag the PNGs into the message; Reddit: image links
or a gallery).

- [ ] SillyTavern Discord → **#extensions** (draft 1). Also drop a line in
      **#showcase** with just the stage screenshot if that channel exists.
- [ ] r/SillyTavernAI (draft 2). Pick the extension/release flair that's current;
      if mods route releases to the weekly megathread, post there instead.
- [ ] ChatSlim on its own (draft 3) a few days later so it isn't buried.
- [ ] GitHub: both repos already carry the `sillytavern-extension` topic, which
      is how people browse extensions on GitHub itself.

## 3. (Optional, later) Submit to the SillyTavern-Content index

Only once screenshots are in — rule 3 below requires good documentation, and an
un-illustrated README for a visual extension is a weak submission. Procedure
verified against https://github.com/SillyTavern/SillyTavern-Content (2026-09-10):

**Their requirements** (Scene Director meets all four):
1. Open-source, libre license (MIT ✓)
2. Compatible with the latest ST release — be prepared to update if core changes
3. Well-documented README with install instructions, usage examples, feature list ✓
4. Must NOT require a server plugin ✓ (pure UI extension)

They also ask that you [get in contact](https://github.com/SillyTavern/SillyTavern#questions-or-suggestions)
with the team — practically, mentioning it in the Discord #extensions post
covers this.

**The five-minute PR:**

```bash
gh repo fork SillyTavern/SillyTavern-Content --clone ~/SillyTavern-Content
cd ~/SillyTavern-Content
```

Append this record at the **end** of `extensions.json` (no `"tool"` field — that
flag is only for extensions providing function tools, which this isn't):

```json
{
    "id": "scene-director",
    "type": "extension",
    "name": "Scene Director",
    "description": "Scene-header-driven auto backgrounds, costumes, seasonal variants and a speaking-cast strip.",
    "url": "https://github.com/ryzendigo/scene-director"
}
```

Then regenerate the index and open the PR:

```bash
python3 generate_index_json.py
git checkout -b add-scene-director
git add extensions.json index.json
git commit -m "Add Scene Director extension"
git push -u origin add-scene-director
gh pr create --repo SillyTavern/SillyTavern-Content --base main \
  --title "Add Scene Director extension" \
  --body "Adds Scene Director (https://github.com/ryzendigo/scene-director): scene-header-driven auto backgrounds, costumes, seasonal/era variants and a speaking-cast strip. MIT, pure UI extension (no server plugin), README with install + usage docs and screenshots."
```

`id` = the folder name ST will clone into, so it must stay `scene-director`
(matches the repo name).
