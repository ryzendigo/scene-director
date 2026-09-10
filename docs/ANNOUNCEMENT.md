# Announcement drafts

Ready-to-paste posts for the v0.1.0 release. Add the two screenshots before
posting (see PUBLISHING-CHECKLIST.md).

---

## SillyTavern Discord — #extensions

> **Scene Director** — scene-header-driven auto backgrounds, costumes and cast
>
> If your preset makes the model start every reply with a status line like
> `[ 🕰️ 2:14 PM | ☀️ Tuesday, August 11, 2026 | 📍 Granty's kitchen | 🌥️ Overcast ]`
> (Freaky Frankenstein-style time trackers), this extension reads that header and
> directs the scene for you:
>
> - **Auto backgrounds** — maps the location text to a background via regexes and runs `/bg`
> - **Seasonal swaps** — a mapped background gets a variant in a given month (Christmas lights in December)
> - **Era swaps** — once the *story* year passes a threshold, one background permanently becomes another
> - **Auto costumes** — `/costume` by location + time of day (pajamas in the bedroom after 8 pm)
> - **Cast strip** — small portrait chips for the NPCs who actually *speak* in the latest message (detected by dialogue font colour, with a name-regex fallback)
>
> Everything is independently toggleable, all regexes/maps are editable JSON with
> inline validation, and there's a "Test last message" dry-run button. It only
> issues the same `/bg` and `/costume` commands you could type yourself — it never
> touches your chat.
>
> **It does not generate scene headers** — you need a preset that emits them
> (the README has a one-line prompt snippet). No header, no-op.
>
> Install URL: `https://github.com/ryzendigo/scene-director`
> (Extensions → Install extension → paste the URL)
>
> First release (v0.1.0), MIT. Screenshots coming shortly. Feedback welcome.

---

## r/SillyTavernAI

**Title:** Scene Director — an extension that turns your scene-header/time-tracker line into auto backgrounds, costumes and a speaking-cast strip

**Body:**

**What it is**

A small UI extension I built for my own long-running RP and then cleaned up for
release. If your preset makes the model begin each reply with a structured scene
header — the "Freaky Frankenstein"-style time tracker, e.g.

```
[ 🕰️ 2:14 PM | ☀️ Tuesday, August 11, 2026 | 📍 Granty's kitchen | 🌥️ Overcast ]
```

— then that line already knows where you are, what time it is, and what the date
is. Scene Director parses it out of each AI message and uses it:

- **Auto backgrounds** — regex map from location text to a background file; it runs the normal `/bg` command for you
- **Seasonal swaps** — in December (or whatever month), `living-room.jpg` becomes `living-room-christmas.jpg`
- **Era swaps** — once the story's year reaches a threshold, a background is permanently replaced (my half-built house becomes the finished house from 2027 on)
- **Auto costumes** — `/costume` based on location + time-of-day windows, with midnight wrap (bedroom, 8 pm–7 am → pajamas). Deliberately conservative: it never re-issues an unchanged costume, so manual `/costume` choices stick
- **Cast strip** — circular portrait chips bottom-left for NPCs who *speak* in the latest message. Detection prefers a pinned dialogue `<font color>` per character (precise — a character merely mentioned doesn't light up), with a name-regex fallback

**Why**

Long multi-year slice-of-life RPs accumulate a lot of "housekeeping": switching
the background every time the scene moves, remembering costumes, keeping track of
who's in the room. The model already narrates all of that — the header makes it
machine-readable, so the UI might as well keep up on its own.

**What it is not**

It does **not** generate scene headers. It's a consumer, not a producer — your
preset/system prompt has to instruct the model to emit one per reply (one-line
snippet in the README). With no header present, everything quietly no-ops. It
also never modifies your chat: it only issues the same `/bg`/`/costume` slash
commands you could type by hand.

**Config example** (background map — first match wins, case-insensitive regexes
against the location text only):

```json
[
  { "pattern": "farmhouse.*kitchen",        "background": "farm-kitchen.jpg" },
  { "pattern": "kitchen",                   "background": "home-kitchen.jpg" },
  { "pattern": "bedroom|their room|master", "background": "bedroom.jpg" },
  { "pattern": "car\\b|driving|highway",    "background": "car-interior.jpg" }
]
```

All three header regexes are editable too, so any header format that carries a
location, a clock time and a date can drive it — the defaults just match the
format above. There's a **Test last message** button that dry-runs the parser on
your chat's latest AI message and shows exactly what it detected; I used it
constantly while building my own maps and recommend the same.

**FAQ:** "Nothing happens" almost always means either your messages have no
scene header (check your preset) or your location doesn't match any map entry —
Test last message will tell you which.

Repo + README: https://github.com/ryzendigo/scene-director
Install: Extensions → Install extension → paste the repo URL. MIT licensed.

Screenshots coming — I'll add them to the repo shortly. This is v0.1.0, extracted
from a prototype that's been running in my own daily chat for a while; happy to
hear about header formats it should support out of the box.
