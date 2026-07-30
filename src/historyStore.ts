import * as vscode from 'vscode';
import { UsageSnapshot } from './cursorApi';
import { centsToDollars } from './usageIntelligence';

export interface DailySnapshot {
  /** YYYY-MM-DD local */
  date: string;
  includedSpendCents: number;
  remainingCents: number;
  limitCents: number;
  eventCount: number;
  chargedCents: number;
  inputTokens: number;
  outputTokens: number;
  updatedAt: string;
}

export interface DaySpend {
  date: string;
  label: string;
  chargedCents: number;
  eventCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface SessionStat {
  conversationId: string;
  shortId: string;
  eventCount: number;
  chargedCents: number;
  durationMs: number;
  startMs: number;
  endMs: number;
  models: string[];
}

const HISTORY_KEY = 'cursorTokenMonitor.dailyHistory';
const MAX_DAYS = 90;

export function dayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function loadHistory(context: vscode.ExtensionContext): DailySnapshot[] {
  return context.globalState.get<DailySnapshot[]>(HISTORY_KEY, []);
}

export function resetHistory(context: vscode.ExtensionContext): void {
  void context.globalState.update(HISTORY_KEY, []);
}

/** Upsert today's cumulative plan snapshot (for trend of included spend). */
export function recordDailySnapshot(
  context: vscode.ExtensionContext,
  usage: UsageSnapshot
): DailySnapshot[] {
  const history = loadHistory(context);
  const today = dayKey();
  const plan = usage.planUsage;
  const snap: DailySnapshot = {
    date: today,
    includedSpendCents: plan?.includedSpend ?? 0,
    remainingCents: plan?.remaining ?? 0,
    limitCents: plan?.limit ?? 0,
    eventCount: usage.totalEventsThisPeriod ?? usage.recentEvents.length,
    chargedCents: usage.totalCostCentsFromEvents ?? 0,
    inputTokens: usage.totalInputTokens ?? 0,
    outputTokens: usage.totalOutputTokens ?? 0,
    updatedAt: new Date().toISOString(),
  };

  const idx = history.findIndex((h) => h.date === today);
  if (idx >= 0) history[idx] = snap;
  else history.push(snap);

  history.sort((a, b) => a.date.localeCompare(b.date));
  const trimmed = history.slice(-MAX_DAYS);
  void context.globalState.update(HISTORY_KEY, trimmed);
  return trimmed;
}

/** Daily spend derived from usage events (best available for charts). */
export function buildDailySpendFromEvents(usage: UsageSnapshot, lastN = 30): DaySpend[] {
  const map = new Map<string, DaySpend>();

  for (const e of usage.recentEvents) {
    const ts = Number(e.timestamp);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const d = new Date(ts);
    const key = dayKey(d);
    const existing = map.get(key) ?? {
      date: key,
      label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      chargedCents: 0,
      eventCount: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    existing.chargedCents += e.chargedCents ?? 0;
    existing.eventCount += 1;
    existing.inputTokens += e.tokenUsage?.inputTokens ?? 0;
    existing.outputTokens += e.tokenUsage?.outputTokens ?? 0;
    map.set(key, existing);
  }

  // Also fold history deltas where events are sparse
  return [...map.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-lastN);
}

/** Approximate daily included-spend burn from successive snapshots. */
export function buildDailySpendFromHistory(history: DailySnapshot[], lastN = 30): DaySpend[] {
  if (history.length === 0) return [];
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const out: DaySpend[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const prev = i > 0 ? sorted[i - 1] : undefined;
    let daySpend = cur.includedSpendCents;
    if (prev) {
      // Same billing cycle: delta; if spend dropped, cycle likely reset
      daySpend =
        cur.includedSpendCents >= prev.includedSpendCents
          ? cur.includedSpendCents - prev.includedSpendCents
          : cur.includedSpendCents;
    }
    const d = new Date(cur.date + 'T12:00:00');
    out.push({
      date: cur.date,
      label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      chargedCents: daySpend,
      eventCount: cur.eventCount,
      inputTokens: cur.inputTokens,
      outputTokens: cur.outputTokens,
    });
  }

  return out.slice(-lastN);
}

export function mergeDailySpend(fromEvents: DaySpend[], fromHistory: DaySpend[], lastN = 30): DaySpend[] {
  const map = new Map<string, DaySpend>();
  for (const d of fromHistory) map.set(d.date, { ...d });
  for (const d of fromEvents) {
    const existing = map.get(d.date);
    if (!existing || d.chargedCents >= existing.chargedCents) {
      map.set(d.date, d);
    }
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-lastN);
}

export function topSpendingDays(days: DaySpend[], n = 5): DaySpend[] {
  return [...days].sort((a, b) => b.chargedCents - a.chargedCents).slice(0, n);
}

export function longestSessions(usage: UsageSnapshot, n = 5): SessionStat[] {
  const map = new Map<string, SessionStat>();
  for (const e of usage.recentEvents) {
    const id = e.conversationId || `anon-${e.timestamp}`;
    const ts = Number(e.timestamp) || 0;
    const existing = map.get(id) ?? {
      conversationId: id,
      shortId: id.length > 10 ? `${id.slice(0, 8)}…` : id,
      eventCount: 0,
      chargedCents: 0,
      durationMs: 0,
      startMs: ts || Date.now(),
      endMs: ts || Date.now(),
      models: [],
    };
    existing.eventCount += 1;
    existing.chargedCents += e.chargedCents ?? 0;
    if (ts) {
      existing.startMs = Math.min(existing.startMs, ts);
      existing.endMs = Math.max(existing.endMs, ts);
    }
    if (e.model && !existing.models.includes(e.model)) existing.models.push(e.model);
    existing.durationMs = Math.max(0, existing.endMs - existing.startMs);
    map.set(id, existing);
  }
  return [...map.values()].sort((a, b) => b.durationMs - a.durationMs).slice(0, n);
}

export interface SpendSummary {
  todayCents: number;
  yesterdayCents: number;
  sevenDayAvgCents: number;
  sevenDayTotalCents: number;
}

/** Today / yesterday / 7-day average derived from the daily spend series. */
export function summarizeSpend(days: DaySpend[]): SpendSummary {
  const today = dayKey();
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const todayCents = days.find((d) => d.date === today)?.chargedCents ?? 0;
  const yesterdayCents = days.find((d) => d.date === yesterday)?.chargedCents ?? 0;
  const last7 = days.slice(-7);
  const sevenDayTotalCents = last7.reduce((s, d) => s + d.chargedCents, 0);
  const sevenDayAvgCents = last7.length ? sevenDayTotalCents / last7.length : 0;
  return { todayCents, yesterdayCents, sevenDayAvgCents, sevenDayTotalCents };
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export function formatDayList(days: DaySpend[]): string {
  return days.map((d) => `${d.label}   ${centsToDollars(d.chargedCents)}`).join('\n');
}
