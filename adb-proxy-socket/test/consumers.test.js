// Every client reads the token from the file the proxy writes, and each one
// builds that path in its own language. Evaluate each expression and compare
// it with the proxy's, so a typo in one client cannot lock that client out.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const { TOKEN_PATH } = require("../auth");

const ROOT = path.join(__dirname, "..", "..");
// The CEP panels run Node.js, where os.homedir() always exists. The UXP
// plugins work the path out lazily, inside the auth callback's try/catch, so a
// host whose os module lacks homedir() still loads the plugin.
const CEP_DECLARATION = /const TOKEN_PATH = ([\s\S]*?);\n/;
const UXP_DECLARATION = /const proxyTokenPath = \(\) => ([\s\S]*?);\n/;
const JS_CONSUMERS = [
    ["cep/com.mikechambers.ai/main.js", CEP_DECLARATION],
    ["cep/com.mikechambers.ae/main.js", CEP_DECLARATION],
    ["uxp/ps/main.js", UXP_DECLARATION],
    ["uxp/id/main.js", UXP_DECLARATION],
    ["uxp/pr/main.js", UXP_DECLARATION],
];

for (const [file, declaration] of JS_CONSUMERS) {
    test(`${file} reads the token from the proxy's token path`, () => {
        const source = fs.readFileSync(path.join(ROOT, file), "utf8");
        const m = source.match(declaration);
        assert.ok(m, `no token path declared as ${declaration} in this file`);
        const modules = { os, path };
        const value = vm.runInNewContext(m[1], { require: (name) => modules[name], os });
        assert.equal(path.normalize(value), path.normalize(TOKEN_PATH));
    });
}

test("mcp/socket_client.py reads the token from the proxy's token path", (t) => {
    const source = fs.readFileSync(path.join(ROOT, "mcp", "socket_client.py"), "utf8");
    const m = source.match(/^TOKEN_PATH = (.+)$/m);
    assert.ok(m, "no TOKEN_PATH in socket_client.py");
    const r = spawnSync("python3", ["-c", `import os; print(${m[1]})`], { encoding: "utf8" });
    if (r.error) {
        t.skip("python3 is not available");
        return;
    }
    assert.equal(r.status, 0, r.stderr);
    assert.equal(path.normalize(r.stdout.trim()), path.normalize(TOKEN_PATH));
});
