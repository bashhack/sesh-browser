import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHost, matching, fillRequests, fillPlan, unreachable, HostError, HOST } from "../src/host.js";

// A host whose replies are given, recording what it was sent.
function fakeHost(reply) {
    const sent = [];
    const host = makeHost(async (name, message) => {
        sent.push({ name, message });
        if (reply instanceof Error) {
            throw reply;
        }
        return typeof reply === "function" ? reply(message) : reply;
    });
    return { host, sent };
}

test("requests go to sesh's host, carrying the tab's URL", async () => {
    const { host, sent } = fakeHost({ status: "ok", entries: [] });
    await host.match("https://github.com/login");
    await host.fill("password/github/alice", "https://github.com/login");
    assert.deepEqual(sent, [
        { name: HOST, message: { type: "match", url: "https://github.com/login" } },
        { name: HOST, message: { type: "fill", id: "password/github/alice", url: "https://github.com/login" } },
    ]);
});

test("status reads locked and Touch ID", async () => {
    const { host } = fakeHost({ status: "ok", locked: true, touch_id: true });
    assert.deepEqual(await host.status(), { locked: true, touchID: true });
});

test("no entries is an empty list", async () => {
    const { host } = fakeHost({ status: "ok" });
    assert.deepEqual(await host.match("https://x.example/"), []);
});

test("a refusal is a HostError with sesh's code and words", async () => {
    const { host } = fakeHost({ status: "error", code: "not_this_site", message: "password/gist/alice isn't for github.com" });
    await assert.rejects(host.fill("password/gist/alice", "https://github.com/"), (e) => {
        assert.ok(e instanceof HostError);
        assert.equal(e.code, "not_this_site");
        assert.match(e.message, /isn't for github.com/);
        return true;
    });
});

test("sesh not reachable says how to set it up", async () => {
    const { host } = fakeHost(new Error("Specified native messaging host not found."));
    await assert.rejects(host.status(), (e) => e.code === "no_host" && /sesh browser install/.test(e.message));
});

test("each way the browser can't reach sesh says what to do about it", () => {
    for (const [said, code, advice] of [
        ["Specified native messaging host not found.", "no_host", /install sesh, then run sesh browser install/],
        ["No such native application io.github.bashhack.sesh", "no_host", /install sesh/],
        ["Access to the specified native messaging host is forbidden.", "forbidden", /sesh browser install again/],
        ["Native host has exited.", "host_exited", /sesh doctor/],
        ["An unexpected error occurred", "unreachable", /sesh doctor/],
    ]) {
        const e = unreachable(new Error(said));
        assert.equal(e.code, code, said);
        assert.match(e.message, advice, said);
    }
});

test("no reply is a failure, not an empty answer", async () => {
    const { host } = fakeHost(undefined);
    await assert.rejects(host.match("https://x.example/"), (e) => e.code === "failed");
});

test("the search matches every word, in a name or username, case aside", () => {
    const entries = [
        { name: "github", username: "alice" },
        { name: "GitHub", username: "bob" },
        { name: "other", username: "carol" },
    ];
    assert.deepEqual(matching(entries, "").length, 3);
    assert.deepEqual(matching(entries, "GIT").map((e) => e.username), ["alice", "bob"]);
    assert.deepEqual(matching(entries, "git bob").map((e) => e.username), ["bob"]);
    assert.deepEqual(matching(entries, "nobody"), []);
});

test("what's filled follows what the page asks for; a code field never gets the username", () => {
    assert.equal(fillPlan({ password: true, code: false }, true), "login");
    assert.equal(fillPlan({ password: true, code: true }, true), "login"); // the code isn't put in beside a password
    assert.equal(fillPlan({ password: false, code: true }, true), "code");
    assert.equal(fillPlan({ password: false, code: true }, false), "no_code");
    assert.equal(fillPlan({ password: false, code: false }, true), "username");
    assert.equal(fillPlan({ password: false, code: false }, false), "username");
});

test("a login fill tries the top frame, then same-site frames; a username step only the top frame; never another site's frames", () => {
    const login = { username: "alice", password: "pw" };
    assert.deepEqual(
        fillRequests("https://github.com/login?x=1", login, "login").map((r) => [r.allFrames, r.allowNoSecret]),
        [
            [false, false],
            [true, false],
        ],
    );
    assert.deepEqual(
        fillRequests("https://github.com/login", login, "username").map((r) => [r.allFrames, r.allowNoSecret]),
        [[false, true]],
    );
    assert.deepEqual(fillRequests("https://github.com/", login, "code"), []);
    const reqs = [...fillRequests("https://github.com/login?x=1", login, "login"), ...fillRequests("https://github.com/login", login, "username")];
    for (const r of reqs) {
        assert.equal(r.origin, "https://github.com");
        assert.equal(r.allowForeign, false);
        assert.deepEqual(r.login.fields, { login: "alice", secret: "pw" });
        assert.deepEqual(r.fields, ["login", "secret"]);
    }
});

test("the page's fill is browserpass's script, unchanged, and its fill in one function", async () => {
    const { fillInPageSource } = await import("../build.mjs");
    const { readFileSync } = await import("node:fs");
    const source = fillInPageSource();
    assert.ok(source.includes(readFileSync("src/inject/inject.js", "utf8")), "inject.js isn't in it whole");
    assert.match(source, /export function fillInPage\(request\)/);
    assert.match(source, /window\.browserpass\.fillLogin\(request\)\.filledFields/);
    // It's one function the browser can send into the page as its source.
    const mod = await import("data:text/javascript," + encodeURIComponent(source));
    assert.equal(typeof mod.fillInPage, "function");
    assert.doesNotThrow(() => new Function("return (" + mod.fillInPage.toString() + ")"));
});
