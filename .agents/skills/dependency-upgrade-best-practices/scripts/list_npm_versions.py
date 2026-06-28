#!/usr/bin/env python3
"""List npm package versions with publish dates and age filtering."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from skill_config import minimum_release_age_days


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "List npm package versions with publish dates and highlight versions "
            "old enough to satisfy a minimum-age policy."
        )
    )
    parser.add_argument("package", help="npm package name")
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
        help="Maximum number of versions to print",
    )
    parser.add_argument(
        "--include-prerelease",
        action="store_true",
        help="Include prerelease versions",
    )
    parser.add_argument(
        "--metadata-file",
        type=Path,
        help="Read npm registry metadata from a local JSON file instead of the network",
    )
    return parser.parse_args()


def parse_timestamp(raw: str) -> datetime:
    normalized = raw.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized).astimezone(timezone.utc)


def is_prerelease(version: str) -> bool:
    stripped = version.lstrip("v")
    return "-" in stripped


def load_metadata(package: str, metadata_file: Path | None) -> dict[str, object]:
    if metadata_file is not None:
        return json.loads(metadata_file.read_text())

    quoted_package = urllib.parse.quote(package, safe="@/")
    url = f"https://registry.npmjs.org/{quoted_package}"
    with urllib.request.urlopen(url) as response:
        return json.load(response)


def main() -> int:
    args = parse_args()
    metadata = load_metadata(args.package, args.metadata_file)
    published_times = metadata.get("time", {})
    if not isinstance(published_times, dict):
        raise SystemExit("npm metadata did not contain a usable time map")

    now = datetime.now(timezone.utc)
    minimum_age = timedelta(days=args.min_age_days)
    rows: list[tuple[datetime, str, int, bool]] = []

    for version, published_at in published_times.items():
        if version in {"created", "modified"}:
            continue
        if not isinstance(published_at, str):
            continue
        if is_prerelease(version) and not args.include_prerelease:
            continue
        published = parse_timestamp(published_at)
        age_days = int((now - published).total_seconds() // 86400)
        eligible = now - published >= minimum_age
        rows.append((published, version, age_days, eligible))

    rows.sort(key=lambda row: row[0], reverse=True)
    if not rows:
        print("No matching versions found.", file=sys.stderr)
        return 1

    latest_stable = next((row for row in rows if row[3]), None)
    print(f"package: {args.package}")
    print(f"minimum_age_days: {args.min_age_days}")
    if latest_stable is None:
        print("latest_eligible: none")
    else:
        print(
            "latest_eligible: "
            f"{latest_stable[1]} published {latest_stable[0].date()} "
            f"({latest_stable[2]}d old)"
        )
    print("")

    for published, version, age_days, eligible in rows[: args.limit]:
        status = "eligible" if eligible else "too-new"
        print(
            f"{version:20} {published.date().isoformat()}  "
            f"{age_days:4}d  {status}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
