### Security

The proxy listens on loopback only, on both `127.0.0.1:3002` and
`[::1]:3002`, and every client must present a shared token. It holds both
addresses because clients dial `localhost`, which resolves to `::1` first on
macOS: another program listening on `[::1]:3002` would receive their tokens.
It refuses to start if either address is taken, and it does not serve the
socket.io client script.

- On first start the proxy creates `~/.config/adb-mcp/token` (directory 0700,
  file 0600). It refuses to start if the directory is writable by other
  users, or if the file is open to other users, is a symlink or holds no
  valid token. On Windows the owner and mode checks do not apply.
- Clients read the file themselves and send it in the socket.io `auth`
  payload: `mcp/socket_client.py` and the panels in `cep/` and `uxp/`.
  Nothing prints it.
- To rotate it, stop the proxy, delete the file and start the proxy again.
  Clients pick up the new token on their next connection attempt; a panel
  that was refused needs a click on Connect.
- WebSocket handshakes from a browser Origin are refused. Allowed: no Origin
  (non-browser clients), `file://` (CEP panels) and `http://localhost:3002`
  (python-socketio: connect to `localhost`, because `127.0.0.1` sends an
  Origin the proxy refuses). The proxy accepts WebSocket only, no polling.
- A request that carries an engine.io session id is refused. The proxy never
  upgrades a transport, and such a request would join an existing session
  without the token or an allowed Origin.

Three things can undo this:

- A stopped proxy. While it is stopped, any program that takes port 3002
  receives the token from every client that connects, panels retrying in the
  background included. Rotate the token if that may have happened.

- Debug output. With `DEBUG` set (for example `DEBUG=socket.io*`), socket.io
  logs whole packets, including each client's token; the proxy prints a
  warning at start when `DEBUG` is set. The same goes for
  `engineio_logger=True` in python-socketio and for `localStorage.debug` in
  the UXP plugins, which load an unminified socket.io.
- A DevTools port. The CEP panels run Node.js and open no DevTools port. To
  debug one, add a `.debug` file next to its `index.html` and delete it
  afterwards: with PlayerDebugMode on, anything on this Mac can use that
  port to run code in the panel, token or not.

### Tests

```
npm test                      # offline: token file, Origin policy, vendored files
ADB_PROXY_LIVE=1 npm test     # also starts the proxy on :3002 and probes it
```

The live suite refuses to run while another proxy holds port 3002.

### Package

In order to package executables:

```
npm install -g pkg
pkg .
```
