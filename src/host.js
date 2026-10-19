// The extension's side of sesh browser-host: the requests, what their
// replies mean, and the fill a page gets. Nothing here touches the
// browser, so it runs under Node's tests as it is.

// The program the browser starts for these requests, as sesh browser
// install registers it.
export const HOST = "io.github.bashhack.sesh";

// HostError is a request sesh refused: code says what for (locked,
// not_this_site, no_vault, …), and message says it in sesh's words.
export class HostError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

// makeHost is the requests, sent with send(host, message), which returns
// sesh's reply (the browser's runtime.sendNativeMessage).
export function makeHost(send) {
    async function ask(request) {
        let reply;
        try {
            reply = await send(HOST, request);
        } catch (e) {
            throw unreachable(e);
        }
        if (!reply || reply.status !== "ok") {
            throw new HostError((reply && reply.code) || "failed", (reply && reply.message) || "sesh gave no answer");
        }
        return reply;
    }
    return {
        // status is { locked, touchID }.
        async status() {
            const r = await ask({ type: "status" });
            return { locked: r.locked === true, touchID: r.touch_id === true };
        },
        // match is the logins for the page at url: { id, name, username, totp }.
        async match(url) {
            const r = await ask({ type: "match", url });
            return r.entries || [];
        },
        // fill is the login id names, for the page at url: { username,
        // password, totp }. sesh checks the site itself.
        async fill(id, url) {
            const r = await ask({ type: "fill", id, url });
            return { username: r.username || "", password: r.password || "", totp: r.totp || "" };
        },
        // unlockTouchID unlocks sesh with a fingerprint.
        async unlockTouchID() {
            await ask({ type: "unlock_touchid" });
        },
    };
}

// unreachable is why the browser couldn't get an answer from sesh, from
// what it said (Chrome's words, then Firefox's), with what to do.
export function unreachable(e) {
    const said = (e && e.message) || String(e);
    if (/host not found|no such native application/i.test(said)) {
        return new HostError("no_host", "The browser can't find sesh: install sesh, then run sesh browser install. (" + said + ")");
    }
    if (/forbidden/i.test(said)) {
        return new HostError("forbidden", "sesh isn't set up to let this extension in: run sesh browser install again. (" + said + ")");
    }
    if (/exited/i.test(said)) {
        return new HostError("host_exited", "sesh stopped before it answered: sesh doctor says what's wrong. (" + said + ")");
    }
    return new HostError("unreachable", "The browser couldn't get an answer from sesh (" + said + "): sesh doctor says what's wrong.");
}

// fillPlan is what to fill, from what the page shows (step: a visible
// password field, a visible one-time-code field) and whether the login
// has a code:
//   - "login": the username and password, on a page asking for a password;
//     a code isn't put in on such a page, only shown;
//   - "code": the code alone, on a page asking only for one;
//   - "no_code": nothing, on a page asking for a code the login hasn't;
//   - "username": the username alone, for a sign-in asking for it first.
// A code field is never given the username.
export function fillPlan(step, hasCode) {
    if (step.password) {
        return "login";
    }
    if (step.code) {
        return hasCode ? "code" : "no_code";
    }
    return "username";
}

// matching is the entries whose name or username has every word of query
// in it, case aside, in the order sesh gave them.
export function matching(entries, query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter((e) => {
        const text = (e.name + " " + (e.username || "")).toLowerCase();
        return words.every((w) => text.includes(w));
    });
}

// fillRequests are the requests browserpass's fill script is given, one
// after another until one fills something, for plan's step: for
// "login", the login form in the top frame, then in its same-site frames
// too; for "username", a form without a password field, in the top
// frame. Frames from another site aren't filled: the extension can't
// reach them.
export function fillRequests(url, login, plan) {
    const base = {
        origin: new URL(url).origin,
        login: { fields: { login: login.username, secret: login.password } },
        fields: ["login", "secret"],
        allowForeign: false,
        foreignFills: {},
    };
    switch (plan) {
        case "login":
            return [
                { ...base, allowNoSecret: false, allFrames: false },
                { ...base, allowNoSecret: false, allFrames: true },
            ];
        case "username":
            return [{ ...base, allowNoSecret: true, allFrames: false }];
    }
    return [];
}
