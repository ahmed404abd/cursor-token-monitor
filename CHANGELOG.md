## [1.5.1] - 2026-08-10

### Changed
- Cockpit visual refresh: teal/cyan glass theme, glow rings, KPI tiles, richer depth and typography
- Marketplace gallery banner and sanitized README screenshots updated to match the new look

## [1.5.0] - 2026-08-07

### Added
- **No Python required** — reads Cursor auth via Node built-in SQLite or a bundled `sqlite3` CLI (safe for multi-GB `state.vscdb` files)
- **Burn-rate forecast** section: projected % by cycle end and “hits 100% in ~Xd” for Cursor Models and Other Models pools

### Removed
- Python 3 dependency and `cursorTokenMonitor.pythonPath` setting
- `scripts/read_cursor_auth.py` helper

### Changed
- Onboarding / privacy audit / troubleshooting copy no longer mention Python

## [1.4.3] - 2026-08-04

### Changed
- Dual Pro quota bars now show large **X% used** labels like Cursor's dashboard
- Plan ring uses Cursor's blended total usage percent when available
- Plan summary text highlights Cursor Models % and Other Models % explicitly

## [1.4.2] - 2026-08-04

### Fixed
- Pro plan display now mirrors Cursor's dual quotas: **Cursor Models** vs **Other Models**
- Plan ring and alerts use the binding pool (max of both) instead of treating the $20 API dollar bar as the whole plan
- Status bar `full` format shows both pool percentages when available
- KPI labels clarify that Used/Limit dollars are the Other Models / API allowance

### Added
- Dual quota progress bars in the plan details card
- Quota-aware usage intelligence copy when one pool is exhausted and the other is not

## [1.4.1] - 2026-07-31

### Added
- Rolling 90-day, GitHub-style activity heatmap in the cockpit
- Per-model heatmap filtering with spend, request, token, and top-model detail
- Hover/focus tooltip with a compact daily model breakdown
- Warning and critical day overlays driven by the configured allowance thresholds
- Separate visual states for `$0` days and days with no locally observed history
- Sanitized cockpit, model-card, and heatmap previews in the README

### Changed
- Marketplace description now focuses on private, model-aware usage intelligence
- Daily model totals are retained locally for up to 90 days

## [1.4.0] - 2026-07-30

### Added
- Cockpit-style webview dashboard (dark theme, local CSS/JS assets)
- SVG circular progress rings for plan allowance and per-card spend share
- Drag-to-reorder cards via bundled SortableJS (persisted in globalState)
- Group toggle: model vs workspace cards
- Model rename aliases + pin-to-status-bar
- In-webview Settings modal (formats, thresholds, view/display mode)
- Six status bar formats: icon, dot, percent, dotPercent, namePercent, full
- QuickPick alternate display mode + Open QuickPick command
- Configurable warning/critical thresholds and notifications toggle
- Unit tests for order helpers, status formats, and view-model construction

### Changed
- Dashboard updates via `postMessage` (`usageUpdate`) instead of full HTML rebuild each poll
- Alerts honor configured thresholds and `notificationsEnabled`

## [1.3.0] - 2026-07-30

### Added
- Daily/weekly summary cards: Today, Yesterday, 7-day average, 7-day total
- Session statistics: requests, tokens, and spend since the editor window opened
- Model analytics: % share of spend and input/output token split per model
- Daily tokens trend chart alongside the spend chart
- Live activity feed of the latest AI requests
- Export to **JSON** and **Markdown** (plus existing CSV) — toolbar buttons and commands
- `Export Usage Data…` command with a format picker
- Usage alerts: notification at 80% / 90% of allowance (once per cycle) and when today's spend is unusually high (once per day)
- `statusBarMode` setting: `spend` (default) or `rotate` between spend, top model, and total tokens

## [1.2.0] - 2026-07-28

### Added
- Interactive dashboard toolbar: **Export CSV**, Copy report, Refresh, GitHub issues link
- Historical analytics (local daily snapshots + event-based daily spend chart)
- Last 30 days list, top spending days, longest AI sessions
- Workspace comparison pie chart
- Collapsible Per chat / Recent events sections

### Changed
- Dashboard charts replace dense always-open tables for chats/events

## [1.1.0] - 2026-07-27

### Added
- Dynamic status bar health: Safe / % used / Limit risk
- Usage intelligence (burn rate, overage risk, activity signals)
- Auto model estimate heuristic (low/medium confidence)
- Per-project (workspace) usage tracking
- Export CSV + copy usage report
- Command palette: Open Dashboard, Check Connection, Reset Cache, Privacy Audit
- Guided onboarding when Python / auth / DB setup is missing

### Changed
- Publisher namespace `ahmed404abd` (verified Open VSX ownership)

## [1.0.2] - 2026-07-27

### Changed
- Republished under Open VSX namespace `ahmed404abd` (after namespace ownership grant).

## [1.0.1] - 2026-07-22

### Changed
- New extension icon and README cover image

## [1.0.0] - 2026-07-22

### Added
- Status bar usage for Cursor Pro / Team / Ultra (included spend)
- Detail panel with billing cycle, tokens, models, per-chat rollups, and recent events
- Auto mode labeled clearly, with Auto candidate model pool
- Settings for refresh interval, custom `state.vscdb` path, and Python path
- MIT license and marketplace-ready packaging

### Notes
- First public release. Uses Cursor's undocumented dashboard APIs; shapes may change.
