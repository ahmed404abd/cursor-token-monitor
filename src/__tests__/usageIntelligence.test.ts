import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UsageSnapshot } from '../cursorApi';
import {
  healthFromPercent,
  totalUsagePercent,
  usageHealth,
  usedPercent,
} from '../usageIntelligence';

function usageWithPools(
  total: number,
  auto: number,
  api: number,
  includedSpend = 400,
  limit = 2000
): UsageSnapshot {
  return {
    source: 'modern',
    planUsage: {
      totalSpend: includedSpend,
      includedSpend,
      remaining: limit - includedSpend,
      limit,
      autoPercentUsed: auto,
      apiPercentUsed: api,
      totalPercentUsed: total,
    },
    quotaBuckets: [],
    totalEventsThisPeriod: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostCentsFromEvents: 0,
    autoBucketModels: [],
    byModel: [],
    modelUsage: [],
    recentEvents: [],
    chats: [],
    raw: {},
  };
}

describe('usageIntelligence health', () => {
  it('grades health from total usage, not the binding pool max', () => {
    const usage = usageWithPools(30, 20, 100);
    assert.equal(totalUsagePercent(usage), 30);
    assert.equal(usedPercent(usage), 100);
    assert.equal(usageHealth(usage, 65, 85), 'safe');
    assert.equal(healthFromPercent(30, 65, 85), 'safe');
    assert.equal(healthFromPercent(70, 65, 85), 'warning');
    assert.equal(healthFromPercent(85, 65, 85), 'critical');
    assert.equal(healthFromPercent(84.9, 65, 85), 'warning');
  });

  it('falls back to included/limit when totalPercentUsed is missing', () => {
    const usage = usageWithPools(undefined as unknown as number, 20, 20, 1000, 2000);
    delete usage.planUsage!.totalPercentUsed;
    assert.equal(totalUsagePercent(usage), 50);
    assert.equal(usageHealth(usage, 65, 85), 'safe');
  });
});
