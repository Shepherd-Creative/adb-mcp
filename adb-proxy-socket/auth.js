/* Shared-secret token and Origin checks for the adb-mcp proxy.
 *
 * The token lives outside the repo, in a file only this user can read. The
 * proxy creates it on first start; every client reads it and sends it in the
 * socket.io `auth` payload. Never log it.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TOKEN_PATH = path.join(os.homedir(), ".config", "adb-mcp", "token");
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

// Origins the proxy's own clients send, measured 2026-09-25:
//   "file://"                the Illustrator CEP panel (its page is a local file)
//   "http://localhost:3002"  python-socketio, used by the MCP servers
// A handshake with no Origin comes from a non-browser client: browsers always
// send one on a WebSocket handshake, and the proxy accepts WebSocket only.
// "null" (sandboxed frames, some file pages) is never allowed.
const ALLOWED_ORIGINS = new Set(["file://", "http://localhost:3002"]);

function isOriginAllowed(origin) {
    return origin === undefined || ALLOWED_ORIGINS.has(origin);
}

// Returns { token, created }. Creates the token file if it does not exist, and
// refuses one that another user could have read or replaced.
function loadOrCreateToken(tokenPath = TOKEN_PATH) {
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true, mode: 0o700 });

    let created = false;
    try {
        // "wx" fails if the file exists, so an existing token is never replaced.
        const fd = fs.openSync(tokenPath, "wx", 0o600);
        try {
            fs.writeSync(fd, crypto.randomBytes(32).toString("hex") + "\n");
        } finally {
            fs.closeSync(fd);
        }
        created = true;
    } catch (e) {
        if (e.code !== "EEXIST") throw e;
    }

    // O_NOFOLLOW refuses a symlink, and the checks run on the open file itself.
    const fd = fs.openSync(
        tokenPath,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    );
    try {
        const st = fs.fstatSync(fd);
        if (!st.isFile()) {
            throw new Error(`${tokenPath} is not a regular file`);
        }
        if (process.platform !== "win32") {
            if (st.uid !== process.getuid()) {
                throw new Error(`${tokenPath} belongs to another user`);
            }
            if (st.mode & 0o077) {
                const mode = (st.mode & 0o777).toString(8);
                throw new Error(
                    `${tokenPath} is open to other users (mode ${mode}); ` +
                        `delete it and restart the proxy to create a new token`
                );
            }
        }
        const token = fs.readFileSync(fd, "utf8").trim();
        if (!TOKEN_PATTERN.test(token)) {
            throw new Error(
                `${tokenPath} does not hold a valid token; ` +
                    `delete it and restart the proxy to create a new one`
            );
        }
        return { token, created };
    } finally {
        fs.closeSync(fd);
    }
}

// Constant-time comparison. Hashing first makes both sides the same length.
function tokenMatches(expected, given) {
    if (typeof given !== "string") return false;
    const a = crypto.createHash("sha256").update(given).digest();
    const b = crypto.createHash("sha256").update(expected).digest();
    return crypto.timingSafeEqual(a, b);
}

module.exports = {
    ALLOWED_ORIGINS,
    TOKEN_PATH,
    isOriginAllowed,
    loadOrCreateToken,
    tokenMatches,
};
