#!/usr/bin/env python3
"""Story lifecycle helper: start a story branch, or open its pull request.

Usage:
    python3 scripts/story.py start <issue-number>
    python3 scripts/story.py pr <issue-number>

Requires the GitHub CLI (`gh`) to be installed and authenticated.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys

OWNER = "shashichallaswe"
REPO = "shashichallaswe/ai-assisted-url-shortener"
PROJECT_NUMBER = "1"
PROTECTED = {"main", "master"}


def fail(message):
    sys.stderr.write("error: %s\n" % message)
    sys.exit(1)


def find_gh():
    found = shutil.which("gh") or os.path.expanduser("~/.local/bin/gh")
    if not os.path.exists(found):
        fail("GitHub CLI not found. Install gh and run 'gh auth login'.")
    return found


GH = None


def gh(*args, check=True, parse_json=False):
    result = subprocess.run([GH] + list(args), capture_output=True, text=True)
    if check and result.returncode != 0:
        fail("gh %s failed: %s" % (" ".join(args), result.stderr.strip()))
    output = result.stdout.strip()
    return json.loads(output) if parse_json and output else output


def git(*args, check=True):
    result = subprocess.run(["git"] + list(args), capture_output=True, text=True)
    if check and result.returncode != 0:
        fail("git %s failed: %s" % (" ".join(args), result.stderr.strip()))
    return result.stdout.strip()


def slugify(title):
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return slug[:44].rstrip("-")


def issue(number):
    return gh(
        "issue", "view", str(number),
        "--repo", REPO,
        "--json", "number,title,body,state,labels",
        parse_json=True,
    )


def set_board_status(number, status_name):
    """Best-effort move of the board item. Never fails the command."""
    try:
        items = gh(
            "project", "item-list", PROJECT_NUMBER,
            "--owner", OWNER, "--format", "json", "--limit", "100",
            parse_json=True, check=False,
        )
        fields = gh(
            "project", "field-list", PROJECT_NUMBER,
            "--owner", OWNER, "--format", "json",
            parse_json=True, check=False,
        )
        if not items or not fields:
            return
        item_id = next(
            (i["id"] for i in items.get("items", [])
             if (i.get("content") or {}).get("number") == int(number)),
            None,
        )
        status_field = next(
            (f for f in fields.get("fields", []) if f.get("name") == "Status"), None
        )
        if not item_id or not status_field:
            return
        option = next(
            (o for o in status_field.get("options", [])
             if o["name"].lower() == status_name.lower()), None
        )
        project_id = gh(
            "project", "view", PROJECT_NUMBER, "--owner", OWNER, "--format", "json",
            parse_json=True, check=False,
        )
        if not option or not project_id:
            return
        gh(
            "project", "item-edit",
            "--id", item_id,
            "--project-id", project_id["id"],
            "--field-id", status_field["id"],
            "--single-select-option-id", option["id"],
            check=False,
        )
        print("Board: #%s -> %s" % (number, status_name))
    except Exception as error:
        print("warning: could not update board (%s)" % error)


def acceptance_criteria(body):
    lines = [ln for ln in (body or "").splitlines() if re.match(r"\s*- \[ \]", ln)]
    return lines


def cmd_start(number):
    data = issue(number)
    if data["state"] != "OPEN":
        fail("issue #%s is %s" % (number, data["state"]))
    if any(label["name"] == "epic" for label in data.get("labels", [])):
        fail("#%s is an epic. Implement one of its stories instead." % number)

    if git("status", "--porcelain"):
        fail("working tree is dirty. Commit or stash before starting a story.")

    branch = "story/%s-%s" % (number, slugify(data["title"]))
    existing = git("branch", "--list", branch)
    if existing:
        git("checkout", branch)
        print("Resumed existing branch %s" % branch)
    else:
        git("checkout", "main")
        subprocess.run(["git", "pull", "--ff-only"], capture_output=True, text=True)
        git("checkout", "-b", branch)
        print("Created branch %s" % branch)

    set_board_status(number, "In progress")

    print("\nStory #%s: %s" % (number, data["title"]))
    criteria = acceptance_criteria(data["body"])
    if criteria:
        print("\nAcceptance criteria:")
        for line in criteria:
            print("  " + line.strip())
    print(
        "\nNext: restate intent/constraints/AC/files/out-of-scope, then follow "
        "docs/workflows/feature.md (test first)."
    )


def cmd_pr(number):
    data = issue(number)
    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    if branch in PROTECTED:
        fail("you are on %s. Story work belongs on a story branch." % branch)
    if git("status", "--porcelain"):
        fail("working tree is dirty. Commit before opening a pull request.")

    subprocess.run(["git", "push", "-u", "origin", branch], check=False)

    criteria = "\n".join(acceptance_criteria(data["body"])) or "- [ ] see issue"
    body = PR_TEMPLATE.format(number=number, title=data["title"], criteria=criteria)

    url = gh(
        "pr", "create",
        "--repo", REPO,
        "--base", "main",
        "--head", branch,
        "--title", "%s (#%s)" % (data["title"], number),
        "--body", body,
        check=False,
    )
    print(url or "pull request may already exist; check with 'gh pr view'")
    set_board_status(number, "In review")


PR_TEMPLATE = """## Summary

<!-- What changed and why, understandable without reading the diff. -->

Closes #{number}

## Acceptance criteria

{criteria}

## Testing

<!-- What you verified and how a reviewer reproduces it. -->

```bash
npm run typecheck && npm run lint && npm test
```

## Risk and rollback

<!-- What could break, what is not covered, how to undo it. -->

## AI assistance

- Generated:
- Edited:
- Rejected (and why):

## Sign-off

<!-- Required if this touches URL policy, auth, cache invalidation, uniqueness,
     or the threat model. Name it explicitly. -->
"""


def main():
    global GH
    GH = find_gh()
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("start", "pr"):
        p = sub.add_parser(name)
        p.add_argument("issue", type=int)
    args = parser.parse_args()

    if args.command == "start":
        cmd_start(args.issue)
    else:
        cmd_pr(args.issue)


if __name__ == "__main__":
    main()
