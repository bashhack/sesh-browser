// Lays the extension out for each browser, in dist/chrome and dist/firefox:
// the files in src, with that browser's manifest. Load either folder as
// an unpacked extension (Chrome) or a temporary add-on (Firefox).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

// fillInPage is browserpass's fill script and its fill, in one function,
// run in the page in one go: so nothing has to be left in the page
// between two injections, which Firefox doesn't keep. The script itself
// is as it was taken.
export function fillInPageSource() {
    const inject = readFileSync("src/inject/inject.js", "utf8");
    return `// Built by build.mjs from inject.js: don't edit; edit build.mjs.
export function fillInPage(request) {
    try {
${inject}
        return { fields: window.browserpass.fillLogin(request).filledFields };
    } catch (e) {
        return { fields: [], error: String((e && e.message) || e) };
    }
}
`;
}

// build lays out dist/chrome and dist/firefox.
export function build() {
    for (const browser of ["chrome", "firefox"]) {
        const out = `dist/${browser}`;
        rmSync(out, { recursive: true, force: true });
        mkdirSync(out, { recursive: true });
        cpSync("src", out, { recursive: true });
        cpSync(`manifests/${browser}.json`, `${out}/manifest.json`);
        writeFileSync(`${out}/inject/fill-in-page.js`, fillInPageSource());
    }
}

if (process.argv[1] && process.argv[1].endsWith("build.mjs")) {
    build();
    console.log("Built dist/chrome and dist/firefox.");
}
