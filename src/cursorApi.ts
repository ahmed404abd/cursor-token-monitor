import * as https from 'https';
import { CursorAuthData } from './dbReader';

export interface PlanUsage {
  totalSpend: number;
  includedSpend: number;
  bonusSpend?: number;
  remaining: number;
  limit: number;
  /** Cursor Models pool (Composer / Grok / Auto bucket), percent 0–100+ */
  autoPercentUsed?: number;
  /** Other Models / included API dollar pool, percent 0–100+ */
  apiPercentUsed?: number;
  /** Blended overall percent Cursor reports for "total usage" */
  totalPercentUsed?: number;
  bonusTooltip?: string;
  remainingBonus?: boolean;
}

export interface QuotaBucket {
  id: 'cursorModels' | 'otherModels';
  label: string;
  detail: string;
  percentUsed: number;
  /** Dollar figures only apply to the Other Models / API pool */
  usedCents?: number;
  limitCents?: number;
  remainingCents?: number;
}

export interface UsageEvent {
  timestamp: string;
  model: string;
  kind?: string;
  requestsCosts?: number;
  usageBasedCosts?: string;
  isTokenBasedCall?: boolean;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalCents?: number;
  };
  chargedCents?: number;
  conversationId?: string;
  isChargeable?: boolean;
}

export interface ModelAggregation {
  modelIntent: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalCents: number;
}

export interface ModelUsageSummary {
  /** Raw API id, e.g. "default" or "cursor-grok-4.5-high-fast" */
  modelId: string;
  /** Friendly label, e.g. "Auto" */
  label: string;
  isAuto: boolean;
  eventCount: number;
  chargedCents: number;
  requestUnits: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface ChatSummary {
  conversationId: string;
  eventCount: number;
  chargedCents: number;
  requestUnits: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  models: string[];
  lastTimestampMs: number;
}

export interface UsageSnapshot {
  source: 'modern' | 'legacy';
  planName?: string;
  planPrice?: string;
  includedAmountCents?: number;
  billingCycleStartMs?: number;
  billingCycleEndMs?: number;
  displayMessage?: string;
  /** Cursor Models pool message (when Auto/Composer/Grok selected) */
  autoModelSelectedDisplayMessage?: string;
  /** Other Models / named API models message */
  namedModelSelectedDisplayMessage?: string;
  planUsage?: PlanUsage;
  /** Dual Pro quotas matching Cursor's dashboard */
  quotaBuckets: QuotaBucket[];
  totalEventsThisPeriod?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCacheReadTokens?: number;
  totalCostCentsFromEvents?: number;
  /** Models Auto is allowed to route to (from Cursor), excluding "default" itself */
  autoBucketModels: string[];
  byModel: ModelAggregation[];
  /** Per-model rollup from usage events (preferred for UI) */
  modelUsage: ModelUsageSummary[];
  recentEvents: UsageEvent[];
  chats: ChatSummary[];
  raw: {
    period?: unknown;
    plan?: unknown;
    aggregated?: unknown;
    events?: unknown;
    legacy?: unknown;
  };
}

/** Map Cursor's internal ids to readable labels. "default" is Auto mode. */
export function displayModelName(modelId: string): string {
  const id = (modelId || 'unknown').trim();
  if (!id || id === 'default' || id.toLowerCase() === 'auto') return 'Auto';

  const cleaned = id
    .replace(/^cursor-/, '')
    .replace(/-thinking$/i, '')
    .replace(/\[.*?\]/g, '');

  return cleaned
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => {
      if (/^\d+(\.\d+)?$/.test(part)) return part;
      if (['gpt', 'o1', 'o3', 'o4'].includes(part.toLowerCase())) return part.toUpperCase();
      if (part.toLowerCase() === 'grok') return 'Grok';
      if (part.toLowerCase() === 'claude') return 'Claude';
      if (part.toLowerCase() === 'composer') return 'Composer';
      if (part.toLowerCase() === 'gemini') return 'Gemini';
      if (part.toLowerCase() === 'vega') return 'Vega';
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

export function isAutoModel(modelId: string): boolean {
  const id = (modelId || '').trim().toLowerCase();
  return id === '' || id === 'default' || id === 'auto';
}

function httpsJson(
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string>,
  body?: string
): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          ...headers,
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(data ? JSON.parse(data) : {});
            } catch {
              reject(new Error(`Failed to parse response: ${data.slice(0, 200)}`));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Request timed out')));
    if (body) req.write(body);
    req.end();
  });
}

function connectPost(path: string, token: string, body: object = {}): Promise<any> {
  return httpsJson(
    'POST',
    `https://api2.cursor.sh${path}`,
    {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Connect-Protocol-Version': '1',
      'User-Agent': 'cursor-token-monitor-vscode-extension',
    },
    JSON.stringify(body)
  );
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function mapEvent(raw: any): UsageEvent {
  return {
    timestamp: String(raw?.timestamp ?? ''),
    model: String(raw?.model ?? 'unknown'),
    kind: raw?.kind,
    requestsCosts: raw?.requestsCosts,
    usageBasedCosts: raw?.usageBasedCosts,
    isTokenBasedCall: raw?.isTokenBasedCall,
    tokenUsage: raw?.tokenUsage
      ? {
          inputTokens: toNumber(raw.tokenUsage.inputTokens),
          outputTokens: toNumber(raw.tokenUsage.outputTokens),
          cacheReadTokens: toNumber(raw.tokenUsage.cacheReadTokens),
          cacheWriteTokens: toNumber(raw.tokenUsage.cacheWriteTokens),
          totalCents: toNumber(raw.tokenUsage.totalCents),
        }
      : undefined,
    chargedCents: toNumber(raw?.chargedCents),
    conversationId: raw?.conversationId ? String(raw.conversationId) : undefined,
    isChargeable: raw?.isChargeable,
  };
}

function groupChats(events: UsageEvent[]): ChatSummary[] {
  const map = new Map<string, ChatSummary>();
  for (const event of events) {
    const id = event.conversationId || `event-${event.timestamp || Math.random()}`;
    const existing = map.get(id) ?? {
      conversationId: id,
      eventCount: 0,
      chargedCents: 0,
      requestUnits: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      models: [],
      lastTimestampMs: 0,
    };
    existing.eventCount += 1;
    existing.chargedCents += toNumber(event.chargedCents);
    existing.requestUnits += toNumber(event.requestsCosts);
    existing.inputTokens += toNumber(event.tokenUsage?.inputTokens);
    existing.outputTokens += toNumber(event.tokenUsage?.outputTokens);
    existing.cacheReadTokens += toNumber(event.tokenUsage?.cacheReadTokens);
    if (event.model && !existing.models.includes(event.model)) {
      existing.models.push(event.model);
    }
    const ts = toNumber(event.timestamp);
    if (ts > existing.lastTimestampMs) existing.lastTimestampMs = ts;
    map.set(id, existing);
  }
  return [...map.values()].sort((a, b) => b.lastTimestampMs - a.lastTimestampMs);
}

function aggregateModels(
  events: UsageEvent[],
  byModel: ModelAggregation[]
): ModelUsageSummary[] {
  const map = new Map<string, ModelUsageSummary>();

  for (const event of events) {
    const modelId = event.model || 'unknown';
    const existing = map.get(modelId) ?? {
      modelId,
      label: displayModelName(modelId),
      isAuto: isAutoModel(modelId),
      eventCount: 0,
      chargedCents: 0,
      requestUnits: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
    };
    existing.eventCount += 1;
    existing.chargedCents += toNumber(event.chargedCents);
    existing.requestUnits += toNumber(event.requestsCosts);
    existing.inputTokens += toNumber(event.tokenUsage?.inputTokens);
    existing.outputTokens += toNumber(event.tokenUsage?.outputTokens);
    existing.cacheReadTokens += toNumber(event.tokenUsage?.cacheReadTokens);
    map.set(modelId, existing);
  }

  // Fill gaps from server aggregation when a model has no events on the fetched pages
  for (const agg of byModel) {
    const modelId = agg.modelIntent || 'unknown';
    if (map.has(modelId)) {
      const row = map.get(modelId)!;
      if (row.inputTokens === 0 && agg.inputTokens) row.inputTokens = agg.inputTokens;
      if (row.outputTokens === 0 && agg.outputTokens) row.outputTokens = agg.outputTokens;
      if (row.cacheReadTokens === 0 && agg.cacheReadTokens) row.cacheReadTokens = agg.cacheReadTokens;
      if (row.chargedCents === 0 && agg.totalCents) row.chargedCents = agg.totalCents;
      continue;
    }
    map.set(modelId, {
      modelId,
      label: displayModelName(modelId),
      isAuto: isAutoModel(modelId),
      eventCount: 0,
      chargedCents: agg.totalCents,
      requestUnits: 0,
      inputTokens: agg.inputTokens,
      outputTokens: agg.outputTokens,
      cacheReadTokens: agg.cacheReadTokens,
    });
  }

  return [...map.values()].sort((a, b) => b.chargedCents - a.chargedCents || b.eventCount - a.eventCount);
}

async function fetchAllPeriodEvents(
  token: string,
  start?: string | number,
  end?: string | number
): Promise<{ events: UsageEvent[]; total: number; rawPages: unknown[] }> {
  const pageSize = 100;
  const maxPages = 5;
  const all: UsageEvent[] = [];
  const rawPages: unknown[] = [];
  let total = 0;

  for (let page = 1; page <= maxPages; page++) {
    const body: Record<string, unknown> = { page, pageSize };
    if (start !== undefined && end !== undefined) {
      body.startDate = String(start);
      body.endDate = String(end);
    }
    const pageResult = await connectPost(
      '/aiserver.v1.DashboardService/GetFilteredUsageEvents',
      token,
      body
    );
    rawPages.push(pageResult);
    total = toNumber(pageResult?.totalUsageEventsCount);
    const batch: UsageEvent[] = Array.isArray(pageResult?.usageEventsDisplay)
      ? pageResult.usageEventsDisplay.map(mapEvent)
      : [];
    all.push(...batch);
    if (batch.length < pageSize || all.length >= total) break;
  }

  return { events: all, total, rawPages };
}

async function fetchModernUsage(token: string): Promise<UsageSnapshot> {
  const [period, plan] = await Promise.all([
    connectPost('/aiserver.v1.DashboardService/GetCurrentPeriodUsage', token, {}),
    connectPost('/aiserver.v1.DashboardService/GetPlanInfo', token, {}).catch(() => undefined),
  ]);

  const start = period?.billingCycleStart;
  const end = period?.billingCycleEnd;

  const [aggregated, eventResult] = await Promise.all([
    connectPost(
      '/aiserver.v1.DashboardService/GetAggregatedUsageEvents',
      token,
      start && end ? { startDate: String(start), endDate: String(end) } : {}
    ).catch(() => undefined),
    fetchAllPeriodEvents(token, start, end).catch(() => ({
      events: [] as UsageEvent[],
      total: 0,
      rawPages: [] as unknown[],
    })),
  ]);

  const recentEvents = eventResult.events;

  const byModel: ModelAggregation[] = Array.isArray(aggregated?.aggregations)
    ? aggregated.aggregations.map((a: any) => ({
        modelIntent: String(a.modelIntent ?? 'unknown'),
        inputTokens: toNumber(a.inputTokens),
        outputTokens: toNumber(a.outputTokens),
        cacheReadTokens: toNumber(a.cacheReadTokens),
        totalCents: toNumber(a.totalCents),
      }))
    : [];

  const autoBucketModels: string[] = Array.isArray(period?.autoBucketModels)
    ? period.autoBucketModels
        .map((m: unknown) => String(m))
        .filter((m: string) => m && !isAutoModel(m))
    : [];

  const planUsageRaw = period?.planUsage;
  const includedSpend = toNumber(planUsageRaw?.includedSpend);
  const limit = toNumber(planUsageRaw?.limit);
  const remainingRaw = planUsageRaw?.remaining;
  const remaining =
    remainingRaw === undefined || remainingRaw === null
      ? Math.max(0, limit - includedSpend)
      : toNumber(remainingRaw);
  const autoPercentUsed =
    planUsageRaw?.autoPercentUsed === undefined || planUsageRaw?.autoPercentUsed === null
      ? undefined
      : toNumber(planUsageRaw.autoPercentUsed);
  const apiPercentUsed =
    planUsageRaw?.apiPercentUsed === undefined || planUsageRaw?.apiPercentUsed === null
      ? undefined
      : toNumber(planUsageRaw.apiPercentUsed);
  const totalPercentUsed =
    planUsageRaw?.totalPercentUsed === undefined || planUsageRaw?.totalPercentUsed === null
      ? undefined
      : toNumber(planUsageRaw.totalPercentUsed);

  const planUsage: PlanUsage | undefined = planUsageRaw
    ? {
        totalSpend: toNumber(planUsageRaw.totalSpend),
        includedSpend,
        bonusSpend: toNumber(planUsageRaw.bonusSpend),
        remaining,
        limit,
        autoPercentUsed,
        apiPercentUsed,
        totalPercentUsed,
        bonusTooltip: planUsageRaw.bonusTooltip
          ? String(planUsageRaw.bonusTooltip)
          : undefined,
        remainingBonus: Boolean(planUsageRaw.remainingBonus),
      }
    : undefined;

  const quotaBuckets = buildQuotaBuckets(planUsage, autoBucketModels);

  return {
    source: 'modern',
    planName: plan?.planInfo?.planName,
    planPrice: plan?.planInfo?.price,
    includedAmountCents: toNumber(plan?.planInfo?.includedAmountCents),
    billingCycleStartMs: toNumber(start),
    billingCycleEndMs: toNumber(end),
    displayMessage: period?.displayMessage,
    autoModelSelectedDisplayMessage: period?.autoModelSelectedDisplayMessage
      ? String(period.autoModelSelectedDisplayMessage)
      : undefined,
    namedModelSelectedDisplayMessage: period?.namedModelSelectedDisplayMessage
      ? String(period.namedModelSelectedDisplayMessage)
      : undefined,
    planUsage,
    quotaBuckets,
    totalEventsThisPeriod: eventResult.total || recentEvents.length,
    totalInputTokens: toNumber(aggregated?.totalInputTokens),
    totalOutputTokens: toNumber(aggregated?.totalOutputTokens),
    totalCacheReadTokens: toNumber(aggregated?.totalCacheReadTokens),
    totalCostCentsFromEvents: toNumber(aggregated?.totalCostCents),
    autoBucketModels,
    byModel,
    modelUsage: aggregateModels(recentEvents, byModel),
    recentEvents,
    chats: groupChats(recentEvents),
    raw: { period, plan, aggregated, events: eventResult.rawPages },
  };
}

export function buildQuotaBuckets(
  planUsage?: PlanUsage,
  autoBucketModels: string[] = []
): QuotaBucket[] {
  if (!planUsage) return [];

  const cursorExamples = autoBucketModels
    .map((id) => displayModelName(id))
    .filter((label, index, all) => all.indexOf(label) === index)
    .filter((label) => /composer|grok|vega/i.test(label))
    .slice(0, 2);
  const cursorDetail = cursorExamples.length
    ? `Includes ${cursorExamples.join(' and ')}`
    : 'Includes Cursor Grok, Composer, and Auto-routed models';

  const buckets: QuotaBucket[] = [];
  if (planUsage.autoPercentUsed !== undefined) {
    buckets.push({
      id: 'cursorModels',
      label: 'Cursor Models',
      detail: `${cursorDetail}. Extra usage can consume Other Models quota or on-demand spend.`,
      percentUsed: planUsage.autoPercentUsed,
    });
  }
  if (planUsage.apiPercentUsed !== undefined || planUsage.limit > 0) {
    buckets.push({
      id: 'otherModels',
      label: 'Other Models',
      detail:
        'Additional usage beyond this limit consumes on-demand spend. Your plan includes at least this API allowance.',
      percentUsed:
        planUsage.apiPercentUsed ??
        (planUsage.limit > 0 ? (planUsage.includedSpend / planUsage.limit) * 100 : 0),
      usedCents: planUsage.includedSpend,
      limitCents: planUsage.limit,
      remainingCents: planUsage.remaining,
    });
  }
  return buckets;
}

async function fetchLegacyUsage(token: string): Promise<UsageSnapshot> {
  const legacy = await httpsJson('GET', 'https://api2.cursor.sh/auth/usage', {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'cursor-token-monitor-vscode-extension',
  });
  return {
    source: 'legacy',
    autoBucketModels: [],
    byModel: [],
    modelUsage: [],
    recentEvents: [],
    chats: [],
    quotaBuckets: [],
    raw: { legacy },
  };
}

export async function fetchUsage(auth: CursorAuthData): Promise<UsageSnapshot> {
  if (!auth.accessToken) {
    throw new Error('No access token available.');
  }

  try {
    return await fetchModernUsage(auth.accessToken);
  } catch (modernErr: any) {
    try {
      const legacy = await fetchLegacyUsage(auth.accessToken);
      legacy.displayMessage = `Modern usage API failed (${modernErr.message}); showing legacy /auth/usage only.`;
      return legacy;
    } catch (legacyErr: any) {
      throw new Error(
        `Failed to fetch usage. Modern: ${modernErr.message}. Legacy: ${legacyErr.message}`
      );
    }
  }
}
