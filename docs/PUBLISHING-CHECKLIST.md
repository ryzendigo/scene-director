# Publishing checklist — remaining manual steps

Everything automatable is done: repo description + topics set, v0.1.0 tagged and
released, announcement drafts written. What's left needs a human:

## 1. Take the two screenshots (blocks everything else)

In your own SillyTavern with Scene Director active:

- [ ] **Cast strip in action** — a chat message with a scene header where 2–3 NPC
      chips are visible bottom-left. Save as `docs/screenshot-cast-strip.png`.
- [ ] **Settings drawer** — Extensions → Scene Director, scrolled to show the
      toggles plus one populated JSON map (ideally with the "Test last message"
      result visible). Save as `docs/screenshot-settings.png`.

Crop tight, PNG, roughly 1200 px wide is plenty. The README already references
exactly those two paths, so:

```bash
cd ~/scene-director
git add docs/screenshot-cast-strip.png docs/screenshot-settings.png
git commit -m "Add screenshots"
git push
```

Then delete the "Screenshot placeholders" blockquote line from README.md (keep
the two images), commit, push.

## 2. Post the announcements

Texts are in [ANNOUNCEMENT.md](ANNOUNCEMENT.md) — paste as-is, but attach/embed
the two screenshots (Discord: drag the PNGs into the message; Reddit: image links
or a gallery).

- [ ] SillyTavern Discord → **#extensions** (short version)
- [ ] r/SillyTavernAI (long version; flair it "Discussion" or whatever
      extension-release flair is current)

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
