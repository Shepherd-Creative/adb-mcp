// Live checks against a real proxy process. Opt in with ADB_PROXY_LIVE=1:
// the suite starts proxy.js on 127.0.0.1:3002 (refusing if the port is taken),
// uses the real token file and stops the proxy when it is done. It never
// prints the token.

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { io } = require("socket.io-client");
const WebSocket = require("ws");

const { TOKEN_PATH } = require("../auth");
const { ENGINE_PATH, probeHandshake } = require("./handshake");

const LIVE = process.env.ADB_PROXY_LIVE === "1";
const SKIP = LIVE ? false : "set ADB_PROXY_LIVE=1 to run against a real proxy";
const PORT = 3002;
const URL = `http://localhost:${PORT}`;
const PROBE_APP = "__adb_probe__";

let proxy = null;
let output = "";

function portInUse(port, host) {
    return new Promise((resolve) => {
        const socket = net.connect({ host, port });
        socket.once("connect", () => {
            socket.destroy();
            resolve(true);
        });
        socket.once("error", () => resolve(false));
    });
}

function waitFor(predicate, timeoutMs, what) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const timer = setInterval(() => {
            if (predicate()) {
                clearInterval(timer);
                resolve();
            } else if (Date.now() - started > timeoutMs) {
                clearInterval(timer);
                reject(new Error(`timed out waiting for ${what}`));
            }
        }, 25);
    });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Whether this machine has an IPv6 loopback address to listen on.
function ipv6LoopbackAvailable() {
    return new Promise((resolve) => {
        const probe = net.createServer();
        probe.once("error", () => resolve(false));
        probe.listen(0, "::1", () => probe.close(() => resolve(true)));
    });
}

// Resolves to { connected: true, socket } or { connected: false, error }.
function connect(options = {}, url = URL) {
    return new Promise((resolve) => {
        const socket = io(url, {
            transports: ["websocket"],
            reconnection: false,
            forceNew: true,
            timeout: 3000,
            ...options,
        });
        socket.once("connect", () => resolve({ connected: true, socket }));
        socket.once("connect_error", (e) => {
            socket.close();
            resolve({ connected: false, error: e.message });
        });
    });
}

function readToken() {
    return fs.readFileSync(TOKEN_PATH, "utf8").trim();
}

// An authenticated client registered as PROBE_APP. Records command packets.
async function registerProbeApp() {
    const result = await connect({ auth: { token: readToken() } });
    assert.equal(result.connected, true, `probe app could not connect: ${result.error}`);
    const app = result.socket;
    const received = [];
    app.on("command_packet", (packet) => received.push(packet));
    const confirmed = new Promise((resolve) => app.once("registration_response", resolve));
    app.emit("register", { application: PROBE_APP });
    await confirmed;
    return { app, received };
}

before(async () => {
    if (!LIVE) return;
    // Both loopback addresses: clients dial "localhost", which may resolve to
    // either, and a listener on one of them would receive the suite's token.
    for (const host of ["127.0.0.1", "::1"]) {
        if (await portInUse(PORT, host)) {
            throw new Error(`port ${PORT} is in use on ${host}: stop whatever holds it before the live suite`);
        }
    }
    proxy = spawn(process.execPath, ["proxy.js"], {
        cwd: path.join(__dirname, ".."),
        stdio: ["ignore", "pipe", "pipe"],
    });
    proxy.stdout.on("data", (d) => (output += d));
    proxy.stderr.on("data", (d) => (output += d));
    await waitFor(() => output.includes("proxy server running"), 10000, "the proxy to listen");
});

after(async () => {
    if (!proxy) return;
    const exited = new Promise((resolve) => proxy.once("exit", resolve));
    proxy.kill("SIGTERM");
    await exited;
});

test("a web page Origin is refused on the engine.io path; allowed Origins pass (control)", { skip: SKIP }, async () => {
    for (const origin of ["https://evil.example", "null", "", "http://127.0.0.1:3002"]) {
        const r = await probeHandshake({ origin });
        assert.equal(r.status, 400, `Origin ${JSON.stringify(origin)}: ${JSON.stringify(r)}`);
        assert.match(r.body, /origin not allowed/, `Origin ${JSON.stringify(origin)} refused for another reason`);
    }
    for (const origin of [undefined, "file://", "http://localhost:3002"]) {
        const r = await probeHandshake({ origin });
        assert.equal(r.status, 101, `control Origin ${JSON.stringify(origin)}: ${JSON.stringify(r)}`);
    }
});

test("a wrong path is refused whatever the Origin, so it cannot stand in for the engine.io path", { skip: SKIP }, async () => {
    const r = await probeHandshake({ origin: "file://", path: "/?EIO=4&transport=websocket" });
    assert.notEqual(r.status, 101, JSON.stringify(r));
    assert.equal(ENGINE_PATH, "/socket.io/?EIO=4&transport=websocket");
});

test("the polling transport is refused", { skip: SKIP }, async () => {
    const { status, body } = await new Promise((resolve, reject) => {
        http.get(`${URL}/socket.io/?EIO=4&transport=polling`, (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode, body }));
        }).on("error", reject);
    });
    assert.equal(status, 400);
    // engine.io's "Transport unknown" (code 0), not a refusal for another reason
    assert.match(body, /"code":0,/, body);
});

test("no token, a wrong token and a non-string token are refused", { skip: SKIP }, async () => {
    const wrong = crypto.randomBytes(32).toString("hex");
    for (const auth of [undefined, {}, { token: wrong }, { token: 42 }, { token: [readToken()] }]) {
        const r = await connect(auth === undefined ? {} : { auth });
        assert.equal(r.connected, false, `auth ${JSON.stringify(auth && Object.keys(auth))} connected`);
        assert.equal(r.error, "unauthorized");
    }
});

test("the right token from a web page Origin is still refused", { skip: SKIP }, async () => {
    const refusals = () =>
        (output.match(/Refused a connection from Origin "https:\/\/evil\.example"/g) || []).length;
    const before = refusals();
    const r = await connect({
        auth: { token: readToken() },
        extraHeaders: { Origin: "https://evil.example" },
    });
    assert.equal(r.connected, false);
    assert.notEqual(r.error, "unauthorized", "the Origin check should refuse before the token check");
    // The proxy logged this refusal, so a dead proxy cannot pass this test
    await waitFor(() => refusals() === before + 1, 2000, "the proxy to log this Origin refusal");
});

test("a client that ignores the refusal and sends a command anyway reaches no app", { skip: SKIP }, async () => {
    const { app, received } = await registerProbeApp();
    try {
        // Raw socket.io over engine.io: CONNECT with a token, wait for the
        // answer (40 accepted, 44 refused), then send a command_packet anyway.
        // It is sent after the answer on purpose: socket.io closes a client
        // that sends an event before its CONNECT completes, whatever the
        // token, so a pipelined event could not tell the token check apart.
        const attempt = (token) =>
            new Promise((resolve, reject) => {
                const ws = new WebSocket(`ws://localhost:${PORT}${ENGINE_PATH}`);
                const frames = [];
                ws.on("message", (data) => {
                    const frame = data.toString();
                    frames.push(frame);
                    if (frame.startsWith("0{")) {
                        ws.send("40" + JSON.stringify({ token }));
                    } else if (frame.startsWith("40") || frame.startsWith("44")) {
                        ws.send(
                            "42" +
                                JSON.stringify([
                                    "command_packet",
                                    { application: PROBE_APP, command: { action: "after-answer" } },
                                ])
                        );
                    }
                });
                ws.on("error", reject);
                setTimeout(() => {
                    ws.close();
                    resolve(frames);
                }, 700);
            });

        const refused = await attempt("f".repeat(64));
        assert.ok(refused.some((f) => f.startsWith("44") && f.includes("unauthorized")), `frames: ${refused}`);
        assert.equal(received.length, 0, "a command got through without the token");

        // Control: the same raw client with the right token does deliver, so
        // the empty result above is not a broken harness.
        const accepted = await attempt(readToken());
        assert.ok(accepted.some((f) => f.startsWith("40{")), `frames: ${accepted}`);
        await waitFor(() => received.length === 1, 2000, "the control command");
        assert.equal(received[0].command.action, "after-answer");
    } finally {
        app.close();
    }
});

// Tries to take over an engine.io session the way engine.io upgrades a
// transport: a WebSocket handshake that carries the session's id, the probe
// exchange, then an event. Resolves to the handshake's HTTP status (101 when
// accepted) and the frames received.
function attemptTakeover(sid, origin) {
    return new Promise((resolve) => {
        const ws = new WebSocket(
            `ws://localhost:${PORT}${ENGINE_PATH}&sid=${encodeURIComponent(sid)}`,
            origin === undefined ? {} : { origin }
        );
        const frames = [];
        let status = null;
        ws.on("upgrade", (res) => (status = res.statusCode));
        ws.on("unexpected-response", (req, res) => {
            status = res.statusCode;
            res.resume();
        });
        ws.on("open", () => ws.send("2probe"));
        ws.on("message", (data) => {
            const frame = data.toString();
            frames.push(frame);
            if (frame === "3probe") {
                ws.send("5");
                ws.send(
                    "42" +
                        JSON.stringify([
                            "command_packet",
                            { application: PROBE_APP, command: { action: "takeover" } },
                        ])
                );
            }
        });
        ws.on("error", () => {});
        setTimeout(() => {
            ws.terminate();
            resolve({ status, frames });
        }, 700);
    });
}

test("a handshake that carries a session id is refused, so it cannot take over a session", { skip: SKIP }, async () => {
    const { app, received } = await registerProbeApp();
    const victim = await connect({ auth: { token: readToken() } });
    assert.equal(victim.connected, true, victim.error);
    try {
        const sid = victim.socket.io.engine.id;
        assert.ok(typeof sid === "string" && sid.length >= 16, "harness bug: no engine.io session id");

        // engine.io runs allowRequest only for handshakes without a session
        // id, so without a check of its own the proxy would let this page
        // drive the app as the victim, with neither the token nor an allowed
        // Origin.
        const takeover = await attemptTakeover(sid, "https://evil.example");
        await sleep(200);
        assert.equal(received.length, 0, `a command got through on a taken-over session: ${JSON.stringify(takeover)}`);
        assert.equal(takeover.status, 400, JSON.stringify(takeover));

        // Refused whatever the Origin: a WebSocket-only server never upgrades,
        // so no client of this proxy sends a session id.
        for (const origin of ["file://", "http://localhost:3002", undefined]) {
            const r = await probeHandshake({ origin, path: `${ENGINE_PATH}&sid=${encodeURIComponent(sid)}` });
            assert.equal(r.status, 400, `Origin ${JSON.stringify(origin)} with a live session id: ${JSON.stringify(r)}`);
        }
        assert.equal(victim.socket.connected, true, "the victim's session was disturbed");
    } finally {
        victim.socket.close();
        app.close();
    }
});

test("the right token connects and relays a command round trip", { skip: SKIP }, async () => {
    const { app } = await registerProbeApp();
    app.on("command_packet", (packet) => {
        app.emit("command_packet_response", {
            packet: { senderId: packet.senderId, status: "SUCCESS", echo: packet.command.nonce },
        });
    });

    const caller = await connect({ auth: { token: readToken() } });
    assert.equal(caller.connected, true, caller.error);
    try {
        const nonce = crypto.randomBytes(8).toString("hex");
        const reply = new Promise((resolve) => caller.socket.once("packet_response", resolve));
        caller.socket.emit("command_packet", { application: PROBE_APP, command: { action: "ping", nonce } });
        const packet = await reply;
        assert.equal(packet.status, "SUCCESS");
        assert.equal(packet.echo, nonce);
    } finally {
        caller.socket.close();
        app.close();
    }
});

test("the proxy also holds [::1]:3002, so no other process can listen there for tokens", { skip: SKIP }, async (t) => {
    if (!(await ipv6LoopbackAvailable())) {
        t.skip("no IPv6 loopback on this machine");
        return;
    }
    // Clients dial "localhost", which resolves to ::1 first on macOS: a
    // process listening there would receive every client's token.
    const outcome = await new Promise((resolve) => {
        const squatter = net.createServer();
        squatter.once("error", (e) => resolve(e.code));
        squatter.listen(PORT, "::1", () => squatter.close(() => resolve("listening")));
    });
    assert.equal(outcome, "EADDRINUSE", "another process could listen on [::1]:3002 while the proxy runs");
});

test("through [::1] the proxy applies the same checks", { skip: SKIP }, async (t) => {
    if (!(await ipv6LoopbackAvailable())) {
        t.skip("no IPv6 loopback on this machine");
        return;
    }
    const url6 = `http://[::1]:${PORT}`;
    const noToken = await connect({}, url6);
    assert.equal(noToken.connected, false);
    assert.equal(noToken.error, "unauthorized");

    const evil = await probeHandshake({ host: "::1", origin: "https://evil.example" });
    assert.equal(evil.status, 400, JSON.stringify(evil));
    assert.match(evil.body, /origin not allowed/);

    const withToken = await connect({ auth: { token: readToken() } }, url6);
    assert.equal(withToken.connected, true, withToken.error);
    withToken.socket.close();
});

test("a second proxy that cannot listen exits before touching any token file", { skip: SKIP }, async () => {
    // A HOME with no token in it: a proxy that wrote one before failing to
    // listen would leave behind a token that no running proxy uses.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "adb-second-proxy-"));
    try {
        const second = spawn(process.execPath, ["proxy.js"], {
            cwd: path.join(__dirname, ".."),
            env: { ...process.env, HOME: home },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        second.stdout.on("data", (d) => (out += d));
        second.stderr.on("data", (d) => (out += d));
        const timer = setTimeout(() => second.kill("SIGKILL"), 10000);
        const code = await new Promise((resolve) => second.once("exit", resolve));
        clearTimeout(timer);
        assert.equal(code, 1, out);
        assert.match(out, /Cannot listen on 127\.0\.0\.1:3002/);
        assert.equal(fs.existsSync(path.join(home, ".config")), false, "the second proxy created token files");
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
});

test("the proxy does not serve the socket.io client script", { skip: SKIP }, async () => {
    // A web page could load it with a script tag to learn the proxy is running.
    const { status, body } = await new Promise((resolve, reject) => {
        http.get(`${URL}/socket.io/socket.io.js`, (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode, body }));
        }).on("error", reject);
    });
    assert.notEqual(status, 200, `served ${body.length} bytes`);
});

test("the token never appears in the proxy's output", { skip: SKIP }, async () => {
    await sleep(300);
    const token = readToken();
    assert.match(token, /^[0-9a-f]{64}$/, "harness bug: the token file did not hold a token");
    // Non-vacuity: the output holds the lines the tests above produced.
    assert.match(output, /Refused a connection from Origin "https:\/\/evil\.example"/);
    assert.match(output, /missing or wrong token/);
    assert.match(output, /Refused a request that carried a session id/);
    assert.match(output, new RegExp(`registered for application: ${PROBE_APP}`));
    assert.equal(output.includes(token), false, "the proxy printed the token");
});
