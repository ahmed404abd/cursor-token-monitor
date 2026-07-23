import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { spawn } from 'child_process';

export interface CursorAuthData {
  accessToken?: string;
  email?: string;
  membershipType?: string;
  userId?: string;
}

function getDefaultDbPath(): string {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  } else if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  return path.join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

function getPythonCandidates(configured?: string): string[] {
  if (configured && configured.trim().length > 0) {
    return [configured.trim()];
  }
  return process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python'];
}

function decodeJwtSub(token: string): string | undefined {
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(normalized, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return parsed.sub;
  } catch {
    return undefined;
  }
}

function runPython(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0 && stdout.trim().length > 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `"${cmd}" exited with code ${code}`));
      }
    });
  });
}

export async function readCursorAuth(context: vscode.ExtensionContext): Promise<CursorAuthData> {
  const config = vscode.workspace.getConfiguration('cursorTokenMonitor');
  const customPath = config.get<string>('customDatabasePath');
  const dbPath = customPath && customPath.trim().length > 0 ? customPath.trim() : getDefaultDbPath();

  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `Cursor database not found at "${dbPath}". Set cursorTokenMonitor.customDatabasePath in settings.`
    );
  }

  const scriptPath = path.join(context.extensionPath, 'scripts', 'read_cursor_auth.py');
  const candidates = getPythonCandidates(config.get<string>('pythonPath'));

  let lastError: Error | undefined;
  for (const cmd of candidates) {
    try {
      const raw = await runPython(cmd, [scriptPath, dbPath]);
      const parsed = JSON.parse(raw);
      if (parsed.error) {
        throw new Error(parsed.error);
      }

      const accessToken: string | undefined = parsed['cursorAuth/accessToken'];
      if (!accessToken) {
        throw new Error(
          'No cursorAuth/accessToken found in the database. Make sure you are signed into Cursor.'
        );
      }

      return {
        accessToken,
        email: parsed['cursorAuth/cachedEmail'],
        membershipType: parsed['cursorAuth/stripeMembershipType'],
        userId: decodeJwtSub(accessToken),
      };
    } catch (err) {
      lastError = err as Error;
      continue;
    }
  }

  throw new Error(
    `Could not read Cursor auth data (tried: ${candidates.join(', ')}). ` +
      `Install Python 3 and make sure it's on PATH, or set cursorTokenMonitor.pythonPath explicitly. ` +
      `Last error: ${lastError?.message ?? 'unknown'}`
  );
}
