// The CEP panels run with Node.js enabled, so the Socket.IO client they load
// must be the pinned local copy, never a network URL (see cep/VENDORED.md),
// and their manifests must not open a DevTools port, which would let any
// local process run code in the panel without the proxy token.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const CEP_DIR = path.join(__dirname, "..", "..", "cep");
const PANELS = ["com.mikechambers.ai", "com.mikechambers.ae"];
const PINNED_SHA384 =
    "sha384-mZLF4UVrpi/QTWPA7BjNPEnkIfRFn4ZEO3Qt/HFklTJBj/gBOV8G3HcKn4NfQblz";

// The src of every script tag, quoted or not.
function scriptSources(html) {
    return [
        ...html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi),
    ].map((m) => m[1] ?? m[2] ?? m[3]);
}

test("scriptSources finds quoted and unquoted sources (control)", () => {
    assert.deepEqual(
        scriptSources(
            `<script src="a.js"></script><script type=module src='b.js'></script>` +
                `<script src=https://cdn.example/c.js></script>`
        ),
        ["a.js", "b.js", "https://cdn.example/c.js"]
    );
});

for (const panel of PANELS) {
    test(`${panel}: vendored socket.io.min.js matches the pinned hash`, () => {
        const file = path.join(CEP_DIR, panel, "lib", "socket.io.min.js");
        const digest =
            "sha384-" + crypto.createHash("sha384").update(fs.readFileSync(file)).digest("base64");
        assert.equal(digest, PINNED_SHA384);
    });

    test(`${panel}: index.html loads the local copy and no network script`, () => {
        const html = fs.readFileSync(path.join(CEP_DIR, panel, "index.html"), "utf8");
        const sources = scriptSources(html);

        assert.ok(sources.includes("./lib/socket.io.min.js"), `script sources: ${sources}`);
        for (const src of sources) {
            assert.ok(!/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src), `remote script source: ${src}`);
        }
    });

    test(`${panel}: the manifest opens no DevTools port`, () => {
        const manifest = fs.readFileSync(path.join(CEP_DIR, panel, "CSXS", "manifest.xml"), "utf8");
        assert.match(manifest, /<Parameter>--enable-nodejs<\/Parameter>/, "manifest not recognised");
        assert.doesNotMatch(manifest, /remote-debugging/);
    });
}
