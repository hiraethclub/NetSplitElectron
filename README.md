# NetSplitElectron

**NetSplitElectron** is a cross-platform **Electron port of
[Netsplit](https://github.com/richstokes/Netsplit)**, the modern macOS IRC
client — rebuilt so it runs on **Linux and Windows** while keeping the look and
feel of the original as close as possible.

The original is a native Swift/SwiftUI app and only runs on macOS. This port
reproduces its three-pane workspace (connections · transcript · members), its
16 hand-tuned color themes, and a working IRC core, in a single Electron app.

![NetSplitElectron](docs/screenshot.png)

## Status

This is a faithful first port of the **look and the core client**. It connects to
real IRC networks over TLS, joins channels, tracks members, and speaks the common
command set. A few macOS-platform-specific features from the original are noted as
follow-ups below.

### Implemented

- **Three-pane UI** matching the original: connections sidebar with per-server
  groups and status dots, message transcript with aligned timestamp / nickname /
  text columns, and a members list with operator/voice prefixes and role badges.
- **All 16 appearances** ported 1:1 from the Swift theme files
  (System, Light, Dark, Catppuccin Latte/Mocha, Everforest Light, GitHub
  Light/Dark, Gruvbox Dark, Nord, Rosé Pine / Dawn, Solarized Sepia, Cyberpunk,
  C64, Greyscale, Lobster), including the deterministic FNV-1a nickname coloring.
- **Real IRC** over TLS or plain TCP (Node `tls`/`net` in the main process),
  with RFC 1459 + IRCv3 message-tag parsing, ISUPPORT/PREFIX handling, CTCP
  ACTION and auto-replies (VERSION/PING/TIME), and PING/PONG keepalive.
- **Channels & DMs**: join/part, topics, NAMES, JOIN/PART/QUIT/KICK/NICK/MODE
  tracking, private messages, server notices, unread badges, and mention
  highlighting.
- **Commands**: `/server /join /part /msg /query /me /notice /nick /topic /whois
  /who /mode /kick /invite /away /quit /connect /clear /raw` and pass-through of
  any other command straight to the server. You can connect entirely by typing —
  `/server irc.libera.chat` opens a network, then `/join #channel` from the
  server console — no dialog required.
- **Command palette** (⌘/Ctrl+K) to jump between servers, channels, and DMs.
- **Channel browser**: `/list` opens a searchable, sortable list of the network's
  channels; click one to join.
- **Right-click management**: connect / disconnect / reconnect / remove a server,
  leave or close a channel or DM, whois or message a member. Double-click a
  server row to (re)connect.
- **Auto-reconnect** with capped exponential backoff after an unexpected drop;
  channels you were in are rejoined automatically.
- **Desktop notifications** for direct messages and mentions when the window
  isn't focused; unread counts appear in the window title. Mentions are matched
  on whole-word nick boundaries.
- **Composer niceties**: input history (↑/↓), Tab completion for both command
  names and nicknames (repeat Tab to cycle), click a nickname to open a DM, and
  link detection that opens in the system browser.
- **SSH tunnel connections**: reach an IRC network through an SSH bastion with a
  local port-forward. Password or private-key (Ed25519 / RSA) auth, optional key
  passphrase, and trust-on-first-use host-key pinning (a changed host key aborts
  the connection).
- **Secure credential storage**: server and SSH passwords, private keys, and key
  passphrases are encrypted at rest with the OS keychain via Electron
  `safeStorage` (macOS Keychain, Windows DPAPI, Linux libsecret/kwallet) — never
  written to disk in plain text. If no OS keychain is available, secrets are kept
  in memory for the session only and you're warned.
- **Settings** (⚙): message spacing (compact/comfortable), chat font
  (system/rounded/monospaced), 12- or 24-hour clock, show/hide timestamps,
  colored nicknames, and desktop-notification toggle — all persisted.
- **Demo Server** — an offline sample network (File → Load Demo Server) so you
  can preview the client without connecting.

### Deferred (follow-ups)

- Rich link-preview cards, the full 40+ moderation command set, and per-server
  on-connect automation (e.g. NickServ/ChanServ scripts).

## Running

Requires Node.js 18+.

```bash
npm install
npm start
```

On Linux you may need `--no-sandbox` in some containerized environments; a normal
desktop install does not.

## Building installers

```bash
npm run dist:linux   # AppImage + .deb
npm run dist:win     # NSIS installer
```

Output lands in `dist/`. See [electron-builder](https://www.electron.build/) for
signing and additional target formats.

## Project layout

```
src/
  main/
    main.js            Electron main process: window, menu, IPC, safeStorage
    ircConnection.js   One TCP/TLS socket per server (optionally via SSH tunnel)
  preload/
    preload.js         contextBridge surface (no Node access in renderer)
  renderer/
    index.html         Three-pane layout + modals
    styles.css         Theme-variable-driven styling
    themes.js          All 16 palettes + nickname hashing
    ircProtocol.js     IRC message / CTCP / ISUPPORT parsing
    app.js             State, protocol handling, rendering, commands
```

## Credits

Original macOS app **Netsplit** by [Rich Stokes](https://github.com/richstokes/Netsplit).
This is an independent cross-platform port and is not affiliated with or endorsed
by the original author.

## License

MIT
