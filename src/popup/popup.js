import { makeHost, matching, fillRequests, fillPlan, HostError } from "../host.js";
// Made by the build from inject/inject.js (build.mjs).
import { fillInPage } from "../inject/fill-in-page.js";

// The popup: the logins sesh has for the tab's site, filled on Enter or a
// click. It runs only when you open it (its button, or Alt+Shift+S), which
// is what lets it reach the tab: the extension asks for no other access.

const host = makeHost((name, message) => chrome.runtime.sendNativeMessage(name, message));
const $ = (id) => document.getElementById(id);

let tab;
let logins = [];
let shown = [];
let picked = 0;

function say(text, bad = false) {
    $("said").textContent = text;
    $("said").className = bad ? "bad" : "";
}

function draw() {
    shown = matching(logins, $("search").value);
    picked = Math.min(picked, Math.max(shown.length - 1, 0));
    const list = $("logins");
    list.replaceChildren(
        ...shown.map((e, i) => {
            const li = document.createElement("li");
            li.setAttribute("role", "option");
            li.setAttribute("aria-selected", String(i === picked));
            const name = document.createElement("span");
            name.textContent = e.name;
            const user = document.createElement("span");
            user.className = "user";
            user.textContent = (e.username || "") + (e.totp ? " · code" : "");
            li.append(name, user);
            li.addEventListener("click", () => fill(e));
            return li;
        }),
    );
    if (logins.length > 0 && shown.length === 0) {
        say("No login here matches the search.");
    }
}

async function load() {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
        say("sesh can't see this tab's address.", true);
        return;
    }
    try {
        const st = await host.status();
        if (st.locked) {
            say(st.touchID ? "sesh is locked." : "sesh is locked: run any sesh command, or sesh ui, to unlock it.");
            $("unlock").hidden = !st.touchID;
            return;
        }
        logins = await host.match(tab.url);
    } catch (e) {
        say(e.message, true);
        return;
    }
    say(logins.length === 0 ? "sesh has no login for this site." : "");
    draw();
}

// fill gets the login from sesh (which checks the site again) and fills
// what the page asks for: the username and password on a page with a
// password field; the code alone on a page asking only for one; the
// username alone on a sign-in that asks for it first. A code the page
// doesn't take is shown, to copy. One fill at a time.
let filling = false;

async function fill(entry) {
    if (filling) {
        return;
    }
    filling = true;
    try {
        await fillWith(entry);
    } finally {
        filling = false;
    }
}

async function fillWith(entry) {
    let login;
    try {
        login = await host.fill(entry.id, tab.url);
    } catch (e) {
        say(e.message, true);
        if (e instanceof HostError && e.code === "locked") {
            logins = [];
            draw();
        }
        return;
    }
    try {
        const frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: pageStep });
        const step = {
            password: frames.some((f) => f.result && f.result.password),
            code: frames.some((f) => f.result && f.result.code),
        };
        const plan = fillPlan(step, Boolean(login.totp));
        if (plan === "no_code") {
            say("This page asks for a code, and sesh has none for this login.", true);
            return;
        }
        if (plan === "code") {
            const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fillOneTimeCode, args: [login.totp] });
            if (r && r.result === true) {
                window.close();
                return;
            }
            say("The code field couldn't be filled: copy the code.", true);
            showCode(login.totp);
            return;
        }
        let filled = [];
        let why = ""; // what went wrong, when nothing was filled
        for (const request of fillRequests(tab.url, login, plan)) {
            let results;
            try {
                results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id, allFrames: request.allFrames },
                    func: fillInPage,
                    args: [request],
                });
            } catch (e) {
                why = why || "the browser wouldn't run the fill there (" + e.message + ")";
                continue; // frames the extension can't reach: the next way
            }
            filled = results.flatMap((f) => (f.result && f.result.fields) || []);
            if (filled.length > 0) {
                break;
            }
            const frame = results.find((f) => f.result && f.result.error);
            if (frame && !why) {
                why = "the fill script failed: " + frame.result.error;
            } else if (!results.length && !why) {
                why = "the browser ran the fill in no frame";
            }
        }
        if (filled.length === 0) {
            say("sesh found no login form on this page to fill" + (why ? ": " + why : ".") + " (the page asked for: " + plan + ")", true);
            showCode(login.totp);
            return;
        }
        if (login.totp) {
            showCode(login.totp);
            say("Filled. When the site asks for the code, open sesh again, or copy it.");
            return;
        }
        window.close();
    } catch (e) {
        say("The page couldn't be filled: " + e.message, true);
    } finally {
        login = undefined;
    }
}

function showCode(code) {
    if (!code) {
        return;
    }
    $("code").hidden = false;
    $("code-value").textContent = code;
    $("copy-code").onclick = async () => {
        await navigator.clipboard.writeText(code);
        say("Code copied.");
    };
}

// pageStep says what the page (one frame of it) asks for: a password
// field, a one-time-code field, each one you can see. Run in the page, so
// it takes nothing from outside: visible is browserpass's own rule.
function pageStep() {
    function visible(el) {
        if (el.disabled || el.offsetWidth < 30 || el.offsetHeight < 10) {
            return false;
        }
        if (window.getComputedStyle(el).visibility === "hidden") {
            return false; // visibility is inherited: this covers its parents
        }
        // Opacity isn't: a field in a see-through parent is see-through.
        let opacity = 1;
        for (let n = el; n && n.nodeType === Node.ELEMENT_NODE; n = n.parentNode) {
            const o = parseFloat(window.getComputedStyle(n).opacity);
            opacity *= Number.isNaN(o) ? 1 : o;
        }
        if (opacity < 0.1) {
            return false;
        }
        const r = el.getBoundingClientRect();
        return !(r.x + r.width < 0 || r.y + r.height < 0 || r.x > window.innerWidth || r.y > window.innerHeight);
    }
    const any = (selector) => Array.from(document.querySelectorAll(selector)).some(visible);
    return { password: any("input[type=password i]"), code: any('input[autocomplete="one-time-code" i]') };
}

// fillOneTimeCode puts code in the page's one-time-code field you can
// see, by the same rule as pageStep. Run in the page.
function fillOneTimeCode(code) {
    function visible(el) {
        if (el.disabled || el.readOnly || el.offsetWidth < 30 || el.offsetHeight < 10) {
            return false;
        }
        if (window.getComputedStyle(el).visibility === "hidden") {
            return false; // visibility is inherited: this covers its parents
        }
        // Opacity isn't: a field in a see-through parent is see-through.
        let opacity = 1;
        for (let n = el; n && n.nodeType === Node.ELEMENT_NODE; n = n.parentNode) {
            const o = parseFloat(window.getComputedStyle(n).opacity);
            opacity *= Number.isNaN(o) ? 1 : o;
        }
        if (opacity < 0.1) {
            return false;
        }
        const r = el.getBoundingClientRect();
        return !(r.x + r.width < 0 || r.y + r.height < 0 || r.x > window.innerWidth || r.y > window.innerHeight);
    }
    const field = Array.from(document.querySelectorAll('input[autocomplete="one-time-code" i]')).find(visible);
    if (!field) {
        return false;
    }
    field.focus();
    field.value = code;
    for (const name of ["input", "change"]) {
        field.dispatchEvent(new Event(name, { bubbles: true }));
    }
    field.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
}

$("search").addEventListener("input", () => {
    picked = 0;
    draw();
});
document.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        picked = (picked + (ev.key === "ArrowDown" ? 1 : -1) + shown.length) % Math.max(shown.length, 1);
        draw();
        ev.preventDefault();
    } else if (ev.key === "Enter" && shown[picked] && !(ev.target instanceof HTMLButtonElement)) {
        fill(shown[picked]);
        ev.preventDefault();
    }
});
$("unlock").addEventListener("click", async () => {
    say("Touch your fingerprint sensor…");
    try {
        await host.unlockTouchID();
        $("unlock").hidden = true;
        await load();
    } catch (e) {
        say(e.message, true);
    }
});

$("search").focus();
load();
