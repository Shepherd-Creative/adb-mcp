const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
    isOriginAllowed,
    loadOrCreateToken,
    tokenMatches,
} = require("../auth");

// A fresh token path inside its own temporary directory.
function tempTokenPath() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adb-auth-test-"));
    return path.join(dir, "adb-mcp", "token");
}

test("creates the token file 0600 in a 0700 directory", () => {
    const tokenPath = tempTokenPath();
    const { token, created } = loadOrCreateToken(tokenPath);

    assert.equal(created, true);
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.equal(fs.readFileSync(tokenPath, "utf8"), token + "\n");
    assert.equal(fs.statSync(tokenPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(tokenPath)).mode & 0o777, 0o700);
});

test("reuses an existing token instead of replacing it", () => {
    const tokenPath = tempTokenPath();
    const first = loadOrCreateToken(tokenPath);
    const second = loadOrCreateToken(tokenPath);

    assert.equal(second.created, false);
    assert.equal(second.token, first.token);
});

test("two new tokens differ", () => {
    assert.notEqual(
        loadOrCreateToken(tempTokenPath()).token,
        loadOrCreateToken(tempTokenPath()).token
    );
});

test("refuses a token file other users can read", () => {
    const tokenPath = tempTokenPath();
    loadOrCreateToken(tokenPath);
    fs.chmodSync(tokenPath, 0o640);

    assert.throws(() => loadOrCreateToken(tokenPath), /open to other users \(mode 640\)/);
});

test("refuses a symlink in place of the token file", () => {
    const real = tempTokenPath();
    loadOrCreateToken(real);
    const link = tempTokenPath();
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(real, link);

    assert.throws(() => loadOrCreateToken(link), { code: "ELOOP" });
});

test("refuses malformed content without echoing it", () => {
    const tokenPath = tempTokenPath();
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, "not-a-token-XYZZY\n", { mode: 0o600 });

    assert.throws(
        () => loadOrCreateToken(tokenPath),
        (e) => /does not hold a valid token/.test(e.message) && !e.message.includes("XYZZY")
    );
});

test("tokenMatches accepts only the exact token", () => {
    const token = "a".repeat(64);

    assert.equal(tokenMatches(token, token), true);
    assert.equal(tokenMatches(token, "b".repeat(64)), false);
    assert.equal(tokenMatches(token, token.slice(0, 63)), false);
    assert.equal(tokenMatches(token, token + "a"), false);
    assert.equal(tokenMatches(token, ""), false);
    for (const notAString of [undefined, null, 42, {}, [token], { token }]) {
        assert.equal(tokenMatches(token, notAString), false);
    }
});

test("Origin policy: measured Origins and no Origin pass, everything else is refused", () => {
    assert.equal(isOriginAllowed(undefined), true);
    assert.equal(isOriginAllowed("file://"), true);
    assert.equal(isOriginAllowed("http://localhost:3002"), true);

    for (const origin of [
        "null",
        "",
        "https://evil.example",
        "http://127.0.0.1:3002",
        "http://localhost:3002.evil.example",
        "http://localhost",
        "file:///Users",
        "FILE://",
    ]) {
        assert.equal(isOriginAllowed(origin), false, `should refuse ${JSON.stringify(origin)}`);
    }
});
