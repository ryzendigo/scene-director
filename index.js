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
 * v0.5.2:
 *
 *   - Cast column is a fixed box filling the gutter beside #sheld (chips
 *     max-width:100%, height:auto, 28vh cap); gutter < 110px collapses to
 *     48px circles. Re-measured on #sheld resize, window resize and ST's
 *     panel/settings events.
 *   - Thought bubbles: typing dots while generating, then the mood emoji
 *     (configurable map) up-left of the head for a few seconds; NPC chips
 *     get the same treatment. Transform/opacity-only.
 *   - Chat glass injects its #chat rule only while on; drawer hint points
 *     at ST's own Blur Tint alpha.
 *   - Sprite: after two blank re-asserts the replay falls back to neutral
 *     (a costume subfolder may lack the label) and logs a sprite-debug line.
 *
 * v0.5.3:
 *
 *   - Presence tightened: hex = only strong evidence; name/alias needs a
 *     cue within ~40 chars and no phone/absence context in the sentence;
 *     kinship aliases (cast card field) never count alone; every chip
 *     add/remove is logged with its evidence.
 *   - Thought Tooltips: hover the sprite or a chip for bio, mood emoji and
 *     the last sentences about that character's inner state.
 *   - Flicker-free None-classifier path: fallback label kept equal to the
 *     mood on screen (only when the user already runs api=None with a
 *     fallback set); idle neutral variants come from /api/sprites/get.
 *
 * v0.5.4:
 *
 *   - Typing dots only while a real generation is in flight (dry-run
 *     GENERATION_STARTED events are ignored; cleared on message/chat
 *     change; 90s safety). Idle > 2 min: the last mood emoji drifts up
 *     and fades every ~90s.
 *   - Unknown Speakers: a dialogue colour on no Cast card gets a tinted
 *     silhouette chip (pronoun-gendered, best-guess name).
 *
 * v0.5.5:
 *
 *   - Quiet console: nothing is printed unless "Debug Logging" is on
 *     (errors still go to console.error).
 *   - Mood-tag instruction injected at depth 0 (a system message placed
 *     absolutely last) with mandatory-format wording; a tag is also read
 *     from the reasoning block as a last resort; the raw tail is logged
 *     (debug) when no tag arrives.
 *   - Flash-free sprite: no /emote for a label already on screen; the
 *     crossfade keeps the old image until the new one has painted and
 *     blends over 1.2s; idle variants are preloaded and cycle every ~2 min.
 *
 * v0.6.0 — the layered mood engine (see MoodEngine and README "How
 * moods are decided"): L0 own-material extraction, L1 tag, L2 ST's local
 * go_emotions classifier, L3 weighted lexicon with vetoes; deterministic
 * verdict rules; 8 s hysteresis; NPC variants from the same pipeline.
 *
 * v0.6.4 — PresenceEngine: presence is a layered evidence/veto verdict
 * (own dialogue +10, arrival cue +4, action +2, header +3; vetoes for a
 * name inside another speaker's quotes, absence/reported-speech
 * sentences, departures, location change) — a name inside someone else's
 * speech never summons a chip. Unknown-speaker names come from narration.
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
    // v0.5.5: all console output goes through dbg(); silent unless the
    // "Debug logging" toggle is on. Failures still use console.error.
    function dbg() {
        try {
            const st = SillyTavern.getContext().extensionSettings[MODULE];
            if (!st || !st.enableDebug) return;
            console.log.apply(console, [LOG].concat(Array.prototype.slice.call(arguments)));
        } catch (e) { /* ignore */ }
    }

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
        // 0.6.3 HUD styling.
        hudStyle: 'stacked',        // stacked|line|minimal|game
        hudScale: 1,                // 0.8-1.6
        hudOpacity: 0.85,
        hudDate: true, hudLoc: true, hudWeather: true, hudCounters: true,
        holdCostume: false,         // freeze Auto Costumes at the current outfit
        enableChatGlass: false,     // see-through chat panel
        chatOpacity: 0.55,
        chatBlur: true,

        // v0.5.2 thought bubbles: mood label -> emoji (main sprite);
        // NPC chips use happy/angry/sad.
        moodEmoji: {
            love: '❤️', anger: '💢', surprise: '❗', curiosity: '❓', embarrassment: '😳',
            joy: '✨', sadness: '💧', fear: '😨', desire: '🔥', amusement: '😏',
            admiration: '🤩', annoyance: '😒', approval: '👍', caring: '🤗',
            confusion: '🤔', disappointment: '😞', disapproval: '👎', disgust: '🤢',
            excitement: '🎉', gratitude: '🙏', grief: '💔', nervousness: '😰',
            optimism: '🌤️', pride: '😌', realization: '💡', relief: '😮‍💨', remorse: '😔',
            happy: '✨', angry: '💢', sad: '💧',
        },
        bubbleSeconds: 6,

        // v0.5.3 presence + thought tooltips (regex sources, 'i' flag).
        // v0.6.4 presence engine tables (regex alternations; blank = built-in).
        presenceArrivalRegex: '', presenceActionRegex: '', presenceDepartRegex: '',
        presenceCueRegex: 'enter(?:s|ed)?|walk(?:s|ed)? in|walk(?:s|ed)? over|com(?:es|ing) in|came in|appear(?:s|ed)|opens? the door|opened the door|arriv(?:es|ed|ing)|join(?:s|ed)|sits?|sat|sitting|seated|stands?|stood|standing|is (?:there|here)|was (?:there|here)|beside|next to|across (?:from|the table)|opposite|lean(?:s|ed|ing)|steps? (?:in|closer|forward)|says?|said|asks?|asked|replie[sd]|murmur(?:s|ed)|whisper(?:s|ed)|nods?|nodded|smil(?:es|ed)|frowns?|glanc(?:es|ed)|looks? (?:up|over|at)|watch(?:es|ed|ing)|hand(?:s|ed) (?:her|him|you|them)|turn(?:s|ed) to',
        absenceContextRegex: 'ring(?:s|ing)?|rang|call(?:s|ed|ing)?|phone[sd]?|phoning|text(?:s|ed|ing)?|messag(?:e|es|ed|ing)|miss(?:es|ed|ing)?|remember(?:s|ed|ing)?|think(?:s|ing)? (?:of|about)|thought (?:of|about)|tell(?:s|ing)?|told|mention(?:s|ed)?|about|wonder(?:s|ed|ing)?|wish(?:es|ed)?|promised?|later|tomorrow|afterwards',
        enableThoughtTips: true,
        // v0.5.4 unknown speakers: silhouette chips for unmapped dialogue colours.
        enableUnknownSpeakers: true,
        enableDebug: false,         // v0.5.5: console diagnostics off by default
        // v0.6.2 character sprite size.
        spriteAuto: true,           // match ST's size for the static sprites
        spriteVh: null,             // height in vh when auto is off (30-100)
        spriteDx: 0,                // horizontal offset, vw (-20..20)
        spriteDy: 0,                // vertical offset, vh (-10..10)
        // v0.6.0 mood engine.
        enableLocalClassifier: true,   // L2: ST's server-side go_emotions classifier
        femaleNamesRegex: '',          // other female characters (she/her is the main character's only when none of these appear)
        moodLexicon: null,             // null = built-in table (MoodEngine.DEFAULT_LEXICON); else [[regex, label, weight, [vetoes]], ...]
        ownColorHex: '',            // the main character's dialogue colour (never an "unknown")
        interiorityRegex: 'thinks?|thought|feels?|felt|wants?|wanted|wish(?:es|ed)?|hopes?|hoped|fears?|feared|notices?|noticed|realis(?:es|ed)|realiz(?:es|ed)|decides?|decided|wonders?|wondered|looks?|looked|glanc(?:es|ed)|watch(?:es|ed)|flush(?:es|ed)|stiffen(?:s|ed)|soften(?:s|ed)|smil(?:es|ed)|frown(?:s|ed)|swallow(?:s|ed)|breath(?:es|ed)|grip(?:s|ped)|hesitat(?:es|ed)',

        // v0.3.0 numeric tuning.
        kenBurnsSeconds: 75,     // one Ken Burns sweep (alternates back)
        idleAfterSeconds: 90,    // quiet time before idle presence starts
        idleEverySeconds: 120,   // interval between idle sprite swaps (0.5.5: ~2 min)

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
            console.error(`${LOG} invalid regex: ${source}`, e);
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
    // v0.5.3 presence: the dialogue-colour hex is the only STRONG evidence;
    // a name (or kinship alias) counts only with a presence/arrival/speech
    // cue within ~40 chars AND outside a phone/absence sentence ("ring the aunt
    // later" summons nobody). Cue/absence regexes are settings.
    const DEPART_RE = /\b(?:leaves|left|walk(?:s|ed) out|storm(?:s|ed) (?:out|off)|dr(?:ives?|ove) (?:off|away)|departs?|departed|head(?:s|ed) (?:out|off|home)|goodbye|good night)\b/i;
    const SENTENCE_SPLIT_RE = /[.!?\n]/;
    function sentenceAround(text, idx) {
        let a2 = idx; let b2 = idx;
        while (a2 > 0 && !SENTENCE_SPLIT_RE.test(text[a2 - 1])) a2--;
        while (b2 < text.length && !SENTENCE_SPLIT_RE.test(text[b2])) b2++;
        return text.slice(a2, b2);
    }
    const PRESENCE_MISS_LIMIT = 3;

    // === MOOD ENGINE (pure) BEGIN ===
    // Layered mood verdict. Pure functions only (no DOM, no ST) so a node
    // harness can extract this block and run it against saved chats.
    //   L0 extractOwn()   — the character's OWN material from a finished
    //                       message: her dialogue spans + narration about her
    //   L1 (tag)           — [MOOD: x] / "Mood: x" inside <details> / reasoning
    //   L2 (local)         — ST's go_emotions classifier on the L0 text
    //   L3 lexicon()       — weighted cue table with vetoes + negation
    //   verdict()          — the deterministic rules (documented inline)
    const MoodEngine = (function () {
        const LABELS = ['admiration', 'amusement', 'anger', 'annoyance', 'approval',
            'caring', 'confusion', 'curiosity', 'desire', 'disappointment',
            'disapproval', 'disgust', 'embarrassment', 'excitement', 'fear',
            'gratitude', 'grief', 'joy', 'love', 'nervousness', 'optimism', 'pride',
            'realization', 'relief', 'remorse', 'sadness', 'surprise', 'neutral'];
        const LABEL_SET = new Set(LABELS);
        const DETAILS_RE = /<details[\s\S]*?<\/details>/gi;
        const THINK_RE = /<think>[\s\S]*?<\/think>/gi;
        const TAG_RE = /[\[〔]\s*MOOD\s*[:：]\s*([a-z]+)\s*[\]〕]/gi;
        const DETAILS_MOOD_RE = /<details[\s\S]*?\bmood\b\s*[:：]?\s*\**\s*([a-z]+)[\s\S]*?<\/details>/i;
        const HEADER_LINE_RE = /^[^\n]*📍[^\n]*$/gm;
        const FONT_ANY_RE = /<font\s+color=["']?(#[0-9a-f]{6})["']?[^>]*>([\s\S]*?)<\/font>/gi;
        const TAG_STRIP_RE = /<[^>]+>/g;
        const SENT_RE = /[^.!?\n]+[.!?…]*["”']?/g;
        const PRONOUN_SHE = /\b(?:she|her|hers|herself)\b/i;
        const NEG_RE = /\b(?:not|never|no|isn't|wasn't|doesn't|didn't|hardly|without|nor)\s+(?:\w+\s+){0,2}$/i;
        const LAST_FRACTION = 0.6; // sentences beyond this point weigh double

        // The lexicon: [regexSource, label, weight, vetoes]. Weight is per
        // hit (times 2 in the message's last 40%). Vetoes are labels a hit
        // rules OUT. Kept as plain data so the public build can expose it.
        const DEFAULT_LEXICON = [
            // amusement / joy
            ['laugh(?:s|ed|ing|ter)?', 'amusement', 3, ['sadness', 'grief', 'anger', 'fear']],
            ['giggl(?:es|ed|ing)?', 'amusement', 3, ['sadness', 'grief', 'anger', 'fear']],
            ['chuckl(?:es|ed|ing)?', 'amusement', 2, ['sadness', 'grief']],
            ['grin(?:s|ned|ning)?', 'amusement', 2, ['sadness', 'grief']],
            ['smirk(?:s|ed|ing)?', 'amusement', 1.5, []],
            ['teas(?:es|ed|ing)', 'amusement', 1.5, []],
            ['wry(?:ly)?', 'amusement', 1, []],
            ['snort(?:s|ed)?', 'amusement', 1.5, []],
            ['smil(?:es|ed|ing)', 'joy', 1.5, ['grief']],
            ['beam(?:s|ed|ing)', 'joy', 2, ['sadness']],
            ['(?:face|eyes) lights? up|lights up', 'joy', 2, ['sadness']],
            ['delight(?:ed|s)?', 'joy', 2, []],
            ['\\bhappy\\b|happi(?:ly|ness)', 'joy', 1.5, []],
            ['humm(?:ing|ed)|hums', 'joy', 1, []],
            ['bright(?:ens|ened)\\b', 'joy', 1.5, []],
            // embarrassment
            ['(?:cheeks?|face|neck|ears)\\s+(?:(?:go|goes|going|went|turn|turns|turning|turned|burn|burning)\\s+)?(?:pink|red|hot|scarlet|crimson|warm)', 'embarrassment', 3, []],
            ['(?:goes|went|gone|turning|turns|turned)\\s+pink', 'embarrassment', 3, []],
            ['pink\\s+(?:across|in|on|over)\\s+(?:her|the)\\s+(?:cheeks|face)', 'embarrassment', 3, []],
            ['blush(?:es|ed|ing)?', 'embarrassment', 3, []],
            ['flush(?:es|ed|ing)?', 'embarrassment', 2, []],
            ['ducks?\\s+her\\s+head', 'embarrassment', 2, []],
            ['hides?\\s+her\\s+face', 'embarrassment', 2, []],
            ['mortif(?:ied|ying)', 'embarrassment', 3, []],
            ['sheepish(?:ly)?', 'embarrassment', 2, []],
            // sadness / grief
            ['\\btears?\\b|tearful', 'sadness', 3, ['joy', 'amusement', 'pride']],
            ['\\bcr(?:y|ies|ied|ying)\\b|\\bwe(?:ep|pt|eping)\\b', 'sadness', 3, ['joy', 'amusement', 'pride']],
            ['\\bsob(?:s|bed|bing)?\\b', 'sadness', 3, ['joy', 'amusement', 'pride']],
            ['throat\\s+(?:goes|is|was|gone|feels)?\\s*(?:tight|thick|closing)', 'sadness', 2, []],
            ['voice\\s+(?:cracks|wavers|breaks|catches)', 'sadness', 2, []],
            ['eyes\\s+(?:fill|sting|burn|well|prick)', 'sadness', 2.5, []],
            ['lip\\s+trembl(?:es|ing)', 'sadness', 2, []],
            ['\\bgriev(?:es|ed|ing)|\\bgrief\\b|mourn(?:s|ed|ing)?', 'grief', 3, ['joy', 'amusement']],
            ['\\baches?\\b|aching', 'grief', 1, []],
            // anger / annoyance
            ['(?<!\\bit\\s)(?<!\\blet\\s)\\bsnap(?:s|ped)\\b(?!\\s+(?:back|shut|closed|open|the|it|a\\b))', 'anger', 2.5, []],
            ['\\bdr(?:y|ier|yly)\\b', 'amusement', 1, []],
            ['flat\\s+voice|voice\\s+(?:goes\\s+)?flat|flatly', 'anger', 2, []],
            ['jaw\\s+(?:sets?|tight(?:ens)?|clench(?:es|ed)?|works)', 'anger', 2.5, []],
            ['glar(?:es|ed|ing)', 'anger', 3, []],
            ['narrow(?:s|ed)?\\s+her\\s+eyes|eyes\\s+narrow', 'anger', 2, []],
            ['furious|fury|rage', 'anger', 3, []],
            ['\\btemper\\b', 'anger', 2, []],
            ['hiss(?:es|ed)?\\b', 'anger', 2, []],
            ['slam(?:s|med)?', 'anger', 2, []],
            ['\\bsharp(?:ly)?\\b', 'annoyance', 1, []],
            ['\\bcold(?:ly)?\\b', 'annoyance', 1, []],
            ['rolls?\\s+her\\s+eyes', 'annoyance', 2, []],
            ['(?:sighs?|breathes?)\\s+through\\s+her\\s+nose', 'annoyance', 1.5, []],
            ['\\bhuff(?:s|ed)?\\b', 'annoyance', 2, []],
            ['\\btsk', 'annoyance', 1, []],
            ['exasperat(?:ed|ion)', 'annoyance', 2.5, []],
            ['irritat(?:ed|ion)|irked', 'annoyance', 2, []],
            // fear / nervousness
            ['stiffen(?:s|ed|ing)?', 'fear', 2, []],
            ['(?:goes|went|gone|holds?)\\s+(?:very\\s+)?still', 'fear', 2, []],
            ['\\bpale(?:s|d)?\\b|colou?r\\s+drains', 'fear', 2.5, []],
            ['heart\\s+(?:hammers|pounds|races|lurches)', 'fear', 2, []],
            ['breath\\s+catches|catches\\s+her\\s+breath', 'surprise', 1.5, []],
            ['afraid|scared|terrified|\\bdread', 'fear', 3, []],
            ['trembl(?:es|ed|ing)|shak(?:es|ing|y)\\b', 'fear', 1.5, []],
            ['flinch(?:es|ed)?', 'fear', 2, []],
            ['fidget(?:s|ed|ing)?', 'nervousness', 2, []],
            ['twists?\\s+her\\s+(?:fingers|ring|hands)', 'nervousness', 2, []],
            ['chews?\\s+(?:on\\s+)?her\\s+lip', 'nervousness', 2, []],
            ['swallows?\\s+hard', 'nervousness', 1.5, []],
            ['wring(?:s|ing)?\\s+her\\s+hands', 'nervousness', 2, []],
            ['anxious|nervous(?:ly)?', 'nervousness', 3, []],
            // desire / love / caring
            ['settl(?:es|ed|ing)\\s+(?:in\\s+)?(?:closer|against|into)|curls?\\s+into|leans?\\s+into\\s+(?:him|you)', 'love', 2, []],
            ['\\bheat\\b', 'desire', 1, []],
            ['breath(?:y|less)', 'desire', 1, []],
            ['kiss(?:es|ed|ing)?', 'love', 2, []],
            ['nuzzl(?:es|ed|ing)', 'love', 2, []],
            ["darlin'?|sweetheart|\\bmy\\s+love\\b", 'love', 1, []],
            ['hand\\s+finds\\s+(?:his|yours?)', 'love', 1.5, []],
            ['flirt(?:s|ed|ing|y)?', 'desire', 2, []],
            ['bites?\\s+her\\s+lip', 'desire', 1, []],
            ['slow\\s+smile', 'desire', 1, []],
            ['lips\\s+part', 'desire', 1, []],
            ['tucks?\\s+(?:the\\s+)?blanket|smooths?\\s+(?:his|your)\\s+hair|strokes?\\s+(?:his|your)', 'caring', 1.5, []],
            ['makes?\\s+sure\\s+(?:he|you)|checks?\\s+on\\s+(?:him|you)|fuss(?:es|ing)\\s+over', 'caring', 1, []],
            // surprise / realization / curiosity / confusion
            ['eyes\\s+(?:widen|go\\s+wide|fly\\s+open)', 'surprise', 3, []],
            ['\\bblinks?\\b', 'surprise', 1, []],
            ['startl(?:es|ed)', 'surprise', 3, []],
            ['\\bgasps?\\b', 'surprise', 2, []],
            ['realis(?:es|ed|ing)|realiz(?:es|ed|ing)|dawns\\s+on', 'realization', 2, []],
            ['tilts?\\s+her\\s+head|head\\s+tilts', 'curiosity', 2, []],
            ['curious(?:ly)?', 'curiosity', 2.5, []],
            ['eyebrows?\\s+(?:lifts?|rais(?:es|ed)|arch(?:es|ed)?)', 'curiosity', 1.5, []],
            ['frown(?:s|ed|ing)?', 'confusion', 1, []],
            ['puzzled|confused|bewildered', 'confusion', 3, []],
            // relief / disappointment / disapproval / disgust
            ['shoulders\\s+(?:drop|come\\s+down|loosen|ease)', 'relief', 2.5, []],
            ['relie(?:f|ved)', 'relief', 3, []],
            ['breathes?\\s+out|lets?\\s+out\\s+a\\s+breath|exhal(?:es|ed)', 'relief', 1.5, []],
            ['\\bsighs?\\b', 'relief', 1, []],
            ['unclench(?:es|ed)?', 'relief', 1.5, []],
            ['disappoint(?:ed|ment)', 'disappointment', 3, []],
            ['face\\s+falls|shoulders\\s+sag', 'disappointment', 2.5, []],
            ['purses?\\s+her\\s+lips|lips\\s+thin', 'disapproval', 2, []],
            ['disapprov(?:es|ed|ing|al)', 'disapproval', 3, []],
            ['shakes?\\s+her\\s+head', 'disapproval', 1, []],
            ['wrinkles?\\s+her\\s+nose|nose\\s+wrinkles', 'disgust', 2.5, []],
            ['grimac(?:es|ed|ing)', 'disgust', 2, []],
            ['disgust(?:ed|ing)?|revolted', 'disgust', 3, []],
            // pride / gratitude / approval / optimism / remorse / excitement / admiration
            ['lifts?\\s+her\\s+chin|chin\\s+(?:lifts|up)', 'pride', 2, []],
            ['\\bproud(?:ly)?\\b', 'pride', 3, []],
            ['\\bsmug(?:ly)?\\b', 'pride', 1.5, []],
            ['thank(?:s|ful|\\s+you)|grateful', 'gratitude', 1.5, []],
            ['approv(?:es|ed|ing|al)|nods?\\s+(?:firmly|approvingly)', 'approval', 2, []],
            ['hopeful(?:ly)?|looking\\s+forward', 'optimism', 1.5, []],
            ['\\bsorry\\b', 'remorse', 1.5, []],
            ['guilt(?:y)?|ashamed|regret(?:s|ted)?', 'remorse', 3, []],
            ['excited(?:ly)?|can\'t\\s+wait|bounc(?:es|ing)', 'excitement', 2.5, []],
            ['admir(?:es|ed|ing|ation)|impressed|\\bawe\\b', 'admiration', 2.5, []],
            // neutral — positive indication only
            ['matter-of-fact(?:ly)?|even(?:ly)?\\s+(?:voice|tone)|calm(?:ly)?', 'neutral', 1, []],
        ];

        function compileLexicon(table) {
            const out = [];
            for (const row of (table || DEFAULT_LEXICON)) {
                try {
                    if (!row || !row[0] || !LABEL_SET.has(row[1])) continue;
                    out.push({ re: new RegExp(row[0], 'gi'), label: row[1], w: Number(row[2]) || 1, vetoes: row[3] || [] });
                } catch (e) { /* skip bad row */ }
            }
            return out;
        }

        /**
         * L0 — the character's own material from a finished message.
         * @param {string} raw            message text (raw mes)
         * @param {object} o              { hex, nameRe, aliasRe, otherNameRes }
         * @returns {{parts:{text:string,w:number}[], dialogue:number, narration:number}}
         */
        function extractOwn(raw, o) {
            const parts = [];
            if (!raw) return { parts, dialogue: 0, narration: 0 };
            let text = String(raw).replace(DETAILS_RE, ' ').replace(THINK_RE, ' ')
                .replace(TAG_RE, ' ').replace(HEADER_LINE_RE, ' ');
            const total = text.length || 1;
            const hex = o && o.hex ? String(o.hex).toLowerCase() : null;
            let dialogue = 0;
            // (a) own dialogue spans.
            FONT_ANY_RE.lastIndex = 0;
            let m;
            while ((m = FONT_ANY_RE.exec(text)) !== null) {
                if (hex && m[1].toLowerCase() === hex) {
                    const inner = m[2].replace(TAG_STRIP_RE, ' ').replace(/\s+/g, ' ').trim();
                    if (inner) { parts.push({ text: inner, w: (m.index / total) >= LAST_FRACTION ? 2 : 1, kind: 'dialogue' }); dialogue++; }
                }
            }
            // (b) narration about her, processed IN DOCUMENT ORDER so a
            // she/her sentence right after her own dialogue is hers, and one
            // right after another speaker's line is not. When no other
            // female cast member is named anywhere in the message
            // (o.soloFemale), she/her is hers by default.
            let prevHers = false;
            let count = 0;
            let cursor = 0;
            const chunks = [];
            FONT_ANY_RE.lastIndex = 0;
            while ((m = FONT_ANY_RE.exec(text)) !== null) {
                chunks.push({ kind: 'narr', text: text.slice(cursor, m.index), at: cursor });
                chunks.push({ kind: (hex && m[1].toLowerCase() === hex) ? 'own' : 'other', at: m.index });
                cursor = m.index + m[0].length;
            }
            chunks.push({ kind: 'narr', text: text.slice(cursor), at: cursor });
            for (const ch of chunks) {
                if (ch.kind === 'own') { prevHers = true; continue; }
                if (ch.kind === 'other') { prevHers = false; continue; }
                const narr = ch.text.replace(TAG_STRIP_RE, ' ');
                SENT_RE.lastIndex = 0;
                let sm;
                while ((sm = SENT_RE.exec(narr)) !== null) {
                    const sent = sm[0].replace(/\s+/g, ' ').trim();
                    if (!sent || sent.length < 4) continue;
                    const named = Boolean((o && o.nameRe && o.nameRe.test(sent)) || (o && o.aliasRe && o.aliasRe.test(sent)));
                    let other = false;
                    if (o && Array.isArray(o.otherNameRes)) {
                        for (const r of o.otherNameRes) { if (r && r.test(sent)) { other = true; break; } }
                    }
                    const pron = PRONOUN_SHE.test(sent);
                    let hers = named || (pron && !other && (prevHers || Boolean(o && o.soloFemale)));
                    prevHers = hers ? !other || named : (other ? false : prevHers);
                    if (!hers) continue;
                    parts.push({ text: sent, w: ((ch.at + sm.index) / total) >= LAST_FRACTION ? 2 : 1, kind: 'narration' });
                    count++;
                }
            }
            return { parts, dialogue, narration: count };
        }

        /** Text for the classifier: last-weighted parts first, capped. */
        function classifierText(ext, cap) {
            const limit = cap || 1500;
            const heavy = ext.parts.filter(function (p) { return p.w >= 2; }).map(function (p) { return p.text; }).join(' ');
            const light = ext.parts.filter(function (p) { return p.w < 2; }).map(function (p) { return p.text; }).join(' ');
            let out = heavy;
            if (out.length < limit && light) out = (out ? out + ' ' : '') + light;
            return out.length > limit ? out.slice(0, limit) : out;
        }

        /** L1 — tag from raw text, then "Mood: x" inside <details>, then reasoning. */
        function detectTag(raw, reasoning) {
            const tryRe = function (t) {
                if (!t) return null;
                let last = null; let m;
                TAG_RE.lastIndex = 0;
                while ((m = TAG_RE.exec(t)) !== null) last = m[1].toLowerCase();
                return last && LABEL_SET.has(last) ? last : null;
            };
            let label = tryRe(raw);
            if (!label && raw) {
                const dm = DETAILS_MOOD_RE.exec(raw);
                if (dm && LABEL_SET.has(dm[1].toLowerCase())) label = dm[1].toLowerCase();
            }
            if (!label) label = tryRe(reasoning);
            return label;
        }

        /** L3 — lexicon over the L0 parts. */
        function lexicon(ext, compiled) {
            const table = compiled || compileLexicon();
            const scores = {};
            const cues = [];
            const vetoes = new Set();
            let hitWeight = 0; let hitCount = 0;
            let laughter = false; let tears = false;
            for (const p of ext.parts) {
                for (const cue of table) {
                    cue.re.lastIndex = 0;
                    let m;
                    while ((m = cue.re.exec(p.text)) !== null) {
                        if (m.index === cue.re.lastIndex) cue.re.lastIndex++;
                        const before = p.text.slice(Math.max(0, m.index - 24), m.index);
                        if (NEG_RE.test(before)) { vetoes.add(cue.label); cues.push('¬' + m[0]); continue; }
                        const w = cue.w * p.w;
                        scores[cue.label] = (scores[cue.label] || 0) + w;
                        hitWeight += w; hitCount++;
                        cues.push(m[0] + '→' + cue.label);
                        for (const v of cue.vetoes) vetoes.add(v);
                        if (cue.label === 'amusement' && /laugh|giggl|chuckl/i.test(m[0])) laughter = true;
                        if (cue.label === 'sadness' && /tear|cr(?:y|ies|ied|ying)|we(?:ep|pt)|sob/i.test(m[0])) tears = true;
                    }
                }
            }
            // Hard vetoes.
            if (laughter) for (const l of ['sadness', 'grief', 'anger', 'fear']) vetoes.add(l);
            if (tears) for (const l of ['joy', 'amusement', 'pride']) vetoes.add(l);
            // A label cannot veto itself out of the running when it has strong
            // direct evidence AND the veto came only from a weaker cue.
            let top = null; let topScore = 0;
            for (const l of Object.keys(scores)) {
                if (vetoes.has(l)) continue;
                if (scores[l] > topScore) { topScore = scores[l]; top = l; }
            }
            return { scores, top, topScore, cues, vetoes, hitWeight, hitCount };
        }

        /** Normalise classifier output to shares of the returned top-k. */
        function normaliseLocal(local) {
            if (!Array.isArray(local) || !local.length) return [];
            const sum = local.reduce(function (a, x) { return a + (Number(x.score) || 0); }, 0) || 1;
            return local.map(function (x) { return { label: String(x.label).toLowerCase(), score: Number(x.score) || 0, share: (Number(x.score) || 0) / sum }; })
                .sort(function (a, b) { return b.share - a.share; });
        }

        /**
         * The verdict rules (deterministic):
         *  1. Start with the L1 tag if present.
         *  2. If the tag is vetoed by L3 with strong evidence (>= 2 cue hits),
         *     replace it with L3's top non-vetoed label.
         *  3. No tag — in this order:
         *     a. strong lexicon evidence (top cue weight >= 4) wins over a
         *        merely-adequate classifier (share < 0.45);
         *     b. L2 top if share >= 0.35 (0.45 for neutral/confusion, the
         *        model's catch-alls) and not vetoed;
         *     c. L3 top if its weighted hits >= 2;
         *     d. best non-vetoed, non-catch-all of L2's top-3 if share >= 0.25;
         *     e. HOLD the previous mood.
         *  4. neutral is never chosen for lack of evidence: only via the tag,
         *     or L2 neutral share >= 0.5 with zero L3 hits.
         *  (Shares, not raw scores: go_emotions is multi-label sigmoid and a
         *   clear sentence tops out ~0.15–0.2 raw.)
         * @returns {{final:string|null, rule:string, hold:boolean}}
         */
        function verdict(input) {
            const tag = input.tag || null;
            const lex = input.lex || { top: null, topScore: 0, vetoes: new Set(), hitWeight: 0, hitCount: 0, cues: [] };
            const local = normaliseLocal(input.local);
            const prev = input.prev || null;
            const vetoed = function (l) { return lex.vetoes.has(l); };
            const okNeutral = function (share) { return share >= 0.5 && lex.hitCount === 0; };
            // go_emotions' catch-all labels need a clearer margin.
            const need = function (l) { return (l === 'confusion' || l === 'neutral') ? 0.45 : 0.35; };
            if (tag) {
                if (vetoed(tag) && lex.hitCount >= 2 && lex.top) return { final: lex.top, rule: '2 tag vetoed by lexicon', hold: false };
                return { final: tag, rule: '1 tag', hold: false };
            }
            const strongLex = Boolean(lex.top && lex.top !== 'neutral' && lex.topScore >= 4);
            if (local.length) {
                const t = local[0];
                const strongLocal = !vetoed(t.label) && t.share >= need(t.label) && (t.label !== 'neutral' || okNeutral(t.share));
                // 3a: strong lexicon evidence beats a merely-adequate classifier.
                if (strongLex && !(strongLocal && t.share >= 0.45 && t.label === lex.top)) {
                    if (!strongLocal || t.share < 0.45) return { final: lex.top, rule: '3a lexicon (strong)', hold: false };
                }
                if (strongLocal) return { final: t.label, rule: '3b local top', hold: false };
            } else if (strongLex) {
                return { final: lex.top, rule: '3a lexicon (strong)', hold: false };
            }
            // 3c: any lexicon evidence (>= 2 weighted hits) before a weak classifier.
            if (lex.top && lex.top !== 'neutral' && lex.hitWeight >= 2) return { final: lex.top, rule: '3c lexicon', hold: false };
            // 3d: best non-vetoed of the classifier's top-3 (never neutral/confusion here).
            for (const c of local.slice(0, 3)) {
                if (c.label === 'neutral' || c.label === 'confusion' || vetoed(c.label)) continue;
                if (c.share >= 0.25) return { final: c.label, rule: '3d local top-3', hold: false };
            }
            if (lex.top === 'neutral' && lex.hitWeight >= 2 && lex.hitCount >= 2) return { final: 'neutral', rule: '3c lexicon (positive neutral)', hold: false };
            return { final: prev, rule: '3e hold', hold: true };
        }

        // Nearest available sprite when the folder lacks the label.
        const NEAREST = {
            amusement: ['joy', 'love'], annoyance: ['anger', 'disapproval'], grief: ['sadness'],
            nervousness: ['fear', 'sadness'], admiration: ['love', 'joy', 'surprise'],
            approval: ['joy', 'love', 'pride'], gratitude: ['caring', 'love', 'joy'],
            caring: ['love', 'joy'], optimism: ['joy', 'curiosity'], pride: ['joy', 'love'],
            relief: ['joy', 'caring'], realization: ['surprise', 'curiosity'],
            excitement: ['joy', 'surprise'], disappointment: ['sadness'], disapproval: ['anger', 'annoyance'],
            disgust: ['anger', 'disapproval'], remorse: ['sadness', 'embarrassment'],
            confusion: ['curiosity', 'surprise'], desire: ['love'], love: ['desire', 'caring', 'joy'],
            joy: ['amusement', 'love'], fear: ['nervousness', 'surprise'], anger: ['annoyance', 'disapproval'],
            sadness: ['grief', 'disappointment'], surprise: ['curiosity', 'realization'],
            embarrassment: ['nervousness', 'surprise'], curiosity: ['surprise'],
        };
        function mapToAvailable(label, available) {
            if (!label) return null;
            if (!available || !available.size || available.has(label)) return label;
            for (const alt of (NEAREST[label] || [])) if (available.has(alt)) return alt;
            return available.has('neutral') ? 'neutral' : label;
        }

        // NPC -happy/-angry/-sad variant for a verdict label.
        const NPC_VARIANT = {
            joy: 'happy', amusement: 'happy', love: 'happy', approval: 'happy', gratitude: 'happy',
            anger: 'angry', annoyance: 'angry', disgust: 'angry', disapproval: 'angry',
            sadness: 'sad', grief: 'sad', fear: 'sad', remorse: 'sad',
        };
        function npcVariant(label) { return (label && NPC_VARIANT[label]) || 'neutral'; }

        function describe(tag, local, lex, out) {
            const loc = normaliseLocal(local).slice(0, 3).map(function (x) { return x.label + ' ' + x.share.toFixed(2); }).join(', ');
            const lx = lex && lex.top ? lex.top + ' +' + lex.topScore.toFixed(1) + ' (' + lex.cues.slice(0, 6).join(', ') + ')' : 'none';
            return 'mood verdict: tag=' + (tag || 'none') + ' local=' + (loc || 'n/a') + ' lex=' + lx
                + ' vetoes=[' + Array.from(lex ? lex.vetoes : []).join(',') + '] → ' + (out.final || 'hold') + ' (' + out.rule + ')';
        }

        return { LABELS, DEFAULT_LEXICON, compileLexicon, extractOwn, classifierText, detectTag, lexicon, normaliseLocal, verdict, mapToAvailable, npcVariant, describe };
    })();
    // === MOOD ENGINE (pure) END ===
    // === PRESENCE ENGINE (pure) BEGIN ===
    // Layered evidence/veto engine for every text-driven decision: who is in
    // the scene (cast + unknown speakers), which props are in play, and
    // whether a costume trigger is live. Pure functions only (no DOM/ST), so
    // the node harness can extract this block and run saved messages.
    //
    // The one structural rule everything hangs on: text INSIDE any coloured
    // dialogue span or plain quotation marks belongs to a SPEAKER, and a
    // name inside someone else's speech is a mention, never presence —
    // characters talk about people constantly. Only NARRATION (outside all
    // quotes/spans) can carry presence cues. A speaker's own span is the
    // decisive evidence for that speaker.
    const PresenceEngine = (function () {
        const FONT_ANY_RE = /<font\s+color=["']?(#[0-9a-f]{6})["']?[^>]*>([\s\S]*?)<\/font>/gi;
        const QUOTE_RE = /"[^"\n]{2,400}"|“[^”\n]{2,400}”/g;
        const DETAILS_RE = /<details[\s\S]*?<\/details>/gi;
        const THINK_RE = /<think>[\s\S]*?<\/think>/gi;
        const SENTENCE_SPLIT_RE = /[.!?\n]/;
        const HEADER_LINE_RE = /^[^\n]*📍[^\n]*$/m;
        // Physical arrival / position cues (narration only). No speech verbs.
        const DEFAULT_ARRIVAL = 'enter(?:s|ed)?|walk(?:s|ed)? (?:in|over|up)|com(?:es|ing) (?:in|over|up)|came (?:in|over|up)|step(?:s|ped)? (?:in|inside|closer|forward|up)|appear(?:s|ed)|arriv(?:es|ed|ing)|join(?:s|ed) (?:them|us|her|him|you)|sits?|sat|sitting|seated|stands?|stood|standing|beside|next to|across (?:from|the table)|opposite|at the table|in the doorway|pulls? up a chair|takes? a seat|lean(?:s|ed|ing) (?:in|over|against|on)|settl(?:es|ed) (?:into|onto|in|beside)|waits? (?:by|at|beside)|opens? the door|in the (?:room|kitchen|corridor|hall|car)';
        // Physical action verbs (narration only, weaker evidence).
        const DEFAULT_ACTION = 'nods?|nodded|reach(?:es|ed)|laugh(?:s|ed|ing)|hand(?:s|ed) (?:her|him|you|them)|looks? (?:at|over at|up at) (?:you|her|him)|smil(?:es|ed)|shrugs?|frowns?|glanc(?:es|ed)|watch(?:es|ed|ing)|pass(?:es|ed)|pours?|sets? down|picks? up|waves?|shakes? (?:her|his) head|folds? (?:her|his) arms|pats?|squeez(?:es|ed)|hugs?|kiss(?:es|ed)|touch(?:es|ed)|points?|gestur(?:es|ed)|snorts?|sighs?';
        // Reported speech / phone / absence — any of these in the sentence
        // that names the character vetoes them for this message.
        const DEFAULT_ABSENCE = 'ring(?:s|ing)?|rang|call(?:s|ed|ing)?|phone[sd]?|phoning|text(?:s|ed|ing)?|messag(?:e|es|ed|ing)|said|says?|would say|tell(?:s|ing)?|told|remember(?:s|ed|ing)?|miss(?:es|ed|ing)?|wonder(?:s|ed|ing)?|promised?|about|mention(?:s|ed)?|th(?:ink|ought)s? (?:of|about)|wish(?:es|ed)?|later|tomorrow|yesterday|last (?:night|week|time)|wrote|reckon(?:s|ed)?|thinks?|used to|back (?:home|at)';
        const DEFAULT_DEPART = 'leaves|left|gone|walk(?:s|ed) out|storm(?:s|ed) (?:out|off)|dr(?:ives?|ove) (?:off|away)|hangs? up|hung up|head(?:s|ed) (?:out|off|home)|goes out|departs?|departed|goodbye|good night';
        // Props: handled / present cues, and memory contexts that veto.
        const DEFAULT_HANDLED = 'on the (?:table|bench|counter|seat|desk|bed)|in (?:her|his|your) (?:hand|hands|lap|bag|pocket)|holds?|holding|held|sets? (?:it |the \\w+ )?down|picks? (?:it |the \\w+ )?up|takes?|took|hands? (?:her|him|you|it)|opens?|closes?|puts?|lays?|lifts?|pours?|sips?|drinks?|eats?|wraps?|clutch(?:es|ed)|grips?|turns? (?:it|the \\w+) over|passes?';
        const DEFAULT_MEMORY = 'remember(?:s|ed|ing)?|last (?:night|week|time|year)|yesterday|later|tomorrow|going to|gonna|will|would|used to|had been|back (?:then|home|at)|once|promis(?:es|ed)|mention(?:s|ed)?|think(?:s|ing)? (?:of|about)|thought (?:of|about)|wish(?:es|ed)?|miss(?:es|ed)?|talk(?:s|ed|ing)? (?:of|about)';

        function compile(src, flags) {
            try { return src ? new RegExp('\\b(?:' + src + ')\\b', flags || 'i') : null; } catch (e) { return null; }
        }
        function compileTables(o) {
            o = o || {};
            return {
                arrival: compile(o.arrival || DEFAULT_ARRIVAL, 'i'),
                action: compile(o.action || DEFAULT_ACTION, 'i'),
                absence: compile(o.absence || DEFAULT_ABSENCE, 'i'),
                depart: compile(o.depart || DEFAULT_DEPART, 'gi'),
                handled: compile(o.handled || DEFAULT_HANDLED, 'i'),
                memory: compile(o.memory || DEFAULT_MEMORY, 'i'),
            };
        }

        /**
         * Mask a message: same-length string where every coloured span and
         * every quoted run is blanked (spaces), so indices stay valid and
         * regexes over `narr` only ever see narration. Also returns the
         * spans (hex, range) and quote ranges, and the 📍 header line.
         */
        function mask(raw) {
            const text = String(raw || '').replace(DETAILS_RE, function (m) { return ' '.repeat(m.length); })
                .replace(THINK_RE, function (m) { return ' '.repeat(m.length); });
            const spans = [];
            let narr = text;
            const blank = function (s, start, end) { return s.slice(0, start) + ' '.repeat(end - start) + s.slice(end); };
            FONT_ANY_RE.lastIndex = 0;
            let m;
            while ((m = FONT_ANY_RE.exec(text)) !== null) {
                spans.push({ start: m.index, end: m.index + m[0].length, hex: m[1].toLowerCase(), inner: m[2] });
            }
            for (const sp of spans) narr = blank(narr, sp.start, sp.end);
            const quotes = [];
            QUOTE_RE.lastIndex = 0;
            while ((m = QUOTE_RE.exec(narr)) !== null) quotes.push({ start: m.index, end: m.index + m[0].length });
            for (const q of quotes) narr = blank(narr, q.start, q.end);
            // Strip remaining tags from narration (keep length).
            narr = narr.replace(/<[^>]+>/g, function (t) { return ' '.repeat(t.length); });
            const hm = HEADER_LINE_RE.exec(text);
            const header = hm ? hm[0] : '';
            if (hm) narr = blank(narr, hm.index, hm.index + hm[0].length);
            return { text, narr, spans, quotes, header };
        }
        function ownerAt(masked, idx) {
            for (const sp of masked.spans) if (idx >= sp.start && idx < sp.end) return { kind: 'span', hex: sp.hex };
            for (const q of masked.quotes) if (idx >= q.start && idx < q.end) return { kind: 'quote' };
            return null;
        }
        function sentenceAround(text, idx) {
            let a = idx; let b = idx;
            while (a > 0 && !SENTENCE_SPLIT_RE.test(text[a - 1])) a--;
            while (b < text.length && !SENTENCE_SPLIT_RE.test(text[b])) b++;
            return { text: text.slice(a, b), start: a, end: b };
        }
        function globalOf(re) {
            if (!re) return null;
            try { return new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); } catch (e) { return null; }
        }

        /**
         * Presence verdict for one member against one message.
         * @param {object} masked   from mask()
         * @param {object} member   { key, label, hex, nameRe, aliasRe }
         * @param {object} opts     { tables, hexLabel(hex)->label, locChanged }
         * @returns {{key, score, evidence:string[], vetoes:string[], present:boolean, strong:boolean, detail:string}}
         */
        function evaluate(masked, member, opts) {
            const T = (opts && opts.tables) || compileTables();
            const hexLabel = (opts && opts.hexLabel) || function (h) { return h; };
            const evidence = []; const vetoes = [];
            let score = 0; let strong = false;
            const text = masked.text; const narr = masked.narr;
            const lower = text.toLowerCase();
            // 1. Own coloured dialogue: decisive.
            if (member.hex && lower.indexOf(String(member.hex).toLowerCase()) >= 0) {
                score += 10; strong = true; evidence.push('own dialogue ' + member.hex);
            }
            // 2. Name / alias occurrences.
            let lastArrivalIdx = -1; let anyNarrationName = false; let anyQuotedName = false;
            for (const re of [member.nameRe, member.aliasRe]) {
                const g = globalOf(re);
                if (!g) continue;
                g.lastIndex = 0;
                let m;
                while ((m = g.exec(text)) !== null) {
                    if (m.index === g.lastIndex) g.lastIndex++;
                    const owner = ownerAt(masked, m.index);
                    if (owner) {
                        if (owner.kind === 'span' && member.hex && owner.hex === String(member.hex).toLowerCase()) continue; // own line
                        anyQuotedName = true;
                        vetoes.push("inside " + (owner.kind === 'span' ? hexLabel(owner.hex) + "'s" : 'quoted') + ' dialogue');
                        continue;
                    }
                    anyNarrationName = true;
                    const sent = sentenceAround(narr, m.index);
                    if (T.absence && T.absence.test(sent.text)) {
                        const am = T.absence.exec(sent.text);
                        vetoes.push('absence "' + (am ? am[0] : '') + '"');
                        continue;
                    }
                    const win = narr.slice(Math.max(0, m.index - 40), Math.min(narr.length, m.index + m[0].length + 40));
                    const cue = T.arrival ? T.arrival.exec(win) : null;
                    if (cue) { score += 4; evidence.push('cue "' + cue[0] + '"'); lastArrivalIdx = Math.max(lastArrivalIdx, m.index); continue; }
                    const act = T.action ? T.action.exec(sent.text) : null;
                    if (act) { score += 2; evidence.push('action "' + act[0] + '"'); }
                }
            }
            // A name that appears ONLY inside others' speech is a mention.
            if (anyQuotedName && !anyNarrationName && !strong) { /* veto already recorded */ }
            // 3. Named in the 📍 header ("with Martha").
            if (masked.header) {
                for (const re of [member.nameRe, member.aliasRe]) if (re && re.test(masked.header)) { score += 3; evidence.push('header'); break; }
            }
            // 4. Explicit departure after the last arrival cue.
            if (T.depart) {
                T.depart.lastIndex = 0;
                let dm;
                while ((dm = T.depart.exec(narr)) !== null) {
                    if (dm.index === T.depart.lastIndex) T.depart.lastIndex++;
                    if (dm.index < lastArrivalIdx) continue;
                    // Only when it is about this member: name within 160 chars before.
                    const before = narr.slice(Math.max(0, dm.index - 160), dm.index);
                    if ((member.nameRe && member.nameRe.test(before)) || (member.aliasRe && member.aliasRe.test(before))) {
                        vetoes.push('departure "' + dm[0] + '"');
                        break;
                    }
                }
            }
            // 5. Location changed with no fresh evidence.
            if (opts && opts.locChanged && score === 0) vetoes.push('location changed, no fresh evidence');
            // Quoted-only mention vetoes only matter when there is no real evidence.
            const realVetoes = vetoes.filter(function (v) { return !(v.indexOf('inside ') === 0 && score > 0 && anyNarrationName); });
            const present = score >= 4 && realVetoes.length === 0;
            const detail = 'presence ' + member.key + ': +' + score + (evidence.length ? ' (' + evidence.join(', ') + ')' : '')
                + (realVetoes.length ? ' veto[' + realVetoes.join('; ') + ']' : '') + ' → ' + (present ? 'present' : 'absent');
            return { key: member.key, score, evidence, vetoes: realVetoes, present, strong, detail };
        }

        /** Prop verdict: { score, vetoes, present, detail }. ownHex = the main character's colour. */
        function evaluateProp(masked, prop, opts) {
            const T = (opts && opts.tables) || compileTables();
            const ownHex = opts && opts.ownHex ? String(opts.ownHex).toLowerCase() : null;
            let score = 0; const evidence = []; const vetoes = [];
            const g = globalOf(prop.re);
            if (!g) return { score: 0, vetoes: [], present: false, detail: 'prop ' + prop.key + ': no regex' };
            g.lastIndex = 0;
            let m;
            while ((m = g.exec(masked.text)) !== null) {
                if (m.index === g.lastIndex) g.lastIndex++;
                const owner = ownerAt(masked, m.index);
                let src = masked.narr;
                if (owner) {
                    if (owner.kind === 'span' && ownHex && owner.hex === ownHex) {
                        // Own dialogue counts; use the span text as the sentence source.
                        src = masked.text;
                    } else { vetoes.push('inside other dialogue'); continue; }
                }
                const sent = sentenceAround(src, m.index);
                if (T.memory && T.memory.test(sent.text)) { vetoes.push('memory/plan context'); continue; }
                if (T.handled && T.handled.test(sent.text)) { score += 3; evidence.push('handled'); }
                else { score += 1; evidence.push('mentioned'); }
            }
            const real = score >= 3 ? [] : vetoes;
            const present = score >= 3 && real.length === 0;
            return { score, vetoes: real, present, detail: 'prop ' + prop.key + ': +' + score + (evidence.length ? ' (' + evidence.join(', ') + ')' : '') + (real.length ? ' veto[' + real.join('; ') + ']' : '') + ' → ' + (present ? 'shown' : 'hidden') };
        }

        /** True when `re` matches in NARRATION with a live (non-memory/plan) sentence. */
        function liveMatch(masked, re, opts) {
            const T = (opts && opts.tables) || compileTables();
            const g = globalOf(re);
            if (!g) return false;
            g.lastIndex = 0;
            let m;
            while ((m = g.exec(masked.narr)) !== null) {
                if (m.index === g.lastIndex) g.lastIndex++;
                const sent = sentenceAround(masked.narr, m.index);
                if (T.memory && T.memory.test(sent.text)) continue;
                return true;
            }
            return false;
        }

        /** Name guess for an unknown speaker from NARRATION before its first span. */
        const CAPS_NAME_RE = /\b([A-Z]{2,}(?:\s+[A-Z]{2,}){0,2})\b/g;
        const CAP_NAME_RE = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
        function nameGuess(masked, spanStart, stopWords) {
            const before = masked.narr.slice(Math.max(0, spanStart - 200), spanStart);
            let label = null; let cm;
            CAPS_NAME_RE.lastIndex = 0;
            while ((cm = CAPS_NAME_RE.exec(before)) !== null) label = cm[1].toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
            if (!label) {
                const near = before.slice(-140);
                CAP_NAME_RE.lastIndex = 0;
                while ((cm = CAP_NAME_RE.exec(near)) !== null) {
                    if (!(stopWords && stopWords.has(cm[1].split(' ')[0]))) label = cm[1];
                }
            }
            return label;
        }

        return { DEFAULTS: { arrival: DEFAULT_ARRIVAL, action: DEFAULT_ACTION, absence: DEFAULT_ABSENCE, depart: DEFAULT_DEPART, handled: DEFAULT_HANDLED, memory: DEFAULT_MEMORY },
            compileTables, mask, ownerAt, sentenceAround, evaluate, evaluateProp, liveMatch, nameGuess };
    })();
    // === PRESENCE ENGINE (pure) END ===


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
                dbg(`migrated ${s.places.length} background-map rows into place cards`);
            }
            // 0.5.1: chipSize changed from px to vh.
            if (Number(s.chipSize) > 40) s.chipSize = defaultSettings.chipSize;
            // Cast members gain optional fields.
            if (Array.isArray(s.cast)) {
                for (const m of s.cast) {
                    if (m.bio === undefined) m.bio = '';
                    if (m.avatar === undefined) m.avatar = '';
                    if (m.moodVariants === undefined) m.moodVariants = false;
                    if (m.aliasRegex === undefined) m.aliasRegex = '';
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
    let presenceTablesCache = { key: null, tables: null };
    function presenceTables(settings) {
        const key = [settings.presenceArrivalRegex, settings.presenceActionRegex, settings.absenceContextRegex, settings.presenceDepartRegex].join('|');
        if (presenceTablesCache.key !== key) {
            presenceTablesCache = { key, tables: PresenceEngine.compileTables({
                arrival: settings.presenceArrivalRegex || null, action: settings.presenceActionRegex || null,
                absence: settings.absenceContextRegex || null, depart: settings.presenceDepartRegex || null }) };
        }
        return presenceTablesCache.tables;
    }
    /**
     * v0.6.4: presence verdict per cast member via PresenceEngine — evidence
     * (own dialogue +10, arrival cue +4, action +2, header +3) minus vetoes
     * (name only inside someone else's speech, absence/reported-speech
     * sentence, departure, location change without fresh evidence).
     */
    function analyzeCast(scene, settings, locChanged) {
        const present = [];
        const verdicts = [];
        let speakerKey = null;
        let speakerPos = -1;
        if (!scene.text) return { present, speakerKey, masked: null, verdicts };
        const masked = PresenceEngine.mask(scene.text);
        const T = presenceTables(settings);
        const ownHex = ownColorHex(SillyTavern.getContext(), settings);
        const hexLabel = function (h) {
            if (ownHex && h === ownHex) return SillyTavern.getContext().name2 || 'the character';
            const m = settings.cast.find(function (x) { return x.colorHex && x.colorHex.toLowerCase() === h; });
            if (m) return m.label;
            const u = unknownInfo.get('unk:' + h);
            return u ? u.label : h;
        };
        for (const member of settings.cast) {
            const r = PresenceEngine.evaluate(masked, {
                key: member.key, label: member.label, hex: member.colorHex,
                nameRe: compileRegex(member.nameRegex || ''), aliasRe: compileRegex(member.aliasRegex || ''),
            }, { tables: T, hexLabel, locChanged: Boolean(locChanged) });
            verdicts.push(r);
            const pos = member.colorHex ? scene.lower.lastIndexOf(member.colorHex.toLowerCase()) : -1;
            if (pos > speakerPos) { speakerPos = pos; speakerKey = member.key; }
            if (r.score || r.vetoes.length) dbg(r.detail);
            if (r.present) {
                if (!castPresence.has(member.key)) dbg(`cast +${member.key} (${r.evidence.join(', ')})`);
                present.push({ member, pos, strong: r.strong, evidence: r.evidence.join(', ') });
            } else if (r.vetoes.length) {
                if (castPresence.has(member.key)) dbg(`cast -${member.key} (${r.vetoes[0]})`);
                else if (r.vetoes[0].indexOf('inside') === 0) dbg(`cast ~${member.key} rejected (${r.vetoes[0]})`);
                castPresence.delete(member.key);
            }
        }
        return { present, speakerKey, masked, verdicts };
    }

    // v0.5.4: unknown speakers — a dialogue colour on no Cast card gets a
    // silhouette chip (inline SVG tinted with the colour), named from the
    // text before its first span, gendered by nearby pronouns.
    const FONT_SPAN_RE = /<font\s+color=["']?(#[0-9a-f]{6})["']?[^>]*>/gi;
    const CAPS_NAME_RE = /\b([A-Z]{2,}(?:\s+[A-Z]{2,}){0,2})\b(?![^<]*>)/g;
    const CAP_NAME_RE = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
    const NOT_NAMES = new Set(['The', 'She', 'He', 'They', 'Her', 'His', 'Then', 'And', 'But', 'When', 'Mood']);
    const unknownInfo = new Map(); // 'unk:#hex' -> { label, gender, hex }

    function silhouetteSrc(hex, gender) {
        const tint = hex || '#888888';
        const head = gender === 'male' ? 'M32 8a11 11 0 1 0 0 22a11 11 0 1 0 0-22z' : 'M32 6a12 12 0 1 0 0 24a12 12 0 1 0 0-24z';
        const hair = gender === 'female' ? '<path d="M18 22c-2-12 8-18 14-18s16 6 14 18c-3-6-6-9-14-9s-11 3-14 9z" fill="#111" opacity=".9"/>' :
            (gender === 'male' ? '<path d="M21 14c2-8 20-8 22 0c-4-3-8-4-11-4s-7 1-11 4z" fill="#111" opacity=".9"/>' : '');
        const body = gender === 'female' ? 'M10 64c1-16 8-24 22-26c14 2 21 10 22 26z' : 'M8 64c1-15 9-23 24-25c15 2 23 10 24 25z';
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
            + '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + tint + '" stop-opacity=".55"/><stop offset="1" stop-color="' + tint + '" stop-opacity=".15"/></linearGradient></defs>'
            + '<path d="' + body + '" fill="#1b1c24"/><path d="' + body + '" fill="url(#g)"/>'
            + '<path d="' + head + '" fill="#1b1c24"/><path d="' + head + '" fill="url(#g)"/>' + hair + '</svg>';
        return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }
    function titleCase(str) {
        return str.toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
    }
    /** [{ key, label, hex, gender, pos }] for colours on no Cast card. */
    function detectUnknownSpeakers(scene, settings) {
        const out = [];
        try {
            const text = scene.text; const lower = scene.lower;
            const known = new Set();
            if (settings.ownColorHex) known.add(String(settings.ownColorHex).toLowerCase());
            for (const m of settings.cast) if (m.colorHex) known.add(m.colorHex.toLowerCase());
            const first = new Map();
            FONT_SPAN_RE.lastIndex = 0;
            let m;
            while ((m = FONT_SPAN_RE.exec(text)) !== null) {
                const hex = m[1].toLowerCase();
                if (known.has(hex)) continue;
                if (!first.has(hex)) first.set(hex, m.index);
            }
            const ownName = (SillyTavern.getContext().name2 || '').split(' ')[0];
            for (const [hex, idx] of first) {
                const key = 'unk:' + hex;
                let info = unknownInfo.get(key);
                if (!info) {
                    // 0.6.4: the name guess comes from NARRATION outside quotes.
                    const stop = new Set(NOT_NAMES); if (ownName) stop.add(ownName);
                    const label = PresenceEngine.nameGuess(PresenceEngine.mask(text), idx, stop);
                    const around = lower.slice(Math.max(0, idx - 200), Math.min(lower.length, idx + 300));
                    const f = (around.match(/\b(?:she|her|hers|herself)\b/g) || []).length;
                    const mm = (around.match(/\b(?:he|him|his|himself)\b/g) || []).length;
                    info = { label: label || 'Unknown', gender: f > mm ? 'female' : (mm > f ? 'male' : 'neutral'), hex };
                    unknownInfo.set(key, info);
                }
                out.push({ key, label: info.label, hex, gender: info.gender, pos: lower.lastIndexOf(hex) });
            }
        } catch (e) { /* ignore */ }
        return out;
    }

    function persistPresence() {
        try {
            const meta = chatMeta(true);
            if (!meta) return;
            const obj = {};
            for (const [k, v] of castPresence) obj[k] = (typeof v === 'object' && v) ? { miss: v.miss, strong: Boolean(v.strong) } : { miss: v, strong: true };
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
                    const raw = meta.presence[k];
                    const miss = Number(typeof raw === 'object' && raw ? raw.miss : raw);
                    const strong = Boolean(typeof raw === 'object' && raw ? raw.strong : true);
                    if (Number.isFinite(miss) && miss >= 0 && miss < PRESENCE_MISS_LIMIT) castPresence.set(k, { miss, strong });
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
                const { present } = analyzeCast(scene, settings, false);
                for (const p of present) castPresence.set(p.member.key, { miss: n, strong: Boolean(p.strong) });
            }
        } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // Cast moods
    // ------------------------------------------------------------------

    const MOODS = ['happy', 'angry', 'sad'];
    const MOOD_EMOJI = { happy: '✨', angry: '💢', sad: '💧' };

    // v0.6.0: NPC moods via the engine (L0 -> L3 sync; L2 async refine).
    function memberExtract(text, member, settings) {
        const others = [];
        for (const m of settings.cast) {
            if (m.key === member.key) continue;
            const r = compileRegex(m.nameRegex || ''); if (r) others.push(r);
            const a = compileRegex(m.aliasRegex || ''); if (a) others.push(a);
        }
        const own = ownNameRegex(); if (own && member.key !== '__main__') others.push(own);
        return MoodEngine.extractOwn(text, {
            hex: member.colorHex, nameRe: compileRegex(member.nameRegex || ''), aliasRe: compileRegex(member.aliasRegex || ''),
            otherNameRes: others, soloFemale: false,
        });
    }
    function moodLexiconCompiled(settings) {
        const key = settings.moodLexicon ? JSON.stringify(settings.moodLexicon).length : 0;
        if (lexCache.key !== key) { lexCache.key = key; lexCache.table = MoodEngine.compileLexicon(settings.moodLexicon || null); }
        return lexCache.table;
    }
    const lexCache = { key: -1, table: null };
    function detectMood(text, member, settings) {
        try {
            const ext = memberExtract(text, member, settings);
            if (!ext.parts.length) return 'neutral';
            const lex = MoodEngine.lexicon(ext, moodLexiconCompiled(settings));
            const out = MoodEngine.verdict({ tag: null, local: null, lex, prev: null });
            return MoodEngine.npcVariant(out.final);
        } catch (e) { return 'neutral'; }
    }
    async function refineNpcMood(text, member, settings) {
        try {
            if (!settings.enableLocalClassifier || moodState.classifier === 'unavailable') return;
            const ext = memberExtract(text, member, settings);
            if (!ext.parts.length) return;
            const local = await classifyLocal(MoodEngine.classifierText(ext, 1200));
            if (!local) return;
            const lex = MoodEngine.lexicon(ext, moodLexiconCompiled(settings));
            const out = MoodEngine.verdict({ tag: null, local, lex, prev: null });
            const variant = MoodEngine.npcVariant(out.final);
            const chip = castChips.get(member.key);
            if (!chip || chip.mood === variant || !chip.el.isConnected) return;
            if (chip.moodTs && Date.now() - chip.moodTs < 8000) return;
            dbg(`npc ${member.key}: ` + MoodEngine.describe(null, local, lex, out) + ` -> ${variant}`);
            queueDom(function () {
                const fresh = buildChip(member, variant, chip.speaking, settings, chip.lingering);
                if (chip.el.isConnected) chip.el.replaceWith(fresh.el);
                fresh.moodTs = Date.now();
                castChips.set(member.key, fresh);
            });
        } catch (e) { /* ignore */ }
    }
    function detectMoodLegacy(text, member, settings) {
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

    const WX_ICON_RE = /(\p{Extended_Pictographic}\uFE0F?)/u;
    function weatherIcon(text) {
        const m = WX_ICON_RE.exec(text || '');
        if (m) return m[1];
        const t = (text || '').toLowerCase();
        if (/storm|thunder/.test(t)) return '⛈️';
        if (/rain|shower|drizzl/.test(t)) return '🌧️';
        if (/snow|sleet/.test(t)) return '❄️';
        if (/fog|mist/.test(t)) return '🌫️';
        if (/overcast|cloud/.test(t)) return '☁️';
        if (/wind/.test(t)) return '🌬️';
        if (/clear|sun|fine/.test(t)) return '☀️';
        return '🌤️';
    }
    /** 0.6.3: structured header parts for the stacked HUD (null = nothing parsed). */
    function buildHudParts(scene) {
        if (!scene.headerLine) return null;
        const out = { time: null, ampm: '', date: null, loc: null, weather: null, wxIcon: '', any: false };
        if (scene.timeMatch) {
            const tm = /(\d{1,2}:\d{2})\s*(AM|PM)?/i.exec(scene.timeMatch[0]);
            if (tm) { out.time = tm[1]; out.ampm = (tm[2] || '').toUpperCase(); }
            else out.time = scene.timeMatch[0].replace(WS_RE, ' ').trim();
            out.any = true;
        }
        const date = scene.date;
        if (date) {
            if (date.day) {
                const js = new Date(date.year, date.month - 1, date.day);
                out.date = `${DAY_NAMES[js.getDay()]} ${MON_NAMES[date.month - 1]} ${date.day} ${date.year}`;
            } else out.date = `${MON_NAMES[date.month - 1]} ${date.year}`;
            out.any = true;
        }
        if (scene.location) { out.loc = scene.location; out.any = true; }
        if (scene.weather) {
            out.wxIcon = weatherIcon(scene.weather);
            out.weather = scene.weather.replace(WX_ICON_RE, '').replace(WS_RE, ' ').trim();
            out.any = true;
        }
        return out.any ? out : null;
    }
    function hudPartsLine(parts) {
        const p = [];
        if (parts.time) p.push(parts.time + (parts.ampm ? ' ' + parts.ampm : ''));
        if (parts.date) p.push(parts.date);
        if (parts.weather || parts.wxIcon) p.push((parts.wxIcon + ' ' + (parts.weather || '')).trim());
        return p;
    }
    function hudAccentFor(scene) {
        return scene.state === 'night' ? '#6fa3e0' : scene.state === 'rain' ? '#9aa3ad' : scene.state === 'dusk' ? '#e08a5a' : '#f0b35a';
    }
    let hudResizeObserver = null;
    function setHudRow(hud, cls, html, title) {
        let row = hud.querySelector('.sd-hud-row.' + cls);
        if (!html) { if (row) row.remove(); return; }
        if (!row) { row = document.createElement('div'); row.className = 'sd-hud-row ' + cls; hud.appendChild(row); }
        if (row.innerHTML !== html) {
            row.innerHTML = html;
            row.classList.remove('changed');
            void row.offsetWidth;
            row.classList.add('changed');
        }
        if (title !== undefined) row.title = title || '';
    }
    function orderHudRows(hud) {
        for (const cls of ['sd-hud-time', 'sd-hud-date', 'sd-hud-loc', 'sd-hud-wx', 'sd-hud-counters']) {
            const r = hud.querySelector('.' + cls); if (r) hud.appendChild(r);
        }
    }

    function updateSceneHud(scene, settings) {
        try {
            let hud = document.getElementById('scene-director-hud');
            const parts = settings.enableHud ? buildHudParts(scene) : null;
            if (!parts) {
                if (hud) queueDom(function () { hud.style.display = 'none'; });
                return;
            }
            queueDom(function () {
                if (!hud) {
                    hud = document.createElement('div');
                    hud.id = 'scene-director-hud';
                    document.body.appendChild(hud);
                    applyHudAppearance(settings);
                    try {
                        if (typeof ResizeObserver === 'function') {
                            hudResizeObserver = new ResizeObserver(function () { queueDom(function () { applyStripAppearance(getSettings()); }); });
                            hudResizeObserver.observe(hud);
                        }
                    } catch (e) { /* ignore */ }
                }
                hud.style.display = '';
                const esc = escapeHtml;
                hud.dataset.hudStyle = settings.hudStyle || 'stacked';
                hud.style.setProperty('--sd-hud-scale', String(Math.max(0.8, Math.min(1.6, Number(settings.hudScale) || 1))));
                hud.style.setProperty('--sd-hud-alpha', String(Math.max(0.2, Math.min(1, Number(settings.hudOpacity) || 0.85))));
                hud.style.setProperty('--sd-hud-accent', hudAccentFor(scene));
                hud.classList.toggle('sd-hud-blur', Boolean(settings.enableChatGlass && settings.chatBlur));
                setHudRow(hud, 'sd-hud-time', parts.time
                    ? `<span class="sd-hud-clock">${esc(parts.time)}</span>${parts.ampm ? `<span class="sd-hud-ampm">${esc(parts.ampm)}</span>` : ''}` : null);
                setHudRow(hud, 'sd-hud-date', settings.hudDate && parts.date ? esc(parts.date) : null);
                setHudRow(hud, 'sd-hud-loc', settings.hudLoc && parts.loc ? '📍 ' + esc(parts.loc) : null, parts.loc || '');
                setHudRow(hud, 'sd-hud-wx', settings.hudWeather && (parts.weather || parts.wxIcon)
                    ? `<span class="sd-hud-wxicon">${esc(parts.wxIcon)}</span> ${esc(parts.weather || '')}` : null);
                let counters = '';
                try { if (settings.hudCounters) counters = buildCounters((scene.date && scene.date.day) ? scene.date : lastParsedDate, settings); } catch (e) { /* ignore */ }
                setHudRow(hud, 'sd-hud-counters', counters ? esc(counters) : null);
                orderHudRows(hud);
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
                    sdTimeout(function () { applySpriteSize(getSettings()); }, 60); // aspect may differ
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
                    // 0.5.5: keep the old image fully visible until the new
                    // file has painted, then a 1.2s cross-blend.
                    let waited = 0;
                    const startFade = function () {
                        if (!(cur.complete && cur.naturalWidth > 0) && waited < 4000) {
                            waited += 50;
                            sdTimeout(startFade, 50);
                            return;
                        }
                        requestAnimationFrame(function () { ghost.style.opacity = '0'; });
                        sdTimeout(function () { try { ghost.remove(); } catch (e) { /* ignore */ } }, 1300);
                    };
                    startFade();
                } catch (e) { /* never break on sprite changes */ }
            });
            spriteObserver.observe(target, {
                attributes: true,
                attributeFilter: ['src'],
                childList: true,
                subtree: true,
            });
            dbg(`sprite crossfade attached`);
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

    // 0.5.2: one bubble element for the main sprite — typing dots while a
    // generation is in flight, then the mood emoji for a few seconds.
    let mainBubbleSeq = 0;
    function mainBubbleEl() {
        let bubble = document.getElementById('scene-director-typing-bubble');
        if (!bubble) {
            bubble = document.createElement('div');
            bubble.id = 'scene-director-typing-bubble';
            bubble.className = 'scene-director-mood-bubble';
            document.body.appendChild(bubble);
        }
        return bubble;
    }
    function positionMainBubble(bubble) {
        const img = currentSpriteImg();
        if (!img) return false;
        const rect = img.getBoundingClientRect();
        if (!rect.width || !rect.height) return false;
        const off = rect.height * 0.10; // diagonally up-left of the head
        bubble.style.position = 'fixed';
        bubble.style.transform = 'none';
        bubble.style.left = Math.max(4, rect.left + rect.width * 0.38 - off) + 'px';
        bubble.style.top = Math.max(4, rect.top - off) + 'px';
        return true;
    }
    function showMainMoodEmoji(label, settings) {
        try {
            if (!settings.enableTypingPresence) return;
            const emoji = settings.moodEmoji && settings.moodEmoji[label];
            const bubble = mainBubbleEl();
            const my = ++mainBubbleSeq;
            if (!emoji || !positionMainBubble(bubble)) { bubble.style.display = 'none'; return; }
            bubble.textContent = emoji;
            bubble.classList.remove('scene-director-bubble-out');
            bubble.style.display = '';
            const ms = (Number(settings.bubbleSeconds) || 6) * 1000;
            sdTimeout(function () { if (my === mainBubbleSeq) bubble.classList.add('scene-director-bubble-out'); }, ms);
            sdTimeout(function () {
                if (my === mainBubbleSeq) { bubble.style.display = 'none'; bubble.classList.remove('scene-director-bubble-out'); }
            }, ms + 700);
        } catch (e) { /* ignore */ }
    }

    let genSafetyTimer = null;
    function onGenerationStart(type, params, dryRun) {
        try {
            // ST emits GENERATION_STARTED for dry runs (prompt assembly while
            // typing) with no matching END — gate on the dryRun argument.
            if (dryRun) return;
            generating = true;
            lastActivityTs = Date.now();
            if (genSafetyTimer) clearTimeout(genSafetyTimer);
            genSafetyTimer = setTimeout(onGenerationEnd, 90000); // never stuck
            const settings = getSettings();
            if (!settings.enableTypingPresence) return;
            document.body.classList.add('scene-director-typing');
            const bubble = mainBubbleEl();
            mainBubbleSeq++;
            if (!positionMainBubble(bubble)) return;
            bubble.innerHTML = '<span class="scene-director-dots"><i></i><i></i><i></i></span>';
            bubble.classList.remove('scene-director-bubble-out');
            bubble.style.display = '';
        } catch (e) {
            console.error(`${LOG} typing presence failed`, e);
        }
    }

    function onGenerationEnd() {
        try {
            generating = false;
            lastActivityTs = Date.now();
            if (genSafetyTimer) { clearTimeout(genSafetyTimer); genSafetyTimer = null; }
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
        // v0.5.3: from the server's sprite list (no 404 probes).
        const cacheKey = folder + '|' + ext;
        if (!neutralVariantCache[cacheKey]) {
            const apiName = decodeURIComponent(folder.replace(/^\/characters\//, '').replace(/\/$/, ''));
            neutralVariantCache[cacheKey] = spriteList(apiName).then(function (list) {
                return list.filter(function (x) { return x.label === 'neutral'; })
                    .map(function (x) { return x.path.split('?')[0]; });
            });
        }
        return neutralVariantCache[cacheKey];
    }

    // v0.5.4: while idle > 2 min, every ~90s the last mood emoji drifts up
    // from the head and fades (transform/opacity only); chips with a mood too.
    let lastDriftTs = 0;
    function driftEmoji(rect, emoji) {
        try {
            if (!emoji || !rect || !rect.width) return;
            const d = document.createElement('div');
            d.className = 'scene-director-drift';
            d.textContent = emoji;
            d.style.left = (rect.left + rect.width * 0.5) + 'px';
            d.style.top = (rect.top + rect.height * 0.05) + 'px';
            document.body.appendChild(d);
            sdTimeout(function () { try { d.remove(); } catch (e) { /* ignore */ } }, 4200);
        } catch (e) { /* ignore */ }
    }
    function idleDriftTick(settings) {
        try {
            if (!settings.enableTypingPresence || generating || document.hidden) return;
            const now = Date.now();
            if (now - lastActivityTs < 120000 || now - lastDriftTs < 90000) return;
            lastDriftTs = now;
            const img = currentSpriteImg();
            if (img && img.getAttribute('src') && lastMoodLabel) {
                driftEmoji(img.getBoundingClientRect(), settings.moodEmoji && settings.moodEmoji[lastMoodLabel]);
            }
            for (const [, chip] of castChips) {
                if (chip.mood && chip.mood !== 'neutral' && chip.el.isConnected) {
                    driftEmoji(chip.el.getBoundingClientRect(), (settings.moodEmoji && settings.moodEmoji[chip.mood]) || MOOD_EMOJI[chip.mood]);
                }
            }
        } catch (e) { /* ignore */ }
    }

    async function idleTick() {
        try {
            const settings = getSettings();
            idleDriftTick(settings);
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
            const curPath = (img.getAttribute('src') || '').split('?')[0];
            const others = variants.filter(function (u) { return u !== curPath && !img.src.endsWith(u); });
            if (!others.length) return;
            if (generating || Date.now() - lastActivityTs < (Number(settings.idleAfterSeconds) || 90) * 1000) return;
            const cur = currentSpriteImg();
            if (!cur || !NEUTRAL_FILE_RE.test((cur.src.split('/').pop() || '').toLowerCase())) return;
            // 0.5.5: preload the incoming file before swapping.
            const next = others[Math.floor(Math.random() * others.length)];
            const ok = await verifyImageUrl(next);
            if (!ok || generating) return;
            lastIdleSwapTs = Date.now();
            cur.src = next;
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

    // 0.6.1: prefetch through a small queue (concurrency 2, ~150 ms spacing,
    // one retry after 5 s; 502/503 are transient and silent) — a burst on
    // chat load can overwhelm a reverse proxy in front of ST. Order: the
    // current place's slots, then the day trail's places by recency, then
    // the rest. Starts only after the first real background has applied.
    const prefetchDone = new Set();
    let prefetchRunning = false;
    function placeFiles(place) {
        const slots = place.slots || {};
        return ['day', 'night', 'dusk', 'rain', 'seasonal'].map(function (k) { return slots[k]; }).filter(Boolean);
    }
    function prefetchOrder(settings) {
        const ordered = [];
        const push = function (f) { if (f && !ordered.includes(f)) ordered.push(f); };
        const placeFor = function (loc) {
            for (const p of settings.places) { const re = compileRegex(p.pattern); if (re && re.test(loc)) return p; }
            return null;
        };
        if (lastParsedLoc) { const p = placeFor(lastParsedLoc); if (p) placeFiles(p).forEach(push); }
        for (const loc of trailLocs.slice().reverse()) { const p = placeFor(loc); if (p) placeFiles(p).forEach(push); }
        for (const p of settings.places) placeFiles(p).forEach(push);
        for (const e of settings.backgroundMap) push(e.background);
        for (const sw of settings.seasonalMap) push(sw.to);
        for (const r of settings.eraRules) push(r.to);
        return ordered.filter(function (f) { return !prefetchDone.has(f); });
    }
    async function prefetchOne(file, attempt) {
        const url = 'backgrounds/' + encodeURIComponent(file);
        try {
            const r = await fetch(url, { credentials: 'same-origin' });
            if (r.ok) { prefetchDone.add(file); return; }
            if ((r.status === 502 || r.status === 503) && !attempt) {
                await new Promise(function (res) { sdTimeout(res, 5000); });
                return prefetchOne(file, 1);
            }
            dbg('prefetch ' + file + ' -> HTTP ' + r.status);
        } catch (e) {
            if (!attempt) { await new Promise(function (res) { sdTimeout(res, 5000); }); return prefetchOne(file, 1); }
            dbg('prefetch ' + file + ' failed');
        }
    }
    async function runPrefetchQueue(settings) {
        if (prefetchRunning) return;
        prefetchRunning = true;
        try {
            const files = prefetchOrder(settings);
            let i = 0;
            const worker = async function () {
                while (i < files.length) {
                    await prefetchOne(files[i++], 0);
                    await new Promise(function (res) { sdTimeout(res, 150); });
                }
            };
            await Promise.all([worker(), worker()]); // concurrency 2
            dbg('prefetched ' + prefetchDone.size + ' backgrounds');
        } finally { prefetchRunning = false; }
    }
    function schedulePreload(settings) {
        try {
            if (!settings.enablePreload || !lastBg || mapPreloaded) return;
            if (connectionIsSlow()) return;
            mapPreloaded = true;
            const run = function () {
                runPrefetchQueue(settings);
                try {
                    const img = currentSpriteImg();
                    if (img && img.src) { const { folder, ext } = spriteFolderAndExt(img.src); getNeutralVariants(folder, ext); }
                } catch (e) { /* ignore */ }
            };
            if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 10000 });
            else sdTimeout(run, 5000);
        } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // Cast strip — DIFFED chips (add/remove/update by key), all DOM writes
    // batched in the shared rAF flush (audit item 3).
    // ------------------------------------------------------------------

    // key -> { el, imgEl, bubbleEl, labelEl, mood, speaking, src }
    const castChips = new Map();

    // ------------------------------------------------------------------
    // v0.5.3 thought tooltips — hover the sprite or a chip: bio line, mood
    // emoji, and the last 1–2 sentences about the character's inner state
    // (regex over the last AI message + its reasoning; cached per message).
    // ------------------------------------------------------------------

    const SENTENCE_RE = /[^.!?\n]+[.!?]?/g;
    const PRONOUN_RE = /^\s*(?:she|her|he|his|him|they|their)\b/i;
    const thoughtCache = { key: null, map: new Map() };

    function thoughtsFor(key, nameRe, aliasRe, settings) {
        try {
            const ctx = SillyTavern.getContext();
            const chat = ctx.chat || [];
            let last = null; let idx = -1;
            for (let i = chat.length - 1; i >= 0; i--) {
                const m = chat[i];
                if (m && !m.is_user && !m.is_system && m.mes) { last = m; idx = i; break; }
            }
            if (!last) return '';
            const ck = idx + ':' + (last.mes || '').length + ':' + (last.swipe_id || 0);
            if (thoughtCache.key !== ck) { thoughtCache.key = ck; thoughtCache.map.clear(); }
            if (thoughtCache.map.has(key)) return thoughtCache.map.get(key);
            const interRe = compileRegex(settings.interiorityRegex ? '\\b(?:' + settings.interiorityRegex + ')\\b' : '');
            let raw = last.mes || '';
            const reasoning = last.extra && last.extra.reasoning;
            if (reasoning) raw = String(reasoning) + '\n' + raw;
            raw = raw.replace(/<[^>]+>/g, '');
            const text = raw.length > MAX_SCAN ? raw.slice(0, MAX_SCAN) : raw;
            const hits = [];
            let prevAbout = false;
            SENTENCE_RE.lastIndex = 0;
            let m;
            while ((m = SENTENCE_RE.exec(text)) !== null) {
                const sent = m[0].trim();
                if (!sent) continue;
                let about = (nameRe && nameRe.test(sent)) || (aliasRe && aliasRe.test(sent));
                if (!about && prevAbout && PRONOUN_RE.test(sent)) about = true;
                prevAbout = Boolean(nameRe && nameRe.test(sent));
                if (about && interRe && interRe.test(sent)) hits.push(sent);
            }
            let out = hits.slice(-2).join(' ');
            if (out.length > 220) out = out.slice(0, 217).replace(/\s+\S*$/, '') + '…';
            thoughtCache.map.set(key, out);
            return out;
        } catch (e) { return ''; }
    }

    let tipTimer = null;
    function tooltipEl() {
        let tip = document.getElementById('scene-director-thought-tip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'scene-director-thought-tip';
            document.body.appendChild(tip);
        }
        return tip;
    }
    function showThoughtTip(anchorEl, opts) {
        try {
            const settings = getSettings();
            if (!settings.enableThoughtTips) return;
            const tip = tooltipEl();
            tip.innerHTML = '';
            const head = el('div', 'sd-tip-head', opts.label + (opts.emoji ? ' ' + opts.emoji : ''));
            tip.appendChild(head);
            const bioEl = el('div', 'sd-tip-bio', '');
            tip.appendChild(bioEl);
            if (opts.extra) tip.appendChild(el('div', 'sd-tip-extra', opts.extra));
            const t = thoughtsFor(opts.key, opts.nameRe, opts.aliasRe, settings);
            tip.appendChild(el('div', 'sd-tip-body', t || '(nothing written about their inner state in the last reply)'));
            if (opts.bio) {
                opts.bio.then(function (line) { if (line && tip.contains(bioEl)) bioEl.textContent = String(line); })
                    .catch(function () { /* ignore */ });
            }
            const r = anchorEl.getBoundingClientRect();
            tip.style.display = 'block';
            tip.style.opacity = '0';
            const w = tip.offsetWidth; const h = tip.offsetHeight;
            let left = r.left + r.width / 2 - w / 2;
            left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
            let top = r.top - h - 10;
            if (top < 8) top = Math.min(window.innerHeight - h - 8, r.bottom + 10);
            tip.style.left = left + 'px';
            tip.style.top = top + 'px';
            requestAnimationFrame(function () { tip.style.opacity = '1'; });
        } catch (e) { /* ignore */ }
    }
    function hideThoughtTip() {
        try {
            const tip = document.getElementById('scene-director-thought-tip');
            if (!tip) return;
            tip.style.opacity = '0';
            if (tipTimer) clearTimeout(tipTimer);
            tipTimer = setTimeout(function () { tip.style.display = 'none'; }, 250);
        } catch (e) { /* ignore */ }
    }
    let spriteHoverWired = false;
    function setupSpriteHover() {
        if (spriteHoverWired) return;
        const holder = document.getElementById('expression-holder');
        if (!holder) return;
        spriteHoverWired = true;
        holder.addEventListener('mouseenter', function () {
            const settings = getSettings();
            const img = currentSpriteImg();
            if (!img || !img.getAttribute('src')) return;
            const ctx = SillyTavern.getContext();
            const name = ctx.name2 || 'Character';
            const nameRe = compileRegex('\\b' + name.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&') + '\\b');
            showThoughtTip(img, {
                key: 'main:' + name, label: name, nameRe, aliasRe: null,
                emoji: (settings.moodEmoji && settings.moodEmoji[lastMoodLabel]) || '',
                extra: lastMoodLabel ? 'mood: ' + lastMoodLabel : null, bio: null,
            });
        });
        holder.addEventListener('mouseleave', hideThoughtTip);
    }

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
            let maxVh = Math.max(10, Math.min(40, Number(settings.chipSize) || 28));
            if (settings.chipSizeAuto) {
                // 0.6.2: 45% of the rendered sprite height (28vh fallback).
                const hs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scene-director-sprite-h')) || 0;
                maxVh = hs > 0 ? Math.max(10, Math.min(40, (hs * 0.45) / vh)) : 28;
            }
            el.dataset.chipStyle = settings.chipStyle || 'fade';
            el.style.setProperty('--scene-director-chip-max', maxVh + 'vh');
            if (isTop) {
                // 0.5.2: a fixed box filling the gutter between #sheld and the
                // viewport edge (2000px window, 1000px centred chat -> right
                // side x in [1512, 2000]); chips are max-width:100% /
                // height:auto inside it, so they can never cover the chat.
                // Gutter < 110px -> compact 48px circles instead.
                const sheld = document.getElementById('sheld');
                const r = sheld ? sheld.getBoundingClientRect() : null;
                let left; let right;
                if (r && r.width > 0) {
                    left = onRight ? Math.round(r.right + 12) : 0;
                    right = onRight ? 0 : Math.max(0, Math.round(window.innerWidth - r.left + 12));
                } else {
                    left = onRight ? Math.round(window.innerWidth * 0.75) : 0;
                    right = onRight ? 0 : Math.round(window.innerWidth * 0.75);
                }
                const gutter = window.innerWidth - left - right;
                const compact = gutter < 110;
                el.dataset.compact = compact ? '1' : '0';
                let topPx = 44;
                if (hudSameCorner) {
                    const hud = document.getElementById('scene-director-hud');
                    const hr = hud && hud.style.display !== 'none' ? hud.getBoundingClientRect() : null;
                    topPx = hr && hr.height ? Math.round(hr.bottom + 8) : 56;
                }
                el.style.top = topPx + 'px';
                el.style.bottom = 'auto';
                el.style.left = compact ? (onRight ? 'auto' : '12px') : left + 'px';
                el.style.right = compact ? (onRight ? '12px' : 'auto') : right + 'px';
                el.style.width = compact ? 'auto' : Math.max(0, gutter) + 'px';
                el.style.maxWidth = '';
                el.style.padding = compact ? '0' : '0 12px';
                el.style.boxSizing = 'border-box';
                el.style.flexDirection = 'column';
                el.style.alignItems = onRight ? 'flex-end' : 'flex-start';
                el.style.flexWrap = 'nowrap';
                el.style.maxHeight = (window.innerHeight - topPx - 90) + 'px';
                el.style.overflow = 'hidden';
                if (!compact && castChips.size > 1) {
                    const avail = window.innerHeight - topPx - 90;
                    const per = avail / castChips.size - 26;
                    const capVh = Math.max(8, Math.min(maxVh, per / vh));
                    el.style.setProperty('--scene-director-chip-max', capVh.toFixed(1) + 'vh');
                }
            } else {
                el.dataset.compact = '0';
                el.style.top = 'auto';
                el.style.bottom = '12px';
                el.style.left = onRight ? 'auto' : '12px';
                el.style.right = onRight ? '12px' : 'auto';
                el.style.width = 'auto';
                el.style.padding = '0';
                el.style.maxWidth = 'min(70vw, 640px)';
                el.style.maxHeight = '';
                el.style.overflow = '';
                el.style.flexDirection = 'row';
                el.style.alignItems = 'flex-end';
                el.style.flexWrap = 'wrap';
            }
        } catch (e) { /* ignore */ }
    }

    // Keep the strip inside the gutter as the chat panel moves/resizes.
    let stripResizeObserver = null;
    function setupStripResizeObserver() {
        try {
            if (stripResizeObserver || typeof ResizeObserver !== 'function') return;
            const sheld = document.getElementById('sheld');
            if (!sheld) return;
            const rerun = function () { queueDom(function () { const st = getSettings(); applySpriteSize(st); applyStripAppearance(st); }); };
            stripResizeObserver = new ResizeObserver(rerun);
            stripResizeObserver.observe(sheld);
            window.addEventListener('resize', rerun);
            // The chat-width slider / movable panels move #sheld too.
            try {
                const ctx = SillyTavern.getContext();
                const et = ctx.eventTypes || ctx.event_types || {};
                for (const k of ['MOVABLE_PANELS_RESET', 'SETTINGS_UPDATED', 'SETTINGS_LOADED_AFTER']) {
                    if (et[k]) ctx.eventSource.on(et[k], function () { sdTimeout(rerun, 50); });
                }
            } catch (e) { /* ignore */ }
        } catch (e) { /* ignore */ }
    }

    // v0.6.2: one fixed rendered height for the expression sprite so a
    // low-res animated webp and a high-res static PNG are identical on
    // screen. ST's rule (expressions/style.css) is intrinsic-size driven,
    // capped at max-height 90vh / max-width 90vh / holder width
    // (100vw - sheldWidth)/2. Default = ST's static size: min(90vh, gutter /
    // aspect), aspect measured from the current image (0.8 fallback).
    let spriteRefAspect = 0.8;
    function applySpriteSize(settings) {
        try {
            const vh = window.innerHeight / 100;
            const sheld = document.getElementById('sheld');
            const r = sheld ? sheld.getBoundingClientRect() : null;
            const gutter = r && r.width > 0 ? Math.max(120, r.left - 8) : window.innerWidth * 0.25;
            const img = currentSpriteImg();
            let aspect = spriteRefAspect;
            if (img && img.naturalWidth && img.naturalHeight) {
                aspect = img.naturalWidth / img.naturalHeight;
                if (Math.abs(aspect - 1) > 0.05) spriteRefAspect = aspect; // remember a non-square (static) aspect
            }
            const defaultVh = Math.min(90, (gutter / spriteRefAspect) / vh);
            let targetVh = (settings.spriteAuto || !settings.spriteVh) ? defaultVh : Number(settings.spriteVh);
            targetVh = Math.max(30, Math.min(100, targetVh));
            let hPx = targetVh * vh;
            if (hPx * aspect > gutter) hPx = gutter / aspect; // never over the chat
            hPx = Math.min(hPx, window.innerHeight - 8);
            const root = document.documentElement.style;
            root.setProperty('--scene-director-sprite-h', Math.round(hPx) + 'px');
            root.setProperty('--scene-director-sprite-dx', (Number(settings.spriteDx) || 0) + 'vw');
            root.setProperty('--scene-director-sprite-dy', (Number(settings.spriteDy) || 0) + 'vh');
            const lab = document.getElementById('sd_spriteVhVal');
            if (lab) lab.textContent = Math.round(hPx / vh) + 'vh' + (settings.spriteAuto ? ' (auto = ' + defaultVh.toFixed(0) + 'vh)' : '');
        } catch (e) { /* ignore */ }
    }

    function applyHudAppearance(settings) {
        try {
            const hud = document.getElementById('scene-director-hud');
            if (!hud) return;
            const pos = settings.hudPosition || 'top-right';
            hud.dataset.side = pos.endsWith('left') ? 'left' : 'right';
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
    const GLASS_CSS = `body.scene-director-chat-glass #chat {
    background-color: rgba(var(--scene-director-chat-tint-rgb, 0, 0, 0),
        var(--scene-director-chat-alpha, 0.55)) !important;
}
body.scene-director-chat-glass.scene-director-chat-noblur #chat {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
}`;
    function applyChatGlass(settings) {
        try {
            const on = Boolean(settings.enableChatGlass);
            document.body.classList.toggle('scene-director-chat-glass', on);
            document.body.classList.toggle('scene-director-chat-noblur', on && !settings.chatBlur);
            let st = document.getElementById('scene-director-glass-style');
            if (!on) {
                if (st) st.remove(); // off = no chat rule injected at all
                return;
            }
            if (!st) {
                st = document.createElement('style');
                st.id = 'scene-director-glass-style';
                st.textContent = GLASS_CSS;
                document.head.appendChild(st);
            }
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
            + (lingering ? ' lingering' : '') + (member.unknown ? ' unknown' : '');
        wrap.dataset.key = member.key;
        const baseSrc = member.unknown ? silhouetteSrc(member.unknown.hex, member.unknown.gender)
            : chipImageSrc(member, 'neutral', settings);
        const img = document.createElement('img');
        img.alt = member.label;
        if (member.unknown) {
            img.src = baseSrc;
        } else if (mood !== 'neutral') {
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
            bubbleEl.textContent = (settings.moodEmoji && settings.moodEmoji[mood]) || MOOD_EMOJI[mood];
            wrap.appendChild(bubbleEl);
            // 0.5.2: linger, then fade (opacity-only, tracked timeouts).
            const ms = (Number(settings.bubbleSeconds) || 6) * 1000;
            const b = bubbleEl;
            sdTimeout(function () { b.classList.add('scene-director-bubble-out'); }, ms);
            sdTimeout(function () { try { b.remove(); } catch (e) { /* ignore */ } }, ms + 700);
        }
        const label = document.createElement('div');
        label.className = 'scene-director-chip-label';
        label.textContent = member.label;
        wrap.appendChild(img);
        wrap.appendChild(label);
        if (settings.enableThoughtTips) {
            wrap.addEventListener('mouseenter', function () {
                showThoughtTip(wrap, {
                    key: member.key, label: member.label,
                    nameRe: compileRegex(member.nameRegex || ''), aliasRe: compileRegex(member.aliasRegex || ''),
                    emoji: mood !== 'neutral' ? ((settings.moodEmoji && settings.moodEmoji[mood]) || MOOD_EMOJI[mood]) : '',
                    extra: null, bio: settings.enableBioCards ? bioLineFor(member, settings) : null,
                });
            });
            wrap.addEventListener('mouseleave', hideThoughtTip);
        } else if (settings.enableBioCards) {
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
        const locChanged = Boolean(scene.location && presenceLoc && scene.location !== presenceLoc);
        if (locChanged) {
            for (const [k] of castPresence) dbg(`cast -${k} (location change)`);
            castPresence.clear(); // hard reset — no grace across a move
        }
        if (scene.location) presenceLoc = scene.location;
        const analysis = analyzeCast(scene, settings, locChanged);
        const present = analysis.present;
        let speakerKey = analysis.speakerKey;
        if (settings.enableUnknownSpeakers) {
            let speakerPos = -1;
            for (const p of present) if (p.pos > speakerPos) speakerPos = p.pos;
            for (const u of detectUnknownSpeakers(scene, settings)) {
                if (u.pos > speakerPos) { speakerPos = u.pos; speakerKey = u.key; }
                if (!castPresence.has(u.key)) dbg(`cast +${u.key} "${u.label}" (${u.gender}, hex ${u.hex})`);
                present.push({ member: { key: u.key, label: u.label, colorHex: u.hex, nameRegex: null, aliasRegex: null, unknown: { hex: u.hex, gender: u.gender } }, pos: u.pos, strong: true });
            }
        }
        // Presence hysteresis: seen now -> miss 0; previously established
        // here but silent -> miss+1, chip lingers (dimmed) until the limit.
        // Grace only for members whose last evidence was decisive (own line).
        const nowKeys = new Set(present.map(function (p) { return p.member.key; }));
        for (const p of present) castPresence.set(p.member.key, { miss: 0, strong: Boolean(p.strong || p.member.unknown) });
        const lingering = [];
        for (const [k, st] of castPresence) {
            if (nowKeys.has(k)) continue;
            const cur = (typeof st === 'object' && st) ? st : { miss: st, strong: true };
            const next = cur.miss + 1;
            if (!cur.strong || next >= PRESENCE_MISS_LIMIT) {
                dbg(`cast -${k} (${cur.strong ? 'absent ' + next + ' messages' : 'no grace: last evidence was not decisive'})`);
                castPresence.delete(k);
                continue;
            }
            castPresence.set(k, { miss: next, strong: cur.strong });
            let member = settings.cast.find(function (m) { return m.key === k; });
            if (!member && unknownInfo.has(k)) {
                const u = unknownInfo.get(k);
                member = { key: k, label: u.label, colorHex: u.hex, nameRegex: null, aliasRegex: null, unknown: { hex: u.hex, gender: u.gender } };
            }
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
                mood: (!p.lingering && !p.member.unknown && settings.enableMoods) ? detectMood(scene.text, p.member, settings) : 'neutral',
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
                    fresh.moodTs = Date.now();
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
        if (settings.enableMoods) {
            for (const p of ordered) {
                if (!p.lingering && !p.member.unknown && p.member.moodVariants) refineNpcMood(scene.text, p.member, settings);
            }
        }
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
            // Verified in public/scripts/openai.js populationInjectionPrompts():
            // depth 0 = a system message spliced ABSOLUTELY LAST (after the
            // user's message) for chat completion; text completion places
            // it the same way via getExtensionPrompt(IN_CHAT, 0).
            ctx.setExtensionPrompt(MOOD_INJECT_KEY,
                settings.enableMoodTag ? MOOD_PROMPT_SNIPPET : '',
                1 /* IN_CHAT */, 0 /* depth: absolutely last */, false /* scan */, 0 /* SYSTEM */);
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
    let hydrateUntil = 0; // re-asserts inside the load window are debug-level
    function spriteIsBlank() {
        const img = currentSpriteImg();
        return !img || !img.getAttribute('src');
    }
    // v0.5.3: sprite folder listings via /api/sprites/get, cached per folder.
    const spriteListCache = new Map();
    function spriteList(folder) {
        if (!folder) return Promise.resolve([]);
        let pr = spriteListCache.get(folder);
        if (!pr) {
            pr = fetch('/api/sprites/get?name=' + encodeURIComponent(folder))
                .then(function (r) { return r.ok ? r.json() : []; })
                .catch(function () { return []; });
            spriteListCache.set(folder, pr);
        }
        return pr;
    }
    function activeSpriteFolder(ctx) {
        try {
            const ch = (ctx.characters || [])[ctx.characterId];
            const ov = ((ctx.extensionSettings || {}).expressionOverrides || [])
                .find(function (o) { return ch && o.name === ch.avatar; });
            return ov ? ov.path : (ctx.name2 || null);
        } catch (e) { return null; }
    }
    // With the classifier set to None, ST resolves its '' path to
    // fallback_expression; keeping that equal to the mood on screen makes the
    // path pick the same file (setExpression skips an identical src) — no
    // flicker while streaming. Only touched when the user already runs the
    // None classifier (api 99) with a fallback set; never otherwise.
    async function syncFallback(ctx, label) {
        try {
            const es = ctx.extensionSettings && ctx.extensionSettings.expressions;
            if (!es || es.api !== 99 || !es.fallback_expression) return;
            const list = await spriteList(activeSpriteFolder(ctx));
            const has = list.some(function (x) { return x.label === label; });
            const want = has ? label : 'neutral';
            if (es.fallback_expression !== want) { es.fallback_expression = want; saveSettings(); }
        } catch (e) { /* ignore */ }
    }

    async function assertExpression(ctx, label) {
        if (!label) return;
        const my = ++assertSeq;
        lastMoodLabel = label;
        syncFallback(ctx, label);
        try { await runCommand(ctx, `/emote ${label}`); } catch (e) { /* retried below */ }
        let tries = 0;
        const check = async function () {
            if (my !== assertSeq) return;
            if (spriteIsBlank() && tries < 4) {
                tries++;
                // The label may not exist in the active costume folder —
                // after two misses fall back to neutral.
                const use = tries >= 3 ? 'neutral' : label;
                try { await runCommand(ctx, `/emote ${use}`); } catch (e) { /* ignore */ }
                if (Date.now() < hydrateUntil) {
                    dbg(`initial hydrate: sprite not drawn yet -> /emote ${use} (${tries})`);
                } else {
                    dbg(`sprite was blank -> re-asserted /emote ${use} (${tries})`);
                    spriteDebug(ctx, use);
                }
            }
            if (tries < 4) sdTimeout(check, 1500);
        };
        sdTimeout(check, 1200);
    }

    /** 0.5.2 diagnostics printed when a re-assert was needed. */
    async function spriteDebug(ctx, label) {
        try {
            const img = currentSpriteImg();
            let folder = null;
            try {
                const ch = (ctx.characters || [])[ctx.characterId];
                const ov = ((ctx.extensionSettings || {}).expressionOverrides || [])
                    .find(function (o) { return ch && o.name === ch.avatar; });
                folder = ov ? ov.path : (ctx.name2 || null);
            } catch (e) { /* ignore */ }
            let count = 'n/a';
            let hasLabel = 'n/a';
            if (folder) {
                const r = await fetch('/api/sprites/get?name=' + encodeURIComponent(folder));
                const list = r.ok ? await r.json() : [];
                count = list.length;
                hasLabel = list.some(function (x) { return x.label === label; });
            }
            const holder = document.getElementById('expression-holder');
            dbg(`sprite-debug`, {
                img: img ? ('#' + (img.id || '?') + '.' + (img.className || '')) : '(no img)',
                src: img ? img.getAttribute('src') : null,
                holderDisplay: holder ? getComputedStyle(holder).display : null,
                overrideFolder: folder, spritesListed: count, folderHasLabel: hasLabel, wanted: label,
                fallback: (ctx.extensionSettings.expressions || {}).fallback_expression,
                api: (ctx.extensionSettings.expressions || {}).api,
            });
        } catch (e) { dbg(`sprite-debug failed`, e); }
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
        if (delayMs) hydrateUntil = Date.now() + delayMs + 8000;
        sdTimeout(function () { assertExpression(ctx, label); }, delayMs || 0);
    }

    /** Label of the sprite on screen (ST's data-expression, else filename). */
    function displayedLabel() {
        try {
            const img = currentSpriteImg();
            if (!img || !img.getAttribute('src')) return null;
            const de = img.getAttribute('data-expression');
            if (de) return de.toLowerCase();
            const file = decodeURIComponent((img.getAttribute('src') || '').split('/').pop().split('?')[0]).toLowerCase();
            return file.replace(/\.[^.]+$/, '').replace(/[-.].*$/, '') || null;
        } catch (e) { return null; }
    }

    // ------------------------------------------------------------------
    // v0.6.0 layered mood verdict — see MoodEngine for the pure rules.
    // ------------------------------------------------------------------
    const moodState = { lastEmitTs: 0, pending: null, lastVerdict: '', classifier: 'unknown', classifierRetryTs: 0 };

    /** The main character's dialogue colour: setting, else the most
     *  frequent <font color> among recent AI messages that is on no Cast card. */
    let autoOwnHex = null;
    function ownColorHex(ctx, settings) {
        if (settings.ownColorHex) return String(settings.ownColorHex).toLowerCase();
        if (autoOwnHex) return autoOwnHex;
        try {
            const known = new Set(settings.cast.map(function (m) { return (m.colorHex || '').toLowerCase(); }));
            const counts = new Map();
            const chat = ctx.chat || [];
            let seen = 0;
            for (let i = chat.length - 1; i >= 0 && seen < 12; i--) {
                const m = chat[i];
                if (!m || m.is_user || m.is_system || !m.mes) continue;
                seen++;
                FONT_SPAN_RE.lastIndex = 0;
                let x;
                while ((x = FONT_SPAN_RE.exec(m.mes)) !== null) {
                    const h = x[1].toLowerCase();
                    if (known.has(h)) continue;
                    counts.set(h, (counts.get(h) || 0) + 1);
                }
            }
            let best = null; let bestN = 0;
            for (const [h, n] of counts) if (n > bestN) { best = h; bestN = n; }
            autoOwnHex = best;
            if (best) dbg('own dialogue colour auto-detected: ' + best);
        } catch (e) { /* ignore */ }
        return autoOwnHex;
    }
    function ownNameRegex() {
        try {
            const name = SillyTavern.getContext().name2 || '';
            return name ? compileRegex('\\b' + name.split(' ')[0].replace(/[\\^$.*+?()[\]{}|]/g, '\\$&') + '\\b') : null;
        } catch (e) { return null; }
    }
    async function classifyLocal(text) {
        const settings = getSettings();
        if (!text || !settings.enableLocalClassifier) return null;
        if (moodState.classifier === 'unavailable' && Date.now() < moodState.classifierRetryTs) return null;
        try {
            const ctx = SillyTavern.getContext();
            const headers = ctx.getRequestHeaders ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };
            const r = await fetch('/api/extra/classify', { method: 'POST', headers, body: JSON.stringify({ text }) });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const data = await r.json();
            if (moodState.classifier !== 'ok') { moodState.classifier = 'ok'; updateMoodStatus(); }
            return Array.isArray(data.classification) ? data.classification : null;
        } catch (e) {
            moodState.classifier = 'unavailable';
            moodState.classifierRetryTs = Date.now() + 600000;
            dbg('local classifier unavailable: ' + (e && e.message));
            updateMoodStatus();
            return null;
        }
    }
    function updateMoodStatus() {
        try {
            const a2 = document.getElementById('sd_mood_status');
            if (a2) a2.textContent = moodState.lastVerdict ? ('Mood engine: ' + moodState.lastVerdict) : 'Mood engine: no verdict yet';
            const b2 = document.getElementById('sd_classifier_status');
            if (b2) b2.textContent = moodState.classifier === 'unavailable'
                ? 'Local classifier: unavailable — using tag+lexicon'
                : (moodState.classifier === 'ok' ? 'Local classifier: ok (go_emotions, server-side)' : 'Local classifier: not used yet');
        } catch (e) { /* ignore */ }
    }
    async function runMoodVerdict(ctx, last, settings) {
        try {
            if (!settings.enableMoodTag) return;
            const raw = last.mes || '';
            const tag = MoodEngine.detectTag(raw, last.extra && last.extra.reasoning);
            if (tag) stripMoodTagFromDom();
            const femaleRe = compileRegex(settings.femaleNamesRegex || '');
            const others = [];
            for (const m of settings.cast) {
                const r = compileRegex(m.nameRegex || ''); if (r) others.push(r);
                const a3 = compileRegex(m.aliasRegex || ''); if (a3) others.push(a3);
            }
            const ext = MoodEngine.extractOwn(raw, {
                hex: ownColorHex(ctx, settings), nameRe: ownNameRegex(), aliasRe: null,
                otherNameRes: others, soloFemale: !(femaleRe && femaleRe.test(raw)),
            });
            const lex = MoodEngine.lexicon(ext, moodLexiconCompiled(settings));
            const local = tag ? null : await classifyLocal(MoodEngine.classifierText(ext, 1500));
            const out = MoodEngine.verdict({ tag, local, lex, prev: lastMoodLabel });
            dbg(MoodEngine.describe(tag, local, lex, out) + ` [L0 ${ext.dialogue} dlg/${ext.narration} narr]`);
            moodState.lastVerdict = (out.final || 'hold') + ' — ' + out.rule;
            updateMoodStatus();
            if (!out.final || out.hold) return;
            const list = await spriteList(activeSpriteFolder(ctx));
            const avail = new Set(list.map(function (x) { return x.label; }));
            const mapped = MoodEngine.mapToAvailable(out.final, avail);
            emitMood(ctx, mapped, out.final, settings);
        } catch (e) {
            console.error(`${LOG} mood verdict failed`, e);
        }
    }
    /** Hysteresis: >= 8 s dwell (newer verdicts deferred), never re-emit. */
    function emitMood(ctx, label, verdictLabel, settings) {
        if (moodState.pending) { clearTimeout(moodState.pending); moodState.pending = null; }
        const go = async function () {
            moodState.pending = null;
            if (displayedLabel() === label) { lastMoodLabel = label; syncFallback(ctx, label); return; }
            moodState.lastEmitTs = Date.now();
            await assertExpression(ctx, label);
            sdTimeout(function () { showMainMoodEmoji(verdictLabel, settings); }, 300);
        };
        const wait = moodState.lastEmitTs ? Math.max(0, 8000 - (Date.now() - moodState.lastEmitTs)) : 0;
        if (wait > 0) moodState.pending = setTimeout(go, wait); else go();
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
            onGenerationEnd(); // a landed message always ends the typing state

            // ONE extraction + ONE header parse for the whole event (item 1).
            const scene = parseScene(last.mes, settings);

            // Inline Mood Tag: fire-and-forget (self-contained) so it never
            // delays the rest of the scene. Reads the RAW text — the tag
            // trails the message and must survive the MAX_SCAN cap.
            try { runMoodVerdict(ctx, last, settings); } catch (e) { /* ignore */ }

            try {
                updateCastStrip(scene, settings);
            } catch (e) {
                console.error(`${LOG} cast strip failed`, e);
            }
            updateSceneHud(scene, settings);

            if (settings.enableCrossfade) setupSpriteCrossfade();

            try { updateKenBurns(settings); } catch (e) { /* ignore */ }
            try { updatePhotoButton(settings); } catch (e) { /* ignore */ }
            // 0.6.2: sprite size first, then chip auto-size keyed off it.
            try { applySpriteSize(settings); } catch (e) { /* ignore */ }
            try { applyStripAppearance(settings); } catch (e) { /* ignore */ }
            try { setupSpriteHover(); } catch (e) { /* ignore */ }
            if (settings.enableEmotionAccents) {
                try { sdTimeout(function () { fireEmotionAccent(settings); }, 1500); } catch (e) { /* ignore */ }
            }
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
                            dbg(`"${location}" -> ${bg}`);
                        }
                    } else {
                        dbg(`no background mapping for location: ${location}`);
                    }
                } catch (e) {
                    console.error(`${LOG} background switch failed`, e);
                }
            }

            // 0.6.1: idle prefetch — only once a real background has applied.
            try { schedulePreload(settings); } catch (e) { /* ignore */ }

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
                        dbg(`costume: ${lastCostume || 'default'} -> ${desired || 'default'} (loc="${location}", hour=${scene.hour})`);
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
        try { onGenerationEnd(); } catch (e) { /* ignore */ }
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
                if (getSettings().enableIdlePresence || getSettings().enableTypingPresence) startIdleLoop();
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
            dbg(`Prome VN Extension detected — Weather & Lighting Overlay auto-disabled`);
        }
        if (result.weatherCycle) {
            dbg(`st-weather-cycle detected — Ken Burns Drift auto-disabled`);
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
                    dbg('backgrounds list fetch failed', e);
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

        const rowAlias = el('div', 'scene-director-card-row');
        const aliasIn = input('sd-card-regex', member.aliasRegex || '', 'kinship alias regex (optional, e.g. mum|mama)',
            'Aliases count only next to a presence cue, never alone');
        aliasIn.addEventListener('change', function () {
            const v = aliasIn.value.trim();
            if (v && !compileRegex(v)) { aliasIn.classList.add('sd-invalid'); return; }
            aliasIn.classList.remove('sd-invalid');
            member.aliasRegex = v;
            commitCards();
        });
        rowAlias.appendChild(aliasIn);
        main.appendChild(rowAlias);

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
        moodLexicon(value) {
            if (value === null) return null;
            if (!Array.isArray(value)) return 'must be null or a JSON array of [regex, label, weight, [vetoes]]';
            for (const [i, row] of value.entries()) {
                if (!Array.isArray(row) || typeof row[0] !== 'string' || !compileRegex(row[0])) return `row ${i}: invalid regex`;
                if (!MoodEngine.LABELS.includes(row[1])) return `row ${i}: unknown label "${row[1]}"`;
            }
            return null;
        },
        moodEmoji(value) {
            if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'must be a JSON object of label -> emoji';
            for (const k of Object.keys(value)) {
                if (typeof value[k] !== 'string') return `"${k}" must be a string`;
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
        ['enableUnknownSpeakers', 'Unknown Speakers', 'A tinted silhouette chip (male/female/neutral by nearby pronouns, best-guess name) for any dialogue colour not on a Cast card'],
        ['enableLocalClassifier', 'Local Classifier', 'Mood engine layer 2: SillyTavern\'s built-in server-side go_emotions classifier on the character\'s own text (no external API)'],
        ['enableDebug', 'Debug Logging', 'Print [scene-director] diagnostics (chip add/remove with evidence, sprite replays, injection) to the console; off = silent unless something fails'],
        ['enableThoughtTips', 'Thought Tooltips', 'Hover the sprite or a cast chip: bio line, mood emoji and the last sentences the model wrote about that character\'s inner state (regex over the last reply + its reasoning; no AI calls)'],
        ['enableMoodTag', 'Mood Engine', 'Layered verdict: [MOOD] tag → local classifier → lexicon with vetoes, on the character\'s own dialogue + narration; drives the sprite via /emote. Zero-setup: the [MOOD] instruction is auto-injected near the end of the context, and a trailing [MOOD: <label>] in the AI reply sets the expression sprite directly (/emote) — no classifier API call, no preset edit. The tag is hidden from the rendered message; no tag = the classifier works as usual.'],
    ];

    const REGEX_FIELDS = [
        ['locationRegex', 'Location regex', 'Capture group 1 = location text'],
        ['timeRegex', 'Time regex', 'Group 1 = hour, group 2 = minutes, optional group 3 = AM/PM (omit for 24h)'],
        ['dateRegex', 'Date regex', 'Group 1 = month name or number, group 2 = day, group 3 = year'],
        ['weatherRegex', 'Weather regex', 'Group 1 = weather text, matched against the header line (default: last |-separated segment)'],
        ['rainRegex', 'Rain regex', 'Matched against the lowercased weather text — triggers the rain tint and streaks'],
        ['fireRegex', 'Fire regex', 'Matched against the APPLIED background filename — triggers the fire flicker overlay'],
        ['presenceArrivalRegex', 'Arrival / position cues', 'Presence engine (+4): physical arrival or position verbs in NARRATION within ~40 chars of a name — blank = built-in list'],
        ['presenceActionRegex', 'Action cues', 'Presence engine (+2): physical action verbs in the narration sentence that names the character — blank = built-in'],
        ['presenceDepartRegex', 'Departure cues', 'Presence engine veto: leaves / walks out / hangs up… after the last arrival cue — blank = built-in'],
        ['presenceCueRegex', 'Presence cue regex (legacy)', 'Cast Strip: a name/alias counts as in-scene only with one of these within ~40 chars (arrival / speech / posture verbs)'],
        ['absenceContextRegex', 'Absence / reported-speech vetoes', 'Presence engine veto: a narration sentence naming the character that also contains any of these (ring, said, would say, remember, about…) — blank = built-in'],
        ['femaleNamesRegex', 'Other female names', 'Mood engine: she/her narration counts as the main character\'s only when none of these appear in the message (e.g. aunt|mary|nurse)'],
        ['ownColorHex', 'Own dialogue colour', 'The main character\'s dialogue colour hex (e.g. #E87BA8) — excluded from Unknown Speakers'],
        ['interiorityRegex', 'Interiority regex', 'Thought tooltips: sentences naming a character AND one of these verbs are shown on hover'],
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
        ['moodLexicon', 'Mood lexicon', '[[regex, label, weight, [vetoes]], ...] — leave null for the built-in ~110-cue table; Export shows the current one'],
        ['moodEmoji', 'Mood bubble emoji', '{"joy": "✨", "anger": "💢", "happy": "✨", "angry": "💢", "sad": "💧"} — label -> emoji shown in the thought bubble after a reply (NPC chips use happy/angry/sad)'],
        ['counters', 'Life counters', '[{"label": "married", "emoji": "💍", "date": "2026-07-11", "mode": "days"}] — computed from the parsed STORY date; "weeks" renders as 6w2d'],
    ];

    const PROMPT_SNIPPET = 'Begin every reply with a status line in this exact format:\n'
        + '[ 🕰️ <12h time> | ☀️ <Weekday, Month D, YYYY> | 📍 <current location> | 🌥️ <weather> ]';

    // Preset line for the Inline Mood Tag feature — lists all 28 labels the
    // expressions extension understands.
    const MOOD_PROMPT_SNIPPET = 'MANDATORY FORMAT: the final line of your reply must be exactly '
        + '[MOOD: label] — after everything else, including any <details> or planning block — '
        + 'where label is the single best fit for the character\'s current mood from: '
        + EXPRESSION_LABELS.join(', ') + '. No reply may end without this line.';

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

                    <div id="sd_mood_status" class="scene-director-help">Mood engine: no verdict yet</div>
                    <div id="sd_classifier_status" class="scene-director-help">Local classifier: not used yet</div>
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
                        <select id="sd_hudStyle" class="text_pole" style="width:auto;" title="HUD style">
                            <option value="stacked">Stacked</option>
                            <option value="line">Line</option>
                            <option value="minimal">Minimal (clock, hover expands)</option>
                            <option value="game">Game (accent bar + weather badge)</option>
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
                    <div class="scene-director-card-row" style="display:flex;gap:8px;align-items:center;">
                        <span style="font-size:12px;">HUD scale</span>
                        <input type="range" id="sd_hudScale" min="80" max="160" step="5" style="flex:1;" title="HUD scale" />
                        <span id="sd_hudScaleVal" style="font-size:12px;min-width:42px;"></span>
                        <span style="font-size:12px;">HUD opacity</span>
                        <input type="range" id="sd_hudOpacity" min="20" max="100" step="5" style="flex:1;" title="HUD card opacity" />
                        <span id="sd_hudOpacityVal" style="font-size:12px;min-width:42px;"></span>
                    </div>
                    <div class="scene-director-card-row" style="display:flex;gap:10px;flex-wrap:wrap;">
                        <label class="checkbox_label"><input type="checkbox" id="sd_hudDate" /><span>Date row</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="sd_hudLoc" /><span>Location row</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="sd_hudWeather" /><span>Weather row</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="sd_hudCounters" /><span>Counters row</span></label>
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
                    <label class="checkbox_label" title="Match SillyTavern's own size for the static sprites (min(90vh, gutter / aspect)); animated sprites get the same height">
                        <input type="checkbox" id="sd_spriteAuto" />
                        <span>Character auto size (match static)</span>
                    </label>
                    <div class="scene-director-card-row" style="display:flex;gap:8px;align-items:center;">
                        <span style="font-size:12px;">Character size</span>
                        <input type="range" id="sd_spriteVh" min="30" max="100" step="1" style="flex:1;" title="Character height, % of the window height" />
                        <span id="sd_spriteVhVal" style="font-size:12px;min-width:42px;"></span>
                    </div>
                    <div class="scene-director-card-row" style="display:flex;gap:8px;align-items:center;">
                        <span style="font-size:12px;">X offset</span>
                        <input type="range" id="sd_spriteDx" min="-20" max="20" step="1" style="flex:1;" title="Horizontal offset, % of the window width" />
                        <span id="sd_spriteDxVal" style="font-size:12px;min-width:42px;"></span>
                        <span style="font-size:12px;">Y offset</span>
                        <input type="range" id="sd_spriteDy" min="-10" max="10" step="1" style="flex:1;" title="Vertical offset, % of the window height" />
                        <span id="sd_spriteDyVal" style="font-size:12px;min-width:42px;"></span>
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
                    <small class="scene-director-help">Tip: for translucent chat use ST's User Settings → UI Theme → Blur Tint colour alpha — the glass above is only for when you want it independent of the theme.</small>

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
        if (settings.enableIdlePresence || settings.enableTypingPresence) startIdleLoop(); else stopIdleLoop();
        if (settings.enableTypingPresence || settings.enableIdlePresence) {
            ensureGenHooks(SillyTavern.getContext());
        }
        if (settings.enableCrossfade) setupSpriteCrossfade(); else teardownSpriteCrossfade();
        if (!weatherFxActive(settings)) updateWeatherOverlay(null, settings);
        applySpriteSize(settings);
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
            const raw = document.getElementById(`sd_${key}`).value.trim() || ((key === 'moodKeywords' || key === 'moodEmoji') ? '{}' : (key === 'moodLexicon' ? 'null' : '[]'));
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
            lines.push(`hud        : ${hudParts ? hudPartsLine(hudParts).join(' · ') : '(nothing parsed)'}`);
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
            onMessage(); // re-render the HUD with the new style/rows
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
        bindSelect('sd_hudStyle', 'hudStyle');
        for (const k of ['hudDate', 'hudLoc', 'hudWeather', 'hudCounters']) bindCheck('sd_' + k, k);
        for (const [id, key, dflt] of [['sd_hudScale', 'hudScale', 1], ['sd_hudOpacity', 'hudOpacity', 0.85]]) {
            const el2 = document.getElementById(id); const val = document.getElementById(id + 'Val');
            if (!el2) continue;
            el2.value = String(Math.round((Number(getSettings()[key]) || dflt) * 100));
            if (val) val.textContent = el2.value + '%';
            el2.addEventListener('input', function () {
                if (val) val.textContent = el2.value + '%';
                const st = getSettings(); st[key] = Number(el2.value) / 100;
                const hud = document.getElementById('scene-director-hud');
                if (hud) hud.style.setProperty(key === 'hudScale' ? '--sd-hud-scale' : '--sd-hud-alpha', String(st[key]));
                applyStripAppearance(st);
            });
            el2.addEventListener('change', stageChanged);
        }
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
        // 0.6.2 character size / offsets.
        const spAuto = bindCheck('sd_spriteAuto', 'spriteAuto');
        const spVh = document.getElementById('sd_spriteVh');
        if (spVh) {
            spVh.value = String(getSettings().spriteVh || 62);
            spVh.addEventListener('input', function () {
                const st = getSettings(); st.spriteVh = Number(spVh.value); st.spriteAuto = false;
                if (spAuto) spAuto.checked = false;
                applySpriteSize(st); applyStripAppearance(st);
            });
            spVh.addEventListener('change', stageChanged);
        }
        for (const [id, key, unit] of [['sd_spriteDx', 'spriteDx', 'vw'], ['sd_spriteDy', 'spriteDy', 'vh']]) {
            const el2 = document.getElementById(id); const val = document.getElementById(id + 'Val');
            if (!el2) continue;
            el2.value = String(getSettings()[key] || 0);
            if (val) val.textContent = el2.value + unit;
            el2.addEventListener('input', function () {
                if (val) val.textContent = el2.value + unit;
                const st = getSettings(); st[key] = Number(el2.value);
                applySpriteSize(st);
            });
            el2.addEventListener('change', stageChanged);
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
            console.error(`${LOG} extensions settings panel not found; settings UI skipped`);
            return;
        }
        const holder = document.createElement('div');
        holder.innerHTML = buildSettingsHtml();
        panel.appendChild(holder.firstElementChild);
        loadSettingsIntoForm();
        try {
            const content = document.querySelector('#scene_director_settings .inline-drawer-content');
            dbg(`settings drawer registered in #${panel.id}: ${content ? content.querySelectorAll('input, select, textarea').length : 0} controls`);
        } catch (e) { /* ignore */ }
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
            dbg('loaded (v0.6.4)');
            try { updateMoodStatus(); } catch (e) { /* ignore */ }
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
