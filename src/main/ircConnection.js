'use strict';

const net = require('net');
const tls = require('tls');

/**
 * A single IRC network socket. Owns the TCP/TLS connection and line framing.
 * Protocol parsing and all client state live in the renderer; this class only
 * moves bytes and emits complete lines. One instance per server profile.
 */
class IRCConnection {
  /**
   * @param {string} id          server profile id
   * @param {object} options     { host, port, tls, tlsInsecure }
   * @param {(id, event, payload) => void} emit  callback into the main process
   */
  constructor(id, options, emit) {
    this.id = id;
    this.options = options;
    this.emit = emit;
    this.socket = null;
    this.buffer = '';
    this.closedByClient = false;
  }

  connect() {
    this.closedByClient = false;
    const { host, port, tls: useTls, tlsInsecure } = this.options;

    const onConnect = () => {
      this.emit(this.id, 'open', { host, port });
    };

    try {
      if (useTls) {
        this.socket = tls.connect(
          {
            host,
            port,
            servername: host,
            // Self-signed / unknown-CA IRC servers are common. When the user
            // opts into "accept invalid certificates" we still connect but
            // report the certificate so the UI can warn.
            rejectUnauthorized: !tlsInsecure,
          },
          onConnect
        );
      } else {
        this.socket = net.connect({ host, port }, onConnect);
      }
    } catch (err) {
      this.emit(this.id, 'error', { message: err.message });
      return;
    }

    this.socket.setEncoding('utf8');
    this.socket.setKeepAlive(true, 30000);

    this.socket.on('data', (chunk) => this.onData(chunk));
    this.socket.on('error', (err) => {
      this.emit(this.id, 'error', { message: err.message });
    });
    this.socket.on('close', () => {
      this.emit(this.id, 'close', { byClient: this.closedByClient });
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    // IRC lines are terminated by CR LF, but be liberal about lone LF.
    let index;
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      let line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.length > 0) {
        this.emit(this.id, 'line', { line });
      }
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
      try {
        this.socket.end();
      } catch (_) {
        /* ignore */
      }
      // Force teardown shortly after a graceful end in case the server stalls.
      setTimeout(() => {
        if (this.socket && !this.socket.destroyed) this.socket.destroy();
      }, 2000);
    }
  }
}

module.exports = { IRCConnection };
