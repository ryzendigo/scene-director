# Scene Director

**Describe your story's world as a deck of cards, and Scene Director runs the stage.**

A [SillyTavern](https://github.com/SillyTavern/SillyTavern) UI extension. You build
two small decks in its settings drawer — **Cast cards** (who can appear: portrait,
dialogue colour, name regex, bio) and **Place cards** (where scenes happen: a matcher
regex plus day/night/dusk/rain/seasonal background slots) — and Scene Director reads
the **scene header** the model already writes at the top of each reply:

```
[ 🕰️ 2:14 PM | ☀️ Tuesday, August 11, 2026 | 📍 Granty's kitchen | 🌥️ Overcast ]
```

…then deterministically switches backgrounds, swaps costumes, shows who's on
stage and what the clock says. No AI calls, no chat writes — just the header,
your cards, and the same `/bg` and `/costume` commands you could type yourself.

New chats set up in about a minute: hit **🔍 Scan my chat** and the wizard reads
your existing messages, finds your characters' dialogue colours and your 📍
locations, and offers one-click card creation for each.

## How it compares

Automatic scene management has been a repeatedly requested SillyTavern feature —
see core feature request [SillyTavern#442](https://github.com/SillyTavern/SillyTavern/issues/442)
("configure certain background images to be shown when certain keywords appear").
A few extensions circle the same space from different directions:

| Extension | Approach |
|---|---|
| [Prome VN Extension](https://github.com/Bronya-Rand/Prome-VN-Extension) | Visual-novel *presentation* polish: letterbox, sprite focus/defocus, **manually chosen** world/character tinting |
| [st-weather-cycle](https://github.com/nullara/st-weather-cycle) | **Manually triggered** weather + day/night overlay effects (`/wc weather`, `/wc time`) |
| Scene Transition | **AI-generated** scene changes (asks a model what the scene should look like) |
| **Scene Director** | **Deterministic story-header automation**: the model's own scene header drives backgrounds, costumes, lighting, plus a speaking-cast system driven by dialogue colours |

They're largely complementary — Prome for VN staging, Scene Director for the
automation — and Scene Director detects both at startup: with Prome installed it
steps back from scene tinting (its Weather & Lighting Overlay auto-disables),
and with st-weather-cycle installed its Ken Burns drift auto-disables, so the
two never fight over the same pixels. The settings drawer tells you when a
guard has kicked in.

## Feature list

| Feature | What it does |
|---|---|
| **Auto Backgrounds** | Matches the header's 📍 location against your Place cards and runs `/bg <file>` — the card's day/night/dusk/rain/seasonal slot is picked from the parsed time and weather |
| **Seasonal Swaps** | In a given month, swaps a picked background for a variant (Christmas lights in December…) |
| **Era Swaps** | Once the *story* year passes a threshold, swaps one background for another (the half-built house is finished from 2027…) |
| **Auto Costumes** | Switches sprite costumes with `/costume` based on location + time of day (pajamas in the bedroom after 8 pm…) |
| **Cast Strip** | Shows small circular portrait chips for the Cast-card characters who *speak* in the latest AI message |
| **Scene HUD** *(0.2.0)* | A small fixed chip top-right showing the parsed header: `🕰 2:14 PM · Tue Aug 11 2026 · 🌥 Overcast, 14°C` |
| **Cast Mood Bubbles** *(0.2.0)* | Keyword heuristic per NPC chip: a comic thought bubble (😊/😠/😢) and an optional per-mood portrait variant |
| **Sprite Crossfade** *(0.2.0)* | Fades the previous expression sprite out over the new one on sprite changes |
| **Weather & Lighting Overlay** *(0.2.0)* | Pure-CSS night/dusk/rain tint (plus animated rain streaks) behind the chat, for backgrounds without pre-graded variant files |
| **Sprite Shadow / Lighting Tint** *(0.3.0)* | Grounding drop-shadow + scene-matched darkening on the expression sprite |
| **Background Crossfade** *(0.3.0)* | Dips to black around each `/bg` switch instead of a hard cut |
| **Typing Presence** *(0.3.0)* | Subtle sprite sway + a `…` thought bubble while the model is generating |
| **Ken Burns Drift** *(0.3.0)* | Slow zoom/pan on the background, duration configurable |
| **Fire Flicker** *(0.3.0)* | Warm flicker overlay when the applied background filename matches a pattern |
| **Bio Cards** *(0.3.0)* | Hover a cast chip for its card's one-line bio (or `npc/bios.json`) |
| **Photo Mode** *(0.3.0)* | 📷 button composites background + tint + sprite + HUD into a downloadable PNG |
| **Tab Title** *(0.3.0)* | Browser tab title becomes `<prefix> — <location>, <time>` per message |
| **Emotion Accents** *(0.3.0)* | Transient lighting pulse when the sprite shows anger, fear or love |
| **Idle Presence** *(0.3.0)* | After a quiet period, drifts between the sprite's `neutral-*` variants |
| **Day Trail / Life Counters** *(0.3.0)* | Today's locations + user-defined story-date counters in the HUD tooltip |
| **Speaking Order** *(0.3.0)* | Cast chips ordered latest-speaker-first |
| **Asset Preloading** *(0.3.0)* | Idle-callback prefetch of card backgrounds and neutral sprite variants (skipped on data-saver / 2G connections) |
| **Card system + Scan wizard** *(0.4.0)* | Cast & Place cards replace the raw JSON maps; the Scan-my-chat wizard builds them from your existing chat |

Every feature is independently toggleable. With no scene header in a message,
everything no-ops quietly. The extension only reads messages and issues slash
commands — it never modifies your chat.

> **Screenshot placeholders**
>
> ![Cast & Place cards in the settings drawer](docs/screenshot-cards.png)
> ![Scan-my-chat wizard results](docs/screenshot-scan-wizard.png)
> ![Cast strip + HUD in action](docs/screenshot-cast-strip.png)

## The scene header

Scene Director expects each AI message to begin with (or contain) a header like
the example above. The default parsing regexes match exactly that format
("Freaky Frankenstein"-style time trackers), but all of them are editable, so
any header that carries a location, a clock time, and a date can drive the
extension.

**This extension does not generate scene headers.** Your preset / system prompt
must instruct the model to emit one per reply. The settings drawer has a
one-click-copy snippet for presets that don't emit headers yet:

> Begin every reply with a status line in this exact format:
> `[ 🕰️ <12h time> | ☀️ <Weekday, Month D, YYYY> | 📍 <current location> | 🌥️ <weather> ]`

## Installation

1. In SillyTavern, open **Extensions** (the stacked-blocks icon) → **Install extension**.
2. Paste this repository's URL:
   ```
   https://github.com/ryzendigo/scene-director
   ```
3. Click **Install for all users** (or just yourself), then find **Scene Director**
   in the Extensions settings panel.

Manual install: clone this repo into
`data/<user>/extensions/scene-director/` and reload the page.

## The 60-second setup

1. Open **Extensions → Scene Director** in a chat that already has some messages.
2. Click **🔍 Scan my chat**. The wizard reports:
   - whether scene headers were detected (with a sample line),
   - every distinct dialogue `<font color>` hex, its speak count, and a guess
     at whose colour it is,
   - every distinct 📍 location and how often it appeared.
3. Click **+ cast card** / **+ place card** on the rows you want. Guesses are
   pre-filled; fix a name here, pick a background there.
4. For each Place card, choose a background for the ☀️ day slot (the dropdowns
   list your installed backgrounds). Night/dusk/rain/seasonal slots are optional.
5. Turn on the features you want. Done.

**Test last message** dry-runs the whole parser against the current chat's last
AI message and shows exactly what was detected — use it constantly while tuning.

## Cards

### Cast cards

One card per recurring character:

- **Portrait**: the chip image. By default `/characters/<Cast sprite folder>/npc/<key>.png`
  (create an `npc/` folder inside one character's sprite folder and drop in one
  square PNG per member, named after its key). Cards added via **Add from my
  characters** use that character's avatar thumbnail automatically.
- **Colour swatch**: the character's pinned dialogue colour. Its hex appearing
  in the raw message means they *spoke* — the most precise presence signal.
- **Name regex**: fallback detection for characters without a colour (matches
  mentions too, not just speech).
- **😊 badge**: mark a member that has `<key>-happy/-angry/-sad.png` mood
  portrait variants on disk (informational — missing files always fall back).
- **Bio line**: shown on chip hover when Bio Cards is enabled
  (`npc/bios.json` still works as a fallback source).

### Place cards

One card per location. **First matching card wins**, so order specific places
above generic ones ("Carter farmhouse kitchen" above "kitchen").

- **Matcher regex**: case-insensitive, tested against the 📍 location text only.
- **Background slots**: ☀️ day (the default), plus optional 🌙 night
  (19:00–05:59), 🌆 dusk (17:00–18:59), 🌧 rain (weather text matches the rain
  regex) and 🎄 seasonal (used in the month you set, default December). Empty
  slots fall back to day. Each slot is a dropdown of your installed backgrounds
  (fetched from SillyTavern itself).
- When a night/dusk/rain slot was used, the Weather & Lighting Overlay stands
  down for that scene — your pre-graded file already carries the mood, so
  nothing double-darkens.

Old 0.3.x `backgroundMap` configs migrate into Place cards automatically (day
slot filled, name derived from the pattern). The old JSON shape still imports.

### Power users: JSON in, JSON out

Everything the cards describe — plus seasonal/era/costume/mood/counter rules —
lives in one JSON blob. **Import / export** at the bottom of the drawer dumps
and restores the whole configuration, so you can hand-edit, version-control,
or move a setup between installs.

## Configuration reference

### Header regexes

| Field | Convention |
|---|---|
| Location regex | capture group 1 = the location text |
| Time regex | group 1 = hour, group 2 = minutes, optional group 3 = `AM`/`PM`. If your header uses a 24-hour clock, write a regex with no group 3. |
| Date regex | group 1 = month (English name **or** number 1–12), group 2 = day, group 3 = 4-digit year |
| Weather regex | group 1 = the weather text. Matched against the **header line** (the line the location regex hit); the default grabs the last `\|`-separated segment before the closing `]` |
| Rain regex | matched against the lowercased weather text; a hit means "it's raining" (default `rain\|storm\|shower\|drizzl`) |

### Seasonal map / era rules (Advanced JSON)

Applied *after* a Place card picks a file:

```json
[ { "month": 12, "from": "living-room.jpg", "to": "living-room-christmas.jpg" } ]
```

```json
[ { "minYear": 2027, "pattern": "build site|the rise", "from": "house-frame.jpg", "to": "house-finished.jpg" } ]
```

(For a single place, the card's 🎄 seasonal slot covers the common case; the JSON
rules remain for cross-cutting swaps.)

### Costume rules (Advanced JSON)

First matching rule wins. Hours are 0–23 and the window may wrap midnight
(`fromHour: 20, toHour: 7` = 8 pm–7 am). `fromHour == toHour` means all day.
An empty `costume` — or no rule matching — selects the character's **default**
costume. Costumes only change when the header contained a parseable time, and
Scene Director never re-issues `/costume` for an unchanged value.

```json
[ { "pattern": "bedroom|their room", "fromHour": 20, "toHour": 7, "costume": "pajamas" } ]
```

> Tip from the prototype this was extracted from: keep auto-costuming
> conservative. Anything sensitive or situational is better left to a manual
> `/costume` — only automate the swaps that are always correct.

### Cast Mood Bubbles

For each present NPC, Scene Director collects the text of their
`<font color="#hex">` dialogue spans **plus** a ±120-character narration window
around each (name-regex matches for members without a colour), then scores three
keyword sets over it. Highest score wins; zero hits = neutral (no bubble). The
keyword sets are editable (Advanced JSON):

```json
{
  "happy": "laugh|chuckl|smil|grin|warm|bright|beam",
  "angry": "snap|sharp|cold|flat|hard|stern|glare|slam|hiss",
  "sad": "tear|wept|weep|cries|crying|sob|quiet(?:ly)?\\s+sad|trembl|waver"
}
```

It's a heuristic — tune the word lists to your story's prose. It will sometimes
be wrong; that's what makes the bubbles charming rather than authoritative.

### Life counters (Advanced JSON)

Computed from the parsed **story** date (never real time), shown in the HUD
tooltip, hidden until their anchor date is reached:

```json
[
  { "label": "married",  "emoji": "💍", "date": "2026-07-11", "mode": "days"  },
  { "label": "pregnant", "emoji": "🤰", "date": "2026-06-28", "mode": "weeks" }
]
```

`mode: "days"` renders `💍 31 days`; `mode: "weeks"` renders `🤰 6w2d`.

### The presence pack (0.3.0)

Sprite shadow/tint, background crossfade, typing presence, Ken Burns, fire
flicker, bio cards, photo mode, tab title, emotion accents, idle presence, day
trail, speaking order, preloading — all independent toggles, all off by default
except Sprite Shadow. See the tooltips on each toggle; behaviour is unchanged
from 0.3.0 apart from the performance work below.

## Performance notes (0.4.0)

- The message text is extracted and header-parsed **once per event**, capped at
  the first 20,000 characters, and shared by every feature.
- All regexes are compiled once (module-level or cached); nothing rebuilds a
  `RegExp` per message.
- The cast strip **diffs** its chips (add/remove/update by key) instead of
  rebuilding; all per-event DOM writes are batched into a single
  `requestAnimationFrame`.
- Every animation runs on `transform`/`opacity` only; the lighting tint colour
  is *set* once per scene-state change and only its opacity transitions.
- The sprite MutationObserver watches `#expression-holder` only, and is
  disconnected/re-attached on chat switch; all timers are cleared on chat
  switch and page hide.
- Prefetching runs in `requestIdleCallback`, once per session, and is skipped
  entirely on data-saver / 2G connections.
- A disabled feature costs zero: no listeners, no DOM, no timers.

## FAQ

**My chat has no scene headers — nothing happens.**
Correct: this extension is a *consumer* of scene headers, not a producer. It needs
a preset/system prompt that makes the model emit them (copy the snippet from the
settings drawer). Use **Test last message** to check whether your regexes find anything.

**Backgrounds don't change even though the location parses.**
The location must match a Place card, and the slot's file must exist in your
backgrounds list (try `/bg` by hand). Also note the dedupe: if the picked
background is already the last one Scene Director set, it won't re-issue.

**Costumes never change.**
Auto Costumes needs (a) the toggle on, (b) a parseable time in the header, and
(c) a matching rule. `/costume` also requires the character to have a sprite pack
with costume subfolders.

**Does it work with swipes?**
Yes — swiping re-runs the whole pipeline on the new message. Switching chats resets
the dedupe state and immediately applies rules to the opened chat's last message.

**Why did my Weather Overlay / Ken Burns toggle stop doing anything?**
Check the note at the top of the drawer — a compat guard has probably detected
Prome VN Extension or st-weather-cycle and stood that feature down.

**Can it break my chat?**
No. It only reads messages and runs `/bg`/`/costume`. Every feature is wrapped in
its own try/catch, so one misbehaving card can't take the others down.

## License

MIT — see [LICENSE](LICENSE).
