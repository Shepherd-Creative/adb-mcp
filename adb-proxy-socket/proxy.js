#!/usr/bin/env node

/* MIT License
 *
 * Copyright (c) 2025 Mike Chambers
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const express = require("express");
const http = require("http");
const net = require("net");
const { Server } = require("socket.io");
const {
    TOKEN_PATH,
    debugOutputWarning,
    isOriginAllowed,
    loadOrCreateToken,
    tokenMatches,
} = require("./auth");

// Loaded only once the proxy holds its port (see start() at the end of this
// file), so a proxy that cannot listen never creates or changes a token.
let token = null;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    // WebSocket only: a browser always sends an Origin header on a WebSocket
    // handshake, so a handshake without one does not come from a web page.
    transports: ["websocket"],
    // The panels ship their own socket.io client. Serving it would let any
    // web page load it with a script tag and learn that the proxy is running.
    serveClient: false,
    maxHttpBufferSize: 50 * 1024 * 1024,
    allowRequest: (req, callback) => {
        const origin = req.headers.origin;
        if (isOriginAllowed(origin)) {
            callback(null, true);
            return;
        }
        console.log(`Refused a connection from Origin ${JSON.stringify(origin)}`);
        callback("origin not allowed", false);
    },
});

// engine.io runs allowRequest only for handshakes without a session id. A
// request that carries one is a transport upgrade, and would take over that
// session without the token or an allowed Origin. This proxy is WebSocket
// only, so it never upgrades and no client needs to send one. Engine
// middleware runs on every request, before that check.
io.engine.use((req, res, next) => {
    // Defensive: start() runs from the listen callbacks, so no request should
    // arrive before the token is loaded. One that did is refused here, which
    // clients retry, rather than by the token check, which is final.
    if (token === null) {
        next(new Error("not ready"));
        return;
    }
    if (new URL(req.url, "http://localhost").searchParams.has("sid")) {
        console.log("Refused a request that carried a session id");
        next(new Error("session id not accepted"));
        return;
    }
    next();
});

// Every client must send the shared token in its socket.io auth payload.
io.use((socket, next) => {
    if (tokenMatches(token, socket.handshake.auth.token)) {
        next();
        return;
    }
    console.log(`Refused ${socket.id}: missing or wrong token`);
    next(new Error("unauthorized"));
});

const PORT = 3002;
// Track clients by application
const applicationClients = {};

io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on("register", ({ application }) => {
        console.log(
            `Client ${socket.id} registered for application: ${application}`
        );

        // Store the application preference with this socket
        socket.data.application = application;

        // Register this client for this application
        if (!applicationClients[application]) {
            applicationClients[application] = new Set();
        }
        applicationClients[application].add(socket.id);

        // Optionally confirm registration
        socket.emit("registration_response", {
            type: "registration",
            status: "success",
            message: `Registered for ${application}`,
        });
    });

    socket.on("command_packet_response", ({ packet }) => {
        const senderId = packet.senderId;

        if (senderId) {
            io.to(senderId).emit("packet_response", packet);
            console.log(`Sent confirmation to client ${senderId}`);
        } else {
            console.log(`No sender ID provided in packet`);
        }
    });

    socket.on("command_packet", ({ application, command }) => {
        console.log(
            `Command from ${socket.id} for application ${application}:`,
            command
        );

        // Register this client for this application if not already registered
        //if (!applicationClients[application]) {
        //  applicationClients[application] = new Set();
        //}
        //applicationClients[application].add(socket.id);

        // Process the command

        let packet = {
            senderId: socket.id,
            application: application,
            command: command,
        };

        sendToApplication(packet);

        // Send response back to this client
        //socket.emit('json_response', { from: 'server', command });
    });

    socket.on("disconnect", () => {
        console.log(`User disconnected: ${socket.id}`);

        // Remove this client from all application registrations
        for (const app in applicationClients) {
            applicationClients[app].delete(socket.id);
            // Clean up empty sets
            if (applicationClients[app].size === 0) {
                delete applicationClients[app];
            }
        }
    });
});

// Add a function to send messages to clients by application
function sendToApplication(packet) {
    let application = packet.application;
    if (applicationClients[application]) {
        console.log(
            `Sending to ${applicationClients[application].size} clients for ${application}`
        );

        let senderId = packet.senderId;
        // Loop through all client IDs for this application
        applicationClients[application].forEach((clientId) => {
            io.to(clientId).emit("command_packet", packet);
        });
        return true;
    }
    console.log(`No clients registered for application: ${application}`);
    return false;
}

// Example: Use this function elsewhere in your code
// sendToApplication('photoshop', { message: 'Update available' });

function fail(message) {
    console.error(message);
    process.exit(1);
}

// Pipes a connection on [::1]:3002 to the IPv4 listener, where every check
// applies as usual.
function forwardToIPv4(client) {
    const upstream = net.connect(PORT, "127.0.0.1");
    const close = () => {
        client.destroy();
        upstream.destroy();
    };
    for (const end of [client, upstream]) {
        end.on("error", close);
        end.on("close", close);
    }
    client.pipe(upstream).pipe(client);
}

function start() {
    try {
        const loaded = loadOrCreateToken(TOKEN_PATH);
        token = loaded.token;
        console.log(
            `${loaded.created ? "Created" : "Using"} the proxy token at ${TOKEN_PATH}`
        );
    } catch (e) {
        fail(`Cannot use the proxy token: ${e.message}`);
    }
    const debugWarning = debugOutputWarning();
    if (debugWarning) {
        console.warn(debugWarning);
    }
    console.log(
        `adb-mcp Command proxy server running on ws://localhost:${PORT}`
    );
}

// Clients dial "localhost", which resolves to ::1 before 127.0.0.1 on macOS.
// The proxy holds [::1]:3002 as well, so no other process can listen there
// and collect client tokens, and it refuses to start if either address is
// taken. A machine with no IPv6 loopback has no ::1 for anyone to take.
server.on("error", (e) => fail(`Cannot listen on 127.0.0.1:${PORT}: ${e.message}`));
server.listen(PORT, "127.0.0.1", () => {
    const ipv6 = net.createServer(forwardToIPv4);
    ipv6.on("error", (e) => {
        if (e.code === "EADDRNOTAVAIL" || e.code === "EAFNOSUPPORT") {
            start();
            return;
        }
        fail(
            `Cannot listen on [::1]:${PORT}: ${e.message}. Another program there ` +
                `would receive client tokens: stop it, then start the proxy.`
        );
    });
    ipv6.listen(PORT, "::1", start);
});
