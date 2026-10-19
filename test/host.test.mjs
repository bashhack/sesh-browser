import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHost, matching, fillRequests, HostError, HOST } from "../src/host.js";

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

test("the fill tries the top frame, then same-site frames, then a username-only step; never another site's frames", () => {
    const reqs = fillRequests("https://github.com/login?x=1", { username: "alice", password: "pw" });
    assert.deepEqual(
        reqs.map((r) => [r.allFrames, r.allowNoSecret]),
        [
            [false, false],
            [true, false],
            [false, true],
        ],
    );
    for (const r of reqs) {
        assert.equal(r.origin, "https://github.com");
        assert.equal(r.allowForeign, false);
        assert.deepEqual(r.login.fields, { login: "alice", secret: "pw" });
        assert.deepEqual(r.fields, ["login", "secret"]);
    }
});
