# Cursor Token Monitor

A **cockpit-style** Cursor AI usage dashboard — interactive model cards with circular progress rings, drag-to-reorder, status-bar formats, QuickPick mode, and CSV/JSON/Markdown export.

Works in **Cursor** (VS Code–compatible). Reads your already signed-in Cursor account locally and calls Cursor’s own usage APIs. Nothing is sent to third-party servers.

## Requirements

1. **Cursor** desktop app (signed in)
2. **Python 3** on PATH (`python --version` or `py --version`)
   - Used only to read one auth key from Cursor’s local SQLite DB (`state.vscdb`)
   - Or set `cursorTokenMonitor.pythonPath`

## Getting started

1. Install the extension
2. Reload the window if needed (**Developer: Reload Window**)
3. Look at the **bottom-right status bar**
4. Click it to open the **Token Cockpit** dashboard

## What you’ll see

### Cockpit dashboard

Dark cockpit theme (independent of the editor theme):

- **Plan details** card with SVG circular allowance ring, billing cycle, reset countdown, and collapsible today/yesterday/7-day spend
- **Quota cards** for models (or workspaces) with:
  - Circular % ring (spend share)
  - Health status (Healthy / Warning / Critical)
  - Input vs output token bars
  - Chat / request-type pills
  - Rename + pin-to-status-bar (models)
  - Drag-and-drop reorder (persisted)
- **Group toggle**: model vs workspace
- **Trends**: daily spend + daily tokens charts
- Live activity feed, top spending days, longest sessions, Auto estimate
- Toolbar: Refresh, Reset Order, CSV / JSON / MD export, Copy, Settings gear

### Status bar

Six formats via `cursorTokenMonitor.statusBarFormat`:

| Format | Example |
|--------|---------|
| `icon` | icon only |
| `dot` | health dot + icon |
| `percent` | icon + % |
| `dotPercent` | dot + % |
| `namePercent` | pinned/top model + % |
| `full` | Safe · $4.12/$20.00 |

Set `statusBarMode` to `rotate` to cycle spend / model / tokens.

### QuickPick mode

Set `displayMode` to `quickpick` (or run **Open QuickPick**) for a keyboard-friendly list with Refresh and Open dashboard buttons.

### Alerts

Configurable warning/critical thresholds (defaults 75% / 90%). Can be disabled with `notificationsEnabled`. Also notifies when today’s spend is unusually high vs your recent average.

## Settings

| Setting | Default | Purpose |
|--------|---------|---------|
| `refreshIntervalSeconds` | `60` | Poll interval |
| `pythonPath` | _(empty)_ | Python executable |
| `customDatabasePath` | _(empty)_ | Override `state.vscdb` |
| `statusBarMode` | `spend` | `spend` or `rotate` |
| `statusBarFormat` | `full` | One of the six formats above |
| `notificationsEnabled` | `true` | Allowance / spend alerts |
| `warningThreshold` | `75` | Warning % (must be &lt; critical) |
| `criticalThreshold` | `90` | Critical % |
| `viewMode` | `card` | `card` or `list` |
| `displayMode` | `dashboard` | `dashboard` or `quickpick` |

You can also change these from the cockpit **⚙ Settings** modal.

## Commands

- **Open Usage Dashboard** / **Show Details**
- **Open QuickPick**
- **Refresh Usage**
- **Copy Usage Report**
- **Export Usage Data…** (CSV / JSON / Markdown)
- **Check Connection**
- **Reset Cache**
- **Run Privacy Audit**

## Privacy & security

- Reads `cursorAuth/accessToken` from your **local** Cursor database (read-only)
- Uses that token only to call `api2.cursor.sh`
- Does **not** upload your code, chats, or token elsewhere
- Does **not** modify `state.vscdb`
- Workspace cards are **estimated** account snapshots associated with the open folder — Cursor does not expose per-project billing IDs

## Troubleshooting

| Problem | Fix |
|--------|-----|
| “Could not read Cursor auth data” | Install Python 3, or set `pythonPath` |
| “No cursorAuth/accessToken found” | Sign into Cursor |
| Status bar warning | Click the item / Check Connection |
| Cards won’t drag | Ensure `media/vendor/Sortable.min.js` is packaged (reinstall VSIX) |

## What's not possible (yet)

Live per-chat context-window meters, streaming token growth, and conversation DB sizes require Cursor internals that aren’t exposed to extensions.

## License

MIT
