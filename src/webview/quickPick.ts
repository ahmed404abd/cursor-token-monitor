import * as vscode from 'vscode';
import { CockpitViewModel } from './dashboardViewModel';

let quickPick: vscode.QuickPick<vscode.QuickPickItem> | undefined;

export interface QuickPickActions {
  onRefresh: () => void | Promise<void>;
  onOpenDashboard: () => void | Promise<void>;
}

function healthIcon(health: string): string {
  if (health === 'critical') return '$(flame)';
  if (health === 'warning') return '$(warning)';
  return '$(check)';
}

export function showUsageQuickPick(vm: CockpitViewModel, actions: QuickPickActions): void {
  if (!quickPick) {
    quickPick = vscode.window.createQuickPick();
    quickPick.canSelectMany = false;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.onDidHide(() => {
      quickPick?.dispose();
      quickPick = undefined;
    });
  }

  quickPick.title = 'Cursor Token Monitor';
  quickPick.placeholder = `${vm.usedLabel} / ${vm.limitLabel} · ${vm.percentUsed.toFixed(0)}% used`;
  quickPick.buttons = [
    { iconPath: new vscode.ThemeIcon('refresh'), tooltip: 'Refresh' },
    { iconPath: new vscode.ThemeIcon('dashboard'), tooltip: 'Open dashboard' },
  ];

  const items: vscode.QuickPickItem[] = [
    {
      label: `${healthIcon(vm.planHealth)} Plan · ${vm.planName}`,
      description: `${vm.usedLabel}/${vm.limitLabel}`,
      detail: `${vm.accountEmail} · Reset in ${vm.resetInLabel} · ${vm.billingCycleLabel}`,
      kind: vscode.QuickPickItemKind.Default,
    },
    { label: 'Cards', kind: vscode.QuickPickItemKind.Separator },
    ...vm.cards.map((c) => ({
      label: `${healthIcon(c.health)} ${c.title}`,
      description: `${c.spendLabel} · ${c.sharePercent.toFixed(1)}%`,
      detail: `${c.events} events · in ${c.tokensIn.toLocaleString()} / out ${c.tokensOut.toLocaleString()}${c.isEstimate ? ' · estimate' : ''}`,
    })),
    { label: 'Session & trends', kind: vscode.QuickPickItemKind.Separator },
    {
      label: `$(calendar) Today ${vm.spendSummary.todayCents / 100 >= 0 ? `$${(vm.spendSummary.todayCents / 100).toFixed(2)}` : '—'}`,
      description: `Yesterday $${(vm.spendSummary.yesterdayCents / 100).toFixed(2)} · 7d avg $${(vm.spendSummary.sevenDayAvgCents / 100).toFixed(2)}`,
    },
  ];

  if (vm.session) {
    items.push({
      label: `$(watch) Session · ${vm.session.events} requests`,
      description: `${vm.session.tokensLabel} · ${vm.session.spendLabel}`,
      detail: `Started ${vm.session.startedLabel}`,
    });
  }

  quickPick.items = items;
  quickPick.onDidTriggerButton(async (btn) => {
    if (btn.tooltip === 'Refresh') await actions.onRefresh();
    if (btn.tooltip === 'Open dashboard') await actions.onOpenDashboard();
  });
  quickPick.onDidAccept(() => {
    void actions.onOpenDashboard();
    quickPick?.hide();
  });
  quickPick.show();
}

export function updateUsageQuickPick(vm: CockpitViewModel): void {
  if (!quickPick) return;
  showUsageQuickPick(vm, {
    onRefresh: async () => {
      /* noop placeholder — replaced by caller re-show */
    },
    onOpenDashboard: async () => undefined,
  });
}

export function hideUsageQuickPick(): void {
  quickPick?.hide();
}
