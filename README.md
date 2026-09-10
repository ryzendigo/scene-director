# Scene Director

A [SillyTavern](https://github.com/SillyTavern/SillyTavern) UI extension that reads a
structured **scene header** out of each AI message and directs the scene for you:

| Feature | What it does |
|---|---|
| **Auto Backgrounds** | Matches the header's location against a regex map and runs `/bg <file>` |
| **Seasonal Swaps** | In a given month, swaps a mapped background for a variant (Christmas lights in December…) |
| **Era Swaps** | Once the *story* year passes a threshold, swaps one background for another (the half-built house is finished from 2027…) |
| **Auto Costumes** | Switches sprite costumes with `/costume` based on location + time of day (pajamas in the bedroom after 8 pm…) |
| **Cast Strip** | Shows small circular portrait chips for NPCs who *speak* in the latest AI message |
| **Scene HUD** *(0.2.0)* | A small fixed chip top-right showing the parsed header: `🕰 2:14 PM · Tue Aug 11 2026 · 🌥 Overcast, 14°C` |
| **Cast Mood Bubbles** *(0.2.0)* | Keyword heuristic per NPC chip: a comic thought bubble (😊/😠/😢) and an optional per-mood portrait variant |
| **Sprite Crossfade** *(0.2.0)* | Fades the previous expression sprite out over the new one on sprite changes |
| **Weather & Lighting Overlay** *(0.2.0)* | Pure-CSS night/dusk/rain tint (plus animated rain streaks) behind the chat, for backgrounds without pre-graded variant files |
| **Sprite Shadow** *(0.3.0)* | Grounding drop-shadow under the expression sprite |
| **Sprite Lighting Tint** *(0.3.0)* | Darkens/warms the sprite to match the scene state (night/dusk/rain) |
| **Background Crossfade** *(0.3.0)* | Dips to black around each `/bg` switch instead of a hard cut |
| **Typing Presence** *(0.3.0)* | Subtle sprite sway + a `…` thought bubble while the model is generating |
| **Ken Burns Drift** *(0.3.0)* | Slow zoom/pan on the background, duration configurable |
| **Fire Flicker** *(0.3.0)* | Warm flicker overlay when the applied background filename matches a pattern |
| **Bio Cards** *(0.3.0)* | Hover a cast chip for a one-line bio from `npc/bios.json` |
| **Photo Mode** *(0.3.0)* | 📷 button composites background + tint + sprite + HUD into a downloadable PNG |
| **Tab Title** *(0.3.0)* | Browser tab title becomes `<prefix> — <location>, <time>` per message |
| **Emotion Accents** *(0.3.0)* | Transient lighting pulse when the sprite shows anger, fear or love |
| **Idle Presence** *(0.3.0)* | After a quiet period, drifts between the sprite's `neutral-*` variants |
| **Day Trail** *(0.3.0)* | Today's distinct locations accumulate into the HUD hover tooltip |
| **Life Counters** *(0.3.0)* | User-defined date counters (days / weeks+days) from the *story* date |
| **Speaking Order** *(0.3.0)* | Cast chips ordered latest-speaker-first |
| **Asset Preloading** *(0.3.0)* | Idle prefetch of mapped backgrounds and neutral sprite variants |

Every feature is independently toggleable and fully configurable. With no scene
header in a message, everything no-ops quietly. The extension only issues the same
slash commands you could type yourself — it never modifies your chat.

> **Screenshot placeholders**
>
> ![Cast strip in action](docs/screenshot-cast-strip.png)
> ![Settings drawer](docs/screenshot-settings.png)

## The scene header

Scene Director expects each AI message to begin with (or contain) a header like:

```
[ 🕰️ 2:14 PM | ☀️ Tuesday, August 11, 2026 | 📍 Granty's kitchen | 🌥️ Overcast ]
```

The default parsing regexes match exactly that format ("Freaky Frankenstein"-style
time trackers), but all three are editable, so any header that carries a location,
a clock time, and a date can drive the extension.

**This extension does not generate scene headers.** Your preset / system prompt
must instruct the model to emit one per reply. Something like:

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

## Configuration

Open **Extensions → Scene Director**. Toggles at the top enable each feature
independently (only Auto Backgrounds is on by default — and it does nothing until
you give it a map). The maps are JSON textareas: edit, then hit **Apply & validate**.
Invalid JSON or bad regexes show an inline error and *nothing* is saved until the
whole form validates. **Test last message** dry-runs the parser against the current
chat's last AI message and shows exactly what was detected — use it constantly
while building your maps.

### Header regexes

| Field | Convention |
|---|---|
| Location regex | capture group 1 = the location text |
| Time regex | group 1 = hour, group 2 = minutes, optional group 3 = `AM`/`PM`. If your header uses a 24-hour clock, write a regex with no group 3. |
| Date regex | group 1 = month (English name **or** number 1–12), group 2 = day, group 3 = 4-digit year |
| Weather regex | group 1 = the weather text. Matched against the **header line** (the line the location regex hit); the default grabs the last `\|`-separated segment before the closing `]` |
| Rain regex | matched against the lowercased weather text; a hit means "it's raining" for the Weather & Lighting Overlay (default `rain\|storm\|shower\|drizzl`) |

### Background map

An array of `{pattern, background}`. Patterns are case-insensitive regexes tested
against the **location text only** (not the whole message). **First match wins**,
so put specific patterns before generic ones (`"carter.*kitchen"` before `"kitchen"`).

```json
[
  { "pattern": "hay ?loft|barn",            "background": "barn-loft.jpg" },
  { "pattern": "farmhouse.*kitchen",        "background": "farm-kitchen.jpg" },
  { "pattern": "kitchen",                   "background": "home-kitchen.jpg" },
  { "pattern": "bedroom|their room|master", "background": "bedroom.jpg" },
  { "pattern": "car\\b|driving|highway",    "background": "car-interior.jpg" }
]
```

Backgrounds are the filenames shown by `/bg` (the files in your ST `backgrounds/`
folder or uploaded via the UI).

### Seasonal map

Swaps applied *after* the background map picks a file, when the story date's month
matches:

```json
[
  { "month": 12, "from": "living-room.jpg", "to": "living-room-christmas.jpg" },
  { "month": 12, "from": "verandah.jpg",    "to": "verandah-christmas.jpg" }
]
```

### Era rules

Swaps applied when the story year reaches `minYear`. `pattern` (optional) further
restricts the rule to matching locations:

```json
[
  { "minYear": 2027, "pattern": "build site|the rise", "from": "house-frame.jpg", "to": "house-finished.jpg" }
]
```

### Costume rules

First matching rule wins. Hours are 0–23 and the window may wrap midnight
(`fromHour: 20, toHour: 7` = 8 pm–7 am). `fromHour == toHour` means all day.
An empty `costume` — or no rule matching — selects the character's **default**
costume. Costumes only change when the header contained a parseable time, and
Scene Director never re-issues `/costume` for an unchanged value, so manual
`/costume` choices stick until the rules produce a *different* answer.

```json
[
  { "pattern": "bedroom|their room", "fromHour": 20, "toHour": 7, "costume": "pajamas" }
]
```

> Tip from the prototype this was extracted from: keep auto-costuming
> conservative. Anything sensitive or situational is better left to a manual
> `/costume` — only automate the swaps that are always correct.

### Cast strip

Detects which NPCs **speak** in the latest AI message and shows portrait chips
bottom-left. Detection is by either signal, colour preferred:

- `colorHex` — if your preset gives each NPC's dialogue a fixed `<font color=#...>`,
  the hex appearing in the raw message means they spoke. This is the most precise
  signal (a character merely *mentioned* doesn't trigger it).
- `nameRegex` — fallback for characters without a pinned colour. Note this matches
  mentions too, not just speech.

```json
[
  { "key": "granty", "label": "Granty",    "colorHex": "#B0BEC5", "nameRegex": "granty" },
  { "key": "wagner", "label": "Dr Wagner", "nameRegex": "dr\\.? wagner|wagner" }
]
```

Portraits load from `/characters/<Cast sprite folder>/npc/<key>.png` — i.e. create
an `npc/` subfolder inside one character's sprite folder
(`data/<user>/characters/<CharName>/npc/`) and drop in one square PNG per cast
member, named after its `key`. A missing portrait silently removes that chip
(no broken-image icons).

With **Cast Strip** on, chips fade+rise in as they appear, and the member whose
dialogue colour hex appears **latest** in the message is highlighted as
*speaking* (brighter ring, slight scale); the others sit at 85% opacity.

### Scene HUD

A single fixed, click-through chip in the top-right corner showing whatever the
header parsing found: the time, the story date (reformatted as `Tue Aug 11 2026`),
and the weather text. Parts that don't parse are simply omitted; with no header
at all the HUD hides. No configuration beyond the header regexes above.

### Cast Mood Bubbles

Requires the Cast Strip. For each present NPC, Scene Director collects the text
of their `<font color="#hex">` dialogue spans **plus** a ±120-character narration
window around each (name-regex matches for members without a colour), then scores
three keyword sets over it. The highest-scoring mood wins; zero hits = neutral.

- **Thought bubble**: a small comic-style white bubble (with two trailing dots as
  the tail) pops in above the chip with 😊 (happy), 😠 (angry) or 😢 (sad).
  Neutral shows no bubble.
- **Mood portraits (optional)**: if a file named `<key>-happy.png`,
  `<key>-angry.png` or `<key>-sad.png` exists next to the base `<key>.png` in
  your `npc/` folder, the chip swaps to it for that mood. Missing variants fall
  back gracefully to the base portrait — you can provide them for none, some, or
  all cast members.

The keyword sets are editable in the **Mood keywords** JSON field — regex
sources, matched case-insensitively, highest total match count wins:

```json
{
  "happy": "laugh|chuckl|smil|grin|warm|bright|beam",
  "angry": "snap|sharp|cold|flat|hard|stern|glare|slam|hiss",
  "sad": "tear|wept|weep|cries|crying|sob|quiet(?:ly)?\\s+sad|trembl|waver"
}
```

It's a heuristic — tune the word lists to your story's prose. It will sometimes
be wrong; that's what makes the bubbles charming rather than authoritative.

### Sprite Crossfade

Watches SillyTavern's expression sprite (`#expression-image` inside
`#expression-holder`). When the sprite changes, the previous image is cloned,
absolutely positioned over the new one, and faded out over 300 ms. If ST's own
expression animation is active for a change (its `expression-animating` path),
Scene Director stands down for that swap so the fade isn't doubled. If the
sprite element doesn't exist (no expressions extension / no sprite pack), the
feature quietly does nothing.

### Weather & Lighting Overlay

A programmatic, pure-CSS fallback for backgrounds **without** pre-graded
`-night` / `-rain` / `-dusk` variant files: a full-viewport, click-through
overlay is kept behind the chat (above ST's background layers) and tinted from
the parsed header —

| Condition | Effect |
|---|---|
| Night (19:00–05:59) | blue-black tint `rgba(10,15,40,.45)` |
| Dusk (17:00–18:59) | amber tint `rgba(255,180,80,.18)` |
| Rain (weather text matches the rain regex) | grey-blue tint `rgba(40,60,90,.35)` + animated CSS rain streaks |

If your background map *did* pick a graded variant file (any background whose
filename ends in `-night`, `-rain` or `-dusk`), the tint is suppressed so the
scene isn't double-darkened — the rain streaks may still show for rain. Tints
transition over 1 s, so lighting changes feel like a slow grade, not a cut.

## v0.3.0 — the presence pack

Fifteen new features, all **off by default except Sprite Shadow**. Each is an
independent toggle; flip any misbehaving one off without touching the rest.

### Sprite Shadow & Sprite Lighting Tint

Both act on the expression sprite through a single composed CSS `filter`
(they share the property, so they are built together and delivered via a CSS
variable that survives ST replacing the sprite node):

- **Shadow** (on by default): `drop-shadow(0 12px 18px rgba(0,0,0,.45))` —
  grounds the sprite against any background.
- **Tint**: reuses the same scene state as the Weather & Lighting Overlay —
  night `brightness(.75) saturate(.85)`, dusk `sepia(.25) brightness(.9)`,
  rain `brightness(.8) saturate(.7)`. Neutral scenes: shadow only.

### Background Crossfade

Around each `/bg` change, a full-viewport black overlay (kept between ST's
background layers and the UI) fades to ~0.6 over 200 ms, the `/bg` is issued,
then it fades back over 300 ms — a filmic dip instead of a hard cut.

### Typing Presence

Hooks ST's `GENERATION_STARTED` / `GENERATION_ENDED` / `GENERATION_STOPPED`
events (checked defensively — missing names are skipped). While the model is
generating, the sprite plays a very subtle sway (±0.4° rotate / 1% translateY,
4 s loop) and a `…` thought bubble appears near its head; both clear on end.

### Ken Burns Drift

Adds `animation: … <kenBurnsSeconds>s ease-in-out infinite alternate` to ST's
background element `#bg1` (the element `backgrounds.js` paints
`background-image` onto), scaling 1.0 → 1.06 with a slight translate. Sweep
duration is the **Ken Burns sweep (seconds)** setting (default 75).

### Fire Flicker

When the *applied* background's filename matches the **Fire regex** (default
`fireplace|christmas`), a soft warm radial-gradient overlay (bottom-left
biased) plays a subtle 2.2 s three-step opacity flicker (0.10–0.22).

### Bio Cards

Convention: put a `bios.json` next to your cast portraits —
`/characters/<Cast sprite folder>/npc/bios.json` — a flat object mapping cast
keys to one-line bios:

```json
{
  "granty": "Rachel's grandmother; keeper of the kitchen and of opinions.",
  "wagner": "The town GP. Has seen everything twice."
}
```

It is fetched **once per session**; hovering a cast chip shows a dark tooltip
card with that member's line. A missing file (or key) quietly shows nothing.
Chips accept pointer events for this; the strip container remains
click-through.

### Photo Mode

A small, unobtrusive 📷 button bottom-right. Clicking it composites the
current ST background (cover-fit) + the weather overlay tint + the expression
sprite (at its on-screen position) + the HUD text onto a viewport-sized canvas
and downloads a PNG named `<prefix> — <YYYY-MM-DD> — <location>.png` (story
date and location from the parsed header; timestamp fallback). Everything
drawn is same-origin, so the canvas stays untainted; failures raise a toastr
warning instead of breaking anything.

### Tab Title

Per message, `document.title` becomes `<prefix> — <location>, <time>`; with no
parseable header the original title is restored. The prefix is the **Tab
title / photo prefix** setting (blank = the cast folder name, else "Scene").

### Emotion Accents

~1.5 s after each AI message (by which time the expressions extension has
classified), the current sprite's *filename* is checked: `anger|angry|rage`
fires a red-tinged vignette pulse (1 s), `fear|afraid|terror|scared` a cold
desaturating pulse (1 s), `love|desire|lust` a soft warm bloom (1.2 s). All
transient overlay divs, max opacity ~0.18.

### Idle Presence

If no message arrives for **Idle presence after** seconds (default 90), then
every **Idle swap every** seconds (default 45) the sprite crossfades between
its available neutral variants — `neutral`, `neutral-1` … `neutral-3` with the
current sprite's extension, each verified via `Image()` onload before use. It
only ever runs while the sprite already shows a `neutral*` (so it never fights
the expressions extension) and stops instantly on any message or generation
start.

### Day Trail & Life Counters

Both render into the Scene HUD's hover tooltip (the HUD gains pointer events
when you enable them):

- **Day Trail**: today's distinct parsed locations, in order —
  `Kitchen → Medical Centre → …` — reset whenever the story date changes.
- **Life Counters**: a user-editable JSON array; each entry is computed from
  the parsed **story** date (never real time) and hidden until its anchor date
  is reached:

  ```json
  [
    { "label": "married",  "emoji": "💍", "date": "2026-07-11", "mode": "days" },
    { "label": "pregnant", "emoji": "🤰", "date": "2026-06-28", "mode": "weeks" }
  ]
  ```

  `mode: "days"` renders `💍 31 days`; `mode: "weeks"` renders `🤰 6w2d`.

### Speaking Order

Orders the cast strip by the last position each member's dialogue colour hex
appears in the message — latest speaker first. Members detected only by name
regex keep their cast-table order after the speakers.

### Asset Preloading

5 s after each message: once per session, `new Image()` prefetch of every file
your background map, seasonal map and era rules could apply; every time, the
current costume's neutral variants are verified-and-cached (which is also the
prefetch for Idle Presence).

## FAQ

**My chat has no scene headers — nothing happens.**
Correct: this extension is a *consumer* of scene headers, not a producer. It needs
a preset/system prompt that makes the model emit them (see [The scene header](#the-scene-header)).
Use **Test last message** to check whether your regexes find anything.

**Backgrounds don't change even though the location parses.**
The location must match an entry in your background map, and the mapped file must
actually exist in your backgrounds list (try the `/bg` command by hand). Also note
the dedupe: if the mapped background is already the last one Scene Director set,
it won't re-issue the command.

**Costumes never change.**
Auto Costumes needs (a) the toggle on, (b) a parseable time in the header, and
(c) a matching rule. `/costume` also requires the character to have a sprite pack
with costume subfolders.

**Does it work with swipes?**
Yes — swiping re-runs the whole pipeline on the new message. Switching chats resets
the dedupe state and immediately applies rules to the opened chat's last message.

**Can it break my chat?**
No. It only reads messages and runs `/bg`/`/costume`. Every feature is wrapped in
its own try/catch, so one misbehaving map can't take the others down.

## License

MIT — see [LICENSE](LICENSE).
