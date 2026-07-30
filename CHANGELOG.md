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
