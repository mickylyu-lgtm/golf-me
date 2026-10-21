// Small statistics helpers for the Caddie V2 report harness
// (EVAL_REPORT_TEMPLATE.md rules): Wilson intervals for proportions, a
// seeded clip-level bootstrap for means and percentiles, quantiles. Pure.

/** Rows with fewer than this many clips are marked "too few to conclude" (template rule). */
export const MIN_CLIPS_TO_CONCLUDE = 20;
export const BOOTSTRAP_RESAMPLES = 2000;

/** Wilson score interval, 95 %. Returns null for n = 0. */
export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Linear-interpolation quantile of a numeric array (q in 0..1). Null when empty. */
export function quantile(values, q) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const mean = (values) => {
  const s = values.filter(Number.isFinite);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
};

/** Deterministic PRNG (mulberry32), so a report re-run gives the same intervals. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Percentile bootstrap 95 % interval of `stat` over clip-level values
 * (resampling clips). Null with fewer than 2 values.
 */
export function bootstrapCi(values, stat = mean, { resamples = BOOTSTRAP_RESAMPLES, seed = 20261020 } = {}) {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return null;
  const rand = rng(seed);
  const out = [];
  for (let i = 0; i < resamples; i++) {
    const sample = Array.from({ length: v.length }, () => v[Math.floor(rand() * v.length)]);
    out.push(stat(sample));
  }
  return [quantile(out, 0.025), quantile(out, 0.975)];
}

export const median = (values) => quantile(values, 0.5);
