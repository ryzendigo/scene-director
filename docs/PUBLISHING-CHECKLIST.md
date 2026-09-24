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
- [ ] **Every case suite passes.** They lift the pure code straight out of
      `index.js` — the six `=== X ENGINE (pure) ===` blocks, plus the module-level
      helpers no engine suite can reach — so they test what ships, and they run
      in milliseconds with no container. Run these FIRST: a failure here is
      quicker to read than any browser driver.

      ```bash
      for t in tools/*-cases.mjs tools/wardrobe-harness.mjs; do
        printf '%-26s ' "$(basename $t)"; node "$t" | tail -1
      done
      ```

      Discover them rather than listing them: a hand-written list goes stale and
      silently stops running whatever was added since. Do NOT hard-code the
      expected counts here either — they changed on every release for thirteen
      releases straight, and a stale number is worse than none because it makes
      a real regression look like an out-of-date document. Every suite must
      print "all N pass" and exit 0; that is the check.

      Many cases assert deliberate NON-detections: a mention inside someone
      else's speech, a negated garment, a dog on all fours, a room named by too
      few nouns. A change that makes an engine fire more eagerly shows up here
      as a failure, which is the point.
- [ ] **The standalone checks pass**, none of which is a case suite:

      ```bash
   Every suite and the wardrobe harness accept --src=<file>, so they can be run
   against the private build or against a deliberately broken copy to check the
   suite actually fails (a suite that passes on a mutant is not testing anything):

      node tools/mood-cases.mjs --src=../docs/rachel-images/rachel-autobg-index.js
      node tools/rollover-cases.mjs     # the day-rollover cleanup, caller-side and so
                                        # invisible to the engine harness
      node tools/hysteresis-cases.mjs   # the second background filter in onMessage
      node tools/replay-cases.mjs       # replay.mjs stays faithful to onMessage

   A full mutation sweep (slow, a few minutes) sabotages every engine function in
   turn and reports any that NO suite reacts to. SURVIVED must stay at zero; the
   "only crashed" list is a weak signal, not a coverage hole:

      node tools/mutation.mjs

      node tools/regex-safety.mjs && node tools/settings-repair.mjs \
        && node tools/timer-tracking.mjs && node tools/chat-gen-guard.mjs \
        && node tools/settings-fuzz.mjs && node tools/text-fuzz.mjs \
        && node tools/duplicate-decls.mjs && node tools/pattern-drift.mjs \
        && node tools/pack-reachable.mjs \
        && node tools/dead-settings.mjs \
        && node tools/import-typecheck.mjs \
        && node tools/prefetch-cases.mjs \
        && node tools/global-style-restore.mjs

   `global-style-restore.mjs` runs against both builds too. It catches a write to
   `documentElement.style` / `body.style` with no matching restore — a document-wide
   property outlives the feature that set it.

   `prefetch-cases.mjs` runs against BOTH builds (it takes the tracked-timer helper
   name from the lifted body, since the public build calls it `sdTimeout` and the
   private one `rTimeout`):

      node tools/prefetch-cases.mjs ~/docs/rachel-images/rachel-autobg-index.js

   `tools/demo/numfields.js` runs in the Playwright image (it needs a real browser —
   the question is what `<input type="number">.value` returns for typed input, and
   guessing that got the fix wrong twice). Run it alongside the other demo drivers.

   `import-typecheck.mjs` lifts the Import button's type guard and checks it against
   every default/value shape. Import bypasses all validators, so that guard is its
   only defence; it shipped accepting `null` for object-valued keys because
   `typeof null === 'object'`. The private build has no import/export at all.

   `dead-settings.mjs` is public-only (the private build has no `defaultSettings`
   literal and it exits 2 there). It catches a settings key the panel exposes with
   nothing reading it — `moodKeywords` and `presenceCueRegex` both shipped that way
   after the rewrites that removed their readers.

   Then, against whatever chat .jsonl files are to hand (the cap is justified by
   real prose, so it has to be rechecked against real prose):

      node tools/cap-equivalence.mjs <chat.jsonl> [more.jsonl ...]
      ```

      The first confirms a pasted regex that backtracks exponentially is
      rejected while every regex the extension ships still compiles. The second
      confirms a corrupted settings object is repaired rather than left to throw
      on the 24 call sites that read `cast` and `places`.
- [ ] **If another build of the extension shares the engine blocks, check it has
      not drifted:**

      ```bash
      node tools/engine-parity.mjs <other-index.js>
      node tools/nonengine-parity.mjs
      ```

      engine-parity only compares the five pure-engine blocks. nonengine-parity
      covers the rest, where two fixes have already gone missing for releases at a
      time — it tracks specific defensive constructs and records which differences
      are deliberate, so a real gap is not lost among the legitimate ones.

      A fix ported to one copy and not the other is invisible: both still pass
      their own suites, because each suite lifts the block out of the file it
      was given. Exits non-zero on drift and names the first differing line.
> **The demo drivers need Playwright and a browser binary, neither of which is installed
> locally — `node tools/demo/shot.js` fails with MODULE_NOT_FOUND. Run them inside the
> Playwright image that is already on the Docker host instead, which needs no local
> install:**
>
> ```bash
> # start the demo, copy index.js + the driver to /tmp/sdtest on 10.14.88.171, then:
> docker run --rm --network host -v /tmp/sdtest:/work -w /work \
>   -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
>   mcr.microsoft.com/playwright:v1.55.0-noble \
>   sh -c "npm i --no-save playwright-core@1.55.0 >/dev/null 2>&1 && node tools/demo/<driver>.js"
> ```
>
> **Deploy index.js into the demo FIRST, or you are testing whatever build that
> container happens to hold.** Only moodstrip.js reads the local file; the other five
> exercise the page, which loads from the bind mount:
>
> ```bash
> scp index.js root@10.14.88.171:/mnt/pool/config/st-demo/data/default-user/extensions/scene-director/index.js
> ```
>
> The playwright-core version MUST match the image tag — npm otherwise pulls a newer one
> and it refuses to use the image's browsers. Stop st-demo when finished.

- [ ] `tools/demo/pipeline.js` — all 7 **PASS**. The only check that reads what the
      extension actually RENDERS: it pushes a message with a known header through
      MESSAGE_RECEIVED and asserts the location, the time and the garment all reach
      the HUD. Every other driver only checks that the HUD exists. Works against
      either build (it accepts both HUD ids).
- [ ] `tools/demo/moodstrip.js` — all 6 **PASS**. Because it reads the index.js
      you give it rather than the page, it also checks the PRIVATE build: copy
      that file in as `/tmp/sdtest/index.js` and run it again.
- [ ] `tools/demo/moodstrip.js` (public) — all 6 **PASS**. Checks the mood tag is removed
      from the rendered message WITHOUT rebuilding its subtree. `sameNode` and
      `preAttachedSurvived` are the load-bearing assertions: they are the only two
      that fail on the pre-0.9.58 innerHTML rewrite.
- [ ] `node tools/demo/shot.js stage` — console shows `Activating extension
      third-party/scene-director`, no `[scene-director]` errors, `chips > 0`
      **and `hud 1`**. That hud figure was `0` on every run until 2026-09-24
      because the probe matched a `.scene-director-hud` CLASS that does not
      exist — the HUD carries an id. A number that can only ever be zero is not
      a check, so it is asserted now.
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

⚠️ **Reset the demo's settings first, or a driver can pass on state an earlier run
left behind.** The container accumulates `extension_settings.scene_director`
across runs: on 23 Sep it had `enableHud: true` stored while the extension
defaults it to false, and `atlas.js` had been passing on that leftover rather
than on anything it established itself.

```bash
ssh root@10.14.88.171 "python3 -c \"import json
p='/mnt/pool/config/st-demo/data/default-user/settings.json'
d=json.load(open(p)); d.get('extension_settings',{}).pop('scene_director',None)
json.dump(d,open(p,'w'))\"; docker restart st-demo"
```

A release check that only passes on a dirty profile is not a release check. Every
driver must pass from defaults, which is what a new user has.

⚠️ **Wait for the demo to answer before launching a driver.** `docker start st-demo`
returns as soon as the container exists, not when SillyTavern is serving, and a
driver that starts too early dies with `ERR_CONNECTION_REFUSED`. On 23 Sep that
produced a run whose grep for PASS looked clean while errcheck had never
executed. Gate the drivers on the port:

```bash
until curl -sf -m 3 -o /dev/null http://127.0.0.1:8327/; do sleep 2; done
```

**Run all five with one command**, so a driver cannot be left out. It discovers
whatever is in `tools/demo/`, prints a banner per driver and reports the count,
which is the check that catches an omission:

```bash
ssh root@10.14.88.171 "docker start st-demo >/dev/null 2>&1
  until curl -sf -m 3 -o /dev/null http://127.0.0.1:8327/; do sleep 2; done
  timeout 1800 docker run --rm --network host -v /tmp/sd-demo-drivers:/w:ro \
    mcr.microsoft.com/playwright:v1.55.0-noble sh -c 'cp /w/*.js /tmp/ && cd /tmp
      npm i -s playwright@1.55.0 >/dev/null 2>&1
      # shot.js needs an argument: with none it runs its \"scan\" mode, not the \"stage\" mode
      # the checklist asks for, and prints key diagnostics instead of the chip count.
      n=0; for f in *.js; do a=\"\"; [ \"\$f\" = shot.js ] && a=stage
        echo \"=== \$f \$a ===\"; node \"\$f\" \$a || echo \"DRIVER FAILED: \$f\"; n=\$((n+1)); done
      echo \"drivers run: \$n\"'"
```

On 23 Sep I ran a hand-written command listing four drivers by name and missed
`atlas.js` in thirteen consecutive releases. Listing them by hand is the bug.

And check each driver actually produced its own output line, rather than
grepping the combined log for PASS — a missing section is the failure mode a
PASS-only grep cannot see.

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
