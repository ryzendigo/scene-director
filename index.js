/**
 * Scene Director — a SillyTavern UI extension.
 *
 * Reads a structured "scene header" out of each incoming AI message, e.g.:
 *
 *   [ 🕰️ 2:14 PM | ☀️ Tuesday, August 11, 2026 | 📍 Granty's kitchen | 🌥️ Overcast ]
 *
 * ...and uses what it finds to direct the scene:
 *
 *   - Auto Backgrounds : location text -> /bg <file> via a regex map
 *   - Seasonal Swaps   : month-of-year swaps one background for a variant
 *   - Era Swaps        : story year >= threshold swaps one background for another
 *   - Auto Costumes    : location + time-of-day -> /costume <folder>
 *   - Cast Strip       : portrait chips for NPCs who speak in the message,
 *                        detected by their dialogue font colour (hex code in the
 *                        raw message text) or by a name regex
 *   - Scene HUD        : a small fixed chip (top-right) showing the parsed
 *                        header parts: time · date · weather
 *   - Cast Mood Bubbles: keyword heuristic per present NPC -> optional mood
 *                        portrait variant (<key>-happy/-angry/-sad.png) and a
 *                        comic thought bubble above the chip
 *   - Sprite Crossfade : fades the previous expression sprite out over the
 *                        new one when the sprite image changes
 *   - Weather & Lighting Overlay : a CSS tint/rain overlay behind the chat
 *                        for backgrounds without pre-graded variant files
 *
 * v0.3.0 — the "presence pack":
 *
 *   - Sprite Shadow    : grounding drop-shadow under the expression sprite
 *   - Sprite Tint      : lighting-matched sprite filter for night/dusk/rain
 *   - Background Crossfade : black-dip fade around each /bg switch
 *   - Typing Presence  : subtle sway + '…' thought bubble while generating
 *   - Ken Burns Drift  : slow zoom/pan on ST's background element (#bg1)
 *   - Fire Flicker     : warm flicker overlay when the background filename
 *                        matches a configurable pattern (fireplace/christmas)
 *   - Bio Cards        : hover a cast chip -> one-line bio tooltip, read once
 *                        from /characters/<castFolder>/npc/bios.json
 *   - Photo Mode       : 📷 button composites background + tint + sprite +
 *                        HUD onto a canvas and downloads a PNG
 *   - Tab Title        : document.title = <prefix> — <location>, <time>
 *   - Emotion Accents  : transient lighting pulse (anger/fear/love) keyed off
 *                        the expression sprite's filename
 *   - Idle Presence    : after a quiet period, crossfade between the sprite's
 *                        neutral variants (never fights the expressions ext)
 *   - Day Trail        : today's distinct locations in the HUD hover tooltip
 *   - Life Counters    : user-defined date counters (days / weeks+days) from
 *                        the parsed STORY date, in the HUD tooltip
 *   - Speaking Order   : cast chips ordered latest-speaker-first
 *   - Asset Preloading : idle prefetch of mapped backgrounds + neutral sprites
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

    // ------------------------------------------------------------------
    // Default settings
    // ------------------------------------------------------------------
    // The three header regexes default to the "Frankenstein" header format
    // shown above. All maps default to empty: this extension ships with no
    // opinions about your backgrounds or cast — see the README for a full
    // worked example you can paste in.
    //
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

        // v0.3.0 numeric tuning.
        kenBurnsSeconds: 75,     // one Ken Burns sweep (alternates back)
        idleAfterSeconds: 90,    // quiet time before idle presence starts
        idleEverySeconds: 45,    // interval between idle sprite swaps

        // v0.3.0 misc config.
        // Tab title / photo filename prefix ('' => castFolder, else 'Scene').
        titlePrefix: '',
        // Fire flicker: regex tested against the APPLIED background filename.
        fireRegex: 'fireplace|christmas',
        // Life counters, computed from the parsed STORY date (not real time).
        // mode 'days'  => "💍 31 days"
        // mode 'weeks' => "🤰 6w2d"
        // [{ "label": "married", "emoji": "💍", "date": "2026-07-11", "mode": "days" }]
        counters: [],

        // Header parsing (regex sources, compiled with the 'i' flag).
        locationRegex: '📍([^|\\]]+)',
        timeRegex: '🕰️?\\s*(\\d{1,2}):(\\d{2})\\s*(AM|PM)',
        dateRegex: '(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{1,2}),?\\s+(\\d{4})',
        // Weather: group 1 = the weather text, matched against the header
        // line (the line the location regex hit). Default: the last
        // |-separated segment of a [ ... ] header.
        weatherRegex: '\\|\\s*([^|\\[\\]]+)\\]\\s*$',
        // Rain detection (tested against the extracted weather text,
        // lowercased) — drives the -rain overlay and the rain streaks.
        rainRegex: 'rain|storm|shower|drizzl',

        // Cast Mood Bubbles: keyword sets (regex sources, matched globally,
        // case-insensitive) scored over each present NPC's dialogue spans
        // plus a ±120-char narration window; highest score wins, ties and
        // zero scores are neutral (no bubble, base portrait).
        moodKeywords: {
            happy: 'laugh|chuckl|smil|grin|warm|bright|beam',
            angry: 'snap|sharp|cold|flat|hard|stern|glare|slam|hiss',
            sad: 'tear|wept|weep|cries|crying|sob|quiet(?:ly)?\\s+sad|trembl|waver',
        },

        // Auto Backgrounds: first entry whose pattern matches the location
        // wins, so order specific patterns before generic ones.
        // [{ "pattern": "hay ?loft|barn", "background": "barn-loft.jpg" }]
        backgroundMap: [],

        // Seasonal Swaps: applied after the background map picks a file.
        // [{ "month": 12, "from": "living-room.jpg", "to": "living-room-christmas.jpg" }]
        seasonalMap: [],

        // Era Swaps: applied when the story year crosses a threshold.
        // [{ "minYear": 2027, "pattern": "build site|the rise", "from": "house-frame.jpg", "to": "house-finished.jpg" }]
        eraRules: [],

        // Auto Costumes: first matching rule wins. Hours are 0-23 and the
        // window may wrap midnight (fromHour 20, toHour 7 = 8pm-7am).
        // An empty "costume" (or a rule that doesn't match) means the
        // character's default costume.
        // [{ "pattern": "bedroom", "fromHour": 20, "toHour": 7, "costume": "pajamas" }]
        costumeRules: [],

        // Cast Strip: chips are read from /characters/<castFolder>/npc/<key>.png.
        // Presence = colorHex appears in the raw message (their dialogue
        // colour => they spoke), OR nameRegex matches the message text.
        // [{ "key": "granty", "label": "Granty", "colorHex": "#B0BEC5", "nameRegex": "granty" }]
        cast: [],
        castFolder: '',
    };

    // Dedupe state: never re-issue /bg or /costume for an unchanged value.
    // Reset when the user switches chats so the new chat gets a fresh apply.
    let lastBg = null;
    let lastCostume = null; // '' = default costume, null = never applied

    // v0.3.0 shared state.
    const ORIGINAL_TITLE = document.title;
    let lastParsedDate = null;   // {year, month, day} from the latest header
    let lastParsedLoc = null;    // location text from the latest header
    let lastActivityTs = Date.now();
    let lastIdleSwapTs = 0;
    let generating = false;
    let idleTimer = null;
    let mapPreloaded = false;
    let biosPromise = null;              // one bios.json fetch per session
    const neutralVariantCache = {};      // sprite folder+ext -> Promise<url[]>
    let trailDateKey = null;
    let trailLocs = [];

    // ------------------------------------------------------------------
    // Settings plumbing
    // ------------------------------------------------------------------

    function getSettings() {
        const ctx = SillyTavern.getContext();
        const store = ctx.extensionSettings;
        if (!store[MODULE]) {
            store[MODULE] = structuredClone(defaultSettings);
        }
        // Fill in any keys added after the user first saved settings.
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
    // Parsing helpers
    // ------------------------------------------------------------------

    /** Compile a regex source with the 'i' flag; null (not a throw) on bad input. */
    function compileRegex(source) {
        if (!source) return null;
        try {
            return new RegExp(source, 'i');
        } catch (e) {
            console.warn(`${LOG} invalid regex: ${source}`, e);
            return null;
        }
    }

    const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
        'july', 'august', 'september', 'october', 'november', 'december'];

    /** Accepts an English month name or "1".."12"; returns 1-12 or null. */
    function monthToNumber(raw) {
        if (raw == null) return null;
        const asNum = parseInt(raw, 10);
        if (!Number.isNaN(asNum)) {
            return (asNum >= 1 && asNum <= 12) ? asNum : null;
        }
        const idx = MONTHS.indexOf(String(raw).trim().toLowerCase());
        return idx >= 0 ? idx + 1 : null;
    }

    /** Extract the location text from a message, or null. */
    function extractLocation(text, settings) {
        const re = compileRegex(settings.locationRegex);
        if (!re || !text) return null;
        const m = re.exec(text);
        return (m && m[1]) ? m[1].trim() : null;
    }

    /** Extract the hour (0-23) from a message, or null. */
    function extractHour(text, settings) {
        const re = compileRegex(settings.timeRegex);
        if (!re || !text) return null;
        const m = re.exec(text);
        if (!m) return null;
        let hour = parseInt(m[1], 10);
        if (Number.isNaN(hour)) return null;
        const meridiem = m[3] ? m[3].toUpperCase() : null;
        if (meridiem) {
            // 12-hour clock
            if (hour < 1 || hour > 12) return null;
            if (meridiem === 'PM' && hour !== 12) hour += 12;
            if (meridiem === 'AM' && hour === 12) hour = 0;
        } else {
            // 24-hour clock
            if (hour < 0 || hour > 23) return null;
        }
        return hour;
    }

    /** Extract { month: 1-12, day: 1-31|null, year } from a message, or null. */
    function extractDate(text, settings) {
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

    /** The scene-header line: the first line the location regex matches, or null. */
    function extractHeaderLine(text, settings) {
        const re = compileRegex(settings.locationRegex);
        if (!re || !text) return null;
        for (const line of text.split('\n')) {
            if (re.test(line)) return line.trim();
        }
        return null;
    }

    /** Extract the weather text from the header line, or null. */
    function extractWeather(text, settings) {
        const line = extractHeaderLine(text, settings);
        const re = compileRegex(settings.weatherRegex);
        if (!re || !line) return null;
        const m = re.exec(line);
        if (!m || !m[1]) return null;
        const value = m[1].trim();
        // Don't echo the location segment back as "weather".
        const locRe = compileRegex(settings.locationRegex);
        if (locRe && locRe.test(value)) return null;
        return value || null;
    }

    /** True when the extracted weather text reads as rain. */
    function isRaining(weather, settings) {
        if (!weather) return false;
        const re = compileRegex(settings.rainRegex);
        return Boolean(re && re.test(weather.toLowerCase()));
    }

    // ------------------------------------------------------------------
    // Feature logic (pure functions — also driven by the "Test" button)
    // ------------------------------------------------------------------

    /** First background-map entry whose pattern matches the location. */
    function pickBackground(location, settings) {
        for (const entry of settings.backgroundMap) {
            const re = compileRegex(entry.pattern);
            if (re && re.test(location)) return entry.background;
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
        if (fromHour === toHour) return true; // whole day
        if (fromHour < toHour) return hour >= fromHour && hour < toHour;
        return hour >= fromHour || hour < toHour; // wraps midnight
    }

    /**
     * First matching costume rule wins. Returns the costume folder name,
     * '' for "default costume", or null when hour is unknown (=> do nothing).
     */
    function pickCostume(location, hour, settings) {
        if (hour === null) return null;
        for (const rule of settings.costumeRules) {
            const re = compileRegex(rule.pattern);
            if (re && re.test(location) && hourInWindow(hour, rule.fromHour, rule.toHour)) {
                return rule.costume || '';
            }
        }
        return ''; // no rule matched => default costume
    }

    /** Cast members present in the message (colour hit preferred, then name). */
    function detectCast(text, settings) {
        const present = [];
        if (!text) return present;
        const lower = text.toLowerCase();
        for (const member of settings.cast) {
            let hit = false;
            if (member.colorHex && lower.includes(member.colorHex.toLowerCase())) {
                hit = true;
            } else if (member.nameRegex) {
                const re = compileRegex(member.nameRegex);
                if (re && re.test(text)) hit = true;
            }
            if (hit) present.push(member);
        }
        return present;
    }

    /**
     * The cast member who is "speaking": the one whose dialogue colour hex
     * appears LATEST in the raw message text. Members without a colorHex
     * can't win. Returns the member's key, or null.
     */
    function detectSpeaker(text, settings) {
        if (!text) return null;
        const lower = text.toLowerCase();
        let bestKey = null;
        let bestPos = -1;
        for (const member of settings.cast) {
            if (!member.colorHex) continue;
            const pos = lower.lastIndexOf(member.colorHex.toLowerCase());
            if (pos > bestPos) { bestPos = pos; bestKey = member.key; }
        }
        return bestKey;
    }

    // ------------------------------------------------------------------
    // Cast moods
    // ------------------------------------------------------------------

    const MOODS = ['happy', 'angry', 'sad'];
    const MOOD_EMOJI = { happy: '😊', angry: '😠', sad: '😢' };

    /**
     * Heuristic mood for one cast member: score the configured keyword sets
     * over the text of their <font color="#hex"> dialogue spans plus a
     * ±120-char narration window around each span (name-regex matches for
     * members without a colour). Highest score wins; zero => 'neutral'.
     */
    function detectMood(text, member, settings) {
        try {
            if (!text) return 'neutral';
            let corpus = '';
            if (member.colorHex) {
                const spanRe = new RegExp(
                    '<font\\s+color="?' + member.colorHex + '"?[^>]*>([\\s\\S]*?)</font>', 'gi');
                let m;
                while ((m = spanRe.exec(text)) !== null) {
                    corpus += ' ' + m[1];
                    corpus += ' ' + text.slice(Math.max(0, m.index - 120),
                        Math.min(text.length, m.index + m[0].length + 120));
                }
            }
            if (!corpus && member.nameRegex) {
                const re = new RegExp(member.nameRegex, 'gi');
                let m;
                while ((m = re.exec(text)) !== null) {
                    corpus += ' ' + text.slice(Math.max(0, m.index - 120),
                        Math.min(text.length, m.index + m[0].length + 120));
                    if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
                }
            }
            if (!corpus) return 'neutral';
            const low = corpus.toLowerCase();
            let best = 'neutral';
            let bestScore = 0;
            for (const mood of MOODS) {
                const source = settings.moodKeywords?.[mood];
                if (!source) continue;
                let score = 0;
                try {
                    score = (low.match(new RegExp(source, 'g')) || []).length;
                } catch (e) { /* bad user regex — treat as 0 */ }
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

    /** HUD line parts (time / date / weather) parsed from the header, or null. */
    function buildHudParts(text, settings) {
        const line = extractHeaderLine(text, settings);
        if (!line) return null;
        const parts = [];
        const timeRe = compileRegex(settings.timeRegex);
        const t = timeRe ? timeRe.exec(line) : null;
        if (t) parts.push(t[0].replace(/\s+/g, ' ').trim());
        const date = extractDate(line, settings);
        if (date) {
            if (date.day) {
                const js = new Date(date.year, date.month - 1, date.day);
                parts.push(`${DAY_NAMES[js.getDay()]} ${MON_NAMES[date.month - 1]} ${date.day} ${date.year}`);
            } else {
                parts.push(`${MON_NAMES[date.month - 1]} ${date.year}`);
            }
        }
        const weather = extractWeather(text, settings);
        if (weather) parts.push(weather);
        return parts.length ? parts : null;
    }

    function updateSceneHud(text, settings) {
        try {
            let hud = document.getElementById('scene-director-hud');
            const parts = settings.enableHud ? buildHudParts(text, settings) : null;
            if (!parts) {
                if (hud) hud.style.display = 'none';
                return;
            }
            if (!hud) {
                hud = document.createElement('div');
                hud.id = 'scene-director-hud';
                document.body.appendChild(hud);
            }
            hud.style.display = '';
            hud.textContent = parts.join(' · ');
        } catch (e) {
            console.error(`${LOG} scene HUD failed`, e);
        }
    }

    // ------------------------------------------------------------------
    // Day trail & life counters (v0.3.0) — shown as the HUD hover tooltip
    // ------------------------------------------------------------------

    function updateDayTrail(date, location, settings) {
        try {
            if (!settings.enableDayTrail || !location) return;
            const key = date ? `${date.year}-${date.month}-${date.day}` : trailDateKey;
            if (key !== trailDateKey) { // story date changed => new day, reset
                trailDateKey = key;
                trailLocs = [];
            }
            if (!trailLocs.includes(location)) trailLocs.push(location);
        } catch (e) { /* ignore */ }
    }

    function pad2(n) { return String(n).padStart(2, '0'); }

    /**
     * User-defined counters computed from the parsed STORY date.
     * mode 'days'  => "<emoji> <n> days"; mode 'weeks' => "<emoji> <w>w<d>d".
     * Counters whose anchor date is after the story date are hidden.
     */
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
            const hud = document.getElementById('scene-director-hud');
            if (!hud) return;
            const lines = [];
            if (settings.enableDayTrail && trailLocs.length) lines.push(trailLocs.join(' → '));
            const counters = buildCounters(date, settings);
            if (counters) lines.push(counters);
            hud.title = lines.join('\n');
        } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // Sprite crossfade
    // ------------------------------------------------------------------

    // Watches the ST expression sprite (#expression-image inside
    // #expression-holder). On a src change, a clone of the previous image is
    // absolutely positioned over the new one and faded out over 300ms.
    // ST sometimes REPLACES the img node with a clone (its own animated
    // path, marked .expression-animating/.expression-clone), so we observe
    // the holder with subtree — and suppress our ghost while ST's own
    // animation is running to avoid doubling it.
    let spriteObserver = null;
    let lastSpriteSrc = null;

    function currentSpriteImg() {
        return document.getElementById('expression-image')
            || document.querySelector('#expression-holder img:not(.scene-director-sprite-ghost)');
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
                    // ST's own crossfade is mid-flight — don't double it.
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
                    ghost.style.left = rect.left + 'px';
                    ghost.style.top = rect.top + 'px';
                    ghost.style.width = rect.width + 'px';
                    ghost.style.height = rect.height + 'px';
                    ghost.style.opacity = '1';
                    document.body.appendChild(ghost);
                    requestAnimationFrame(function () { ghost.style.opacity = '0'; });
                    setTimeout(function () { try { ghost.remove(); } catch (e) { /* ignore */ } }, 350);
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
    // Weather & lighting overlay
    // ------------------------------------------------------------------

    // A full-viewport tinted overlay behind the chat (z-index -1: above ST's
    // background layers at -3/-2, below the UI) for backgrounds WITHOUT
    // pre-graded variant files. When the currently applied background is
    // already a graded variant (filename ends in -night/-rain/-dusk), the
    // tint is suppressed to avoid double-darkening — but the pure-CSS rain
    // streaks may still show for rain. Windows: night 19:00–05:59, dusk
    // 17:00–18:59 (rain is weather-text driven).
    const GRADED_VARIANT_RE = /-(night|rain|dusk)\.[a-z0-9]+$/i;

    /** Scene lighting state shared by the overlay and the sprite tint. */
    function computeSceneState(hour, weather, settings) {
        const raining = isRaining(weather, settings);
        const night = hour !== null && hour !== undefined && (hour >= 19 || hour < 6);
        const dusk = hour !== null && hour !== undefined && hour >= 17 && hour < 19;
        return night ? 'night' : (raining ? 'rain' : (dusk ? 'dusk' : 'neutral'));
    }

    function updateWeatherOverlay(hour, weather, settings) {
        try {
            let ov = document.getElementById('scene-director-wx-overlay');
            if (!settings.enableWeatherFx) {
                if (ov) {
                    ov.style.backgroundColor = 'transparent';
                    const r = document.getElementById('scene-director-wx-rain');
                    if (r) r.style.display = 'none';
                }
                return;
            }
            if (!ov) {
                ov = document.createElement('div');
                ov.id = 'scene-director-wx-overlay';
                const rain = document.createElement('div');
                rain.id = 'scene-director-wx-rain';
                ov.appendChild(rain);
                document.body.appendChild(ov);
            }
            const rainEl = document.getElementById('scene-director-wx-rain');
            const raining = isRaining(weather, settings);
            const night = hour !== null && hour !== undefined && (hour >= 19 || hour < 6);
            const dusk = hour !== null && hour !== undefined && hour >= 17 && hour < 19;
            const variantApplied = Boolean(lastBg && GRADED_VARIANT_RE.test(lastBg));
            let tint = 'transparent';
            if (!variantApplied) {
                if (night) tint = 'rgba(10,15,40,0.45)';        // blue-black night
                else if (raining) tint = 'rgba(40,60,90,0.35)'; // grey-blue rain
                else if (dusk) tint = 'rgba(255,180,80,0.18)';  // amber dusk
            }
            ov.style.backgroundColor = tint;
            if (rainEl) rainEl.style.display = raining ? 'block' : 'none';
        } catch (e) {
            console.error(`${LOG} weather overlay failed`, e);
        }
    }

    // ------------------------------------------------------------------
    // Sprite shadow & lighting tint (v0.3.0)
    // ------------------------------------------------------------------

    // ONE composed filter string (the two features share the CSS `filter`
    // property, so they must be built together), applied through a CSS
    // variable so it survives ST cloning/replacing the sprite img node.
    function updateSpriteFilter(state, settings) {
        try {
            const parts = [];
            if (settings.enableSpriteShadow) {
                parts.push('drop-shadow(0 12px 18px rgba(0,0,0,.45))');
            }
            if (settings.enableSpriteTint) {
                if (state === 'night') parts.push('brightness(.75) saturate(.85)');
                else if (state === 'dusk') parts.push('sepia(.25) brightness(.9)');
                else if (state === 'rain') parts.push('brightness(.8) saturate(.7)');
            }
            document.documentElement.style.setProperty(
                '--scene-director-sprite-filter', parts.length ? parts.join(' ') : 'none');
        } catch (e) {
            console.error(`${LOG} sprite filter failed`, e);
        }
    }

    // ------------------------------------------------------------------
    // Background crossfade (v0.3.0)
    // ------------------------------------------------------------------

    // Dip a black overlay (between ST's background layers and the UI) to
    // ~0.6 over 200ms, issue the /bg, then fade back over 300ms.
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
            await new Promise(function (r) { setTimeout(r, 200); });
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
    // Typing presence (v0.3.0)
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
                bubble.className = 'scene-director-mood-bubble'; // reuse bubble look
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

    // ------------------------------------------------------------------
    // Ken Burns drift (v0.3.0)
    // ------------------------------------------------------------------

    // ST paints the current background as a background-image on #bg1
    // (public/scripts/backgrounds.js: $('#bg1').css('background-image', ...)),
    // so a transform animation composes cleanly with its image swaps.
    function updateKenBurns(settings) {
        try {
            const bgEl = document.getElementById('bg1');
            if (!bgEl) return;
            bgEl.classList.toggle('scene-director-kenburns', Boolean(settings.enableKenBurns));
            const secs = Number(settings.kenBurnsSeconds) || 75;
            bgEl.style.animationDuration = settings.enableKenBurns ? secs + 's' : '';
        } catch (e) {
            console.error(`${LOG} ken burns failed`, e);
        }
    }

    // ------------------------------------------------------------------
    // Fire flicker (v0.3.0)
    // ------------------------------------------------------------------

    function updateFireOverlay(settings) {
        try {
            const re = compileRegex(settings.fireRegex);
            const on = Boolean(settings.enableFireFlicker && lastBg && re && re.test(lastBg));
            let ov = document.getElementById('scene-director-fire-overlay');
            if (!ov) {
                if (!on) return;
                ov = document.createElement('div');
                ov.id = 'scene-director-fire-overlay';
                document.body.appendChild(ov);
            }
            ov.style.display = on ? 'block' : 'none';
        } catch (e) {
            console.error(`${LOG} fire flicker failed`, e);
        }
    }

    // ------------------------------------------------------------------
    // Bio cards (v0.3.0)
    // ------------------------------------------------------------------

    // Convention: /characters/<castFolder>/npc/bios.json is a flat object
    // mapping cast keys to one-line bios: { "granty": "Rachel's grandmother
    // and the keeper of the kitchen." }. Fetched once per session; a missing
    // file means the feature quietly does nothing.
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
            // Above the chip; measure after display for the real height.
            card.style.top = Math.max(6, rect.top - card.offsetHeight - 10) + 'px';
        } catch (e) { /* ignore */ }
    }

    function hideBioCard() {
        try {
            const card = document.getElementById('scene-director-bio-card');
            if (card) card.style.display = 'none';
        } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // Photo mode (v0.3.0)
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

    // Composites the current ST background + weather tint + expression
    // sprite + HUD text onto a viewport-sized canvas and downloads a PNG.
    // Everything drawn is same-origin, so the canvas stays untainted.
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
            // 1. current ST background, cover-fit.
            const bgEl = document.getElementById('bg1');
            if (bgEl) {
                const m = /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(bgEl).backgroundImage || '');
                if (m) {
                    try {
                        const im = await loadImageAsync(m[1]);
                        const s = Math.max(W / im.width, H / im.height);
                        g.drawImage(im, (W - im.width * s) / 2, (H - im.height * s) / 2,
                            im.width * s, im.height * s);
                    } catch (e) { /* keep black ground */ }
                }
            }
            // 2. weather overlay tint.
            const ov = document.getElementById('scene-director-wx-overlay');
            if (ov) {
                const c = getComputedStyle(ov).backgroundColor;
                if (c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') {
                    g.fillStyle = c;
                    g.fillRect(0, 0, W, H);
                }
            }
            // 3. the sprite, at its on-screen rect.
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
            // 4. HUD text, redrawn top-right.
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
            const locStr = (lastParsedLoc || 'scene').replace(/[\\/:*?"<>|]/g, '');
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
                    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
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
            let btn = document.getElementById('scene-director-photo-btn');
            if (!settings.enablePhotoMode) {
                if (btn) btn.style.display = 'none';
                return;
            }
            if (!btn) {
                btn = document.createElement('div');
                btn.id = 'scene-director-photo-btn';
                btn.textContent = '📷';
                btn.title = 'Save a scene photo';
                btn.addEventListener('click', function () { takePhoto(); });
                document.body.appendChild(btn);
            }
            btn.style.display = '';
        } catch (e) {
            console.error(`${LOG} photo button failed`, e);
        }
    }

    // ------------------------------------------------------------------
    // Tab title (v0.3.0)
    // ------------------------------------------------------------------

    function updateTabTitle(location, text, settings) {
        try {
            if (!settings.enableTabTitle) return;
            if (!location) { // no header => restore the original title
                document.title = ORIGINAL_TITLE;
                return;
            }
            const timeRe = compileRegex(settings.timeRegex);
            const t = timeRe ? timeRe.exec(text || '') : null;
            document.title = titlePrefix(settings) + ' — ' + location
                + (t ? ', ' + t[0].replace(/\s+/g, ' ').trim() : '');
        } catch (e) { /* ignore */ }
    }

    function restoreTabTitle() {
        try { document.title = ORIGINAL_TITLE; } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // Emotion lighting accents (v0.3.0)
    // ------------------------------------------------------------------

    // Reads the CURRENT expression sprite's filename ~1.5s after the message
    // (by then the expressions extension has classified). Intense emotions
    // fire a transient full-viewport pulse (max opacity ~0.18).
    const ACCENT_PATTERNS = [
        [/anger|angry|rage/, 'anger'],
        [/fear|afraid|terror|scared/, 'fear'],
        [/love|desire|lust/, 'love'],
    ];

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
            setTimeout(function () { try { div.remove(); } catch (e) { /* ignore */ } }, 1600);
        } catch (e) {
            console.error(`${LOG} emotion accent failed`, e);
        }
    }

    // ------------------------------------------------------------------
    // Idle presence (v0.3.0)
    // ------------------------------------------------------------------

    // After idleAfterSeconds without a message, every idleEverySeconds swap
    // the sprite between its available neutral variants (neutral, neutral-1
    // ..neutral-3, same extension as the current sprite; verified via
    // Image() onload before use). Only ever runs while the sprite already
    // shows a neutral*, so it never fights the expressions extension; any
    // message or generation start resets the clock.
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
            if (!/^neutral/.test(file)) return; // never fight the expressions ext
            const { folder, ext } = spriteFolderAndExt(img.src);
            const variants = await getNeutralVariants(folder, ext);
            if (!variants || variants.length < 2) return;
            const others = variants.filter(function (u) { return u !== img.src; });
            if (!others.length) return;
            // Re-check after the async verification gap.
            if (generating || Date.now() - lastActivityTs < (Number(settings.idleAfterSeconds) || 90) * 1000) return;
            const cur = currentSpriteImg();
            if (!cur || !/^neutral/.test((cur.src.split('/').pop() || '').toLowerCase())) return;
            lastIdleSwapTs = Date.now();
            cur.src = others[Math.floor(Math.random() * others.length)];
            // The Sprite Crossfade observer handles the fade (if enabled).
        } catch (e) { /* ignore */ }
    }

    function startIdleLoop() {
        try {
            if (idleTimer) return;
            idleTimer = setInterval(idleTick, 5000); // fine-grained ticker;
            // the real cadence comes from idleAfterSeconds/idleEverySeconds.
        } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // Asset preloading (v0.3.0)
    // ------------------------------------------------------------------

    // 5s after each message (browser has settled): once per session, prefetch
    // every file the background map / seasonal swaps / era rules could apply;
    // every time, verify-and-cache the current sprite's neutral variants.
    function schedulePreload(settings) {
        try {
            if (!settings.enablePreload) return;
            setTimeout(function () {
                try {
                    if (!mapPreloaded) {
                        mapPreloaded = true;
                        const files = new Set();
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
                        getNeutralVariants(folder, ext); // verifying IS prefetching
                    }
                } catch (e) { /* ignore */ }
            }, 5000);
        } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // Cast strip rendering
    // ------------------------------------------------------------------

    function getCastStripEl() {
        let el = document.getElementById('scene-director-cast-strip');
        if (!el) {
            el = document.createElement('div');
            el.id = 'scene-director-cast-strip';
            document.body.appendChild(el);
        }
        return el;
    }

    function updateCastStrip(text, settings) {
        const el = getCastStripEl();
        el.innerHTML = '';
        hideBioCard();
        if (!settings.enableCast || !settings.castFolder || !text) return;
        const base = `/characters/${encodeURIComponent(settings.castFolder)}/npc/`;
        const lower = text.toLowerCase();
        // The member whose colour hex appears latest in the message gets the
        // 'speaking' highlight (brighter ring + slight scale).
        const speakerKey = detectSpeaker(text, settings);
        let present = detectCast(text, settings);
        // v0.3.0 Speaking Order: latest speaker first; members without a
        // colour hit keep their cast-table order after them (stable sort).
        if (settings.enableSpeakingOrder) {
            try {
                present = present
                    .map(function (m) {
                        return {
                            member: m,
                            pos: m.colorHex ? lower.lastIndexOf(m.colorHex.toLowerCase()) : -1,
                        };
                    })
                    .sort(function (a, b) { return b.pos - a.pos; })
                    .map(function (x) { return x.member; });
            } catch (e) { /* keep cast-table order */ }
        }
        for (const member of present) {
            const wrap = document.createElement('div');
            wrap.className = 'scene-director-chip'
                + (member.key === speakerKey ? ' speaking' : '');
            const baseSrc = base + encodeURIComponent(member.key) + '.png';
            const mood = settings.enableMoods ? detectMood(text, member, settings) : 'neutral';
            const img = document.createElement('img');
            img.alt = member.label;
            if (mood !== 'neutral') {
                // Optional mood portrait: <key>-happy/-angry/-sad.png.
                // Missing variant => fall back to the base portrait; a
                // missing base portrait removes the whole chip.
                img.onerror = function () {
                    this.onerror = function () { try { wrap.remove(); } catch (e) { /* ignore */ } };
                    this.src = baseSrc;
                };
                img.src = base + encodeURIComponent(member.key) + '-' + mood + '.png';
            } else {
                // Missing portrait => remove the whole chip, don't show a broken image.
                img.onerror = function () { try { wrap.remove(); } catch (e) { /* ignore */ } };
                img.src = baseSrc;
            }
            if (mood !== 'neutral') {
                // Comic thought bubble with the mood emoji (neutral = none).
                const bubble = document.createElement('div');
                bubble.className = 'scene-director-mood-bubble';
                bubble.textContent = MOOD_EMOJI[mood];
                wrap.appendChild(bubble);
            }
            const label = document.createElement('div');
            label.className = 'scene-director-chip-label';
            label.textContent = member.label;
            wrap.appendChild(img);
            wrap.appendChild(label);
            // v0.3.0 Bio Cards: hover tooltip from npc/bios.json. Chips have
            // pointer-events:auto (the strip container stays non-blocking).
            if (settings.enableBioCards) {
                try {
                    const key = member.key;
                    const memberLabel = member.label;
                    wrap.addEventListener('mouseenter', function () {
                        fetchBios(settings).then(function (bios) {
                            const line = bios && bios[key];
                            if (line) showBioCard(wrap, memberLabel, String(line));
                        }).catch(function () { /* ignore */ });
                    });
                    wrap.addEventListener('mouseleave', hideBioCard);
                } catch (e) { /* ignore */ }
            }
            el.appendChild(wrap);
        }
    }

    // ------------------------------------------------------------------
    // Message handling
    // ------------------------------------------------------------------

    async function runCommand(ctx, cmd) {
        if (ctx.executeSlashCommandsWithOptions) {
            await ctx.executeSlashCommandsWithOptions(cmd, { handleParserErrors: true });
        } else {
            await ctx.executeSlashCommands(cmd);
        }
    }

    /** The last non-user, non-system message of the current chat, or null. */
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
            const text = last.mes;

            // Any new message resets the idle-presence clock immediately.
            lastActivityTs = Date.now();

            // Cast strip: runs on every AI message, before the header gate,
            // and is isolated so it can never break the other features.
            try {
                updateCastStrip(text, settings);
            } catch (e) {
                console.error(`${LOG} cast strip failed`, e);
            }

            // Scene HUD updates (or hides) on every AI message too.
            updateSceneHud(text, settings);

            // (Re)attach the sprite crossfade observer once the sprite exists.
            if (settings.enableCrossfade) setupSpriteCrossfade();

            // v0.3.0 static upkeep + accents/preload (all independent).
            try { updateKenBurns(settings); } catch (e) { /* ignore */ }
            try { updatePhotoButton(settings); } catch (e) { /* ignore */ }
            try { setTimeout(function () { fireEmotionAccent(settings); }, 1500); } catch (e) { /* ignore */ }
            try { schedulePreload(settings); } catch (e) { /* ignore */ }

            // Everything below needs a location from the scene header.
            const location = extractLocation(text, settings);
            if (!location) {
                // No scene header => clear any weather/lighting tint, keep the
                // sprite filter neutral, and restore the original tab title.
                updateWeatherOverlay(null, null, settings);
                try { updateSpriteFilter('neutral', settings); } catch (e) { /* ignore */ }
                try { updateTabTitle(null, text, settings); } catch (e) { /* ignore */ }
                return;
            }
            lastParsedLoc = location;

            // Parse failures just mean we skip time/date-driven features.
            let date = null;
            let hour = null;
            try {
                date = extractDate(text, settings);
                hour = extractHour(text, settings);
            } catch (e) {
                console.error(`${LOG} date/time parse failed`, e);
            }
            if (date && date.day) lastParsedDate = date;
            const weather = extractWeather(text, settings);

            // --- Auto Backgrounds (+ era/seasonal variants) ---
            if (settings.enableBackgrounds) {
                try {
                    let bg = pickBackground(location, settings);
                    if (bg) {
                        bg = applyVariants(bg, location, date, settings);
                        if (bg !== lastBg) {
                            lastBg = bg;
                            // v0.3.0: optional black-dip crossfade around /bg.
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

            // --- Weather & Lighting Overlay ---
            // After the background logic, so a graded -night/-rain/-dusk
            // variant file (if your background map picked one) suppresses
            // the tint instead of double-darkening.
            try {
                updateWeatherOverlay(hour, weather, settings);
            } catch (e) {
                console.error(`${LOG} weather overlay update failed`, e);
            }

            // --- v0.3.0 per-message features (each isolated) ---
            try { updateSpriteFilter(computeSceneState(hour, weather, settings), settings); } catch (e) { /* ignore */ }
            try { updateFireOverlay(settings); } catch (e) { /* ignore */ }
            try { updateTabTitle(location, text, settings); } catch (e) { /* ignore */ }
            try {
                updateDayTrail(date, location, settings);
                updateHudTooltip((date && date.day) ? date : lastParsedDate, settings);
            } catch (e) { /* ignore */ }

            // --- Auto Costumes ---
            if (settings.enableCostumes) {
                try {
                    const desired = pickCostume(location, hour, settings);
                    if (desired !== null && desired !== lastCostume) {
                        await runCommand(ctx, desired ? `/costume ${desired}` : '/costume');
                        console.log(`${LOG} costume: ${lastCostume || 'default'} -> ${desired || 'default'} (loc="${location}", hour=${hour})`);
                        lastCostume = desired;
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
        // New chat: forget dedupe state so the first message re-applies
        // background and costume, and clear the previous chat's cast strip,
        // day trail and tab title.
        lastBg = null;
        lastCostume = null;
        trailDateKey = null;
        trailLocs = [];
        lastParsedDate = null;
        lastParsedLoc = null;
        try {
            getCastStripEl().innerHTML = '';
            hideBioCard();
            const hud = document.getElementById('scene-director-hud');
            if (hud) { hud.style.display = 'none'; hud.title = ''; }
            updateWeatherOverlay(null, null, getSettings());
            restoreTabTitle();
        } catch (e) { /* ignore */ }
        // Apply immediately for the chat we just opened.
        onMessage();
    }

    // ------------------------------------------------------------------
    // Settings UI
    // ------------------------------------------------------------------

    // JSON textareas are validated on Apply; nothing is saved unless the
    // whole form validates. Errors render inline next to the field.

    /** Validators return an error string, or null when the value is fine. */
    const validators = {
        backgroundMap(value) {
            if (!Array.isArray(value)) return 'must be a JSON array';
            for (const [i, e] of value.entries()) {
                if (typeof e?.pattern !== 'string' || !e.pattern) return `entry ${i}: "pattern" must be a non-empty string`;
                if (!compileRegex(e.pattern)) return `entry ${i}: "pattern" is not a valid regex`;
                if (typeof e?.background !== 'string' || !e.background) return `entry ${i}: "background" must be a filename`;
            }
            return null;
        },
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
        cast(value) {
            if (!Array.isArray(value)) return 'must be a JSON array';
            for (const [i, e] of value.entries()) {
                if (typeof e?.key !== 'string' || !e.key) return `entry ${i}: "key" must be a non-empty string (the png filename without extension)`;
                if (typeof e?.label !== 'string' || !e.label) return `entry ${i}: "label" must be a non-empty string`;
                if (e.colorHex != null && !/^#[0-9a-f]{3,8}$/i.test(e.colorHex)) return `entry ${i}: "colorHex" must look like "#RRGGBB"`;
                if (e.nameRegex != null && (typeof e.nameRegex !== 'string' || !compileRegex(e.nameRegex))) return `entry ${i}: "nameRegex" is not a valid regex`;
                if (e.colorHex == null && e.nameRegex == null) return `entry ${i}: needs "colorHex" or "nameRegex" (or both)`;
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
        ['enableBackgrounds', 'Auto Backgrounds', 'Switch the background with /bg when the scene header location matches the map'],
        ['enableSeasonal', 'Seasonal Swaps', 'Swap a mapped background for a seasonal variant in a given month'],
        ['enableEra', 'Era Swaps', 'Swap a mapped background once the story year passes a threshold'],
        ['enableCostumes', 'Auto Costumes', 'Switch sprite costumes with /costume based on location and time of day'],
        ['enableCast', 'Cast Strip', 'Show portrait chips for NPCs who speak in the latest AI message'],
        ['enableHud', 'Scene HUD', 'Show a small fixed chip (top-right) with the parsed time · date · weather'],
        ['enableMoods', 'Cast Mood Bubbles', 'Heuristic mood per NPC chip: thought bubble emoji + optional <key>-happy/-angry/-sad.png portrait variant'],
        ['enableCrossfade', 'Sprite Crossfade', 'Fade the previous expression sprite out over the new one when it changes'],
        ['enableWeatherFx', 'Weather & Lighting Overlay', 'CSS tint (night/dusk/rain) + rain streaks behind the chat for backgrounds without graded variant files'],
        // v0.3.0 presence pack.
        ['enableSpriteShadow', 'Sprite Shadow', 'Grounding drop-shadow under the expression sprite'],
        ['enableSpriteTint', 'Sprite Lighting Tint', 'Darken/warm the sprite to match the scene state (night/dusk/rain)'],
        ['enableBgCrossfade', 'Background Crossfade', 'Dip to black around each /bg switch (200ms in, 300ms out)'],
        ['enableTypingPresence', 'Typing Presence', 'Subtle sprite sway + "…" thought bubble while the model is generating'],
        ['enableKenBurns', 'Ken Burns Drift', 'Slow zoom/pan on the background (duration configurable below)'],
        ['enableFireFlicker', 'Fire Flicker', 'Warm flicker overlay when the applied background filename matches the fire regex'],
        ['enableBioCards', 'Bio Cards', 'Hover a cast chip for a one-line bio from /characters/<folder>/npc/bios.json'],
        ['enablePhotoMode', 'Photo Mode', '📷 button: composite background + tint + sprite + HUD to a downloadable PNG'],
        ['enableTabTitle', 'Tab Title', 'Set the browser tab title to <prefix> — <location>, <time> per message'],
        ['enableEmotionAccents', 'Emotion Accents', 'Transient lighting pulse when the sprite shows anger, fear or love/desire'],
        ['enableIdlePresence', 'Idle Presence', 'After a quiet period, drift between the sprite\'s neutral-* variants'],
        ['enableDayTrail', 'Day Trail', 'Accumulate today\'s distinct locations into the HUD hover tooltip'],
        ['enableCounters', 'Life Counters', 'User-defined date counters (days / weeks+days) from the story date, in the HUD tooltip'],
        ['enableSpeakingOrder', 'Speaking Order', 'Order cast chips by who spoke latest (latest first)'],
        ['enablePreload', 'Asset Preloading', 'Idle prefetch of every mapped background and the current sprite\'s neutral variants'],
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
        ['backgroundMap', 'Background map', '[{"pattern": "kitchen", "background": "kitchen.jpg"}] — first match wins, order specific before generic'],
        ['seasonalMap', 'Seasonal map', '[{"month": 12, "from": "living.jpg", "to": "living-christmas.jpg"}]'],
        ['eraRules', 'Era rules', '[{"minYear": 2027, "pattern": "build site", "from": "frame.jpg", "to": "finished.jpg"}]'],
        ['costumeRules', 'Costume rules', '[{"pattern": "bedroom", "fromHour": 20, "toHour": 7, "costume": "pajamas"}] — "" costume = default'],
        ['cast', 'Cast table', '[{"key": "granty", "label": "Granty", "colorHex": "#B0BEC5", "nameRegex": "granty"}]'],
        ['moodKeywords', 'Mood keywords', '{"happy": "laugh|smil", "angry": "snap|glare", "sad": "tear|sob"} — regex sources, highest match count wins'],
        ['counters', 'Life counters', '[{"label": "married", "emoji": "💍", "date": "2026-07-11", "mode": "days"}] — computed from the parsed STORY date; "weeks" renders as 6w2d'],
    ];

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
                    <div class="scene-director-section">Features</div>
                    ${toggles}
                    <div class="scene-director-section">Scene header parsing</div>
                    ${regexes}
                    <div class="scene-director-section">Timings</div>
                    ${numbers}
                    <div class="scene-director-section">Maps &amp; rules (JSON)</div>
                    ${jsons}
                    <div class="scene-director-field">
                        <label for="sd_castFolder">Cast sprite folder</label>
                        <small>Character folder name: portraits load from /characters/&lt;folder&gt;/npc/&lt;key&gt;.png, bios from /characters/&lt;folder&gt;/npc/bios.json</small>
                        <input type="text" id="sd_castFolder" class="text_pole" spellcheck="false" />
                    </div>
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
                </div>
            </div>
        </div>`;
    }

    function loadSettingsIntoForm() {
        const s = getSettings();
        for (const [key] of TOGGLE_FIELDS) {
            const el = document.getElementById(`sd_${key}`);
            if (el) el.checked = Boolean(s[key]);
        }
        for (const [key] of REGEX_FIELDS) {
            const el = document.getElementById(`sd_${key}`);
            if (el) el.value = s[key];
        }
        for (const [key] of NUMBER_FIELDS) {
            const el = document.getElementById(`sd_${key}`);
            if (el) el.value = s[key];
        }
        for (const [key] of JSON_FIELDS) {
            const el = document.getElementById(`sd_${key}`);
            if (el) el.value = JSON.stringify(s[key], null, 2);
        }
        const folder = document.getElementById('sd_castFolder');
        if (folder) folder.value = s.castFolder;
        const prefix = document.getElementById('sd_titlePrefix');
        if (prefix) prefix.value = s.titlePrefix;
    }

    function setFieldError(key, message) {
        const el = document.getElementById(`sd_${key}_error`);
        if (el) el.textContent = message || '';
    }

    /** Re-apply the always-on visuals after a settings change. */
    function refreshStatics(settings) {
        try { updateSpriteFilter('neutral', settings); } catch (e) { /* ignore */ }
        try { updateKenBurns(settings); } catch (e) { /* ignore */ }
        try { updatePhotoButton(settings); } catch (e) { /* ignore */ }
        try { updateFireOverlay(settings); } catch (e) { /* ignore */ }
        if (!settings.enableTabTitle) restoreTabTitle();
        if (settings.enableIdlePresence) startIdleLoop();
        biosPromise = null;     // castFolder may have changed
        mapPreloaded = false;   // background map may have changed
    }

    /** Validate the whole form; save only if everything passes. */
    function applyForm() {
        const s = getSettings();
        const status = document.getElementById('sd_apply_status');
        let ok = true;
        const pending = {};

        // Regexes: must compile.
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

        // Numbers: integers within their allowed range.
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

        // JSON maps: must parse and pass their validator.
        for (const [key] of JSON_FIELDS) {
            const raw = document.getElementById(`sd_${key}`).value.trim() || '[]';
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

        // Everything validated: commit toggles, regexes, numbers, maps, folder.
        for (const [key] of TOGGLE_FIELDS) {
            s[key] = document.getElementById(`sd_${key}`).checked;
        }
        Object.assign(s, pending);
        s.castFolder = document.getElementById('sd_castFolder').value.trim();
        s.titlePrefix = document.getElementById('sd_titlePrefix').value.trim();
        saveSettings();

        // Force a re-apply with the new config on the current chat.
        lastBg = null;
        lastCostume = null;
        refreshStatics(s);
        onMessage();

        status.textContent = 'Saved.';
        setTimeout(() => { if (status.textContent === 'Saved.') status.textContent = ''; }, 3000);
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
            const text = last.mes;
            const location = extractLocation(text, settings);
            const hour = extractHour(text, settings);
            const date = extractDate(text, settings);
            const lines = [];
            lines.push(`location : ${location ?? '(not found)'}`);
            lines.push(`hour     : ${hour ?? '(not found)'}`);
            lines.push(`date     : ${date ? `month=${date.month} year=${date.year}` : '(not found)'}`);
            if (location) {
                const rawBg = pickBackground(location, settings);
                const finalBg = rawBg ? applyVariants(rawBg, location, date, settings) : null;
                lines.push(`background : ${rawBg ?? '(no mapping)'}${finalBg && finalBg !== rawBg ? ` -> ${finalBg} (variant)` : ''}`);
                const costume = pickCostume(location, hour, settings);
                lines.push(`costume    : ${costume === null ? '(no time parsed — skipped)' : (costume || '(default)')}`);
            } else {
                lines.push('background : (skipped — no location)');
                lines.push('costume    : (skipped — no location)');
            }
            const weather = extractWeather(text, settings);
            lines.push(`weather    : ${weather ?? '(not found)'}${weather && isRaining(weather, settings) ? ' [rain]' : ''}`);
            lines.push(`scene state: ${computeSceneState(hour, weather, settings)}`);
            const hudParts = buildHudParts(text, settings);
            lines.push(`hud        : ${hudParts ? hudParts.join(' · ') : '(nothing parsed)'}`);
            const counters = buildCounters(date, settings);
            lines.push(`counters   : ${counters || '(none)'}`);
            const present = detectCast(text, settings);
            const speakerKey = detectSpeaker(text, settings);
            lines.push(`cast       : ${present.length ? present.map(m => {
                const mood = detectMood(text, m, settings);
                return m.label
                    + (m.key === speakerKey ? ' [speaking]' : '')
                    + (mood !== 'neutral' ? ` [${mood}]` : '');
            }).join(', ') : '(none detected)'}`);
            out.textContent = lines.join('\n');
        } catch (e) {
            out.textContent = `Test failed: ${e}`;
            console.error(`${LOG} test failed`, e);
        }
    }

    function addSettingsUi() {
        // ST renders third-party extension settings into one of these panels.
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
    }

    // ------------------------------------------------------------------
    // Init
    // ------------------------------------------------------------------

    function init() {
        try {
            const ctx = SillyTavern.getContext();
            const settings = getSettings(); // ensure defaults exist
            addSettingsUi();
            const et = ctx.eventTypes || ctx.event_types;
            ctx.eventSource.on(et.MESSAGE_RECEIVED, onMessage);
            ctx.eventSource.on(et.MESSAGE_SWIPED, onMessage);
            if (et.CHAT_CHANGED) ctx.eventSource.on(et.CHAT_CHANGED, onChatChanged);
            // v0.3.0: generation events for Typing Presence and the idle
            // clock. Names checked defensively — different ST versions may
            // not expose all of them.
            try {
                if (et.GENERATION_STARTED) ctx.eventSource.on(et.GENERATION_STARTED, onGenerationStart);
                if (et.GENERATION_ENDED) ctx.eventSource.on(et.GENERATION_ENDED, onGenerationEnd);
                if (et.GENERATION_STOPPED) ctx.eventSource.on(et.GENERATION_STOPPED, onGenerationEnd);
            } catch (e) {
                console.error(`${LOG} generation hooks failed`, e);
            }
            if (settings.enableCrossfade) setupSpriteCrossfade();
            refreshStatics(settings);
            startIdleLoop();
            console.log(`${LOG} loaded`);
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
