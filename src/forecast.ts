import { DaySpend } from './historyStore';
import { UsageSnapshot } from './cursorApi';
import { centsToDollars, formatPercent } from './usageIntelligence';

export interface QuotaForecast {
  id: 'cursorModels' | 'otherModels' | 'included';
  label: string;
  percentUsed: number;
  /** Projected percent used by cycle end at current burn rate */
  projectedPercentAtCycleEnd: number;
  /** Whole days until this pool hits 100% at current rate; null if already exhausted or flat */
  daysUntilExhausted: number | null;
  dailyBurnPercent: number;
  daysElapsed: number;
  daysRemaining: number;
  summary: string;
  level: 'info' | 'warn' | 'alert';
}

export interface BurnForecast {
  daysElapsed: number;
  daysRemaining: number;
  cycleLengthDays: number;
  quotas: QuotaForecast[];
  headline: string;
  detail: string;
}

function daysBetween(startMs: number, endMs: number): number {
  return Math.max(0, (endMs - startMs) / 86_400_000);
}

function cycleWindow(usage: UsageSnapshot, now = Date.now()): {
  daysElapsed: number;
  daysRemaining: number;
  cycleLengthDays: number;
} {
  const start = usage.billingCycleStartMs ?? now - 86_400_000;
  const end = usage.billingCycleEndMs ?? now + 86_400_000;
  const elapsed = Math.max(0.25, daysBetween(start, now)); // avoid div-by-zero early cycle
  const remaining = Math.max(0, daysBetween(now, end));
  const length = Math.max(1, daysBetween(start, end));
  return {
    daysElapsed: elapsed,
    daysRemaining: remaining,
    cycleLengthDays: length,
  };
}

function forecastPool(params: {
  id: QuotaForecast['id'];
  label: string;
  percentUsed: number;
  daysElapsed: number;
  daysRemaining: number;
}): QuotaForecast {
  const { id, label, percentUsed, daysElapsed, daysRemaining } = params;
  const dailyBurnPercent = percentUsed / Math.max(0.25, daysElapsed);
  const projectedPercentAtCycleEnd = dailyBurnPercent * (daysElapsed + daysRemaining);
  let daysUntilExhausted: number | null = null;
  if (percentUsed >= 100) {
    daysUntilExhausted = 0;
  } else if (dailyBurnPercent > 0.05) {
    daysUntilExhausted = Math.max(0, (100 - percentUsed) / dailyBurnPercent);
  }

  let level: QuotaForecast['level'] = 'info';
  let summary: string;

  if (percentUsed >= 100) {
    level = 'alert';
    summary = `${label} included pool is already exhausted.`;
  } else if (daysUntilExhausted !== null && daysUntilExhausted <= daysRemaining) {
    level = daysUntilExhausted <= 3 ? 'alert' : 'warn';
    const daysLabel =
      daysUntilExhausted < 1
        ? 'under a day'
        : `${Math.ceil(daysUntilExhausted)} day${Math.ceil(daysUntilExhausted) === 1 ? '' : 's'}`;
    summary = `At this rate, ${label} hits 100% in about ${daysLabel}.`;
  } else if (projectedPercentAtCycleEnd > 100) {
    level = 'warn';
    summary = `On pace for ~${formatPercent(projectedPercentAtCycleEnd)} of ${label} by cycle end.`;
  } else {
    summary = `On pace for ~${formatPercent(projectedPercentAtCycleEnd)} of ${label} by cycle end.`;
  }

  return {
    id,
    label,
    percentUsed,
    projectedPercentAtCycleEnd,
    daysUntilExhausted,
    dailyBurnPercent,
    daysElapsed,
    daysRemaining,
    summary,
    level,
  };
}

/**
 * Predictive burn-rate forecasts for Pro dual pools (and legacy single pool).
 * Uses included-pool percentages from Cursor, not attributed event dollars.
 */
export function buildBurnForecast(usage: UsageSnapshot, _dailySpend?: DaySpend[]): BurnForecast | undefined {
  const plan = usage.planUsage;
  if (!plan) return undefined;

  const { daysElapsed, daysRemaining, cycleLengthDays } = cycleWindow(usage);
  const quotas: QuotaForecast[] = [];

  if (plan.autoPercentUsed !== undefined) {
    quotas.push(
      forecastPool({
        id: 'cursorModels',
        label: 'Cursor Models',
        percentUsed: plan.autoPercentUsed,
        daysElapsed,
        daysRemaining,
      })
    );
  }

  const apiPct =
    plan.apiPercentUsed ??
    (plan.limit > 0 ? (plan.includedSpend / plan.limit) * 100 : undefined);
  if (apiPct !== undefined) {
    quotas.push(
      forecastPool({
        id: 'otherModels',
        label: 'Other Models',
        percentUsed: apiPct,
        daysElapsed,
        daysRemaining,
      })
    );
  }

  if (!quotas.length && plan.limit > 0) {
    quotas.push(
      forecastPool({
        id: 'included',
        label: 'Included allowance',
        percentUsed: (plan.includedSpend / plan.limit) * 100,
        daysElapsed,
        daysRemaining,
      })
    );
  }

  if (!quotas.length) return undefined;

  const binding =
    [...quotas].sort((a, b) => {
      const aDays = a.daysUntilExhausted ?? Number.POSITIVE_INFINITY;
      const bDays = b.daysUntilExhausted ?? Number.POSITIVE_INFINITY;
      return aDays - bDays;
    })[0] ?? quotas[0];

  let headline = 'Usage pace looks sustainable this cycle';
  let detail = binding.summary;

  if (binding.percentUsed >= 100) {
    headline = `${binding.label} included pool is exhausted`;
    detail =
      binding.id === 'otherModels'
        ? `You've used ${centsToDollars(plan.includedSpend)} of ${centsToDollars(plan.limit)} Other Models API. Cursor Models may still have headroom.`
        : binding.summary;
  } else if (binding.daysUntilExhausted !== null && binding.daysUntilExhausted <= daysRemaining) {
    const d = Math.ceil(binding.daysUntilExhausted);
    headline =
      d <= 0
        ? `${binding.label} will hit the limit today at this pace`
        : `${binding.label} quota runs out in ~${d}d at this pace`;
    detail = `Projected ${formatPercent(binding.projectedPercentAtCycleEnd)} by cycle end · ${Math.ceil(daysRemaining)}d left in cycle.`;
  } else if (binding.projectedPercentAtCycleEnd > 100) {
    headline = `On pace to use ${formatPercent(binding.projectedPercentAtCycleEnd)} of ${binding.label}`;
    detail = `Daily burn ~${binding.dailyBurnPercent.toFixed(1)}%/day · ${Math.ceil(daysRemaining)}d left.`;
  }

  return {
    daysElapsed,
    daysRemaining,
    cycleLengthDays,
    quotas,
    headline,
    detail,
  };
}
