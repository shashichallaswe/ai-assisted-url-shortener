#!/usr/bin/env python3
"""Blocks shell commands that violate the harness contract in AGENTS.md.

Reads a beforeShellExecution payload on stdin and emits an allow/ask/deny
decision. Written with the standard library only: jq is not installed on
the target machine and Python 3.9 is the floor.
"""

import json
import os
import re
import subprocess
import sys

PROTECTED_BRANCHES = {"main", "master"}

SECRET_FILE_PATTERNS = (
    re.compile(r"(^|/)\.env(\.|$)(?!example)"),
    re.compile(r"\.pem$"),
    re.compile(r"\.p12$"),
    re.compile(r"(^|/)id_(rsa|dsa|ed25519)$"),
    re.compile(r"(^|/)credentials(\.json)?$"),
)

# Content patterns for credential-shaped strings. Files under .cursor/hooks/
# are exempt because this file necessarily contains the patterns themselves.
SECRET_CONTENT_PATTERNS = (
    ("GitHub token", re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}")),
    ("AWS access key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("Private key block", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("OpenAI-style key", re.compile(r"\bsk-[A-Za-z0-9]{32,}")),
    ("Slack token", re.compile(r"xox[abprs]-[A-Za-z0-9-]{10,}")),
)

DESTRUCTIVE_PATTERNS = (
    (re.compile(r"\brm\s+-[a-zA-Z]*[rR][a-zA-Z]*f|\brm\s+-[a-zA-Z]*f[a-zA-Z]*[rR]"),
     "recursive force delete"),
    (re.compile(r"\bgit\s+reset\s+--hard\b"), "git reset --hard discards local work"),
    (re.compile(r"\bgit\s+clean\s+-[a-zA-Z]*f"), "git clean deletes untracked files"),
    (re.compile(r"\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b", re.IGNORECASE),
     "destructive SQL"),
    (re.compile(r"\bdocker\s+compose\s+down\s+.*(-v|--volumes)"),
     "removes database volumes"),
)


def respond(permission, user_message=None, agent_message=None):
    payload = {"permission": permission}
    if user_message:
        payload["user_message"] = user_message
    if agent_message:
        payload["agent_message"] = agent_message
    print(json.dumps(payload))
    sys.exit(0)


def git(cwd, *args):
    try:
        result = subprocess.run(
            ("git",) + args,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def current_branch(cwd):
    return git(cwd, "rev-parse", "--abbrev-ref", "HEAD")


def staged_files(cwd):
    listing = git(cwd, "diff", "--cached", "--name-only")
    if not listing:
        return []
    return [line for line in listing.splitlines() if line]


def scan_staged_secrets(cwd):
    """Returns a list of human-readable findings for staged content."""
    findings = []
    for path in staged_files(cwd):
        for pattern in SECRET_FILE_PATTERNS:
            if pattern.search(path):
                findings.append("%s is a secret-bearing file" % path)
                break
        if path.startswith(".cursor/hooks/"):
            continue
        blob = git(cwd, "show", ":" + path)
        if not blob:
            continue
        for label, pattern in SECRET_CONTENT_PATTERNS:
            if pattern.search(blob):
                findings.append("%s contains what looks like a %s" % (path, label))
    return findings


def is_git_write(command, verb):
    return re.search(r"\bgit\s+(?:-[^\s]+\s+)*" + verb + r"\b", command) is not None


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        respond("allow")

    command = payload.get("command") or ""
    cwd = payload.get("cwd") or os.getcwd()

    if not command.strip():
        respond("allow")

    # 1. Never bypass hooks or checks.
    if re.search(r"--no-verify\b", command):
        respond(
            "deny",
            user_message="Blocked: --no-verify bypasses the quality gates.",
            agent_message=(
                "AGENTS.md forbids --no-verify. Fix the failing check instead of "
                "skipping it."
            ),
        )

    # 2. Merging is a human action, without exception.
    merge_signals = (
        re.search(r"\bgh\s+pr\s+merge\b", command),
        re.search(r"\bgh\s+pr\s+.*--auto\b", command),
        re.search(r"\bgit\s+merge\b", command),
        re.search(r"\bgit\s+rebase\s+.*\b(main|master)\b", command),
        re.search(r"\bgh\s+api\b.*/pulls/\d+/merge", command),
    )
    if any(merge_signals):
        respond(
            "deny",
            user_message="Blocked: merging is a human action.",
            agent_message=(
                "AGENTS.md section 9: no pull request is merged without a human. "
                "Open the PR, report status, and stop. Do not look for another route "
                "to land the change."
            ),
        )

    branch = current_branch(cwd)
    on_protected = branch in PROTECTED_BRANCHES if branch else False

    # 3. Force-push protection.
    if is_git_write(command, "push") and re.search(r"(--force(?!-with-lease)|\s-f\b)", command):
        if on_protected or re.search(r"\b(main|master)\b", command):
            respond(
                "deny",
                user_message="Blocked: force-push to a protected branch.",
                agent_message=(
                    "Force-pushing main/master is forbidden. Push the story branch "
                    "and open a pull request."
                ),
            )
        respond(
            "ask",
            user_message="Force-push detected. Confirm this rewrites only your story branch.",
        )

    # 4. Direct writes to main.
    if is_git_write(command, "push"):
        targets_protected = re.search(r"\borigin\s+(main|master)\b", command) or re.search(
            r"HEAD:(main|master)\b", command
        )
        if targets_protected or (on_protected and not re.search(r"\borigin\s+\S+", command)):
            respond(
                "deny",
                user_message="Blocked: direct push to main. Use a story branch and a PR.",
                agent_message=(
                    "The harness requires branch-per-issue. Run "
                    "'python3 scripts/story.py start <issue>' and open a pull request."
                ),
            )

    if is_git_write(command, "commit") and on_protected:
        respond(
            "deny",
            user_message="Blocked: committing on %s. Create a story branch first." % branch,
            agent_message=(
                "AGENTS.md section 6 requires one branch per story. Run "
                "'python3 scripts/story.py start <issue>' before committing."
            ),
        )

    # 5. Secret scanning on commit.
    if is_git_write(command, "commit"):
        findings = scan_staged_secrets(cwd)
        if findings:
            respond(
                "deny",
                user_message="Blocked: staged changes look like they contain secrets.",
                agent_message=(
                    "Potential secrets staged:\n- "
                    + "\n- ".join(findings)
                    + "\nUnstage them and use .env (git-ignored) or a placeholder in "
                    ".env.example."
                ),
            )

    # 6. Destructive operations need confirmation.
    for pattern, reason in DESTRUCTIVE_PATTERNS:
        if pattern.search(command):
            respond(
                "ask",
                user_message="Confirm destructive command (%s)." % reason,
                agent_message="This command is destructive (%s). Confirm intent." % reason,
            )

    respond("allow")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # never brick the agent on a hook defect
        print(json.dumps({
            "permission": "allow",
            "agent_message": "guard-shell hook error, failing open: %s" % error,
        }))
        sys.exit(0)
