// Theme palettes ported 1:1 from the macOS Netsplit app (IRCTheme.swift and the
// Themes/*.swift palette files). Each palette maps to CSS custom properties.
// `scheme` drives native form-control / scrollbar rendering (light vs dark).

(function () {
'use strict';

// Default nickname palettes for the built-in System/Light/Dark themes, matching
// ContentView.swift's light/dark nickname palettes (Tailwind 700/800 & 300).
const LIGHT_NICKS = [
  '#1D4ED8', '#7E22CE', '#9A3412', '#BE185D',
  '#166534', '#4338CA', '#115E59', '#B91C1C',
];
const DARK_NICKS = [
  '#93C5FD', '#D8B4FE', '#FDBA74', '#F9A8D4',
  '#86EFAC', '#A5B4FC', '#5EEAD4', '#FCA5A5',
];

const THEMES = {
  // --- Built-in (native macOS appearance approximations) ---
  light: {
    label: 'Light', scheme: 'light', design: 'default',
    background: '#FFFFFF', bar: '#ECECEC', panel: '#F2F2F0', field: '#E8E8E8',
    border: '#D5D5D5', text: '#1D1D1F', secondaryText: '#6E6E73', accent: '#007AFF',
    emphasizedBackground: '#D8D8D8', emphasizedText: '#1D1D1F',
    warningSecondaryText: '#6E6E73', prominentButtonText: '#FFFFFF',
    nicknameColors: LIGHT_NICKS,
    connectionTitle: 'Connections',
  },
  dark: {
    label: 'Dark', scheme: 'dark', design: 'default',
    background: '#1E1E1E', bar: '#262528', panel: '#2C2C2E', field: '#3A3A3C',
    border: '#3A3A3C', text: '#F5F5F7', secondaryText: '#98989D', accent: '#0A84FF',
    emphasizedBackground: '#3A3A3C', emphasizedText: '#FFFFFF',
    warningSecondaryText: '#98989D', prominentButtonText: '#FFFFFF',
    nicknameColors: DARK_NICKS,
    connectionTitle: 'Connections',
  },

  // --- Named themes ---
  catppuccinLatte: {
    label: 'Catppuccin Latte', scheme: 'light', design: 'rounded',
    background: '#EFF1F5', bar: '#E6E9EF', panel: '#E6E9EF', field: '#CCD0DA9E',
    border: '#BCC0CC', text: '#4C4F69', secondaryText: '#5C5F77', accent: '#8839EF',
    emphasizedBackground: '#CCD0DA', emphasizedText: '#4C4F69',
    warningSecondaryText: '#5C5F77', prominentButtonText: '#FFFFFF',
    nicknameColors: ['#1C60E6', '#8839EF', '#B44708', '#9D4F88', '#307820', '#5363B9', '#12757A', '#D20F39'],
    connectionTitle: 'Network Connections',
  },
  catppuccinMocha: {
    label: 'Catppuccin Mocha', scheme: 'dark', design: 'rounded',
    background: '#1E1E2E', bar: '#181825', panel: '#313244', field: '#313244',
    border: '#45475A', text: '#CDD6F4', secondaryText: '#A6ADC8', accent: '#CBA6F7',
    emphasizedBackground: '#45475A', emphasizedText: '#CDD6F4',
    warningSecondaryText: '#A6ADC8', prominentButtonText: '#11111B',
    nicknameColors: ['#89B4FA', '#CBA6F7', '#FAB387', '#F5C2E7', '#A6E3A1', '#B4BEFE', '#94E2D5', '#F38BA8'],
    connectionTitle: 'Network Connections',
  },
  everforestLight: {
    label: 'Everforest Light', scheme: 'light', design: 'rounded',
    background: '#FDF6E3', bar: '#EFEBD4', panel: '#F4F0D9', field: '#E6E2CC',
    border: '#BDC3AF', text: '#3F4D54', secondaryText: '#5C6A72', accent: '#267A5E',
    emphasizedBackground: '#EAEDC8', emphasizedText: '#3F4D54',
    warningSecondaryText: '#B34240', prominentButtonText: '#FFFBEF',
    nicknameColors: ['#B34240', '#A65418', '#7A5D00', '#586900', '#186B51', '#206584', '#8B3F75', '#53665D'],
    connectionTitle: 'Network Connections',
  },
  githubLight: {
    label: 'GitHub Light', scheme: 'light', design: 'default',
    background: '#FFFFFF', bar: '#F6F8FA', panel: '#F6F8FA', field: '#EFF2F5',
    border: '#D0D7DE', text: '#1F2328', secondaryText: '#656D76', accent: '#0969DA',
    emphasizedBackground: '#D0D7DE', emphasizedText: '#1F2328',
    warningSecondaryText: '#656D76', prominentButtonText: '#FFFFFF',
    nicknameColors: ['#0969DA', '#8250DF', '#BF3989', '#CF222E', '#953800', '#4D2D00', '#1A7F37', '#0A7A83'],
    connectionTitle: 'Server Connections',
  },
  githubDark: {
    label: 'GitHub Dark', scheme: 'dark', design: 'default',
    background: '#0D1117', bar: '#161B22', panel: '#161B22', field: '#21262D',
    border: '#30363D', text: '#E6EDF3', secondaryText: '#7D8590', accent: '#2F81F7',
    emphasizedBackground: '#30363D', emphasizedText: '#E6EDF3',
    warningSecondaryText: '#7D8590', prominentButtonText: '#0D1117',
    nicknameColors: ['#58A6FF', '#D2A8FF', '#F778BA', '#FF7B72', '#FFA657', '#D29922', '#7EE787', '#39C5CF'],
    connectionTitle: 'Server Connections',
  },
  gruvboxDark: {
    label: 'Gruvbox Dark', scheme: 'dark', design: 'default',
    background: '#282828', bar: '#1D2021', panel: '#32302F', field: '#3C3836',
    border: '#665C54', text: '#EBDBB2', secondaryText: '#BDAE93', accent: '#FE8019',
    emphasizedBackground: '#504945', emphasizedText: '#FBF1C7',
    warningSecondaryText: '#FB5B4B', prominentButtonText: '#282828',
    nicknameColors: ['#83A598', '#D3869B', '#FE8019', '#FABD2F', '#B8BB26', '#8EC07C', '#FB5B4B', '#D5C4A1'],
    connectionTitle: 'Server Connections',
  },
  nord: {
    label: 'Nord', scheme: 'dark', design: 'default',
    background: '#2E3440', bar: '#272C36', panel: '#3B4252', field: '#434C5E',
    border: '#4C566A', text: '#ECEFF4', secondaryText: '#D8DEE9', accent: '#88C0D0',
    emphasizedBackground: '#4C566A', emphasizedText: '#ECEFF4',
    warningSecondaryText: '#DD818B', prominentButtonText: '#2E3440',
    nicknameColors: ['#88C0D0', '#81A1C1', '#8FBCBB', '#A3BE8C', '#EBCB8B', '#D98975', '#C39BBB', '#DD818B'],
    connectionTitle: 'Server Connections',
  },
  rosePineDawn: {
    label: 'Rose Pine Dawn', scheme: 'light', design: 'rounded',
    background: '#FAF4ED', bar: '#F2E9E1', panel: '#FFFAF3', field: '#EAE2DC',
    border: '#CCC7C2', text: '#575279', secondaryText: '#625D75', accent: '#286983',
    emphasizedBackground: '#DFDAD9', emphasizedText: '#575279',
    warningSecondaryText: '#A14360', prominentButtonText: '#FAF4ED',
    nicknameColors: ['#286983', '#A14360', '#6E5A8A', '#A8504D', '#8A5900', '#356C75', '#625D75', '#3F5F8F'],
    connectionTitle: 'Networks',
  },
  solarizedSepia: {
    label: 'Solarized Sepia', scheme: 'light', design: 'default',
    background: '#F7EEDB', bar: '#EDE2CA', panel: '#F3E8D3', field: '#E4D8BC',
    border: '#CBBE9F', text: '#4A4335', secondaryText: '#665E4E', accent: '#2D6F73',
    emphasizedBackground: '#DDD0B3', emphasizedText: '#3F392E',
    warningSecondaryText: '#9A4738', prominentButtonText: '#FFF8E8',
    nicknameColors: ['#2D6F73', '#7B5F17', '#9A4738', '#8B3F64', '#4F5F93', '#3F6E45', '#76547E', '#81532D'],
    connectionTitle: 'Network Directory',
  },
  rosePine: {
    label: 'Rose Pine', scheme: 'dark', design: 'rounded',
    background: '#191724', bar: '#1F1D2E', panel: '#1F1D2E', field: '#26233A',
    border: '#524F67', text: '#E0DEF4', secondaryText: '#908CAA', accent: '#EBBCBA',
    emphasizedBackground: '#403D52', emphasizedText: '#E0DEF4',
    warningSecondaryText: '#EB6F92', prominentButtonText: '#191724',
    nicknameColors: ['#9CCFD8', '#C4A7E7', '#F6C177', '#EBBCBA', '#EB6F92', '#3E8FB0', '#908CAA', '#E0DEF4'],
    connectionTitle: 'Networks',
  },
  cyberpunk: {
    label: 'Cyberpunk', scheme: 'dark', design: 'monospaced',
    background: '#101521', bar: '#0B0F19', panel: '#171E2E', field: '#202A3D',
    border: '#34415E', text: '#D7E0FF', secondaryText: '#9AA8CC', accent: '#2FE6D0',
    emphasizedBackground: '#26334B', emphasizedText: '#F2F5FF',
    warningSecondaryText: '#FF8FB3', prominentButtonText: '#081319',
    nicknameColors: ['#4FE6D5', '#FF6BCE', '#9D8CFF', '#5AAEFF', '#FFB454', '#B7E36A', '#FFD166', '#F28FAD'],
    connectionTitle: 'COMMUNICATION LINKS',
  },
  c64: {
    label: 'C64', scheme: 'dark', design: 'monospaced',
    background: '#40318D', bar: '#30246E', panel: '#4B3B9B', field: '#352879',
    border: '#7869C4', text: '#F4F0FF', secondaryText: '#C8C1F1', accent: '#A99DF5',
    emphasizedBackground: '#7869C4', emphasizedText: '#FFFFFF',
    warningSecondaryText: '#F6A09A', prominentButtonText: '#241A58',
    nicknameColors: ['#FFFFFF', '#8DEDF5', '#B8F5AE', '#EAF69B', '#F6A09A', '#F0A0F7', '#F4B27A', '#B7ABFF'],
    connectionTitle: 'READY.',
  },
  greyscale: {
    label: 'Greyscale', scheme: 'dark', design: 'default',
    background: '#161616', bar: '#101010', panel: '#222222', field: '#2A2A2A',
    border: '#464646', text: '#E8E8E8', secondaryText: '#A6A6A6', accent: '#D0D0D0',
    emphasizedBackground: '#383838', emphasizedText: '#F3F3F3',
    warningSecondaryText: '#C8C8C8', prominentButtonText: '#101010',
    nicknameColors: ['#8B8B8B', '#9A9A9A', '#AAAAAA', '#BABABA', '#CACACA', '#D9D9D9', '#E7E7E7', '#F5F5F5'],
    connectionTitle: 'Connections',
  },
  lobster: {
    label: 'Lobster', scheme: 'dark', design: 'default',
    background: '#111827', bar: '#0F172A', panel: '#172033', field: '#1F2937',
    border: '#374151', text: '#E4E4E7', secondaryText: '#A1A1AA', accent: '#FF5C5C',
    emphasizedBackground: '#293548', emphasizedText: '#E4E4E7',
    warningSecondaryText: '#FF5C5C', prominentButtonText: '#111827',
    nicknameColors: ['#FF5C5C', '#22C55E', '#3B82F6', '#F59E0B', '#C084FC', '#2DD4BF', '#F472B6', '#FBBF24'],
    connectionTitle: 'Server Connections',
  },
};

// Ordering for the theme picker: System, Light, Dark, then named A→Z (matches
// IRCApplicationAppearance.settingsCases).
const THEME_ORDER = [
  'system', 'light', 'dark',
  ...Object.keys(THEMES)
    .filter((k) => k !== 'light' && k !== 'dark')
    .sort((a, b) => THEMES[a].label.localeCompare(THEMES[b].label)),
];

const FONT_STACKS = {
  default: `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', 'Helvetica Neue', Arial, sans-serif`,
  rounded: `ui-rounded, 'SF Pro Rounded', -apple-system, 'Segoe UI', 'Nunito', system-ui, sans-serif`,
  monospaced: `ui-monospace, 'SF Mono', 'JetBrains Mono', 'Cascadia Code', 'Consolas', 'Menlo', monospace`,
};

// FNV-1a hash → nickname color index (identical to ContentView.swift).
function nicknameColor(key, palette) {
  const colors = palette.nicknameColors;
  let hash = 0xcbf29ce484222325n; // 1469598103934665603
  const s = String(key).toLowerCase();
  for (let i = 0; i < s.length; i++) {
    hash ^= BigInt(s.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn; // *1099511628211 mod 2^64
  }
  const idx = Number(hash % BigInt(colors.length));
  return colors[idx];
}

// Resolve 'system' to light/dark using the OS preference.
function resolveThemeKey(key, systemIsDark) {
  if (key === 'system') return systemIsDark ? 'dark' : 'light';
  return THEMES[key] ? key : 'dark';
}

function applyTheme(key, systemIsDark) {
  const resolved = resolveThemeKey(key, systemIsDark);
  const p = THEMES[resolved];
  const root = document.documentElement;
  const map = {
    '--background': p.background, '--bar': p.bar, '--panel': p.panel,
    '--field': p.field, '--border': p.border, '--text': p.text,
    '--secondary-text': p.secondaryText, '--accent': p.accent,
    '--emphasized-bg': p.emphasizedBackground, '--emphasized-text': p.emphasizedText,
    '--warning-text': p.warningSecondaryText, '--prominent-button-text': p.prominentButtonText,
    '--font-stack': FONT_STACKS[p.design] || FONT_STACKS.default,
  };
  for (const [k, v] of Object.entries(map)) root.style.setProperty(k, v);
  root.style.colorScheme = p.scheme;
  return p;
}

const api = { THEMES, THEME_ORDER, FONT_STACKS, applyTheme, nicknameColor, resolveThemeKey };
if (typeof window !== 'undefined') window.NetsplitThemes = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
