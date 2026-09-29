const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
    createTokenFile,
    debugOutputWarning,
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
    fs.mkdirSync(path.dirname(link), { recursive: true, mode: 0o700 });
    fs.symlinkSync(real, link);

    assert.throws(() => loadOrCreateToken(link), { code: "ELOOP" });
});

test("refuses malformed content without echoing it", () => {
    const tokenPath = tempTokenPath();
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tokenPath, "not-a-token-XYZZY\n", { mode: 0o600 });

    assert.throws(
        () => loadOrCreateToken(tokenPath),
        (e) => /does not hold a valid token/.test(e.message) && !e.message.includes("XYZZY")
    );
});

test("refuses a directory other users can write to, and writes nothing into it", () => {
    const tokenPath = tempTokenPath();
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.chmodSync(path.dirname(tokenPath), 0o777);

    assert.throws(() => loadOrCreateToken(tokenPath), /writable by other users \(mode 777\)/);
    assert.equal(fs.existsSync(tokenPath), false, "a token was written into that directory");
});

test("creating a token never replaces a file another process wrote first", () => {
    const tokenPath = tempTokenPath();
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tokenPath, "c".repeat(64) + "\n", { mode: 0o600 });

    assert.equal(createTokenFile(tokenPath), false);
    assert.equal(fs.readFileSync(tokenPath, "utf8"), "c".repeat(64) + "\n");
    assert.deepEqual(fs.readdirSync(path.dirname(tokenPath)), ["token"], "a temporary file was left behind");
});

test("a new token file appears complete, 0600, with no temporary file left", () => {
    const tokenPath = tempTokenPath();
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true, mode: 0o700 });

    assert.equal(createTokenFile(tokenPath), true);
    assert.match(fs.readFileSync(tokenPath, "utf8"), /^[0-9a-f]{64}\n$/);
    assert.equal(fs.statSync(tokenPath).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(path.dirname(tokenPath)), ["token"]);
});

test("warns when DEBUG is set, since socket.io debug output can include tokens", () => {
    assert.equal(debugOutputWarning({}), null);
    assert.equal(debugOutputWarning({ DEBUG: "" }), null);
    assert.match(debugOutputWarning({ DEBUG: "socket.io*" }), /^DEBUG is set: .*token/);
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
        // No expected token yet (the proxy is starting): refuse, never throw
        assert.equal(tokenMatches(notAString, token), false);
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
