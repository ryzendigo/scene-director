# Publishing checklist — remaining manual steps

Everything automatable is done: repo description + topics set, v0.9.0 and ChatSlim
v0.1.2 tagged and released, announcement drafts current. What's left needs a human:

## 0. Release smoke test — every release, no exceptions

Run against a throwaway SillyTavern (the `st-demo` container: ST 1.18, no auth,
demo character only) with the release candidate installed in
`data/default-user/extensions/scene-director/`. Every item below must pass:

- [ ] **No private names in the tree you are about to tag.** A clean working
      `index.js` is not enough: a tag points at a commit, and a commit can carry
      names an earlier one introduced. v0.9.8 was tagged this way by mistake.

      ```bash
      git grep -inE 'granty|martha|kelmscott|\brachel\b' HEAD -- index.js README.md
      ```

      Must print nothing. Check string and regex literals, not just comments:
      a name inside an alternation (the `QUAL` garment list once hardcoded two
      real people) is easy to miss when skimming.
- [ ] **All six engine suites pass.** They lift the pure engine blocks straight
      out of `index.js`, so they test what ships, and they run in milliseconds
      with no container. Run these FIRST — a failure here is quicker to read
      than any browser driver:

      ```bash
      for t in wardrobe-harness mood-cases presence-cases pose-cases background-cases atlas-cases; do
        printf '%-20s ' "$t"; node tools/$t.mjs | tail -1
      done
      ```

      Expected: wardrobe 36, mood 26, presence 16, pose 13, background 11,
      atlas 10 — 112 cases, all pass. Several assert deliberate NON-detections (a mention
      inside someone else's speech, a negated garment, a dog on all fours, a
      room named by too few nouns). A change that makes an engine fire more
      eagerly shows up here as a failure, which is the point.
- [ ] `node tools/demo/shot.js stage` — console shows `Activating extension
      third-party/scene-director`, no `[scene-director]` errors, `chips > 0`.
- [ ] `node tools/demo/persist.js` — both lines print **PASS** (a ticked box
      survives a reload without Apply; Apply with a broken regex elsewhere
      still saves the box).
- [ ] `node tools/demo/apply.js` — no `PAGEERROR`, Apply status is not blank,
      both checks print **PASS**.
- [ ] `node tools/demo/atlas.js` — seeds two past days plus today into chat
      metadata, clicks the HUD, reads the modal back and checks it closes. Must
      print **ATLAS PASS**. This is the one that catches what the pure suite
      cannot: 0.9.15 shipped with the click handler bound in a function that
      only runs on a message render, so the HUD was dead until the next message.
      Note the keys are `scene_director` with an UNDERSCORE, in both
      `chatMetadata` and `extensionSettings` — guessing the hyphenated name
      makes the driver report a failure that is its own.
- [ ] `node tools/demo/errcheck.js` — toggles every checkbox twice and clicks the
      scan/self-test buttons; must report **no `PAGEERROR`** and no JS exceptions.
      Expected-and-harmless: 404s for `backgrounds/animated.json`,
      `npc/animated.json` and any `npc/<key>-<mood>.png` a character does not
      have — these are optional files, fetched with an `r.ok` guard.

- [ ] **Install-from-URL and Update through ST's own API** (the demo's copy is a git
      install now, so this is testable): with a session cookie jar and the `/csrf-token`,
      `POST /api/extensions/update {"extensionName":"scene-director","global":false}` must
      return 200 with `isUpToDate`, and on a clean folder
      `POST /api/extensions/install {"url":"https://github.com/ryzendigo/scene-director","global":false}`
      must return 200 with the new version. Without the cookie every call is `Forbidden`.
      Known: a manually copied folder gives Update **500** and Install **409** — that is
      SillyTavern, not us; the README tells users to install from URL.

Demo container: if it is missing, recreate with
`docker run -d --name st-demo --network host -e SILLYTAVERN_SECURITYOVERRIDE=true -v /mnt/pool/config/st-demo/data:/home/node/app/data -v /mnt/pool/config/st-demo/config:/home/node/app/config ghcr.io/sillytavern/sillytavern:1.18.0`
— its `config/config.yaml` must have `port: 8327`, `listen: true`,
`whitelistMode: false`, or it collides with the real instance on 8000 and exits.

Why this exists: 0.8.7–0.9.3 shipped with an Apply button that threw on every
click (a JSON box with no validator) and saved nothing, with a blank status.
The stage screenshot passed on all seven. Loading is not the test; saving is.

Driver invocation (Playwright in Docker, host network, from the st-demo dir):
`docker run --rm --network host -v $PWD/<script>:/w/<script>:ro mcr.microsoft.com/playwright:v1.55.0-noble sh -c 'cd /w && npm i -s playwright@1.55.0 >/dev/null 2>&1; node <script>'`

## 1. Take the three screenshots (blocks everything else)

Use a **starter-pack or generic chat**, not your own story (no private names,
faces or text in anything public). In SillyTavern with Scene Director active:

- [x] **Cards in the drawer** — Extensions → Scene Director showing a few Cast
      and Place cards. Save as `docs/screenshot-cards.png`.
- [x] **Scan wizard** — the 🔍 Scan my chat results with proposed cards. Save as
      `docs/screenshot-scan-wizard.png`.
- [x] **Stage in action** — a message with a scene header, HUD visible, 2–3 chips
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

## 4. Candidate port: the story atlas (assessed 23 Sep 2026, not started)

The private sibling extension has an **atlas**: it records the places visited on
each in-story date and shows them in a modal from the scene HUD. It is generic —
the data model is just `{dateKey: [locations]}` persisted in chat metadata — and
would be a real addition here, where the trail currently lives only in a
tooltip.

Sized before starting, so it is not begun blind:

- **7 functions, ~154 lines**: `atlasKey`, `loadAtlas`, `persistAtlas`,
  `prettyAtlasDate`, `rebuildAtlasFromMessages`, `restoreTrailFromAtlas`,
  `toggleAtlasModal`.
- **4 missing dependencies** this repo would need first: `injectStyles`,
  `extractDate`, `sortableDateKey`, `currentChatId`.
- Plus a CSS block for the modal and a click handler on the HUD.
- Realistically ~250 lines, not a drop-in.

**The one thing to be careful about.** The atlas code carries ~10 references
matching the author's story, but on inspection they are almost entirely DOM ids
namespaced `rachel-atlas-*`, not story data — rename the prefix and they go.
That still has to be checked line by line rather than assumed: this repo must
never carry another person's characters or places. Scan the result with

```bash
grep -icE 'rachel|martha|joseph|kelmscott|granty|heidi|rufus|virginia|armadale' index.js README.md
```

which must print 0 before anything is committed.
