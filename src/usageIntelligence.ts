import { UsageSnapshot, displayModelName } from './cursorApi';

export type UsageHealth = 'safe' | 'warning' | 'critical';

export interface AutoModelEstimate {
  likelyModels: string[];
  confidence: 'low' | 'medium';
  autoEventCount: number;
  note: string;
}

export interface UsageInsight {
  level: 'info' | 'warn' | 'alert';
  title: string;
  detail: string;
}

export function usedPercent(usage: UsageSnapshot): number | undefined {
  const plan = usage.planUsage;
  if (plan && plan.limit > 0) {
    return (plan.includedSpend / plan.limit) * 100;
  }
  return undefined;
}

export function usageHealth(
  usage: UsageSnapshot,
  warningThreshold = 75,
  criticalThreshold = 90
): UsageHealth {
  const pct = usedPercent(usage);
  if (pct === undefined) return 'safe';
  if (pct >= criticalThreshold) return 'critical';
  if (pct >= warningThreshold) return 'warning';
  return 'safe';
}

export function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatPercent(value?: number): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(value < 10 ? 1 : 0)}%`;
}

/** @deprecated Prefer formatStatusBar from statusBar.ts */
export function formatStatusBarText(usage: UsageSnapshot): string {
  const plan = usage.planUsage;
  if (plan && plan.limit > 0) {
    const used = centsToDollars(plan.includedSpend);
    const limit = centsToDollars(plan.limit);
    const pct = usedPercent(usage) ?? 0;
    const health = usageHealth(usage);

    if (health === 'critical') {
      return `$(flame) Limit risk • ${used}/${limit}`;
    }
    if (health === 'warning') {
      return `$(warning) ${formatPercent(pct)} used • ${used}/${limit}`;
    }
    return `$(zap) Safe • ${used}/${limit}`;
  }

  const legacy = usage.raw.legacy as Record<string, unknown> | undefined;
  if (legacy && typeof legacy === 'object') {
    const bucket = (legacy.premiumRequests ?? legacy['gpt-4']) as Record<string, unknown> | undefined;
    if (bucket && typeof bucket === 'object') {
      const used = bucket.numRequests ?? bucket.used;
      const max = bucket.maxRequestUsage ?? bucket.limit;
      if (used !== undefined) {
        return `$(zap) ${used}${max !== undefined ? '/' + max : ''} req`;
      }
    }
  }

  return '$(zap) Cursor usage';
}

export function estimateAutoModels(usage: UsageSnapshot): AutoModelEstimate {
  const autoModel = usage.modelUsage.find((m) => m.isAuto);
  const autoEventCount = autoModel?.eventCount ?? 0;
  const named = usage.modelUsage.filter((m) => !m.isAuto && m.eventCount > 0);
  const pool = usage.autoBucketModels.map((id) => displayModelName(id));

  const likely = new Set<string>();

  // Named models used this period are strong signals for what Auto may pick
  for (const m of named.slice(0, 4)) {
    likely.add(m.label);
  }

  // Popular Auto pool models (heuristic defaults)
  for (const label of ['Composer 2.5', 'Composer 2', 'Claude Sonnet 4', 'GPT 5']) {
    if (pool.some((p) => p.toLowerCase().includes(label.toLowerCase().replace(/\s/g, '')))) {
      likely.add(label);
    }
  }

  // Fill from pool if we have nothing else
  if (likely.size === 0) {
    for (const p of pool.slice(0, 3)) likely.add(p);
  }

  const confidence: 'low' | 'medium' = named.length >= 2 ? 'medium' : 'low';

  return {
    likelyModels: [...likely].slice(0, 5),
    confidence,
    autoEventCount,
    note:
      'Estimate only — Cursor reports Auto as "default" and does not expose the exact model per request.',
  };
}

export function buildUsageInsights(
  usage: UsageSnapshot,
  warningThreshold = 75,
  criticalThreshold = 90
): UsageInsight[] {
  const insights: UsageInsight[] = [];
  const pct = usedPercent(usage);
  const plan = usage.planUsage;

  if (pct !== undefined && plan) {
    if (pct >= criticalThreshold) {
      insights.push({
        level: 'alert',
        title: 'Near included limit',
        detail: `You've used ${formatPercent(pct)} of your ${centsToDollars(plan.limit)} allowance.`,
      });
    } else if (pct >= warningThreshold) {
      insights.push({
        level: 'warn',
        title: 'Usage trending high',
        detail: `${formatPercent(pct)} used — ${centsToDollars(plan.remaining)} remaining this cycle.`,
      });
    } else {
      insights.push({
        level: 'info',
        title: 'On track',
        detail: `${formatPercent(pct)} used — ${centsToDollars(plan.remaining)} remaining.`,
      });
    }

    const daysLeft = daysUntil(usage.billingCycleEndMs);
    if (daysLeft !== undefined && daysLeft > 0 && pct > 0) {
      const dailyBurn = plan.includedSpend / Math.max(1, cycleDaysElapsed(usage));
      const projected = dailyBurn * (cycleDaysElapsed(usage) + daysLeft);
      if (projected > plan.limit * 1.05) {
        insights.push({
          level: 'warn',
          title: 'Projected overage risk',
          detail: `At current pace you may exceed your allowance before cycle end (~${daysLeft}d left).`,
        });
      }
    }
  }

  const auto = usage.modelUsage.find((m) => m.isAuto);
  if (auto && auto.eventCount > 0) {
    const namedSpend = usage.modelUsage
      .filter((m) => !m.isAuto)
      .reduce((s, m) => s + m.chargedCents, 0);
    if (namedSpend === 0 && auto.chargedCents > 0) {
      insights.push({
        level: 'info',
        title: 'Mostly Auto mode',
        detail: `${auto.eventCount} Auto events this period. See Auto estimate below for likely models.`,
      });
    }
  }

  if ((usage.totalEventsThisPeriod ?? 0) > 50) {
    insights.push({
      level: 'info',
      title: 'High activity',
      detail: `${usage.totalEventsThisPeriod} API events this billing period.`,
    });
  }

  return insights;
}

function daysUntil(endMs?: number): number | undefined {
  if (!endMs) return undefined;
  return Math.max(0, Math.ceil((endMs - Date.now()) / (24 * 60 * 60 * 1000)));
}

function cycleDaysElapsed(usage: UsageSnapshot): number {
  const start = usage.billingCycleStartMs;
  if (!start) return 1;
  return Math.max(1, Math.ceil((Date.now() - start) / (24 * 60 * 60 * 1000)));
}
