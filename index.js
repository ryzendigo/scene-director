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

        // Header parsing (regex sources, compiled with the 'i' flag).
        locationRegex: '📍([^|\\]]+)',
        timeRegex: '🕰️?\\s*(\\d{1,2}):(\\d{2})\\s*(AM|PM)',
        dateRegex: '(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{1,2}),?\\s+(\\d{4})',

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

    /** Extract { month: 1-12, year } from a message, or null. */
    function extractDate(text, settings) {
        const re = compileRegex(settings.dateRegex);
        if (!re || !text) return null;
        const m = re.exec(text);
        if (!m) return null;
        const month = monthToNumber(m[1]);
        const year = parseInt(m[3], 10);
        if (!month || Number.isNaN(year)) return null;
        return { month, year };
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
        if (!settings.enableCast || !settings.castFolder || !text) return;
        const base = `/characters/${encodeURIComponent(settings.castFolder)}/npc/`;
        for (const member of detectCast(text, settings)) {
            const wrap = document.createElement('div');
            wrap.className = 'scene-director-chip';
            const img = document.createElement('img');
            img.src = base + encodeURIComponent(member.key) + '.png';
            img.alt = member.label;
            // Missing portrait => remove the whole chip, don't show a broken image.
            img.onerror = function () { try { wrap.remove(); } catch (e) { /* ignore */ } };
            const label = document.createElement('div');
            label.className = 'scene-director-chip-label';
            label.textContent = member.label;
            wrap.appendChild(img);
            wrap.appendChild(label);
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

            // Cast strip: runs on every AI message, before the header gate,
            // and is isolated so it can never break the other features.
            try {
                updateCastStrip(text, settings);
            } catch (e) {
                console.error(`${LOG} cast strip failed`, e);
            }

            // Everything below needs a location from the scene header.
            const location = extractLocation(text, settings);
            if (!location) return;

            // Parse failures just mean we skip time/date-driven features.
            let date = null;
            let hour = null;
            try {
                date = extractDate(text, settings);
                hour = extractHour(text, settings);
            } catch (e) {
                console.error(`${LOG} date/time parse failed`, e);
            }

            // --- Auto Backgrounds (+ era/seasonal variants) ---
            if (settings.enableBackgrounds) {
                try {
                    let bg = pickBackground(location, settings);
                    if (bg) {
                        bg = applyVariants(bg, location, date, settings);
                        if (bg !== lastBg) {
                            lastBg = bg;
                            await runCommand(ctx, `/bg ${bg}`);
                            console.log(`${LOG} "${location}" -> ${bg}`);
                        }
                    } else {
                        console.debug(`${LOG} no background mapping for location: ${location}`);
                    }
                } catch (e) {
                    console.error(`${LOG} background switch failed`, e);
                }
            }

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
        // background and costume, and clear the previous chat's cast strip.
        lastBg = null;
        lastCostume = null;
        try {
            getCastStripEl().innerHTML = '';
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
    };

    const TOGGLE_FIELDS = [
        ['enableBackgrounds', 'Auto Backgrounds', 'Switch the background with /bg when the scene header location matches the map'],
        ['enableSeasonal', 'Seasonal Swaps', 'Swap a mapped background for a seasonal variant in a given month'],
        ['enableEra', 'Era Swaps', 'Swap a mapped background once the story year passes a threshold'],
        ['enableCostumes', 'Auto Costumes', 'Switch sprite costumes with /costume based on location and time of day'],
        ['enableCast', 'Cast Strip', 'Show portrait chips for NPCs who speak in the latest AI message'],
    ];

    const REGEX_FIELDS = [
        ['locationRegex', 'Location regex', 'Capture group 1 = location text'],
        ['timeRegex', 'Time regex', 'Group 1 = hour, group 2 = minutes, optional group 3 = AM/PM (omit for 24h)'],
        ['dateRegex', 'Date regex', 'Group 1 = month name or number, group 2 = day, group 3 = year'],
    ];

    const JSON_FIELDS = [
        ['backgroundMap', 'Background map', '[{"pattern": "kitchen", "background": "kitchen.jpg"}] — first match wins, order specific before generic'],
        ['seasonalMap', 'Seasonal map', '[{"month": 12, "from": "living.jpg", "to": "living-christmas.jpg"}]'],
        ['eraRules', 'Era rules', '[{"minYear": 2027, "pattern": "build site", "from": "frame.jpg", "to": "finished.jpg"}]'],
        ['costumeRules', 'Costume rules', '[{"pattern": "bedroom", "fromHour": 20, "toHour": 7, "costume": "pajamas"}] — "" costume = default'],
        ['cast', 'Cast table', '[{"key": "granty", "label": "Granty", "colorHex": "#B0BEC5", "nameRegex": "granty"}]'],
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
                    <div class="scene-director-section">Maps &amp; rules (JSON)</div>
                    ${jsons}
                    <div class="scene-director-field">
                        <label for="sd_castFolder">Cast sprite folder</label>
                        <small>Character folder name: portraits load from /characters/&lt;folder&gt;/npc/&lt;key&gt;.png</small>
                        <input type="text" id="sd_castFolder" class="text_pole" spellcheck="false" />
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
        for (const [key] of JSON_FIELDS) {
            const el = document.getElementById(`sd_${key}`);
            if (el) el.value = JSON.stringify(s[key], null, 2);
        }
        const folder = document.getElementById('sd_castFolder');
        if (folder) folder.value = s.castFolder;
    }

    function setFieldError(key, message) {
        const el = document.getElementById(`sd_${key}_error`);
        if (el) el.textContent = message || '';
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

        // Everything validated: commit toggles, regexes, maps, folder.
        for (const [key] of TOGGLE_FIELDS) {
            s[key] = document.getElementById(`sd_${key}`).checked;
        }
        Object.assign(s, pending);
        s.castFolder = document.getElementById('sd_castFolder').value.trim();
        saveSettings();

        // Force a re-apply with the new config on the current chat.
        lastBg = null;
        lastCostume = null;
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
            const present = detectCast(text, settings);
            lines.push(`cast       : ${present.length ? present.map(m => m.label).join(', ') : '(none detected)'}`);
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
            getSettings(); // ensure defaults exist
            addSettingsUi();
            const et = ctx.eventTypes || ctx.event_types;
            ctx.eventSource.on(et.MESSAGE_RECEIVED, onMessage);
            ctx.eventSource.on(et.MESSAGE_SWIPED, onMessage);
            if (et.CHAT_CHANGED) ctx.eventSource.on(et.CHAT_CHANGED, onChatChanged);
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
