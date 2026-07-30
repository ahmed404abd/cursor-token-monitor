import * as vscode from 'vscode';
import { readCursorAuth, CursorAuthData } from './dbReader';
import { fetchUsage, UsageSnapshot } from './cursorApi';
import {
  buildUsageInsights,
  centsToDollars,
  estimateAutoModels,
  formatStatusBarText,
  usageHealth,
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
  loadHistory,
  longestSessions,
  mergeDailySpend,
  recordDailySnapshot,
  resetHistory,
  summarizeSpend,
} from './historyStore';
import { ensureSessionBaseline, getSessionStats } from './sessionTracker';
import { checkUsageAlerts } from './alerts';
import { buildDashboardHtml } from './dashboard';

const ISSUES_URL = 'https://github.com/ahmed404abd/cursor-token-monitor/issues';

let statusBarItem: vscode.StatusBarItem;
let timer: ReturnType<typeof setInterval> | undefined;
let rotateTimer: ReturnType<typeof setInterval> | undefined;
let rotateIndex = 0;
let lastAuth: CursorAuthData | undefined;
let lastUsage: UsageSnapshot | undefined;
let lastUpdated: Date | undefined;
let lastProjects: ProjectUsageRecord[] = [];
let extensionContext: vscode.ExtensionContext | undefined;
let dashboardPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'cursorTokenMonitor.openDashboard';
  statusBarItem.text = '$(sync~spin) Cursor usage';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const cmds: [string, (...args: any[]) => any][] = [
    ['cursorTokenMonitor.refresh', () => refresh(context)],
    ['cursorTokenMonitor.showDetails', () => showDetails()],
    ['cursorTokenMonitor.openDashboard', () => showDetails()],
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
      if (e.affectsConfiguration('cursorTokenMonitor.statusBarMode')) {
        scheduleRotation();
        applyStatusBarText();
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
  const seconds = vscode.workspace
    .getConfiguration('cursorTokenMonitor')
    .get<number>('refreshIntervalSeconds', 60);
  timer = setInterval(() => refresh(context), Math.max(15, seconds) * 1000);
}

async function refresh(context: vscode.ExtensionContext) {
  try {
    statusBarItem.text = '$(sync~spin) Cursor usage';
    const auth = await readCursorAuth(context);
    lastAuth = auth;
    lastUsage = await fetchUsage(auth);
    lastUpdated = new Date();
    lastProjects = updateProjectUsage(context, lastUsage);
    recordDailySnapshot(context, lastUsage);
    ensureSessionBaseline(lastUsage);
    checkUsageAlerts(context, lastUsage, computeDailySpend(lastUsage));
    statusBarItem.command = 'cursorTokenMonitor.openDashboard';

    applyStatusBarText();
    statusBarItem.tooltip = buildTooltip(auth, lastUsage);
    statusBarItem.backgroundColor = warningColor(lastUsage);
    if (dashboardPanel) renderDashboard(dashboardPanel);
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

    if (issue === 'python' || issue === 'auth' || issue === 'database') {
      void showSetupGuide(issue, message);
    }
  }
}

function computeDailySpend(usage: UsageSnapshot): DaySpend[] {
  const history = extensionContext ? loadHistory(extensionContext) : [];
  return mergeDailySpend(
    buildDailySpendFromEvents(usage, 30),
    buildDailySpendFromHistory(history, 30),
    30
  );
}

function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

/** Alternate status bar texts when statusBarMode is "rotate". */
function statusBarVariants(usage: UsageSnapshot): string[] {
  const variants = [formatStatusBarText(usage)];
  const topModel = (usage.modelUsage ?? [])
    .slice()
    .sort((a, b) => b.chargedCents - a.chargedCents)[0];
  if (topModel) {
    variants.push(`$(zap) ${topModel.label} ${centsToDollars(topModel.chargedCents)}`);
  }
  const tokens = (usage.totalInputTokens ?? 0) + (usage.totalOutputTokens ?? 0);
  if (tokens > 0) {
    variants.push(`$(zap) ${compactTokens(tokens)} tokens`);
  }
  return variants;
}

function applyStatusBarText() {
  if (!lastUsage) return;
  const mode = vscode.workspace
    .getConfiguration('cursorTokenMonitor')
    .get<string>('statusBarMode', 'spend');
  if (mode !== 'rotate') {
    statusBarItem.text = formatStatusBarText(lastUsage);
    return;
  }
  const variants = statusBarVariants(lastUsage);
  statusBarItem.text = variants[rotateIndex % variants.length];
}

function scheduleRotation() {
  if (rotateTimer) {
    clearInterval(rotateTimer);
    rotateTimer = undefined;
  }
  const mode = vscode.workspace
    .getConfiguration('cursorTokenMonitor')
    .get<string>('statusBarMode', 'spend');
  if (mode !== 'rotate') return;
  rotateTimer = setInterval(() => {
    rotateIndex += 1;
    applyStatusBarText();
  }, 8000);
}

function warningColor(usage: UsageSnapshot): vscode.ThemeColor | undefined {
  const health = usageHealth(usage);
  if (health === 'critical') {
    return new vscode.ThemeColor('statusBarItem.errorBackground');
  }
  if (health === 'warning') {
    return new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  return undefined;
}

function buildTooltip(auth: CursorAuthData, usage: UsageSnapshot): string {
  const insights = buildUsageInsights(usage);
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
    'Click for usage dashboard',
  ].filter((l): l is string => l !== undefined);
  return lines.join('\n');
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
  lastUsage = undefined;
  lastAuth = undefined;
  lastUpdated = undefined;
  vscode.window.showInformationMessage('Local usage cache & history cleared. Refreshing…');
  await refresh(context);
}

async function checkConnection(context: vscode.ExtensionContext) {
  try {
    statusBarItem.text = '$(sync~spin) Checking…';
    const auth = await readCursorAuth(context);
    const usage = await fetchUsage(auth);
    lastAuth = auth;
    lastUsage = usage;
    lastUpdated = new Date();
    lastProjects = updateProjectUsage(context, usage);
    recordDailySnapshot(context, usage);
    ensureSessionBaseline(usage);
    statusBarItem.text = formatStatusBarText(usage);
    statusBarItem.tooltip = buildTooltip(auth, usage);
    statusBarItem.backgroundColor = warningColor(usage);
    statusBarItem.command = 'cursorTokenMonitor.openDashboard';
    if (dashboardPanel) renderDashboard(dashboardPanel);
    vscode.window.showInformationMessage(
      `Connected. Plan ${usage.planName ?? auth.membershipType ?? 'unknown'} · ${formatStatusBarText(usage).replace(/\$\([^)]+\)\s*/, '')}`
    );
  } catch (err: any) {
    const message = err?.message ?? String(err);
    const issue = classifySetupError(message);
    await showSetupGuide(issue, message);
  }
}

function showDetails() {
  if (dashboardPanel) {
    dashboardPanel.reveal(vscode.ViewColumn.Beside);
    renderDashboard(dashboardPanel);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'cursorTokenMonitorDetails',
    'Cursor Usage',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  dashboardPanel = panel;
  panel.onDidDispose(() => {
    dashboardPanel = undefined;
  });

  panel.webview.onDidReceiveMessage(async (msg) => {
    switch (msg?.type) {
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
      case 'refresh':
        if (extensionContext) await refresh(extensionContext);
        break;
      case 'openIssues':
        await vscode.env.openExternal(vscode.Uri.parse(ISSUES_URL));
        break;
    }
  });

  renderDashboard(panel);
}

function renderDashboard(panel: vscode.WebviewPanel) {
  if (!lastUsage) {
    panel.webview.html = `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:24px;color:var(--vscode-foreground)">
      <h2>No usage data yet</h2>
      <p>Run <strong>Cursor Token Monitor: Refresh Usage</strong> or click Refresh in the toolbar after data loads.</p>
      <p><a href="${ISSUES_URL}">Report an issue on GitHub</a></p>
    </body></html>`;
    return;
  }

  const ctx = extensionContext;
  const history = ctx ? loadHistory(ctx) : [];
  const projects =
    lastProjects.length > 0 ? lastProjects : ctx ? loadProjectRecords(ctx) : [];
  const dailySpend = computeDailySpend(lastUsage);

  const nonce = String(Date.now()) + Math.random().toString(36).slice(2);
  panel.webview.html = buildDashboardHtml(
    {
      auth: lastAuth,
      usage: lastUsage,
      projects,
      dailySpend,
      history,
      sessions: longestSessions(lastUsage, 5),
      spendSummary: summarizeSpend(dailySpend),
      session: getSessionStats(lastUsage),
      updated: lastUpdated,
    },
    nonce,
    panel.webview.cspSource
  );
}

export function deactivate() {
  if (timer) clearInterval(timer);
  if (rotateTimer) clearInterval(rotateTimer);
}
