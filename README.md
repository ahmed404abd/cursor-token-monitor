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

Set `cursorTokenMonitor.statusBarMode` to `rotate` to cycle the status bar between spend, top model, and total tokens.

**Dashboard:**
- Used / remaining / % with progress bar
- **Today / Yesterday / 7-day average** spend cards (built from local snapshots)
- **Session stats** — requests, tokens, and spend since this window opened
- Daily spend + daily tokens trend charts, top spending days
- **Model analytics** — % share of spend and in/out tokens per model (Auto labeled clearly)
- Live activity feed of the latest requests
- Workspace comparison pie chart
- Per-chat rollups (collapsible) and recent events

**Alerts:** a notification at 80% / 90% of your allowance (once per billing cycle) and when today's spend is well above your recent daily average.

**Export:** CSV, JSON, or Markdown from the dashboard toolbar or the command palette.

> **Note on Auto:** Cursor’s usage API reports Auto as `default`. It does **not** reveal which underlying model Auto picked for each turn. Explicitly selected models do show by name.

## Settings

Open Settings and search **Cursor Token Monitor**:

| Setting | Default | Purpose |
|--------|---------|---------|
| `cursorTokenMonitor.refreshIntervalSeconds` | `60` | How often to refresh |
| `cursorTokenMonitor.pythonPath` | _(empty)_ | Full path to Python if not on PATH |
| `cursorTokenMonitor.customDatabasePath` | _(empty)_ | Override `state.vscdb` path (rare) |
| `cursorTokenMonitor.statusBarMode` | `spend` | `spend` or `rotate` (cycles spend / top model / tokens) |

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

- **Cursor Token Monitor: Open Usage Dashboard**
- **Cursor Token Monitor: Refresh Usage**
- **Cursor Token Monitor: Copy Usage Report**
- **Cursor Token Monitor: Export Usage Data…** (CSV / JSON / Markdown, also available individually)
- **Cursor Token Monitor: Check Connection**
- **Cursor Token Monitor: Reset Cache**
- **Cursor Token Monitor: Run Privacy Audit**

## What's not possible (yet)

Live per-chat context-window meters, token counts of the currently open conversation, and streaming token growth require Cursor internals that aren't exposed to extensions — the usage API only reports completed billable events. If Cursor exposes these, they'll be added.

## License

MIT
