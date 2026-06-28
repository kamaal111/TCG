#!/usr/bin/env python3
"""List Swift package git tags with creation dates and age filtering."""

from __future__ import annotations

import argparse
import re
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from skill_config import minimum_release_age_days

SEMVER_TAG_RE = re.compile(r"^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Fetch git tags from a Swift package repository and show which "
            "versions are old enough for a minimum-age upgrade policy."
        )
    )
    parser.add_argument("repository", help="Git repository URL or local path")
    parser.add_argument(
        "--min-age-days",
        type=int,
        default=minimum_release_age_days(),
        help="Minimum version age in days before it is eligible for upgrade",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=15,
        help="Maximum number of tags to print",
    )
    parser.add_argument(
        "--include-prerelease",
        action="store_true",
        help="Include prerelease tags",
    )
    parser.add_argument(
        "--all-tags",
        action="store_true",
        help="Include non-semver tags",
    )
    return parser.parse_args()


def run_git(args: list[str], cwd: Path) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout


def parse_timestamp(raw: str) -> datetime:
    normalized = raw.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized).astimezone(timezone.utc)


def is_prerelease(tag: str) -> bool:
    return "-" in tag.lstrip("v")


def main() -> int:
    args = parse_args()
    now = datetime.now(timezone.utc)
    minimum_age = timedelta(days=args.min_age_days)
    repository_path = Path(args.repository)

    if repository_path.exists():
        output = run_git(
            [
                "for-each-ref",
                "refs/tags",
                "--sort=-creatordate",
                "--format=%(refname:strip=2)|%(creatordate:iso8601-strict)",
            ],
            repository_path.resolve(),
        )
    else:
        with tempfile.TemporaryDirectory(prefix="swift-tag-audit-") as temp_dir:
            repo_dir = Path(temp_dir)
            run_git(["init"], repo_dir)
            run_git(["fetch", "--force", "--tags", args.repository], repo_dir)
            output = run_git(
                [
                    "for-each-ref",
                    "refs/tags",
                    "--sort=-creatordate",
                    "--format=%(refname:strip=2)|%(creatordate:iso8601-strict)",
                ],
                repo_dir,
            )

    rows: list[tuple[datetime, str, int, bool]] = []
    for line in output.splitlines():
        tag, _, timestamp = line.partition("|")
        if not args.all_tags and not SEMVER_TAG_RE.match(tag):
            continue
        if is_prerelease(tag) and not args.include_prerelease:
            continue
        published = parse_timestamp(timestamp)
        age_days = int((now - published).total_seconds() // 86400)
        eligible = now - published >= minimum_age
        rows.append((published, tag, age_days, eligible))

    if not rows:
        print("No matching tags found.")
        return 1

    latest_stable = next((row for row in rows if row[3]), None)
    print(f"repository: {args.repository}")
    print(f"minimum_age_days: {args.min_age_days}")
    if latest_stable is None:
        print("latest_eligible: none")
    else:
        print(
            "latest_eligible: "
            f"{latest_stable[1]} created {latest_stable[0].date()} "
            f"({latest_stable[2]}d old)"
        )
    print("")

    for published, tag, age_days, eligible in rows[: args.limit]:
        status = "eligible" if eligible else "too-new"
        print(f"{tag:20} {published.date().isoformat()}  {age_days:4}d  {status}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
