import * as vscode from 'vscode';

export type SetupIssue = 'python' | 'auth' | 'database' | 'api' | 'unknown';

export function classifySetupError(message: string): SetupIssue {
  const m = message.toLowerCase();
  if (m.includes('python') || m.includes('py ') || m.includes('spawn')) return 'python';
  if (m.includes('accesstoken') || m.includes('signed into cursor')) return 'auth';
  if (m.includes('database not found') || m.includes('state.vscdb')) return 'database';
  if (m.includes('failed to fetch') || m.includes('http')) return 'api';
  return 'unknown';
}

export async function showSetupGuide(issue: SetupIssue, detail?: string): Promise<void> {
  const pythonUrl = 'https://www.python.org/downloads/';
  const settingsUrl = 'command:workbench.action.openSettings?%22cursorTokenMonitor.pythonPath%22';

  switch (issue) {
    case 'python': {
      const pick = await vscode.window.showErrorMessage(
        'Cursor Token Monitor needs Python 3 to read your local Cursor login (read-only).',
        'Install Python',
        'Open Settings',
        'Learn more'
      );
      if (pick === 'Install Python') {
        vscode.env.openExternal(vscode.Uri.parse(pythonUrl));
      } else if (pick === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'cursorTokenMonitor.pythonPath');
      } else if (pick === 'Learn more') {
        vscode.window.showInformationMessage(
          'Python is only used to read one key from Cursor\'s local database. Nothing is uploaded. After installing Python, reload the window or run "Refresh Usage".'
        );
      }
      return;
    }
    case 'auth':
      await vscode.window.showErrorMessage(
        'Sign into Cursor first (account icon, bottom-left), then run Refresh Usage.',
        'OK'
      );
      return;
    case 'database':
      await vscode.window.showWarningMessage(
        'Cursor database not found. If you use a custom install path, set cursorTokenMonitor.customDatabasePath in Settings.',
        'Open Settings'
      ).then((pick) => {
        if (pick === 'Open Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'cursorTokenMonitor.customDatabasePath');
        }
      });
      return;
    case 'api':
      await vscode.window.showWarningMessage(
        `Could not reach Cursor usage API. Check your network connection.${detail ? ` (${detail})` : ''}`,
        'Retry'
      ).then((pick) => {
        if (pick === 'Retry') vscode.commands.executeCommand('cursorTokenMonitor.refresh');
      });
      return;
    default:
      await vscode.window.showErrorMessage(
        detail ?? 'Cursor Token Monitor could not start. Try Refresh Usage from the Command Palette.'
      );
  }
}

export async function runFirstRunCheck(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<boolean>('cursorTokenMonitor.onboardingDone')) return;

  const pick = await vscode.window.showInformationMessage(
    'Cursor Token Monitor is active. You need Cursor signed in + Python 3 on PATH. Usage appears in the status bar (bottom-right).',
    'Got it',
    'Setup help'
  );

  if (pick === 'Setup help') {
    await vscode.window.showInformationMessage(
      'Requirements: (1) Sign into Cursor (2) Python 3 installed — run "python --version" in terminal (3) Optional: set cursorTokenMonitor.pythonPath in Settings if needed.'
    );
  }

  await context.globalState.update('cursorTokenMonitor.onboardingDone', true);
}
