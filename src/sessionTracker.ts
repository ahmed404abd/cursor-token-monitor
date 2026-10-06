import { UsageSnapshot } from './cursorApi';

export interface SessionStats {
  startedAt: Date;
  events: number;
  inputTokens: number;
  outputTokens: number;
  spendCents: number;
}

interface Baseline {
  at: Date;
  events: number;
  inputTokens: number;
  outputTokens: number;
  chargedCents: number;
}

let baseline: Baseline | undefined;

/** Record the first successful usage fetch as the session baseline. */
export function ensureSessionBaseline(usage: UsageSnapshot): void {
  if (baseline) return;
  baseline = {
    at: new Date(),
    events: usage.totalEventsThisPeriod ?? usage.recentEvents.length,
    inputTokens: usage.totalInputTokens ?? 0,
    outputTokens: usage.totalOutputTokens ?? 0,
    chargedCents: usage.totalCostCentsFromEvents ?? 0,
  };
}

/** Usage accumulated since this editor session started. */
export function getSessionStats(usage: UsageSnapshot): SessionStats | undefined {
  if (!baseline) return undefined;
  return {
    startedAt: baseline.at,
    events: Math.max(0, (usage.totalEventsThisPeriod ?? usage.recentEvents.length) - baseline.events),
    inputTokens: Math.max(0, (usage.totalInputTokens ?? 0) - baseline.inputTokens),
    outputTokens: Math.max(0, (usage.totalOutputTokens ?? 0) - baseline.outputTokens),
    spendCents: Math.max(0, (usage.totalCostCentsFromEvents ?? 0) - baseline.chargedCents),
  };
}

export function resetSessionBaseline(): void {
  baseline = undefined;
}
