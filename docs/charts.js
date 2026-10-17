// Chart.js wrapper: creates a chart on a <canvas id>, destroying any previous one on that canvas.
// Chart.js is loaded globally from vendor/chart.umd.min.js.
import { cssVar } from './util.js';

const charts = new Map();

export function chart(canvas, config) {
  if (typeof canvas === 'string') canvas = document.getElementById(canvas);
  if (!canvas || !window.Chart) return null;
  charts.get(canvas)?.destroy();
  for (const [c, ch] of charts) if (!c.isConnected) { ch.destroy(); charts.delete(c); }
  Chart.defaults.locale = 'en-GB'; // "84.6", "18,000" - the same number format as the rest of the app
  Chart.defaults.color = cssVar('--text-2');
  Chart.defaults.borderColor = cssVar('--line');
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 11;
  Chart.defaults.plugins.legend.display = false;
  // Smoothed lines never overshoot the data (no dips below zero between points).
  Chart.defaults.elements.line.cubicInterpolationMode = 'monotone';
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.animation.duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300;
  // A canvas is invisible to screen readers: name it after its card ("Body weight chart").
  if (!canvas.hasAttribute('aria-label')) {
    const h = canvas.closest('.card')?.querySelector('h2, h3');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${h ? h.textContent.trim() : 'Data'} chart`);
  }
  const ch = new Chart(canvas, config);
  charts.set(canvas, ch);
  return ch;
}

// Vertical gradient fill for line charts: colour at the top fading to transparent.
export const fade = (color) => ({ chart: c }) => {
  if (!c.chartArea) return 'transparent';
  const g = c.ctx.createLinearGradient(0, c.chartArea.top, 0, c.chartArea.bottom);
  g.addColorStop(0, color + '55');
  g.addColorStop(1, color + '00');
  return g;
};
export { cssVar };

// Distinct colours for several lines in one chart (lifts, trend vs plan). Read from the theme, so dark mode works.
export const SERIES = ['--accent', '--protein', '--up', '--fat', '--text-2'];
export const seriesColor = (i) => cssVar(SERIES[i % SERIES.length]);

// Charts read their colours when drawn: redraw the tab when the phone switches between light and dark.
const themeFns = new Set();
export const onThemeChange = (fn) => { themeFns.add(fn); return () => themeFns.delete(fn); };
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => themeFns.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }));
