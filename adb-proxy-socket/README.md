### Security

The proxy listens on `127.0.0.1:3002` only, and every client must present a
shared token:

- On first start the proxy creates `~/.config/adb-mcp/token` (directory 0700,
  file 0600). It refuses to start if that file is open to other users, is a
  symlink or holds no valid token.
- Clients read the file themselves and send it in the socket.io `auth`
  payload: `mcp/socket_client.py` and the panels in `cep/` and `uxp/`.
  Nothing prints it.
- To rotate it, stop the proxy, delete the file and start the proxy again.
  Clients pick up the new token on their next connection attempt; a panel
  that was refused needs a click on Connect.
- WebSocket handshakes from a browser Origin are refused. Allowed: no Origin
  (non-browser clients), `file://` (CEP panels) and `http://localhost:3002`
  (python-socketio). The proxy accepts WebSocket only, no polling.

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
