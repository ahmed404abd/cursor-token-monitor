import { CursorAuthData } from '../dbReader';
import { UsageSnapshot, displayModelName } from '../cursorApi';
import { ProjectUsageRecord } from '../projectTracker';
import {
  DaySpend,
  SessionStat,
  SpendSummary,
  formatDuration,
  topSpendingDays,
} from '../historyStore';
import { SessionStats } from '../sessionTracker';
import {
  buildUsageInsights,
  centsToDollars,
  estimateAutoModels,
  formatPercent,
  usedPercent,
  usageHealth,
} from '../usageIntelligence';
import {
  CockpitPreferences,
  CockpitSettings,
} from './preferences';
import { applyOrder } from './orderUtils';

export type CardHealth = 'healthy' | 'warning' | 'critical';

export interface CardPill {
  label: string;
  detail?: string;
}

export interface CockpitCard {
  id: string;
  kind: 'model' | 'workspace';
  title: string;
  subtitle: string;
  percent: number;
  health: CardHealth;
  spendLabel: string;
  events: number;
  tokensIn: number;
  tokensOut: number;
  requestUnits: number;
  sharePercent: number;
  isAuto?: boolean;
  isPinned?: boolean;
  isEstimate?: boolean;
  resetInLabel: string;
  resetTimeLabel: string;
  pills: CardPill[];
}

export interface ChartPoint {
  date: string;
  label: string;
  spendCents: number;
  tokens: number;
  events: number;
}

export interface ActivityItem {
  timeLabel: string;
  model: string;
  tokensLabel: string;
  costLabel: string;
  kind: string;
}

export interface CockpitViewModel {
  accountEmail: string;
  planName: string;
  planPrice: string;
  billingCycleLabel: string;
  displayMessage: string;
  usedLabel: string;
  limitLabel: string;
  remainingLabel: string;
  percentUsed: number;
  planHealth: CardHealth;
  resetInLabel: string;
  resetTimeLabel: string;
  updatedLabel: string;
  spendSummary: SpendSummary;
  session?: {
    startedLabel: string;
    events: number;
    tokensLabel: string;
    spendLabel: string;
  };
  insights: { level: string; title: string; detail: string }[];
  autoEstimate: {
    autoEventCount: number;
    confidence: string;
    likelyModels: string[];
    note: string;
  };
  cards: CockpitCard[];
  charts: {
    spend: ChartPoint[];
    tokens: ChartPoint[];
  };
  activity: ActivityItem[];
  topDays: { label: string; spendLabel: string; events: number }[];
  longestSessions: { id: string; duration: string; events: number; spendLabel: string }[];
  totals: {
    events: number;
    chats: number;
    tokensIn: string;
    tokensOut: string;
  };
  prefs: CockpitPreferences;
  settings: CockpitSettings;
  issuesUrl: string;
}

function formatTokens(n?: number): string {
  if (n === undefined) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function formatDateMs(ms?: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatCycleRange(start?: number, end?: number): string {
  if (!start || !end) return '—';
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  return `${new Date(start).toLocaleDateString(undefined, opts)} – ${new Date(end).toLocaleDateString(undefined, opts)}`;
}

export function resetCountdown(endMs?: number): { resetInLabel: string; resetTimeLabel: string } {
  if (!endMs) {
    return { resetInLabel: '—', resetTimeLabel: '—' };
  }
  const ms = Math.max(0, endMs - Date.now());
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const resetInLabel = days > 0 ? `${days}d ${hours}h` : `${hours}h`;
  const resetTimeLabel = new Date(endMs).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return { resetInLabel, resetTimeLabel };
}

function toCardHealth(
  pct: number,
  warning: number,
  critical: number
): CardHealth {
  if (pct >= critical) return 'critical';
  if (pct >= warning) return 'warning';
  return 'healthy';
}

function kindLabel(kind?: string): string {
  if (!kind) return 'other';
  const cleaned = kind.replace(/^USAGE_EVENT_KIND_/, '').replace(/_/g, ' ').toLowerCase();
  if (cleaned.includes('included')) return 'included';
  if (cleaned.includes('usage based')) return 'on-demand';
  if (cleaned.includes('errored')) return 'error';
  return cleaned;
}

function modelPills(usage: UsageSnapshot, modelId: string): CardPill[] {
  const relatedChats = usage.chats
    .filter((c) => c.models.includes(modelId))
    .slice(0, 4)
    .map((c) => ({
      label: `Chat ${shortId(c.conversationId)}`,
      detail: centsToDollars(c.chargedCents),
    }));

  if (relatedChats.length) return relatedChats;

  const kinds = new Map<string, number>();
  for (const e of usage.recentEvents) {
    if (e.model !== modelId) continue;
    const k = kindLabel(e.kind);
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  return [...kinds.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label, count]) => ({ label, detail: `${count}` }));
}

function buildModelCards(
  usage: UsageSnapshot,
  prefs: CockpitPreferences,
  settings: CockpitSettings,
  reset: { resetInLabel: string; resetTimeLabel: string }
): CockpitCard[] {
  const models = usage.modelUsage ?? [];
  const totalSpend = models.reduce((s, m) => s + m.chargedCents, 0) || 1;
  const planPct = usedPercent(usage) ?? 0;
  const planHealth = toCardHealth(planPct, settings.warningThreshold, settings.criticalThreshold);

  const cards = models.map((m) => {
    const share = (m.chargedCents / totalSpend) * 100;
    const title = prefs.modelAliases[m.modelId] || m.label || displayModelName(m.modelId);
    return {
      id: m.modelId,
      kind: 'model' as const,
      title,
      subtitle: m.modelId,
      percent: Math.min(100, share),
      health: planHealth,
      spendLabel: centsToDollars(m.chargedCents),
      events: m.eventCount,
      tokensIn: m.inputTokens,
      tokensOut: m.outputTokens,
      requestUnits: m.requestUnits,
      sharePercent: share,
      isAuto: m.isAuto,
      isPinned: prefs.pinnedModelIds.includes(m.modelId),
      resetInLabel: reset.resetInLabel,
      resetTimeLabel: reset.resetTimeLabel,
      pills: modelPills(usage, m.modelId),
    };
  });

  const orderedIds = applyOrder(
    cards.map((c) => c.id),
    prefs.cardOrderModel
  );
  const byId = new Map(cards.map((c) => [c.id, c]));
  return orderedIds.map((id) => byId.get(id)!).filter(Boolean);
}

function buildWorkspaceCards(
  projects: ProjectUsageRecord[],
  prefs: CockpitPreferences,
  settings: CockpitSettings,
  reset: { resetInLabel: string; resetTimeLabel: string }
): CockpitCard[] {
  const total = projects.reduce((s, p) => s + p.chargedCents, 0) || 1;
  const cards = projects.map((p) => {
    const share = (p.chargedCents / total) * 100;
    const pct = p.percentUsed ?? share;
    return {
      id: p.workspaceKey,
      kind: 'workspace' as const,
      title: p.workspaceName,
      subtitle: p.workspacePath || 'No path',
      percent: Math.min(100, share),
      health: toCardHealth(pct, settings.warningThreshold, settings.criticalThreshold),
      spendLabel: centsToDollars(p.chargedCents),
      events: p.eventCount,
      tokensIn: p.inputTokens,
      tokensOut: p.outputTokens,
      requestUnits: p.requestUnits,
      sharePercent: share,
      isEstimate: true,
      resetInLabel: reset.resetInLabel,
      resetTimeLabel: reset.resetTimeLabel,
      pills: [
        { label: 'Events', detail: String(p.eventCount) },
        { label: 'Last seen', detail: new Date(p.lastSeenAt).toLocaleDateString() },
      ],
    };
  });

  const orderedIds = applyOrder(
    cards.map((c) => c.id),
    prefs.cardOrderWorkspace
  );
  const byId = new Map(cards.map((c) => [c.id, c]));
  return orderedIds.map((id) => byId.get(id)!).filter(Boolean);
}

export interface BuildViewModelInput {
  auth?: CursorAuthData;
  usage: UsageSnapshot;
  projects: ProjectUsageRecord[];
  dailySpend: DaySpend[];
  sessions: SessionStat[];
  spendSummary: SpendSummary;
  session?: SessionStats;
  updated?: Date;
  prefs: CockpitPreferences;
  settings: CockpitSettings;
  issuesUrl: string;
}

export function buildCockpitViewModel(input: BuildViewModelInput): CockpitViewModel {
  const { usage, auth, projects, dailySpend, sessions, spendSummary, session, updated, prefs, settings, issuesUrl } =
    input;
  const plan = usage.planUsage;
  const pct = usedPercent(usage) ?? 0;
  const healthMap = usageHealth(usage, settings.warningThreshold, settings.criticalThreshold);
  const planHealth: CardHealth =
    healthMap === 'critical' ? 'critical' : healthMap === 'warning' ? 'warning' : 'healthy';
  const reset = resetCountdown(usage.billingCycleEndMs);
  const insights = buildUsageInsights(usage, settings.warningThreshold, settings.criticalThreshold);
  const autoEstimate = estimateAutoModels(usage);

  const cards =
    prefs.groupMode === 'workspace'
      ? buildWorkspaceCards(projects, prefs, settings, reset)
      : buildModelCards(usage, prefs, settings, reset);

  return {
    accountEmail: auth?.email ?? 'Signed-in account',
    planName: usage.planName ?? auth?.membershipType ?? 'Cursor',
    planPrice: usage.planPrice ?? '',
    billingCycleLabel: formatCycleRange(usage.billingCycleStartMs, usage.billingCycleEndMs),
    displayMessage: usage.displayMessage || 'Usage is billed against your included monthly allowance.',
    usedLabel: plan ? centsToDollars(plan.includedSpend) : '—',
    limitLabel: plan ? centsToDollars(plan.limit) : '—',
    remainingLabel: plan ? centsToDollars(plan.remaining) : '—',
    percentUsed: pct,
    planHealth,
    resetInLabel: reset.resetInLabel,
    resetTimeLabel: reset.resetTimeLabel,
    updatedLabel: updated ? updated.toLocaleTimeString() : '—',
    spendSummary,
    session: session
      ? {
          startedLabel: session.startedAt.toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
          }),
          events: session.events,
          tokensLabel: formatTokens(session.inputTokens + session.outputTokens),
          spendLabel: centsToDollars(session.spendCents),
        }
      : undefined,
    insights: insights.map((i) => ({ level: i.level, title: i.title, detail: i.detail })),
    autoEstimate: {
      autoEventCount: autoEstimate.autoEventCount,
      confidence: autoEstimate.confidence,
      likelyModels: autoEstimate.likelyModels,
      note: autoEstimate.note,
    },
    cards,
    charts: {
      spend: dailySpend.map((d) => ({
        date: d.date,
        label: d.label,
        spendCents: d.chargedCents,
        tokens: d.inputTokens + d.outputTokens,
        events: d.eventCount,
      })),
      tokens: dailySpend.map((d) => ({
        date: d.date,
        label: d.label,
        spendCents: d.chargedCents,
        tokens: d.inputTokens + d.outputTokens,
        events: d.eventCount,
      })),
    },
    activity: usage.recentEvents.slice(0, 15).map((e) => {
      const tokens = (e.tokenUsage?.inputTokens ?? 0) + (e.tokenUsage?.outputTokens ?? 0);
      return {
        timeLabel: formatDateMs(Number(e.timestamp)),
        model: displayModelName(e.model),
        tokensLabel: tokens ? `+${formatTokens(tokens)}` : '',
        costLabel: centsToDollars(e.chargedCents ?? 0),
        kind: kindLabel(e.kind),
      };
    }),
    topDays: topSpendingDays(dailySpend, 5).map((d) => ({
      label: d.label,
      spendLabel: centsToDollars(d.chargedCents),
      events: d.eventCount,
    })),
    longestSessions: sessions.map((s) => ({
      id: s.shortId,
      duration: formatDuration(s.durationMs),
      events: s.eventCount,
      spendLabel: centsToDollars(s.chargedCents),
    })),
    totals: {
      events: usage.totalEventsThisPeriod ?? 0,
      chats: usage.chats.length,
      tokensIn: formatTokens(usage.totalInputTokens),
      tokensOut: formatTokens(usage.totalOutputTokens),
    },
    prefs,
    settings,
    issuesUrl,
  };
}

export function formatTokensPublic(n?: number): string {
  return formatTokens(n);
}

export { formatPercent };
