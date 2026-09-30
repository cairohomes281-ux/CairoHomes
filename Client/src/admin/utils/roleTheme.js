/**
 * Cairo Homes PMS role themes — every desk shares the pine / blush brand family,
 * each with its own accent so staff can tell portals apart at a glance.
 */

function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function theme(id, eyebrow, palette, overrides = {}) {
  const { sidebar, accent, accentHover, accentText, surface, surfaceDeep, badgeClass, chipClass } = palette;
  return {
    id,
    eyebrow,
    sidebarFrom: sidebar[0],
    sidebarVia: sidebar[1],
    sidebarTo: sidebar[2],
    accent,
    accentHover,
    accentSoft: rgba(accent, 0.18),
    accentText,
    surface,
    surfaceDeep,
    headerTint: rgba(accent, 0.07),
    avatarBg: accent,
    badgeClass,
    chipClass,
    navGlow: rgba(accent, 0.26),
    ...overrides,
  };
}

const PINE = {
  sidebar: ['#0c1f1d', '#1e3f3b', '#2f5d58'],
  accent: '#b5725a',
  accentHover: '#9c5d47',
  accentText: '#8a4f3a',
  surface: '#fdf6f2',
  surfaceDeep: '#f6e6de',
  badgeClass: 'badge-ch-clay',
  chipClass: 'bg-[#fee8e2] text-[#8a4f3a]',
};

const CLAY = {
  sidebar: ['#15302c', '#2f5d58', '#3b6c66'],
  accent: '#c0785c',
  accentHover: '#a76449',
  accentText: '#7f4632',
  surface: '#fdf7f4',
  surfaceDeep: '#f7e8e1',
  badgeClass: 'badge-ch-orange',
  chipClass: 'bg-[#fdefe9] text-[#7f4632]',
};

const SAGE = {
  sidebar: ['#102926', '#24524c', '#356d66'],
  accent: '#4f8a7f',
  accentHover: '#3f7268',
  accentText: '#2a5a51',
  surface: '#f3f8f6',
  surfaceDeep: '#e3efeb',
  badgeClass: 'badge-ch-teal',
  chipClass: 'bg-[#e6f1ee] text-[#24524c]',
};

const DUNE = {
  sidebar: ['#261d19', '#3f2f28', '#5a4338'],
  accent: '#c98f78',
  accentHover: '#b07863',
  accentText: '#7a4a38',
  surface: '#fdf7f4',
  surfaceDeep: '#f5e6de',
  badgeClass: 'badge-ch-orange',
  chipClass: 'bg-[#fee8e2] text-[#7a4a38]',
};

const BRASS = {
  sidebar: ['#11201d', '#1e342f', '#2c4943'],
  accent: '#b8925a',
  accentHover: '#9f7b46',
  accentText: '#6e5327',
  surface: '#fbf8f1',
  surfaceDeep: '#f1e9da',
  badgeClass: 'badge-ch-slate',
  chipClass: 'bg-amber-50 text-amber-900',
};

const MIST = {
  sidebar: ['#182625', '#283d3b', '#385350'],
  accent: '#6f958e',
  accentHover: '#5b7e77',
  accentText: '#3a5550',
  surface: '#f4f8f7',
  surfaceDeep: '#e5eeec',
  badgeClass: 'badge-ch-slate',
  chipClass: 'bg-[#e9f1ef] text-[#3a5550]',
};

const NILE = {
  sidebar: ['#0d2625', '#1a4442', '#255c58'],
  accent: '#3f8f84',
  accentHover: '#32766d',
  accentText: '#1f5c55',
  surface: '#f2f8f7',
  surfaceDeep: '#e2eeeb',
  badgeClass: 'badge-ch-teal',
  chipClass: 'bg-teal-50 text-teal-900',
};

export const ROLE_THEMES = {
  admin: theme('admin', 'CEO', PINE),
  reservations: theme('reservations', 'Front desk', CLAY),
  reservations_web: theme('reservations_web', 'Website desk', CLAY),
  reservations_manual: theme('reservations_manual', 'Walk-in desk', CLAY),
  reservations_manager: theme('reservations_manager', 'Reservations desk', CLAY, {
    sidebarFrom: '#0f2522',
    accent: '#ad6a50',
    accentHover: '#945840',
    accentSoft: rgba('#ad6a50', 0.2),
    navGlow: rgba('#ad6a50', 0.3),
    avatarBg: '#ad6a50',
  }),
  unit_acquisition_agent: theme('unit_acquisition_agent', 'Unit acquisition', SAGE),
  unit_acquisition_manager: theme('unit_acquisition_manager', 'Acquisition desk', SAGE, {
    sidebarFrom: '#0b211e',
    avatarBg: '#24524c',
  }),
  resale: theme('resale', 'Portfolio desk', SAGE),
  resale_manager: theme('resale_manager', 'Resale desk', SAGE, {
    sidebarFrom: '#0b211e',
    avatarBg: '#24524c',
  }),
  marketing_pr: theme('marketing_pr', 'Marketing & PR', DUNE),
  web_developer: theme('web_developer', 'Web development', MIST),
  finance: theme('finance', 'Finance desk', BRASS),
  finance_manager: theme('finance_manager', 'Finance desk', BRASS, { avatarBg: '#8a6a36' }),
  hr: theme('hr', 'People & talent', MIST),
  hr_supervisor: theme('hr_supervisor', 'HR Manager', MIST, {
    sidebarFrom: '#122020',
    avatarBg: '#4d6c66',
  }),
  owners_relations: theme('owners_relations', 'Owner Experience', SAGE),
  operations: theme('operations', 'Check-in desk', NILE),
  operations_supervisor: theme('operations_supervisor', 'Ops supervisor', NILE, {
    sidebarFrom: '#0a1f1e',
    avatarBg: '#32766d',
  }),
  housekeeping: theme('housekeeping', 'Clean desk', MIST, { chipClass: 'bg-sky-50 text-sky-800' }),
  housekeeping_supervisor: theme('housekeeping_supervisor', 'HK supervisor', MIST, {
    sidebarFrom: '#122020',
    chipClass: 'bg-sky-50 text-sky-900',
  }),
  owner: theme('owner', 'Owner portal', SAGE),
};

export function getRoleTheme(role) {
  return ROLE_THEMES[role] || ROLE_THEMES.admin;
}

export function roleThemeVars(role) {
  const t = getRoleTheme(role);
  return {
    '--pms-sidebar-from': t.sidebarFrom,
    '--pms-sidebar-via': t.sidebarVia,
    '--pms-sidebar-to': t.sidebarTo,
    '--pms-accent': t.accent,
    '--pms-accent-hover': t.accentHover,
    '--pms-accent-soft': t.accentSoft,
    '--pms-accent-text': t.accentText,
    '--pms-surface': t.surface,
    '--pms-surface-deep': t.surfaceDeep,
    '--pms-header-tint': t.headerTint,
    '--pms-avatar': t.avatarBg,
    '--pms-nav-glow': t.navGlow,
  };
}
