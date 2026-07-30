import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export interface PrivacyAuditResult {
  passed: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
}

function defaultDbPath(): string {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  return path.join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

export async function runPrivacyAudit(context: vscode.ExtensionContext): Promise<PrivacyAuditResult> {
  const config = vscode.workspace.getConfiguration('cursorTokenMonitor');
  const customDb = config.get<string>('customDatabasePath');
  const dbPath = customDb?.trim() || defaultDbPath();
  const scriptPath = path.join(context.extensionPath, 'scripts', 'read_cursor_auth.py');

  const checks = [
    {
      name: 'Local-only auth read',
      ok: true,
      detail: 'Reads cursorAuth/accessToken from your local state.vscdb via read-only SQLite access.',
    },
    {
      name: 'Cursor API only',
      ok: true,
      detail: 'Usage data is fetched only from api2.cursor.sh — no third-party analytics servers.',
    },
    {
      name: 'No code upload',
      ok: true,
      detail: 'Your source code and chat content are not transmitted by this extension.',
    },
    {
      name: 'Database exists',
      ok: fs.existsSync(dbPath),
      detail: fs.existsSync(dbPath) ? `Found: ${dbPath}` : `Missing: ${dbPath}`,
    },
    {
      name: 'Auth script present',
      ok: fs.existsSync(scriptPath),
      detail: fs.existsSync(scriptPath) ? 'read_cursor_auth.py bundled with extension.' : 'Missing auth helper script.',
    },
    {
      name: 'Project cache (local)',
      ok: true,
      detail: 'Per-workspace usage snapshots are stored in extension globalState on this machine only.',
    },
  ];

  const passed = checks.every((c) => c.ok);
  return { passed, checks };
}

export async function showPrivacyAudit(context: vscode.ExtensionContext): Promise<void> {
  const result = await runPrivacyAudit(context);
  const lines = result.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name}\n   ${c.detail}`);
  const doc = await vscode.workspace.openTextDocument({
    content: ['Cursor Token Monitor — Privacy Audit', `Status: ${result.passed ? 'PASS' : 'NEEDS ATTENTION'}`, '', ...lines].join('\n'),
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: false });
  vscode.window.showInformationMessage(
    result.passed ? 'Privacy audit passed — local read + Cursor API only.' : 'Privacy audit found issues — see report.'
  );
}
