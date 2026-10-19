// Lays the extension out for each browser, in dist/chrome and dist/firefox:
// the files in src, with that browser's manifest. Load either folder as
// an unpacked extension (Chrome) or a temporary add-on (Firefox).
import { cpSync, mkdirSync, rmSync } from "node:fs";

for (const browser of ["chrome", "firefox"]) {
    const out = `dist/${browser}`;
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    cpSync("src", out, { recursive: true });
    cpSync(`manifests/${browser}.json`, `${out}/manifest.json`);
}
console.log("Built dist/chrome and dist/firefox.");
