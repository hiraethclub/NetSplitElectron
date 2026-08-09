// Netsplit renderer — application state, IRC protocol handling, and UI.
'use strict';

const {
  parseMessage, parseCTCP, parseISupport, isChannelName, stripFormatting,
  parsePrefixMap, MODE_RANK, ROLE_NAMES,
} = window.IRCProtocol;
const Themes = window.NetsplitThemes;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  servers: [],          // [{ id, name, host, port, tls, tlsInsecure, nick, realname, pass,
                        //    channelsToJoin, status, features, prefixMap, currentNick,
                        //    targets: Map<key, target> }]
  selection: null,      // { serverId, target } | null
  systemIsDark: true,
  themeKey: 'dark',
  palette: null,
  membersVisible: true,
};

// A "target" is a channel, DM, or the server console.
// { name, kind: 'channel'|'dm'|'server', topic, messages: [], members: Map<lower,member>, unread, highlight }

function loadPrefs() {
  try {
    const t = localStorage.getItem('netsplit.theme');
    if (t) state.themeKey = t;
    const m = localStorage.getItem('netsplit.membersVisible');
    if (m !== null) state.membersVisible = m === 'true';
  } catch (_) { /* ignore */ }
}
function savePref(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }

function loadSavedServers() {
  try {
    const raw = localStorage.getItem('netsplit.servers');
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (_) { return []; }
}
function persistServers() {
  const data = state.servers.map((s) => ({
    id: s.id, name: s.name, host: s.host, port: s.port, tls: s.tls,
    tlsInsecure: s.tlsInsecure, nick: s.nick, realname: s.realname,
    channelsToJoin: s.channelsToJoin, pass: s.pass || '',
  }));
  savePref('netsplit.servers', JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const el = (id) => document.getElementById(id);
const dom = {
  sidebarList: el('sidebarList'),
  connectionsTitle: el('connectionsTitle'),
  activeCount: el('activeCount'),
  transcript: el('transcript'),
  emptyState: el('emptyState'),
  emptyTitle: el('emptyTitle'),
  emptyBody: el('emptyBody'),
  conversationHeader: el('conversationHeader'),
  conversationAvatar: el('conversationAvatar'),
  conversationTitle: el('conversationTitle'),
  conversationSubtitle: el('conversationSubtitle'),
  composer: el('composer'),
  composerInput: el('composerInput'),
  sendBtn: el('sendBtn'),
  members: el('members'),
  membersList: el('membersList'),
  membersCount: el('membersCount'),
  memberFilter: el('memberFilter'),
  toolbarTitle: el('toolbarTitle'),
  toggleMembers: el('toggleMembers'),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const lower = (s) => String(s).toLowerCase();

function getServer(id) { return state.servers.find((s) => s.id === id); }

function targetKey(name) { return lower(name); }

function getTarget(server, name) {
  return server.targets.get(targetKey(name));
}

function ensureTarget(server, name, kind) {
  const key = targetKey(name);
  let t = server.targets.get(key);
  if (!t) {
    t = { name, kind, topic: '', messages: [], members: new Map(), unread: 0, highlight: false };
    server.targets.set(key, t);
  }
  return t;
}

function serverConsole(server) {
  return ensureTarget(server, server.name, 'server');
}

function formatTime(date) {
  let h = date.getHours();
  const m = date.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

function isSelected(serverId, targetName) {
  return state.selection && state.selection.serverId === serverId &&
    targetKey(state.selection.target) === targetKey(targetName);
}

// ---------------------------------------------------------------------------
// Message model + append
// ---------------------------------------------------------------------------

function addMessage(server, targetName, msg) {
  const kind = msg.forceKind ||
    (isChannelName(targetName, server.features) ? 'channel'
      : targetName === server.name ? 'server' : 'dm');
  const t = ensureTarget(server, targetName, kind);
  const message = {
    id: uid(),
    time: msg.time || new Date(),
    sender: msg.sender || '',
    text: msg.text || '',
    type: msg.type || 'message', // message|action|notice|system|self
    nickKey: msg.nickKey || msg.sender,
  };
  t.messages.push(message);
  if (t.messages.length > 2000) t.messages.shift();

  const selected = isSelected(server.id, targetName);
  const focused = selected && document.hasFocus();
  if (selected) {
    appendMessageRow(t, message, true);
  } else if (message.type !== 'system') {
    t.unread += 1;
    if (isHighlight(server, message)) t.highlight = true;
    renderSidebar();
  }
  if (!focused) maybeNotify(server, t, message);
  updateWindowTitle();
  return message;
}

// Desktop notification for a direct message or a highlight, when the relevant
// conversation isn't already in front of the user.
function maybeNotify(server, target, message) {
  if (typeof Notification === 'undefined') return;
  if (message.type === 'system' || message.type === 'self') return;
  if (isMe(server, message.sender)) return;
  const isDM = target.kind === 'dm';
  if (!isDM && !isHighlight(server, message)) return;
  if (Notification.permission === 'denied') return;
  const show = () => {
    try {
      const title = isDM ? `${message.sender} (DM)` : `${message.sender} in ${target.name}`;
      const body = message.type === 'action' ? `${message.sender} ${message.text}` : message.text;
      const n = new Notification(title, { body, silent: false });
      n.onclick = () => {
        window.netsplit.focusWindow();
        selectTarget(server.id, target.name);
      };
    } catch (_) { /* ignore */ }
  };
  if (Notification.permission === 'granted') show();
  else Notification.requestPermission().then((p) => { if (p === 'granted') show(); });
}

// Reflect total unread in the window/tab title.
function updateWindowTitle() {
  let unread = 0;
  for (const server of state.servers) {
    for (const t of server.targets.values()) unread += t.unread;
  }
  dom.toolbarTitle.textContent = unread > 0 ? `Netsplit (${unread})` : 'Netsplit';
  document.title = unread > 0 ? `Netsplit (${unread})` : 'Netsplit';
}

function systemMessage(server, targetName, text) {
  return addMessage(server, targetName, { sender: '', text, type: 'system' });
}

function isHighlight(server, message) {
  if (!server.currentNick) return false;
  if (message.type !== 'message' && message.type !== 'action') return false;
  if (isMe(server, message.sender)) return false; // don't highlight your own lines
  // Match the nick as a whole token so "rich" doesn't fire on "enriched".
  const nick = server.currentNick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return new RegExp(`(^|[^\\w])${nick}([^\\w]|$)`, 'i').test(message.text);
  } catch (_) {
    return lower(message.text).includes(lower(server.currentNick));
  }
}

// ---------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------

function addServerProfile(profile) {
  const server = {
    id: profile.id || uid(),
    name: profile.name || profile.host,
    host: profile.host,
    port: profile.port,
    tls: profile.tls,
    tlsInsecure: profile.tlsInsecure,
    nick: profile.nick,
    realname: profile.realname || profile.nick,
    pass: profile.pass || '',
    channelsToJoin: profile.channelsToJoin || [],
    status: 'disconnected',
    features: {},
    prefixMap: parsePrefixMap({}),
    currentNick: profile.nick,
    registered: false,
    targets: new Map(),
    reconnectAttempts: 0,
    reconnectTimer: null,
    manualDisconnect: false,
    channelList: null,       // collected /list results
    collectingList: false,
  };
  state.servers.push(server);
  serverConsole(server);
  return server;
}

async function connectServer(server) {
  if (server.reconnectTimer) { clearTimeout(server.reconnectTimer); server.reconnectTimer = null; }
  server.manualDisconnect = false;
  server.reconnectAttempts = 0;
  server.status = 'connecting';
  server.registered = false;
  systemMessage(server, server.name, `Connecting to ${server.host}:${server.port}…`);
  renderSidebar();
  await window.netsplit.connect(server.id, {
    host: server.host,
    port: server.port,
    tls: server.tls,
    tlsInsecure: server.tlsInsecure,
  });
}

// Auto-reconnect with capped exponential backoff after an unexpected drop.
const MAX_RECONNECT_ATTEMPTS = 6;
function scheduleReconnect(server) {
  if (server.manualDisconnect || server.reconnectTimer) return;
  if (server.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    systemMessage(server, server.name, 'Giving up automatic reconnection. Use /connect to retry.');
    return;
  }
  server.reconnectAttempts += 1;
  const delay = Math.min(3000 * 2 ** (server.reconnectAttempts - 1), 90000);
  systemMessage(server, server.name,
    `Reconnecting in ${Math.round(delay / 1000)}s (attempt ${server.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})…`);
  server.reconnectTimer = setTimeout(() => {
    server.reconnectTimer = null;
    if (server.manualDisconnect) return;
    server.status = 'connecting';
    server.registered = false;
    renderSidebar();
    window.netsplit.connect(server.id, {
      host: server.host, port: server.port, tls: server.tls, tlsInsecure: server.tlsInsecure,
    });
  }, delay);
}

function registerConnection(server) {
  if (server.pass) rawSend(server, `PASS ${server.pass}`);
  rawSend(server, `NICK ${server.nick}`);
  rawSend(server, `USER ${server.nick} 0 * :${server.realname || server.nick}`);
}

function rawSend(server, command) {
  return window.netsplit.send(server.id, command);
}

// ---------------------------------------------------------------------------
// IRC event handling (socket lifecycle + raw lines)
// ---------------------------------------------------------------------------

window.netsplit.onEvent(({ id, event, payload }) => {
  const server = getServer(id);
  if (!server) return;
  switch (event) {
    case 'open':
      server.status = 'registering';
      systemMessage(server, server.name, 'Connection established. Registering…');
      registerConnection(server);
      renderSidebar();
      break;
    case 'line':
      handleLine(server, payload.line);
      break;
    case 'error':
      systemMessage(server, server.name, `Error: ${payload.message}`);
      break;
    case 'close': {
      const wasConnected = server.status === 'connected' || server.status === 'registering';
      server.status = 'disconnected';
      server.registered = false;
      // Clear rosters so a later reconnect rebuilds them from fresh NAMES.
      for (const t of server.targets.values()) {
        if (t.kind === 'channel') t.members.clear();
      }
      systemMessage(server, server.name,
        payload.byClient ? 'Disconnected.' : 'Connection closed.');
      if (!payload.byClient && !server.manualDisconnect && wasConnected) scheduleReconnect(server);
      renderSidebar();
      if (isSelectedServer(server.id)) renderMembers();
      break;
    }
  }
});

function isSelectedServer(id) { return state.selection && state.selection.serverId === id; }

function handleLine(server, line) {
  const msg = parseMessage(line);
  const p = msg.params;

  switch (msg.command) {
    case 'PING':
      rawSend(server, `PONG :${p[0] || ''}`);
      return;
    case 'PONG':
      return;
    case 'CAP':
      // Minimal CAP negotiation: acknowledge and end so registration proceeds.
      if (p[1] === 'LS' || p[1] === 'NEW') rawSend(server, 'CAP END');
      return;
    case 'AUTHENTICATE':
      return;
    case '001': // RPL_WELCOME
      server.status = 'connected';
      server.registered = true;
      server.reconnectAttempts = 0;
      if (p[0]) server.currentNick = p[0];
      systemMessage(server, server.name, p[1] || 'Connected.');
      autoJoin(server);
      renderSidebar();
      break;
    case '002': case '003': case '004':
    case '250': case '251': case '252': case '253': case '254': case '255':
    case '265': case '266':
      systemMessage(server, server.name, p.slice(1).join(' '));
      break;
    case '005': // ISUPPORT
      parseISupport(p.slice(1, -1), server.features);
      server.prefixMap = parsePrefixMap(server.features);
      break;
    case '375': case '372': case '376': case '422': // MOTD
      if (p[1]) systemMessage(server, server.name, p[1]);
      break;
    case '332': // RPL_TOPIC
      handleTopicReply(server, p[1], p[2]);
      break;
    case '333': // topic set by/when — ignore details, keep it quiet
      break;
    case '353': // RPL_NAMREPLY
      handleNames(server, p);
      break;
    case '366': // RPL_ENDOFNAMES
      if (isSelected(server.id, p[1])) renderMembers();
      break;
    case '331': // RPL_NOTOPIC
      handleTopicReply(server, p[1], '');
      break;
    case 'JOIN': handleJoin(server, msg); break;
    case 'PART': handlePart(server, msg); break;
    case 'QUIT': handleQuit(server, msg); break;
    case 'NICK': handleNick(server, msg); break;
    case 'KICK': handleKick(server, msg); break;
    case 'MODE': handleMode(server, msg); break;
    case 'TOPIC': handleTopicChange(server, msg); break;
    case 'PRIVMSG': handlePrivmsg(server, msg, false); break;
    case 'NOTICE': handlePrivmsg(server, msg, true); break;
    case 'ERROR':
      systemMessage(server, server.name, `Error: ${p.join(' ')}`);
      break;
    case '433': // nick in use
      handleNickInUse(server, p);
      break;
    // --- WHOIS replies ---
    case '311': whoisLine(server, p[1], `${p[1]} is ${p[2]}@${p[3]} (${p[5] || ''})`); break;
    case '312': whoisLine(server, p[1], `${p[1]} is on ${p[2]} (${p[3] || ''})`); break;
    case '313': whoisLine(server, p[1], `${p[1]} is an IRC operator`); break;
    case '317': whoisLine(server, p[1], `${p[1]} has been idle ${p[2]}s`); break;
    case '319': whoisLine(server, p[1], `${p[1]} is on channels: ${p[2] || ''}`); break;
    case '330': whoisLine(server, p[1], `${p[1]} ${p[3] || 'is logged in as'} ${p[2]}`); break;
    case '338': whoisLine(server, p[1], `${p[1]} real host: ${p.slice(2).join(' ')}`); break;
    case '671': whoisLine(server, p[1], `${p[1]} is using a secure connection`); break;
    case '301': whoisLine(server, p[1], `${p[1]} is away: ${p[2] || ''}`); break;
    case '318': break; // end of WHOIS — nothing to print
    // --- LIST replies ---
    case '321': server.channelList = []; server.collectingList = true; break;
    case '322':
      if (server.collectingList) {
        server.channelList.push({ name: p[1], users: parseInt(p[2], 10) || 0, topic: stripFormatting(p[3] || '') });
      }
      break;
    case '323':
      server.collectingList = false;
      openChannelList(server);
      break;
    default:
      handleNumericFallback(server, msg);
      break;
  }
}

function whoisTargetName(server) {
  if (state.selection && state.selection.serverId === server.id) return state.selection.target;
  return server.name;
}
function whoisLine(server, _nick, text) {
  systemMessage(server, whoisTargetName(server), text);
}

function handleNumericFallback(server, msg) {
  // Numeric replies (3-digit) not explicitly handled: show on server console.
  if (/^\d{3}$/.test(msg.command)) {
    const text = msg.params.slice(1).join(' ');
    if (text) systemMessage(server, server.name, text);
  }
}

function autoJoin(server) {
  for (const ch of server.channelsToJoin) {
    if (ch && ch.trim()) rawSend(server, `JOIN ${ch.trim()}`);
  }
}

function handleNickInUse(server, p) {
  const attempted = p[1] || server.currentNick;
  systemMessage(server, server.name, `Nickname ${attempted} is in use.`);
  if (!server.registered) {
    const newNick = `${server.nick}_`;
    server.nick = newNick;
    server.currentNick = newNick;
    rawSend(server, `NICK ${newNick}`);
  }
}

function handleTopicReply(server, channel, topic) {
  if (!channel) return;
  const t = ensureTarget(server, channel, 'channel');
  t.topic = stripFormatting(topic || '');
  if (isSelected(server.id, channel)) renderConversationHeader();
}

function handleTopicChange(server, msg) {
  const channel = msg.params[0];
  const topic = stripFormatting(msg.params[1] || '');
  const t = ensureTarget(server, channel, 'channel');
  t.topic = topic;
  systemMessage(server, channel, `${msg.nick} changed the topic to: ${topic}`);
  if (isSelected(server.id, channel)) renderConversationHeader();
}

// --- Membership tracking ---

function memberFromToken(token, server) {
  let modes = new Set();
  let i = 0;
  while (i < token.length && server.prefixMap[token[i]]) {
    modes.add(server.prefixMap[token[i]]);
    i++;
  }
  const nickname = token.slice(i);
  return { nickname, modes };
}

function handleNames(server, params) {
  // 353: <me> <sym> <channel> :names...
  const channel = params[2];
  const names = (params[3] || '').trim().split(/\s+/).filter(Boolean);
  const t = ensureTarget(server, channel, 'channel');
  for (const token of names) {
    const m = memberFromToken(token, server);
    if (m.nickname) t.members.set(lower(m.nickname), m);
  }
}

function addMember(server, channel, nickname, modes) {
  const t = ensureTarget(server, channel, 'channel');
  if (!t.members.has(lower(nickname))) {
    t.members.set(lower(nickname), { nickname, modes: modes || new Set() });
  }
  if (isSelected(server.id, channel)) renderMembers();
}

function removeMember(server, channel, nickname) {
  const t = getTarget(server, channel);
  if (t) t.members.delete(lower(nickname));
  if (isSelected(server.id, channel)) renderMembers();
}

function renameMember(server, oldNick, newNick) {
  for (const t of server.targets.values()) {
    if (t.kind !== 'channel') continue;
    const m = t.members.get(lower(oldNick));
    if (m) {
      t.members.delete(lower(oldNick));
      m.nickname = newNick;
      t.members.set(lower(newNick), m);
      systemMessage(server, t.name, `${oldNick} is now known as ${newNick}`);
    }
  }
}

function isMe(server, nick) { return lower(nick) === lower(server.currentNick); }

function handleJoin(server, msg) {
  const channel = msg.params[0];
  if (isMe(server, msg.nick)) {
    ensureTarget(server, channel, 'channel');
    rememberJoinedChannel(server, channel);
    systemMessage(server, channel, `You joined ${channel}`);
    selectTarget(server.id, channel);
    rawSend(server, `MODE ${channel}`);
  } else {
    addMember(server, channel, msg.nick);
    systemMessage(server, channel, `${msg.nick} joined ${channel}`);
  }
}

function handlePart(server, msg) {
  const channel = msg.params[0];
  const reason = msg.params[1] ? ` (${msg.params[1]})` : '';
  if (isMe(server, msg.nick)) {
    forgetJoinedChannel(server, channel);
    systemMessage(server, channel, `You left ${channel}${reason}`);
  } else {
    removeMember(server, channel, msg.nick);
    systemMessage(server, channel, `${msg.nick} left ${channel}${reason}`);
  }
}

// Keep the set of channels to auto-(re)join in sync with what we're actually in.
function rememberJoinedChannel(server, channel) {
  if (!server.channelsToJoin.some((c) => targetKey(c) === targetKey(channel))) {
    server.channelsToJoin.push(channel);
    persistServers();
  }
}
function forgetJoinedChannel(server, channel) {
  const before = server.channelsToJoin.length;
  server.channelsToJoin = server.channelsToJoin.filter((c) => targetKey(c) !== targetKey(channel));
  if (server.channelsToJoin.length !== before) persistServers();
}

function handleQuit(server, msg) {
  const reason = msg.params[0] ? ` (${stripFormatting(msg.params[0])})` : '';
  for (const t of server.targets.values()) {
    if (t.kind === 'channel' && t.members.has(lower(msg.nick))) {
      t.members.delete(lower(msg.nick));
      systemMessage(server, t.name, `${msg.nick} quit${reason}`);
    }
  }
  if (state.selection && isSelectedServer(server.id)) renderMembers();
}

function handleNick(server, msg) {
  const newNick = msg.params[0];
  if (isMe(server, msg.nick)) {
    server.currentNick = newNick;
    server.nick = newNick;
    systemMessage(server, server.name, `You are now known as ${newNick}`);
  }
  renameMember(server, msg.nick, newNick);
  if (isSelectedServer(server.id)) renderMembers();
}

function handleKick(server, msg) {
  const channel = msg.params[0];
  const target = msg.params[1];
  const reason = msg.params[2] ? ` (${msg.params[2]})` : '';
  removeMember(server, channel, target);
  if (isMe(server, target)) {
    systemMessage(server, channel, `You were kicked by ${msg.nick}${reason}`);
  } else {
    systemMessage(server, channel, `${target} was kicked by ${msg.nick}${reason}`);
  }
}

function handleMode(server, msg) {
  const target = msg.params[0];
  if (!isChannelName(target, server.features)) return; // user mode; ignore for now
  const modeString = msg.params[1] || '';
  const args = msg.params.slice(2);
  applyChannelModes(server, target, modeString, args);
  const readable = [modeString, ...args].join(' ').trim();
  systemMessage(server, target, `${msg.nick || 'Server'} sets mode ${readable}`);
}

function applyChannelModes(server, channel, modeString, args) {
  const t = getTarget(server, channel);
  if (!t) return;
  let adding = true;
  let argIndex = 0;
  const prefixModes = new Set(Object.values(server.prefixMap));
  for (const ch of modeString) {
    if (ch === '+') { adding = true; continue; }
    if (ch === '-') { adding = false; continue; }
    if (prefixModes.has(ch)) {
      const nick = args[argIndex++];
      const m = nick && t.members.get(lower(nick));
      if (m) { if (adding) m.modes.add(ch); else m.modes.delete(ch); }
    } else if ('beIkloL'.includes(ch)) {
      argIndex++; // modes that consume an argument
    }
  }
  if (isSelected(server.id, channel)) renderMembers();
}

function handlePrivmsg(server, msg, isNotice) {
  const target = msg.params[0];
  let text = msg.params[1] || '';
  const fromMe = isMe(server, msg.nick);
  const ctcp = parseCTCP(text);

  if (ctcp && ctcp.type === 'ACTION') {
    const convo = isChannelName(target, server.features) ? target
      : (fromMe ? target : msg.nick);
    addMessage(server, convo, {
      sender: msg.nick, text: stripFormatting(ctcp.text), type: 'action', time: new Date(),
    });
    return;
  }
  if (ctcp && !isNotice) {
    // Respond to common CTCP queries; show nothing noisy.
    if (ctcp.type === 'VERSION') rawSend(server, `NOTICE ${msg.nick} :\x01VERSION Netsplit (Electron)\x01`);
    else if (ctcp.type === 'PING') rawSend(server, `NOTICE ${msg.nick} :\x01PING ${ctcp.text}\x01`);
    else if (ctcp.type === 'TIME') rawSend(server, `NOTICE ${msg.nick} :\x01TIME ${new Date().toString()}\x01`);
    systemMessage(server, server.name, `[CTCP ${ctcp.type} from ${msg.nick}]`);
    return;
  }

  text = stripFormatting(text);
  const type = isNotice ? 'notice' : 'message';

  if (isChannelName(target, server.features)) {
    addMessage(server, target, { sender: msg.nick, text, type, time: new Date() });
  } else if (isNotice && (!msg.nick || msg.nick === server.host || !msg.user)) {
    // Server notice → console.
    addMessage(server, server.name, { sender: msg.nick || 'Server', text, type: 'notice' });
  } else {
    // Direct message. Conversation keyed by the other party.
    const convo = fromMe ? target : msg.nick;
    addMessage(server, convo, { sender: msg.nick, text, type, time: new Date() });
  }
}

// ---------------------------------------------------------------------------
// Sending / commands
// ---------------------------------------------------------------------------

function currentSelectionRefs() {
  if (!state.selection) return null;
  const server = getServer(state.selection.serverId);
  if (!server) return null;
  const target = getTarget(server, state.selection.target);
  return { server, target };
}

function sendComposer() {
  const text = dom.composerInput.value;
  if (!text.trim()) return;
  dom.composerInput.value = '';
  recordHistory(text);

  // /server works with or without a current selection, so it's handled here
  // (before we require a selected server) — this is how you connect by typing.
  const globalMatch = text.match(/^\/server\b\s*(.*)$/is);
  if (globalMatch) {
    const refs = currentSelectionRefs();
    connectNewServer(globalMatch[1].trim(), refs ? refs.server : null);
    return;
  }

  const refs = currentSelectionRefs();
  if (!refs) {
    // No servers yet: point the user at the one command that bootstraps one.
    systemToast('Type /server irc.libera.chat to connect, or press + to add a connection.');
    return;
  }
  if (text.startsWith('/')) {
    executeCommand(refs.server, refs.target, text);
  } else {
    sendMessageText(refs.server, refs.target, text);
  }
}

// Connect to a new network by command: /server <host> [port] [nick].
// Port 6697 (default) is treated as TLS; classic plain ports connect without.
function connectNewServer(arg, reportServer) {
  const tokens = arg.split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    const usage = 'Usage: /server <host> [port] [nick]  —  port 6697 = TLS, 6667 = plain';
    if (reportServer) systemMessage(reportServer, reportServer.name, usage);
    else systemToast(usage);
    return;
  }
  const host = tokens[0];
  const port = tokens[1] ? (parseInt(tokens[1], 10) || 6697) : 6697;
  const plainPorts = [6667, 6666, 6668, 6669, 8001];
  const tls = !plainPorts.includes(port);
  const nick = tokens[2] || (reportServer && reportServer.nick) ||
    ('guest' + Math.floor(Math.random() * 9000 + 1000));
  const server = addServerProfile({
    name: host, host, port, tls, tlsInsecure: false,
    nick, realname: nick, channelsToJoin: [],
  });
  persistServers();
  selectTarget(server.id, server.name);
  connectServer(server);
}

// Lightweight transient message when there's no conversation to write into.
function systemToast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 4000);
}

function sendMessageText(server, target, text) {
  if (!target || target.kind === 'server') {
    systemMessage(server, server.name, 'Select a channel or private message before sending text.');
    return;
  }
  if (server.status !== 'connected') {
    systemMessage(server, target.name, 'Not connected.');
    return;
  }
  rawSend(server, `PRIVMSG ${target.name} :${text}`);
  addMessage(server, target.name, { sender: server.currentNick, text, type: 'self', time: new Date() });
}

function executeCommand(server, target, input) {
  const parts = input.slice(1).split(/ (.*)/s);
  const command = (parts[0] || '').toUpperCase();
  const arg = parts[1] || '';
  const targetName = target ? target.name : server.name;

  // Commands that need a live connection; the rest work offline.
  const offlineOk = new Set(['CLEAR', 'SERVER', 'CONNECT', 'RECONNECT', 'RAW', 'QUOTE']);
  if (!offlineOk.has(command) && server.status !== 'connected') {
    systemMessage(server, targetName,
      'Not connected. Select the server and use /connect, or /server <host> to open a new one.');
    return;
  }

  switch (command) {
    case 'SERVER':
      connectNewServer(arg, server);
      break;
    case 'JOIN': case 'J': {
      const ch = arg.split(/\s+/)[0];
      if (!ch) { systemMessage(server, targetName, 'Usage: /join #channel'); return; }
      const chan = isChannelName(ch, server.features) ? ch : `#${ch}`;
      rawSend(server, `JOIN ${chan}`);
      break;
    }
    case 'PART': case 'LEAVE': {
      const ch = arg.split(/\s+/)[0] || (target && target.kind === 'channel' ? target.name : '');
      if (!ch) { systemMessage(server, targetName, 'Usage: /part #channel'); return; }
      rawSend(server, `PART ${ch}`);
      break;
    }
    case 'MSG': case 'QUERY': {
      const m = arg.split(/ (.*)/s);
      const to = m[0];
      const body = m[1] || '';
      if (!to) { systemMessage(server, targetName, 'Usage: /msg nickname message'); return; }
      const convo = ensureTarget(server, to, isChannelName(to, server.features) ? 'channel' : 'dm');
      if (command === 'QUERY' && !body) { selectTarget(server.id, to); return; }
      if (body) {
        rawSend(server, `PRIVMSG ${to} :${body}`);
        addMessage(server, to, { sender: server.currentNick, text: body, type: 'self', time: new Date() });
      }
      if (command === 'QUERY') selectTarget(server.id, to);
      break;
    }
    case 'ME': case 'ACTION': {
      if (!target || target.kind === 'server') { systemMessage(server, targetName, 'Select a channel or DM first.'); return; }
      rawSend(server, `PRIVMSG ${target.name} :\x01ACTION ${arg}\x01`);
      addMessage(server, target.name, { sender: server.currentNick, text: arg, type: 'action', time: new Date() });
      break;
    }
    case 'NOTICE': {
      const m = arg.split(/ (.*)/s);
      if (!m[1]) { systemMessage(server, targetName, 'Usage: /notice target message'); return; }
      rawSend(server, `NOTICE ${m[0]} :${m[1]}`);
      addMessage(server, m[0], { sender: server.currentNick, text: m[1], type: 'notice', time: new Date() });
      break;
    }
    case 'NICK':
      if (!arg) { systemMessage(server, targetName, 'Usage: /nick newnick'); return; }
      rawSend(server, `NICK ${arg.split(/\s+/)[0]}`);
      break;
    case 'TOPIC':
      if (!target || target.kind !== 'channel') { systemMessage(server, targetName, 'Select a channel first.'); return; }
      rawSend(server, arg ? `TOPIC ${target.name} :${arg}` : `TOPIC ${target.name}`);
      break;
    case 'WHOIS':
      if (!arg) { systemMessage(server, targetName, 'Usage: /whois nickname'); return; }
      rawSend(server, `WHOIS ${arg}`);
      break;
    case 'WHO':
      rawSend(server, `WHO ${arg || (target && target.name) || ''}`.trim());
      break;
    case 'MODE':
      rawSend(server, `MODE ${arg}`);
      break;
    case 'KICK': {
      if (!target || target.kind !== 'channel') { systemMessage(server, targetName, 'Select a channel first.'); return; }
      rawSend(server, `KICK ${target.name} ${arg}`);
      break;
    }
    case 'INVITE':
      rawSend(server, `INVITE ${arg}${target && target.kind === 'channel' ? ' ' + target.name : ''}`);
      break;
    case 'AWAY':
      rawSend(server, arg ? `AWAY :${arg}` : 'AWAY');
      break;
    case 'ME_BACK': case 'BACK':
      rawSend(server, 'AWAY');
      break;
    case 'QUIT':
    case 'DISCONNECT':
      server.manualDisconnect = true;
      if (server.reconnectTimer) { clearTimeout(server.reconnectTimer); server.reconnectTimer = null; }
      window.netsplit.send(server.id, `QUIT :${arg || 'Netsplit'}`);
      setTimeout(() => window.netsplit.disconnect(server.id), 150);
      break;
    case 'LIST':
      rawSend(server, arg ? `LIST ${arg}` : 'LIST');
      systemToast('Requesting channel list…');
      break;
    case 'NAMES':
      rawSend(server, `NAMES ${arg || (target && target.kind === 'channel' ? target.name : '')}`.trim());
      break;
    case 'CONNECT': case 'RECONNECT':
      connectServer(server);
      break;
    case 'CLEAR':
      if (target) { target.messages = []; renderTranscript(); }
      break;
    case 'RAW': case 'QUOTE':
      if (arg) rawSend(server, arg);
      break;
    default:
      // Pass unknown commands straight to the server (e.g. /list, /names, /motd).
      rawSend(server, `${command}${arg ? ' ' + arg : ''}`);
      systemMessage(server, targetName, `Sent /${command.toLowerCase()} ${arg}`.trim());
      break;
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function selectTarget(serverId, targetName) {
  const server = getServer(serverId);
  if (!server) return;
  const t = getTarget(server, targetName) || serverConsole(server);
  state.selection = { serverId, target: t.name };
  t.unread = 0;
  t.highlight = false;
  renderAll();
  dom.composerInput.focus();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderAll() {
  renderSidebar();
  renderConversationHeader();
  renderTranscript();
  renderMembers();
  updateComposerState();
  updateWindowTitle();
}

function renderSidebar() {
  dom.connectionsTitle.textContent = state.palette ? state.palette.connectionTitle : 'Connections';
  const frag = document.createDocumentFragment();
  let activeCount = 0;

  for (const server of state.servers) {
    if (server.status === 'connected') activeCount++;
    const group = document.createElement('div');
    group.className = 'server-group';

    const groupName = document.createElement('div');
    groupName.className = 'server-group-name';
    groupName.textContent = server.name;
    group.appendChild(groupName);

    // Server row (console)
    const srow = document.createElement('div');
    srow.className = 'sidebar-row server' + (isSelected(server.id, server.name) ? ' selected' : '');
    const dot = document.createElement('span');
    dot.className = `status-dot ${server.status === 'connected' ? 'connected'
      : server.status === 'connecting' || server.status === 'registering' ? 'connecting'
      : server.status === 'disconnected' ? 'disconnected' : 'error'}`;
    const sstack = document.createElement('div');
    sstack.className = 'server-row-stack';
    const sname = document.createElement('div');
    sname.className = 'row-label';
    sname.textContent = server.host;
    const ssub = document.createElement('div');
    ssub.className = 'row-sub';
    ssub.textContent = statusLabel(server);
    sstack.appendChild(sname); sstack.appendChild(ssub);
    srow.appendChild(dot); srow.appendChild(sstack);
    srow.onclick = () => selectTarget(server.id, server.name);
    srow.ondblclick = () => {
      if (!['connected', 'registering', 'connecting'].includes(server.status)) connectServer(server);
    };
    srow.oncontextmenu = (e) => showServerMenu(e, server);
    group.appendChild(srow);

    // Channels & DMs
    for (const t of server.targets.values()) {
      if (t.kind === 'server') continue;
      const row = document.createElement('div');
      row.className = 'sidebar-row' + (isSelected(server.id, t.name) ? ' selected' : '');
      const icon = document.createElement('span');
      icon.className = 'row-icon';
      icon.textContent = t.kind === 'channel' ? '#' : '○';
      const label = document.createElement('span');
      label.className = 'row-label';
      label.textContent = t.kind === 'channel' ? t.name.replace(/^#/, '') : t.name;
      row.appendChild(icon); row.appendChild(label);
      if (t.unread > 0) {
        const badge = document.createElement('span');
        badge.className = 'unread-badge' + (t.highlight ? ' highlight' : '');
        badge.textContent = t.unread > 99 ? '99+' : String(t.unread);
        row.appendChild(badge);
      }
      row.onclick = () => selectTarget(server.id, t.name);
      row.oncontextmenu = (e) => showTargetMenu(e, server, t);
      group.appendChild(row);
    }
    frag.appendChild(group);
  }

  dom.sidebarList.replaceChildren(frag);
  dom.activeCount.textContent = `${activeCount} active`;
}

function statusLabel(server) {
  switch (server.status) {
    case 'connected': return 'Connected';
    case 'connecting': return 'Connecting…';
    case 'registering': return 'Registering…';
    case 'error': return 'Error';
    default: return 'Disconnected';
  }
}

function renderConversationHeader() {
  const refs = currentSelectionRefs();
  if (!refs || !refs.target) {
    dom.conversationAvatar.textContent = '#';
    dom.conversationTitle.textContent = 'Netsplit';
    dom.conversationSubtitle.textContent = 'Not connected';
    return;
  }
  const { server, target } = refs;
  if (target.kind === 'channel') {
    dom.conversationAvatar.textContent = '#';
    dom.conversationTitle.textContent = target.name;
    dom.conversationSubtitle.textContent =
      `${server.name}${target.topic ? '  ·  ' + target.topic : ''}`;
  } else if (target.kind === 'dm') {
    dom.conversationAvatar.textContent = '○';
    dom.conversationTitle.textContent = target.name;
    dom.conversationSubtitle.textContent = `${server.name}  ·  Direct message`;
  } else {
    dom.conversationAvatar.textContent = '◎';
    dom.conversationTitle.textContent = server.name;
    dom.conversationSubtitle.textContent = `${server.host}:${server.port}  ·  ${statusLabel(server)}`;
  }
}

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

function renderBody(container, text) {
  URL_RE.lastIndex = 0;
  let last = 0;
  let match;
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > last) container.appendChild(document.createTextNode(text.slice(last, match.index)));
    const a = document.createElement('a');
    a.href = match[0];
    a.textContent = match[0];
    a.onclick = (e) => { e.preventDefault(); window.netsplit.openExternal(match[0]); };
    container.appendChild(a);
    last = match.index + match[0].length;
  }
  if (last < text.length) container.appendChild(document.createTextNode(text.slice(last)));
}

function buildMessageRow(server, message) {
  const row = document.createElement('div');
  let cls = 'msg ' + message.type;
  if (isHighlight(server, message)) cls += ' highlight';
  row.className = cls;

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = formatTime(message.time);

  const nick = document.createElement('span');
  nick.className = 'nick';
  const body = document.createElement('span');
  body.className = 'body';

  if (message.type === 'system') {
    nick.textContent = '';
    renderBody(body, message.text);
  } else if (message.type === 'action') {
    nick.textContent = '•';
    nick.style.color = nickColor(message.nickKey);
    const em = document.createElement('em');
    em.textContent = `${message.sender} `;
    body.appendChild(em);
    renderBody(body, message.text);
  } else if (message.type === 'notice') {
    nick.textContent = `${message.sender} (notice)`;
    renderBody(body, message.text);
  } else {
    nick.textContent = message.sender;
    nick.style.color = message.type === 'self'
      ? (state.palette ? state.palette.accent : 'var(--accent)')
      : nickColor(message.nickKey);
    renderBody(body, message.text);
  }

  // Make a real sender's nick clickable: opens a direct message with them.
  if (message.sender && message.type !== 'system' && !isMe(server, message.sender)) {
    nick.classList.add('clickable-nick');
    nick.title = `Message ${message.sender}`;
    nick.onclick = () => openQuery(server, message.sender);
  }

  row.appendChild(time);
  row.appendChild(nick);
  row.appendChild(body);
  return row;
}

function openQuery(server, nickname) {
  ensureTarget(server, nickname, 'dm');
  selectTarget(server.id, nickname);
}

function nickColor(key) {
  if (!state.palette) return 'var(--accent)';
  return Themes.nicknameColor(key, state.palette);
}

function renderTranscript() {
  const refs = currentSelectionRefs();
  dom.emptyState.style.display = refs && refs.target ? 'none' : '';
  if (!refs || !refs.target) {
    dom.transcript.replaceChildren(dom.emptyState);
    return;
  }
  const { server, target } = refs;
  const frag = document.createDocumentFragment();
  for (const m of target.messages) frag.appendChild(buildMessageRow(server, m));
  dom.transcript.replaceChildren(frag);
  scrollToBottom();
}

function appendMessageRow(target, message, autoscroll) {
  const refs = currentSelectionRefs();
  if (!refs || refs.target !== target) return;
  if (dom.emptyState.parentElement === dom.transcript) dom.emptyState.style.display = 'none';
  const nearBottom = isNearBottom();
  dom.transcript.appendChild(buildMessageRow(refs.server, message));
  if (autoscroll && nearBottom) scrollToBottom();
}

function isNearBottom() {
  const t = dom.transcript;
  return t.scrollHeight - t.scrollTop - t.clientHeight < 80;
}
function scrollToBottom() { dom.transcript.scrollTop = dom.transcript.scrollHeight; }

function renderMembers() {
  const refs = currentSelectionRefs();
  const canShow = refs && refs.target && refs.target.kind === 'channel';
  dom.members.style.display = state.membersVisible && canShow ? '' : 'none';
  if (!canShow) return;

  const filter = lower(dom.memberFilter.value.trim());
  const members = Array.from(refs.target.members.values())
    .filter((m) => !filter || lower(m.nickname).includes(filter))
    .sort(memberSort);

  dom.membersCount.textContent = String(refs.target.members.size);
  const frag = document.createDocumentFragment();
  for (const m of members) frag.appendChild(buildMemberRow(refs.server, m));
  dom.membersList.replaceChildren(frag);
}

function memberRank(m) {
  let best = 0;
  for (const mode of m.modes) best = Math.max(best, MODE_RANK[mode] || 0);
  return best;
}
function memberSort(a, b) {
  const ra = memberRank(a), rb = memberRank(b);
  if (ra !== rb) return rb - ra;
  return a.nickname.localeCompare(b.nickname, undefined, { sensitivity: 'base' });
}

function highestMode(m, server) {
  let best = null, bestRank = 0;
  for (const mode of m.modes) {
    const r = MODE_RANK[mode] || 0;
    if (r > bestRank) { bestRank = r; best = mode; }
  }
  return best;
}

function modeSymbol(mode, server) {
  for (const [sym, md] of Object.entries(server.prefixMap)) if (md === mode) return sym;
  return '';
}

function buildMemberRow(server, m) {
  const row = document.createElement('div');
  row.className = 'member-row';
  const prefix = document.createElement('span');
  prefix.className = 'member-prefix';
  const top = highestMode(m, server);
  prefix.textContent = top ? modeSymbol(top, server) : '';
  const name = document.createElement('span');
  name.className = 'member-name';
  name.textContent = m.nickname;
  name.style.color = nickColor(m.nickname);
  row.appendChild(prefix);
  row.appendChild(name);
  if (top && ROLE_NAMES[top]) {
    const badge = document.createElement('span');
    badge.className = 'member-badge';
    badge.textContent = ROLE_NAMES[top];
    row.appendChild(badge);
  }
  row.ondblclick = () => openQuery(server, m.nickname);
  row.oncontextmenu = (e) => showMemberMenu(e, server, m);
  return row;
}

function updateComposerState() {
  const refs = currentSelectionRefs();
  // The composer is always usable so commands (/join, /server, …) can be typed
  // from the server console — or even before any connection exists.
  dom.composerInput.disabled = false;
  dom.sendBtn.disabled = false;
  if (refs && refs.target) {
    dom.composerInput.placeholder = refs.target.kind === 'server'
      ? 'Message the server or type a command  (e.g. /join #channel)'
      : `Message ${refs.target.name}`;
  } else {
    dom.composerInput.placeholder = 'Type /server irc.libera.chat to connect';
  }
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function applyThemeKey(key) {
  state.themeKey = key;
  savePref('netsplit.theme', key);
  state.palette = Themes.applyTheme(key, state.systemIsDark);
  dom.connectionsTitle.textContent = state.palette.connectionTitle;
  dom.emptyTitle.textContent = state.palette.connectionTitle;
  renderSidebar();
  renderTranscript();
  renderMembers();
}

// ---------------------------------------------------------------------------
// Modals & wiring
// ---------------------------------------------------------------------------

function openModal(id) { el(id).hidden = false; }
function closeModal(id) { el(id).hidden = true; }

function wireUI() {
  // Composer
  dom.sendBtn.onclick = sendComposer;
  dom.composerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComposer(); }
    else if (e.key === 'ArrowUp') { recallHistory(-1); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { recallHistory(1); e.preventDefault(); }
    else if (e.key === 'Tab') { e.preventDefault(); tabComplete(); }
    else { resetHistoryCursor(); }
  });

  // Add connection
  el('addConnection').onclick = () => openConnectModal();
  el('emptyAdd').onclick = () => openConnectModal();
  el('connectCancel').onclick = () => closeModal('connectModal');
  el('connectForm').onsubmit = onConnectSubmit;

  // Theme
  el('themeBtn').onclick = openThemeModal;
  el('themeClose').onclick = () => closeModal('themeModal');

  // Members toggle
  dom.toggleMembers.onclick = () => {
    state.membersVisible = !state.membersVisible;
    savePref('netsplit.membersVisible', String(state.membersVisible));
    dom.toggleMembers.classList.toggle('active', state.membersVisible);
    renderMembers();
  };
  dom.toggleMembers.classList.toggle('active', state.membersVisible);
  dom.memberFilter.oninput = renderMembers;

  // Command palette
  window.netsplit.onMenu('commandPalette', openPalette);
  window.netsplit.onMenu('addConnection', openConnectModal);
  window.netsplit.onMenu('demo', () => {
    if (state.servers.some((s) => s.name === 'Demo Server')) {
      const s = state.servers.find((x) => x.name === 'Demo Server');
      selectTarget(s.id, '#product');
    } else {
      seedDemo();
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    if (e.key === 'Escape') { closeAllModals(); hideContextMenu(); }
  });

  // Dismiss the context menu on any outside interaction.
  document.addEventListener('click', hideContextMenu);
  document.addEventListener('scroll', hideContextMenu, true);
  window.addEventListener('blur', hideContextMenu);
  el('listClose').onclick = () => closeModal('listModal');

  // Nav (channel switching by keyboard: Cmd+Ctrl+arrow could be added; keep simple)
  el('navBack').onclick = () => cycleSelection(-1);
  el('navForward').onclick = () => cycleSelection(1);

  el('paletteInput').addEventListener('input', renderPalette);
  el('paletteInput').addEventListener('keydown', onPaletteKey);
}

function closeAllModals() {
  closeModal('connectModal'); closeModal('themeModal');
  closeModal('paletteModal'); closeModal('listModal');
}

function openConnectModal() {
  el('connectModal').hidden = false;
  el('fHost').focus();
}

function onConnectSubmit(e) {
  e.preventDefault();
  const host = el('fHost').value.trim();
  const nick = el('fNick').value.trim();
  if (!host || !nick) return;
  const channels = el('fChannels').value.split(/[\s,]+/).map((c) => c.trim()).filter(Boolean)
    .map((c) => (isChannelName(c, {}) ? c : `#${c}`));
  const profile = {
    name: el('fName').value.trim() || host,
    host,
    port: parseInt(el('fPort').value, 10) || (el('fTls').checked ? 6697 : 6667),
    tls: el('fTls').checked,
    tlsInsecure: el('fInsecure').checked,
    nick,
    realname: el('fReal').value.trim() || nick,
    pass: el('fPass').value,
    channelsToJoin: channels,
  };
  closeModal('connectModal');
  const server = addServerProfile(profile);
  persistServers();
  selectTarget(server.id, server.name);
  connectServer(server);
  el('connectForm').reset();
  el('fPort').value = '6697';
  el('fTls').checked = true;
}

function openThemeModal() {
  const grid = el('themeGrid');
  grid.replaceChildren();
  for (const key of Themes.THEME_ORDER) {
    const resolved = Themes.resolveThemeKey(key, state.systemIsDark);
    const theme = Themes.THEMES[resolved];
    const label = key === 'system' ? 'System' : theme.label;
    const sw = document.createElement('div');
    sw.className = 'theme-swatch' + (state.themeKey === key ? ' selected' : '');
    const dot = document.createElement('span');
    dot.className = 'theme-dot';
    dot.style.background = theme.accent;
    const name = document.createElement('span');
    name.textContent = label;
    sw.appendChild(dot); sw.appendChild(name);
    sw.onclick = () => { applyThemeKey(key); openThemeModal(); };
    grid.appendChild(sw);
  }
  el('themeModal').hidden = false;
}

// --- Channel list browser (/list) ---
function openChannelList(server) {
  const list = server.channelList || [];
  el('listTitle').textContent = `Channels on ${server.name} (${list.length})`;
  const filter = el('listFilter');
  filter.value = '';
  const render = () => {
    const q = lower(filter.value.trim());
    const shown = list
      .filter((c) => !q || lower(c.name).includes(q) || lower(c.topic).includes(q))
      .sort((a, b) => b.users - a.users)
      .slice(0, 500);
    const frag = document.createDocumentFragment();
    if (!shown.length) {
      const e = document.createElement('div');
      e.className = 'channel-list-empty';
      e.textContent = list.length ? 'No channels match your filter.' : 'No channels returned.';
      frag.appendChild(e);
    }
    for (const c of shown) {
      const row = document.createElement('div');
      row.className = 'channel-list-row';
      const name = document.createElement('span'); name.className = 'cl-name'; name.textContent = c.name;
      const users = document.createElement('span'); users.className = 'cl-users'; users.textContent = `${c.users}`;
      const topic = document.createElement('span'); topic.className = 'cl-topic'; topic.textContent = c.topic;
      row.appendChild(name); row.appendChild(users); row.appendChild(topic);
      row.onclick = () => { rawSend(server, `JOIN ${c.name}`); closeModal('listModal'); };
      frag.appendChild(row);
    }
    el('channelListResults').replaceChildren(frag);
  };
  filter.oninput = render;
  render();
  el('listModal').hidden = false;
  filter.focus();
}

// --- Context menu ---
function showContextMenu(e, items) {
  e.preventDefault();
  const menu = el('contextMenu');
  menu.replaceChildren();
  for (const item of items) {
    if (item.sep) {
      const s = document.createElement('div'); s.className = 'context-menu-sep';
      menu.appendChild(s); continue;
    }
    const row = document.createElement('div');
    row.className = 'context-menu-item' + (item.danger ? ' danger' : '');
    row.textContent = item.label;
    row.onclick = () => { hideContextMenu(); item.action(); };
    menu.appendChild(row);
  }
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  let x = e.clientX, y = e.clientY;
  if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
  menu.style.left = Math.max(4, x) + 'px';
  menu.style.top = Math.max(4, y) + 'px';
}
function hideContextMenu() { el('contextMenu').hidden = true; }

function showServerMenu(e, server) {
  const busy = ['connected', 'registering', 'connecting'].includes(server.status);
  const items = [];
  if (busy) {
    items.push({ label: 'Disconnect', action: () => disconnectServer(server) });
    items.push({ label: 'Reconnect', action: () => { disconnectServer(server); setTimeout(() => connectServer(server), 400); } });
  } else {
    items.push({ label: 'Connect', action: () => connectServer(server) });
  }
  items.push({ label: 'Join Channel…', action: () => { selectTarget(server.id, server.name); dom.composerInput.value = '/join '; dom.composerInput.focus(); } });
  items.push({
    label: 'List Channels',
    action: () => {
      if (server.status === 'connected') { rawSend(server, 'LIST'); systemToast('Requesting channel list…'); }
      else systemToast('Connect to the server first.');
    },
  });
  items.push({ sep: true });
  items.push({ label: 'Remove Server', danger: true, action: () => removeServer(server) });
  showContextMenu(e, items);
}

function showTargetMenu(e, server, target) {
  const items = [];
  if (target.kind === 'channel' && server.status === 'connected') {
    items.push({ label: 'Leave Channel', action: () => rawSend(server, `PART ${target.name}`) });
  }
  items.push({ label: 'Clear Messages', action: () => { target.messages = []; if (isSelected(server.id, target.name)) renderTranscript(); } });
  items.push({ sep: true });
  items.push({ label: 'Close', danger: true, action: () => closeTarget(server, target) });
  showContextMenu(e, items);
}

function showMemberMenu(e, server, member) {
  showContextMenu(e, [
    { label: `Message ${member.nickname}`, action: () => openQuery(server, member.nickname) },
    { label: 'Whois', action: () => { if (server.status === 'connected') rawSend(server, `WHOIS ${member.nickname}`); } },
    { sep: true },
    { label: 'Copy nick', action: () => { try { navigator.clipboard.writeText(member.nickname); } catch (_) {} } },
  ]);
}

function disconnectServer(server) {
  server.manualDisconnect = true;
  if (server.reconnectTimer) { clearTimeout(server.reconnectTimer); server.reconnectTimer = null; }
  if (server.status === 'connected' || server.status === 'registering') {
    window.netsplit.send(server.id, 'QUIT :Netsplit');
  }
  setTimeout(() => window.netsplit.disconnect(server.id), 150);
}

function removeServer(server) {
  disconnectServer(server);
  const idx = state.servers.findIndex((s) => s.id === server.id);
  if (idx !== -1) state.servers.splice(idx, 1);
  persistServers();
  if (state.selection && state.selection.serverId === server.id) {
    state.selection = state.servers.length
      ? { serverId: state.servers[0].id, target: state.servers[0].name } : null;
  }
  renderAll();
}

function closeTarget(server, target) {
  if (target.kind === 'channel') {
    if (server.status === 'connected') rawSend(server, `PART ${target.name}`);
    forgetJoinedChannel(server, target.name);
  }
  server.targets.delete(targetKey(target.name));
  if (isSelected(server.id, target.name)) {
    state.selection = { serverId: server.id, target: server.name };
  }
  renderAll();
}

// --- Command palette (⌘K jump) ---
let paletteItems = [];
let paletteActive = 0;

function openPalette() {
  buildPaletteItems('');
  el('paletteModal').hidden = false;
  const input = el('paletteInput');
  input.value = '';
  input.focus();
  renderPalette();
}

function buildPaletteItems(query) {
  const q = lower(query);
  const items = [];
  for (const server of state.servers) {
    items.push({ serverId: server.id, target: server.name, label: server.name, sub: 'Server', icon: '◎' });
    for (const t of server.targets.values()) {
      if (t.kind === 'server') continue;
      items.push({
        serverId: server.id, target: t.name,
        label: t.name, sub: server.name,
        icon: t.kind === 'channel' ? '#' : '○',
      });
    }
  }
  paletteItems = items.filter((i) => !q || lower(i.label).includes(q) || lower(i.sub).includes(q));
  paletteActive = 0;
}

function renderPalette() {
  buildPaletteItems(el('paletteInput').value);
  const list = el('paletteResults');
  const frag = document.createDocumentFragment();
  paletteItems.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'palette-item' + (i === paletteActive ? ' active' : '');
    const icon = document.createElement('span'); icon.className = 'pi-icon'; icon.textContent = item.icon;
    const label = document.createElement('span'); label.textContent = item.label;
    const sub = document.createElement('span'); sub.className = 'pi-sub'; sub.textContent = item.sub;
    row.appendChild(icon); row.appendChild(label); row.appendChild(sub);
    row.onclick = () => { selectTarget(item.serverId, item.target); closeModal('paletteModal'); };
    frag.appendChild(row);
  });
  list.replaceChildren(frag);
}

function onPaletteKey(e) {
  if (e.key === 'ArrowDown') { paletteActive = Math.min(paletteActive + 1, paletteItems.length - 1); renderPalette(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { paletteActive = Math.max(paletteActive - 1, 0); renderPalette(); e.preventDefault(); }
  else if (e.key === 'Enter') {
    const item = paletteItems[paletteActive];
    if (item) { selectTarget(item.serverId, item.target); closeModal('paletteModal'); }
    e.preventDefault();
  }
}

// --- Flat list navigation for back/forward ---
function flatTargets() {
  const list = [];
  for (const server of state.servers) {
    list.push({ serverId: server.id, target: server.name });
    for (const t of server.targets.values()) {
      if (t.kind !== 'server') list.push({ serverId: server.id, target: t.name });
    }
  }
  return list;
}
function cycleSelection(dir) {
  const list = flatTargets();
  if (!list.length) return;
  let idx = list.findIndex((i) => state.selection && i.serverId === state.selection.serverId &&
    targetKey(i.target) === targetKey(state.selection.target));
  if (idx === -1) idx = 0;
  idx = (idx + dir + list.length) % list.length;
  selectTarget(list[idx].serverId, list[idx].target);
}

// --- Composer history + tab completion ---
const history = [];
let historyIndex = 0;
function recordHistory(text) { history.push(text); if (history.length > 200) history.shift(); historyIndex = history.length; }
function resetHistoryCursor() { historyIndex = history.length; }
function recallHistory(dir) {
  if (!history.length) return;
  historyIndex = Math.max(0, Math.min(history.length, historyIndex + dir));
  dom.composerInput.value = history[historyIndex] || '';
  // Put the caret at the end after recall.
  const len = dom.composerInput.value.length;
  requestAnimationFrame(() => dom.composerInput.setSelectionRange(len, len));
}

const COMMAND_NAMES = [
  'server', 'connect', 'join', 'part', 'msg', 'query', 'me', 'notice', 'nick',
  'topic', 'whois', 'who', 'mode', 'kick', 'invite', 'away', 'back', 'list',
  'names', 'clear', 'raw', 'quit', 'disconnect',
];

let completionState = null; // { base, matches, index }

function tabComplete() {
  const input = dom.composerInput;
  const value = input.value;

  // Command-name completion: first token beginning with "/".
  const cmdMatch = value.match(/^\/(\S*)$/);
  if (cmdMatch) {
    cycleCompletion(value, '/' + cmdMatch[1], COMMAND_NAMES.map((c) => '/' + c), ' ');
    return;
  }

  // Nick completion for the trailing token in a channel.
  const refs = currentSelectionRefs();
  if (!refs || !refs.target || refs.target.kind !== 'channel') return;
  const m = value.match(/(\S+)$/);
  if (!m) return;
  const names = Array.from(refs.target.members.values()).map((x) => x.nickname);
  const atStart = value.length === m[1].length;
  cycleCompletion(value, m[1], names, atStart ? ': ' : ' ');
}

// Shared tab-cycling: repeated Tab rotates through all matches of `token`.
function cycleCompletion(fullValue, token, pool, suffix) {
  const partial = lower(token);
  if (!completionState || completionState.raw !== fullValue) {
    const matches = pool.filter((n) => lower(n).startsWith(partial));
    if (!matches.length) { completionState = null; return; }
    completionState = { base: fullValue.slice(0, fullValue.length - token.length), matches, index: 0 };
  } else {
    completionState.index = (completionState.index + 1) % completionState.matches.length;
  }
  const chosen = completionState.matches[completionState.index];
  const newValue = completionState.base + chosen + suffix;
  dom.composerInput.value = newValue;
  completionState.raw = newValue;
  const len = newValue.length;
  requestAnimationFrame(() => dom.composerInput.setSelectionRange(len, len));
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  if (navigator.platform && !/Mac/.test(navigator.platform)) {
    document.body.classList.add('not-mac');
  }
  loadPrefs();
  try { state.systemIsDark = await window.netsplit.systemIsDark(); } catch (_) {}
  applyThemeKey(state.themeKey);
  wireUI();

  // Restore saved server profiles (not auto-connected).
  const saved = loadSavedServers();
  for (const p of saved) {
    const server = addServerProfile(p);
    systemMessage(server, server.name, 'Saved connection. Use the server row to reconnect.');
  }
  if (state.servers.length) {
    selectTarget(state.servers[0].id, state.servers[0].name);
  } else {
    renderAll();
  }
}

boot();

// ---------------------------------------------------------------------------
// Demo mode — a local, offline sample network (mirrors the app's Demo Server).
// Lets users preview the client without connecting. Triggered from the menu or
// by launching with ?demo.
// ---------------------------------------------------------------------------

function seedDemo() {
  const server = addServerProfile({
    name: 'Demo Server', host: 'localhost', port: 6697, tls: true,
    nick: 'rich', realname: 'rich', channelsToJoin: [],
  });
  server.status = 'connected';
  server.registered = true;
  server.currentNick = 'rich';
  server.features = { CHANTYPES: '#', PREFIX: '(ov)@+' };
  server.prefixMap = parsePrefixMap(server.features);

  for (const name of ['#community', '#design', '#product']) ensureTarget(server, name, 'channel');
  ensureTarget(server, 'APartridge', 'dm');
  ensureTarget(server, 'ClemFandango', 'dm');

  const product = getTarget(server, '#product');
  product.topic = 'A focused launch, thoughtful details, and no surprises';
  const roster = [
    ['Alex', 'o'], ['Priya', 'v'], ['Devon', ''], ['Elena', ''], ['Hannah', ''],
    ['Jamie', ''], ['Maya', ''], ['Noah', ''], ['Omar', ''], ['rich', ''],
    ['Ruby', ''], ['Samir', ''], ['Sophie', ''], ['Theo', ''],
  ];
  for (const [nick, mode] of roster) {
    product.members.set(lower(nick), { nickname: nick, modes: mode ? new Set([mode]) : new Set() });
  }
  const script = [
    ['Jamie', 'Good morning! The release candidate is looking steady. What should we verify first?', 'message'],
    ['Hannah', 'I finished the clean-install pass on macOS. Setup, reconnect, and notifications all behaved as expected.', 'message'],
    ['Devon', 'Great. I will take another look at reconnect behavior after sleep and wake.', 'message'],
    ['Priya', 'The latest usability sessions were encouraging. People found channel switching without prompting.', 'message'],
    ['Noah', 'updates the launch checklist and pours a second cup of coffee', 'action'],
    ['Ruby', 'I tightened the release notes. They now lead with the benefit instead of the implementation detail.', 'message'],
    ['Alex', 'That sounds right. Clear and useful beats clever every time.', 'message'],
    ['DemoServer', 'Build 184 passed the smoke-test suite on Apple silicon.', 'notice'],
    ['Samir', 'The memory profile is comfortably inside our target with all demo channels open.', 'message'],
    ['Jamie', 'rich, could you give the final screenshot set a quick look when you have a moment?', 'message'],
    ['DemoBot', 'Build 185 passed unit, transport, and accessibility smoke tests. https://github.com', 'message'],
    ['Alex', 'Excellent. Let us keep the rollout gradual and watch feedback closely.', 'message'],
    ['Omar', 'Support has the new troubleshooting notes. The steps are short and easy to verify.', 'message'],
  ];
  const base = Date.now() - script.length * 120000;
  script.forEach(([sender, text, type], i) => {
    product.messages.push({
      id: uid(), time: new Date(base + i * 120000), sender, text, type, nickKey: sender,
    });
  });
  persistServers();
  selectTarget(server.id, '#product');
}

window.netsplitSeedDemo = seedDemo;
if (location.search.includes('demo')) {
  // Delay until boot's async work settles.
  setTimeout(seedDemo, 300);
}
