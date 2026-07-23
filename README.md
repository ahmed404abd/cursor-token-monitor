# Cursor Token Monitor

See your **Cursor AI usage** in the status bar — included spend, tokens, models, and per-chat activity.

Works in **Cursor** (VS Code–compatible). Reads your already signed-in Cursor account locally and calls Cursor’s own usage APIs. Nothing is sent to third-party servers.

## Requirements

Before installing, make sure you have:

1. **Cursor** desktop app (signed in to your account)
2. **Python 3** on your PATH (`python --version` or `py --version`)
   - Used only to read one auth key from Cursor’s local SQLite DB (`state.vscdb`)
   - If Python isn’t on PATH, set `cursorTokenMonitor.pythonPath` in Settings

That’s it. No API keys, no PAT, no extra Cursor settings.

## Getting started (after install)

1. Install the extension in Cursor
2. Reload the window if needed (**Developer: Reload Window**)
3. Look at the **bottom-right status bar** for something like:
   ```
   ⚡ $0.18/$20.00 · 0.9%
   ```
4. Click it for the full usage panel (spend, models, chats, recent events)

If you see a warning icon, hover or click it — usually Python is missing or you’re not signed into Cursor.

## What you’ll see

**Status bar** (Pro / Team / Ultra): included dollar spend vs allowance (not legacy “request count”).

**Detail panel:**
- Used / remaining / % with progress bar
- Billing cycle
- Events & token totals
- **Models used** (Auto labeled clearly; named models when you pick them)
- Auto candidate pool (models Auto may route to)
- Per-chat rollups and recent activity

> **Note on Auto:** Cursor’s usage API reports Auto as `default`. It does **not** reveal which underlying model Auto picked for each turn. Explicitly selected models do show by name.

## Settings

Open Settings and search **Cursor Token Monitor**:

| Setting | Default | Purpose |
|--------|---------|---------|
| `cursorTokenMonitor.refreshIntervalSeconds` | `60` | How often to refresh |
| `cursorTokenMonitor.pythonPath` | _(empty)_ | Full path to Python if not on PATH |
| `cursorTokenMonitor.customDatabasePath` | _(empty)_ | Override `state.vscdb` path (rare) |

## Privacy & security

- Reads `cursorAuth/accessToken` from your **local** Cursor database (read-only)
- Uses that token only to call `api2.cursor.sh` (same family of APIs Cursor’s dashboard uses)
- Does **not** upload your code, chats, or token to any other service
- Does **not** modify `state.vscdb`

## Troubleshooting

| Problem | Fix |
|--------|-----|
| “Could not read Cursor auth data” | Install Python 3, or set `cursorTokenMonitor.pythonPath` |
| “No cursorAuth/accessToken found” | Sign into Cursor (account icon) |
| Status bar warning | Click the item for details |
| Still shows old “0 req” UI | Update to 1.0.0+ and reload |

## Commands

- **Cursor Token Monitor: Refresh Usage**
- **Cursor Token Monitor: Show Details**

## License

MIT
