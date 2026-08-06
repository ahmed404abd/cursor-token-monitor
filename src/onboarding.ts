import * as vscode from 'vscode';

export type SetupIssue = 'auth' | 'database' | 'api' | 'sqlite' | 'unknown';

export function classifySetupError(message: string): SetupIssue {
  const m = message.toLowerCase();
  if (m.includes('accesstoken') || m.includes('signed into cursor')) return 'auth';
  if (m.includes('database not found') || m.includes('state.vscdb')) return 'database';
  if (m.includes('sqlite') || m.includes('could not read cursor auth')) return 'sqlite';
  if (m.includes('failed to fetch') || m.includes('http')) return 'api';
  // Legacy messages from older builds that required Python
  if (m.includes('python') || m.includes('spawn')) return 'sqlite';
  return 'unknown';
}

export async function showSetupGuide(issue: SetupIssue, detail?: string): Promise<void> {
  switch (issue) {
    case 'auth':
      await vscode.window.showErrorMessage(
        'Sign into Cursor first (account icon, bottom-left), then run Refresh Usage.',
        'OK'
      );
      return;
    case 'database':
      await vscode.window
        .showWarningMessage(
          'Cursor database not found. If you use a custom install path, set cursorTokenMonitor.customDatabasePath in Settings.',
          'Open Settings'
        )
        .then((pick) => {
          if (pick === 'Open Settings') {
            vscode.commands.executeCommand(
              'workbench.action.openSettings',
              'cursorTokenMonitor.customDatabasePath'
            );
          }
        });
      return;
    case 'sqlite':
      await vscode.window.showErrorMessage(
        `Could not read your local Cursor login database.${detail ? ` ${detail}` : ''} Try reloading the window after signing into Cursor.`,
        'OK'
      );
      return;
    case 'api':
      await vscode.window
        .showWarningMessage(
          `Could not reach Cursor usage API. Check your network connection.${detail ? ` (${detail})` : ''}`,
          'Retry'
        )
        .then((pick) => {
          if (pick === 'Retry') vscode.commands.executeCommand('cursorTokenMonitor.refresh');
        });
      return;
    default:
      await vscode.window.showErrorMessage(
        detail ??
          'Cursor Token Monitor could not start. Try Refresh Usage from the Command Palette.'
      );
  }
}

export async function runFirstRunCheck(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<boolean>('cursorTokenMonitor.onboardingDone')) return;

  const pick = await vscode.window.showInformationMessage(
    'Cursor Token Monitor is active. Sign into Cursor — usage appears in the status bar (bottom-right). No Python required.',
    'Got it',
    'Setup help'
  );

  if (pick === 'Setup help') {
    await vscode.window.showInformationMessage(
      'Requirements: (1) Sign into Cursor (2) Optional: set cursorTokenMonitor.customDatabasePath only if Cursor uses a non-default install path.'
    );
  }

  await context.globalState.update('cursorTokenMonitor.onboardingDone', true);
}
