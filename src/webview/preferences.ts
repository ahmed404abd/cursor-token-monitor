import * as vscode from 'vscode';
import { applyOrder, validateThresholds } from './orderUtils';

export { applyOrder, validateThresholds };

export type GroupMode = 'model' | 'workspace';
export type ViewMode = 'card' | 'list';
export type DisplayMode = 'dashboard' | 'quickpick';
export type QuotaLayout = 'graph' | 'cards';
export type StatusBarFormat =
  | 'icon'
  | 'dot'
  | 'percent'
  | 'dotPercent'
  | 'namePercent'
  | 'full';

export interface CockpitPreferences {
  groupMode: GroupMode;
  quotaLayout: QuotaLayout;
  cardOrderModel: string[];
  cardOrderWorkspace: string[];
  modelAliases: Record<string, string>;
  pinnedModelIds: string[];
}

export interface CockpitSettings {
  statusBarFormat: StatusBarFormat;
  statusBarMode: 'spend' | 'rotate';
  notificationsEnabled: boolean;
  warningThreshold: number;
  criticalThreshold: number;
  viewMode: ViewMode;
  displayMode: DisplayMode;
  refreshIntervalSeconds: number;
}

const PREFS_KEY = 'cursorTokenMonitor.cockpitPrefs';

const DEFAULT_PREFS: CockpitPreferences = {
  groupMode: 'model',
  quotaLayout: 'graph',
  cardOrderModel: [],
  cardOrderWorkspace: [],
  modelAliases: {},
  pinnedModelIds: [],
};

export function loadPreferences(context: vscode.ExtensionContext): CockpitPreferences {
  const stored = context.globalState.get<Partial<CockpitPreferences>>(PREFS_KEY, {});
  return {
    ...DEFAULT_PREFS,
    ...stored,
    modelAliases: { ...(stored.modelAliases ?? {}) },
    cardOrderModel: [...(stored.cardOrderModel ?? [])],
    cardOrderWorkspace: [...(stored.cardOrderWorkspace ?? [])],
    pinnedModelIds: [...(stored.pinnedModelIds ?? [])],
  };
}

export async function savePreferences(
  context: vscode.ExtensionContext,
  prefs: CockpitPreferences
): Promise<void> {
  await context.globalState.update(PREFS_KEY, prefs);
}

export async function resetCardOrder(
  context: vscode.ExtensionContext,
  group?: GroupMode
): Promise<CockpitPreferences> {
  const prefs = loadPreferences(context);
  if (!group || group === 'model') prefs.cardOrderModel = [];
  if (!group || group === 'workspace') prefs.cardOrderWorkspace = [];
  await savePreferences(context, prefs);
  return prefs;
}

export function loadSettings(): CockpitSettings {
  const cfg = vscode.workspace.getConfiguration('cursorTokenMonitor');
  let warning = cfg.get<number>('warningThreshold', 65);
  let critical = cfg.get<number>('criticalThreshold', 85);
  if (!(warning < critical)) {
    warning = 65;
    critical = 85;
  }
  return {
    statusBarFormat: cfg.get<StatusBarFormat>('statusBarFormat', 'full'),
    statusBarMode: cfg.get<'spend' | 'rotate'>('statusBarMode', 'spend'),
    notificationsEnabled: cfg.get<boolean>('notificationsEnabled', true),
    warningThreshold: warning,
    criticalThreshold: critical,
    viewMode: cfg.get<ViewMode>('viewMode', 'card'),
    displayMode: cfg.get<DisplayMode>('displayMode', 'dashboard'),
    refreshIntervalSeconds: cfg.get<number>('refreshIntervalSeconds', 60),
  };
}

export interface SettingsPatch {
  statusBarFormat?: StatusBarFormat;
  statusBarMode?: 'spend' | 'rotate';
  notificationsEnabled?: boolean;
  warningThreshold?: number;
  criticalThreshold?: number;
  viewMode?: ViewMode;
  displayMode?: DisplayMode;
  refreshIntervalSeconds?: number;
}

export async function updateSettings(patch: SettingsPatch): Promise<CockpitSettings> {
  const cfg = vscode.workspace.getConfiguration('cursorTokenMonitor');
  const current = loadSettings();
  const next: CockpitSettings = { ...current, ...patch };

  if (!(next.warningThreshold < next.criticalThreshold)) {
    throw new Error('Warning threshold must be lower than critical threshold.');
  }

  const target = vscode.ConfigurationTarget.Global;
  if (patch.statusBarFormat !== undefined) {
    await cfg.update('statusBarFormat', patch.statusBarFormat, target);
  }
  if (patch.statusBarMode !== undefined) {
    await cfg.update('statusBarMode', patch.statusBarMode, target);
  }
  if (patch.notificationsEnabled !== undefined) {
    await cfg.update('notificationsEnabled', patch.notificationsEnabled, target);
  }
  if (patch.warningThreshold !== undefined) {
    await cfg.update('warningThreshold', patch.warningThreshold, target);
  }
  if (patch.criticalThreshold !== undefined) {
    await cfg.update('criticalThreshold', patch.criticalThreshold, target);
  }
  if (patch.viewMode !== undefined) {
    await cfg.update('viewMode', patch.viewMode, target);
  }
  if (patch.displayMode !== undefined) {
    await cfg.update('displayMode', patch.displayMode, target);
  }
  if (patch.refreshIntervalSeconds !== undefined) {
    await cfg.update('refreshIntervalSeconds', patch.refreshIntervalSeconds, target);
  }

  return loadSettings();
}
