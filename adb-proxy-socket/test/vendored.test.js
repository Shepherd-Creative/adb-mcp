// The CEP panels run with Node.js enabled, so the Socket.IO client they load
// must be the pinned local copy, never a network URL. See cep/VENDORED.md.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const CEP_DIR = path.join(__dirname, "..", "..", "cep");
const PANELS = ["com.mikechambers.ai", "com.mikechambers.ae"];
const PINNED_SHA384 =
    "sha384-mZLF4UVrpi/QTWPA7BjNPEnkIfRFn4ZEO3Qt/HFklTJBj/gBOV8G3HcKn4NfQblz";

for (const panel of PANELS) {
    test(`${panel}: vendored socket.io.min.js matches the pinned hash`, () => {
        const file = path.join(CEP_DIR, panel, "lib", "socket.io.min.js");
        const digest =
            "sha384-" + crypto.createHash("sha384").update(fs.readFileSync(file)).digest("base64");
        assert.equal(digest, PINNED_SHA384);
    });

    test(`${panel}: index.html loads the local copy and no network script`, () => {
        const html = fs.readFileSync(path.join(CEP_DIR, panel, "index.html"), "utf8");
        const sources = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(
            (m) => m[1]
        );

        assert.ok(sources.includes("./lib/socket.io.min.js"), `script sources: ${sources}`);
        for (const src of sources) {
            assert.ok(!/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src), `remote script source: ${src}`);
        }
    });
}
