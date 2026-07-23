import * as vscode from 'vscode';
import { readCursorAuth, CursorAuthData } from './dbReader';
import { fetchUsage, UsageSnapshot, displayModelName } from './cursorApi';

let statusBarItem: vscode.StatusBarItem;
let timer: ReturnType<typeof setInterval> | undefined;
let lastAuth: CursorAuthData | undefined;
let lastUsage: UsageSnapshot | undefined;
let lastUpdated: Date | undefined;

export function activate(context: vscode.ExtensionContext) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'cursorTokenMonitor.showDetails';
  statusBarItem.text = '$(sync~spin) Cursor usage';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorTokenMonitor.refresh', () => refresh(context))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorTokenMonitor.showDetails', () => showDetails())
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('cursorTokenMonitor.refreshIntervalSeconds')) {
        scheduleRefresh(context);
      }
    })
  );

  refresh(context);
  scheduleRefresh(context);
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

    statusBarItem.text = formatStatusBarText(lastUsage);
    statusBarItem.tooltip = buildTooltip(auth, lastUsage);
    statusBarItem.backgroundColor = warningColor(lastUsage);
  } catch (err: any) {
    statusBarItem.text = '$(warning) Cursor usage';
    statusBarItem.tooltip = `Failed to fetch Cursor usage:\n${err.message}`;
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
}

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function usedPercent(usage: UsageSnapshot): number | undefined {
  const plan = usage.planUsage;
  if (plan && plan.limit > 0) {
    return (plan.includedSpend / plan.limit) * 100;
  }
  return undefined;
}

function formatPercent(value?: number): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(value < 10 ? 1 : 0)}%`;
}

function formatStatusBarText(usage: UsageSnapshot): string {
  if (usage.planUsage && usage.planUsage.limit > 0) {
    const used = centsToDollars(usage.planUsage.includedSpend);
    const limit = centsToDollars(usage.planUsage.limit);
    const pct = formatPercent(usedPercent(usage));
    return `$(zap) ${used}/${limit} · ${pct}`;
  }

  const legacy = usage.raw.legacy as any;
  if (legacy && typeof legacy === 'object') {
    const bucket = legacy.premiumRequests ?? legacy['gpt-4'];
    if (bucket && typeof bucket === 'object') {
      const used = bucket.numRequests ?? bucket.used;
      const max = bucket.maxRequestUsage ?? bucket.limit;
      if (used !== undefined) {
        return `$(zap) ${used}${max !== undefined ? '/' + max : ''} req`;
      }
    }
  }

  return '$(zap) Cursor usage';
}

function warningColor(usage: UsageSnapshot): vscode.ThemeColor | undefined {
  const pct = usedPercent(usage);
  if (pct === undefined) return undefined;
  if (pct >= 90) {
    return new vscode.ThemeColor('statusBarItem.errorBackground');
  }
  if (pct >= 75) {
    return new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  return undefined;
}

function buildTooltip(auth: CursorAuthData, usage: UsageSnapshot): string {
  const lines = [
    auth.email ? `Account: ${auth.email}` : undefined,
    auth.membershipType || usage.planName
      ? `Plan: ${usage.planName ?? auth.membershipType}${usage.planPrice ? ` (${usage.planPrice})` : ''}`
      : undefined,
    usage.planUsage
      ? `Used: ${centsToDollars(usage.planUsage.includedSpend)} / ${centsToDollars(usage.planUsage.limit)}`
      : undefined,
    usage.planUsage ? `Remaining: ${centsToDollars(usage.planUsage.remaining)}` : undefined,
    usage.totalEventsThisPeriod !== undefined
      ? `Events this period: ${usage.totalEventsThisPeriod}`
      : undefined,
    usage.modelUsage.length
      ? `Models: ${usage.modelUsage.map((m) => m.label).join(', ')}`
      : undefined,
    usage.chats.length ? `Chats: ${usage.chats.length}` : undefined,
    lastUpdated ? `Updated: ${lastUpdated.toLocaleTimeString()}` : undefined,
    '',
    'Click for full details',
  ].filter((l): l is string => l !== undefined);
  return lines.join('\n');
}

function formatDateMs(ms?: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatCycleRange(start?: number, end?: number): string {
  if (!start || !end) return '—';
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  return `${new Date(start).toLocaleDateString(undefined, opts)} – ${new Date(end).toLocaleDateString(undefined, opts)}`;
}

function formatTokens(n?: number): string {
  if (n === undefined) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function kindLabel(kind?: string): string {
  if (!kind) return 'other';
  const cleaned = kind.replace(/^USAGE_EVENT_KIND_/, '').replace(/_/g, ' ').toLowerCase();
  if (cleaned.includes('included')) return 'included';
  if (cleaned.includes('usage based')) return 'on-demand';
  if (cleaned.includes('errored')) return 'error';
  return cleaned;
}

function kindClass(kind?: string): string {
  const label = kindLabel(kind);
  if (label === 'included') return 'badge badge--ok';
  if (label === 'on-demand') return 'badge badge--warn';
  if (label === 'error') return 'badge badge--err';
  return 'badge';
}

function progressTone(pct?: number): string {
  if (pct === undefined) return 'tone-ok';
  if (pct >= 90) return 'tone-err';
  if (pct >= 75) return 'tone-warn';
  return 'tone-ok';
}

function showDetails() {
  const panel = vscode.window.createWebviewPanel(
    'cursorTokenMonitorDetails',
    'Cursor Usage',
    vscode.ViewColumn.Beside,
    { enableScripts: false }
  );
  panel.webview.html = buildDetailsHtml();
}

function emptyState(): string {
  return wrapHtml(`
    <section class="hero hero--empty">
      <div class="eyebrow">Cursor Token Monitor</div>
      <h1>No usage data yet</h1>
      <p class="lede">Run <strong>Cursor Token Monitor: Refresh Usage</strong> from the Command Palette, then open this panel again.</p>
    </section>
  `);
}

function buildDetailsHtml(): string {
  const usage = lastUsage;
  if (!usage) return emptyState();

  const plan = usage.planUsage;
  const pct = usedPercent(usage) ?? 0;
  const pctClamped = Math.max(0, Math.min(100, pct));
  const tone = progressTone(usedPercent(usage));
  const planName = usage.planName ?? lastAuth?.membershipType ?? 'Cursor';
  const planPrice = usage.planPrice ? ` · ${usage.planPrice}` : '';

  const modelUsage = usage.modelUsage ?? [];
  const maxModelSpend = Math.max(...modelUsage.map((m) => m.chargedCents), 1);
  const modelCards = modelUsage
    .map((m) => {
      const share = Math.max(4, (m.chargedCents / maxModelSpend) * 100);
      const poolNote =
        m.isAuto && usage.autoBucketModels.length
          ? `<div class="model-card__pool">Auto can route to: ${usage.autoBucketModels
              .slice(0, 8)
              .map((id) => escapeHtml(displayModelName(id)))
              .join(', ')}${usage.autoBucketModels.length > 8 ? '…' : ''}</div>`
          : '';
      return `<article class="model-card ${m.isAuto ? 'model-card--auto' : ''}">
        <div class="model-card__top">
          <div>
            <div class="model-card__name">${escapeHtml(m.label)}</div>
            <div class="model-card__id">${escapeHtml(m.modelId)}${m.isAuto ? ' · mode' : ''}</div>
          </div>
          <div class="model-card__cost">${escapeHtml(centsToDollars(m.chargedCents))}</div>
        </div>
        <div class="bar"><span style="width:${share.toFixed(1)}%"></span></div>
        <div class="model-card__stats">
          <span><strong>${m.eventCount}</strong> events</span>
          <span><strong>${m.requestUnits.toFixed(1)}</strong> req units</span>
          <span><strong>${escapeHtml(formatTokens(m.inputTokens + m.outputTokens))}</strong> tokens</span>
        </div>
        ${poolNote}
      </article>`;
    })
    .join('');

  const modelRows = modelUsage
    .map((m) => {
      const share = Math.min(100, (m.chargedCents / maxModelSpend) * 100);
      return `<tr>
        <td>
          <div class="cell-title">${escapeHtml(m.label)}${m.isAuto ? ' <span class="badge badge--ok">mode</span>' : ''}</div>
          <div class="cell-sub">${escapeHtml(m.modelId)}</div>
          <div class="bar"><span style="width:${share.toFixed(1)}%"></span></div>
        </td>
        <td class="num strong">${escapeHtml(centsToDollars(m.chargedCents))}</td>
        <td class="num">${m.eventCount}</td>
        <td class="num">${escapeHtml(formatTokens(m.inputTokens))}</td>
        <td class="num">${escapeHtml(formatTokens(m.outputTokens))}</td>
        <td class="num">${escapeHtml(formatTokens(m.cacheReadTokens))}</td>
      </tr>`;
    })
    .join('');

  const chatRows = usage.chats
    .map(
      (c) => `<tr>
      <td>
        <div class="cell-title">Chat ${escapeHtml(shortId(c.conversationId))}</div>
        <div class="cell-sub">${escapeHtml(formatDateMs(c.lastTimestampMs))}</div>
      </td>
      <td class="num strong">${c.eventCount}</td>
      <td class="num">${escapeHtml(centsToDollars(c.chargedCents))}</td>
      <td class="num">${c.requestUnits.toFixed(1)}</td>
      <td class="num">${escapeHtml(formatTokens(c.inputTokens + c.outputTokens))}</td>
      <td><div class="pills">${c.models.map((m) => `<span class="pill">${escapeHtml(displayModelName(m))}</span>`).join('') || '—'}</div></td>
    </tr>`
    )
    .join('');

  const eventRows = usage.recentEvents
    .map(
      (e) => `<tr>
      <td>
        <div class="cell-title">${escapeHtml(formatDateMs(Number(e.timestamp)))}</div>
        <div class="cell-sub">${escapeHtml(shortId(e.conversationId ?? '—'))}</div>
      </td>
      <td><span class="pill">${escapeHtml(displayModelName(e.model))}</span></td>
      <td><span class="${kindClass(e.kind)}">${escapeHtml(kindLabel(e.kind))}</span></td>
      <td class="num strong">${escapeHtml(centsToDollars(e.chargedCents ?? 0))}</td>
      <td class="num">${(e.requestsCosts ?? 0).toFixed(1)}</td>
      <td class="num">${escapeHtml(formatTokens(e.tokenUsage?.inputTokens))}</td>
      <td class="num">${escapeHtml(formatTokens(e.tokenUsage?.outputTokens))}</td>
    </tr>`
    )
    .join('');

  const body = `
  <header class="hero">
    <div class="hero__top">
      <div>
        <div class="eyebrow">Cursor Token Monitor</div>
        <h1>Usage overview</h1>
        <p class="lede">${escapeHtml(lastAuth?.email ?? 'Signed-in account')} · <span class="plan-chip">${escapeHtml(planName)}${escapeHtml(planPrice)}</span></p>
      </div>
      <div class="hero__meta">
        <div class="meta-label">Billing cycle</div>
        <div class="meta-value">${escapeHtml(formatCycleRange(usage.billingCycleStartMs, usage.billingCycleEndMs))}</div>
        <div class="meta-label">Updated</div>
        <div class="meta-value">${escapeHtml(lastUpdated ? lastUpdated.toLocaleTimeString() : '—')}</div>
      </div>
    </div>

    <div class="usage-panel ${tone}">
      <div class="usage-panel__main">
        <div class="usage-amount">
          <span class="usage-amount__used">${plan ? escapeHtml(centsToDollars(plan.includedSpend)) : '—'}</span>
          <span class="usage-amount__sep">/</span>
          <span class="usage-amount__limit">${plan ? escapeHtml(centsToDollars(plan.limit)) : '—'}</span>
        </div>
        <div class="usage-caption">Included allowance used this period</div>
        <div class="progress" aria-hidden="true">
          <div class="progress__fill" style="width:${pctClamped.toFixed(2)}%"></div>
        </div>
        <div class="usage-footer">
          <span>${escapeHtml(formatPercent(usedPercent(usage)))} used</span>
          <span>${plan ? escapeHtml(centsToDollars(plan.remaining)) + ' remaining' : ''}</span>
        </div>
      </div>
      <div class="usage-panel__note">
        ${escapeHtml(usage.displayMessage || 'Usage is billed against your included monthly allowance.')}
      </div>
    </div>
  </header>

  <section class="stats">
    <article class="stat">
      <div class="stat__label">Events</div>
      <div class="stat__value">${escapeHtml(String(usage.totalEventsThisPeriod ?? 0))}</div>
      <div class="stat__hint">API calls this period</div>
    </article>
    <article class="stat">
      <div class="stat__label">Chats</div>
      <div class="stat__value">${usage.chats.length}</div>
      <div class="stat__hint">Active conversations</div>
    </article>
    <article class="stat">
      <div class="stat__label">Tokens in</div>
      <div class="stat__value">${escapeHtml(formatTokens(usage.totalInputTokens))}</div>
      <div class="stat__hint">Prompt / context</div>
    </article>
    <article class="stat">
      <div class="stat__label">Tokens out</div>
      <div class="stat__value">${escapeHtml(formatTokens(usage.totalOutputTokens))}</div>
      <div class="stat__hint">Model responses</div>
    </article>
  </section>

  <section class="section">
    <div class="section__head">
      <h2>Models used</h2>
      <p>What ran this billing period. Auto is shown as a mode — Cursor’s API does not reveal which specific model Auto picked for each turn.</p>
    </div>
    ${
      modelCards
        ? `<div class="model-grid">${modelCards}</div>`
        : '<p class="empty">No model usage in this period yet.</p>'
    }
  </section>

  <section class="section">
    <div class="section__head">
      <h2>By model</h2>
      <p>Spend, events, and tokens</p>
    </div>
    ${
      modelRows
        ? `<div class="table-wrap"><table>
      <thead><tr><th>Model</th><th class="num">Cost</th><th class="num">Events</th><th class="num">Input</th><th class="num">Output</th><th class="num">Cache</th></tr></thead>
      <tbody>${modelRows}</tbody>
    </table></div>`
        : '<p class="empty">No model usage in this period yet.</p>'
    }
  </section>

  <section class="section">
    <div class="section__head">
      <h2>Per chat</h2>
      <p>Event count is API calls inside a chat (tools & steps), not just messages you typed</p>
    </div>
    ${
      chatRows
        ? `<div class="table-wrap"><table>
      <thead><tr><th>Conversation</th><th class="num">Events</th><th class="num">Charged</th><th class="num">Req units</th><th class="num">Tokens</th><th>Models</th></tr></thead>
      <tbody>${chatRows}</tbody>
    </table></div>`
        : '<p class="empty">No chat activity in this period yet.</p>'
    }
  </section>

  <section class="section">
    <div class="section__head">
      <h2>Recent activity</h2>
      <p>Latest billed events from Cursor</p>
    </div>
    ${
      eventRows
        ? `<div class="table-wrap"><table>
      <thead><tr><th>When</th><th>Model</th><th>Type</th><th class="num">Charged</th><th class="num">Req</th><th class="num">In</th><th class="num">Out</th></tr></thead>
      <tbody>${eventRows}</tbody>
    </table></div>`
        : '<p class="empty">No recent events.</p>'
    }
  </section>
  `;

  return wrapHtml(body);
}

function wrapHtml(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-foreground);
    --muted: var(--vscode-descriptionForeground);
    --border: var(--vscode-widget-border, color-mix(in srgb, var(--fg) 14%, transparent));
    --panel: color-mix(in srgb, var(--vscode-textCodeBlock-background) 88%, var(--bg));
    --accent: var(--vscode-button-background, #3b82f6);
    --accent-fg: var(--vscode-button-foreground, #fff);
    --ok: #22c55e;
    --warn: #f59e0b;
    --err: #ef4444;
    --radius: 14px;
    --shadow: 0 10px 30px color-mix(in srgb, #000 18%, transparent);
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    padding: 24px 28px 48px;
    font-family: var(--vscode-font-family);
    color: var(--fg);
    background:
      radial-gradient(1200px 480px at 10% -10%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 60%),
      radial-gradient(900px 420px at 100% 0%, color-mix(in srgb, var(--ok) 10%, transparent), transparent 55%),
      var(--bg);
    line-height: 1.45;
  }

  .hero {
    background: linear-gradient(180deg, color-mix(in srgb, var(--panel) 92%, transparent), var(--panel));
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) + 4px);
    padding: 22px 24px 20px;
    box-shadow: var(--shadow);
  }

  .hero--empty { max-width: 560px; }

  .hero__top {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    flex-wrap: wrap;
    margin-bottom: 18px;
  }

  .eyebrow {
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 8px;
  }

  h1 {
    margin: 0;
    font-size: 28px;
    letter-spacing: -0.03em;
    font-weight: 650;
  }

  h2 {
    margin: 0;
    font-size: 16px;
    letter-spacing: -0.01em;
  }

  .lede {
    margin: 8px 0 0;
    color: var(--muted);
    font-size: 13px;
  }

  .plan-chip {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--fg);
    font-weight: 600;
  }

  .hero__meta {
    display: grid;
    grid-template-columns: auto auto;
    gap: 4px 14px;
    align-content: start;
    font-size: 12px;
  }

  .meta-label { color: var(--muted); }
  .meta-value { font-weight: 560; }

  .usage-panel {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 18px;
    padding: 16px;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    border: 1px solid var(--border);
  }

  @media (max-width: 720px) {
    .usage-panel { grid-template-columns: 1fr; }
    body { padding: 16px; }
  }

  .usage-amount {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 4px;
  }

  .usage-amount__used {
    font-size: 34px;
    font-weight: 700;
    letter-spacing: -0.04em;
  }

  .usage-amount__sep,
  .usage-amount__limit {
    color: var(--muted);
    font-size: 18px;
  }

  .usage-caption,
  .usage-footer,
  .stat__hint,
  .section__head p,
  .empty,
  .cell-sub {
    color: var(--muted);
    font-size: 12px;
  }

  .progress {
    margin: 12px 0 8px;
    height: 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--fg) 10%, transparent);
    overflow: hidden;
  }

  .progress__fill {
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--ok), color-mix(in srgb, var(--ok) 40%, var(--accent)));
    transition: width 0.35s ease;
  }

  .tone-warn .progress__fill {
    background: linear-gradient(90deg, var(--warn), #f97316);
  }

  .tone-err .progress__fill {
    background: linear-gradient(90deg, #f97316, var(--err));
  }

  .usage-footer {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  .usage-panel__note {
    display: flex;
    align-items: center;
    padding: 12px 14px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
    font-size: 13px;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin: 18px 0 8px;
  }

  @media (max-width: 900px) {
    .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }

  .stat {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px 16px;
  }

  .stat__label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }

  .stat__value {
    margin-top: 6px;
    font-size: 24px;
    font-weight: 650;
    letter-spacing: -0.03em;
  }

  .stat__hint { margin-top: 2px; }

  .section {
    margin-top: 28px;
  }

  .section__head {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }

  .table-wrap {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: auto;
    background: color-mix(in srgb, var(--panel) 80%, transparent);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }

  th, td {
    text-align: left;
    padding: 11px 12px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }

  tr:last-child td { border-bottom: none; }

  th {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    background: color-mix(in srgb, var(--bg) 40%, transparent);
    position: sticky;
    top: 0;
  }

  td.num, th.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .strong { font-weight: 650; }

  .cell-title { font-weight: 600; }
  .cell-sub { margin-top: 2px; }

  .bar {
    margin-top: 6px;
    height: 4px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--fg) 8%, transparent);
    overflow: hidden;
    max-width: 220px;
  }

  .bar > span {
    display: block;
    height: 100%;
    background: color-mix(in srgb, var(--accent) 80%, white);
  }

  .pills {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .pill, .badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    background: color-mix(in srgb, var(--fg) 8%, transparent);
    border: 1px solid var(--border);
    white-space: nowrap;
  }

  .badge--ok {
    background: color-mix(in srgb, var(--ok) 18%, transparent);
    border-color: color-mix(in srgb, var(--ok) 35%, transparent);
  }

  .badge--warn {
    background: color-mix(in srgb, var(--warn) 18%, transparent);
    border-color: color-mix(in srgb, var(--warn) 35%, transparent);
  }

  .badge--err {
    background: color-mix(in srgb, var(--err) 18%, transparent);
    border-color: color-mix(in srgb, var(--err) 35%, transparent);
  }

  .empty {
    padding: 18px;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
  }

  .model-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 12px;
  }

  .model-card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px 16px;
  }

  .model-card--auto {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--accent) 10%, var(--panel)),
      var(--panel)
    );
  }

  .model-card__top {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
  }

  .model-card__name {
    font-size: 16px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  .model-card__id {
    margin-top: 2px;
    font-size: 11px;
    color: var(--muted);
  }

  .model-card__cost {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.03em;
  }

  .model-card__stats {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 14px;
    margin-top: 10px;
    font-size: 12px;
    color: var(--muted);
  }

  .model-card__stats strong {
    color: var(--fg);
    font-weight: 650;
  }

  .model-card__pool {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--muted);
    line-height: 1.4;
  }
</style>
</head>
<body>${body}</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function deactivate() {
  if (timer) clearInterval(timer);
}
