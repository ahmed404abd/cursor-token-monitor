import { UsageEvent, UsageSnapshot, displayModelName } from './cursorApi';
import { DailyModelUsage, dayKey } from './historyStore';
import { ProjectUsageRecord } from './projectTracker';

export type FlowWindow = 'today' | '7d' | '30d' | 'cycle';
export type FlowMetric = 'spend' | 'tokens' | 'requests';

export interface FlowNode {
  id: string;
  label: string;
  value: number;
  percent: number;
  color?: string;
}

export interface FlowSessionNode extends FlowNode {
  models: string[];
}

export interface FlowModelBranch extends FlowNode {
  sessions: FlowSessionNode[];
}

export interface UsageFlowView {
  window: FlowWindow;
  metric: FlowMetric;
  total: number;
  totalLabel: string;
  models: FlowModelBranch[];
  workspaces: FlowNode[];
  workspaceNote: string;
  series: {
    id: string;
    label: string;
    color: string;
    points: { date: string; label: string; value: number }[];
  }[];
  trend: {
    points: {
      date: string;
      label: string;
      actual: number;
      expected: number;
      isAnomaly: boolean;
      deltaPercent: number;
    }[];
    anomaly?: {
      date: string;
      label: string;
      summary: string;
      confidence: number;
    };
  };
}

const MODEL_COLORS = [
  '#3ecfbf',
  '#5b9dff',
  '#b86adf',
  '#f0b429',
  '#ff6b6b',
  '#3dd68c',
  '#79d8ff',
  '#c792ea',
];

function startOfLocalDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function windowStartMs(
  window: FlowWindow,
  billingCycleStartMs?: number,
  now = Date.now()
): number {
  if (window === 'cycle' && billingCycleStartMs && billingCycleStartMs > 0) {
    return billingCycleStartMs;
  }
  const start = startOfLocalDay(new Date(now));
  if (window === 'today') return start.getTime();
  if (window === '7d') {
    start.setDate(start.getDate() - 6);
    return start.getTime();
  }
  // 30d
  start.setDate(start.getDate() - 29);
  return start.getTime();
}

function eventValue(event: UsageEvent, metric: FlowMetric): number {
  if (metric === 'requests') return 1;
  if (metric === 'tokens') {
    return (event.tokenUsage?.inputTokens ?? 0) + (event.tokenUsage?.outputTokens ?? 0);
  }
  return event.chargedCents ?? 0;
}

function formatMetric(value: number, metric: FlowMetric): string {
  if (metric === 'spend') return `$${(value / 100).toFixed(2)}`;
  if (metric === 'requests') return value.toLocaleString();
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return value.toLocaleString();
}

function shortChatId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function filterEvents(
  events: UsageEvent[],
  window: FlowWindow,
  billingCycleStartMs?: number
): UsageEvent[] {
  const start = windowStartMs(window, billingCycleStartMs);
  return events.filter((event) => {
    const ts = Number(event.timestamp);
    return Number.isFinite(ts) && ts >= start;
  });
}

function trailingAverage(values: number[], index: number, window = 7): number {
  const from = Math.max(0, index - window);
  const slice = values.slice(from, index);
  if (!slice.length) return values[index] || 0;
  return slice.reduce((sum, v) => sum + v, 0) / slice.length;
}

export function buildUsageFlow(input: {
  usage: UsageSnapshot;
  projects?: ProjectUsageRecord[];
  modelHistory?: DailyModelUsage[];
  window?: FlowWindow;
  metric?: FlowMetric;
}): UsageFlowView {
  const window = input.window ?? 'cycle';
  const metric = input.metric ?? 'spend';
  const events = filterEvents(
    input.usage.recentEvents ?? [],
    window,
    input.usage.billingCycleStartMs
  );

  const modelMap = new Map<
    string,
    { label: string; value: number; sessions: Map<string, { value: number; models: Set<string> }> }
  >();

  for (const event of events) {
    const modelId = event.model || 'unknown';
    const value = eventValue(event, metric);
    const row =
      modelMap.get(modelId) ??
      {
        label: displayModelName(modelId),
        value: 0,
        sessions: new Map(),
      };
    row.value += value;
    const chatId = event.conversationId || `event-${event.timestamp}`;
    const session =
      row.sessions.get(chatId) ?? { value: 0, models: new Set<string>([modelId]) };
    session.value += value;
    session.models.add(modelId);
    row.sessions.set(chatId, session);
    modelMap.set(modelId, row);
  }

  const total = [...modelMap.values()].reduce((sum, row) => sum + row.value, 0) || 0;
  const models: FlowModelBranch[] = [...modelMap.entries()]
    .map(([id, row], index) => {
      const sessions: FlowSessionNode[] = [...row.sessions.entries()]
        .map(([sessionId, session]) => ({
          id: sessionId,
          label: `Chat ${shortChatId(sessionId)}`,
          value: session.value,
          percent: row.value > 0 ? (session.value / row.value) * 100 : 0,
          models: [...session.models].map(displayModelName),
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 20);
      return {
        id,
        label: row.label,
        value: row.value,
        percent: total > 0 ? (row.value / total) * 100 : 0,
        color: MODEL_COLORS[index % MODEL_COLORS.length],
        sessions,
      };
    })
    .sort((a, b) => b.value - a.value);

  const projectRows = input.projects ?? [];
  const workspaceTotal = projectRows.reduce((sum, p) => {
    if (metric === 'spend') return sum + (p.chargedCents ?? 0);
    if (metric === 'tokens') return sum + (p.inputTokens ?? 0) + (p.outputTokens ?? 0);
    return sum + (p.eventCount ?? 0);
  }, 0);
  const workspaces: FlowNode[] = projectRows
    .map((p, index) => {
      const value =
        metric === 'spend'
          ? p.chargedCents ?? 0
          : metric === 'tokens'
            ? (p.inputTokens ?? 0) + (p.outputTokens ?? 0)
            : p.eventCount ?? 0;
      return {
        id: p.workspaceKey || p.workspacePath || `ws-${index}`,
        label: p.workspaceName || 'Workspace',
        value,
        percent: workspaceTotal > 0 ? (value / workspaceTotal) * 100 : 0,
        color: MODEL_COLORS[(index + 2) % MODEL_COLORS.length],
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 16);

  const historyStart = dayKey(new Date(windowStartMs(window, input.usage.billingCycleStartMs)));
  const history = (input.modelHistory ?? []).filter((row) => row.date >= historyStart);
  const topModelIds = models.slice(0, 5).map((m) => m.id);
  const dates = [...new Set(history.map((row) => row.date))].sort();
  const series = topModelIds.map((id, index) => {
    const label = models.find((m) => m.id === id)?.label ?? displayModelName(id);
    const color = MODEL_COLORS[index % MODEL_COLORS.length];
    const byDate = new Map(
      history.filter((row) => row.modelId === id).map((row) => [row.date, row])
    );
    return {
      id,
      label,
      color,
      points: dates.map((date) => {
        const row = byDate.get(date);
        const value =
          metric === 'spend'
            ? row?.chargedCents ?? 0
            : metric === 'tokens'
              ? (row?.inputTokens ?? 0) + (row?.outputTokens ?? 0)
              : row?.eventCount ?? 0;
        const d = new Date(`${date}T12:00:00`);
        return {
          date,
          label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          value,
        };
      }),
    };
  });

  const dailyTotals = dates.map((date) => {
    const rows = history.filter((row) => row.date === date);
    const actual =
      metric === 'spend'
        ? rows.reduce((sum, row) => sum + row.chargedCents, 0)
        : metric === 'tokens'
          ? rows.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0)
          : rows.reduce((sum, row) => sum + row.eventCount, 0);
    const d = new Date(`${date}T12:00:00`);
    return {
      date,
      label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      actual,
    };
  });

  // Fallback to event-derived daily totals when model history is thin
  const trendSource =
    dailyTotals.length >= 2
      ? dailyTotals
      : (() => {
          const map = new Map<string, number>();
          for (const event of events) {
            const ts = Number(event.timestamp);
            if (!Number.isFinite(ts)) continue;
            const date = dayKey(new Date(ts));
            map.set(date, (map.get(date) ?? 0) + eventValue(event, metric));
          }
          return [...map.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, actual]) => {
              const d = new Date(`${date}T12:00:00`);
              return {
                date,
                label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                actual,
              };
            });
        })();

  const actuals = trendSource.map((p) => p.actual);
  const trendPoints = trendSource.map((point, index) => {
    const expected = trailingAverage(actuals, index, 7);
    const deltaPercent =
      expected > 0 ? ((point.actual - expected) / expected) * 100 : point.actual > 0 ? 100 : 0;
    return {
      ...point,
      expected,
      isAnomaly: expected > 0 && point.actual >= expected * 1.45 && point.actual > 0,
      deltaPercent,
    };
  });

  const anomalyPoint = [...trendPoints].reverse().find((p) => p.isAnomaly);

  return {
    window,
    metric,
    total,
    totalLabel: formatMetric(total, metric),
    models,
    workspaces,
    workspaceNote:
      'Workspace shares are estimated account snapshots for folders you opened — Cursor does not expose per-project billing IDs.',
    series,
    trend: {
      points: trendPoints,
      anomaly: anomalyPoint
        ? {
            date: anomalyPoint.date,
            label: anomalyPoint.label,
            summary: `${formatMetric(anomalyPoint.actual, metric)} was ${Math.abs(anomalyPoint.deltaPercent).toFixed(0)}% ${anomalyPoint.deltaPercent >= 0 ? 'higher' : 'lower'} than the recent average.`,
            confidence: Math.min(
              97,
              Math.round(55 + Math.min(40, Math.abs(anomalyPoint.deltaPercent) / 2))
            ),
          }
        : undefined,
    },
  };
}

export function formatFlowMetric(value: number, metric: FlowMetric): string {
  return formatMetric(value, metric);
}
