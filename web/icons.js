// Local, dependency-free interface icons. All paths are authored SVG, never HTML from the API.
const paths = {
  pulse: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-11 12a2 2 0 0 0 4 0"/>',
  chart: '<path d="M3 3v18h18M7 14l4-4 4 3 6-7"/>',
  settings:
    '<path d="m9 3-1 3-3 1-2 4 2 2v4l4 3 3-1 3 1 4-3v-4l2-2-2-4-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  arrowUp: '<path d="m7 14 5-5 5 5M12 9v11"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  alert:
    '<path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0ZM12 9v4m0 4h.01"/>',
  heart:
    '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  drop: '<path d="M12 3c-2 3-7 7.4-7 12a7 7 0 0 0 14 0c0-4.6-5-9-7-12Z"/><path d="M8 15a4 4 0 0 0 4 4"/>',
  thermometer: '<path d="M9 14.8V5a3 3 0 0 1 6 0v9.8a5 5 0 1 1-6 0Z"/><path d="M12 9v9m0 0h.01"/>',
  lungs:
    '<path d="M12 3v9m0-3-3 3m3-3 3 3M8 6C5 6 2 12 2 17c0 3 2 4 5 2l2-2V6Zm8 0c3 0 6 6 6 11 0 3-2 4-5 2l-2-2V6Z"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5m-4-4a8 8 0 0 1 13-3l2 2M4 17l2 2a8 8 0 0 0 13-3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  moon: '<path d="M21 13a9 9 0 0 1-10-10A9 9 0 1 0 21 13Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bed: '<path d="M3 18v3m18-3v3M3 11V4m0 10h18v4H3zm3 0V8h5a3 3 0 0 1 3 3v3m0-5h4a3 3 0 0 1 3 3v2"/>',
  shield: '<path d="m12 3 9 4v6c0 5-9 9-9 9s-9-4-9-9V7z"/><path d="m8 12 3 3 5-6"/>',
  sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  file: '<path d="M14 2H5v20h14V7zm0 0v5h5M8 12h8m-8 4h5"/>',
  external: '<path d="M15 3h6v6m-9 3 9-9M9 3H3v18h18v-6"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',
  volume: '<path d="m11 5-6 4H2v6h3l6 4zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  logout: '<path d="M9 3H3v18h6m0-9h12m-4-4 4 4-4 4"/>',
};

export function icon(name, className = '') {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.pulse}</svg>`;
}
