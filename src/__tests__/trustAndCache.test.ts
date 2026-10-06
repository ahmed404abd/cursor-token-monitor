import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrustBundle, isStale, makeTrust, formatFetchedAge } from '../trust';
import { buildCacheEfficiency, cacheHitRate } from '../cacheEfficiency';
import { UsageSnapshot } from '../cursorApi';
import { statusBarTone, statusBarToneColor, statusBarToneFromUsage } from '../usageIntelligence';

describe('trust badges', () => {
  it('marks official data stale after 2× refresh interval', () => {
    const fetchedAt = Date.now() - 130_000;
    assert.equal(isStale(fetchedAt, 60), true);
    assert.equal(isStale(Date.now() - 10_000, 60), false);
    const t = makeTrust('official', 'From API', {
      fetchedAtMs: fetchedAt,
      refreshIntervalSeconds: 60,
    });
    assert.equal(t.source, 'stale');
    assert.equal(t.label, 'Stale');
  });

  it('builds a trust bundle with the four badge kinds', () => {
    const bundle = buildTrustBundle({
      fetchedAtMs: Date.now() - 5_000,
      refreshIntervalSeconds: 60,
    });
    assert.equal(bundle.planPercent.source, 'official');
    assert.equal(bundle.runway.source, 'derived');
    assert.equal(bundle.heatmap.source, 'estimated');
    assert.equal(bundle.legend.length, 4);
    assert.match(formatFetchedAge(Date.now() - 40_000), /40s/);
  });
});

describe('cache efficiency', () => {
  it('computes hit rate as cache / (cache + input)', () => {
    assert.equal(cacheHitRate(75, 25), 75);
    assert.equal(cacheHitRate(0, 0), 0);
  });

  it('builds cycle cache analytics from usage totals and models', () => {
    const usage: UsageSnapshot = {
      source: 'modern',
      quotaBuckets: [],
      autoBucketModels: [],
      byModel: [],
      modelUsage: [
        {
          modelId: 'composer',
          label: 'Composer',
          isAuto: false,
          eventCount: 2,
          chargedCents: 10,
          requestUnits: 2,
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 300,
        },
      ],
      recentEvents: [],
      chats: [],
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCacheReadTokens: 300,
      raw: {},
    };
    const ce = buildCacheEfficiency(usage);
    assert.equal(ce.hitRatePercent, 75);
    assert.equal(ce.byModel[0]?.label, 'Composer');
    assert.match(ce.summary, /cache/i);
  });
});

describe('status bar tones', () => {
  it('maps total usage into green / yellow / orange / red', () => {
    assert.equal(statusBarTone(10, 65, 85), 'green');
    assert.equal(statusBarTone(50, 65, 85), 'yellow');
    assert.equal(statusBarTone(70, 65, 85), 'orange');
    assert.equal(statusBarTone(90, 65, 85), 'red');
    assert.match(statusBarToneColor('green'), /^#/);
    assert.match(statusBarToneColor('red'), /^#/);
  });

  it('turns red when Other Models is exhausted even if blended total is lower', () => {
    const usage = {
      source: 'modern' as const,
      quotaBuckets: [],
      autoBucketModels: [],
      byModel: [],
      modelUsage: [],
      recentEvents: [],
      chats: [],
      raw: {},
      planUsage: {
        totalSpend: 2000,
        includedSpend: 2000,
        remaining: 0,
        limit: 2000,
        autoPercentUsed: 20,
        apiPercentUsed: 100,
        totalPercentUsed: 60,
      },
    };
    assert.equal(statusBarToneFromUsage(usage, 65, 85), 'red');
  });
});
