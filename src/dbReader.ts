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
  }
  if (process.platform === 'darwin') {
    return path.join(
      home,
      'Library',
      'Application Support',
      'Cursor',
      'User',
      'globalStorage',
      'state.vscdb'
    );
  }
  return path.join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

function decodeJwtSub(token: string): string | undefined {
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(normalized, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return typeof parsed.sub === 'string' ? parsed.sub : undefined;
  } catch {
    return undefined;
  }
}

function valueToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
  if (value == null) return '';
  return String(value);
}

/** Prefer Node's built-in sqlite (paged; safe for multi-GB Cursor DBs). */
function readAuthKeysWithNodeSqlite(dbPath: string): Record<string, string> | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (
        path: string,
        options?: { readOnly?: boolean }
      ) => {
        prepare: (sql: string) => { all: (...params: unknown[]) => Record<string, unknown>[] };
        close: () => void;
      };
    };
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = db
        .prepare("SELECT key, value FROM ItemTable WHERE key LIKE ?")
        .all('cursorAuth/%');
      const out: Record<string, string> = {};
      for (const row of rows) {
        const key = valueToString(row.key);
        if (!key) continue;
        out[key] = valueToString(row.value);
      }
      return out;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

function resolveSqliteCli(extensionPath: string): string | undefined {
  const platformKey =
    process.platform === 'win32'
      ? 'win32-x64'
      : process.platform === 'darwin'
        ? process.arch === 'arm64'
          ? 'darwin-arm64'
          : 'darwin-x64'
        : process.arch === 'arm64'
          ? 'linux-arm64'
          : 'linux-x64';

  const binaryName = process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3';
  const candidates = [
    path.join(extensionPath, 'media', 'vendor', 'sqlite', platformKey, binaryName),
    // Fallbacks if arch-specific linux arm package is missing
    path.join(extensionPath, 'media', 'vendor', 'sqlite', 'linux-x64', binaryName),
    path.join(extensionPath, 'media', 'vendor', 'sqlite', 'darwin-x64', binaryName),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function runSqliteCli(cliPath: string, dbPath: string, sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['-readonly', '-json', dbPath, sql];
    const proc = spawn(cliPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    proc.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `sqlite3 exited with code ${code}`));
    });
  });
}

async function readAuthKeysWithCli(
  extensionPath: string,
  dbPath: string
): Promise<Record<string, string>> {
  const cli = resolveSqliteCli(extensionPath);
  if (!cli) {
    throw new Error('Bundled sqlite3 CLI not found for this platform.');
  }
  // Ensure unix binaries are executable when unpacked from VSIX on macOS/Linux.
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(cli, 0o755);
    } catch {
      /* ignore */
    }
  }
  const raw = await runSqliteCli(
    cli,
    dbPath,
    "SELECT key, value FROM ItemTable WHERE key LIKE 'cursorAuth/%';"
  );
  if (!raw) return {};
  const rows = JSON.parse(raw) as Array<{ key: string; value: string }>;
  const out: Record<string, string> = {};
  for (const row of rows) {
    out[String(row.key)] = valueToString(row.value);
  }
  return out;
}

function toAuthData(parsed: Record<string, string>): CursorAuthData {
  const accessToken = parsed['cursorAuth/accessToken'];
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
}

/**
 * Read Cursor auth keys from local state.vscdb (read-only).
 * Uses Node's built-in sqlite when available; otherwise the bundled sqlite3 CLI.
 * No Python required — safe for multi-GB databases (paged reads, not full-file load).
 */
export async function readCursorAuth(context: vscode.ExtensionContext): Promise<CursorAuthData> {
  const config = vscode.workspace.getConfiguration('cursorTokenMonitor');
  const customPath = config.get<string>('customDatabasePath');
  const dbPath =
    customPath && customPath.trim().length > 0 ? customPath.trim() : getDefaultDbPath();

  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `Cursor database not found at "${dbPath}". Set cursorTokenMonitor.customDatabasePath in Settings.`
    );
  }

  const fromNode = readAuthKeysWithNodeSqlite(dbPath);
  if (fromNode) {
    return toAuthData(fromNode);
  }

  try {
    const fromCli = await readAuthKeysWithCli(context.extensionPath, dbPath);
    return toAuthData(fromCli);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not read Cursor auth data from local SQLite (no Python needed). ${detail}`
    );
  }
}
