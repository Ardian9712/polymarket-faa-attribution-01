import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const mode = 'B'; // Settled sweep winner: persistence median, pooled empirical horizon shape.
const taus = [0.05, 0.25, 0.5, 0.75, 0.95];

type Market = { id: string; prices: number[] };
type Input = { horizon_minutes: number; quantiles: number[]; markets: Market[] };

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const round = (x: number): number => Math.round(clamp(x, 0, 1) * 1e6) / 1e6;
const quantile = (a: number[], p: number): number => {
  const s = [...a].sort((x, y) => x - y);
  const k = (s.length - 1) * p;
  const i = Math.floor(k);
  return s[i] + (s[Math.ceil(k)] - s[i]) * (k - i);
};
const sortedQuantiles = (sorted: number[], levels: number[]): number[] => levels.map((p) => {
  const k = (sorted.length - 1) * p, i = Math.floor(k);
  return sorted[i] + (sorted[Math.ceil(k)] - sorted[i]) * (k - i);
});

function makeForecast(markets: Market[], horizon: number, selectedMode = mode, tuneFactors?: number[], prepared?: { sigmas: number[]; shapes: number[][][] }): number[][][] {
  if (selectedMode === 'A') return markets.map((m) => {
    const x = m.prices[m.prices.length - 1];
    return Array.from({ length: horizon }, (_, i) => [-1.644854, -0.67449, 0, 0.67449, 1.644854].map((v) => round(x + v * 0.0025 * Math.sqrt(i + 1))));
  });
  if (prepared) return makeWithPrepared(markets, horizon, selectedMode, tuneFactors, prepared);
  const vols = markets.map((m) => {
    const p = m.prices;
    const start = Math.max(1, p.length - 360);
    let sum = 0;
    for (let i = start; i < p.length; i++) sum += (p[i] - p[i - 1]) ** 2;
    return p.length - start < 30 ? 0.0025 : Math.max(1e-8, Math.sqrt(sum / Math.max(1, p.length - start)));
  });
  const pooled = Math.exp(vols.reduce((s, v) => s + Math.log(v), 0) / vols.length);
  const sigmas = vols.map((v) => clamp(Math.exp(0.7 * Math.log(v) + 0.3 * Math.log(pooled)) * 0.85, 0.25 * pooled, 100 * pooled));
  const shapeByMarket = markets.map(() => Array.from({ length: horizon }, () => [1.644854, 0.67449, 0.67449, 1.644854]));
  const maxObservedHorizon = Math.min(horizon, 240);
  for (let h = 1; h <= maxObservedHorizon; h++) {
    const pooledChanges: number[] = [];
    const samples: number[][] = markets.map(() => []);
    for (let j = 0; j < markets.length; j++) {
      const p = markets[j].prices;
      const end = p.length - 1, begin = Math.max(h, p.length - 720);
      for (let i = begin; i <= end; i++) {
        const move = (p[i] - p[i - h]) / sigmas[j];
        pooledChanges.push(move);
        samples[j].push(move);
      }
    }
    if (pooledChanges.length >= 200) {
      pooledChanges.sort((a, b) => a - b);
      const empirical = sortedQuantiles(pooledChanges, [0.05, 0.25, 0.75, 0.95]);
      const pooledShape = empirical.map((v, k) => 0.6 * Math.abs(v) + 0.4 * [1.644854, 0.67449, 0.67449, 1.644854][k]);
      for (let j = 0; j < markets.length; j++) {
        if (samples[j].length >= 20) {
          samples[j].sort((a, b) => a - b);
          const local = sortedQuantiles(samples[j], [0.05, 0.25, 0.75, 0.95]);
        const shape = local.map((v, k) => 0.6 * (0.6 * Math.abs(v) + 0.4 * [1.644854, 0.67449, 0.67449, 1.644854][k]) + 0.4 * pooledShape[k]);
        shape[0] = Math.max(shape[0], shape[1]);
        shape[3] = Math.max(shape[3], shape[2]);
        shapeByMarket[j][h - 1] = shape;
        } else shapeByMarket[j][h - 1] = pooledShape;
      }
    }
  }
  return makeWithPrepared(markets, horizon, selectedMode, tuneFactors, { sigmas, shapes: shapeByMarket });
}

function makeWithPrepared(markets: Market[], horizon: number, selectedMode: string, tuneFactors: number[] | undefined, prepared: { sigmas: number[]; shapes: number[][][] }): number[][][] {
  return markets.map((m, j) => {
    const p = m.prices;
    const last = p[p.length - 1];
    let drift = 0;
    if (selectedMode === 'C' || selectedMode === 'E') {
      const ret = (n: number): number => p.length > n ? last - p[p.length - 1 - n] : 0;
      const meanStart = Math.max(0, p.length - 360);
      const mean = p.slice(meanStart).reduce((a, b) => a + b, 0) / (p.length - meanStart);
      drift = clamp(0.04 * ret(15) + 0.025 * ret(60) + 0.008 * ret(240) - 0.02 * (last - mean), -0.00008, 0.00008);
    }
    return Array.from({ length: horizon }, (_, ix) => {
      const h = ix + 1;
      const factor = tuneFactors?.[Math.min(3, h <= 15 ? 0 : h <= 60 ? 1 : h <= 120 ? 2 : 3)] ?? 1;
      const center = last + drift * h;
      const w = prepared.shapes[j][h - 1];
      const scale = prepared.sigmas[j] * factor;
      const row = [center - w[0] * scale, center - w[1] * scale, center, center + w[2] * scale, center + w[3] * scale];
      return row.map(round);
    });
  });
}

mkdirSync(outputDir, { recursive: true });
for (const file of readdirSync(inputDir).filter((f) => f.endsWith('.in')).sort()) {
  const c = JSON.parse(readFileSync(join(inputDir, file), 'utf8')) as Input;
  if (JSON.stringify(c.quantiles) !== JSON.stringify(taus)) throw new Error('unexpected quantiles');
  // Width calibration and drift were excluded: neither beat B across all evaluation splits.
  const factors = [1, 1, 1, 1];
  const qs = makeForecast(c.markets, c.horizon_minutes, mode, factors);
  const forecasts = c.markets.map((m, i) => ({ id: m.id, q: qs[i] }));
  writeFileSync(join(outputDir, `${file.slice(0, -3)}.out`), `${JSON.stringify({ forecasts })}\n`);
}
