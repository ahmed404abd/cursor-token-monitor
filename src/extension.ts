import * as vscode from 'vscode';
import { readCursorAuth, CursorAuthData } from './dbReader';
import { fetchUsage, UsageSnapshot } from './cursorApi';
import {
  buildUsageInsights,
  centsToDollars,
  estimateAutoModels,
} from './usageIntelligence';
import {
  loadProjectRecords,
  resetProjectCache,
  updateProjectUsage,
  ProjectUsageRecord,
} from './projectTracker';
import { buildTextReport, exportUsageToFile, ExportFormat } from './exportReport';
import { classifySetupError, runFirstRunCheck, showSetupGuide } from './onboarding';
import { showPrivacyAudit } from './privacy';
import {
  buildDailySpendFromEvents,
  buildDailySpendFromHistory,
  DaySpend,
  loadDailyModelHistory,
  loadHistory,
  longestSessions,
  mergeDailySpend,
  recordDailyModelHistory,
  recordDailySnapshot,
  resetHistory,
  summarizeSpend,
} from './historyStore';
import { ensureSessionBaseline, getSessionStats } from './sessionTracker';
import { checkUsageAlerts } from './alerts';
import { formatStatusBar, statusBarVariants } from './statusBar';
import {
  CockpitPreferences,
  CockpitSettings,
  GroupMode,
  SettingsPatch,
  loadPreferences,
  loadSettings,
  resetCardOrder,
  savePreferences,
  updateSettings,
} from './webview/preferences';
import { buildCockpitViewModel, CockpitViewModel } from './webview/dashboardViewModel';
import {
  MessageHandler,
  postError,
  postUsageUpdate,
  showDashboardPanel,
} from './webview/dashboardPanel';
import { showUsageQuickPick } from './webview/quickPick';

const ISSUES_URL = 'https://github.com/ahmed404abd/cursor-token-monitor/issues';

let statusBarItem: vscode.StatusBarItem;
let timer: ReturnType<typeof setInterval> | undefined;
let rotateTimer: ReturnType<typeof setInterval> | undefined;
let rotateIndex = 0;
let lastAuth: CursorAuthData | undefined;
let lastUsage: UsageSnapshot | undefined;
let lastUpdated: Date | undefined;
let lastProjects: ProjectUsageRecord[] = [];
let lastDailyHistory: ReturnType<typeof loadHistory> = [];
let lastModelHistory: ReturnType<typeof loadDailyModelHistory> = [];
let lastVm: CockpitViewModel | undefined;
let extensionContext: vscode.ExtensionContext | undefined;

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'cursorTokenMonitor.openDashboard';
  statusBarItem.text = '$(sync~spin) Cursor usage';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const cmds: [string, (...args: any[]) => any][] = [
    ['cursorTokenMonitor.refresh', () => refresh(context)],
    ['cursorTokenMonitor.showDetails', () => openUsageView(context, 'dashboard')],
    ['cursorTokenMonitor.openDashboard', () => openUsageView(context)],
    ['cursorTokenMonitor.openQuickPick', () => openUsageView(context, 'quickpick')],
    ['cursorTokenMonitor.copyUsageReport', () => copyUsageReport()],
    ['cursorTokenMonitor.exportCsv', () => exportUsage('csv')],
    ['cursorTokenMonitor.exportJson', () => exportUsage('json')],
    ['cursorTokenMonitor.exportMarkdown', () => exportUsage('markdown')],
    ['cursorTokenMonitor.exportData', () => exportUsagePick()],
    ['cursorTokenMonitor.resetCache', () => resetCache(context)],
    ['cursorTokenMonitor.checkConnection', () => checkConnection(context)],
    ['cursorTokenMonitor.privacyAudit', () => showPrivacyAudit(context)],
  ];

  for (const [id, handler] of cmds) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('cursorTokenMonitor.refreshIntervalSeconds')) {
        scheduleRefresh(context);
      }
      if (
        e.affectsConfiguration('cursorTokenMonitor.statusBarMode') ||
        e.affectsConfiguration('cursorTokenMonitor.statusBarFormat') ||
        e.affectsConfiguration('cursorTokenMonitor.warningThreshold') ||
        e.affectsConfiguration('cursorTokenMonitor.criticalThreshold')
      ) {
        scheduleRotation();
        applyStatusBarText();
        if (lastUsage) pushViewModel(context);
      }
    })
  );

  void runFirstRunCheck(context);
  refresh(context);
  scheduleRefresh(context);
  scheduleRotation();
}

function scheduleRefresh(context: vscode.ExtensionContext) {
  if (timer) clearInterval(timer);
  const seconds = loadSettings().refreshIntervalSeconds;
  timer = setInterval(() => refresh(context), Math.max(15, seconds) * 1000);
}

function computeDailySpend(usage: UsageSnapshot): DaySpend[] {
  const history = lastDailyHistory.length
    ? lastDailyHistory
    : extensionContext
      ? loadHistory(extensionContext)
      : [];
  return mergeDailySpend(
    buildDailySpendFromEvents(usage, 30),
    buildDailySpendFromHistory(history, 30),
    30
  );
}

function buildVm(context: vscode.ExtensionContext, usage: UsageSnapshot): CockpitViewModel {
  const prefs = loadPreferences(context);
  const settings = loadSettings();
  const projects =
    lastProjects.length > 0 ? lastProjects : loadProjectRecords(context);
  const dailyHistory = lastDailyHistory.length ? lastDailyHistory : loadHistory(context);
  const dailySpend = computeDailySpend(usage);
  return buildCockpitViewModel({
    auth: lastAuth,
    usage,
    projects,
    dailySpend,
    dailyHistory,
    modelHistory: lastModelHistory.length ? lastModelHistory : loadDailyModelHistory(context),
    sessions: longestSessions(usage, 5),
    spendSummary: summarizeSpend(dailySpend),
    session: getSessionStats(usage),
    updated: lastUpdated,
    prefs,
    settings,
    issuesUrl: ISSUES_URL,
  });
}

function pushViewModel(context: vscode.ExtensionContext): CockpitViewModel | undefined {
  if (!lastUsage) return undefined;
  lastVm = buildVm(context, lastUsage);
  postUsageUpdate(lastVm);
  return lastVm;
}

function applyStatusBarText() {
  if (!lastUsage || !extensionContext) return;
  const settings = loadSettings();
  const prefs = loadPreferences(extensionContext);
  if (settings.statusBarMode !== 'rotate') {
    statusBarItem.text = formatStatusBar(lastUsage, settings, prefs.pinnedModelIds);
    return;
  }
  const variants = statusBarVariants(lastUsage, settings, prefs.pinnedModelIds);
  statusBarItem.text = variants[rotateIndex % variants.length];
}

function scheduleRotation() {
  if (rotateTimer) {
    clearInterval(rotateTimer);
    rotateTimer = undefined;
  }
  if (loadSettings().statusBarMode !== 'rotate') return;
  rotateTimer = setInterval(() => {
    rotateIndex += 1;
    applyStatusBarText();
  }, 8000);
}

function warningColor(usage: UsageSnapshot, settings: CockpitSettings): vscode.ThemeColor | undefined {
  const pct = usage.planUsage && usage.planUsage.limit > 0
    ? (usage.planUsage.includedSpend / usage.planUsage.limit) * 100
    : undefined;
  if (pct === undefined) return undefined;
  if (pct >= settings.criticalThreshold) {
    return new vscode.ThemeColor('statusBarItem.errorBackground');
  }
  if (pct >= settings.warningThreshold) {
    return new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  return undefined;
}

function buildTooltip(auth: CursorAuthData, usage: UsageSnapshot, settings: CockpitSettings): string {
  const insights = buildUsageInsights(usage, settings.warningThreshold, settings.criticalThreshold);
  const autoEst = estimateAutoModels(usage);
  const lines = [
    auth.email ? `Account: ${auth.email}` : undefined,
    auth.membershipType || usage.planName
      ? `Plan: ${usage.planName ?? auth.membershipType}${usage.planPrice ? ` (${usage.planPrice})` : ''}`
      : undefined,
    usage.planUsage
      ? `Used: ${centsToDollars(usage.planUsage.includedSpend)} / ${centsToDollars(usage.planUsage.limit)}`
      : undefined,
    usage.planUsage ? `Remaining: ${centsToDollars(usage.planUsage.remaining)}` : undefined,
    insights[0] ? `Insight: ${insights[0].title}` : undefined,
    autoEst.autoEventCount
      ? `Auto estimate: ${autoEst.likelyModels.slice(0, 3).join(', ') || '—'} (${autoEst.confidence})`
      : undefined,
    lastUpdated ? `Updated: ${lastUpdated.toLocaleTimeString()}` : undefined,
    '',
    'Click for usage cockpit',
  ].filter((l): l is string => l !== undefined);
  return lines.join('\n');
}

async function refresh(context: vscode.ExtensionContext) {
  try {
    statusBarItem.text = '$(sync~spin) Cursor usage';
    const auth = await readCursorAuth(context);
    lastAuth = auth;
    lastUsage = await fetchUsage(auth);
    lastUpdated = new Date();
    lastProjects = updateProjectUsage(context, lastUsage);
    lastDailyHistory = recordDailySnapshot(context, lastUsage);
    lastModelHistory = recordDailyModelHistory(context, lastUsage);
    ensureSessionBaseline(lastUsage);
    const settings = loadSettings();
    checkUsageAlerts(context, lastUsage, computeDailySpend(lastUsage), settings);
    statusBarItem.command = 'cursorTokenMonitor.openDashboard';
    applyStatusBarText();
    statusBarItem.tooltip = buildTooltip(auth, lastUsage, settings);
    statusBarItem.backgroundColor = warningColor(lastUsage, settings);
    pushViewModel(context);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    const issue = classifySetupError(message);
    statusBarItem.text =
      issue === 'python'
        ? '$(warning) Setup Python'
        : issue === 'auth'
          ? '$(warning) Sign in to Cursor'
          : '$(warning) Cursor usage';
    statusBarItem.tooltip = `Failed to fetch Cursor usage:\n${message}\n\nClick for setup help, or run "Cursor Token Monitor: Check Connection".`;
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    statusBarItem.command = 'cursorTokenMonitor.checkConnection';
    postError(message);

    if (issue === 'python' || issue === 'auth' || issue === 'database') {
      void showSetupGuide(issue, message);
    }
  }
}

async function ensureUsage(context?: vscode.ExtensionContext): Promise<boolean> {
  if (lastUsage) return true;
  const ctx = context ?? extensionContext;
  if (!ctx) {
    vscode.window.showWarningMessage('Extension not ready yet.');
    return false;
  }
  await refresh(ctx);
  if (!lastUsage) {
    vscode.window.showWarningMessage('No usage data yet. Fix setup, then Refresh Usage.');
    return false;
  }
  return true;
}

async function copyUsageReport() {
  if (!(await ensureUsage())) return;
  const text = buildTextReport(lastAuth, lastUsage!, lastProjects, lastUpdated);
  await vscode.env.clipboard.writeText(text);
  vscode.window.showInformationMessage('Usage report copied to clipboard.');
}

async function exportUsage(format: ExportFormat) {
  if (!(await ensureUsage())) return;
  const path = await exportUsageToFile(format, lastAuth, lastUsage!, lastProjects);
  if (path) {
    vscode.window.showInformationMessage(`Exported ${format.toUpperCase()} to ${path}`);
  }
}

async function exportUsagePick() {
  const pick = await vscode.window.showQuickPick(
    [
      { label: 'CSV', description: 'Spreadsheet-friendly rows', format: 'csv' as ExportFormat },
      { label: 'JSON', description: 'Full structured data', format: 'json' as ExportFormat },
      { label: 'Markdown', description: 'Readable report with tables', format: 'markdown' as ExportFormat },
    ],
    { placeHolder: 'Export Cursor usage as…' }
  );
  if (pick) await exportUsage(pick.format);
}

async function resetCache(context: vscode.ExtensionContext) {
  resetProjectCache(context);
  resetHistory(context);
  lastProjects = [];
  lastDailyHistory = [];
  lastModelHistory = [];
  lastUsage = undefined;
  lastAuth = undefined;
  lastUpdated = undefined;
  lastVm = undefined;
  vscode.window.showInformationMessage('Local usage cache & history cleared. Refreshing…');
  await refresh(context);
}

async function checkConnection(context: vscode.ExtensionContext) {
  try {
    statusBarItem.text = '$(sync~spin) Checking…';
    await refresh(context);
    if (lastUsage && lastAuth) {
      const settings = loadSettings();
      vscode.window.showInformationMessage(
        `Connected. Plan ${lastUsage.planName ?? lastAuth.membershipType ?? 'unknown'} · ${formatStatusBar(lastUsage, settings, loadPreferences(context).pinnedModelIds).replace(/\$\([^)]+\)\s*/, '')}`
      );
    }
  } catch (err: any) {
    const message = err?.message ?? String(err);
    const issue = classifySetupError(message);
    await showSetupGuide(issue, message);
  }
}

const handleWebviewMessage: MessageHandler = async (msg) => {
  const context = extensionContext;
  if (!context) return;

  switch (msg.type) {
    case 'ready':
      if (lastVm) postUsageUpdate(lastVm);
      else if (lastUsage) pushViewModel(context);
      break;
    case 'refresh':
      await refresh(context);
      break;
    case 'reorder': {
      const prefs = loadPreferences(context);
      if (msg.groupMode === 'workspace') prefs.cardOrderWorkspace = msg.order;
      else prefs.cardOrderModel = msg.order;
      await savePreferences(context, prefs);
      pushViewModel(context);
      break;
    }
    case 'resetOrder': {
      await resetCardOrder(context);
      pushViewModel(context);
      vscode.window.showInformationMessage('Card order reset.');
      break;
    }
    case 'setGroupMode': {
      const prefs = loadPreferences(context);
      prefs.groupMode = msg.groupMode as GroupMode;
      await savePreferences(context, prefs);
      pushViewModel(context);
      break;
    }
    case 'updateSettings': {
      try {
        await updateSettings(msg.settings as SettingsPatch);
        scheduleRefresh(context);
        scheduleRotation();
        applyStatusBarText();
        pushViewModel(context);
        vscode.window.showInformationMessage('Cockpit settings saved.');
      } catch (err: any) {
        vscode.window.showErrorMessage(err?.message ?? String(err));
        postError(err?.message ?? String(err));
      }
      break;
    }
    case 'renameModel': {
      const prefs = loadPreferences(context);
      if (msg.alias) prefs.modelAliases[msg.modelId] = msg.alias;
      else delete prefs.modelAliases[msg.modelId];
      await savePreferences(context, prefs);
      pushViewModel(context);
      applyStatusBarText();
      break;
    }
    case 'togglePin': {
      const prefs = loadPreferences(context);
      const idx = prefs.pinnedModelIds.indexOf(msg.modelId);
      if (idx >= 0) prefs.pinnedModelIds.splice(idx, 1);
      else prefs.pinnedModelIds = [msg.modelId, ...prefs.pinnedModelIds.filter((id) => id !== msg.modelId)];
      await savePreferences(context, prefs);
      pushViewModel(context);
      applyStatusBarText();
      break;
    }
    case 'exportCsv':
      await exportUsage('csv');
      break;
    case 'exportJson':
      await exportUsage('json');
      break;
    case 'exportMarkdown':
      await exportUsage('markdown');
      break;
    case 'copyReport':
      await copyUsageReport();
      break;
    case 'openIssues':
      await vscode.env.openExternal(vscode.Uri.parse(ISSUES_URL));
      break;
  }
};

async function openUsageView(
  context: vscode.ExtensionContext,
  forceMode?: 'dashboard' | 'quickpick'
) {
  if (!(await ensureUsage(context))) {
    showDashboardPanel(context, handleWebviewMessage);
    postError('No usage data yet. Click Refresh after signing into Cursor.');
    return;
  }

  const settings = loadSettings();
  const mode = forceMode ?? settings.displayMode;
  const vm = pushViewModel(context) ?? lastVm!;

  if (mode === 'quickpick') {
    showUsageQuickPick(vm, {
      onRefresh: () => refresh(context),
      onOpenDashboard: async () => {
        await updateSettings({ displayMode: 'dashboard' });
        showDashboardPanel(context, handleWebviewMessage, pushViewModel(context));
      },
    });
    return;
  }

  showDashboardPanel(context, handleWebviewMessage, vm);
}

export function deactivate() {
  if (timer) clearInterval(timer);
  if (rotateTimer) clearInterval(rotateTimer);
}
