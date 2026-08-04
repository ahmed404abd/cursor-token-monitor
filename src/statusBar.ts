import { UsageSnapshot, displayModelName } from './cursorApi';
import { centsToDollars, formatPercent, usedPercent, usageHealth } from './usageIntelligence';
import { CockpitSettings, StatusBarFormat } from './webview/preferences';

export type HealthTone = 'safe' | 'warning' | 'critical';

function healthIcon(health: HealthTone): string {
  if (health === 'critical') return '$(flame)';
  if (health === 'warning') return '$(warning)';
  return '$(zap)';
}

function healthDot(health: HealthTone): string {
  if (health === 'critical') return '●';
  if (health === 'warning') return '●';
  return '●';
}

function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export function resolveNamedModel(
  usage: UsageSnapshot,
  pinnedModelIds: string[]
): { id: string; label: string } | undefined {
  const models = usage.modelUsage ?? [];
  for (const id of pinnedModelIds) {
    const found = models.find((m) => m.modelId === id);
    if (found) return { id: found.modelId, label: found.label };
  }
  const top = [...models].sort((a, b) => b.chargedCents - a.chargedCents)[0];
  if (!top) return undefined;
  return { id: top.modelId, label: top.label || displayModelName(top.modelId) };
}

export function formatStatusBar(
  usage: UsageSnapshot,
  settings: CockpitSettings,
  pinnedModelIds: string[] = []
): string {
  const plan = usage.planUsage;
  const pct = usedPercent(usage);
  const health = usageHealth(usage, settings.warningThreshold, settings.criticalThreshold);
  const icon = healthIcon(health);
  const named = resolveNamedModel(usage, pinnedModelIds);

  if (!plan || plan.limit <= 0) {
    return `${icon} Cursor usage`;
  }

  const used = centsToDollars(plan.includedSpend);
  const limit = centsToDollars(plan.limit);
  const pctText = formatPercent(pct);
  const format: StatusBarFormat = settings.statusBarFormat;

  switch (format) {
    case 'icon':
      return icon;
    case 'dot':
      return `${healthDot(health)} ${icon}`;
    case 'percent':
      return `${icon} ${pctText}`;
    case 'dotPercent':
      return `${healthDot(health)} ${pctText}`;
    case 'namePercent':
      return `${icon} ${named?.label ?? 'Usage'} ${pctText}`;
    case 'full':
    default: {
      const auto = plan.autoPercentUsed;
      const api = plan.apiPercentUsed;
      if (auto !== undefined && api !== undefined) {
        const binding = api >= auto ? 'Other' : 'Cursor';
        if (health === 'critical') {
          return `${icon} ${binding} limit • Cursor ${formatPercent(auto)} · Other ${formatPercent(api)}`;
        }
        return `${icon} Cursor ${formatPercent(auto)} · Other ${formatPercent(api)} · ${used}/${limit}`;
      }
      if (health === 'critical') return `${icon} Limit risk • ${used}/${limit}`;
      if (health === 'warning') return `${icon} ${pctText} used • ${used}/${limit}`;
      return `${icon} Safe • ${used}/${limit}`;
    }
  }
}

/** Rotate variants when statusBarMode is "rotate". */
export function statusBarVariants(
  usage: UsageSnapshot,
  settings: CockpitSettings,
  pinnedModelIds: string[] = []
): string[] {
  const primary = formatStatusBar(usage, settings, pinnedModelIds);
  const variants = [primary];
  const named = resolveNamedModel(usage, pinnedModelIds);
  if (named) {
    const model = (usage.modelUsage ?? []).find((m) => m.modelId === named.id);
    if (model) {
      variants.push(`$(zap) ${named.label} ${centsToDollars(model.chargedCents)}`);
    }
  }
  const tokens = (usage.totalInputTokens ?? 0) + (usage.totalOutputTokens ?? 0);
  if (tokens > 0) {
    variants.push(`$(zap) ${compactTokens(tokens)} tokens`);
  }
  return variants;
}
