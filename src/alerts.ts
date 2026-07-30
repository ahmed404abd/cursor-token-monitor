import * as vscode from 'vscode';
import { UsageSnapshot } from './cursorApi';
import { centsToDollars, usedPercent } from './usageIntelligence';
import { DaySpend, dayKey } from './historyStore';
import { CockpitSettings, loadSettings } from './webview/preferences';

const ALERT_STATE_KEY = 'cursorTokenMonitor.alertState';

interface AlertState {
  cycleStartMs?: number;
  firedWarning?: boolean;
  firedCritical?: boolean;
  /** legacy flags kept for migration */
  fired80?: boolean;
  fired90?: boolean;
  highSpendNotifiedDate?: string;
}

/**
 * Fire one-time notifications at configured warning/critical thresholds
 * (once per billing cycle), and unusually high daily spend vs the recent
 * average (once per day). Honors notificationsEnabled setting.
 */
export function checkUsageAlerts(
  context: vscode.ExtensionContext,
  usage: UsageSnapshot,
  dailySpend: DaySpend[],
  settings?: CockpitSettings
): void {
  const cfg = settings ?? loadSettings();
  if (!cfg.notificationsEnabled) return;

  const state = context.globalState.get<AlertState>(ALERT_STATE_KEY, {});
  let changed = false;

  const cycleStart = usage.billingCycleStartMs;
  if (cycleStart && state.cycleStartMs !== cycleStart) {
    state.cycleStartMs = cycleStart;
    state.firedWarning = false;
    state.firedCritical = false;
    state.fired80 = false;
    state.fired90 = false;
    changed = true;
  }

  const pct = usedPercent(usage);
  if (pct !== undefined) {
    if (pct >= cfg.criticalThreshold && !state.firedCritical && !state.fired90) {
      state.firedCritical = true;
      state.firedWarning = true;
      state.fired90 = true;
      state.fired80 = true;
      changed = true;
      void vscode.window.showWarningMessage(
        `Cursor Token Monitor: ${pct.toFixed(0)}% of your included allowance is used — limit risk.`
      );
    } else if (pct >= cfg.warningThreshold && !state.firedWarning && !state.fired80) {
      state.firedWarning = true;
      state.fired80 = true;
      changed = true;
      void vscode.window.showWarningMessage(
        `Cursor Token Monitor: ${pct.toFixed(0)}% of your included allowance is used.`
      );
    }
  }

  const today = dayKey();
  const todayRow = dailySpend.find((d) => d.date === today);
  const priorDays = dailySpend.filter((d) => d.date !== today).slice(-7);
  if (todayRow && priorDays.length >= 3 && state.highSpendNotifiedDate !== today) {
    const avg = priorDays.reduce((s, d) => s + d.chargedCents, 0) / priorDays.length;
    if (todayRow.chargedCents > Math.max(50, avg * 2)) {
      state.highSpendNotifiedDate = today;
      changed = true;
      void vscode.window.showInformationMessage(
        `Cursor Token Monitor: today's spend (${centsToDollars(todayRow.chargedCents)}) is well above your recent daily average (${centsToDollars(avg)}).`
      );
    }
  }

  if (changed) void context.globalState.update(ALERT_STATE_KEY, state);
}
