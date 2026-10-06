/**
 * Trust metadata for cockpit metrics — Official / Derived / Estimated / Stale.
 */

export type TrustSource = 'official' | 'derived' | 'estimated' | 'stale';

export interface TrustMeta {
  source: TrustSource;
  label: string;
  hint: string;
}

const LABELS: Record<TrustSource, string> = {
  official: 'Official',
  derived: 'Derived',
  estimated: 'Estimated',
  stale: 'Stale',
};

/** Official data older than ~2× refresh interval is marked stale. */
export function isStale(fetchedAtMs: number | undefined, refreshIntervalSeconds: number, nowMs = Date.now()): boolean {
  if (!fetchedAtMs || !Number.isFinite(fetchedAtMs)) return false;
  const limitMs = Math.max(30, refreshIntervalSeconds * 2) * 1000;
  return nowMs - fetchedAtMs > limitMs;
}

export function formatFetchedAge(fetchedAtMs: number | undefined, nowMs = Date.now()): string {
  if (!fetchedAtMs) return 'not fetched yet';
  const sec = Math.max(0, Math.round((nowMs - fetchedAtMs) / 1000));
  if (sec < 5) return 'just now';
  if (sec < 60) return `fetched ${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `fetched ${min}m ago`;
  const hr = Math.round(min / 60);
  return `fetched ${hr}h ago`;
}

export function makeTrust(
  source: TrustSource,
  hint: string,
  opts?: { fetchedAtMs?: number; refreshIntervalSeconds?: number; nowMs?: number }
): TrustMeta {
  let resolved: TrustSource = source;
  if (
    source === 'official' &&
    opts?.fetchedAtMs !== undefined &&
    opts.refreshIntervalSeconds !== undefined &&
    isStale(opts.fetchedAtMs, opts.refreshIntervalSeconds, opts.nowMs)
  ) {
    resolved = 'stale';
  }
  const age = formatFetchedAge(opts?.fetchedAtMs, opts?.nowMs);
  const finalHint =
    resolved === 'stale'
      ? `Older than 2× refresh · ${age}`
      : source === 'official'
        ? `${hint} · ${age}`
        : hint;
  return { source: resolved, label: LABELS[resolved], hint: finalHint };
}

export function buildTrustBundle(input: {
  fetchedAtMs?: number;
  refreshIntervalSeconds: number;
  nowMs?: number;
}): {
  planPercent: TrustMeta;
  quotas: TrustMeta;
  usedLimit: TrustMeta;
  reset: TrustMeta;
  runway: TrustMeta;
  heatmap: TrustMeta;
  workspaces: TrustMeta;
  legend: TrustMeta[];
} {
  const base = {
    fetchedAtMs: input.fetchedAtMs,
    refreshIntervalSeconds: input.refreshIntervalSeconds,
    nowMs: input.nowMs,
  };
  const planPercent = makeTrust('official', 'From Cursor usage API total %', base);
  const quotas = makeTrust('official', 'From Cursor dual Pro quota fields', base);
  const usedLimit = makeTrust('official', 'From Cursor included spend / limit', base);
  const reset = makeTrust('official', 'From Cursor billing cycle end', base);
  const runway = makeTrust('derived', 'Computed locally from official quotas + local daily spend');
  const heatmap = makeTrust('estimated', 'Local history; dashed cells mean not yet observed');
  const workspaces = makeTrust('estimated', 'Workspace shares are estimated — Cursor has no per-project billing IDs');
  return {
    planPercent,
    quotas,
    usedLimit,
    reset,
    runway,
    heatmap,
    workspaces,
    legend: [
      makeTrust('official', 'Taken directly from Cursor’s usage API'),
      makeTrust('derived', 'Computed locally from official numbers'),
      makeTrust('estimated', 'Guesses or local history'),
      makeTrust('stale', 'Official data older than ~2× refresh interval'),
    ],
  };
}
