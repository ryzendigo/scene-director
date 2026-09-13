# Announcement drafts (current: Scene Director v0.9.0, ChatSlim v0.1.2)

Paste-ready. Attach the three screenshots named in PUBLISHING-CHECKLIST.md;
a visual extension with no pictures gets scrolled past.

---

## 1. SillyTavern Discord — #extensions (short)

> **Scene Director v0.9.0** — describe your story's world as a deck of cards and it runs the stage
>
> A UI extension for presets that write a scene header at the top of each reply
> (`[ 🕰️ 2:14 PM | ☀️ Tuesday, August 11, 2026 | 📍 the farmhouse kitchen | 🌥️ Overcast ]`,
> Frankenstein-style trackers). It reads that line plus the message and does the stage-managing you'd otherwise do by hand:
>
> - **Backgrounds** by place, with day/night/dusk/rain/seasonal slots and era swaps, via plain `/bg`
> - **Costumes** by place + time of day, via `/costume`, and a **👗 wardrobe tracker** that follows what the narration says she's wearing
> - **Expressions** from a real mood engine: emotion tag → classifier → lexicon, with memory/hypothetical dampeners, happy-tears detection and swing gates so one dark word in a warm scene doesn't flip the sprite
> - **Position sprites** for intimate scenes (custom expression names, falls back to mood if you don't have them)
> - **Cast strip**: portrait chips for who is actually *in the room* (dialogue colour + arrival/departure evidence), 📞 badge for someone on the phone, mood bubbles, and now **animated portraits** (drop `.webp` loops beside the PNGs)
> - Scene HUD with clock/date/weather, weather and lighting overlays, sprite crossfade, drag/scroll to place and size the sprite, photo mode, thought tooltips
>
> New chat setup is a minute: **🔍 Scan my chat** finds your characters' dialogue colours and your 📍 places and proposes the cards. No AI calls, no chat writes, everything toggleable, all rules editable JSON.
>
> Install: Extensions → Install extension → `https://github.com/ryzendigo/scene-director` (MIT)
>
> Companion: **ChatSlim** — warns when a chat file is getting big enough to crash the browser, strips dead swipe/scratch weight (verified lossless), and branches the last N messages into a fresh chat in one click. `https://github.com/ryzendigo/SillyTavern-ChatSlim`

---

## 2. r/SillyTavernAI (long)

**Title:** Scene Director v0.9.0 — auto backgrounds, costumes, a wardrobe tracker, a mood engine for expressions and an animated cast strip, all driven by your scene header (plus ChatSlim for chats that crash the browser)

**Body:**

**What it is**

A UI extension that grew out of a long slice-of-life RP and got cleaned up for release. If your preset makes the model open every reply with a structured header, like the Frankenstein-style time tracker:

```
[ 🕰️ 2:14 PM | ☀️ Tuesday, August 11, 2026 | 📍 the farmhouse kitchen | 🌥️ Overcast ]
```

then the model is already telling you where you are, what time it is, and what the weather's doing. Scene Director reads that line and the message body and keeps the stage in sync with the story. You describe the world as two small decks of cards in the settings drawer, **Cast** (who can appear) and **Places** (where scenes happen), and it does the rest deterministically. No extra API calls, and it never writes to your chat: it only issues the `/bg` and `/costume` commands you could type yourself.

**What it does**

- **Backgrounds.** Each Place card has a matcher regex and slots for day, night, dusk, rain and seasonal variants (December lights). Era swaps replace a background permanently once the story's year passes a threshold.
- **Costumes.** By place + time-of-day window with midnight wrap. Conservative: it never re-issues an unchanged costume, so your manual choices stick.
- **👗 Wardrobe tracker.** Reads what the narration puts on and takes off ("she pulled the cardigan on", "shrugs out of the coat", "naked") over the last 80 messages, shows it in the HUD, and can inject a one-line `[WARDROBE — …]` note so the model stops forgetting she's in a towel. Costume rules can map tracked garments to a `/costume` folder.
- **Expressions from a layered mood engine.** Emotion tag if your preset emits one, then the local classifier, then a lexicon pass, with the messy bits handled: past-tense and hypothetical mentions don't count ("I was so scared back then"), negated matches are vetoed, wet eyes with a smile read as joy not sadness, a single dark word in a warm scene has to earn the swing, thin evidence holds the previous face.
- **Position sprites.** Optional custom expression folders for intimate scenes, a climax rule that wins its message, fallback to the ordinary mood if the folder isn't there.
- **Cast strip.** Circular portrait chips for the characters actually *present*, using dialogue colour plus arrival/departure/reported-speech evidence, so someone merely mentioned doesn't light up. 📞 badge for a character speaking down a phone line. Mood bubbles with per-mood portrait variants. Unknown speakers get a tinted silhouette with a best-guess name. **New in 0.9.0:** animated portraits: drop `npc/<key>.webp` loops next to the stills, list them in `npc/animated.json`, done.
- **Stage.** HUD with clock/date/weather and day counters, weather and lighting overlays, sprite shadow tint, background and sprite crossfades, Ken Burns drift, fire flicker, drag and scroll-wheel to place and size the sprite, photo mode, thought tooltips, tab title.

**Setup**

**🔍 Scan my chat** reads your existing messages, finds each character's dialogue font colour and every 📍 location, and proposes the cards; you click **+ cast card** / **+ place card**. **Test last message** dry-runs the parser and shows exactly what it detected, which is the answer to almost every "nothing happens" (no header in the message, or no card matches the place).

**What it is not**

It doesn't generate scene headers. Your preset has to emit one per reply (one-line snippet in the README). No header, quiet no-op.

**ChatSlim** (companion, separate install)

Same RP hit 2,457 messages / 18.7 MB and started crashing the browser. Only about 4 MB of that was visible text; the rest was unchosen swipes, per-swipe metadata and a summariser's scratch text. ChatSlim warns when a chat is heading that way, strips the dead weight with a verified-lossless check, and **Slim & Branch** carries the last N messages into a fresh chat in one click (uses ST's own branch code, 1.18-safe).

Repos, MIT:
- https://github.com/ryzendigo/scene-director
- https://github.com/ryzendigo/SillyTavern-ChatSlim

Install either with Extensions → Install extension → paste the URL. Happy to hear about header formats it should match out of the box.

---

## 3. ChatSlim standalone (Discord #extensions, if posted separately)

> **ChatSlim** — for chats big enough to crash the browser
>
> ST loads and saves a chat as one unit; past a couple thousand messages that means minute-long loads, freezes after sending, and eventually "Out of Memory" / STATUS_BREAKPOINT renderer crashes. Most of the file usually isn't text: it's unchosen swipes, per-swipe metadata and extension scratch.
>
> ChatSlim shows the breakdown, warns at a size threshold, strips the dead weight (round-trips and diffs the visible chat before it will save), and **Slim & Branch** starts a fresh chat from the last N messages with one click.
>
> `https://github.com/ryzendigo/SillyTavern-ChatSlim` (MIT, v0.1.2, ST 1.18)
