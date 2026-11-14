// SVG charts use actual stored readings, with no CDN or chart-library dependency.
export const CHART_COLORS = { heart_rate: '#088c87', oxygen: '#5888ca', blood_pressure_sys: '#ac79b5' };

const numeric = (values) => values.filter(Number.isFinite);
const fixed = (value) => Number(value).toFixed(1);

export function sparkline(values, color = '#088c87', id = 'spark', width = 260, height = 48) {
  const points = numeric(values);
  if (!points.length) return '<span class="chart-empty">No readings yet</span>';
  const min = Math.min(...points) - 3;
  const max = Math.max(...points) + 3;
  const coords = points.map((value, i) => [
    4 + (i * (width - 8)) / Math.max(1, points.length - 1),
    height - 6 - ((value - min) / (max - min)) * (height - 12),
  ]);
  const path = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${fixed(x)},${fixed(y)}`).join(' ');
  const last = coords.at(-1);
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Heart rate history, ${points.length} readings, from ${points[0]} to ${points.at(-1)} beats per minute" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".15"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${path} L${width - 4},${height} L4,${height} Z" fill="url(#${id})"/><path d="${path}" fill="none" stroke="${color}" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${fixed(last[0])}" cy="${fixed(last[1])}" r="2.5" fill="${color}"/></svg>`;
}

export function lineChart(
  series,
  { metric = 'heart_rate', id = 'trend', label = 'Heart rate', unit = 'bpm', compact = false } = {},
) {
  const clean = series.filter((p) => Number.isFinite(p.value));
  if (!clean.length)
    return '<div class="empty-state chart-empty">No readings available. Add a patient or record a reading to start a trend.</div>';
  const width = 720,
    height = compact ? 205 : 228;
  const pad = { l: 40, r: 20, t: 18, b: 35 };
  const low = Math.min(...clean.map((p) => p.value)),
    high = Math.max(...clean.map((p) => p.value));
  const step = metric === 'oxygen' ? 1 : metric === 'temperature' ? 0.5 : 10;
  const spread = Math.max(step * 2, high - low);
  const min = Math.floor((low - spread * 0.18) / step) * step;
  const max = Math.ceil((high + spread * 0.18) / step) * step;
  const color = CHART_COLORS[metric] || '#088c87';
  const chartW = width - pad.l - pad.r,
    chartH = height - pad.t - pad.b;
  const times = clean.map((point) => new Date(point.timestamp).valueOf());
  const useTime = times.every(Number.isFinite) && Math.max(...times) > Math.min(...times);
  const firstTime = Math.min(...times),
    duration = Math.max(...times) - firstTime;
  const coords = clean.map((point, i) => [
    pad.l + (useTime ? (times[i] - firstTime) / duration : i / Math.max(1, clean.length - 1)) * chartW,
    height - pad.b - ((point.value - min) / Math.max(0.01, max - min)) * chartH,
  ]);
  const path = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${fixed(x)},${fixed(y)}`).join(' ');
  const grids = Array.from({ length: 5 }, (_, i) => {
    const value = min + ((max - min) * i) / 4;
    const y = height - pad.b - (chartH * i) / 4;
    return `<line x1="${pad.l}" x2="${width - pad.r}" y1="${fixed(y)}" y2="${fixed(y)}" stroke="currentColor" stroke-opacity=".09" stroke-dasharray="3 5"/><text x="${pad.l - 12}" y="${fixed(y + 4)}" text-anchor="end" class="chart-axis">${Number(value.toFixed(1))}</text>`;
  }).join('');
  const tickIndices = [
    ...new Set([
      0,
      Math.floor(clean.length / 4),
      Math.floor(clean.length / 2),
      Math.floor(clean.length * 0.75),
      clean.length - 1,
    ]),
  ];
  const ticks = tickIndices
    .map((i) => {
      const timestamp = new Date(clean[i].timestamp);
      const text = Number.isNaN(timestamp.valueOf())
        ? ''
        : timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      return `<text x="${fixed(coords[i][0])}" y="${height - 8}" text-anchor="${i === 0 ? 'start' : i === clean.length - 1 ? 'end' : 'middle'}" class="chart-axis">${text}</text>`;
    })
    .join('');
  const last = coords.at(-1);
  const markers = clean
    .map(
      (point, i) =>
        `<circle cx="${fixed(coords[i][0])}" cy="${fixed(coords[i][1])}" r="8" fill="transparent"><title>${new Date(point.timestamp).toLocaleTimeString()}: ${Number(point.value.toFixed(1))} ${unit}</title></circle>`,
    )
    .join('');
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}, ${clean.length} readings. Current ${Number(clean.at(-1).value.toFixed(1))} ${unit}. Minimum ${Number(low.toFixed(1))}, maximum ${Number(high.toFixed(1))}."><defs><linearGradient id="${id}-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".16"/><stop offset="100%" stop-color="${color}" stop-opacity=".01"/></linearGradient></defs>${grids}${ticks}<path d="${path} L${fixed(last[0])},${height - pad.b} L${pad.l},${height - pad.b} Z" fill="url(#${id}-fill)"/><path d="${path}" stroke="${color}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${fixed(last[0])}" cy="${fixed(last[1])}" r="5" fill="${color}" stroke="var(--surface, white)" stroke-width="3"/>${markers}</svg>`;
}

export function aggregateSeries(patients, metric) {
  // Align by time, not array index. Each patient contributes at most its latest
  // reading in a minute, so a fast sensor cannot outweigh a slower sensor.
  const minutes = new Map();
  patients.forEach((patient, index) => {
    for (const reading of patient.history || []) {
      const timestamp = new Date(reading.timestamp).valueOf();
      if (!Number.isFinite(timestamp) || !Number.isFinite(reading[metric])) continue;
      const minute = Math.floor(timestamp / 60000) * 60000;
      if (!minutes.has(minute)) minutes.set(minute, new Map());
      const bucket = minutes.get(minute);
      const key = patient.patient_id || index;
      if (!bucket.has(key) || bucket.get(key).timestamp <= timestamp)
        bucket.set(key, { timestamp, value: reading[metric] });
    }
  });
  return [...minutes]
    .sort(([a], [b]) => a - b)
    .slice(-60)
    .map(([minute, entries]) => {
      const values = [...entries.values()];
      return {
        timestamp: new Date(minute).toISOString(),
        value: values.reduce((sum, item) => sum + item.value, 0) / values.length,
        count: values.length,
      };
    });
}

export function acuityRing(counts) {
  const total = counts.normal + counts.warning + counts.critical;
  const radius = 62,
    circumference = Math.PI * radius * 2;
  let offset = 0;
  const segments = [
    ['normal', '#0b8d87'],
    ['warning', '#e7aa46'],
    ['critical', '#df6976'],
  ]
    .map(([status, color]) => {
      const size = total ? (counts[status] / total) * circumference : 0;
      const circle = size
        ? `<circle cx="82" cy="82" r="${radius}" fill="none" stroke="${color}" stroke-width="15" stroke-dasharray="${Math.max(0, size - 5)} ${circumference}" stroke-dashoffset="${-offset}" stroke-linecap="round"/>`
        : '';
      offset += size;
      return circle;
    })
    .join('');
  return `<svg viewBox="0 0 164 164" role="img" aria-label="Patient status: ${counts.normal} stable, ${counts.warning} need attention, ${counts.critical} critical"><circle cx="82" cy="82" r="62" fill="none" stroke="currentColor" stroke-opacity=".06" stroke-width="15"/><g transform="rotate(-90 82 82)">${segments}</g></svg><div class="acuity-total"><strong>${total}</strong><span>patients</span></div>`;
}
