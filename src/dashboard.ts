import { CursorAuthData } from './dbReader';
import { UsageSnapshot, displayModelName } from './cursorApi';
import {
  buildUsageInsights,
  centsToDollars,
  estimateAutoModels,
  formatPercent,
  usedPercent,
} from './usageIntelligence';
import { ProjectUsageRecord } from './projectTracker';
import {
  DaySpend,
  DailySnapshot,
  SessionStat,
  SpendSummary,
  formatDuration,
  topSpendingDays,
} from './historyStore';
import { SessionStats } from './sessionTracker';

const ISSUES_URL = 'https://github.com/ahmed404abd/cursor-token-monitor/issues';

export interface DashboardData {
  auth?: CursorAuthData;
  usage: UsageSnapshot;
  projects: ProjectUsageRecord[];
  dailySpend: DaySpend[];
  history: DailySnapshot[];
  sessions: SessionStat[];
  spendSummary: SpendSummary;
  session?: SessionStats;
  updated?: Date;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

/** SVG bar chart for a daily metric (spend or tokens) */
function barChartSvg(
  days: DaySpend[],
  metric: 'spend' | 'tokens' = 'spend',
  width = 640,
  height = 180
): string {
  if (!days.length) {
    return `<div class="empty">No daily history yet — keep the extension running to build trends.</div>`;
  }
  const valueOf = (d: DaySpend) =>
    metric === 'spend' ? d.chargedCents : d.inputTokens + d.outputTokens;
  const titleOf = (d: DaySpend) =>
    metric === 'spend'
      ? `${d.label}: ${centsToDollars(d.chargedCents)} · ${d.eventCount} events`
      : `${d.label}: ${formatTokens(d.inputTokens + d.outputTokens)} tokens (${formatTokens(d.inputTokens)} in / ${formatTokens(d.outputTokens)} out)`;
  const max = Math.max(...days.map(valueOf), 0.01);
  const padL = 36;
  const padB = 36;
  const padT = 12;
  const padR = 8;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const gap = 4;
  const barW = Math.max(4, (innerW - gap * (days.length - 1)) / days.length);

  const bars = days
    .map((d, i) => {
      const h = Math.max(2, (valueOf(d) / max) * innerH);
      const x = padL + i * (barW + gap);
      const y = padT + innerH - h;
      return `<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3">
        <title>${esc(titleOf(d))}</title>
      </rect>`;
    })
    .join('');

  // sparse x labels
  const labelStep = Math.max(1, Math.ceil(days.length / 8));
  const labels = days
    .map((d, i) => {
      if (i % labelStep !== 0 && i !== days.length - 1) return '';
      const x = padL + i * (barW + gap) + barW / 2;
      return `<text class="axis" x="${x.toFixed(1)}" y="${height - 10}" text-anchor="middle">${esc(d.label)}</text>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img" aria-label="Daily ${metric} chart">${bars}${labels}</svg>`;
}

/** SVG donut / pie for workspace comparison */
function pieChartSvg(projects: ProjectUsageRecord[], size = 200): string {
  const data = projects.filter((p) => p.chargedCents > 0).slice(0, 8);
  if (!data.length) {
    return `<div class="empty">Open a few workspaces while the extension is active to compare projects.</div>`;
  }
  const total = data.reduce((s, p) => s + p.chargedCents, 0) || 1;
  const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4', '#eb5e28', '#84cc16'];
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;
  const rInner = size * 0.22;

  let angle = -Math.PI / 2;
  const slices: string[] = [];
  data.forEach((p, i) => {
    const sweep = (p.chargedCents / total) * Math.PI * 2;
    const a1 = angle;
    const a2 = angle + sweep;
    angle = a2;
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy + r * Math.sin(a2);
    const xi1 = cx + rInner * Math.cos(a2);
    const yi1 = cy + rInner * Math.sin(a2);
    const xi2 = cx + rInner * Math.cos(a1);
    const yi2 = cy + rInner * Math.sin(a1);
    const large = sweep > Math.PI ? 1 : 0;
    const d = [
      `M ${x1} ${y1}`,
      `A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`,
      `L ${xi1} ${yi1}`,
      `A ${rInner} ${rInner} 0 ${large} 0 ${xi2} ${yi2}`,
      'Z',
    ].join(' ');
    slices.push(
      `<path d="${d}" fill="${colors[i % colors.length]}" opacity="0.92"><title>${esc(p.workspaceName)}: ${centsToDollars(p.chargedCents)}</title></path>`
    );
  });

  const legend = data
    .map(
      (p, i) =>
        `<div class="legend-item"><span class="swatch" style="background:${colors[i % colors.length]}"></span>${esc(p.workspaceName)} <strong>${centsToDollars(p.chargedCents)}</strong></div>`
    )
    .join('');

  return `<div class="pie-wrap">
    <svg viewBox="0 0 ${size} ${size}" class="pie" role="img" aria-label="Workspace spend pie">${slices.join('')}</svg>
    <div class="legend">${legend}</div>
  </div>`;
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

export function buildDashboardHtml(data: DashboardData, nonce: string, cspSource: string): string {
  const { usage, auth, projects, dailySpend, sessions, spendSummary, session, updated } = data;
  const plan = usage.planUsage;
  const pct = usedPercent(usage) ?? 0;
  const pctClamped = Math.max(0, Math.min(100, pct));
  const tone = pct >= 90 ? 'tone-err' : pct >= 75 ? 'tone-warn' : 'tone-ok';
  const insights = buildUsageInsights(usage);
  const autoEst = estimateAutoModels(usage);
  const topDays = topSpendingDays(dailySpend, 5);
  const planName = usage.planName ?? auth?.membershipType ?? 'Cursor';
  const planPrice = usage.planPrice ? ` · ${usage.planPrice}` : '';

  const dayList = dailySpend.length
    ? dailySpend
        .slice()
        .reverse()
        .slice(0, 14)
        .map(
          (d) =>
            `<div class="day-row"><span>${esc(d.label)}</span><strong>${esc(centsToDollars(d.chargedCents))}</strong></div>`
        )
        .join('')
    : '<div class="empty">No daily rows yet.</div>';

  const insightCards = insights
    .map(
      (i) => `<article class="insight insight--${i.level}">
      <div class="insight__title">${esc(i.title)}</div>
      <div class="insight__detail">${esc(i.detail)}</div>
    </article>`
    )
    .join('');

  const modelUsage = usage.modelUsage ?? [];
  const maxModelSpend = Math.max(...modelUsage.map((m) => m.chargedCents), 1);
  const totalModelSpend = modelUsage.reduce((s, m) => s + m.chargedCents, 0) || 1;
  const modelCards = modelUsage
    .map((m) => {
      const width = Math.max(4, (m.chargedCents / maxModelSpend) * 100);
      const share = (m.chargedCents / totalModelSpend) * 100;
      return `<article class="model-card ${m.isAuto ? 'model-card--auto' : ''}">
        <div class="model-card__top">
          <div>
            <div class="model-card__name">${esc(m.label)}</div>
            <div class="model-card__id">${esc(m.modelId)}</div>
          </div>
          <div class="model-card__cost">${esc(centsToDollars(m.chargedCents))}<div class="model-card__share">${share.toFixed(1)}% of spend</div></div>
        </div>
        <div class="bar"><span style="width:${width.toFixed(1)}%"></span></div>
        <div class="model-card__stats">
          <span><strong>${m.eventCount}</strong> events</span>
          <span><strong>${formatTokens(m.inputTokens)}</strong> in</span>
          <span><strong>${formatTokens(m.outputTokens)}</strong> out</span>
        </div>
      </article>`;
    })
    .join('');

  const summaryCards = `
    <article class="stat"><div class="stat__label">Today</div><div class="stat__value">${esc(centsToDollars(spendSummary.todayCents))}</div></article>
    <article class="stat"><div class="stat__label">Yesterday</div><div class="stat__value">${esc(centsToDollars(spendSummary.yesterdayCents))}</div></article>
    <article class="stat"><div class="stat__label">7-day average</div><div class="stat__value">${esc(centsToDollars(spendSummary.sevenDayAvgCents))}</div></article>
    <article class="stat"><div class="stat__label">7-day total</div><div class="stat__value">${esc(centsToDollars(spendSummary.sevenDayTotalCents))}</div></article>`;

  const sessionCards = session
    ? `
    <article class="stat"><div class="stat__label">Session started</div><div class="stat__value stat__value--sm">${esc(session.startedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}</div></article>
    <article class="stat"><div class="stat__label">Session requests</div><div class="stat__value">${session.events}</div></article>
    <article class="stat"><div class="stat__label">Session tokens</div><div class="stat__value">${esc(formatTokens(session.inputTokens + session.outputTokens))}</div></article>
    <article class="stat"><div class="stat__label">Session spend</div><div class="stat__value">${esc(centsToDollars(session.spendCents))}</div></article>`
    : '';

  const feedItems = usage.recentEvents
    .slice(0, 15)
    .map((e) => {
      const tokens = (e.tokenUsage?.inputTokens ?? 0) + (e.tokenUsage?.outputTokens ?? 0);
      return `<div class="feed-item">
        <span class="feed-item__time">${esc(formatDateMs(Number(e.timestamp)))}</span>
        <span class="pill">${esc(displayModelName(e.model))}</span>
        <span class="feed-item__tokens">${tokens ? `+${esc(formatTokens(tokens))} tokens` : ''}</span>
        <span class="feed-item__cost">${esc(centsToDollars(e.chargedCents ?? 0))}</span>
      </div>`;
    })
    .join('');

  const sessionRows = sessions
    .map(
      (s) => `<tr>
      <td><code>${esc(s.shortId)}</code></td>
      <td class="num">${esc(formatDuration(s.durationMs))}</td>
      <td class="num">${s.eventCount}</td>
      <td class="num">${esc(centsToDollars(s.chargedCents))}</td>
    </tr>`
    )
    .join('');

  const topDayRows = topDays
    .map(
      (d, i) => `<tr>
      <td>${i + 1}. ${esc(d.label)}</td>
      <td class="num strong">${esc(centsToDollars(d.chargedCents))}</td>
      <td class="num">${d.eventCount}</td>
    </tr>`
    )
    .join('');

  const chatRows = usage.chats
    .map(
      (c) => `<tr>
      <td>
        <div class="cell-title">Chat ${esc(shortId(c.conversationId))}</div>
        <div class="cell-sub">${esc(formatDateMs(c.lastTimestampMs))}</div>
      </td>
      <td class="num strong">${c.eventCount}</td>
      <td class="num">${esc(centsToDollars(c.chargedCents))}</td>
      <td class="num">${c.requestUnits.toFixed(1)}</td>
      <td><div class="pills">${c.models.map((m) => `<span class="pill">${esc(displayModelName(m))}</span>`).join('') || '—'}</div></td>
    </tr>`
    )
    .join('');

  const eventRows = usage.recentEvents
    .slice(0, 40)
    .map(
      (e) => `<tr>
      <td>${esc(formatDateMs(Number(e.timestamp)))}</td>
      <td><span class="pill">${esc(displayModelName(e.model))}</span></td>
      <td><span class="${kindClass(e.kind)}">${esc(kindLabel(e.kind))}</span></td>
      <td class="num strong">${esc(centsToDollars(e.chargedCents ?? 0))}</td>
      <td class="num">${esc(formatTokens(e.tokenUsage?.inputTokens))}</td>
      <td class="num">${esc(formatTokens(e.tokenUsage?.outputTokens))}</td>
    </tr>`
    )
    .join('');

  const csp = [
    `default-src 'none'`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${cspSource} https: data:`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-foreground);
    --muted: var(--vscode-descriptionForeground);
    --border: var(--vscode-widget-border, color-mix(in srgb, var(--fg) 14%, transparent));
    --panel: color-mix(in srgb, var(--vscode-textCodeBlock-background) 88%, var(--bg));
    --accent: var(--vscode-button-background, #3b82f6);
    --btn-bg: var(--vscode-button-background, #3b82f6);
    --btn-fg: var(--vscode-button-foreground, #fff);
    --ok: #22c55e; --warn: #f59e0b; --err: #ef4444;
    --radius: 14px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 20px 24px 48px;
    font-family: var(--vscode-font-family); color: var(--fg);
    background:
      radial-gradient(1000px 420px at 8% -8%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 55%),
      var(--bg);
    line-height: 1.45;
  }
  .toolbar {
    display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
    margin-bottom: 16px;
  }
  .toolbar .spacer { flex: 1; }
  button, .link-btn {
    appearance: none; border: 1px solid var(--border); border-radius: 999px;
    padding: 7px 14px; font: inherit; font-size: 12.5px; font-weight: 600;
    cursor: pointer; background: color-mix(in srgb, var(--fg) 6%, transparent); color: var(--fg);
  }
  button.primary { background: var(--btn-bg); color: var(--btn-fg); border-color: transparent; }
  button:hover, .link-btn:hover { filter: brightness(1.08); }
  a.link-btn { text-decoration: none; display: inline-flex; align-items: center; }
  .hero {
    background: linear-gradient(180deg, color-mix(in srgb, var(--panel) 92%, transparent), var(--panel));
    border: 1px solid var(--border); border-radius: 18px; padding: 20px 22px; margin-bottom: 8px;
  }
  .hero__top { display: flex; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-bottom: 14px; }
  .eyebrow { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
  h1 { margin: 0; font-size: 26px; letter-spacing: -.03em; }
  h2 { margin: 0; font-size: 15px; }
  .lede { margin: 6px 0 0; color: var(--muted); font-size: 13px; }
  .plan-chip { display: inline-block; padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 18%, transparent); font-weight: 600; }
  .hero__meta { display: grid; grid-template-columns: auto auto; gap: 4px 14px; font-size: 12px; }
  .meta-label { color: var(--muted); }
  .usage-panel {
    display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; padding: 14px;
    border-radius: 14px; background: color-mix(in srgb, var(--bg) 55%, transparent); border: 1px solid var(--border);
  }
  @media (max-width: 720px) { .usage-panel { grid-template-columns: 1fr; } }
  .usage-amount { display: flex; align-items: baseline; gap: 8px; }
  .usage-amount__used { font-size: 32px; font-weight: 700; letter-spacing: -.04em; }
  .usage-amount__sep, .usage-amount__limit { color: var(--muted); font-size: 17px; }
  .usage-caption, .usage-footer, .section__head p, .empty, .cell-sub, .muted { color: var(--muted); font-size: 12px; }
  .progress { margin: 10px 0 8px; height: 8px; border-radius: 999px; background: color-mix(in srgb, var(--fg) 10%, transparent); overflow: hidden; }
  .progress__fill { height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--ok), color-mix(in srgb, var(--ok) 40%, var(--accent))); }
  .tone-warn .progress__fill { background: linear-gradient(90deg, var(--warn), #f97316); }
  .tone-err .progress__fill { background: linear-gradient(90deg, #f97316, var(--err)); }
  .usage-footer { display: flex; justify-content: space-between; }
  .usage-panel__note { display: flex; align-items: center; padding: 12px; border-radius: 12px; background: color-mix(in srgb, var(--accent) 10%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent); font-size: 13px; }
  .section { margin-top: 26px; }
  .section__head { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
  .grid-2 { display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; }
  @media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr; } }
  .panel {
    background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px;
  }
  .chart { width: 100%; height: auto; display: block; }
  .chart .bar { fill: color-mix(in srgb, var(--accent) 75%, #60a5fa); }
  .chart .bar:hover { fill: var(--accent); }
  .chart .axis { fill: var(--muted); font-size: 9px; }
  .day-list { max-height: 280px; overflow: auto; }
  .day-row {
    display: flex; justify-content: space-between; padding: 7px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 80%, transparent); font-size: 13px;
  }
  .day-row:last-child { border-bottom: none; }
  .pie-wrap { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  .pie { width: 180px; height: 180px; }
  .legend { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; }
  .legend-item { display: flex; align-items: center; gap: 8px; }
  .swatch { width: 10px; height: 10px; border-radius: 999px; display: inline-block; }
  .insight-grid, .model-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
  .insight, .model-card, .stat, .auto-card {
    background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px;
  }
  .insight--info { border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); }
  .insight--warn { border-color: color-mix(in srgb, var(--warn) 45%, var(--border)); }
  .insight--alert { border-color: color-mix(in srgb, var(--err) 45%, var(--border)); }
  .insight__title { font-weight: 650; }
  .insight__detail { margin-top: 4px; font-size: 12.5px; color: var(--muted); }
  .stats { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; margin-top: 16px; }
  @media (max-width: 900px) { .stats { grid-template-columns: repeat(2, minmax(0,1fr)); } }
  .stat__label { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  .stat__value { margin-top: 4px; font-size: 22px; font-weight: 650; }
  .table-wrap { border: 1px solid var(--border); border-radius: var(--radius); overflow: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); }
  tr:last-child td { border-bottom: none; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); background: color-mix(in srgb, var(--bg) 40%, transparent); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .strong { font-weight: 650; }
  .cell-title { font-weight: 600; }
  .bar { margin-top: 6px; height: 4px; border-radius: 999px; background: color-mix(in srgb, var(--fg) 8%, transparent); overflow: hidden; }
  .bar > span { display: block; height: 100%; background: color-mix(in srgb, var(--accent) 80%, white); }
  .pills { display: flex; flex-wrap: wrap; gap: 4px; }
  .pill, .badge { display: inline-flex; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: color-mix(in srgb, var(--fg) 8%, transparent); border: 1px solid var(--border); }
  .badge--ok { background: color-mix(in srgb, var(--ok) 18%, transparent); }
  .badge--warn { background: color-mix(in srgb, var(--warn) 18%, transparent); }
  .badge--err { background: color-mix(in srgb, var(--err) 18%, transparent); }
  .model-card--auto { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
  .model-card__top { display: flex; justify-content: space-between; gap: 10px; }
  .model-card__name { font-weight: 650; }
  .model-card__id { font-size: 11px; color: var(--muted); }
  .model-card__cost { font-size: 17px; font-weight: 700; text-align: right; }
  .model-card__share { font-size: 11px; font-weight: 500; color: var(--muted); }
  .stat__value--sm { font-size: 16px; }
  .feed { display: flex; flex-direction: column; }
  .feed-item {
    display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: 12.5px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  }
  .feed-item:last-child { border-bottom: none; }
  .feed-item__time { color: var(--muted); min-width: 110px; }
  .feed-item__tokens { flex: 1; color: var(--muted); }
  .feed-item__cost { font-weight: 650; font-variant-numeric: tabular-nums; }
  .model-card__stats { display: flex; gap: 12px; margin-top: 8px; font-size: 12px; color: var(--muted); }
  .empty { padding: 14px; border: 1px dashed var(--border); border-radius: 12px; }
  details.fold {
    border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel); overflow: hidden;
  }
  details.fold > summary {
    cursor: pointer; list-style: none; padding: 14px 16px; font-weight: 650;
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
  }
  details.fold > summary::-webkit-details-marker { display: none; }
  details.fold > summary::after { content: '▸'; color: var(--muted); transition: transform .15s ease; }
  details.fold[open] > summary::after { transform: rotate(90deg); }
  details.fold .fold-body { padding: 0 12px 14px; border-top: 1px solid var(--border); }
  .summary-sub { font-weight: 500; color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
  <div class="toolbar">
    <button class="primary" id="btnExport">Export CSV</button>
    <button id="btnExportJson">Export JSON</button>
    <button id="btnExportMd">Export Markdown</button>
    <button id="btnCopy">Copy report</button>
    <button id="btnRefresh">Refresh</button>
    <div class="spacer"></div>
    <a class="link-btn" href="${ISSUES_URL}" id="btnIssues">Report issue on GitHub</a>
  </div>

  <header class="hero">
    <div class="hero__top">
      <div>
        <div class="eyebrow">Cursor Token Monitor</div>
        <h1>Usage dashboard</h1>
        <p class="lede">${esc(auth?.email ?? 'Signed-in account')} · <span class="plan-chip">${esc(planName)}${esc(planPrice)}</span></p>
      </div>
      <div class="hero__meta">
        <div class="meta-label">Billing cycle</div>
        <div class="meta-value">${esc(formatCycleRange(usage.billingCycleStartMs, usage.billingCycleEndMs))}</div>
        <div class="meta-label">Updated</div>
        <div class="meta-value">${esc(updated ? updated.toLocaleTimeString() : '—')}</div>
      </div>
    </div>
    <div class="usage-panel ${tone}">
      <div>
        <div class="usage-amount">
          <span class="usage-amount__used">${plan ? esc(centsToDollars(plan.includedSpend)) : '—'}</span>
          <span class="usage-amount__sep">/</span>
          <span class="usage-amount__limit">${plan ? esc(centsToDollars(plan.limit)) : '—'}</span>
        </div>
        <div class="usage-caption">Included allowance this period</div>
        <div class="progress"><div class="progress__fill" style="width:${pctClamped.toFixed(2)}%"></div></div>
        <div class="usage-footer">
          <span>${esc(formatPercent(usedPercent(usage)))} used</span>
          <span>${plan ? esc(centsToDollars(plan.remaining)) + ' left' : ''}</span>
        </div>
      </div>
      <div class="usage-panel__note">${esc(usage.displayMessage || 'Usage is billed against your included monthly allowance.')}</div>
    </div>
  </header>

  <section class="stats" style="margin-top:16px">
    ${summaryCards}
  </section>
  ${
    sessionCards
      ? `<section class="section">
    <div class="section__head"><h2>This session</h2><p>Usage since this editor window opened</p></div>
    <div class="stats" style="margin-top:0">${sessionCards}</div>
  </section>`
      : ''
  }

  <section class="section">
    <div class="section__head">
      <h2>Usage intelligence</h2>
      <p>Risk signals for this billing cycle — export from the toolbar above</p>
    </div>
    <div class="insight-grid">${insightCards || '<div class="empty">No insights yet.</div>'}</div>
  </section>

  <section class="section">
    <div class="section__head">
      <h2>Last 30 days</h2>
      <p>Daily spend from events + local snapshots (builds up over time)</p>
    </div>
    <div class="grid-2">
      <div class="panel">
        <div class="muted" style="margin-bottom:8px">Daily spend chart</div>
        ${barChartSvg(dailySpend, 'spend')}
      </div>
      <div class="panel">
        <div class="muted" style="margin-bottom:8px">Recent days</div>
        <div class="day-list">${dayList}</div>
      </div>
    </div>
    <div class="panel" style="margin-top:14px">
      <div class="muted" style="margin-bottom:8px">Daily tokens chart</div>
      ${barChartSvg(dailySpend, 'tokens')}
    </div>
  </section>

  <section class="section">
    <div class="section__head"><h2>Live activity</h2><p>Latest AI requests (refreshes with the polling interval)</p></div>
    <div class="panel feed">${feedItems || '<div class="empty">No recent activity.</div>'}</div>
  </section>

  <section class="section">
    <div class="section__head">
      <h2>Workspace comparison</h2>
      <p>Spend seen across projects (local cache)</p>
    </div>
    <div class="panel">${pieChartSvg(projects)}</div>
  </section>

  <section class="section">
    <div class="section__head"><h2>Top spending days</h2><p>Highest burn days in the chart window</p></div>
    ${
      topDayRows
        ? `<div class="table-wrap"><table><thead><tr><th>Day</th><th class="num">Spend</th><th class="num">Events</th></tr></thead><tbody>${topDayRows}</tbody></table></div>`
        : '<div class="empty">Not enough history yet.</div>'
    }
  </section>

  <section class="section">
    <div class="section__head"><h2>Longest AI sessions</h2><p>By conversation span in loaded events</p></div>
    ${
      sessionRows
        ? `<div class="table-wrap"><table><thead><tr><th>Chat</th><th class="num">Duration</th><th class="num">Events</th><th class="num">Charged</th></tr></thead><tbody>${sessionRows}</tbody></table></div>`
        : '<div class="empty">No sessions yet.</div>'
    }
  </section>

  <section class="section">
    <div class="section__head"><h2>Auto estimate</h2><p>Heuristic — Cursor does not expose the exact Auto model per turn</p></div>
    <div class="auto-card">
      <div><strong>${autoEst.autoEventCount}</strong> Auto events · confidence <strong>${esc(autoEst.confidence)}</strong></div>
      <div class="pills" style="margin-top:10px">${
        autoEst.likelyModels.map((m) => `<span class="pill">${esc(m)}</span>`).join('') || '—'
      }</div>
      <p class="cell-sub" style="margin-top:8px">${esc(autoEst.note)}</p>
    </div>
  </section>

  <section class="stats">
    <article class="stat"><div class="stat__label">Events</div><div class="stat__value">${esc(String(usage.totalEventsThisPeriod ?? 0))}</div></article>
    <article class="stat"><div class="stat__label">Chats</div><div class="stat__value">${usage.chats.length}</div></article>
    <article class="stat"><div class="stat__label">Tokens in</div><div class="stat__value">${esc(formatTokens(usage.totalInputTokens))}</div></article>
    <article class="stat"><div class="stat__label">Tokens out</div><div class="stat__value">${esc(formatTokens(usage.totalOutputTokens))}</div></article>
  </section>

  <section class="section">
    <div class="section__head"><h2>Models</h2><p>What ran this period</p></div>
    ${modelCards ? `<div class="model-grid">${modelCards}</div>` : '<div class="empty">No models yet.</div>'}
  </section>

  <section class="section">
    <details class="fold">
      <summary>
        <span>Per chat details <span class="summary-sub">${usage.chats.length} conversations — click to expand</span></span>
      </summary>
      <div class="fold-body">
        ${
          chatRows
            ? `<div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Conversation</th><th class="num">Events</th><th class="num">Charged</th><th class="num">Req</th><th>Models</th></tr></thead><tbody>${chatRows}</tbody></table></div>`
            : '<div class="empty" style="margin-top:12px">No chats.</div>'
        }
      </div>
    </details>
  </section>

  <section class="section">
    <details class="fold">
      <summary>
        <span>Recent events <span class="summary-sub">${Math.min(40, usage.recentEvents.length)} shown — click to expand</span></span>
      </summary>
      <div class="fold-body">
        ${
          eventRows
            ? `<div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>When</th><th>Model</th><th>Type</th><th class="num">Charged</th><th class="num">In</th><th class="num">Out</th></tr></thead><tbody>${eventRows}</tbody></table></div>`
            : '<div class="empty" style="margin-top:12px">No events.</div>'
        }
      </div>
    </details>
  </section>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.getElementById('btnExport')?.addEventListener('click', () => vscode.postMessage({ type: 'exportCsv' }));
  document.getElementById('btnExportJson')?.addEventListener('click', () => vscode.postMessage({ type: 'exportJson' }));
  document.getElementById('btnExportMd')?.addEventListener('click', () => vscode.postMessage({ type: 'exportMarkdown' }));
  document.getElementById('btnCopy')?.addEventListener('click', () => vscode.postMessage({ type: 'copyReport' }));
  document.getElementById('btnRefresh')?.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  document.getElementById('btnIssues')?.addEventListener('click', (e) => {
    e.preventDefault();
    vscode.postMessage({ type: 'openIssues' });
  });
</script>
</body>
</html>`;
}
