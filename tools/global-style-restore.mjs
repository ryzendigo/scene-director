// Anything written to document.documentElement.style or document.body.style is
// DOCUMENT-WIDE: it outlives the feature that set it, and there is no chat change or
// teardown that implicitly undoes it. Every such write needs a matching restore.
//
//   node tools/global-style-restore.mjs [path/to/index.js]
//
// The bug this exists for: driftAttach() set documentElement.style.overflow='hidden'
// so the Ken Burns transform could not scroll the page, and driftStop() cleared the
// background element's styles but never handed the document property back. Switching
// Ken Burns off left the whole page overflow:hidden for the rest of the session.
//
// CSS custom properties (--scene-director-*) are exempt: they are the extension's own
// namespace, they are read only by its own stylesheet, and leaving one set is inert.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../index.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');
const lines = src.split('\n');

// A write is `X.style.prop = ...` or `X.style.setProperty('prop', ...)` where X is
// documentElement or body, including via a local alias (`const root = document.documentElement.style`).
const aliases = new Set(['document.documentElement.style', 'document.body.style']);
// `const root = document.documentElement.style` — a STYLE alias, used as root.foo = v.
for (const m of src.matchAll(/(?:const|let)\s+([\w$]+)\s*=\s*document\.(?:documentElement|body)\.style\s*;/g)) {
    aliases.add(m[1]);
}
// `const html = document.documentElement` — an ELEMENT alias, used as html.style.foo = v.
// The first version of this tool missed exactly this shape, which is the one the real
// bug used, and reported "0 writes" on deliberately broken code.
for (const m of src.matchAll(/(?:const|let)\s+([\w$]+)\s*=\s*document\.(?:documentElement|body)\s*;/g)) {
    aliases.add(m[1] + '.style');
}

const writes = [];
lines.forEach((line, i) => {
    if (/^\s*\/\//.test(line)) return;
    for (const a of aliases) {
        const esc = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // `.style.foo = v` / `.setProperty('foo', v)` — capture the property name.
        for (const re of [new RegExp(esc + `\\.([\\w$]+)\\s*=[^=]`), new RegExp(esc + `\\.setProperty\\(\\s*['"\`]([^'"\`]+)`)]) {
            const m = re.exec(line);
            if (!m) continue;
            const prop = m[1];
            if (prop === 'setProperty' || prop === 'removeProperty') continue;
            if (prop.startsWith('--')) continue;   // the extension's own custom properties
            writes.push({ line: i + 1, prop, text: line.trim().slice(0, 90) });
        }
    }
});

// A property is restored if it is ALSO written an empty string somewhere, or
// removeProperty'd. That is deliberately loose — the point is to notice a take with
// no give-back at all, not to prove the restore runs on every path.
const restored = new Set();
for (const w of writes) {
    const esc = w.prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const a of aliases) {
        const ae = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`${ae}\\.${esc}\\s*=\\s*(?:''|"")|${ae}\\.removeProperty\\(\\s*['"\`]${esc}`);
        if (re.test(src)) { restored.add(w.prop); break; }
    }
}

const orphans = writes.filter((w) => !restored.has(w.prop));
if (orphans.length) {
    console.log(`document-wide style writes with no restore: ${orphans.length}`);
    for (const o of orphans) console.log(`  ${file.split('/').pop()}:${o.line}  ${o.prop}  ${o.text}`);
    console.log('\nWrite \'\' back (or removeProperty) when the feature that took it stops.');
    process.exit(1);
}
console.log(`every document-wide style write has a restore (${writes.length} write(s), ${restored.size} propert${restored.size === 1 ? 'y' : 'ies'})`);
