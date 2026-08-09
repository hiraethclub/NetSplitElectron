// IRC message parsing (RFC 1459 + IRCv3 message tags) and small helpers.
// Runs in the renderer; the main process only supplies raw lines.
// Wrapped in an IIFE so top-level declarations don't leak into the shared
// classic-script global scope (they'd collide with app.js's imports).

(function () {
'use strict';

/**
 * Parse a raw IRC line into structured fields.
 * @returns {{tags:Object, prefix:string, nick:string, user:string, host:string,
 *            command:string, params:string[]}}
 */
function parseMessage(line) {
  let rest = line;
  const tags = {};
  let prefix = '';
  let nick = '';
  let user = '';
  let host = '';

  // IRCv3 message tags: @key=value;key2=value2
  if (rest.startsWith('@')) {
    const end = rest.indexOf(' ');
    const tagStr = rest.slice(1, end);
    rest = rest.slice(end + 1).replace(/^ +/, '');
    for (const part of tagStr.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) {
        tags[part] = '';
      } else {
        tags[part.slice(0, eq)] = unescapeTagValue(part.slice(eq + 1));
      }
    }
  }

  // Source prefix: :nick!user@host or :servername
  if (rest.startsWith(':')) {
    const end = rest.indexOf(' ');
    prefix = rest.slice(1, end);
    rest = rest.slice(end + 1).replace(/^ +/, '');
    const bang = prefix.indexOf('!');
    const at = prefix.indexOf('@');
    if (bang !== -1) {
      nick = prefix.slice(0, bang);
      user = at !== -1 ? prefix.slice(bang + 1, at) : prefix.slice(bang + 1);
      host = at !== -1 ? prefix.slice(at + 1) : '';
    } else if (at !== -1) {
      nick = prefix.slice(0, at);
      host = prefix.slice(at + 1);
    } else {
      nick = prefix;
    }
  }

  // Command + params. Trailing param starts at " :".
  const params = [];
  while (rest.length > 0) {
    if (rest.startsWith(':')) {
      params.push(rest.slice(1));
      break;
    }
    const sp = rest.indexOf(' ');
    if (sp === -1) {
      params.push(rest);
      break;
    }
    params.push(rest.slice(0, sp));
    rest = rest.slice(sp + 1).replace(/^ +/, '');
  }

  const command = params.shift() || '';
  return { tags, prefix, nick, user, host, command: command.toUpperCase(), params };
}

function unescapeTagValue(v) {
  return v
    .replace(/\\:/g, ';')
    .replace(/\\s/g, ' ')
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\\\/g, '\\');
}

// CTCP: \x01ACTION does something\x01  → { type, text }
function parseCTCP(text) {
  if (text.length >= 2 && text.charCodeAt(0) === 1 && text.charCodeAt(text.length - 1) === 1) {
    const inner = text.slice(1, -1);
    const sp = inner.indexOf(' ');
    if (sp === -1) return { type: inner.toUpperCase(), text: '' };
    return { type: inner.slice(0, sp).toUpperCase(), text: inner.slice(sp + 1) };
  }
  return null;
}

// Parse RPL_ISUPPORT (005) tokens into a features object.
function parseISupport(tokens, features) {
  for (const token of tokens) {
    if (token.includes('=')) {
      const [key, value] = token.split(/=(.*)/);
      features[key.toUpperCase()] = value;
    } else {
      features[token.toUpperCase()] = true;
    }
  }
  return features;
}

// Channel-name test using the server's CHANTYPES (defaults to #&).
function isChannelName(name, features) {
  const prefixes = (features && features.CHANTYPES) || '#&';
  return name.length > 0 && prefixes.includes(name[0]);
}

// Strip mIRC color/formatting control codes for display.
function stripFormatting(text) {
  return text
    .replace(/\x03\d{0,2}(,\d{0,2})?/g, '') // color
    .replace(/[\x02\x1D\x1F\x16\x0F\x11\x1E]/g, ''); // bold/italic/underline/reverse/reset/mono/strike
}

// Membership prefix symbols → mode letters, and ranking.
const PREFIX_MODES = { '~': 'q', '&': 'a', '@': 'o', '%': 'h', '+': 'v' };
const MODE_RANK = { q: 5, a: 4, o: 3, h: 2, v: 1 };
const ROLE_NAMES = { q: 'Owner', a: 'Admin', o: 'Operator', h: 'Half-Op', v: 'Voice' };

// Parse a PREFIX=(modes)symbols ISUPPORT token into {symbol: mode} map.
function parsePrefixMap(features) {
  const raw = features && features.PREFIX;
  if (typeof raw === 'string') {
    const m = raw.match(/\(([^)]*)\)(.*)/);
    if (m) {
      const modes = m[1];
      const symbols = m[2];
      const map = {};
      for (let i = 0; i < symbols.length && i < modes.length; i++) map[symbols[i]] = modes[i];
      return map;
    }
  }
  return PREFIX_MODES;
}

const api = {
  parseMessage, parseCTCP, parseISupport, isChannelName, stripFormatting,
  parsePrefixMap, PREFIX_MODES, MODE_RANK, ROLE_NAMES,
};
if (typeof window !== 'undefined') window.IRCProtocol = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
