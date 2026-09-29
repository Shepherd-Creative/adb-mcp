// Raw WebSocket handshake probe, for checking the proxy's Origin policy.
//
// It sends the same upgrade request a browser would, with an Origin of our
// choosing, and reports the HTTP status the server answers with: 101 means
// the upgrade was accepted. Probe the real engine.io path, because engine.io
// refuses any other path whatever the Origin, which would make every probe
// look refused.

const crypto = require("crypto");
const http = require("http");

const ENGINE_PATH = "/socket.io/?EIO=4&transport=websocket";

// Resolves to { status, body } (the HTTP status code and, for a refusal, the
// response body), or to { status: null, error } when the server closed or timed
// out without answering. `origin` undefined sends no Origin header at all.
function probeHandshake({
    host = "127.0.0.1",
    port = 3002,
    path = ENGINE_PATH,
    origin,
    timeoutMs = 3000,
} = {}) {
    return new Promise((resolve) => {
        const headers = {
            Host: `localhost:${port}`,
            Connection: "Upgrade",
            Upgrade: "websocket",
            "Sec-WebSocket-Version": "13",
            "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64"),
        };
        if (origin !== undefined) {
            headers.Origin = origin;
        }

        const req = http.request({
            host,
            port,
            path,
            method: "GET",
            headers,
        });

        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            req.destroy();
            resolve(result);
        };
        const timer = setTimeout(
            () => finish({ status: null, error: "timeout" }),
            timeoutMs
        );

        req.on("upgrade", (res, socket) => {
            socket.destroy();
            finish({ status: res.statusCode, body: "" });
        });
        req.on("response", (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
                body += chunk;
            });
            res.on("end", () => finish({ status: res.statusCode, body }));
            res.on("error", () => finish({ status: res.statusCode, body }));
        });
        req.on("error", (e) => finish({ status: null, error: e.code || e.message }));
        req.end();
    });
}

module.exports = { ENGINE_PATH, probeHandshake };
