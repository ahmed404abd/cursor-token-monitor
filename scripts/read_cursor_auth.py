"""
Reads Cursor's auth-related keys out of its local state.vscdb SQLite database.

Only touches the small ItemTable (settings/key-value table), never the large
cursorDiskKV table (which holds chat history and can be gigabytes), so this
stays fast even on very large databases.

Usage: python read_cursor_auth.py <path-to-state.vscdb>
Prints a single JSON object to stdout: {"cursorAuth/accessToken": "...", ...}
or {"error": "..."} on failure (with a non-zero exit code).
"""

import json
import sqlite3
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "missing db path argument"}))
        return 1

    db_path = sys.argv[1]

    try:
        # Open read-only via URI so we never write to / lock the live DB.
        # WAL mode (state.vscdb-wal) is handled transparently by sqlite3.
        uri = f"file:{db_path}?mode=ro"
        con = sqlite3.connect(uri, uri=True, timeout=5)
        cur = con.cursor()
        cur.execute("SELECT key, value FROM ItemTable WHERE key LIKE 'cursorAuth/%'")
        rows = cur.fetchall()
        con.close()

        result = {}
        for key, value in rows:
            # Values are usually plain strings (tokens, emails); store as-is.
            if isinstance(value, bytes):
                value = value.decode("utf-8", errors="replace")
            result[key] = value

        print(json.dumps(result))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
