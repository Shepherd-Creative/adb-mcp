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

// O_NOFOLLOW refuses a symlink, so the checks below run on the file itself.
// Windows has no O_NOFOLLOW and no POSIX owner or mode: there the proxy
// relies on the home directory's own permissions.
function openToken(tokenPath) {
    return fs.openSync(tokenPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
}

// Another user who could write to the directory could swap the token file.
function checkDirectory(dir) {
    const st = fs.statSync(dir);
    if (!st.isDirectory()) {
        throw new Error(`${dir} is not a directory`);
    }
    if (process.platform === "win32") return;
    if (st.uid !== process.getuid()) {
        throw new Error(`${dir} belongs to another user`);
    }
    if (st.mode & 0o022) {
        const mode = (st.mode & 0o777).toString(8);
        throw new Error(`${dir} is writable by other users (mode ${mode}); run chmod 700 on it`);
    }
}

// Writes a new token to a temporary file, then links it into place. link()
// fails if the token file exists, so an existing token is never replaced, and
// the token file only ever appears complete: a crash, or a second proxy
// starting at the same moment, cannot leave an empty one behind. Returns
// false when another process created the file first.
function createTokenFile(tokenPath) {
    const tmp = `${tokenPath}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    const data = crypto.randomBytes(32).toString("hex") + "\n";
    const fd = fs.openSync(tmp, "wx", 0o600);
    try {
        if (fs.writeSync(fd, data) !== Buffer.byteLength(data)) {
            throw new Error(`could not write ${tmp}`);
        }
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    try {
        fs.linkSync(tmp, tokenPath);
        return true;
    } catch (e) {
        if (e.code === "EEXIST") return false;
        throw e;
    } finally {
        fs.unlinkSync(tmp);
    }
}

// Returns { token, created }. Creates the token file if it does not exist, and
// refuses one that another user could have read or replaced.
function loadOrCreateToken(tokenPath = TOKEN_PATH) {
    const dir = path.dirname(tokenPath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    checkDirectory(dir);

    let created = false;
    let fd;
    try {
        fd = openToken(tokenPath);
    } catch (e) {
        if (e.code !== "ENOENT") throw e;
        created = createTokenFile(tokenPath);
        fd = openToken(tokenPath);
    }
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

// socket.io's debug output logs whole packets, and a client's CONNECT packet
// carries its token (socket.io-parser logs "decoded ... as ...").
function debugOutputWarning(env = process.env) {
    if (!env.DEBUG) return null;
    return (
        "DEBUG is set: socket.io debug output can include each client's token. " +
        "Do not share this output, and unset DEBUG when you are done."
    );
}

module.exports = {
    ALLOWED_ORIGINS,
    TOKEN_PATH,
    createTokenFile,
    debugOutputWarning,
    isOriginAllowed,
    loadOrCreateToken,
    tokenMatches,
};
