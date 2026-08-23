#!/usr/bin/env python3
"""Appends a row to docs/ai-traceability.md.

Usage:
    python3 scripts/ai_log.py --issue 9 --summary "create endpoint" \\
        --generated "route and service scaffold" \\
        --edited "tightened URL validation, replaced loose https check" \\
        --rejected "in-memory store; loses data on restart" \\
        --gates "typecheck,lint,test"

Every AI-assisted change gets a row. The log is graded evidence of process.
"""

import argparse
import datetime
import os
import subprocess

LOG_PATH = os.path.join("docs", "ai-traceability.md")

HEADER = """# AI traceability

Every AI-assisted change is recorded here: what was generated, what the engineer
changed, what was rejected and why, which gates ran, and who signed off.
Maintained by `scripts/ai_log.py`.

| Date | Issue | Commit | Summary | Generated | Edited | Rejected (why) | Gates | Sign-off |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
"""


def short_sha():
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=5,
        )
        return result.stdout.strip() if result.returncode == 0 else "-"
    except (OSError, subprocess.SubprocessError):
        return "-"


def escape(text):
    return (text or "-").replace("|", "\\|").replace("\n", " ").strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--issue", required=True)
    parser.add_argument("--summary", required=True)
    parser.add_argument("--generated", default="-")
    parser.add_argument("--edited", default="-")
    parser.add_argument("--rejected", default="-")
    parser.add_argument("--gates", default="typecheck,lint,test")
    parser.add_argument("--signoff", default="engineer")
    args = parser.parse_args()

    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    if not os.path.exists(LOG_PATH):
        with open(LOG_PATH, "w", encoding="utf-8") as handle:
            handle.write(HEADER)

    row = "| %s | #%s | %s | %s | %s | %s | %s | %s | %s |\n" % (
        datetime.date.today().isoformat(),
        args.issue,
        short_sha(),
        escape(args.summary),
        escape(args.generated),
        escape(args.edited),
        escape(args.rejected),
        escape(args.gates),
        escape(args.signoff),
    )

    with open(LOG_PATH, "a", encoding="utf-8") as handle:
        handle.write(row)

    print("Logged to %s" % LOG_PATH)


if __name__ == "__main__":
    main()
