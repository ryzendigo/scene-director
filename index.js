/**
 * Scene Director — a SillyTavern UI extension.
 *
 * Reads a structured "scene header" out of each incoming AI message, e.g.:
 *
 *   [ 🕰️ 2:14 PM | ☀️ Tuesday, August 11, 2026 | 📍 the farmhouse kitchen | 🌥️ Overcast ]
 *
 * ...and uses what it finds to direct the scene:
 *
 *   - Auto Backgrounds : location text -> /bg <file>, driven by Place cards
 *   - Seasonal Swaps   : month-of-year swaps one background for a variant
 *   - Era Swaps        : story year >= threshold swaps one background for another
 *   - Auto Costumes    : location + time-of-day -> /costume <folder>
 *   - Cast Strip       : portrait chips for NPCs who speak in the message,
 *                        detected by their dialogue font colour (hex code in the
 *                        raw message text) or by a name regex — driven by Cast cards
 *   - Scene HUD        : a small fixed chip (top-right) showing the parsed
 *                        header parts: time · date · weather
 *   - Cast Mood Bubbles: keyword heuristic per present NPC -> optional mood
 *                        portrait variant (<key>-happy/-angry/-sad.png) and a
 *                        comic thought bubble above the chip
 *   - Sprite Crossfade : fades the previous expression sprite out over the
 *                        new one when the sprite image changes
 *   - Weather & Lighting Overlay : a CSS tint/rain overlay behind the chat
 *                        for backgrounds without pre-graded variant files
 *   - ...plus the v0.3.0 "presence pack" (see README).
 *
 * v0.4.0 — the card system + performance overhaul:
 *
 *   - Cast cards + Place cards replace the raw-JSON cast table and the flat
 *     pattern->file background map (old configs migrate transparently; JSON
 *     import/export remains as the power-user escape hatch)
 *   - "Scan my chat" wizard: parses the current chat and offers one-click
 *     card creation for detected dialogue colours and 📍 locations
 *   - Performance: one text extraction + one header parse per event, module-
 *     level/cached regexes, diffed cast-strip chips with rAF-batched DOM
 *     writes, transform/opacity-only animations, scoped MutationObserver
 *     with CHAT_CHANGED re-attach, timers cleared on chat change/page hide,
 *     idle-callback prefetch (skipped on slow connections), lazy per-feature
 *     init so a disabled feature costs zero
 *   - Compat guards: Prome VN Extension detected -> our Weather & Lighting
 *     Overlay auto-disables; st-weather-cycle detected -> our Ken Burns
 *     auto-disables (noted in the settings UI)
 *
 * v0.4.1:
 *
 *   - Inline Mood Tag (off by default): a trailing [MOOD: <label>] in the AI
 *     message sets the expression sprite directly via /emote — no classifier
 *     API round-trip. The tag is stripped from the rendered message only;
 *     the chat data keeps it so the model stays consistent. No tag = the
 *     classifier keeps working as configured.
 *   - Cast chips get a radial-gradient backing behind the portrait, so
 *     transparent-cutout portraits don't float inside the circle.
 *   - tools/cutout.py: batch background removal (rembg) for making cutouts.
 *
 * v0.5.0 — stage layout, zero-setup mood tag, presence hysteresis:
 *
 *   - The Inline Mood Tag is now ZERO-SETUP and ON by default: the
 *     instruction is auto-injected near the end of the context via
 *     ST's setExtensionPrompt (IN_CHAT, depth 1) — no preset edit needed.
 *     The toggle controls injection + parsing together.
 *   - Cast strip positioning (four corners; top corners stack a column
 *     under the HUD) + chip styles (cutout bottom-fade / cloud glow /
 *     circle / plain) + chip size (auto = match the main sprite's height,
 *     or a 48–160px slider). HUD corner is pickable too.
 *   - Presence semantics: a chip now requires the character to actually BE
 *     in the scene — dialogue colour (they spoke) or their name next to a
 *     presence cue (speech attribution / physical action). A bare mention
 *     never summons a chip. Present-but-silent characters linger (dimmed)
 *     for up to 2 further messages; an explicit departure phrase or a 📍
 *     location change clears them immediately.
 *   - /costume fix: bare costume names are issued as
 *     "<ActiveCharacter>/<name>" — ST resolves a bare argument as a
 *     top-level sprite folder, so "/costume pajamas" 404'd every sprite.
 *   - Per-chat state (day trail, last costume, presence memory) moved to
 *     ST chat metadata (saveMetadataDebounced) so it travels with the chat
 *     file; deterministic rebuild from the last ~20 messages on
 *     CHAT_CHANGED; no LLM calls anywhere.
 *   - Optional chat-panel "glass" (opacity slider + blur toggle), off by
 *     default.
 *
 * v0.5.1:
 *
 *   - Cast chip size is window-relative (28vh by default, 120px–40vh,
 *     capped to the free gutter beside the chat panel via a
 *     ResizeObserver; a tall column shrinks to fit above the send form).
 *   - Sprite blank fix: with the expressions classifier set to None (the
 *     natural companion of the mood tag) ST clears the sprite on chat
 *     load, inside /costume and on its worker tick. Every /emote is now
 *     asserted and verified, and the last tagged mood is replayed after
 *     chat load and costume switches.
 *
 * Every feature is independently toggleable and fully configurable from the
 * extension's settings drawer. With no scene header present, everything
 * no-ops quietly. The extension only reads chat state and issues the same
 * slash commands you could type yourself; it never writes to the chat.
 *
 * This extension does NOT generate scene headers. Your preset / system prompt
 * must instruct the model to emit them (see README for a worked example).
 */

(function () {
    'use strict';

    const MODULE = 'scene_director';
    const LOG = '[scene-director]';

    // Perf: never regex-sweep more than this many chars of a message.
    const MAX_SCAN = 20000;

    // ------------------------------------------------------------------
    // Default settings
    // ------------------------------------------------------------------
    // Regex capture-group conventions (documented in the settings UI too):
    //   locationRegex : group 1 = the location text
    //   timeRegex     : group 1 = hour, group 2 = minutes,
    //                   group 3 (optional) = AM/PM. No group 3 => 24-hour.
    //   dateRegex     : group 1 = month (English name or 1-12),
    //                   group 2 = day, group 3 = 4-digit year
    const defaultSettings = {
        // Master toggles — each feature is independent.
        enableBackgrounds: true,
        enableSeasonal: false,
        enableEra: false,
        enableCostumes: false,
        enableCast: false,
        enableHud: false,
        enableMoods: false,
        enableCrossfade: false,
        enableWeatherFx: false,

        // v0.3.0 presence pack — all off by default except the shadow.
        enableSpriteShadow: true,
        enableSpriteTint: false,
        enableBgCrossfade: false,
        enableTypingPresence: false,
        enableKenBurns: false,
        enableFireFlicker: false,
        enableBioCards: false,
        enablePhotoMode: false,
        enableTabTitle: false,
        enableEmotionAccents: false,
        enableIdlePresence: false,
        enableDayTrail: false,
        enableCounters: false,
        enableSpeakingOrder: false,
        enablePreload: false,

        // v0.4.1 (default ON since 0.5.0 — the instruction auto-injects).
        enableMoodTag: true,

        // v0.5.0 stage layout.
        castPosition: 'top-right',  // top-right|top-left|bottom-left|bottom-right
        chipStyle: 'fade',          // fade|cloud|circle|plain
        chipSizeAuto: true,         // 28vh tall (window-relative), gutter-capped
        chipSize: 28,               // manual height in vh (10-40) when auto is off
        hudPosition: 'top-right',
        holdCostume: false,         // freeze Auto Costumes at the current outfit
        enableChatGlass: false,     // see-through chat panel
        chatOpacity: 0.55,
        chatBlur: true,

        // v0.3.0 numeric tuning.
        kenBurnsSeconds: 75,     // one Ken Burns sweep (alternates back)
        idleAfterSeconds: 90,    // quiet time before idle presence starts
        idleEverySeconds: 45,    // interval between idle sprite swaps

        // v0.3.0 misc config.
        titlePrefix: '',
        fireRegex: 'fireplace|christmas',
        counters: [],

        // Header parsing (regex sources, compiled with the 'i' flag).
        locationRegex: '📍([^|\\]]+)',
        timeRegex: '🕰️?\\s*(\\d{1,2}):(\\d{2})\\s*(AM|PM)',
        dateRegex: '(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{1,2}),?\\s+(\\d{4})',
        weatherRegex: '\\|\\s*([^|\\[\\]]+)\\]\\s*$',
        rainRegex: 'rain|storm|shower|drizzl',

        // Cast Mood Bubbles keyword sets (regex sources).
        moodKeywords: {
            happy: 'laugh|chuckl|smil|grin|warm|bright|beam',
            angry: 'snap|sharp|cold|flat|hard|stern|glare|slam|hiss',
            sad: 'tear|wept|weep|cries|crying|sob|quiet(?:ly)?\\s+sad|trembl|waver',
        },

        // v0.4.0 Place cards — REPLACE the flat backgroundMap. Each place:
        // { "name": "Kitchen", "pattern": "kitchen", "bio": "",
        //   "slots": { "day": "kitchen.jpg", "night": "", "dusk": "",
        //              "rain": "", "seasonal": "" }, "seasonalMonth": 12 }
        // First place whose pattern matches the location wins; the slot is
        // chosen from the scene state (seasonal month > night > rain > dusk >
        // day). Empty slots fall back to the day slot.
        places: [],

        // Legacy flat map — migrated into places on first load, kept only so
        // imported old JSON keeps working. [{ "pattern": "...", "background": "..." }]
        backgroundMap: [],

        // Seasonal Swaps: applied after a background is picked.
        seasonalMap: [],
        // Era Swaps: applied when the story year crosses a threshold.
        eraRules: [],
        // Auto Costumes: first matching rule wins; hours 0-23, may wrap midnight.
        costumeRules: [],

        // v0.4.0 Cast cards. Each member:
        // { "key": "june", "label": "June", "colorHex": "#B0BEC5",
        //   "nameRegex": "june", "bio": "", "avatar": "", "moodVariants": false }
        // avatar (optional) = image URL for the chip; empty = the classic
        // /characters/<castFolder>/npc/<key>.png convention.
        cast: [],
        castFolder: '',
    };

    // ------------------------------------------------------------------
    // Regex compilation — cached, so hot paths never rebuild a RegExp
    // ------------------------------------------------------------------

    const regexCache = new Map(); // 'flags + " " + source' -> RegExp | null

    /** Compile (and cache) a regex source; null (not a throw) on bad input. */
    function compileRegex(source, flags) {
        if (!source) return null;
        const f = flags || 'i';
        const key = f + ' ' + source;
        if (regexCache.has(key)) return regexCache.get(key);
        let re = null;
        try {
            re = new RegExp(source, f);
        } catch (e) {
            console.warn(`${LOG} invalid regex: ${source}`, e);
        }
        regexCache.set(key, re);
        return re;
    }

    // Module-level static regexes (audit item 2 — none built in hot paths).
    const GRADED_VARIANT_RE = /-(night|rain|dusk)\.[a-z0-9]+$/i;
    const NEUTRAL_FILE_RE = /^neutral/;
    const CSS_URL_RE = /url\(["']?([^"')]+)["']?\)/;
    const FILENAME_UNSAFE_RE = /[\\/:*?"<>|]/g;
    const WS_RE = /\s+/g;
    const HEX_COLOR_RE = /^#[0-9a-f]{3,8}$/i;
    const FONT_COLOR_SCAN_RE = /<font\s+color=["']?(#[0-9a-fA-F]{6})/g; // wizard
    const CAP_WORD_RE = /[A-Z][a-z][\w'’-]*/g;                          // wizard name guess
    const ACCENT_PATTERNS = [
        [/anger|angry|rage/, 'anger'],
        [/fear|afraid|terror|scared/, 'fear'],
        [/love|desire|lust/, 'love'],
    ];
    // v0.4.1 Inline Mood Tag: trailing [MOOD: <label>] (ASCII or fullwidth
    // brackets 〔〕, fullwidth colon tolerated), matched against the TAIL of
    // the raw message so MAX_SCAN can never truncate it away.
    const MOOD_TAG_RE = /[\[〔]\s*MOOD\s*[:：]\s*([a-z]+)\s*[\]〕]\s*$/i;
    // The same tag inside rendered innerHTML (an optional preceding <br>).
    const MOOD_TAG_DOM_RE = /(?:<br\s*\/?>\s*)?[\[〔]\s*MOOD\s*[:：]\s*[a-z]+\s*[\]〕]/gi;
    const EMPTY_P_TAIL_RE = /<p>\s*<\/p>\s*$/i;
    // The 28 labels the expressions extension ships (DEFAULT_EXPRESSIONS in
    // SillyTavern's public/scripts/extensions/expressions/index.js). A tag
    // carrying anything else is ignored, so the classifier still runs.
    const EXPRESSION_LABELS = ['admiration', 'amusement', 'anger', 'annoyance',
        'approval', 'caring', 'confusion', 'curiosity', 'desire',
        'disappointment', 'disapproval', 'disgust', 'embarrassment',
        'excitement', 'fear', 'gratitude', 'grief', 'joy', 'love',
        'nervousness', 'optimism', 'pride', 'realization', 'relief',
        'remorse', 'sadness', 'surprise', 'neutral'];
    const EXPRESSION_LABEL_SET = new Set(EXPRESSION_LABELS);
    // v0.5.0 presence semantics: in-scene evidence for name-regex hits, and
    // explicit departures. A bare mention never summons a chip.
    const PRESENT_CUE_RE = /\b(?:says?|said|asks?|asked|replie[sd]|answer(?:s|ed)|murmur(?:s|ed)|whisper(?:s|ed)|mutter(?:s|ed)|calls? out|greets?|greeted|nods?|nodded|smil(?:es|ed|ing)|laugh(?:s|ed|ing)|chuckl(?:es|ed)|sigh(?:s|ed)|shrugs?|frowns?|glanc(?:es|ed|ing)|look(?:s|ed)? (?:up|over|at)|watch(?:es|ed|ing)|step(?:s|ped)? (?:in|inside|closer|forward)|enter(?:s|ed)|arriv(?:es|ed|ing)|walk(?:s|ed)? (?:in|over)|com(?:es|ing) (?:in|over)|came (?:in|over)|join(?:s|ed)|sits?|sat|sitting|seated|settl(?:es|ed)|stands?|stood|standing|lean(?:s|ed|ing)|beside|next to|across from|opposite|waits?|waiting|hand(?:s|ed) (?:her|him|you|them)|holds? out|reach(?:es|ed)|ris(?:es|ing)|rose|turn(?:s|ed) to)\b/i;
    const DEPART_RE = /\b(?:leaves|left|walk(?:s|ed) out|storm(?:s|ed) (?:out|off)|dr(?:ives?|ove) (?:off|away)|departs?|departed|head(?:s|ed) (?:out|off|home)|goodbye|good night)\b/i;
    const PRESENCE_MISS_LIMIT = 3;

    // Per-hex dialogue-span regexes for the mood heuristic, cached.
    const spanRegexCache = new Map(); // hex -> RegExp ('gi')
    function spanRegexFor(hex) {
        let re = spanRegexCache.get(hex);
        if (re === undefined) {
            try {
                re = new RegExp('<font\\s+color="?' + hex + '"?[^>]*>([\\s\\S]*?)</font>', 'gi');
            } catch (e) { re = null; }
            spanRegexCache.set(hex, re);
        }
        return re;
    }

    // ------------------------------------------------------------------
    // Shared state
    // ------------------------------------------------------------------

    // Dedupe state: never re-issue /bg or /costume for an unchanged value.
    let lastBg = null;
    let lastBgGraded = false;   // last applied bg is a graded (-night/-rain/-dusk) pick
    let lastCostume = null;     // '' = default costume, null = never applied

    const ORIGINAL_TITLE = document.title;
    let lastParsedDate = null;
    let lastParsedLoc = null;
    let lastActivityTs = Date.now();
    let lastIdleSwapTs = 0;
    let generating = false;
    let idleTimer = null;
    let genHooksAttached = false;
    let mapPreloaded = false;
    let biosPromise = null;
    const neutralVariantCache = {};
    let trailDateKey = null;
    let trailLocs = [];
    let lastOverlayState = null;   // weather overlay only touches the DOM on change
    let lastSpriteFilterState = null;
    let conflicts = { prome: false, weatherCycle: false }; // compat guards
    const castPresence = new Map(); // key -> miss count (0 = seen this message)
    let presenceLoc = null;

    // Timer registry — every setTimeout is tracked so CHAT_CHANGED and page
    // hide can clear them (audit item 5).
    const pendingTimeouts = new Set();
    function sdTimeout(fn, ms) {
        const id = setTimeout(function () {
            pendingTimeouts.delete(id);
            fn();
        }, ms);
        pendingTimeouts.add(id);
        return id;
    }
    function clearAllTimeouts() {
        for (const id of pendingTimeouts) clearTimeout(id);
        pendingTimeouts.clear();
    }

    // rAF write batcher — all per-event DOM writes flush in ONE frame (item 3).
    let rafQueue = [];
    let rafScheduled = false;
    function queueDom(fn) {
        rafQueue.push(fn);
        if (!rafScheduled) {
            rafScheduled = true;
            requestAnimationFrame(function () {
                rafScheduled = false;
                const q = rafQueue;
                rafQueue = [];
                for (const f of q) {
                    try { f(); } catch (e) { console.error(`${LOG} dom write failed`, e); }
                }
            });
        }
    }

    // ------------------------------------------------------------------
    // Settings plumbing + migration
    // ------------------------------------------------------------------

    function migrateSettings(s) {
        try {
            if (!Array.isArray(s.places)) s.places = [];
            // v0.3.x flat backgroundMap rows -> Place cards (day slot only).
            if (Array.isArray(s.backgroundMap) && s.backgroundMap.length) {
                for (const e of s.backgroundMap) {
                    if (!e || !e.pattern || !e.background) continue;
                    s.places.push({
                        name: prettyNameFromPattern(e.pattern) || e.background,
                        pattern: e.pattern,
                        bio: '',
                        slots: { day: e.background, night: '', dusk: '', rain: '', seasonal: '' },
                        seasonalMonth: 12,
                    });
                }
                s.backgroundMap = [];
                console.log(`${LOG} migrated ${s.places.length} background-map rows into place cards`);
            }
            // 0.5.1: chipSize changed from px to vh.
            if (Number(s.chipSize) > 40) s.chipSize = defaultSettings.chipSize;
            // Cast members gain optional fields.
            if (Array.isArray(s.cast)) {
                for (const m of s.cast) {
                    if (m.bio === undefined) m.bio = '';
                    if (m.avatar === undefined) m.avatar = '';
                    if (m.moodVariants === undefined) m.moodVariants = false;
                }
            }
        } catch (e) {
            console.error(`${LOG} settings migration failed`, e);
        }
    }

    function prettyNameFromPattern(pattern) {
        try {
            return String(pattern).split('|')[0]
                .replace(/[\\^$.*+?()[\]{}]/g, ' ')
                .replace(WS_RE, ' ').trim()
                .replace(/^\w/, function (c) { return c.toUpperCase(); });
        } catch (e) { return ''; }
    }

    function getSettings() {
        const ctx = SillyTavern.getContext();
        const store = ctx.extensionSettings;
        if (!store[MODULE]) {
            store[MODULE] = structuredClone(defaultSettings);
        }
        for (const key of Object.keys(defaultSettings)) {
            if (store[MODULE][key] === undefined) {
                store[MODULE][key] = structuredClone(defaultSettings[key]);
            }
        }
        return store[MODULE];
    }

    function saveSettings() {
        SillyTavern.getContext().saveSettingsDebounced();
    }

    // ------------------------------------------------------------------
    // v0.5.0 — per-chat state in ST chat metadata (travels with the chat
    // file across devices and branches); quietly no-ops when the metadata
    // APIs are missing.
    // ------------------------------------------------------------------

    function chatMeta(create) {
        try {
            const ctx = SillyTavern.getContext();
            const md = ctx.chatMetadata;
            if (!md) return null;
            if (!md[MODULE] && create) md[MODULE] = {};
            return md[MODULE] || null;
        } catch (e) { return null; }
    }

    function saveMeta() {
        try {
            const ctx = SillyTavern.getContext();
            if (typeof ctx.saveMetadataDebounced === 'function') ctx.saveMetadataDebounced();
        } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // Parsing — ONE pass per event (audit item 1)
    // ------------------------------------------------------------------

    const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
        'july', 'august', 'september', 'october', 'november', 'december'];

    function monthToNumber(raw) {
        if (raw == null) return null;
        const asNum = parseInt(raw, 10);
        if (!Number.isNaN(asNum)) {
            return (asNum >= 1 && asNum <= 12) ? asNum : null;
        }
        const idx = MONTHS.indexOf(String(raw).trim().toLowerCase());
        return idx >= 0 ? idx + 1 : null;
    }

    function parseHourFromMatch(m) {
        if (!m) return null;
        let hour = parseInt(m[1], 10);
        if (Number.isNaN(hour)) return null;
        const meridiem = m[3] ? m[3].toUpperCase() : null;
        if (meridiem) {
            if (hour < 1 || hour > 12) return null;
            if (meridiem === 'PM' && hour !== 12) hour += 12;
            if (meridiem === 'AM' && hour === 12) hour = 0;
        } else {
            if (hour < 0 || hour > 23) return null;
        }
        return hour;
    }

    function parseDateFromText(text, settings) {
        const re = compileRegex(settings.dateRegex);
        if (!re || !text) return null;
        const m = re.exec(text);
        if (!m) return null;
        const month = monthToNumber(m[1]);
        const year = parseInt(m[3], 10);
        if (!month || Number.isNaN(year)) return null;
        const day = parseInt(m[2], 10);
        return { month, day: (day >= 1 && day <= 31) ? day : null, year };
    }

    /**
     * Parse the scene header ONCE for an event. Returns:
     * { text, lower, location, headerLine, hour, timeMatch, date, weather,
     *   raining, state } — every downstream feature reads from this object
     * instead of re-scanning the message.
     */
    function parseScene(rawText, settings) {
        const text = (rawText && rawText.length > MAX_SCAN)
            ? rawText.slice(0, MAX_SCAN) : (rawText || '');
        const scene = {
            text,
            lower: text.toLowerCase(),
            location: null, headerLine: null,
            hour: null, timeMatch: null,
            date: null, weather: null,
            raining: false, state: 'neutral',
        };
        if (!text) return scene;
        const locRe = compileRegex(settings.locationRegex);
        if (locRe) {
            const m = locRe.exec(text);
            if (m && m[1]) scene.location = m[1].trim();
            if (scene.location) {
                // Header line = the first line the location regex matches.
                for (const line of text.split('\n')) {
                    if (locRe.test(line)) { scene.headerLine = line.trim(); break; }
                }
            }
        }
        const timeRe = compileRegex(settings.timeRegex);
        if (timeRe) {
            scene.timeMatch = timeRe.exec(text);
            scene.hour = parseHourFromMatch(scene.timeMatch);
        }
        scene.date = parseDateFromText(text, settings);
        if (scene.headerLine) {
            const wxRe = compileRegex(settings.weatherRegex);
            const m = wxRe ? wxRe.exec(scene.headerLine) : null;
            if (m && m[1]) {
                const value = m[1].trim();
                // Don't echo the location segment back as "weather".
                if (value && !(locRe && locRe.test(value))) scene.weather = value;
            }
        }
        if (scene.weather) {
            const rainRe = compileRegex(settings.rainRegex);
            scene.raining = Boolean(rainRe && rainRe.test(scene.weather.toLowerCase()));
        }
        const h = scene.hour;
        const night = h !== null && (h >= 19 || h < 6);
        const dusk = h !== null && h >= 17 && h < 19;
        scene.state = night ? 'night' : (scene.raining ? 'rain' : (dusk ? 'dusk' : 'neutral'));
        return scene;
    }

    // ------------------------------------------------------------------
    // Feature logic (pure functions — also driven by the "Test" button)
    // ------------------------------------------------------------------

    /**
     * First place card whose pattern matches the location; the slot follows
     * the scene (seasonal month > night > rain > dusk > day; empty slots fall
     * back to day). Returns { file, graded } or null. Legacy backgroundMap
     * rows (imported JSON) are checked after the places.
     */
    function pickBackground(location, scene, settings) {
        for (const place of settings.places) {
            const re = compileRegex(place.pattern);
            if (!re || !re.test(location)) continue;
            const slots = place.slots || {};
            let file = null;
            let graded = false;
            if (scene && scene.date && slots.seasonal
                && scene.date.month === (place.seasonalMonth || 12)) {
                file = slots.seasonal;
            }
            if (!file && scene) {
                if (scene.state === 'night' && slots.night) { file = slots.night; graded = true; }
                else if (scene.state === 'rain' && slots.rain) { file = slots.rain; graded = true; }
                else if (scene.state === 'dusk' && slots.dusk) { file = slots.dusk; graded = true; }
            }
            if (!file) { file = slots.day || null; graded = false; }
            if (file) return { file, graded };
        }
        for (const entry of settings.backgroundMap) {
            const re = compileRegex(entry.pattern);
            if (re && re.test(location)) return { file: entry.background, graded: false };
        }
        return null;
    }

    /** Apply era rules, then seasonal swaps, to an already-picked background. */
    function applyVariants(bg, location, date, settings) {
        let result = bg;
        if (settings.enableEra && date) {
            for (const rule of settings.eraRules) {
                const re = compileRegex(rule.pattern);
                if (date.year >= rule.minYear && result === rule.from && (!rule.pattern || (re && re.test(location)))) {
                    result = rule.to;
                    break;
                }
            }
        }
        if (settings.enableSeasonal && date) {
            for (const swap of settings.seasonalMap) {
                if (date.month === swap.month && result === swap.from) {
                    result = swap.to;
                    break;
                }
            }
        }
        return result;
    }

    /** True if hour falls in [fromHour, toHour), wrapping midnight if needed. */
    function hourInWindow(hour, fromHour, toHour) {
        if (fromHour === toHour) return true;
        if (fromHour < toHour) return hour >= fromHour && hour < toHour;
        return hour >= fromHour || hour < toHour;
    }

    function pickCostume(location, hour, settings) {
        if (hour === null) return null;
        for (const rule of settings.costumeRules) {
            const re = compileRegex(rule.pattern);
            if (re && re.test(location) && hourInWindow(hour, rule.fromHour, rule.toHour)) {
                return rule.costume || '';
            }
        }
        return '';
    }

    /**
     * One pass over the cast (audit item 1): presence + last-hex position +
     * speaker, computed together. Returns { present: [{member,pos}], speakerKey }.
     */
    function analyzeCast(scene, settings) {
        const present = [];
        let speakerKey = null;
        let speakerPos = -1;
        if (!scene.text) return { present, speakerKey };
        const lower = scene.lower;
        for (const member of settings.cast) {
            let pos = -1;
            let hit = false;
            let hitAt = -1;
            if (member.colorHex) {
                pos = lower.lastIndexOf(member.colorHex.toLowerCase());
                if (pos >= 0) { hit = true; hitAt = pos; }
            }
            // v0.5.0: a name-regex match alone is only a MENTION — it needs
            // a presence cue (speech attribution / physical action) nearby
            // to count as being in the scene.
            if (!hit && member.nameRegex) {
                const re = compileRegex(member.nameRegex);
                const m = re ? re.exec(scene.text) : null;
                if (m) {
                    const win = scene.text.slice(Math.max(0, m.index - 40),
                        Math.min(scene.text.length, m.index + m[0].length + 160));
                    if (PRESENT_CUE_RE.test(win)) { hit = true; hitAt = m.index; }
                }
            }
            if (hit) {
                // Explicit departure right after the evidence = gone now.
                const win = scene.text.slice(hitAt,
                    Math.min(scene.text.length, hitAt + 160));
                if (DEPART_RE.test(win)) {
                    castPresence.delete(member.key);
                    continue;
                }
                present.push({ member, pos });
            }
            if (member.colorHex && pos > speakerPos) {
                speakerPos = pos;
                speakerKey = member.key;
            }
        }
        return { present, speakerKey };
    }

    function persistPresence() {
        try {
            const meta = chatMeta(true);
            if (!meta) return;
            const obj = {};
            for (const [k, v] of castPresence) obj[k] = v;
            meta.presence = obj;
            meta.presenceLoc = presenceLoc;
            saveMeta();
        } catch (e) { /* ignore */ }
    }

    // Deterministic rebuild on CHAT_CHANGED: metadata first, else re-derive
    // from the last few AI messages of the loaded chat (pure text parsing).
    function seedPresenceFromChat(settings) {
        castPresence.clear();
        presenceLoc = null;
        try {
            const meta = chatMeta(false);
            if (meta && meta.presence && typeof meta.presence === 'object') {
                for (const k of Object.keys(meta.presence)) {
                    const v = Number(meta.presence[k]);
                    if (Number.isFinite(v) && v >= 0 && v < PRESENCE_MISS_LIMIT) castPresence.set(k, v);
                }
                presenceLoc = meta.presenceLoc || null;
                return;
            }
        } catch (e) { /* fall through */ }
        try {
            const ctx = SillyTavern.getContext();
            const chat = ctx.chat || [];
            const msgs = [];
            for (let i = chat.length - 1; i >= 0 && msgs.length < PRESENCE_MISS_LIMIT; i--) {
                const m = chat[i];
                if (m && !m.is_user && !m.is_system && m.mes) msgs.push(m.mes);
            }
            for (let n = msgs.length - 1; n >= 0; n--) {
                const scene = parseScene(msgs[n], settings);
                if (n === 0 && scene.location) presenceLoc = scene.location;
                const { present } = analyzeCast(scene, settings);
                for (const p of present) castPresence.set(p.member.key, n);
            }
        } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // Cast moods
    // ------------------------------------------------------------------

    const MOODS = ['happy', 'angry', 'sad'];
    const MOOD_EMOJI = { happy: '😊', angry: '😠', sad: '😢' };

    function detectMood(text, member, settings) {
        try {
            if (!text) return 'neutral';
            let corpus = '';
            if (member.colorHex) {
                const spanRe = spanRegexFor(member.colorHex);
                if (spanRe) {
                    spanRe.lastIndex = 0;
                    let m;
                    while ((m = spanRe.exec(text)) !== null) {
                        corpus += ' ' + m[1];
                        corpus += ' ' + text.slice(Math.max(0, m.index - 120),
                            Math.min(text.length, m.index + m[0].length + 120));
                    }
                }
            }
            if (!corpus && member.nameRegex) {
                const re = compileRegex(member.nameRegex, 'gi');
                if (re) {
                    re.lastIndex = 0;
                    let m;
                    while ((m = re.exec(text)) !== null) {
                        corpus += ' ' + text.slice(Math.max(0, m.index - 120),
                            Math.min(text.length, m.index + m[0].length + 120));
                        if (m.index === re.lastIndex) re.lastIndex++;
                    }
                }
            }
            if (!corpus) return 'neutral';
            const low = corpus.toLowerCase();
            let best = 'neutral';
            let bestScore = 0;
            for (const mood of MOODS) {
                const source = settings.moodKeywords?.[mood];
                if (!source) continue;
                const re = compileRegex(source, 'g');
                if (!re) continue;
                const score = (low.match(re) || []).length; // .match ignores lastIndex
                if (score > bestScore) { bestScore = score; best = mood; }
            }
            return best;
        } catch (e) {
            return 'neutral';
        }
    }

    // ------------------------------------------------------------------
    // Scene HUD
    // ------------------------------------------------------------------

    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MON_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function buildHudParts(scene) {
        if (!scene.headerLine) return null;
        const parts = [];
        if (scene.timeMatch) parts.push(scene.timeMatch[0].replace(WS_RE, ' ').trim());
        const date = scene.date;
        if (date) {
            if (date.day) {
                const js = new Date(date.year, date.month - 1, date.day);
                parts.push(`${DAY_NAMES[js.getDay()]} ${MON_NAMES[date.month - 1]} ${date.day} ${date.year}`);
            } else {
                parts.push(`${MON_NAMES[date.month - 1]} ${date.year}`);
            }
        }
        if (scene.weather) parts.push(scene.weather);
        return parts.length ? parts : null;
    }

    function updateSceneHud(scene, settings) {
        try {
            let hud = document.getElementById('scene-director-hud');
            const parts = settings.enableHud ? buildHudParts(scene) : null;
            if (!parts) {
                // Feature off (or no header): zero cost — no element created.
                if (hud) queueDom(function () { hud.style.display = 'none'; });
                return;
            }
            queueDom(function () {
                if (!hud) {
                    hud = document.createElement('div');
                    hud.id = 'scene-director-hud';
                    document.body.appendChild(hud);
                    applyHudAppearance(settings);
                }
                hud.style.display = '';
                const joined = parts.join(' · ');
                if (hud.textContent !== joined) hud.textContent = joined;
            });
        } catch (e) {
            console.error(`${LOG} scene HUD failed`, e);
        }
    }

    // ------------------------------------------------------------------
    // Day trail & life counters — shown as the HUD hover tooltip
    // ------------------------------------------------------------------

    function updateDayTrail(date, location, settings) {
        try {
            if (!settings.enableDayTrail || !location) return;
            const key = date ? `${date.year}-${date.month}-${date.day}` : trailDateKey;
            if (key !== trailDateKey) {
                trailDateKey = key;
                trailLocs = [];
            }
            if (!trailLocs.includes(location)) {
                trailLocs.push(location);
                // v0.5.0: the trail travels with the chat file.
                const meta = chatMeta(true);
                if (meta) {
                    meta.trailDateKey = trailDateKey;
                    meta.trailLocs = trailLocs.slice();
                    saveMeta();
                }
            }
        } catch (e) { /* ignore */ }
    }

    // v0.5.0: restore the day trail on chat open — metadata first, else a
    // deterministic rescan of the last ~20 messages (pure text parsing).
    function restoreTrail(settings) {
        trailDateKey = null;
        trailLocs = [];
        try {
            const meta = chatMeta(false);
            if (meta && Array.isArray(meta.trailLocs) && meta.trailLocs.length) {
                trailDateKey = meta.trailDateKey || null;
                trailLocs = meta.trailLocs.slice();
                return;
            }
        } catch (e) { /* fall through */ }
        try {
            if (!settings.enableDayTrail) return;
            const ctx = SillyTavern.getContext();
            const chat = ctx.chat || [];
            const start = Math.max(0, chat.length - 20);
            for (let i = start; i < chat.length; i++) {
                const m = chat[i];
                if (!m || m.is_user || m.is_system || !m.mes) continue;
                const scene = parseScene(m.mes, settings);
                if (scene.location) updateDayTrail(scene.date, scene.location, settings);
            }
        } catch (e) { /* ignore */ }
    }

    function pad2(n) { return String(n).padStart(2, '0'); }

    function buildCounters(date, settings) {
        try {
            if (!settings.enableCounters || !date || !date.day) return '';
            const DAY = 86400000;
            const story = Date.UTC(date.year, date.month - 1, date.day);
            const parts = [];
            for (const c of settings.counters) {
                const anchor = Date.parse(c.date + 'T00:00:00Z');
                if (Number.isNaN(anchor)) continue;
                const days = Math.floor((story - anchor) / DAY);
                if (days < 0) continue;
                const emoji = c.emoji ? c.emoji + ' ' : '';
                if (c.mode === 'weeks') {
                    parts.push(`${emoji}${Math.floor(days / 7)}w${days % 7}d`);
                } else {
                    parts.push(`${emoji}${days} day${days === 1 ? '' : 's'}`);
                }
            }
            return parts.join(' · ');
        } catch (e) {
            return '';
        }
    }

    function updateHudTooltip(date, settings) {
        try {
            const lines = [];
            if (settings.enableDayTrail && trailLocs.length) lines.push(trailLocs.join(' → '));
            const counters = buildCounters(date, settings);
            if (counters) lines.push(counters);
            const title = lines.join('\n');
            queueDom(function () {
                const hud = document.getElementById('scene-director-hud');
                if (hud && hud.title !== title) hud.title = title;
            });
        } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // Sprite crossfade — observer scoped to #expression-holder only, and
    // disconnected + re-attached on CHAT_CHANGED (audit item 5).
    // ------------------------------------------------------------------

    let spriteObserver = null;
    let lastSpriteSrc = null;

    function currentSpriteImg() {
        return document.getElementById('expression-image')
            || document.querySelector('#expression-holder img:not(.scene-director-sprite-ghost)');
    }

    function teardownSpriteCrossfade() {
        if (spriteObserver) {
            try { spriteObserver.disconnect(); } catch (e) { /* ignore */ }
            spriteObserver = null;
        }
        lastSpriteSrc = null;
    }

    function setupSpriteCrossfade() {
        try {
            if (spriteObserver) return;
            const holder = document.getElementById('expression-holder');
            const img = currentSpriteImg();
            if (!holder && !img) return; // sprite UI absent — retry later
            const target = holder || img.parentElement || img;
            lastSpriteSrc = img ? img.src : null;
            spriteObserver = new MutationObserver(function () {
                try {
                    const cur = currentSpriteImg();
                    if (!cur || !cur.src || cur.src === lastSpriteSrc) return;
                    const prev = lastSpriteSrc;
                    lastSpriteSrc = cur.src;
                    if (!prev) return;
                    if (!getSettings().enableCrossfade) return;
                    if (cur.classList.contains('expression-animating')
                        || cur.classList.contains('expression-clone')
                        || (target.querySelector && target.querySelector('.expression-animating, .expression-clone'))) {
                        return;
                    }
                    const rect = cur.getBoundingClientRect();
                    if (!rect.width || !rect.height) return;
                    const ghost = document.createElement('img');
                    ghost.className = 'scene-director-sprite-ghost';
                    ghost.src = prev;
                    // Static placement (set once, not animated) — only opacity animates.
                    ghost.style.left = rect.left + 'px';
                    ghost.style.top = rect.top + 'px';
                    ghost.style.width = rect.width + 'px';
                    ghost.style.height = rect.height + 'px';
                    ghost.style.opacity = '1';
                    document.body.appendChild(ghost);
                    requestAnimationFrame(function () { ghost.style.opacity = '0'; });
                    sdTimeout(function () { try { ghost.remove(); } catch (e) { /* ignore */ } }, 350);
                } catch (e) { /* never break on sprite changes */ }
            });
            spriteObserver.observe(target, {
                attributes: true,
                attributeFilter: ['src'],
                childList: true,
                subtree: true,
            });
            console.log(`${LOG} sprite crossfade attached`);
        } catch (e) {
            console.error(`${LOG} sprite crossfade setup failed`, e);
        }
    }

    // ------------------------------------------------------------------
    // Weather & lighting overlay — tint set ONCE per scene-state change;
    // only opacity is transitioned (audit item 4). Auto-disabled when the
    // Prome VN Extension is detected (audit item 8).
    // ------------------------------------------------------------------

    function weatherFxActive(settings) {
        return settings.enableWeatherFx && !conflicts.prome;
    }

    function updateWeatherOverlay(scene, settings) {
        try {
            let ov = document.getElementById('scene-director-wx-overlay');
            if (!weatherFxActive(settings)) {
                if (ov) queueDom(function () { ov.remove(); });
                lastOverlayState = null;
                return;
            }
            const night = scene && scene.state === 'night';
            const dusk = scene && scene.state === 'dusk';
            const raining = Boolean(scene && scene.raining);
            const variantApplied = lastBgGraded || Boolean(lastBg && GRADED_VARIANT_RE.test(lastBg));
            let tint = '';
            if (!variantApplied) {
                if (night) tint = 'rgba(10,15,40,0.45)';
                else if (raining) tint = 'rgba(40,60,90,0.35)';
                else if (dusk) tint = 'rgba(255,180,80,0.18)';
            }
            const stateKey = tint + '|' + raining;
            if (stateKey === lastOverlayState && ov) return; // set once per state change
            lastOverlayState = stateKey;
            queueDom(function () {
                let el = document.getElementById('scene-director-wx-overlay');
                if (!el) {
                    if (!tint && !raining) return; // nothing to show — create nothing
                    el = document.createElement('div');
                    el.id = 'scene-director-wx-overlay';
                    const rain = document.createElement('div');
                    rain.id = 'scene-director-wx-rain';
                    el.appendChild(rain);
                    document.body.appendChild(el);
                }
                // backgroundColor set instantly; the 1s grade is an opacity
                // transition (compositor-only).
                if (tint) {
                    el.style.backgroundColor = tint;
                    el.style.opacity = '1';
                } else {
                    el.style.opacity = '0';
                }
                const rainEl = document.getElementById('scene-director-wx-rain');
                if (rainEl) rainEl.style.display = raining ? 'block' : 'none';
            });
        } catch (e) {
            console.error(`${LOG} weather overlay failed`, e);
        }
    }

    // ------------------------------------------------------------------
    // Sprite shadow & lighting tint — filter set once per scene-state change
    // ------------------------------------------------------------------

    function updateSpriteFilter(state, settings) {
        try {
            const key = state + '|' + settings.enableSpriteShadow + '|' + settings.enableSpriteTint;
            if (key === lastSpriteFilterState) return;
            lastSpriteFilterState = key;
            const parts = [];
            if (settings.enableSpriteShadow) {
                parts.push('drop-shadow(0 12px 18px rgba(0,0,0,.45))');
            }
            if (settings.enableSpriteTint) {
                if (state === 'night') parts.push('brightness(.75) saturate(.85)');
                else if (state === 'dusk') parts.push('sepia(.25) brightness(.9)');
                else if (state === 'rain') parts.push('brightness(.8) saturate(.7)');
            }
            const value = parts.length ? parts.join(' ') : 'none';
            queueDom(function () {
                document.documentElement.style.setProperty('--scene-director-sprite-filter', value);
            });
        } catch (e) {
            console.error(`${LOG} sprite filter failed`, e);
        }
    }

    // ------------------------------------------------------------------
    // Background crossfade
    // ------------------------------------------------------------------

    async function applyBackground(ctx, bg, settings) {
        let issued = false;
        try {
            if (!settings.enableBgCrossfade) {
                await runCommand(ctx, `/bg ${bg}`);
                return;
            }
            let fade = document.getElementById('scene-director-bg-fade');
            if (!fade) {
                fade = document.createElement('div');
                fade.id = 'scene-director-bg-fade';
                document.body.appendChild(fade);
            }
            fade.style.transition = 'opacity 0.2s ease';
            fade.style.opacity = '0.6';
            await new Promise(function (r) { sdTimeout(r, 200); });
            await runCommand(ctx, `/bg ${bg}`);
            issued = true;
            fade.style.transition = 'opacity 0.3s ease';
            fade.style.opacity = '0';
        } catch (e) {
            console.error(`${LOG} bg crossfade failed`, e);
            try {
                if (!issued) await runCommand(ctx, `/bg ${bg}`);
            } catch (e2) { /* ignore */ }
            try {
                const fade = document.getElementById('scene-director-bg-fade');
                if (fade) fade.style.opacity = '0';
            } catch (e3) { /* ignore */ }
        }
    }

    // ------------------------------------------------------------------
    // Typing presence — generation hooks attached lazily (audit item 7):
    // only when Typing Presence or Idle Presence is enabled.
    // ------------------------------------------------------------------

    function onGenerationStart() {
        try {
            generating = true;
            lastActivityTs = Date.now();
            const settings = getSettings();
            if (!settings.enableTypingPresence) return;
            document.body.classList.add('scene-director-typing');
            const img = currentSpriteImg();
            if (!img) return;
            const rect = img.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            let bubble = document.getElementById('scene-director-typing-bubble');
            if (!bubble) {
                bubble = document.createElement('div');
                bubble.id = 'scene-director-typing-bubble';
                bubble.className = 'scene-director-mood-bubble';
                bubble.textContent = '…';
                document.body.appendChild(bubble);
            }
            bubble.style.position = 'fixed';
            bubble.style.transform = 'none';
            bubble.style.left = (rect.left + rect.width * 0.6) + 'px';
            bubble.style.top = Math.max(4, rect.top + rect.height * 0.08) + 'px';
            bubble.style.display = '';
        } catch (e) {
            console.error(`${LOG} typing presence failed`, e);
        }
    }

    function onGenerationEnd() {
        try {
            generating = false;
            lastActivityTs = Date.now();
            document.body.classList.remove('scene-director-typing');
            const bubble = document.getElementById('scene-director-typing-bubble');
            if (bubble) bubble.style.display = 'none';
        } catch (e) { /* ignore */ }
    }

    function ensureGenHooks(ctx) {
        if (genHooksAttached) return;
        try {
            const et = ctx.eventTypes || ctx.event_types;
            if (et.GENERATION_STARTED) ctx.eventSource.on(et.GENERATION_STARTED, onGenerationStart);
            if (et.GENERATION_ENDED) ctx.eventSource.on(et.GENERATION_ENDED, onGenerationEnd);
            if (et.GENERATION_STOPPED) ctx.eventSource.on(et.GENERATION_STOPPED, onGenerationEnd);
            genHooksAttached = true;
        } catch (e) {
            console.error(`${LOG} generation hooks failed`, e);
        }
    }

    // ------------------------------------------------------------------
    // Ken Burns drift — transform-only animation on #bg1. Auto-disabled when
    // st-weather-cycle is detected (audit item 8).
    // ------------------------------------------------------------------

    function kenBurnsActive(settings) {
        return settings.enableKenBurns && !conflicts.weatherCycle;
    }

    function updateKenBurns(settings) {
        try {
            const bgEl = document.getElementById('bg1');
            if (!bgEl) return;
            const on = kenBurnsActive(settings);
            const secs = (Number(settings.kenBurnsSeconds) || 75) + 's';
            if (bgEl.classList.contains('scene-director-kenburns') === on
                && (!on || bgEl.style.animationDuration === secs)) return;
            queueDom(function () {
                bgEl.classList.toggle('scene-director-kenburns', on);
                bgEl.style.animationDuration = on ? secs : '';
            });
        } catch (e) {
            console.error(`${LOG} ken burns failed`, e);
        }
    }

    // ------------------------------------------------------------------
    // Fire flicker
    // ------------------------------------------------------------------

    function updateFireOverlay(settings) {
        try {
            const re = compileRegex(settings.fireRegex);
            const on = Boolean(settings.enableFireFlicker && lastBg && re && re.test(lastBg));
            const ov = document.getElementById('scene-director-fire-overlay');
            if (!ov && !on) return; // off + absent = zero cost
            queueDom(function () {
                let el = document.getElementById('scene-director-fire-overlay');
                if (!el) {
                    if (!on) return;
                    el = document.createElement('div');
                    el.id = 'scene-director-fire-overlay';
                    document.body.appendChild(el);
                }
                el.style.display = on ? 'block' : 'none';
            });
        } catch (e) {
            console.error(`${LOG} fire flicker failed`, e);
        }
    }

    // ------------------------------------------------------------------
    // Bio cards
    // ------------------------------------------------------------------

    function fetchBios(settings) {
        if (!biosPromise) {
            const url = `/characters/${encodeURIComponent(settings.castFolder)}/npc/bios.json`;
            biosPromise = fetch(url)
                .then(function (r) { return r.ok ? r.json() : null; })
                .catch(function () { return null; });
        }
        return biosPromise;
    }

    function showBioCard(chipEl, label, line) {
        try {
            let card = document.getElementById('scene-director-bio-card');
            if (!card) {
                card = document.createElement('div');
                card.id = 'scene-director-bio-card';
                document.body.appendChild(card);
            }
            card.innerHTML = '';
            const name = document.createElement('b');
            name.textContent = label;
            card.appendChild(name);
            card.appendChild(document.createTextNode(line));
            card.style.display = 'block';
            const rect = chipEl.getBoundingClientRect();
            card.style.left = Math.max(6, rect.left) + 'px';
            card.style.top = Math.max(6, rect.top - card.offsetHeight - 10) + 'px';
        } catch (e) { /* ignore */ }
    }

    function hideBioCard() {
        try {
            const card = document.getElementById('scene-director-bio-card');
            if (card) card.style.display = 'none';
        } catch (e) { /* ignore */ }
    }

    /** One-line bio for a member: card bio first, then npc/bios.json. */
    function bioLineFor(member, settings) {
        if (member.bio) return Promise.resolve(member.bio);
        return fetchBios(settings).then(function (bios) {
            return (bios && bios[member.key]) ? String(bios[member.key]) : null;
        });
    }

    // ------------------------------------------------------------------
    // Photo mode
    // ------------------------------------------------------------------

    function titlePrefix(settings) {
        return settings.titlePrefix || settings.castFolder || 'Scene';
    }

    function loadImageAsync(url) {
        return new Promise(function (resolve, reject) {
            const im = new Image();
            im.onload = function () { resolve(im); };
            im.onerror = function () { reject(new Error('image load failed: ' + url)); };
            im.src = url;
        });
    }

    function roundRectPath(g, x, y, w, h, r) {
        g.beginPath();
        g.moveTo(x + r, y);
        g.arcTo(x + w, y, x + w, y + h, r);
        g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r);
        g.arcTo(x, y, x + w, y, r);
        g.closePath();
    }

    async function takePhoto() {
        try {
            const settings = getSettings();
            const W = window.innerWidth;
            const H = window.innerHeight;
            const canvas = document.createElement('canvas');
            canvas.width = W;
            canvas.height = H;
            const g = canvas.getContext('2d');
            g.fillStyle = '#000';
            g.fillRect(0, 0, W, H);
            const bgEl = document.getElementById('bg1');
            if (bgEl) {
                const m = CSS_URL_RE.exec(getComputedStyle(bgEl).backgroundImage || '');
                if (m) {
                    try {
                        const im = await loadImageAsync(m[1]);
                        const s = Math.max(W / im.width, H / im.height);
                        g.drawImage(im, (W - im.width * s) / 2, (H - im.height * s) / 2,
                            im.width * s, im.height * s);
                    } catch (e) { /* keep black ground */ }
                }
            }
            const ov = document.getElementById('scene-director-wx-overlay');
            if (ov && ov.style.opacity !== '0') {
                const c = getComputedStyle(ov).backgroundColor;
                if (c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') {
                    g.fillStyle = c;
                    g.fillRect(0, 0, W, H);
                }
            }
            const sprite = currentSpriteImg();
            if (sprite && sprite.src) {
                const rect = sprite.getBoundingClientRect();
                if (rect.width && rect.height) {
                    try {
                        const im = await loadImageAsync(sprite.src);
                        g.drawImage(im, rect.left, rect.top, rect.width, rect.height);
                    } catch (e) { /* sprite optional */ }
                }
            }
            const hud = document.getElementById('scene-director-hud');
            if (hud && hud.textContent && hud.style.display !== 'none') {
                const text = hud.textContent;
                g.font = '14px sans-serif';
                const tw = g.measureText(text).width;
                g.fillStyle = 'rgba(15,15,22,0.72)';
                roundRectPath(g, W - tw - 36, 10, tw + 24, 27, 13);
                g.fill();
                g.fillStyle = '#fff';
                g.fillText(text, W - tw - 24, 28);
            }
            const dateStr = (lastParsedDate && lastParsedDate.day)
                ? `${lastParsedDate.year}-${pad2(lastParsedDate.month)}-${pad2(lastParsedDate.day)}`
                : new Date().toISOString().slice(0, 10);
            const locStr = (lastParsedLoc || 'scene').replace(FILENAME_UNSAFE_RE, '');
            const name = `${titlePrefix(settings)} — ${dateStr} — ${locStr}.png`;
            canvas.toBlob(function (blob) {
                try {
                    if (!blob) throw new Error('toBlob returned null (tainted canvas?)');
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = name;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    sdTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
                } catch (e) {
                    console.error(`${LOG} photo save failed`, e);
                    if (typeof toastr !== 'undefined') toastr.warning('Photo save failed: ' + e.message);
                }
            }, 'image/png');
        } catch (e) {
            console.error(`${LOG} photo mode failed`, e);
            if (typeof toastr !== 'undefined') toastr.warning('Photo failed: ' + (e && e.message || e));
        }
    }

    function updatePhotoButton(settings) {
        try {
            const btn = document.getElementById('scene-director-photo-btn');
            if (!settings.enablePhotoMode) {
                // Off = zero DOM, zero listeners.
                if (btn) queueDom(function () { btn.remove(); });
                return;
            }
            if (btn) return;
            queueDom(function () {
                if (document.getElementById('scene-director-photo-btn')) return;
                const el = document.createElement('div');
                el.id = 'scene-director-photo-btn';
                el.textContent = '📷';
                el.title = 'Save a scene photo';
                el.addEventListener('click', function () { takePhoto(); });
                document.body.appendChild(el);
            });
        } catch (e) {
            console.error(`${LOG} photo button failed`, e);
        }
    }

    // ------------------------------------------------------------------
    // Tab title
    // ------------------------------------------------------------------

    function updateTabTitle(scene, settings) {
        try {
            if (!settings.enableTabTitle) return;
            if (!scene || !scene.location) {
                document.title = ORIGINAL_TITLE;
                return;
            }
            document.title = titlePrefix(settings) + ' — ' + scene.location
                + (scene.timeMatch ? ', ' + scene.timeMatch[0].replace(WS_RE, ' ').trim() : '');
        } catch (e) { /* ignore */ }
    }

    function restoreTabTitle() {
        try { document.title = ORIGINAL_TITLE; } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // Emotion lighting accents
    // ------------------------------------------------------------------

    function fireEmotionAccent(settings) {
        try {
            if (!settings.enableEmotionAccents) return;
            const img = currentSpriteImg();
            if (!img || !img.src) return;
            const file = (img.src.split('/').pop() || '').toLowerCase();
            let cls = null;
            for (const [re, name] of ACCENT_PATTERNS) {
                if (re.test(file)) { cls = name; break; }
            }
            if (!cls) return;
            const div = document.createElement('div');
            div.className = 'scene-director-accent ' + cls;
            document.body.appendChild(div);
            sdTimeout(function () { try { div.remove(); } catch (e) { /* ignore */ } }, 1600);
        } catch (e) {
            console.error(`${LOG} emotion accent failed`, e);
        }
    }

    // ------------------------------------------------------------------
    // Idle presence — interval only runs while the feature is on and the
    // page is visible (audit items 5 + 7).
    // ------------------------------------------------------------------

    function verifyImageUrl(url) {
        return new Promise(function (resolve) {
            const im = new Image();
            im.onload = function () { resolve(url); };
            im.onerror = function () { resolve(null); };
            im.src = url;
        });
    }

    function spriteFolderAndExt(src) {
        const cut = src.lastIndexOf('/');
        const file = src.slice(cut + 1);
        const dot = file.lastIndexOf('.');
        return {
            folder: src.slice(0, cut + 1),
            ext: dot >= 0 ? file.slice(dot).split('?')[0] : '.png',
        };
    }

    function getNeutralVariants(folder, ext) {
        const cacheKey = folder + '|' + ext;
        if (!neutralVariantCache[cacheKey]) {
            const names = ['neutral', 'neutral-1', 'neutral-2', 'neutral-3'];
            neutralVariantCache[cacheKey] = Promise.all(
                names.map(function (n) { return verifyImageUrl(folder + n + ext); })
            ).then(function (urls) { return urls.filter(Boolean); });
        }
        return neutralVariantCache[cacheKey];
    }

    async function idleTick() {
        try {
            const settings = getSettings();
            if (!settings.enableIdlePresence || generating) return;
            const now = Date.now();
            if (now - lastActivityTs < (Number(settings.idleAfterSeconds) || 90) * 1000) return;
            if (now - lastIdleSwapTs < (Number(settings.idleEverySeconds) || 45) * 1000) return;
            const img = currentSpriteImg();
            if (!img || !img.src) return;
            const file = (img.src.split('/').pop() || '').toLowerCase();
            if (!NEUTRAL_FILE_RE.test(file)) return;
            const { folder, ext } = spriteFolderAndExt(img.src);
            const variants = await getNeutralVariants(folder, ext);
            if (!variants || variants.length < 2) return;
            const others = variants.filter(function (u) { return u !== img.src; });
            if (!others.length) return;
            if (generating || Date.now() - lastActivityTs < (Number(settings.idleAfterSeconds) || 90) * 1000) return;
            const cur = currentSpriteImg();
            if (!cur || !NEUTRAL_FILE_RE.test((cur.src.split('/').pop() || '').toLowerCase())) return;
            lastIdleSwapTs = Date.now();
            cur.src = others[Math.floor(Math.random() * others.length)];
        } catch (e) { /* ignore */ }
    }

    function startIdleLoop() {
        try {
            if (idleTimer) return;
            if (document.hidden) return; // resumed by visibilitychange
            idleTimer = setInterval(idleTick, 5000);
        } catch (e) { /* ignore */ }
    }

    function stopIdleLoop() {
        if (idleTimer) {
            clearInterval(idleTimer);
            idleTimer = null;
        }
    }

    // ------------------------------------------------------------------
    // Asset preloading — requestIdleCallback (setTimeout fallback), once per
    // session, skipped entirely on slow / data-saver connections (item 6).
    // ------------------------------------------------------------------

    function connectionIsSlow() {
        try {
            const c = navigator.connection;
            if (!c) return false;
            if (c.saveData) return true;
            if (typeof c.effectiveType === 'string' && c.effectiveType.includes('2g')) return true;
        } catch (e) { /* ignore */ }
        return false;
    }

    function schedulePreload(settings) {
        try {
            if (!settings.enablePreload) return;
            if (connectionIsSlow()) return;
            const run = function () {
                try {
                    if (!mapPreloaded) {
                        mapPreloaded = true;
                        const files = new Set();
                        for (const p of settings.places) {
                            const slots = p.slots || {};
                            for (const k of ['day', 'night', 'dusk', 'rain', 'seasonal']) {
                                if (slots[k]) files.add(slots[k]);
                            }
                        }
                        for (const e of settings.backgroundMap) files.add(e.background);
                        for (const s of settings.seasonalMap) files.add(s.to);
                        for (const r of settings.eraRules) files.add(r.to);
                        files.forEach(function (f) {
                            if (!f) return;
                            const im = new Image();
                            im.src = 'backgrounds/' + encodeURIComponent(f);
                        });
                        console.log(`${LOG} prefetched ${files.size} backgrounds`);
                    }
                    const img = currentSpriteImg();
                    if (img && img.src) {
                        const { folder, ext } = spriteFolderAndExt(img.src);
                        getNeutralVariants(folder, ext);
                    }
                } catch (e) { /* ignore */ }
            };
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(run, { timeout: 10000 });
            } else {
                sdTimeout(run, 5000);
            }
        } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // Cast strip — DIFFED chips (add/remove/update by key), all DOM writes
    // batched in the shared rAF flush (audit item 3).
    // ------------------------------------------------------------------

    // key -> { el, imgEl, bubbleEl, labelEl, mood, speaking, src }
    const castChips = new Map();

    function castStripEl(create) {
        let el = document.getElementById('scene-director-cast-strip');
        if (!el && create) {
            el = document.createElement('div');
            el.id = 'scene-director-cast-strip';
            document.body.appendChild(el);
            applyStripAppearance(getSettings(), el);
        }
        return el;
    }

    // ------------------------------------------------------------------
    // v0.5.0 stage layout — HUD corner, cast strip corner/style/size, and
    // the optional chat-panel glass. Layout as a system: HUD in its corner,
    // the cast strip a COLUMN directly beneath it in a top corner (a row in
    // a bottom corner), the sprite where the expressions extension puts it.
    // ------------------------------------------------------------------

    function applyStripAppearance(settings, elArg) {
        try {
            const el = elArg || document.getElementById('scene-director-cast-strip');
            if (!el) return;
            const pos = settings.castPosition || 'top-right';
            const isTop = pos.startsWith('top');
            const onRight = pos.endsWith('right');
            const hudSameCorner = (settings.hudPosition || 'top-right') === pos;
            const vh = window.innerHeight / 100;
            // 0.5.1: size is RELATIVE TO THE WINDOW (vh, clamped 120px-40vh),
            // never the sprite's pixel height.
            const vhWanted = settings.chipSizeAuto
                ? 28 : Math.max(10, Math.min(40, Number(settings.chipSize) || 28));
            let size = Math.round(vhWanted * vh);
            size = Math.max(120, Math.min(Math.round(40 * vh), size));
            // Cap to the free gutter between #sheld and the viewport edge.
            try {
                const sheld = document.getElementById('sheld');
                if (sheld) {
                    const r = sheld.getBoundingClientRect();
                    const gutter = (onRight ? window.innerWidth - r.right : r.left) - 24;
                    if (gutter >= 60 && gutter < size) size = Math.floor(gutter);
                }
            } catch (e) { /* ignore */ }
            const topPx = isTop ? (hudSameCorner ? 56 : 44) : 12;
            el.style.left = onRight ? 'auto' : '12px';
            el.style.right = onRight ? '12px' : 'auto';
            el.style.top = isTop ? topPx + 'px' : 'auto';
            el.style.bottom = isTop ? 'auto' : '12px';
            el.style.flexDirection = isTop ? 'column' : 'row';
            el.style.alignItems = onRight ? 'flex-end' : 'flex-start';
            el.style.flexWrap = isTop ? 'nowrap' : 'wrap';
            el.style.maxWidth = isTop ? '' : 'min(70vw, 640px)';
            // A column that would run into the send form shrinks every chip.
            if (isTop && castChips.size > 1) {
                const avail = window.innerHeight - topPx - 90;
                const needed = castChips.size * (size + 26);
                if (needed > avail) size = Math.max(48, Math.floor(avail / castChips.size) - 26);
            }
            el.dataset.chipStyle = settings.chipStyle || 'fade';
            el.style.setProperty('--scene-director-chip-size', size + 'px');
        } catch (e) { /* ignore */ }
    }

    // Keep the strip inside the gutter as the chat panel moves/resizes.
    let stripResizeObserver = null;
    function setupStripResizeObserver() {
        try {
            if (stripResizeObserver || typeof ResizeObserver !== 'function') return;
            const sheld = document.getElementById('sheld');
            if (!sheld) return;
            const rerun = function () { queueDom(function () { applyStripAppearance(getSettings()); }); };
            stripResizeObserver = new ResizeObserver(rerun);
            stripResizeObserver.observe(sheld);
            window.addEventListener('resize', rerun);
        } catch (e) { /* ignore */ }
    }

    function applyHudAppearance(settings) {
        try {
            const hud = document.getElementById('scene-director-hud');
            if (!hud) return;
            const pos = settings.hudPosition || 'top-right';
            hud.style.left = pos.endsWith('left') ? '12px' : 'auto';
            hud.style.right = pos.endsWith('right') ? '12px' : 'auto';
            hud.style.top = pos.startsWith('top') ? '10px' : 'auto';
            hud.style.bottom = pos.startsWith('bottom') ? '12px' : 'auto';
        } catch (e) { /* ignore */ }
    }

    // See-through chat panel. RGB comes from the theme's own
    // --SmartThemeChatTintColor; the applied alpha is the SMALLER of the
    // theme's alpha and the slider, so a theme that is already more
    // transparent is left alone.
    const THEME_TINT_RE = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)/;
    function applyChatGlass(settings) {
        try {
            const on = Boolean(settings.enableChatGlass);
            document.body.classList.toggle('scene-director-chat-glass', on);
            document.body.classList.toggle('scene-director-chat-noblur', on && !settings.chatBlur);
            if (!on) return;
            let rgb = '0, 0, 0';
            let themeAlpha = 1;
            try {
                const raw = getComputedStyle(document.body)
                    .getPropertyValue('--SmartThemeChatTintColor');
                const m = THEME_TINT_RE.exec(raw || '');
                if (m) {
                    rgb = `${m[1]}, ${m[2]}, ${m[3]}`;
                    if (m[4] !== undefined) themeAlpha = parseFloat(m[4]);
                }
            } catch (e) { /* keep black */ }
            let alpha = Number(settings.chatOpacity);
            if (!Number.isFinite(alpha)) alpha = 0.55;
            alpha = Math.max(0, Math.min(1, Math.min(alpha, themeAlpha)));
            document.documentElement.style.setProperty('--scene-director-chat-tint-rgb', rgb);
            document.documentElement.style.setProperty('--scene-director-chat-alpha', String(alpha));
        } catch (e) { /* ignore */ }
    }

    function clearCastStrip() {
        castChips.clear();
        const el = castStripEl(false);
        if (el) el.innerHTML = '';
        hideBioCard();
    }

    function chipImageSrc(member, mood, settings) {
        if (member.avatar && mood === 'neutral') return member.avatar;
        const base = `/characters/${encodeURIComponent(settings.castFolder)}/npc/`;
        if (mood !== 'neutral') return base + encodeURIComponent(member.key) + '-' + mood + '.png';
        return base + encodeURIComponent(member.key) + '.png';
    }

    function buildChip(member, mood, speaking, settings, lingering) {
        const wrap = document.createElement('div');
        wrap.className = 'scene-director-chip' + (speaking ? ' speaking' : '')
            + (lingering ? ' lingering' : '');
        wrap.dataset.key = member.key;
        const baseSrc = chipImageSrc(member, 'neutral', settings);
        const img = document.createElement('img');
        img.alt = member.label;
        if (mood !== 'neutral') {
            img.onerror = function () {
                this.onerror = function () { try { wrap.remove(); } catch (e) { /* ignore */ } };
                this.src = baseSrc;
            };
            img.src = chipImageSrc(member, mood, settings);
        } else {
            img.onerror = function () { try { wrap.remove(); } catch (e) { /* ignore */ } };
            img.src = baseSrc;
        }
        let bubbleEl = null;
        if (mood !== 'neutral') {
            bubbleEl = document.createElement('div');
            bubbleEl.className = 'scene-director-mood-bubble';
            bubbleEl.textContent = MOOD_EMOJI[mood];
            wrap.appendChild(bubbleEl);
        }
        const label = document.createElement('div');
        label.className = 'scene-director-chip-label';
        label.textContent = member.label;
        wrap.appendChild(img);
        wrap.appendChild(label);
        if (settings.enableBioCards) {
            const label2 = member.label;
            wrap.addEventListener('mouseenter', function () {
                bioLineFor(member, settings).then(function (line) {
                    if (line) showBioCard(wrap, label2, String(line));
                }).catch(function () { /* ignore */ });
            });
            wrap.addEventListener('mouseleave', hideBioCard);
        }
        return { el: wrap, imgEl: img, bubbleEl, mood, speaking, lingering: Boolean(lingering), src: img.src };
    }

    function updateCastStrip(scene, settings) {
        if (!settings.enableCast || !settings.castFolder || !scene.text) {
            // Off = clear once, then zero cost (no element when never enabled).
            if (castChips.size || castStripEl(false)) queueDom(clearCastStrip);
            return;
        }
        // v0.5.0: a location change clears presence entirely — the strip
        // rebuilds from speaking evidence at the new location.
        if (scene.location && presenceLoc && scene.location !== presenceLoc) {
            castPresence.clear();
        }
        if (scene.location) presenceLoc = scene.location;
        const { present, speakerKey } = analyzeCast(scene, settings);
        // Presence hysteresis: seen now -> miss 0; previously established
        // here but silent -> miss+1, chip lingers (dimmed) until the limit.
        const nowKeys = new Set(present.map(function (p) { return p.member.key; }));
        for (const p of present) castPresence.set(p.member.key, 0);
        const lingering = [];
        for (const [k, miss] of castPresence) {
            if (nowKeys.has(k)) continue;
            const next = miss + 1;
            if (next >= PRESENCE_MISS_LIMIT) {
                castPresence.delete(k);
                continue;
            }
            castPresence.set(k, next);
            const member = settings.cast.find(function (m) { return m.key === k; });
            if (member) lingering.push({ member, pos: -1, lingering: true });
        }
        persistPresence();
        let ordered = present;
        if (settings.enableSpeakingOrder) {
            ordered = present.slice().sort(function (a, b) { return b.pos - a.pos; });
        }
        ordered = ordered.concat(lingering);
        // Compute desired chip states OUTSIDE the frame (moods are the
        // expensive part), then diff inside one rAF.
        const desired = ordered.map(function (p) {
            return {
                member: p.member,
                mood: (!p.lingering && settings.enableMoods) ? detectMood(scene.text, p.member, settings) : 'neutral',
                speaking: !p.lingering && p.member.key === speakerKey,
                lingering: Boolean(p.lingering),
            };
        });
        queueDom(function () {
            const strip = castStripEl(true);
            const seen = new Set();
            let prevEl = null;
            for (const d of desired) {
                const key = d.member.key;
                seen.add(key);
                let chip = castChips.get(key);
                const needsRebuild = chip && (chip.mood !== d.mood || !chip.el.isConnected);
                if (!chip || needsRebuild) {
                    const fresh = buildChip(d.member, d.mood, d.speaking, settings, d.lingering);
                    if (chip && chip.el.isConnected) chip.el.replaceWith(fresh.el);
                    chip = fresh;
                    castChips.set(key, chip);
                } else {
                    if (chip.speaking !== d.speaking) {
                        chip.el.classList.toggle('speaking', d.speaking);
                        chip.speaking = d.speaking;
                    }
                    if (chip.lingering !== d.lingering) {
                        chip.el.classList.toggle('lingering', Boolean(d.lingering));
                        chip.lingering = Boolean(d.lingering);
                    }
                }
                // Ordering: append/move only when out of place.
                if (!chip.el.isConnected) {
                    strip.appendChild(chip.el);
                } else if (prevEl ? chip.el.previousElementSibling !== prevEl
                    : chip.el !== strip.firstElementChild) {
                    strip.insertBefore(chip.el, prevEl ? prevEl.nextElementSibling : strip.firstElementChild);
                }
                prevEl = chip.el;
            }
            for (const [key, chip] of castChips) {
                if (!seen.has(key)) {
                    try { chip.el.remove(); } catch (e) { /* ignore */ }
                    castChips.delete(key);
                }
            }
            hideBioCard();
            applyStripAppearance(settings, strip); // chip count -> column fit
        });
    }

    // ------------------------------------------------------------------
    // Message handling
    // ------------------------------------------------------------------

    /**
     * v0.5.0 costume fix: ST resolves a bare /costume argument as a
     * TOP-LEVEL sprite folder, so "/costume pajamas" 404s every sprite. A
     * bare rule value is therefore issued as "<ActiveCharacter>/<value>",
     * with the active character taken from the live context (name2, falling
     * back to the last AI message's name). A value already containing "/"
     * is used verbatim.
     */
    function costumeArg(ctx, desired) {
        try {
            if (!desired || desired.includes('/')) return desired;
            let charName = ctx.name2;
            if (!charName) {
                const last = getLastAiMessage(ctx);
                if (last && last.name) charName = last.name;
            }
            return charName ? `${charName}/${desired}` : desired;
        } catch (e) { return desired; }
    }

    async function runCommand(ctx, cmd) {
        if (ctx.executeSlashCommandsWithOptions) {
            await ctx.executeSlashCommandsWithOptions(cmd, { handleParserErrors: true });
        } else {
            await ctx.executeSlashCommands(cmd);
        }
    }

    // ------------------------------------------------------------------
    // Inline Mood Tag (v0.4.1)
    //
    // The model appends [MOOD: <label>] as the last line of its reply (the
    // settings drawer has a copyable prompt snippet). When found, the sprite
    // is set directly with /emote <label> — an alias of the expressions
    // extension's expression-set slash command, whose unnamed argument is
    // the expression label — so no classifier API call is needed for that
    // message. The tag is stripped from the RENDERED message only; the
    // underlying chat data keeps it, which keeps the model consistent about
    // emitting it. No tag (or an unknown label) = nothing happens and the
    // expression classifier keeps working exactly as configured.
    // ------------------------------------------------------------------

    // v0.5.0: zero-setup — the instruction auto-injects near the end of the
    // context via ctx.setExtensionPrompt(key, value, position, depth, scan,
    // role). Position 1 = extension_prompt_types.IN_CHAT (injects <depth>
    // messages from the end of the chat, like an Author's Note), role 0 =
    // SYSTEM — verified against SillyTavern's public/script.js. '' clears
    // the injection when the toggle goes off.
    const MOOD_INJECT_KEY = 'scene-director-mood';
    function updateMoodTagInjection(settings) {
        try {
            const ctx = SillyTavern.getContext();
            if (typeof ctx.setExtensionPrompt !== 'function') return;
            ctx.setExtensionPrompt(MOOD_INJECT_KEY,
                settings.enableMoodTag ? MOOD_PROMPT_SNIPPET : '',
                1 /* IN_CHAT */, 1 /* depth */, false /* scan */, 0 /* SYSTEM */);
        } catch (e) {
            console.error(`${LOG} mood-tag injection failed`, e);
        }
    }

    /** Trailing [MOOD: <label>] in the raw message -> validated label | null. */
    function detectMoodTag(rawText) {
        try {
            if (!rawText) return null;
            const tail = rawText.length > 300 ? rawText.slice(-300) : rawText;
            const m = MOOD_TAG_RE.exec(tail.trimEnd());
            if (!m) return null;
            const label = m[1].toLowerCase();
            return EXPRESSION_LABEL_SET.has(label) ? label : null;
        } catch (e) { return null; }
    }

    /** Remove the tag from the last message's rendered .mes_text only. */
    function stripMoodTagFromDom() {
        const strip = function () {
            try {
                const mesText = document.querySelector('#chat .mes.last_mes .mes_text');
                if (!mesText) return;
                MOOD_TAG_DOM_RE.lastIndex = 0;
                if (!MOOD_TAG_DOM_RE.test(mesText.innerHTML)) return;
                mesText.innerHTML = mesText.innerHTML
                    .replace(MOOD_TAG_DOM_RE, '')
                    .replace(EMPTY_P_TAIL_RE, '');
            } catch (e) { /* ignore */ }
        };
        // First attempt in the shared rAF batch; the render can land after
        // MESSAGE_RECEIVED (and streamed messages re-render), so retry twice.
        queueDom(strip);
        sdTimeout(strip, 300);
        sdTimeout(strip, 1200);
    }

    // 0.5.1: when the expressions extension's classifier API is set to None
    // (the natural companion of the mood tag), it resolves every message to
    // '' and, without a fallback expression, CLEARS the sprite — on chat
    // load, inside the /costume handler, and on its 2s worker tick after
    // each new message, racing our /emote. Every /emote is therefore
    // asserted and then verified: an empty sprite src within ~6s gets it
    // re-issued. With a real classifier configured this never fires.
    let lastMoodLabel = null;
    let assertSeq = 0;
    function spriteIsBlank() {
        const img = currentSpriteImg();
        return !img || !img.getAttribute('src');
    }
    async function assertExpression(ctx, label) {
        if (!label) return;
        const my = ++assertSeq;
        lastMoodLabel = label;
        try { await runCommand(ctx, `/emote ${label}`); } catch (e) { /* retried below */ }
        let tries = 0;
        const check = async function () {
            if (my !== assertSeq) return;
            if (spriteIsBlank() && tries < 4) {
                tries++;
                try { await runCommand(ctx, `/emote ${label}`); } catch (e) { /* ignore */ }
                console.log(`${LOG} sprite was blank -> re-asserted /emote ${label} (${tries})`);
            }
            if (tries < 4) sdTimeout(check, 1500);
        };
        sdTimeout(check, 1200);
    }

    /** Last [MOOD:] tag in the loaded chat (scans back a few AI messages). */
    function lastMoodLabelFromChat(ctx) {
        try {
            const chat = ctx.chat || [];
            let seen = 0;
            for (let i = chat.length - 1; i >= 0 && seen < 5; i--) {
                const m = chat[i];
                if (!m || m.is_user || m.is_system || !m.mes) continue;
                seen++;
                const label = detectMoodTag(m.mes);
                if (label) return label;
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    /** Redraw the current mood after chat load / costume switch. */
    function replayExpression(ctx, settings, delayMs) {
        if (!settings.enableMoodTag) return;
        const label = lastMoodLabel || lastMoodLabelFromChat(ctx);
        if (!label) return; // no tag in this chat -> leave the classifier alone
        sdTimeout(function () { assertExpression(ctx, label); }, delayMs || 0);
    }

    async function applyMoodTag(ctx, rawText, settings) {
        try {
            if (!settings.enableMoodTag) return;
            const label = detectMoodTag(rawText);
            if (!label) return;
            stripMoodTagFromDom();
            await assertExpression(ctx, label);
            console.log(`${LOG} mood tag -> /emote ${label}`);
        } catch (e) {
            console.error(`${LOG} mood tag failed`, e);
        }
    }

    function getLastAiMessage(ctx) {
        const chat = ctx.chat;
        if (!chat || !chat.length) return null;
        const last = chat[chat.length - 1];
        if (last.is_user || last.is_system) return null;
        return last;
    }

    async function onMessage() {
        try {
            const ctx = SillyTavern.getContext();
            const settings = getSettings();
            const last = getLastAiMessage(ctx);
            if (!last) return;

            lastActivityTs = Date.now();

            // ONE extraction + ONE header parse for the whole event (item 1).
            const scene = parseScene(last.mes, settings);

            // Inline Mood Tag: fire-and-forget (self-contained) so it never
            // delays the rest of the scene. Reads the RAW text — the tag
            // trails the message and must survive the MAX_SCAN cap.
            try { applyMoodTag(ctx, last.mes, settings); } catch (e) { /* ignore */ }

            try {
                updateCastStrip(scene, settings);
            } catch (e) {
                console.error(`${LOG} cast strip failed`, e);
            }
            updateSceneHud(scene, settings);

            if (settings.enableCrossfade) setupSpriteCrossfade();

            try { updateKenBurns(settings); } catch (e) { /* ignore */ }
            try { updatePhotoButton(settings); } catch (e) { /* ignore */ }
            // v0.5.0: re-measure for auto chip size + keep the corners set.
            try { applyStripAppearance(settings); } catch (e) { /* ignore */ }
            if (settings.enableEmotionAccents) {
                try { sdTimeout(function () { fireEmotionAccent(settings); }, 1500); } catch (e) { /* ignore */ }
            }
            try { schedulePreload(settings); } catch (e) { /* ignore */ }

            const location = scene.location;
            if (!location) {
                updateWeatherOverlay(null, settings);
                try { updateSpriteFilter('neutral', settings); } catch (e) { /* ignore */ }
                try { updateTabTitle(null, settings); } catch (e) { /* ignore */ }
                return;
            }
            lastParsedLoc = location;
            if (scene.date && scene.date.day) lastParsedDate = scene.date;

            // --- Auto Backgrounds (place cards + era/seasonal variants) ---
            if (settings.enableBackgrounds) {
                try {
                    const pick = pickBackground(location, scene, settings);
                    if (pick) {
                        const bg = applyVariants(pick.file, location, scene.date, settings);
                        if (bg !== lastBg) {
                            lastBg = bg;
                            lastBgGraded = pick.graded && bg === pick.file;
                            await applyBackground(ctx, bg, settings);
                            console.log(`${LOG} "${location}" -> ${bg}`);
                        }
                    } else {
                        console.debug(`${LOG} no background mapping for location: ${location}`);
                    }
                } catch (e) {
                    console.error(`${LOG} background switch failed`, e);
                }
            }

            // --- Weather & Lighting Overlay (after bg, so graded variants
            //     suppress the tint) ---
            try {
                updateWeatherOverlay(scene, settings);
            } catch (e) {
                console.error(`${LOG} weather overlay update failed`, e);
            }

            try { updateSpriteFilter(scene.state, settings); } catch (e) { /* ignore */ }
            try { updateFireOverlay(settings); } catch (e) { /* ignore */ }
            try { updateTabTitle(scene, settings); } catch (e) { /* ignore */ }
            try {
                updateDayTrail(scene.date, location, settings);
                updateHudTooltip((scene.date && scene.date.day) ? scene.date : lastParsedDate, settings);
            } catch (e) { /* ignore */ }

            // --- Auto Costumes ---
            if (settings.enableCostumes) {
                try {
                    // Drawer toggle or the window flag freezes auto-costume.
                    if (settings.holdCostume || window.sceneDirectorHoldCostume) return;
                    const desired = pickCostume(location, scene.hour, settings);
                    if (desired !== null && desired !== lastCostume) {
                        await runCommand(ctx, desired ? `/costume ${costumeArg(ctx, desired)}` : '/costume');
                        // 0.5.1: the /costume handler re-classifies; redraw
                        // the tagged mood so a None classifier can't blank it.
                        replayExpression(ctx, settings, 0);
                        console.log(`${LOG} costume: ${lastCostume || 'default'} -> ${desired || 'default'} (loc="${location}", hour=${scene.hour})`);
                        lastCostume = desired;
                        try {
                            const meta = chatMeta(true);
                            if (meta) { meta.lastCostume = desired; saveMeta(); }
                        } catch (e2) { /* ignore */ }
                    }
                } catch (e) {
                    console.error(`${LOG} costume switch failed`, e);
                }
            }
        } catch (e) {
            console.error(LOG, e);
        }
    }

    function onChatChanged() {
        // New chat: forget dedupe state, clear pending timers, re-attach the
        // sprite observer fresh, and clear the previous chat's UI (item 5).
        lastBg = null;
        lastBgGraded = false;
        lastCostume = null;
        trailDateKey = null;
        trailLocs = [];
        lastParsedDate = null;
        lastParsedLoc = null;
        lastOverlayState = null;
        clearAllTimeouts();
        teardownSpriteCrossfade();
        try {
            clearCastStrip();
            const hud = document.getElementById('scene-director-hud');
            if (hud) { hud.style.display = 'none'; hud.title = ''; }
            const settings = getSettings();
            updateWeatherOverlay(null, settings);
            if (settings.enableCrossfade) setupSpriteCrossfade();
            restoreTabTitle();
            // v0.5.0: per-chat state back from metadata (or deterministic
            // rescans of the loaded chat) — trail, costume dedupe, presence.
            try {
                const meta = chatMeta(false);
                lastCostume = (meta && meta.lastCostume !== undefined) ? meta.lastCostume : null;
            } catch (e) { /* ignore */ }
            restoreTrail(settings);
            seedPresenceFromChat(settings);
            applyStripAppearance(settings);
            lastMoodLabel = null;
            replayExpression(SillyTavern.getContext(), settings, 1500);
        } catch (e) { /* ignore */ }
        onMessage();
    }

    function onVisibilityChange() {
        try {
            if (document.hidden) {
                // Page hidden: stop the idle interval and drop pending
                // one-shot timers (accents/preloads for a page nobody sees).
                stopIdleLoop();
                clearAllTimeouts();
            } else {
                lastActivityTs = Date.now();
                if (getSettings().enableIdlePresence) startIdleLoop();
            }
        } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // Compat guards (audit item 8)
    // ------------------------------------------------------------------

    function detectConflicts(ctx) {
        const result = { prome: false, weatherCycle: false };
        try {
            const es = ctx.extensionSettings || {};
            // Prome VN Extension: extension_settings key "Prome-VN-Extension"
            // (verified against Bronya-Rand/Prome-VN-Extension master), plus
            // its settings-drawer ids as a fallback.
            if (es['Prome-VN-Extension']
                || document.getElementById('prome-character-tint')
                || document.getElementById('prome-world-tint')) {
                result.prome = true;
            }
            // st-weather-cycle (nullara/st-weather-cycle): localStorage key
            // 'st-weather-cycle-settings' + overlay/panel DOM ids.
            let wc = false;
            try { wc = Boolean(localStorage.getItem('st-weather-cycle-settings')); } catch (e) { /* ignore */ }
            if (wc
                || document.getElementById('st-weather-cycle-overlay')
                || document.getElementById('st-weather-cycle-panel')) {
                result.weatherCycle = true;
            }
        } catch (e) { /* ignore */ }
        if (result.prome) {
            console.log(`${LOG} Prome VN Extension detected — Weather & Lighting Overlay auto-disabled`);
        }
        if (result.weatherCycle) {
            console.log(`${LOG} st-weather-cycle detected — Ken Burns Drift auto-disabled`);
        }
        return result;
    }

    // ------------------------------------------------------------------
    // Settings UI — card system (v0.4.0)
    // ------------------------------------------------------------------

    const SLOT_KEYS = ['day', 'night', 'dusk', 'rain', 'seasonal'];
    let backgroundsListPromise = null;

    /** Installed backgrounds, via ST's own endpoint (POST /api/backgrounds/all). */
    function fetchBackgroundsList() {
        if (!backgroundsListPromise) {
            backgroundsListPromise = (async function () {
                try {
                    const ctx = SillyTavern.getContext();
                    const headers = ctx.getRequestHeaders
                        ? ctx.getRequestHeaders()
                        : { 'Content-Type': 'application/json' };
                    const r = await fetch('/api/backgrounds/all', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({}),
                    });
                    if (!r.ok) return [];
                    const data = await r.json();
                    // New ST: { images: [{filename}], config }; old ST: [names].
                    if (Array.isArray(data)) return data;
                    if (Array.isArray(data.images)) {
                        return data.images.map(function (x) {
                            return typeof x === 'string' ? x : x.filename;
                        }).filter(Boolean);
                    }
                    return [];
                } catch (e) {
                    console.warn(`${LOG} backgrounds list fetch failed`, e);
                    return [];
                }
            })();
        }
        return backgroundsListPromise;
    }

    /** Character avatar thumbnail, via ST's own helper when available. */
    function characterThumbUrl(ctx, avatarFile) {
        try {
            if (ctx.getThumbnailUrl) return ctx.getThumbnailUrl('avatar', avatarFile);
        } catch (e) { /* ignore */ }
        return '/thumbnail?type=avatar&file=' + encodeURIComponent(avatarFile);
    }

    function slugify(name) {
        return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'member';
    }

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function input(cls, value, placeholder, title) {
        const e = document.createElement('input');
        e.type = 'text';
        e.className = 'text_pole ' + (cls || '');
        e.value = value || '';
        if (placeholder) e.placeholder = placeholder;
        if (title) e.title = title;
        e.spellcheck = false;
        return e;
    }

    function commitCards() {
        saveSettings();
        // Re-apply with the new config on the current chat.
        lastBg = null;
        lastBgGraded = false;
        lastCostume = null;
        mapPreloaded = false;
        onMessage();
    }

    // ---- Cast cards ----

    function renderCastCards() {
        const holder = document.getElementById('sd_cast_cards');
        if (!holder) return;
        const s = getSettings();
        holder.innerHTML = '';
        if (!s.cast.length) {
            holder.appendChild(el('div', 'scene-director-empty',
                'No cast yet — each card describes one recurring character: their chip portrait, dialogue colour and how to spot them in a message. Use “Scan my chat” or “Add from my characters” to start.'));
            return;
        }
        s.cast.forEach(function (member, idx) {
            holder.appendChild(buildCastCard(member, idx));
        });
    }

    function buildCastCard(member, idx) {
        const s = getSettings();
        const card = el('div', 'scene-director-card');

        // Portrait thumbnail.
        const thumb = el('img', 'scene-director-card-thumb');
        thumb.alt = member.label || member.key;
        thumb.src = member.avatar
            || `/characters/${encodeURIComponent(s.castFolder)}/npc/${encodeURIComponent(member.key)}.png`;
        thumb.onerror = function () { this.style.visibility = 'hidden'; };
        card.appendChild(thumb);

        const main = el('div', 'scene-director-card-main');

        const row1 = el('div', 'scene-director-card-row');
        const nameIn = input('sd-card-name', member.label, 'Name', 'Display name under the chip');
        nameIn.addEventListener('change', function () {
            member.label = nameIn.value.trim() || member.key;
            commitCards();
        });
        const keyIn = input('sd-card-key', member.key, 'key', 'Portrait filename: npc/<key>.png');
        keyIn.addEventListener('change', function () {
            const v = keyIn.value.trim();
            if (v) { member.key = v; commitCards(); renderCastCards(); }
        });
        const colorIn = document.createElement('input');
        colorIn.type = 'color';
        colorIn.className = 'sd-card-color';
        colorIn.title = 'Dialogue font colour — its hex appearing in a message means this character spoke';
        colorIn.value = HEX_COLOR_RE.test(member.colorHex || '') && member.colorHex.length === 7
            ? member.colorHex : '#888888';
        colorIn.addEventListener('change', function () {
            member.colorHex = colorIn.value.toUpperCase();
            commitCards();
        });
        const colorClear = el('div', 'sd-card-color-clear', member.colorHex ? '×' : '');
        colorClear.title = 'Clear the colour (detect by name regex only)';
        colorClear.addEventListener('click', function () {
            member.colorHex = null;
            commitCards();
            renderCastCards();
        });
        const moodBadge = el('div', 'sd-card-mood' + (member.moodVariants ? ' on' : ''), '😊');
        moodBadge.title = member.moodVariants
            ? 'Mood portrait variants expected on disk (<key>-happy/-angry/-sad.png). Click to unmark.'
            : 'Click if this member has mood portrait variants (<key>-happy/-angry/-sad.png). Purely an indicator — missing files always fall back safely.';
        moodBadge.addEventListener('click', function () {
            member.moodVariants = !member.moodVariants;
            commitCards();
            renderCastCards();
        });
        row1.appendChild(nameIn);
        row1.appendChild(keyIn);
        row1.appendChild(colorIn);
        row1.appendChild(colorClear);
        row1.appendChild(moodBadge);
        main.appendChild(row1);

        const row2 = el('div', 'scene-director-card-row');
        const regexIn = input('sd-card-regex', member.nameRegex || '', 'name regex (optional)',
            'Fallback detection: a case-insensitive regex matched against the message text');
        regexIn.addEventListener('change', function () {
            const v = regexIn.value.trim();
            if (v && !compileRegex(v)) {
                regexIn.classList.add('sd-invalid');
                return;
            }
            regexIn.classList.remove('sd-invalid');
            member.nameRegex = v || null;
            commitCards();
        });
        row2.appendChild(regexIn);
        main.appendChild(row2);

        const row3 = el('div', 'scene-director-card-row');
        const bioIn = input('sd-card-bio', member.bio || '', 'one-line bio (hover card)',
            'Shown on chip hover when Bio Cards is enabled (overrides npc/bios.json)');
        bioIn.addEventListener('change', function () {
            member.bio = bioIn.value.trim();
            commitCards();
        });
        row3.appendChild(bioIn);
        main.appendChild(row3);

        card.appendChild(main);

        const del = el('div', 'scene-director-card-del menu_button', '✕');
        del.title = 'Delete this cast card';
        del.addEventListener('click', function () {
            getSettings().cast.splice(idx, 1);
            commitCards();
            renderCastCards();
        });
        card.appendChild(del);
        return card;
    }

    function addCastMember(partial) {
        const s = getSettings();
        const label = partial.label || 'New member';
        const member = {
            key: partial.key || slugify(label),
            label,
            colorHex: partial.colorHex || null,
            nameRegex: partial.nameRegex !== undefined ? partial.nameRegex
                : label.toLowerCase().replace(/[\\^$.*+?()[\]{}]/g, ''),
            bio: partial.bio || '',
            avatar: partial.avatar || '',
            moodVariants: false,
        };
        s.cast.push(member);
        commitCards();
        renderCastCards();
    }

    function populateCharacterDropdown() {
        const sel = document.getElementById('sd_cast_char_select');
        if (!sel) return;
        sel.innerHTML = '<option value="">— pick a character —</option>';
        try {
            const ctx = SillyTavern.getContext();
            (ctx.characters || []).forEach(function (ch, i) {
                if (!ch || !ch.name) return;
                const opt = document.createElement('option');
                opt.value = String(i);
                opt.textContent = ch.name;
                sel.appendChild(opt);
            });
        } catch (e) { /* ignore */ }
    }

    // ---- Place cards ----

    function renderPlaceCards() {
        const holder = document.getElementById('sd_place_cards');
        if (!holder) return;
        const s = getSettings();
        holder.innerHTML = '';
        if (!s.places.length) {
            holder.appendChild(el('div', 'scene-director-empty',
                'No places yet — each card names one location in your story, the regex that recognises it in the 📍 header, and which background file to show (day, plus optional night/dusk/rain/seasonal variants). Use “Scan my chat” to harvest the locations your story already visits.'));
            return;
        }
        fetchBackgroundsList().then(function (bgList) {
            holder.innerHTML = '';
            s.places.forEach(function (place, idx) {
                holder.appendChild(buildPlaceCard(place, idx, bgList));
            });
        });
    }

    function bgSelect(value, bgList, title) {
        const sel = document.createElement('select');
        sel.className = 'sd-slot-select';
        if (title) sel.title = title;
        const none = document.createElement('option');
        none.value = '';
        none.textContent = '(none)';
        sel.appendChild(none);
        let found = false;
        for (const f of bgList) {
            const opt = document.createElement('option');
            opt.value = f;
            opt.textContent = f;
            if (f === value) { opt.selected = true; found = true; }
            sel.appendChild(opt);
        }
        if (value && !found) {
            // Keep a value referencing a file that is not installed (yet).
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = value + ' (missing)';
            opt.selected = true;
            sel.appendChild(opt);
        }
        return sel;
    }

    function buildPlaceCard(place, idx, bgList) {
        const card = el('div', 'scene-director-card scene-director-place-card');
        const main = el('div', 'scene-director-card-main');

        const row1 = el('div', 'scene-director-card-row');
        const nameIn = input('sd-card-name', place.name, 'Place name');
        nameIn.addEventListener('change', function () {
            place.name = nameIn.value.trim() || place.name;
            commitCards();
        });
        const patIn = input('sd-card-regex', place.pattern, 'matcher regex',
            'Case-insensitive regex tested against the 📍 location text. First matching card wins — order specific places above generic ones.');
        patIn.addEventListener('change', function () {
            const v = patIn.value.trim();
            if (!v || !compileRegex(v)) {
                patIn.classList.add('sd-invalid');
                return;
            }
            patIn.classList.remove('sd-invalid');
            place.pattern = v;
            commitCards();
        });
        row1.appendChild(nameIn);
        row1.appendChild(patIn);
        main.appendChild(row1);

        const slots = place.slots || (place.slots = {});
        const rowSlots = el('div', 'scene-director-card-row sd-slots-row');
        const SLOT_LABELS = { day: '☀️', night: '🌙', dusk: '🌆', rain: '🌧', seasonal: '🎄' };
        const SLOT_TITLES = {
            day: 'Day background (the default)',
            night: 'Night variant (19:00–05:59)',
            dusk: 'Dusk variant (17:00–18:59)',
            rain: 'Rain variant (weather text matches the rain regex)',
            seasonal: 'Seasonal variant (used in the month set on the right)',
        };
        for (const key of SLOT_KEYS) {
            const slotWrap = el('div', 'sd-slot');
            slotWrap.appendChild(el('span', 'sd-slot-label', SLOT_LABELS[key]));
            const sel = bgSelect(slots[key] || '', bgList, SLOT_TITLES[key]);
            sel.addEventListener('change', function () {
                slots[key] = sel.value;
                commitCards();
            });
            slotWrap.appendChild(sel);
            rowSlots.appendChild(slotWrap);
        }
        const monthIn = document.createElement('input');
        monthIn.type = 'number';
        monthIn.min = '1';
        monthIn.max = '12';
        monthIn.className = 'sd-slot-month text_pole';
        monthIn.title = 'Seasonal month (1–12)';
        monthIn.value = String(place.seasonalMonth || 12);
        monthIn.addEventListener('change', function () {
            const v = parseInt(monthIn.value, 10);
            if (v >= 1 && v <= 12) { place.seasonalMonth = v; commitCards(); }
        });
        rowSlots.appendChild(monthIn);
        main.appendChild(rowSlots);

        const row3 = el('div', 'scene-director-card-row');
        const bioIn = input('sd-card-bio', place.bio || '', 'one-line note (for you)');
        bioIn.addEventListener('change', function () {
            place.bio = bioIn.value.trim();
            commitCards();
        });
        row3.appendChild(bioIn);
        main.appendChild(row3);

        card.appendChild(main);
        const del = el('div', 'scene-director-card-del menu_button', '✕');
        del.title = 'Delete this place card';
        del.addEventListener('click', function () {
            getSettings().places.splice(idx, 1);
            commitCards();
            renderPlaceCards();
        });
        card.appendChild(del);
        return card;
    }

    function addPlace(partial) {
        const s = getSettings();
        s.places.push({
            name: partial.name || 'New place',
            pattern: partial.pattern || '',
            bio: '',
            slots: Object.assign({ day: '', night: '', dusk: '', rain: '', seasonal: '' }, partial.slots || {}),
            seasonalMonth: 12,
        });
        commitCards();
        renderPlaceCards();
    }

    // ---- Scan-my-chat wizard ----

    function escapeRegexLiteral(s) {
        return String(s).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
    }

    function scanChat() {
        const ctx = SillyTavern.getContext();
        const settings = getSettings();
        const result = {
            messages: 0, headerHits: 0, headerSample: null,
            colors: new Map(),    // hex -> { count, names: Map(name->count) }
            locations: new Map(), // loc -> count
        };
        const chat = ctx.chat || [];
        const locRe = compileRegex(settings.locationRegex);
        for (const msg of chat) {
            if (!msg || msg.is_user || msg.is_system || !msg.mes) continue;
            result.messages++;
            const text = msg.mes.length > MAX_SCAN ? msg.mes.slice(0, MAX_SCAN) : msg.mes;
            if (locRe) {
                const m = locRe.exec(text);
                if (m && m[1]) {
                    result.headerHits++;
                    const loc = m[1].trim();
                    if (!result.headerSample) {
                        for (const line of text.split('\n')) {
                            if (locRe.test(line)) { result.headerSample = line.trim(); break; }
                        }
                    }
                    result.locations.set(loc, (result.locations.get(loc) || 0) + 1);
                }
            }
            FONT_COLOR_SCAN_RE.lastIndex = 0;
            let cm;
            while ((cm = FONT_COLOR_SCAN_RE.exec(text)) !== null) {
                const hex = cm[1].toUpperCase();
                let entry = result.colors.get(hex);
                if (!entry) {
                    entry = { count: 0, names: new Map() };
                    result.colors.set(hex, entry);
                }
                entry.count++;
                // Nearby-name guess: the last capitalised word in the ~60
                // chars before the <font> tag ("June said, <font...").
                const win = text.slice(Math.max(0, cm.index - 60), cm.index);
                const words = win.match(CAP_WORD_RE);
                if (words && words.length) {
                    const w = words[words.length - 1];
                    entry.names.set(w, (entry.names.get(w) || 0) + 1);
                }
            }
        }
        return result;
    }

    function bestNameGuess(entry) {
        let best = null;
        let bestCount = 0;
        for (const [name, count] of entry.names) {
            if (count > bestCount) { best = name; bestCount = count; }
        }
        return best;
    }

    function renderScanResults() {
        const out = document.getElementById('sd_scan_results');
        if (!out) return;
        out.style.display = 'block';
        out.innerHTML = '';
        let scan;
        try {
            scan = scanChat();
        } catch (e) {
            out.textContent = 'Scan failed: ' + e;
            return;
        }
        const s = getSettings();
        if (!scan.messages) {
            out.appendChild(el('div', 'scene-director-empty', 'No AI messages in the current chat to scan.'));
            return;
        }

        // Header detection.
        const hdr = el('div', 'sd-scan-section');
        hdr.appendChild(el('b', null, 'Scene headers: '));
        if (scan.headerHits) {
            hdr.appendChild(document.createTextNode(
                `found in ${scan.headerHits}/${scan.messages} AI messages. Sample:`));
            const pre = el('div', 'sd-scan-sample', scan.headerSample || '');
            hdr.appendChild(pre);
        } else {
            hdr.appendChild(document.createTextNode(
                'none found. Your preset must emit a header line — copy the snippet from the help below into your system prompt.'));
        }
        out.appendChild(hdr);

        // Colours -> cast card suggestions.
        const colSec = el('div', 'sd-scan-section');
        colSec.appendChild(el('b', null, 'Dialogue colours: '));
        if (!scan.colors.size) {
            colSec.appendChild(document.createTextNode('none found (no <font color=…> spans in this chat).'));
        } else {
            colSec.appendChild(document.createTextNode(`${scan.colors.size} distinct.`));
            const known = new Set(s.cast.map(function (m) { return (m.colorHex || '').toUpperCase(); }));
            const sorted = Array.from(scan.colors.entries()).sort(function (a, b) { return b[1].count - a[1].count; });
            for (const [hex, entry] of sorted) {
                const row = el('div', 'sd-scan-row');
                const sw = el('span', 'sd-scan-swatch');
                sw.style.backgroundColor = hex;
                row.appendChild(sw);
                const guess = bestNameGuess(entry);
                row.appendChild(el('span', 'sd-scan-text',
                    `${hex} — ${entry.count} speak${entry.count === 1 ? '' : 's'}${guess ? ` · looks like “${guess}”` : ''}`));
                if (known.has(hex)) {
                    row.appendChild(el('span', 'sd-scan-done', 'already a card'));
                } else {
                    const btn = el('div', 'menu_button sd-scan-create', '+ cast card');
                    btn.addEventListener('click', function () {
                        addCastMember({ label: guess || hex, colorHex: hex });
                        row.replaceChild(el('span', 'sd-scan-done', 'created ✓'), btn);
                    });
                    row.appendChild(btn);
                }
                colSec.appendChild(row);
            }
        }
        out.appendChild(colSec);

        // Locations -> place card suggestions.
        const locSec = el('div', 'sd-scan-section');
        locSec.appendChild(el('b', null, '📍 Locations: '));
        if (!scan.locations.size) {
            locSec.appendChild(document.createTextNode('none parsed (headers missing, or the location regex needs adjusting).'));
        } else {
            locSec.appendChild(document.createTextNode(`${scan.locations.size} distinct.`));
            const sorted = Array.from(scan.locations.entries()).sort(function (a, b) { return b[1] - a[1]; });
            for (const [loc, count] of sorted) {
                const row = el('div', 'sd-scan-row');
                row.appendChild(el('span', 'sd-scan-text', `${loc} — ${count}×`));
                const covered = s.places.some(function (p) {
                    const re = compileRegex(p.pattern);
                    return re && re.test(loc);
                });
                if (covered) {
                    row.appendChild(el('span', 'sd-scan-done', 'already matched'));
                } else {
                    const btn = el('div', 'menu_button sd-scan-create', '+ place card');
                    btn.addEventListener('click', function () {
                        addPlace({ name: loc, pattern: escapeRegexLiteral(loc.toLowerCase()) });
                        row.replaceChild(el('span', 'sd-scan-done', 'created ✓'), btn);
                    });
                    row.appendChild(btn);
                }
                locSec.appendChild(row);
            }
        }
        out.appendChild(locSec);
    }

    // ------------------------------------------------------------------
    // Settings UI — form plumbing
    // ------------------------------------------------------------------

    const validators = {
        seasonalMap(value) {
            if (!Array.isArray(value)) return 'must be a JSON array';
            for (const [i, e] of value.entries()) {
                if (!Number.isInteger(e?.month) || e.month < 1 || e.month > 12) return `entry ${i}: "month" must be 1-12`;
                if (typeof e?.from !== 'string' || !e.from) return `entry ${i}: "from" must be a filename`;
                if (typeof e?.to !== 'string' || !e.to) return `entry ${i}: "to" must be a filename`;
            }
            return null;
        },
        eraRules(value) {
            if (!Array.isArray(value)) return 'must be a JSON array';
            for (const [i, e] of value.entries()) {
                if (!Number.isInteger(e?.minYear)) return `entry ${i}: "minYear" must be an integer year`;
                if (e.pattern != null && (typeof e.pattern !== 'string' || !compileRegex(e.pattern))) return `entry ${i}: "pattern" is not a valid regex`;
                if (typeof e?.from !== 'string' || !e.from) return `entry ${i}: "from" must be a filename`;
                if (typeof e?.to !== 'string' || !e.to) return `entry ${i}: "to" must be a filename`;
            }
            return null;
        },
        costumeRules(value) {
            if (!Array.isArray(value)) return 'must be a JSON array';
            for (const [i, e] of value.entries()) {
                if (typeof e?.pattern !== 'string' || !e.pattern) return `entry ${i}: "pattern" must be a non-empty string`;
                if (!compileRegex(e.pattern)) return `entry ${i}: "pattern" is not a valid regex`;
                if (!Number.isInteger(e?.fromHour) || e.fromHour < 0 || e.fromHour > 23) return `entry ${i}: "fromHour" must be 0-23`;
                if (!Number.isInteger(e?.toHour) || e.toHour < 0 || e.toHour > 23) return `entry ${i}: "toHour" must be 0-23`;
                if (e.costume != null && typeof e.costume !== 'string') return `entry ${i}: "costume" must be a string ("" = default)`;
            }
            return null;
        },
        moodKeywords(value) {
            if (value === null || typeof value !== 'object' || Array.isArray(value)) {
                return 'must be a JSON object like {"happy": "...", "angry": "...", "sad": "..."}';
            }
            for (const key of Object.keys(value)) {
                if (!MOODS.includes(key)) return `unknown mood "${key}" (allowed: ${MOODS.join(', ')})`;
                if (typeof value[key] !== 'string' || !value[key]) return `"${key}" must be a non-empty regex string`;
                if (!compileRegex(value[key])) return `"${key}" is not a valid regex`;
            }
            return null;
        },
        counters(value) {
            if (!Array.isArray(value)) return 'must be a JSON array';
            for (const [i, e] of value.entries()) {
                if (typeof e?.label !== 'string' || !e.label) return `entry ${i}: "label" must be a non-empty string`;
                if (e.emoji != null && typeof e.emoji !== 'string') return `entry ${i}: "emoji" must be a string`;
                if (typeof e?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return `entry ${i}: "date" must be "YYYY-MM-DD"`;
                if (Number.isNaN(Date.parse(e.date + 'T00:00:00Z'))) return `entry ${i}: "date" is not a real date`;
                if (e.mode !== 'days' && e.mode !== 'weeks') return `entry ${i}: "mode" must be "days" or "weeks"`;
            }
            return null;
        },
    };

    const TOGGLE_FIELDS = [
        ['enableBackgrounds', 'Auto Backgrounds', 'Switch the background with /bg when the scene header location matches a Place card'],
        ['enableSeasonal', 'Seasonal Swaps', 'Swap a picked background for a seasonal variant in a given month (Advanced JSON)'],
        ['enableEra', 'Era Swaps', 'Swap a picked background once the story year passes a threshold (Advanced JSON)'],
        ['enableCostumes', 'Auto Costumes', 'Switch sprite costumes with /costume based on location and time of day'],
        ['enableCast', 'Cast Strip', 'Show portrait chips for NPCs who speak in the latest AI message'],
        ['enableHud', 'Scene HUD', 'Show a small fixed chip (top-right) with the parsed time · date · weather'],
        ['enableMoods', 'Cast Mood Bubbles', 'Heuristic mood per NPC chip: thought bubble emoji + optional <key>-happy/-angry/-sad.png portrait variant'],
        ['enableCrossfade', 'Sprite Crossfade', 'Fade the previous expression sprite out over the new one when it changes'],
        ['enableWeatherFx', 'Weather & Lighting Overlay', 'CSS tint (night/dusk/rain) + rain streaks behind the chat for backgrounds without graded variant files'],
        ['enableSpriteShadow', 'Sprite Shadow', 'Grounding drop-shadow under the expression sprite'],
        ['enableSpriteTint', 'Sprite Lighting Tint', 'Darken/warm the sprite to match the scene state (night/dusk/rain)'],
        ['enableBgCrossfade', 'Background Crossfade', 'Dip to black around each /bg switch (200ms in, 300ms out)'],
        ['enableTypingPresence', 'Typing Presence', 'Subtle sprite sway + "…" thought bubble while the model is generating'],
        ['enableKenBurns', 'Ken Burns Drift', 'Slow zoom/pan on the background (duration configurable below)'],
        ['enableFireFlicker', 'Fire Flicker', 'Warm flicker overlay when the applied background filename matches the fire regex'],
        ['enableBioCards', 'Bio Cards', 'Hover a cast chip for its card bio (or /characters/<folder>/npc/bios.json)'],
        ['enablePhotoMode', 'Photo Mode', '📷 button: composite background + tint + sprite + HUD to a downloadable PNG'],
        ['enableTabTitle', 'Tab Title', 'Set the browser tab title to <prefix> — <location>, <time> per message'],
        ['enableEmotionAccents', 'Emotion Accents', 'Transient lighting pulse when the sprite shows anger, fear or love/desire'],
        ['enableIdlePresence', 'Idle Presence', 'After a quiet period, drift between the sprite\'s neutral-* variants'],
        ['enableDayTrail', 'Day Trail', 'Accumulate today\'s distinct locations into the HUD hover tooltip'],
        ['enableCounters', 'Life Counters', 'User-defined date counters (days / weeks+days) from the story date, in the HUD tooltip'],
        ['enableSpeakingOrder', 'Speaking Order', 'Order cast chips by who spoke latest (latest first)'],
        ['enablePreload', 'Asset Preloading', 'Idle prefetch of every mapped background and the current sprite\'s neutral variants (skipped on slow connections)'],
        ['enableMoodTag', 'Inline Mood Tag', 'Zero-setup: the [MOOD] instruction is auto-injected near the end of the context, and a trailing [MOOD: <label>] in the AI reply sets the expression sprite directly (/emote) — no classifier API call, no preset edit. The tag is hidden from the rendered message; no tag = the classifier works as usual.'],
    ];

    const REGEX_FIELDS = [
        ['locationRegex', 'Location regex', 'Capture group 1 = location text'],
        ['timeRegex', 'Time regex', 'Group 1 = hour, group 2 = minutes, optional group 3 = AM/PM (omit for 24h)'],
        ['dateRegex', 'Date regex', 'Group 1 = month name or number, group 2 = day, group 3 = year'],
        ['weatherRegex', 'Weather regex', 'Group 1 = weather text, matched against the header line (default: last |-separated segment)'],
        ['rainRegex', 'Rain regex', 'Matched against the lowercased weather text — triggers the rain tint and streaks'],
        ['fireRegex', 'Fire regex', 'Matched against the APPLIED background filename — triggers the fire flicker overlay'],
    ];

    const NUMBER_FIELDS = [
        ['kenBurnsSeconds', 'Ken Burns sweep (seconds)', 5, 600],
        ['idleAfterSeconds', 'Idle presence after (seconds)', 10, 3600],
        ['idleEverySeconds', 'Idle swap every (seconds)', 5, 3600],
    ];

    const JSON_FIELDS = [
        ['seasonalMap', 'Seasonal map', '[{"month": 12, "from": "living.jpg", "to": "living-christmas.jpg"}]'],
        ['eraRules', 'Era rules', '[{"minYear": 2027, "pattern": "build site", "from": "frame.jpg", "to": "finished.jpg"}]'],
        ['costumeRules', 'Costume rules', '[{"pattern": "bedroom", "fromHour": 20, "toHour": 7, "costume": "pajamas"}] — "" costume = default'],
        ['moodKeywords', 'Mood keywords', '{"happy": "laugh|smil", "angry": "snap|glare", "sad": "tear|sob"} — regex sources, highest match count wins'],
        ['counters', 'Life counters', '[{"label": "married", "emoji": "💍", "date": "2026-07-11", "mode": "days"}] — computed from the parsed STORY date; "weeks" renders as 6w2d'],
    ];

    const PROMPT_SNIPPET = 'Begin every reply with a status line in this exact format:\n'
        + '[ 🕰️ <12h time> | ☀️ <Weekday, Month D, YYYY> | 📍 <current location> | 🌥️ <weather> ]';

    // Preset line for the Inline Mood Tag feature — lists all 28 labels the
    // expressions extension understands.
    const MOOD_PROMPT_SNIPPET = 'At the very end of every reply, on its own line, append '
        + '[MOOD: <one word>] choosing the single best fit from: '
        + EXPRESSION_LABELS.join(', ') + '.';

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function buildSettingsHtml() {
        const toggles = TOGGLE_FIELDS.map(([key, label, hint]) => `
            <label class="checkbox_label" title="${escapeHtml(hint)}">
                <input type="checkbox" id="sd_${key}" />
                <span>${escapeHtml(label)}</span>
            </label>`).join('');

        const regexes = REGEX_FIELDS.map(([key, label, hint]) => `
            <div class="scene-director-field">
                <label for="sd_${key}">${escapeHtml(label)}</label>
                <small>${escapeHtml(hint)}</small>
                <input type="text" id="sd_${key}" class="text_pole" spellcheck="false" />
                <div class="scene-director-error" id="sd_${key}_error"></div>
            </div>`).join('');

        const numbers = NUMBER_FIELDS.map(([key, label, min, max]) => `
            <div class="scene-director-field">
                <label for="sd_${key}">${escapeHtml(label)}</label>
                <input type="number" id="sd_${key}" class="text_pole" min="${min}" max="${max}" step="1" />
                <div class="scene-director-error" id="sd_${key}_error"></div>
            </div>`).join('');

        const jsons = JSON_FIELDS.map(([key, label, hint]) => `
            <div class="scene-director-field">
                <label for="sd_${key}">${escapeHtml(label)}</label>
                <small>${escapeHtml(hint)}</small>
                <textarea id="sd_${key}" class="text_pole textarea_compact" rows="4" spellcheck="false"></textarea>
                <div class="scene-director-error" id="sd_${key}_error"></div>
            </div>`).join('');

        return `
        <div id="scene_director_settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Scene Director</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div id="sd_firstrun" style="display:none" class="scene-director-banner">
                        <b>New here?</b> Scene Director works from a deck of cards describing your
                        story's world. Click <b>Scan my chat</b> and it will read your current chat,
                        find your characters' dialogue colours and your 📍 locations, and offer to
                        build the cards for you — a 60-second setup.
                    </div>
                    <div id="sd_compat_note" style="display:none" class="scene-director-compat"></div>

                    <div class="scene-director-section">Features</div>
                    ${toggles}

                    <div class="scene-director-section">Stage layout</div>
                    <small class="scene-director-help">HUD corner, cast strip corner/style/size, and the optional see-through chat panel. These apply instantly.</small>
                    <div class="scene-director-card-row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                        <label for="sd_hudPosition" style="font-size:12px;">HUD</label>
                        <select id="sd_hudPosition" class="text_pole" style="width:auto;" title="Corner for the scene HUD chip">
                            <option value="top-right">Top right</option>
                            <option value="top-left">Top left</option>
                            <option value="bottom-right">Bottom right</option>
                            <option value="bottom-left">Bottom left</option>
                        </select>
                        <label for="sd_castPosition" style="font-size:12px;">Cast</label>
                        <select id="sd_castPosition" class="text_pole" style="width:auto;" title="Corner the cast strip grows from (top corners stack a column under the HUD)">
                            <option value="top-right">Top right (column)</option>
                            <option value="top-left">Top left (column)</option>
                            <option value="bottom-left">Bottom left (row)</option>
                            <option value="bottom-right">Bottom right (row)</option>
                        </select>
                        <select id="sd_chipStyle" class="text_pole" style="width:auto;" title="Portrait chip style">
                            <option value="fade">Cutout (bottom fade)</option>
                            <option value="cloud">Cloud (radial glow)</option>
                            <option value="circle">Circle — use for photos with backgrounds</option>
                            <option value="plain">Plain (raw cutout)</option>
                        </select>
                    </div>
                    <label class="checkbox_label" title="28% of the window height, capped to the free gutter beside the chat panel; a tall column shrinks to fit">
                        <input type="checkbox" id="sd_chipSizeAuto" />
                        <span>Auto chip size (28vh)</span>
                    </label>
                    <div class="scene-director-card-row" style="display:flex;gap:8px;align-items:center;">
                        <span style="font-size:12px;">Chip size</span>
                        <input type="range" id="sd_chipSize" min="10" max="40" step="1" style="flex:1;" title="Chip height as % of the window height (when auto size is off)" />
                        <span id="sd_chipSizeVal" style="font-size:12px;min-width:42px;"></span>
                    </div>
                    <label class="checkbox_label" title="Freeze Auto Costumes — the outfit stays whatever /costume last set (window.sceneDirectorHoldCostume works too)">
                        <input type="checkbox" id="sd_holdCostume" />
                        <span>Hold costume</span>
                    </label>
                    <label class="checkbox_label" title="Make the chat panel see-through so the background shows">
                        <input type="checkbox" id="sd_enableChatGlass" />
                        <span>Chat panel glass</span>
                    </label>
                    <label class="checkbox_label" title="Keep SillyTavern's backdrop blur under the glass">
                        <input type="checkbox" id="sd_chatBlur" />
                        <span>Keep blur</span>
                    </label>
                    <div class="scene-director-card-row" style="display:flex;gap:8px;align-items:center;">
                        <span style="font-size:12px;">Chat opacity</span>
                        <input type="range" id="sd_chatOpacity" min="0" max="100" step="5" style="flex:1;" title="Chat panel background opacity" />
                        <span id="sd_chatOpacityVal" style="font-size:12px;min-width:42px;"></span>
                    </div>

                    <div class="scene-director-section">Scan my chat</div>
                    <small class="scene-director-help">Reads the current chat and suggests cast &amp; place cards from what your story already contains.</small>
                    <div class="scene-director-buttons">
                        <div id="sd_scan" class="menu_button">🔍 Scan my chat</div>
                    </div>
                    <div id="sd_scan_results" class="scene-director-scan" style="display:none"></div>

                    <div class="scene-director-section">Cast cards</div>
                    <small class="scene-director-help">One card per recurring character: chip portrait, dialogue colour, name regex, bio.</small>
                    <div id="sd_cast_cards"></div>
                    <div class="scene-director-buttons">
                        <div id="sd_cast_add" class="menu_button">+ Add cast card</div>
                        <div id="sd_cast_add_char" class="menu_button">Add from my characters ▾</div>
                    </div>
                    <select id="sd_cast_char_select" class="text_pole" style="display:none"></select>

                    <div class="scene-director-field">
                        <label for="sd_castFolder">Cast sprite folder</label>
                        <small>Character folder name: portraits load from /characters/&lt;folder&gt;/npc/&lt;key&gt;.png, bios from /characters/&lt;folder&gt;/npc/bios.json</small>
                        <input type="text" id="sd_castFolder" class="text_pole" spellcheck="false" />
                    </div>

                    <div class="scene-director-section">Place cards</div>
                    <small class="scene-director-help">One card per location: matcher regex + background slots (day / night / dusk / rain / seasonal), each picked from your installed backgrounds.</small>
                    <div id="sd_place_cards"></div>
                    <div class="scene-director-buttons">
                        <div id="sd_place_add" class="menu_button">+ Add place card</div>
                    </div>

                    <div class="scene-director-section">Scene header parsing</div>
                    <small class="scene-director-help">If your preset doesn't emit headers yet, add this to your system prompt:</small>
                    <div class="sd-snippet-wrap">
                        <pre id="sd_prompt_snippet" class="sd-snippet">${escapeHtml(PROMPT_SNIPPET)}</pre>
                        <div id="sd_copy_snippet" class="menu_button" title="Copy to clipboard">📋 Copy</div>
                    </div>
                    ${regexes}

                    <div class="scene-director-section">Inline Mood Tag</div>
                    <small class="scene-director-help">Zero-setup: with the Inline Mood Tag feature on (the default), this instruction is injected automatically near the end of the context — nothing to paste. The model reports its own mood in a trailing tag, the sprite follows it instantly via /emote, and the tag never shows in the rendered chat. The snippet is shown for reference / for presets that want to carry it themselves:</small>
                    <div class="sd-snippet-wrap">
                        <pre id="sd_mood_snippet" class="sd-snippet">${escapeHtml(MOOD_PROMPT_SNIPPET)}</pre>
                        <div id="sd_copy_mood_snippet" class="menu_button" title="Copy to clipboard">📋 Copy</div>
                    </div>

                    <div class="scene-director-section">Timings</div>
                    ${numbers}

                    <div class="scene-director-section">Advanced rules (JSON)</div>
                    ${jsons}
                    <div class="scene-director-field">
                        <label for="sd_titlePrefix">Tab title / photo prefix</label>
                        <small>Used in the browser tab title and photo filenames (blank = cast folder, else "Scene")</small>
                        <input type="text" id="sd_titlePrefix" class="text_pole" spellcheck="false" />
                    </div>
                    <div class="scene-director-buttons">
                        <div id="sd_apply" class="menu_button">Apply &amp; validate</div>
                        <div id="sd_test" class="menu_button">Test last message</div>
                    </div>
                    <div class="scene-director-error" id="sd_apply_status"></div>
                    <pre id="sd_test_output" class="scene-director-test-output" style="display:none"></pre>

                    <div class="scene-director-section">Import / export (power users)</div>
                    <small class="scene-director-help">The whole configuration — cards included — as JSON. Edit here, or move a setup between installs.</small>
                    <textarea id="sd_io" class="text_pole textarea_compact" rows="4" spellcheck="false"></textarea>
                    <div class="scene-director-buttons">
                        <div id="sd_export" class="menu_button">Export</div>
                        <div id="sd_import" class="menu_button">Import</div>
                    </div>
                    <div class="scene-director-error" id="sd_io_status"></div>
                </div>
            </div>
        </div>`;
    }

    function loadSettingsIntoForm() {
        const s = getSettings();
        for (const [key] of TOGGLE_FIELDS) {
            const el2 = document.getElementById(`sd_${key}`);
            if (el2) el2.checked = Boolean(s[key]);
        }
        for (const [key] of REGEX_FIELDS) {
            const el2 = document.getElementById(`sd_${key}`);
            if (el2) el2.value = s[key];
        }
        for (const [key] of NUMBER_FIELDS) {
            const el2 = document.getElementById(`sd_${key}`);
            if (el2) el2.value = s[key];
        }
        for (const [key] of JSON_FIELDS) {
            const el2 = document.getElementById(`sd_${key}`);
            if (el2) el2.value = JSON.stringify(s[key], null, 2);
        }
        const folder = document.getElementById('sd_castFolder');
        if (folder) folder.value = s.castFolder;
        const prefix = document.getElementById('sd_titlePrefix');
        if (prefix) prefix.value = s.titlePrefix;

        // First-run banner: shown while both card decks are empty.
        const banner = document.getElementById('sd_firstrun');
        if (banner) banner.style.display = (!s.cast.length && !s.places.length) ? 'block' : 'none';

        // Compat notes.
        const note = document.getElementById('sd_compat_note');
        if (note) {
            const lines = [];
            if (conflicts.prome) lines.push('Weather & Lighting Overlay disabled: Prome VN Extension detected (it owns scene tinting).');
            if (conflicts.weatherCycle) lines.push('Ken Burns Drift disabled: st-weather-cycle detected (it owns the background layer effects).');
            note.style.display = lines.length ? 'block' : 'none';
            note.textContent = lines.join(' ');
        }

        renderCastCards();
        renderPlaceCards();
    }

    function setFieldError(key, message) {
        const el2 = document.getElementById(`sd_${key}_error`);
        if (el2) el2.textContent = message || '';
    }

    /** Re-apply the always-on visuals + lazily managed loops after a settings change. */
    function refreshStatics(settings) {
        lastSpriteFilterState = null;
        try { updateSpriteFilter('neutral', settings); } catch (e) { /* ignore */ }
        try { updateKenBurns(settings); } catch (e) { /* ignore */ }
        try { updatePhotoButton(settings); } catch (e) { /* ignore */ }
        try { updateFireOverlay(settings); } catch (e) { /* ignore */ }
        if (!settings.enableTabTitle) restoreTabTitle();
        if (settings.enableIdlePresence) startIdleLoop(); else stopIdleLoop();
        if (settings.enableTypingPresence || settings.enableIdlePresence) {
            ensureGenHooks(SillyTavern.getContext());
        }
        if (settings.enableCrossfade) setupSpriteCrossfade(); else teardownSpriteCrossfade();
        if (!weatherFxActive(settings)) updateWeatherOverlay(null, settings);
        applyStripAppearance(settings);
        applyHudAppearance(settings);
        applyChatGlass(settings);
        updateMoodTagInjection(settings);
        biosPromise = null;     // castFolder may have changed
        mapPreloaded = false;   // maps may have changed
    }

    function applyForm() {
        const s = getSettings();
        const status = document.getElementById('sd_apply_status');
        let ok = true;
        const pending = {};

        for (const [key] of REGEX_FIELDS) {
            const value = document.getElementById(`sd_${key}`).value.trim();
            if (value && !compileRegex(value)) {
                setFieldError(key, 'Not a valid regular expression.');
                ok = false;
            } else {
                setFieldError(key, '');
                pending[key] = value;
            }
        }

        for (const [key, , min, max] of NUMBER_FIELDS) {
            const raw = document.getElementById(`sd_${key}`).value.trim();
            const value = parseInt(raw, 10);
            if (Number.isNaN(value) || value < min || value > max) {
                setFieldError(key, `Must be an integer between ${min} and ${max}.`);
                ok = false;
            } else {
                setFieldError(key, '');
                pending[key] = value;
            }
        }

        for (const [key] of JSON_FIELDS) {
            const raw = document.getElementById(`sd_${key}`).value.trim() || (key === 'moodKeywords' ? '{}' : '[]');
            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch (e) {
                setFieldError(key, `Invalid JSON: ${e.message}`);
                ok = false;
                continue;
            }
            const error = validators[key](parsed);
            if (error) {
                setFieldError(key, error);
                ok = false;
            } else {
                setFieldError(key, '');
                pending[key] = parsed;
            }
        }

        if (!ok) {
            status.textContent = 'Not saved — fix the errors above.';
            return;
        }

        for (const [key] of TOGGLE_FIELDS) {
            s[key] = document.getElementById(`sd_${key}`).checked;
        }
        Object.assign(s, pending);
        s.castFolder = document.getElementById('sd_castFolder').value.trim();
        s.titlePrefix = document.getElementById('sd_titlePrefix').value.trim();
        saveSettings();

        lastBg = null;
        lastBgGraded = false;
        lastCostume = null;
        refreshStatics(s);
        onMessage();

        status.textContent = 'Saved.';
        sdTimeout(() => { if (status.textContent === 'Saved.') status.textContent = ''; }, 3000);
    }

    /** Dry-run the parser on the current chat's last AI message. */
    function testLastMessage() {
        const out = document.getElementById('sd_test_output');
        out.style.display = 'block';
        try {
            const ctx = SillyTavern.getContext();
            const settings = getSettings();
            const last = getLastAiMessage(ctx);
            if (!last) {
                out.textContent = 'No AI message found at the end of the current chat.';
                return;
            }
            const scene = parseScene(last.mes, settings);
            const lines = [];
            lines.push(`location : ${scene.location ?? '(not found)'}`);
            lines.push(`hour     : ${scene.hour ?? '(not found)'}`);
            lines.push(`date     : ${scene.date ? `month=${scene.date.month} year=${scene.date.year}` : '(not found)'}`);
            if (scene.location) {
                const pick = pickBackground(scene.location, scene, settings);
                const finalBg = pick ? applyVariants(pick.file, scene.location, scene.date, settings) : null;
                lines.push(`background : ${pick ? pick.file : '(no place matched)'}${finalBg && pick && finalBg !== pick.file ? ` -> ${finalBg} (variant)` : ''}${pick && pick.graded ? ' [graded slot]' : ''}`);
                const costume = pickCostume(scene.location, scene.hour, settings);
                lines.push(`costume    : ${costume === null ? '(no time parsed — skipped)' : (costume || '(default)')}`);
            } else {
                lines.push('background : (skipped — no location)');
                lines.push('costume    : (skipped — no location)');
            }
            lines.push(`weather    : ${scene.weather ?? '(not found)'}${scene.raining ? ' [rain]' : ''}`);
            lines.push(`scene state: ${scene.state}`);
            const hudParts = buildHudParts(scene);
            lines.push(`hud        : ${hudParts ? hudParts.join(' · ') : '(nothing parsed)'}`);
            const counters = buildCounters(scene.date, settings);
            lines.push(`counters   : ${counters || '(none)'}`);
            const { present, speakerKey } = analyzeCast(scene, settings);
            lines.push(`cast       : ${present.length ? present.map(p => {
                const mood = detectMood(scene.text, p.member, settings);
                return p.member.label
                    + (p.member.key === speakerKey ? ' [speaking]' : '')
                    + (mood !== 'neutral' ? ` [${mood}]` : '');
            }).join(', ') : '(none detected)'}`);
            if (settings.enableMoodTag) {
                const moodTag = detectMoodTag(last.mes);
                lines.push(`mood tag   : ${moodTag ? `${moodTag} -> /emote ${moodTag} (tag hidden from render)` : '(no trailing [MOOD: …] tag found)'}`);
            }
            if (conflicts.prome) lines.push('compat     : Prome VN detected — weather/lighting overlay off');
            if (conflicts.weatherCycle) lines.push('compat     : st-weather-cycle detected — Ken Burns off');
            out.textContent = lines.join('\n');
        } catch (e) {
            out.textContent = `Test failed: ${e}`;
            console.error(`${LOG} test failed`, e);
        }
    }

    function wireCardUi() {
        const castAdd = document.getElementById('sd_cast_add');
        if (castAdd) castAdd.addEventListener('click', function () { addCastMember({}); });

        const charBtn = document.getElementById('sd_cast_add_char');
        const charSel = document.getElementById('sd_cast_char_select');
        if (charBtn && charSel) {
            charBtn.addEventListener('click', function () {
                populateCharacterDropdown();
                charSel.style.display = charSel.style.display === 'none' ? '' : 'none';
            });
            charSel.addEventListener('change', function () {
                try {
                    const ctx = SillyTavern.getContext();
                    const ch = (ctx.characters || [])[parseInt(charSel.value, 10)];
                    if (ch && ch.name) {
                        addCastMember({
                            label: ch.name,
                            key: slugify(ch.name),
                            avatar: ch.avatar ? characterThumbUrl(ctx, ch.avatar) : '',
                        });
                    }
                } catch (e) { console.error(`${LOG} add-from-characters failed`, e); }
                charSel.style.display = 'none';
                charSel.value = '';
            });
        }

        const placeAdd = document.getElementById('sd_place_add');
        if (placeAdd) placeAdd.addEventListener('click', function () { addPlace({}); });

        const scan = document.getElementById('sd_scan');
        if (scan) scan.addEventListener('click', renderScanResults);

        const copyBtn = document.getElementById('sd_copy_snippet');
        if (copyBtn) copyBtn.addEventListener('click', function () {
            try {
                navigator.clipboard.writeText(PROMPT_SNIPPET).then(function () {
                    copyBtn.textContent = '✓ Copied';
                    sdTimeout(function () { copyBtn.textContent = '📋 Copy'; }, 2000);
                });
            } catch (e) { /* ignore */ }
        });

        const copyMoodBtn = document.getElementById('sd_copy_mood_snippet');
        if (copyMoodBtn) copyMoodBtn.addEventListener('click', function () {
            try {
                navigator.clipboard.writeText(MOOD_PROMPT_SNIPPET).then(function () {
                    copyMoodBtn.textContent = '✓ Copied';
                    sdTimeout(function () { copyMoodBtn.textContent = '📋 Copy'; }, 2000);
                });
            } catch (e) { /* ignore */ }
        });

        // v0.5.0 stage layout controls — instant apply.
        function stageChanged() {
            saveSettings();
            refreshStatics(getSettings());
        }
        const bindSelect = function (id, key) {
            const el2 = document.getElementById(id);
            if (!el2) return;
            el2.value = getSettings()[key];
            el2.addEventListener('change', function () {
                getSettings()[key] = el2.value;
                stageChanged();
            });
        };
        bindSelect('sd_hudPosition', 'hudPosition');
        bindSelect('sd_castPosition', 'castPosition');
        bindSelect('sd_chipStyle', 'chipStyle');
        const bindCheck = function (id, key) {
            const el2 = document.getElementById(id);
            if (!el2) return;
            el2.checked = Boolean(getSettings()[key]);
            el2.addEventListener('change', function () {
                getSettings()[key] = el2.checked;
                stageChanged();
            });
            return el2;
        };
        const autoCb = bindCheck('sd_chipSizeAuto', 'chipSizeAuto');
        bindCheck('sd_holdCostume', 'holdCostume');
        bindCheck('sd_enableChatGlass', 'enableChatGlass');
        bindCheck('sd_chatBlur', 'chatBlur');
        const sizeIn = document.getElementById('sd_chipSize');
        const sizeVal = document.getElementById('sd_chipSizeVal');
        if (sizeIn) {
            sizeIn.value = String(getSettings().chipSize || 28);
            if (sizeVal) sizeVal.textContent = sizeIn.value + 'vh';
            sizeIn.addEventListener('input', function () {
                if (sizeVal) sizeVal.textContent = sizeIn.value + 'vh';
                const st = getSettings();
                st.chipSize = Number(sizeIn.value);
                st.chipSizeAuto = false;
                if (autoCb) autoCb.checked = false;
                applyStripAppearance(st);
            });
            sizeIn.addEventListener('change', stageChanged);
        }
        const opIn = document.getElementById('sd_chatOpacity');
        const opVal = document.getElementById('sd_chatOpacityVal');
        if (opIn) {
            const cur = Number(getSettings().chatOpacity);
            opIn.value = String(Math.round((Number.isFinite(cur) ? cur : 0.55) * 100));
            if (opVal) opVal.textContent = opIn.value + '%';
            opIn.addEventListener('input', function () {
                if (opVal) opVal.textContent = opIn.value + '%';
                const st = getSettings();
                st.chatOpacity = Number(opIn.value) / 100;
                applyChatGlass(st);
            });
            opIn.addEventListener('change', stageChanged);
        }

        const exportBtn = document.getElementById('sd_export');
        const importBtn = document.getElementById('sd_import');
        const io = document.getElementById('sd_io');
        const ioStatus = document.getElementById('sd_io_status');
        if (exportBtn && io) exportBtn.addEventListener('click', function () {
            io.value = JSON.stringify(getSettings(), null, 2);
            if (ioStatus) ioStatus.textContent = '';
        });
        if (importBtn && io) importBtn.addEventListener('click', function () {
            try {
                const parsed = JSON.parse(io.value);
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    throw new Error('top level must be an object');
                }
                const s = getSettings();
                for (const key of Object.keys(defaultSettings)) {
                    if (parsed[key] !== undefined) s[key] = parsed[key];
                }
                migrateSettings(s);
                saveSettings();
                loadSettingsIntoForm();
                refreshStatics(s);
                lastBg = null;
                lastCostume = null;
                onMessage();
                if (ioStatus) ioStatus.textContent = 'Imported.';
            } catch (e) {
                if (ioStatus) ioStatus.textContent = 'Import failed: ' + e.message;
            }
        });
    }

    function addSettingsUi() {
        const panel = document.getElementById('extensions_settings2')
            || document.getElementById('extensions_settings');
        if (!panel) {
            console.warn(`${LOG} extensions settings panel not found; settings UI skipped`);
            return;
        }
        const holder = document.createElement('div');
        holder.innerHTML = buildSettingsHtml();
        panel.appendChild(holder.firstElementChild);
        loadSettingsIntoForm();
        document.getElementById('sd_apply').addEventListener('click', applyForm);
        document.getElementById('sd_test').addEventListener('click', testLastMessage);
        wireCardUi();
    }

    // ------------------------------------------------------------------
    // Init
    // ------------------------------------------------------------------

    function init() {
        try {
            const ctx = SillyTavern.getContext();
            const settings = getSettings();
            migrateSettings(settings);
            conflicts = detectConflicts(ctx);
            addSettingsUi();
            const et = ctx.eventTypes || ctx.event_types;
            ctx.eventSource.on(et.MESSAGE_RECEIVED, onMessage);
            ctx.eventSource.on(et.MESSAGE_SWIPED, onMessage);
            if (et.CHAT_CHANGED) ctx.eventSource.on(et.CHAT_CHANGED, onChatChanged);
            // Generation hooks are lazy — only when a feature needs them.
            if (settings.enableTypingPresence || settings.enableIdlePresence) {
                ensureGenHooks(ctx);
            }
            if (settings.enableCrossfade) setupSpriteCrossfade();
            document.addEventListener('visibilitychange', onVisibilityChange);
            refreshStatics(settings);
            // v0.5.0: per-chat state for the chat we open into.
            try {
                const meta = chatMeta(false);
                if (meta && meta.lastCostume !== undefined) lastCostume = meta.lastCostume;
            } catch (e) { /* ignore */ }
            try { restoreTrail(settings); } catch (e) { /* ignore */ }
            try { seedPresenceFromChat(settings); } catch (e) { /* ignore */ }
            try { setupStripResizeObserver(); } catch (e) { /* ignore */ }
            try { replayExpression(ctx, settings, 2500); } catch (e) { /* ignore */ }
            console.log(`${LOG} loaded (v0.5.1)`);
        } catch (e) {
            console.error(`${LOG} failed to initialise`, e);
        }
    }

    if (window.SillyTavern && SillyTavern.getContext) {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();
