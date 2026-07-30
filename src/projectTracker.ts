import * as vscode from 'vscode';
import { UsageSnapshot } from './cursorApi';
import { usedPercent } from './usageIntelligence';

export interface ProjectUsageRecord {
  workspaceKey: string;
  workspaceName: string;
  workspacePath: string;
  lastSeenAt: string;
  eventCount: number;
  chargedCents: number;
  requestUnits: number;
  inputTokens: number;
  outputTokens: number;
  includedSpendCents: number;
  limitCents: number;
  percentUsed?: number;
}

const STORAGE_KEY = 'cursorTokenMonitor.projectUsage';

function workspaceKey(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return 'no-workspace';
  return folders[0].uri.fsPath.toLowerCase();
}

function workspaceName(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return 'No workspace';
  return folders[0].name;
}

function workspacePath(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return '';
  return folders[0].uri.fsPath;
}

export function loadProjectRecords(context: vscode.ExtensionContext): ProjectUsageRecord[] {
  return context.globalState.get<ProjectUsageRecord[]>(STORAGE_KEY, []);
}

export function resetProjectCache(context: vscode.ExtensionContext): void {
  context.globalState.update(STORAGE_KEY, []);
}

export function updateProjectUsage(
  context: vscode.ExtensionContext,
  usage: UsageSnapshot
): ProjectUsageRecord[] {
  const key = workspaceKey();
  const records = loadProjectRecords(context);
  const idx = records.findIndex((r) => r.workspaceKey === key);
  const plan = usage.planUsage;

  const snapshot: ProjectUsageRecord = {
    workspaceKey: key,
    workspaceName: workspaceName(),
    workspacePath: workspacePath(),
    lastSeenAt: new Date().toISOString(),
    eventCount: usage.totalEventsThisPeriod ?? usage.recentEvents.length,
    chargedCents: usage.totalCostCentsFromEvents ?? 0,
    requestUnits: usage.recentEvents.reduce((s, e) => s + (e.requestsCosts ?? 0), 0),
    inputTokens: usage.totalInputTokens ?? 0,
    outputTokens: usage.totalOutputTokens ?? 0,
    includedSpendCents: plan?.includedSpend ?? 0,
    limitCents: plan?.limit ?? 0,
    percentUsed: usedPercent(usage),
  };

  if (idx >= 0) {
    records[idx] = snapshot;
  } else {
    records.push(snapshot);
  }

  records.sort((a, b) => b.chargedCents - a.chargedCents);
  context.globalState.update(STORAGE_KEY, records);
  return records;
}
