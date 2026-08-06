import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBurnForecast } from '../forecast';
import { UsageSnapshot } from '../cursorApi';

function usage(partial: Partial<UsageSnapshot> & { planUsage: NonNullable<UsageSnapshot['planUsage']> }): UsageSnapshot {
  return {
    source: 'modern',
    autoBucketModels: [],
    byModel: [],
    modelUsage: [],
    recentEvents: [],
    chats: [],
    quotaBuckets: [],
    raw: {},
    billingCycleStartMs: Date.now() - 10 * 86_400_000,
    billingCycleEndMs: Date.now() + 20 * 86_400_000,
    ...partial,
  };
}

describe('burn forecast', () => {
  it('projects Other Models exhaustion when burn is high', () => {
    const forecast = buildBurnForecast(
      usage({
        planUsage: {
          totalSpend: 1500,
          includedSpend: 1500,
          remaining: 500,
          limit: 2000,
          autoPercentUsed: 20,
          apiPercentUsed: 75,
          totalPercentUsed: 40,
        },
      })
    );
    assert.ok(forecast);
    assert.equal(forecast!.quotas.length, 2);
    const other = forecast!.quotas.find((q) => q.id === 'otherModels');
    assert.ok(other);
    assert.ok((other!.projectedPercentAtCycleEnd ?? 0) > 75);
    assert.ok(other!.daysUntilExhausted !== null);
    assert.match(forecast!.headline + forecast!.detail, /Other Models|pace|cycle/i);
  });

  it('marks exhausted pools clearly', () => {
    const forecast = buildBurnForecast(
      usage({
        planUsage: {
          totalSpend: 2000,
          includedSpend: 2000,
          remaining: 0,
          limit: 2000,
          autoPercentUsed: 23,
          apiPercentUsed: 100,
        },
      })
    );
    assert.ok(forecast);
    const other = forecast!.quotas.find((q) => q.id === 'otherModels');
    assert.equal(other?.daysUntilExhausted, 0);
    assert.equal(other?.level, 'alert');
  });
});
