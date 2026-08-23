#!/usr/bin/env python3
"""Records every agent file edit and flags edits to sign-off areas.

Runs on afterFileEdit. Observational only: it never blocks, it builds the
audit trail that supports the traceability log.
"""

import datetime
import json
import os
import re
import sys

AUDIT_LOG = os.path.join(".cursor", "harness-audit.log")

SIGN_OFF_PATHS = (
    (re.compile(r"src/security/"), "security control"),
    (re.compile(r"src/cache/"), "cache invalidation"),
    (re.compile(r"(auth|credential|secret)", re.IGNORECASE), "authentication"),
    (re.compile(r"src/db/migrations/"), "database migration"),
    (re.compile(r"src/lib/codes\.ts"), "short-code uniqueness"),
)


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return

    path = (
        payload.get("file_path")
        or payload.get("filePath")
        or payload.get("path")
        or ""
    )
    if not path:
        return

    relative = os.path.relpath(path, os.getcwd()) if os.path.isabs(path) else path
    stamp = datetime.datetime.now().isoformat(timespec="seconds")

    flags = [label for pattern, label in SIGN_OFF_PATHS if pattern.search(relative)]
    suffix = ("  [SIGN-OFF: %s]" % ", ".join(flags)) if flags else ""

    try:
        os.makedirs(os.path.dirname(AUDIT_LOG), exist_ok=True)
        with open(AUDIT_LOG, "a", encoding="utf-8") as handle:
            handle.write("%s\t%s%s\n" % (stamp, relative, suffix))
    except OSError:
        return

    if flags:
        sys.stderr.write(
            "Harness: %s touches %s. Human sign-off required before merge "
            "(AGENTS.md section 9).\n" % (relative, ", ".join(flags))
        )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
