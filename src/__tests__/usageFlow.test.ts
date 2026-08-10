import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildUsageFlow, windowStartMs } from '../usageFlow';
import { UsageSnapshot } from '../cursorApi';

function sampleUsage(): UsageSnapshot {
  const now = Date.now();
  return {
    source: 'modern',
    planName: 'Pro',
    planPrice: '$20/mo',
    includedAmountCents: 2000,
    billingCycleStartMs: now - 10 * 86_400_000,
    billingCycleEndMs: now + 20 * 86_400_000,
    planUsage: {
      totalSpend: 1400,
      includedSpend: 1400,
      remaining: 600,
      limit: 2000,
      autoPercentUsed: 20,
      apiPercentUsed: 70,
    },
    quotaBuckets: [],
    modelUsage: [],
    byModel: [],
    chats: [],
    autoBucketModels: [],
    recentEvents: [
      {
        timestamp: String(now - 2 * 3_600_000),
        model: 'default',
        chargedCents: 400,
        conversationId: 'chat-a',
        tokenUsage: { inputTokens: 1000, outputTokens: 500 },
      },
      {
        timestamp: String(now - 5 * 3_600_000),
        model: 'gpt-5',
        chargedCents: 200,
        conversationId: 'chat-b',
        tokenUsage: { inputTokens: 800, outputTokens: 200 },
      },
      {
        timestamp: String(now - 8 * 86_400_000),
        model: 'claude-4-sonnet',
        chargedCents: 100,
        conversationId: 'chat-c',
        tokenUsage: { inputTokens: 400, outputTokens: 100 },
      },
    ],
    totalEventsThisPeriod: 3,
    totalCostCentsFromEvents: 700,
    totalInputTokens: 2200,
    totalOutputTokens: 800,
    raw: {},
    displayMessage: '',
  };
}

describe('usage flow', () => {
  it('windowStartMs covers today and rolling ranges', () => {
    const now = Date.parse('2026-08-10T15:00:00');
    const today = windowStartMs('today', undefined, now);
    const week = windowStartMs('7d', undefined, now);
    assert.ok(today <= now);
    assert.ok(week < today);
  });

  it('builds model branches and filters by window', () => {
    const usage = sampleUsage();
    const cycle = buildUsageFlow({ usage, window: 'cycle', metric: 'spend' });
    assert.ok(cycle.total >= 600);
    assert.ok(cycle.models.length >= 2);
    assert.equal(cycle.models[0].id, 'default');
    assert.ok(cycle.models[0].sessions.length >= 1);

    const today = buildUsageFlow({ usage, window: 'today', metric: 'requests' });
    assert.equal(today.total, 2);
    assert.ok(today.models.every((m) => m.id !== 'claude-4-sonnet'));
  });

  it('flags anomalies against trailing average', () => {
    const flow = buildUsageFlow({
      usage: sampleUsage(),
      window: '30d',
      metric: 'spend',
      modelHistory: [
        { date: '2026-08-01', modelId: 'gpt-5', modelLabel: 'GPT 5', chargedCents: 100, eventCount: 2, inputTokens: 10, outputTokens: 10 },
        { date: '2026-08-02', modelId: 'gpt-5', modelLabel: 'GPT 5', chargedCents: 110, eventCount: 2, inputTokens: 10, outputTokens: 10 },
        { date: '2026-08-03', modelId: 'gpt-5', modelLabel: 'GPT 5', chargedCents: 90, eventCount: 2, inputTokens: 10, outputTokens: 10 },
        { date: '2026-08-04', modelId: 'gpt-5', modelLabel: 'GPT 5', chargedCents: 100, eventCount: 2, inputTokens: 10, outputTokens: 10 },
        { date: '2026-08-05', modelId: 'gpt-5', modelLabel: 'GPT 5', chargedCents: 105, eventCount: 2, inputTokens: 10, outputTokens: 10 },
        { date: '2026-08-06', modelId: 'gpt-5', modelLabel: 'GPT 5', chargedCents: 95, eventCount: 2, inputTokens: 10, outputTokens: 10 },
        { date: '2026-08-07', modelId: 'gpt-5', modelLabel: 'GPT 5', chargedCents: 100, eventCount: 2, inputTokens: 10, outputTokens: 10 },
        { date: '2026-08-08', modelId: 'gpt-5', modelLabel: 'GPT 5', chargedCents: 500, eventCount: 8, inputTokens: 10, outputTokens: 10 },
      ],
    });
    assert.ok(flow.trend.points.some((p) => p.isAnomaly));
    assert.ok(flow.trend.anomaly);
  });
});
