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
  /** Binding pool days until 100% at current burn; null if not exhausting before cycle end */
  runwayDays: number | null;
  bindingLabel: string;
  /** Straight-line expected % used by now (elapsed/cycle × 100) */
  expectedPercentByNow: number;
  /** Actual binding pool % used */
  actualPercent: number;
  /** actual / expected — >1 means burning faster than linear pace */
  paceRatio: number;
  paceLevel: 'info' | 'warn' | 'alert';
  paceLabel: string;
  /** Soft weekly $ budget pace for Other Models (when budget configured) */
  weeklyBudget?: {
    budgetCents: number;
    spentCents: number;
    remainingCents: number;
    overBudget: boolean;
    label: string;
  };
}

function thisWeekSpendCents(dailySpend: DaySpend[] | undefined, now = Date.now()): number {
  if (!dailySpend?.length) return 0;
  const start = new Date(now);
  const day = start.getDay(); // 0 Sun
  const mondayOffset = day === 0 ? 6 : day - 1;
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - mondayOffset);
  const startKey = start.toISOString().slice(0, 10);
  return dailySpend
    .filter((d) => d.date >= startKey)
    .reduce((s, d) => s + d.chargedCents, 0);
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
  const elapsed = Math.max(0.25, daysBetween(start, now));
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
export function buildBurnForecast(
  usage: UsageSnapshot,
  dailySpend?: DaySpend[],
  weeklyBudgetCents = 0
): BurnForecast | undefined {
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

  const expectedPercentByNow = Math.min(100, (daysElapsed / cycleLengthDays) * 100);
  const actualPercent = binding.percentUsed;
  const paceRatio =
    expectedPercentByNow > 1 ? actualPercent / expectedPercentByNow : actualPercent > 0 ? 1.2 : 1;

  let paceLevel: BurnForecast['paceLevel'] = 'info';
  let paceLabel = 'On track vs straight-line burn';
  if (paceRatio >= 1.35 || (binding.daysUntilExhausted !== null && binding.daysUntilExhausted <= 3)) {
    paceLevel = 'alert';
    paceLabel = `${paceRatio.toFixed(1)}× faster than linear pace`;
  } else if (paceRatio >= 1.1) {
    paceLevel = 'warn';
    paceLabel = `${paceRatio.toFixed(1)}× ahead of linear pace`;
  } else if (paceRatio < 0.75 && actualPercent > 2) {
    paceLabel = 'Under linear pace — headroom left';
  }

  const runwayDays =
    binding.daysUntilExhausted !== null && binding.daysUntilExhausted <= daysRemaining
      ? binding.daysUntilExhausted
      : null;

  let weeklyBudget: BurnForecast['weeklyBudget'];
  if (weeklyBudgetCents > 0) {
    const spentCents = thisWeekSpendCents(dailySpend);
    const remainingCents = weeklyBudgetCents - spentCents;
    const overBudget = spentCents > weeklyBudgetCents;
    weeklyBudget = {
      budgetCents: weeklyBudgetCents,
      spentCents,
      remainingCents,
      overBudget,
      label: overBudget
        ? `Over weekly budget by ${centsToDollars(spentCents - weeklyBudgetCents)}`
        : `${centsToDollars(spentCents)} of ${centsToDollars(weeklyBudgetCents)} this week`,
    };
    if (overBudget && paceLevel === 'info') {
      paceLevel = 'warn';
    }
  }

  return {
    daysElapsed,
    daysRemaining,
    cycleLengthDays,
    quotas,
    headline,
    detail,
    runwayDays,
    bindingLabel: binding.label,
    expectedPercentByNow,
    actualPercent,
    paceRatio,
    paceLevel,
    paceLabel,
    weeklyBudget,
  };
}
