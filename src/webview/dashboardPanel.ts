import * as vscode from 'vscode';
import * as path from 'path';
import { CockpitViewModel } from './dashboardViewModel';

export type HostToWebviewMessage =
  | { type: 'usageUpdate'; data: CockpitViewModel }
  | { type: 'error'; message: string };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'reorder'; order: string[]; groupMode: 'model' | 'workspace' }
  | { type: 'resetOrder' }
  | { type: 'setGroupMode'; groupMode: 'model' | 'workspace' }
  | { type: 'updateSettings'; settings: Record<string, unknown> }
  | { type: 'renameModel'; modelId: string; alias: string }
  | { type: 'togglePin'; modelId: string }
  | { type: 'exportCsv' }
  | { type: 'exportJson' }
  | { type: 'exportMarkdown' }
  | { type: 'copyReport' }
  | { type: 'openIssues' };

export type MessageHandler = (msg: WebviewToHostMessage) => void | Promise<void>;

let panel: vscode.WebviewPanel | undefined;
let lastVm: CockpitViewModel | undefined;

function nonce(): string {
  return `${Date.now()}${Math.random().toString(36).slice(2)}`;
}

function htmlShell(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  n: string
): string {
  const cssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'webview', 'dashboard.css')
  );
  const jsUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'webview', 'dashboard.js')
  );
  const sortableUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'vendor', 'Sortable.min.js')
  );
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource} 'nonce-${n}'`,
    `img-src ${webview.cspSource} https: data:`,
    `font-src ${webview.cspSource}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="${cssUri}" />
  <title>Cursor Token Cockpit</title>
</head>
<body>
  <div id="stateBanner" class="state-banner"></div>

  <div class="topbar">
    <div class="brand">
      <div class="brand__icon" aria-hidden="true">CT</div>
      <div>
        <div class="brand__title">Cursor Token Cockpit</div>
        <div class="brand__sub" id="groupLabel">Grouped by model</div>
      </div>
    </div>
    <div class="topbar__actions">
      <button type="button" class="primary" id="btnRefresh">Refresh</button>
      <button type="button" id="btnGroup">Group: Model</button>
      <button type="button" id="btnResetOrder">Reset Order</button>
      <button type="button" id="btnExportCsv">CSV</button>
      <button type="button" id="btnExportJson">JSON</button>
      <button type="button" id="btnExportMd">MD</button>
      <button type="button" id="btnCopy">Copy</button>
      <button type="button" id="btnSettings" title="Settings">Settings</button>
    </div>
  </div>

  <section class="plan-card">
    <div class="plan-card__top">
      <div class="ring-wrap">
        <svg viewBox="0 0 120 120" class="ring" aria-hidden="true">
          <circle class="ring-bg" cx="60" cy="60" r="52"></circle>
          <circle id="planRingFg" class="ring-fg" cx="60" cy="60" r="52"
            stroke-dasharray="326.7256" stroke-dashoffset="326.7256"></circle>
        </svg>
        <div class="ring-center">
          <div><strong id="planRingPct">0%</strong><span id="planRingCaption">used</span></div>
        </div>
      </div>
      <div class="plan-meta">
        <div class="eyebrow">Plan details</div>
        <h1><span id="accountEmail">—</span> <span class="plan-chip" id="planChip">—</span></h1>
        <p class="lede" id="planMessage">Loading usage…</p>
        <div class="quota-bars" id="quotaBars"></div>
      </div>
      <div class="plan-kpis">
        <div class="kpi"><div class="label">Other Models used</div><div class="value" id="usedLabel">—</div></div>
        <div class="kpi"><div class="label">Other Models limit</div><div class="value" id="limitLabel">—</div></div>
        <div class="kpi"><div class="label">API remaining</div><div class="value" id="remainingLabel">—</div></div>
        <div class="kpi"><div class="label">Billing cycle</div><div class="value" id="billingCycle">—</div></div>
        <div class="kpi"><div class="label">Reset in</div><div class="value" id="resetIn">—</div></div>
        <div class="kpi"><div class="label">Reset time</div><div class="value" id="resetTime">—</div></div>
        <div class="kpi"><div class="label">Updated</div><div class="value" id="updatedLabel">—</div></div>
      </div>
    </div>
    <details class="plan-more">
      <summary>Show more details</summary>
      <div class="stats" style="margin-top:12px">
        <article class="stat"><div class="stat__label">Today</div><div class="stat__value" id="todaySpend">—</div></article>
        <article class="stat"><div class="stat__label">Yesterday</div><div class="stat__value" id="yesterdaySpend">—</div></article>
        <article class="stat"><div class="stat__label">7-day avg</div><div class="stat__value" id="avg7Spend">—</div></article>
        <article class="stat"><div class="stat__label">7-day total</div><div class="stat__value" id="total7Spend">—</div></article>
      </div>
    </details>
  </section>

  <section class="section" id="sessionSection" style="display:none">
    <div class="section__head"><div><h2>This session</h2><p>Usage since this editor window opened</p></div></div>
    <div class="stats">
      <article class="stat"><div class="stat__label">Started</div><div class="stat__value" id="sessionStarted">—</div></article>
      <article class="stat"><div class="stat__label">Requests</div><div class="stat__value" id="sessionEvents">—</div></article>
      <article class="stat"><div class="stat__label">Tokens</div><div class="stat__value" id="sessionTokens">—</div></article>
      <article class="stat"><div class="stat__label">Spend</div><div class="stat__value" id="sessionSpend">—</div></article>
    </div>
  </section>

  <section class="section">
    <div class="section__head"><div><h2>Burn-rate forecast</h2><p>Projected included-pool usage for this billing cycle</p></div></div>
    <div class="panel forecast-panel" id="forecastPanel">
      <div class="forecast-headline" id="forecastHeadline">—</div>
      <div class="forecast-detail" id="forecastDetail">—</div>
      <div class="forecast-grid" id="forecastGrid"></div>
    </div>
  </section>

  <section class="section">
    <div class="section__head"><div><h2>Usage intelligence</h2><p>Risk signals for this billing cycle</p></div></div>
    <div class="insight-grid" id="insightGrid"></div>
  </section>

  <section class="section">
    <div class="section__head"><div><h2>Quota cards</h2><p>Drag to reorder · pin models to the status bar</p></div></div>
    <div class="card-grid" id="cardGrid"></div>
  </section>

  <section class="section">
    <div class="section__head"><div><h2>Trends</h2><p>Daily spend and tokens</p></div></div>
    <div class="grid-2">
      <div class="panel"><div class="eyebrow" style="margin-bottom:8px">Daily spend</div><div id="spendChart"></div></div>
      <div class="panel"><div class="eyebrow" style="margin-bottom:8px">Daily tokens</div><div id="tokenChart"></div></div>
    </div>
  </section>

  <section class="section">
    <div class="section__head heatmap-head">
      <div>
        <h2>90-day usage heatmap</h2>
        <p>Recent activity with allowance warning and critical overlays</p>
      </div>
      <label class="heatmap-filter">
        <span>Model</span>
        <select id="heatmapModel" aria-label="Filter heatmap by model">
          <option value="">All models</option>
        </select>
      </label>
    </div>
    <div class="panel heatmap-panel">
      <div class="heatmap-scroll">
        <div class="heatmap-weekdays" aria-hidden="true">
          <span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span>Sun</span>
        </div>
        <div>
          <div class="heatmap-months" id="heatmapMonths"></div>
          <div class="heatmap-grid" id="heatmapGrid" role="grid" aria-label="Daily AI usage over the last 90 days"></div>
        </div>
      </div>
      <div class="heatmap-footer">
        <span id="heatmapCoverage"></span>
        <div class="heatmap-legend" aria-label="Heatmap legend">
          <span>No history</span><i class="heatmap-cell unavailable"></i>
          <span>$0</span><i class="heatmap-cell zero"></i>
          <span>Less</span><i class="heatmap-cell level-1"></i><i class="heatmap-cell level-2"></i><i class="heatmap-cell level-3"></i><i class="heatmap-cell level-4"></i><span>More</span>
          <i class="heatmap-cell warning"></i><span>Warning</span>
          <i class="heatmap-cell critical"></i><span>Critical</span>
        </div>
      </div>
      <div class="heatmap-tooltip" id="heatmapTooltip" role="tooltip"></div>
    </div>
  </section>

  <section class="section">
    <div class="section__head"><div><h2>Live activity</h2><p>Latest billable requests</p></div></div>
    <div class="panel feed" id="activityFeed"></div>
  </section>

  <section class="section">
    <div class="section__head"><div><h2>Top spending days</h2></div></div>
    <div class="table-wrap"><table><thead><tr><th>Day</th><th class="num">Spend</th><th class="num">Events</th></tr></thead><tbody id="topDaysBody"></tbody></table></div>
  </section>

  <section class="section">
    <div class="section__head"><div><h2>Longest AI sessions</h2></div></div>
    <div class="table-wrap"><table><thead><tr><th>Chat</th><th class="num">Duration</th><th class="num">Events</th><th class="num">Charged</th></tr></thead><tbody id="sessionsBody"></tbody></table></div>
  </section>

  <section class="section">
    <div class="section__head"><div><h2>Auto estimate</h2><p>Heuristic only</p></div></div>
    <div class="panel" id="autoCard"></div>
  </section>

  <section class="stats">
    <article class="stat"><div class="stat__label">Events</div><div class="stat__value" id="totalEvents">—</div></article>
    <article class="stat"><div class="stat__label">Chats</div><div class="stat__value" id="totalChats">—</div></article>
    <article class="stat"><div class="stat__label">Tokens in</div><div class="stat__value" id="totalIn">—</div></article>
    <article class="stat"><div class="stat__label">Tokens out</div><div class="stat__value" id="totalOut">—</div></article>
  </section>

  <footer class="footer">
    <div>Enjoying this? Star the repo or report issues.</div>
    <a href="#" id="issuesLink">Report issue on GitHub</a>
  </footer>

  <div class="overlay" id="settingsOverlay">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
      <h2 id="settingsTitle">Cockpit settings</h2>
      <p>Status bar, alerts, and display preferences</p>
      <form id="settingsForm">
        <div class="form-row">
          <label for="statusBarFormat">Status bar format</label>
          <select id="statusBarFormat" name="statusBarFormat">
            <option value="icon">Icon only</option>
            <option value="dot">Dot only</option>
            <option value="percent">Percent only</option>
            <option value="dotPercent">Dot + percent</option>
            <option value="namePercent">Name + percent</option>
            <option value="full">Full</option>
          </select>
        </div>
        <div class="form-row">
          <label for="statusBarMode">Status bar mode</label>
          <select id="statusBarMode" name="statusBarMode">
            <option value="spend">Static</option>
            <option value="rotate">Rotate metrics</option>
          </select>
        </div>
        <div class="form-row check">
          <input type="checkbox" id="notificationsEnabled" name="notificationsEnabled" />
          <label for="notificationsEnabled">Enable usage notifications</label>
        </div>
        <div class="form-row">
          <label for="warningThreshold">Warning threshold (%)</label>
          <input type="number" id="warningThreshold" name="warningThreshold" min="1" max="99" />
        </div>
        <div class="form-row">
          <label for="criticalThreshold">Critical threshold (%)</label>
          <input type="number" id="criticalThreshold" name="criticalThreshold" min="2" max="100" />
        </div>
        <div class="form-row">
          <label for="viewMode">View mode</label>
          <select id="viewMode" name="viewMode">
            <option value="card">Card</option>
            <option value="list">List</option>
          </select>
        </div>
        <div class="form-row">
          <label for="displayMode">Display mode</label>
          <select id="displayMode" name="displayMode">
            <option value="dashboard">Dashboard webview</option>
            <option value="quickpick">QuickPick</option>
          </select>
        </div>
      </form>
      <div class="modal__actions">
        <button type="button" id="btnCloseSettings">Cancel</button>
        <button type="button" class="primary" id="btnSaveSettings">Save</button>
      </div>
    </div>
  </div>

  <script nonce="${n}" src="${sortableUri}"></script>
  <script nonce="${n}" src="${jsUri}"></script>
</body>
</html>`;
}

export function getDashboardPanel(): vscode.WebviewPanel | undefined {
  return panel;
}

export function postUsageUpdate(vm: CockpitViewModel): void {
  lastVm = vm;
  panel?.webview.postMessage({ type: 'usageUpdate', data: vm } satisfies HostToWebviewMessage);
}

export function postError(message: string): void {
  panel?.webview.postMessage({ type: 'error', message } satisfies HostToWebviewMessage);
}

export function showDashboardPanel(
  context: vscode.ExtensionContext,
  onMessage: MessageHandler,
  initialVm?: CockpitViewModel
): vscode.WebviewPanel {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside);
    if (initialVm || lastVm) {
      postUsageUpdate(initialVm ?? lastVm!);
    }
    return panel;
  }

  const created = vscode.window.createWebviewPanel(
    'cursorTokenMonitorCockpit',
    'Cursor Token Cockpit',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'media'),
      ],
    }
  );
  panel = created;

  created.webview.html = htmlShell(created.webview, context.extensionUri, nonce());

  created.onDidDispose(() => {
    panel = undefined;
  });

  created.webview.onDidReceiveMessage(async (msg: WebviewToHostMessage) => {
    await onMessage(msg);
  });

  if (initialVm || lastVm) {
    // slight delay so client script can attach listeners
    setTimeout(() => postUsageUpdate(initialVm ?? lastVm!), 50);
  }

  return created;
}

export function disposeDashboardPanel(): void {
  panel?.dispose();
  panel = undefined;
}

/** For diagnostics / packaging checks */
export function mediaPaths(extensionPath: string): string[] {
  return [
    path.join(extensionPath, 'media', 'webview', 'dashboard.css'),
    path.join(extensionPath, 'media', 'webview', 'dashboard.js'),
    path.join(extensionPath, 'media', 'vendor', 'Sortable.min.js'),
  ];
}
