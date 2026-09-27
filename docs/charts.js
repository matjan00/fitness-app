// Chart.js wrapper: creates a chart on a <canvas id>, destroying any previous one on that canvas.
// Chart.js is loaded globally from vendor/chart.umd.min.js.
import { cssVar } from './util.js';

const charts = new Map();

export function chart(canvas, config) {
  if (typeof canvas === 'string') canvas = document.getElementById(canvas);
  if (!canvas || !window.Chart) return null;
  charts.get(canvas)?.destroy();
  for (const [c, ch] of charts) if (!c.isConnected) { ch.destroy(); charts.delete(c); }
  Chart.defaults.color = cssVar('--text-2');
  Chart.defaults.borderColor = cssVar('--line');
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 11;
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.animation.duration = 300;
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
