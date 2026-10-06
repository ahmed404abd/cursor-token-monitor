/**
 * Cache-efficiency analytics from Cursor event token usage (cache reads vs input).
 * Uses shared SERIES_COLORS (same palette as Sankey / Models mix).
 */

import { UsageSnapshot, displayModelName } from './cursorApi';
import { dayKey } from './historyStore';
import { SERIES_COLORS } from './chartColors';

/** @deprecated use SERIES_COLORS — kept for older imports */
export const CACHE_CHART_COLORS = SERIES_COLORS;

export interface CacheModelRow {
  modelId: string;
  label: string;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  hitRatePercent: number;
  color: string;
}

export interface CacheSeries {
  id: string;
  label: string;
  color: string;
  points: { date: string; label: string; value: number }[];
}

export interface CacheEfficiency {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  hitRatePercent: number;
  hitRateLabel: string;
  cacheReadsLabel: string;
  inputLabel: string;
  outputLabel: string;
  summary: string;
  byModel: CacheModelRow[];
  /** Daily cache-read series per model (ccusage-style multi-line chart) */
  series: CacheSeries[];
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

export function cacheHitRate(cacheRead: number, input: number): number {
  const denom = cacheRead + input;
  if (denom <= 0) return 0;
  return (cacheRead / denom) * 100;
}

function buildDailySeries(usage: UsageSnapshot): CacheSeries[] {
  const byModelDay = new Map<string, Map<string, number>>();
  const dates = new Set<string>();

  for (const event of usage.recentEvents ?? []) {
    const ts = Number(event.timestamp);
    if (!Number.isFinite(ts)) continue;
    const date = dayKey(new Date(ts));
    dates.add(date);
    const modelId = event.model || 'unknown';
    const cache = event.tokenUsage?.cacheReadTokens ?? 0;
    if (cache <= 0) continue;
    if (!byModelDay.has(modelId)) byModelDay.set(modelId, new Map());
    const dayMap = byModelDay.get(modelId)!;
    dayMap.set(date, (dayMap.get(date) ?? 0) + cache);
  }

  const sortedDates = [...dates].sort();
  if (!sortedDates.length) return [];

  const ranked = [...byModelDay.entries()]
    .map(([id, days]) => ({
      id,
      total: [...days.values()].reduce((s, v) => s + v, 0),
    }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  return ranked.map((row, index) => {
    const days = byModelDay.get(row.id)!;
    return {
      id: row.id,
      label: displayModelName(row.id),
      color: CACHE_CHART_COLORS[index % CACHE_CHART_COLORS.length],
      points: sortedDates.map((date) => ({
        date,
        label: new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        }),
        value: days.get(date) ?? 0,
      })),
    };
  });
}

export function buildCacheEfficiency(usage: UsageSnapshot): CacheEfficiency {
  const inputTokens = usage.totalInputTokens ?? 0;
  const outputTokens = usage.totalOutputTokens ?? 0;
  const cacheReadTokens = usage.totalCacheReadTokens ?? 0;

  const fromModels = (usage.modelUsage ?? []).map((m, index) => {
    const hit = cacheHitRate(m.cacheReadTokens, m.inputTokens);
    return {
      modelId: m.modelId,
      label: m.label || displayModelName(m.modelId),
      inputTokens: m.inputTokens,
      cacheReadTokens: m.cacheReadTokens,
      outputTokens: m.outputTokens,
      hitRatePercent: hit,
      color: CACHE_CHART_COLORS[index % CACHE_CHART_COLORS.length],
    };
  });

  const sumCache = fromModels.reduce((s, r) => s + r.cacheReadTokens, 0);
  const sumIn = fromModels.reduce((s, r) => s + r.inputTokens, 0);
  const sumOut = fromModels.reduce((s, r) => s + r.outputTokens, 0);

  const cache = cacheReadTokens || sumCache;
  const input = inputTokens || sumIn;
  const output = outputTokens || sumOut;
  const hitRatePercent = cacheHitRate(cache, input);

  const byModel = [...fromModels]
    .filter((r) => r.cacheReadTokens > 0 || r.inputTokens > 0)
    .sort((a, b) => b.cacheReadTokens - a.cacheReadTokens || b.hitRatePercent - a.hitRatePercent)
    .slice(0, 12)
    .map((row, index) => ({
      ...row,
      color: CACHE_CHART_COLORS[index % CACHE_CHART_COLORS.length],
    }));

  const summary =
    cache + input <= 0
      ? 'No token volume this cycle yet — cache stats appear after Cursor reports token usage.'
      : hitRatePercent >= 50
        ? `${formatTokens(cache)} tokens served from cache (${hitRatePercent.toFixed(0)}% hit rate) — strong reuse this cycle.`
        : hitRatePercent >= 20
          ? `${formatTokens(cache)} cache reads vs ${formatTokens(input)} new input (${hitRatePercent.toFixed(0)}% hit rate).`
          : `Low cache reuse: ${hitRatePercent.toFixed(0)}% hit rate (${formatTokens(cache)} cache / ${formatTokens(input)} input).`;

  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cache,
    hitRatePercent,
    hitRateLabel: `${hitRatePercent.toFixed(hitRatePercent < 10 ? 1 : 0)}%`,
    cacheReadsLabel: formatTokens(cache),
    inputLabel: formatTokens(input),
    outputLabel: formatTokens(output),
    summary,
    byModel,
    series: buildDailySeries(usage),
  };
}
