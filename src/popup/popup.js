import { makeHost, matching, fillRequests, HostError } from "../host.js";

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

// fill gets the login from sesh (which checks the site again) and puts it
// in the page's form, then its code in a one-time-code field, if the page
// has one; otherwise the code is shown, to copy.
async function fill(entry) {
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
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["inject/inject.js"] });
        await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["inject/inject.js"] }).catch(() => {});
        let filled = [];
        for (const request of fillRequests(tab.url, login)) {
            let results;
            try {
                results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id, allFrames: request.allFrames },
                    func: (r) => (window.browserpass ? window.browserpass.fillLogin(r).filledFields : []),
                    args: [request],
                });
            } catch {
                continue; // frames the extension can't reach: the next way
            }
            filled = results.flatMap((f) => f.result || []);
            if (filled.length > 0) {
                break;
            }
        }
        let codeFilled = false;
        if (login.totp) {
            const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fillOneTimeCode, args: [login.totp] });
            codeFilled = r && r.result === true;
        }
        if (filled.length === 0 && !codeFilled) {
            say("sesh found no login form on this page to fill.", true);
            showCode(login.totp);
            return;
        }
        if (login.totp && !codeFilled) {
            showCode(login.totp);
            say("Filled. The page has no code field yet: copy the code when it asks.");
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

// fillOneTimeCode puts code in the page's one-time-code field, when it has
// one it can see: run in the page, so it takes nothing from outside.
function fillOneTimeCode(code) {
    const field = Array.from(document.querySelectorAll('input[autocomplete="one-time-code" i]')).find(
        (el) => !el.disabled && !el.readOnly && el.offsetWidth >= 30 && el.offsetHeight >= 10,
    );
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
    } else if (ev.key === "Enter" && shown[picked]) {
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
