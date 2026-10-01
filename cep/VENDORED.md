# Vendored files in the CEP panels

The Illustrator and After Effects panels used to load Socket.IO from
`https://cdn.socket.io/4.7.2/socket.io.min.js`. Both panels run with Node.js
enabled (`--enable-nodejs --mixed-context`), so whatever that URL served ran
with full access to the machine. They now load a local copy.

| File | Version | sha384 (SRI form) |
|---|---|---|
| `com.mikechambers.ai/lib/socket.io.min.js` | socket.io-client 4.7.2 | `sha384-mZLF4UVrpi/QTWPA7BjNPEnkIfRFn4ZEO3Qt/HFklTJBj/gBOV8G3HcKn4NfQblz` |
| `com.mikechambers.ae/lib/socket.io.min.js` | socket.io-client 4.7.2 | same file |

4.7.2 is the version the panels already ran, so behaviour is unchanged.

## Where it came from and how it was checked (2026-09-29)

- Source: `package/dist/socket.io.min.js` in
  `https://registry.npmjs.org/socket.io-client/-/socket.io-client-4.7.2.tgz`.
- The tarball's sha512 equals the registry's `dist.integrity`
  (`sha512-vtA0uD4ibrYD793SOIAwlo8cj6haOeMHrGvwPxJsxH7CeIksqJ+3Zc06RvWTIFgiSqx4A3sOnTXpfAEE2Zyz6w==`).
- The registry's ECDSA signature over `socket.io-client@4.7.2:<integrity>`
  verifies with npm key `SHA256:jl3bwswu80PjjokCgh0o2w5c2U4LhQAE57gj9cz1kzA`
  (4.7.2 was published 2023-08-02, before that key expired on 2025-01-29).
- The file is byte-identical to the CDN copy the panels loaded (49,732 bytes).
- Its sha384 equals the SRI hash socket.io published for 4.7.2
  (socketio/socket.io-website, commit `5d0923e`, client-installation docs).

`adb-proxy-socket/test/vendored.test.js` fails if either copy changes or a
panel loads a script from the network again. `.gitattributes` marks the files
`-text` so no checkout rewrites their line endings.

## Updating

Replace both copies from the npm tarball of the new version, repeat the checks
above, then update the hash here and in the test.
