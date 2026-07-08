// Pure statistics for personal baselines (prep spec §4/§7 shared constants):
// 7-day vs 60-day windows, deviation = 1 SD, personal baselines only.

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function sd(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** z-score of a value against a baseline; null when baseline is unusable. */
export function zScore(value: number | null, baselineMean: number | null, baselineSd: number | null): number | null {
  if (value == null || baselineMean == null || baselineSd == null || baselineSd === 0) return null;
  return (value - baselineMean) / baselineSd;
}

/**
 * Standard-deviation of clock times (e.g. bedtimes), circular-safe around
 * midnight: times are mapped to minutes-from-noon so 23:30 and 00:30 are 60
 * minutes apart, not 23 hours.
 */
export function clockTimeSdMinutes(instants: Date[], timeZone: string): number | null {
  if (instants.length < 2) return null;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const minutesFromNoon = instants.map((d) => {
    const parts = fmt.formatToParts(d);
    const h = Number(parts.find((p) => p.type === "hour")!.value) % 24;
    const m = Number(parts.find((p) => p.type === "minute")!.value);
    // Shift so noon = 0; times after noon are 0..720, after midnight 720..1440.
    return ((h * 60 + m) - 12 * 60 + 24 * 60) % (24 * 60);
  });
  return sd(minutesFromNoon);
}

/**
 * Training load proxy: sum of workout duration-minutes weighted by relative
 * intensity (avg HR when present), plus a light contribution from daily
 * exercise minutes. Deliberately simple v1 — tuned in Stage 4+ with real data.
 */
export function sessionLoad(durationMin: number, avgHr: number | null): number {
  const intensity = avgHr == null ? 1 : Math.max(0.6, Math.min(1.8, avgHr / 120));
  return durationMin * intensity;
}
