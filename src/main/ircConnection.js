'use strict';

const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { Client: SSHClient } = require('ssh2');

/**
 * A single IRC network socket. Owns the TCP/TLS connection (optionally through
 * an SSH tunnel) and line framing. Protocol parsing and all client state live
 * in the renderer; this class only moves bytes and emits complete lines.
 *
 * @param {string} id      server profile id
 * @param {object} options { host, port, tls, tlsInsecure, ssh? }
 *   ssh: { host, port, username, auth:'password'|'key', password, privateKey,
 *          passphrase, pinnedHostKey }
 * @param {(id, event, payload) => void} emit
 */
class IRCConnection {
  constructor(id, options, emit) {
    this.id = id;
    this.options = options;
    this.emit = emit;
    this.socket = null;      // the IRC-carrying duplex (TLS socket, TCP socket, or SSH stream)
    this.sshClient = null;
    this.buffer = '';
    this.closedByClient = false;
  }

  connect() {
    this.closedByClient = false;
    if (this.options.ssh && this.options.ssh.host) this.connectViaSsh();
    else this.connectDirect();
  }

  // --- Direct TCP / TLS ---
  connectDirect() {
    const { host, port, tls: useTls, tlsInsecure } = this.options;
    let socket;
    try {
      if (useTls) {
        socket = tls.connect(
          { host, port, servername: host, rejectUnauthorized: !tlsInsecure },
          () => this.emitOpen(host, port)
        );
      } else {
        socket = net.connect({ host, port }, () => this.emitOpen(host, port));
      }
    } catch (err) {
      this.emit(this.id, 'error', { message: err.message });
      return;
    }
    this.bindSocket(socket);
  }

  // --- IRC through an SSH tunnel (local port-forward) ---
  connectViaSsh() {
    const ssh = this.options.ssh;
    const conn = new SSHClient();
    this.sshClient = conn;

    const cfg = {
      host: ssh.host,
      port: ssh.port || 22,
      username: ssh.username,
      readyTimeout: 20000,
      keepaliveInterval: 30000,
      // Trust-on-first-use host key pinning.
      hostVerifier: (keyBuffer) => {
        const digest = crypto.createHash('sha256').update(keyBuffer).digest('base64').replace(/=+$/, '');
        const fingerprint = 'SHA256:' + digest;
        if (ssh.pinnedHostKey) {
          if (ssh.pinnedHostKey === fingerprint) return true;
          this.emit(this.id, 'error', {
            message: `SSH host key mismatch! Pinned ${ssh.pinnedHostKey} but server offered ${fingerprint}. Refusing to connect.`,
          });
          return false;
        }
        this.emit(this.id, 'sshHostKey', { fingerprint });
        return true;
      },
    };
    if (ssh.auth === 'key' && ssh.privateKey) {
      cfg.privateKey = ssh.privateKey;
      if (ssh.passphrase) cfg.passphrase = ssh.passphrase;
    } else {
      cfg.password = ssh.password || '';
      cfg.tryKeyboard = true;
    }

    conn.on('ready', () => {
      conn.forwardOut('127.0.0.1', 0, this.options.host, this.options.port, (err, stream) => {
        if (err) {
          this.emit(this.id, 'error', { message: 'SSH port-forward failed: ' + err.message });
          conn.end();
          return;
        }
        const { host, port, tls: useTls, tlsInsecure } = this.options;
        if (useTls) {
          const tlsSocket = tls.connect(
            { socket: stream, servername: host, rejectUnauthorized: !tlsInsecure },
            () => this.emitOpen(host, port)
          );
          this.bindSocket(tlsSocket);
        } else {
          this.bindSocket(stream);
          this.emitOpen(host, port);
        }
      });
    });
    conn.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
      finish(prompts.map(() => ssh.password || ''));
    });
    conn.on('error', (err) => this.emit(this.id, 'error', { message: 'SSH: ' + err.message }));
    conn.on('close', () => {
      // If the IRC stream never bound, surface the SSH close as the connection close.
      if (!this.socket) this.emit(this.id, 'close', { byClient: this.closedByClient });
    });

    try {
      conn.connect(cfg);
    } catch (err) {
      this.emit(this.id, 'error', { message: 'SSH: ' + err.message });
    }
  }

  emitOpen(host, port) {
    this.emit(this.id, 'open', { host, port });
  }

  bindSocket(socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    if (typeof socket.setKeepAlive === 'function') {
      try { socket.setKeepAlive(true, 30000); } catch (_) { /* streams may not support it */ }
    }
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', (err) => this.emit(this.id, 'error', { message: err.message }));
    socket.on('close', () => {
      this.emit(this.id, 'close', { byClient: this.closedByClient });
      if (this.sshClient) { try { this.sshClient.end(); } catch (_) {} this.sshClient = null; }
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      let line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.length > 0) this.emit(this.id, 'line', { line });
    }
  }

  /** Write a raw IRC command (without trailing CRLF). */
  send(command) {
    if (!this.socket || this.socket.destroyed) return false;
    try {
      this.socket.write(command + '\r\n');
      return true;
    } catch (err) {
      this.emit(this.id, 'error', { message: err.message });
      return false;
    }
  }

  disconnect() {
    this.closedByClient = true;
    if (this.socket && !this.socket.destroyed) {
      try { this.socket.end(); } catch (_) { /* ignore */ }
      setTimeout(() => {
        if (this.socket && !this.socket.destroyed) this.socket.destroy();
      }, 2000);
    }
    if (this.sshClient) {
      try { this.sshClient.end(); } catch (_) { /* ignore */ }
      this.sshClient = null;
    }
  }
}

module.exports = { IRCConnection };
