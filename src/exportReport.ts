import * as vscode from 'vscode';
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

function csvEscape(value: string | number | undefined): string {
  const s = String(value ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildTextReport(
  auth: CursorAuthData | undefined,
  usage: UsageSnapshot,
  projects: ProjectUsageRecord[],
  updated?: Date
): string {
  const plan = usage.planUsage;
  const insights = buildUsageInsights(usage);
  const autoEst = estimateAutoModels(usage);

  const lines: string[] = [
    'Cursor Token Monitor — Usage Report',
    `Generated: ${(updated ?? new Date()).toLocaleString()}`,
    '',
    `Account: ${auth?.email ?? 'unknown'}`,
    `Plan: ${usage.planName ?? auth?.membershipType ?? 'unknown'}${usage.planPrice ? ` (${usage.planPrice})` : ''}`,
    '',
    '--- Summary ---',
    plan
      ? `Used: ${centsToDollars(plan.includedSpend)} / ${centsToDollars(plan.limit)} (${formatPercent(usedPercent(usage))})`
      : 'No plan usage data',
    plan ? `Remaining: ${centsToDollars(plan.remaining)}` : '',
    `Events this period: ${usage.totalEventsThisPeriod ?? 0}`,
    `Tokens in/out: ${usage.totalInputTokens ?? 0} / ${usage.totalOutputTokens ?? 0}`,
    '',
    '--- Usage intelligence ---',
    ...insights.map((i) => `[${i.level.toUpperCase()}] ${i.title}: ${i.detail}`),
    '',
    '--- Auto estimate ---',
    `Auto events: ${autoEst.autoEventCount}`,
    `Likely models (${autoEst.confidence} confidence): ${autoEst.likelyModels.join(', ') || '—'}`,
    autoEst.note,
    '',
    '--- Models ---',
    ...usage.modelUsage.map(
      (m) =>
        `${m.label} (${m.modelId}): ${centsToDollars(m.chargedCents)}, ${m.eventCount} events, ${m.requestUnits.toFixed(1)} req units`
    ),
    '',
    '--- Per project (last snapshot) ---',
    ...projects.map(
      (p) =>
        `${p.workspaceName}: ${centsToDollars(p.chargedCents)} event cost, ${p.eventCount} events, ${formatPercent(p.percentUsed)} plan used`
    ),
    '',
    '--- Recent events ---',
    ...usage.recentEvents.slice(0, 25).map((e) => {
      const when = e.timestamp ? new Date(Number(e.timestamp)).toLocaleString() : '—';
      return `${when} | ${displayModelName(e.model)} | ${centsToDollars(e.chargedCents ?? 0)} | chat ${e.conversationId?.slice(0, 8) ?? '—'}`;
    }),
  ];

  return lines.filter(Boolean).join('\n');
}

export function buildCsv(
  auth: CursorAuthData | undefined,
  usage: UsageSnapshot,
  projects: ProjectUsageRecord[]
): string {
  const rows: string[] = [];

  rows.push('section,key,value');
  rows.push(`summary,account,${csvEscape(auth?.email)}`);
  rows.push(`summary,plan,${csvEscape(usage.planName ?? auth?.membershipType)}`);
  if (usage.planUsage) {
    rows.push(`summary,used_cents,${usage.planUsage.includedSpend}`);
    rows.push(`summary,limit_cents,${usage.planUsage.limit}`);
    rows.push(`summary,remaining_cents,${usage.planUsage.remaining}`);
  }

  rows.push('');
  rows.push('model,model_id,label,events,charged_cents,request_units,input_tokens,output_tokens');
  for (const m of usage.modelUsage) {
    rows.push(
      [
        'model',
        csvEscape(m.modelId),
        csvEscape(m.label),
        m.eventCount,
        m.chargedCents.toFixed(4),
        m.requestUnits.toFixed(2),
        m.inputTokens,
        m.outputTokens,
      ].join(',')
    );
  }

  rows.push('');
  rows.push('project,name,path,events,charged_cents,percent_used,last_seen');
  for (const p of projects) {
    rows.push(
      [
        'project',
        csvEscape(p.workspaceName),
        csvEscape(p.workspacePath),
        p.eventCount,
        p.chargedCents.toFixed(4),
        p.percentUsed?.toFixed(2) ?? '',
        csvEscape(p.lastSeenAt),
      ].join(',')
    );
  }

  rows.push('');
  rows.push('event,timestamp,model,charged_cents,request_units,input_tokens,output_tokens,conversation_id');
  for (const e of usage.recentEvents) {
    rows.push(
      [
        'event',
        csvEscape(e.timestamp),
        csvEscape(e.model),
        (e.chargedCents ?? 0).toFixed(4),
        (e.requestsCosts ?? 0).toFixed(2),
        e.tokenUsage?.inputTokens ?? 0,
        e.tokenUsage?.outputTokens ?? 0,
        csvEscape(e.conversationId),
      ].join(',')
    );
  }

  return rows.join('\n');
}

export type ExportFormat = 'csv' | 'json' | 'markdown';

export function buildJsonExport(
  auth: CursorAuthData | undefined,
  usage: UsageSnapshot,
  projects: ProjectUsageRecord[]
): string {
  const plan = usage.planUsage;
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      account: { email: auth?.email, plan: usage.planName ?? auth?.membershipType },
      billingCycle: {
        startMs: usage.billingCycleStartMs,
        endMs: usage.billingCycleEndMs,
      },
      plan: plan
        ? {
            includedSpendCents: plan.includedSpend,
            remainingCents: plan.remaining,
            limitCents: plan.limit,
            percentUsed: usedPercent(usage),
          }
        : undefined,
      totals: {
        events: usage.totalEventsThisPeriod,
        chargedCents: usage.totalCostCentsFromEvents,
        inputTokens: usage.totalInputTokens,
        outputTokens: usage.totalOutputTokens,
      },
      models: (usage.modelUsage ?? []).map((m) => ({
        modelId: m.modelId,
        label: m.label,
        isAuto: m.isAuto,
        eventCount: m.eventCount,
        chargedCents: m.chargedCents,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
      })),
      chats: usage.chats.map((c) => ({
        conversationId: c.conversationId,
        eventCount: c.eventCount,
        chargedCents: c.chargedCents,
        requestUnits: c.requestUnits,
        lastTimestampMs: c.lastTimestampMs,
        models: c.models,
      })),
      workspaces: projects.map((p) => ({
        name: p.workspaceName,
        path: p.workspacePath,
        chargedCents: p.chargedCents,
        eventCount: p.eventCount,
        lastSeenAt: p.lastSeenAt,
      })),
      recentEvents: usage.recentEvents.slice(0, 200).map((e) => ({
        timestampMs: Number(e.timestamp) || undefined,
        model: e.model,
        kind: e.kind,
        chargedCents: e.chargedCents,
        inputTokens: e.tokenUsage?.inputTokens,
        outputTokens: e.tokenUsage?.outputTokens,
        conversationId: e.conversationId,
      })),
    },
    null,
    2
  );
}

export function buildMarkdownReport(
  auth: CursorAuthData | undefined,
  usage: UsageSnapshot,
  projects: ProjectUsageRecord[]
): string {
  const plan = usage.planUsage;
  const lines: string[] = [];
  lines.push(`# Cursor usage report`);
  lines.push('');
  lines.push(`Exported: ${new Date().toLocaleString()}`);
  if (auth?.email) lines.push(`Account: ${auth.email}`);
  lines.push(`Plan: ${usage.planName ?? auth?.membershipType ?? '—'}`);
  lines.push('');

  if (plan) {
    lines.push(`## Allowance`);
    lines.push('');
    lines.push(`| Used | Limit | Remaining | Percent |`);
    lines.push(`| --- | --- | --- | --- |`);
    lines.push(
      `| ${centsToDollars(plan.includedSpend)} | ${centsToDollars(plan.limit)} | ${centsToDollars(plan.remaining)} | ${formatPercent(usedPercent(usage))} |`
    );
    lines.push('');
  }

  const models = usage.modelUsage ?? [];
  if (models.length) {
    lines.push(`## Models`);
    lines.push('');
    lines.push(`| Model | Events | Charged | Tokens in | Tokens out |`);
    lines.push(`| --- | --- | --- | --- | --- |`);
    for (const m of models) {
      lines.push(
        `| ${m.label} | ${m.eventCount} | ${centsToDollars(m.chargedCents)} | ${m.inputTokens.toLocaleString()} | ${m.outputTokens.toLocaleString()} |`
      );
    }
    lines.push('');
  }

  if (usage.chats.length) {
    lines.push(`## Chats`);
    lines.push('');
    lines.push(`| Conversation | Events | Charged | Models |`);
    lines.push(`| --- | --- | --- | --- |`);
    for (const c of usage.chats) {
      lines.push(
        `| ${c.conversationId.slice(0, 8)} | ${c.eventCount} | ${centsToDollars(c.chargedCents)} | ${c.models.map((m) => displayModelName(m)).join(', ') || '—'} |`
      );
    }
    lines.push('');
  }

  if (projects.length) {
    lines.push(`## Workspaces`);
    lines.push('');
    lines.push(`| Workspace | Charged | Events | Last seen |`);
    lines.push(`| --- | --- | --- | --- |`);
    for (const p of projects) {
      lines.push(
        `| ${p.workspaceName} | ${centsToDollars(p.chargedCents)} | ${p.eventCount} | ${new Date(p.lastSeenAt).toLocaleString()} |`
      );
    }
    lines.push('');
  }

  const insights = buildUsageInsights(usage);
  if (insights.length) {
    lines.push(`## Insights`);
    lines.push('');
    for (const i of insights) lines.push(`- **${i.title}** — ${i.detail}`);
    lines.push('');
  }

  const auto = estimateAutoModels(usage);
  if (auto.autoEventCount > 0) {
    lines.push(`## Auto estimate (heuristic)`);
    lines.push('');
    lines.push(`${auto.autoEventCount} Auto events · confidence ${auto.confidence}`);
    if (auto.likelyModels.length) lines.push(`Likely models: ${auto.likelyModels.join(', ')}`);
    lines.push('');
  }

  return lines.join('\n');
}

const FORMAT_META: Record<ExportFormat, { ext: string; filter: Record<string, string[]>; label: string }> = {
  csv: { ext: 'csv', filter: { CSV: ['csv'] }, label: 'Export CSV' },
  json: { ext: 'json', filter: { JSON: ['json'] }, label: 'Export JSON' },
  markdown: { ext: 'md', filter: { Markdown: ['md'] }, label: 'Export Markdown' },
};

export async function exportUsageToFile(
  format: ExportFormat,
  auth: CursorAuthData | undefined,
  usage: UsageSnapshot,
  projects: ProjectUsageRecord[]
): Promise<string | undefined> {
  const content =
    format === 'csv'
      ? buildCsv(auth, usage, projects)
      : format === 'json'
        ? buildJsonExport(auth, usage, projects)
        : buildMarkdownReport(auth, usage, projects);
  const meta = FORMAT_META[format];
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(`cursor-usage-export.${meta.ext}`),
    filters: meta.filter,
    saveLabel: meta.label,
  });
  if (!uri) return undefined;
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
  return uri.fsPath;
}

export async function exportCsvToFile(
  auth: CursorAuthData | undefined,
  usage: UsageSnapshot,
  projects: ProjectUsageRecord[]
): Promise<string | undefined> {
  return exportUsageToFile('csv', auth, usage, projects);
}
