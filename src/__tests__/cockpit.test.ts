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
    },
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

  it('resetCountdown returns labels', () => {
    const { resetInLabel, resetTimeLabel } = resetCountdown(Date.now() + 2 * 86_400_000);
    assert.ok(resetInLabel.includes('d') || resetInLabel.includes('h'));
    assert.notEqual(resetTimeLabel, '—');
  });
});
