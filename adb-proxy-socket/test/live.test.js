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

function portInUse(port) {
    return new Promise((resolve) => {
        const socket = net.connect({ host: "127.0.0.1", port });
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

// Resolves to { connected: true, socket } or { connected: false, error }.
function connect(options = {}) {
    return new Promise((resolve) => {
        const socket = io(URL, {
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
    if (await portInUse(PORT)) {
        throw new Error(`port ${PORT} is in use: stop the running proxy before the live suite`);
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
    const status = await new Promise((resolve, reject) => {
        http.get(`${URL}/socket.io/?EIO=4&transport=polling`, (res) => {
            res.resume();
            resolve(res.statusCode);
        }).on("error", reject);
    });
    assert.equal(status, 400);
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
    const r = await connect({
        auth: { token: readToken() },
        extraHeaders: { Origin: "https://evil.example" },
    });
    assert.equal(r.connected, false);
    assert.notEqual(r.error, "unauthorized", "the Origin check should refuse before the token check");
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

test("the token never appears in the proxy's output", { skip: SKIP }, async () => {
    await sleep(300);
    const token = readToken();
    assert.match(token, /^[0-9a-f]{64}$/, "harness bug: the token file did not hold a token");
    // Non-vacuity: the output holds the lines the tests above produced.
    assert.match(output, /Refused a connection from Origin "https:\/\/evil\.example"/);
    assert.match(output, /missing or wrong token/);
    assert.match(output, new RegExp(`registered for application: ${PROBE_APP}`));
    assert.equal(output.includes(token), false, "the proxy printed the token");
});
