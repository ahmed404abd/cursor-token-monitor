import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyOrder, validateThresholds } from '../webview/orderUtils';
import { formatStatusBar } from '../statusBar';
import { UsageSnapshot } from '../cursorApi';
import { CockpitSettings } from '../webview/preferences';
import { resetCountdown, buildCockpitViewModel } from '../webview/dashboardViewModel';

function sampleUsage(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    source: 'modern',
    planName: 'Pro',
    planPrice: '$20',
    billingCycleStartMs: Date.now() - 5 * 86_400_000,
    billingCycleEndMs: Date.now() + 10 * 86_400_000,
    planUsage: {
      totalSpend: 400,
      includedSpend: 400,
      remaining: 1600,
      limit: 2000,
      autoPercentUsed: 20,
      apiPercentUsed: 20,
      totalPercentUsed: 20,
    },
    quotaBuckets: [
      {
        id: 'cursorModels',
        label: 'Cursor Models',
        detail: 'Includes Composer and Grok',
        percentUsed: 20,
      },
      {
        id: 'otherModels',
        label: 'Other Models',
        detail: 'API allowance',
        percentUsed: 20,
        usedCents: 400,
        limitCents: 2000,
        remainingCents: 1600,
      },
    ],
    totalEventsThisPeriod: 12,
    totalInputTokens: 1000,
    totalOutputTokens: 500,
    totalCostCentsFromEvents: 400,
    autoBucketModels: [],
    byModel: [],
    modelUsage: [
      {
        modelId: 'default',
        label: 'Auto',
        isAuto: true,
        eventCount: 5,
        chargedCents: 100,
        requestUnits: 5,
        inputTokens: 400,
        outputTokens: 200,
        cacheReadTokens: 0,
      },
      {
        modelId: 'gpt-5',
        label: 'GPT 5',
        isAuto: false,
        eventCount: 7,
        chargedCents: 300,
        requestUnits: 7,
        inputTokens: 600,
        outputTokens: 300,
        cacheReadTokens: 0,
      },
    ],
    recentEvents: [],
    chats: [
      {
        conversationId: 'abc123456789',
        eventCount: 3,
        chargedCents: 50,
        requestUnits: 3,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        models: ['gpt-5'],
        lastTimestampMs: Date.now(),
      },
    ],
    raw: {},
    ...overrides,
  };
}

const baseSettings: CockpitSettings = {
  statusBarFormat: 'full',
  statusBarMode: 'spend',
  notificationsEnabled: true,
  warningThreshold: 75,
  criticalThreshold: 90,
  viewMode: 'card',
  displayMode: 'dashboard',
  refreshIntervalSeconds: 60,
};

describe('preferences helpers', () => {
  it('applyOrder keeps missing ids at the end', () => {
    assert.deepEqual(applyOrder(['a', 'b', 'c'], ['c', 'a']), ['c', 'a', 'b']);
  });

  it('validateThresholds requires warning < critical', () => {
    assert.equal(validateThresholds(75, 90), true);
    assert.equal(validateThresholds(90, 75), false);
    assert.equal(validateThresholds(80, 80), false);
  });
});

describe('status bar formats', () => {
  const usage = sampleUsage();

  it('formats icon / percent / full / namePercent', () => {
    assert.match(formatStatusBar(usage, { ...baseSettings, statusBarFormat: 'icon' }, []), /\$\(/);
    assert.match(
      formatStatusBar(usage, { ...baseSettings, statusBarFormat: 'percent' }, []),
      /%/
    );
    assert.match(
      formatStatusBar(usage, { ...baseSettings, statusBarFormat: 'full' }, []),
      /\$4\.00\/\$20\.00/
    );
    assert.match(
      formatStatusBar(usage, { ...baseSettings, statusBarFormat: 'namePercent' }, ['gpt-5']),
      /GPT 5/
    );
  });
});

describe('view model', () => {
  it('builds model cards with aliases, pins, and order', () => {
    const vm = buildCockpitViewModel({
      usage: sampleUsage(),
      projects: [],
      dailySpend: [],
      sessions: [],
      spendSummary: {
        todayCents: 10,
        yesterdayCents: 5,
        sevenDayAvgCents: 7,
        sevenDayTotalCents: 49,
      },
      prefs: {
        groupMode: 'model',
        cardOrderModel: ['gpt-5', 'default'],
        cardOrderWorkspace: [],
        modelAliases: { 'gpt-5': 'My GPT' },
        pinnedModelIds: ['gpt-5'],
      },
      settings: baseSettings,
      issuesUrl: 'https://example.com',
    });

    assert.equal(vm.cards[0].id, 'gpt-5');
    assert.equal(vm.cards[0].title, 'My GPT');
    assert.equal(vm.cards[0].isPinned, true);
    assert.equal(vm.percentUsed, 20);
  });

  it('shows Cursor Models and Other Models dual quotas separately', () => {
    const vm = buildCockpitViewModel({
      usage: sampleUsage({
        planUsage: {
          totalSpend: 2000,
          includedSpend: 2000,
          remaining: 0,
          limit: 2000,
          autoPercentUsed: 20,
          apiPercentUsed: 100,
          totalPercentUsed: 30,
        },
        quotaBuckets: [
          {
            id: 'cursorModels',
            label: 'Cursor Models',
            detail: 'Includes Composer and Grok',
            percentUsed: 20,
          },
          {
            id: 'otherModels',
            label: 'Other Models',
            detail: 'API allowance',
            percentUsed: 100,
            usedCents: 2000,
            limitCents: 2000,
            remainingCents: 0,
          },
        ],
      }),
      projects: [],
      dailySpend: [],
      sessions: [],
      spendSummary: {
        todayCents: 10,
        yesterdayCents: 5,
        sevenDayAvgCents: 7,
        sevenDayTotalCents: 49,
      },
      prefs: {
        groupMode: 'model',
        cardOrderModel: [],
        cardOrderWorkspace: [],
        modelAliases: {},
        pinnedModelIds: [],
      },
      settings: baseSettings,
      issuesUrl: 'https://example.com',
    });

    assert.equal(vm.percentUsed, 100);
    assert.equal(vm.bindingQuotaLabel, 'Other Models');
    assert.equal(vm.quotaBuckets.length, 2);
    assert.equal(vm.quotaBuckets[0].percentLabel, '20%');
    assert.equal(vm.quotaBuckets[1].percentLabel, '100%');
    assert.match(vm.displayMessage, /Cursor Models 20%/);
    assert.match(vm.displayMessage, /Other Models 100%/);
  });

  it('builds a 90-day model heatmap with availability and threshold signals', () => {
    const today = new Date();
    const date = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-');
    const vm = buildCockpitViewModel({
      usage: sampleUsage(),
      projects: [],
      dailySpend: [],
      dailyHistory: [{
        date,
        includedSpendCents: 1900,
        remainingCents: 100,
        limitCents: 2000,
        eventCount: 3,
        chargedCents: 250,
        inputTokens: 100,
        outputTokens: 50,
        updatedAt: new Date().toISOString(),
      }],
      modelHistory: [{
        date,
        modelId: 'gpt-5',
        modelLabel: 'GPT 5',
        chargedCents: 250,
        eventCount: 3,
        inputTokens: 100,
        outputTokens: 50,
      }],
      sessions: [],
      spendSummary: {
        todayCents: 250,
        yesterdayCents: 0,
        sevenDayAvgCents: 35.7,
        sevenDayTotalCents: 250,
      },
      prefs: {
        groupMode: 'model',
        cardOrderModel: [],
        cardOrderWorkspace: [],
        modelAliases: {},
        pinnedModelIds: [],
      },
      settings: baseSettings,
      issuesUrl: 'https://example.com',
    });

    assert.equal(vm.heatmap.days.length, 90);
    assert.equal(vm.heatmap.days[0].availability, 'unavailable');
    assert.equal(vm.heatmap.days.at(-1)?.availability, 'usage');
    assert.equal(vm.heatmap.days.at(-1)?.severity, 'critical');
    assert.deepEqual(vm.heatmap.models, [{ id: 'gpt-5', label: 'GPT 5' }]);
  });

  it('resetCountdown returns labels', () => {
    const { resetInLabel, resetTimeLabel } = resetCountdown(Date.now() + 2 * 86_400_000);
    assert.ok(resetInLabel.includes('d') || resetInLabel.includes('h'));
    assert.notEqual(resetTimeLabel, '—');
  });
});
