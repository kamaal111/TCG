#!/usr/bin/env python3
"""Query OSV for package advisories and flag suspicious compromise signals."""

from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

OSV_URL = "https://api.osv.dev/v1/query"
SUSPICION_TERMS = (
    "malicious",
    "compromis",
    "supply chain",
    "backdoor",
    "credential",
    "exfiltrat",
    "crypto miner",
    "cryptominer",
    "typosquat",
    "hijack",
    "maintainer",
    "protestware",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Query OSV for advisories about a package or version and flag records "
            "that look like malicious-package or compromise incidents."
        )
    )
    parser.add_argument("--package", help="Package name to query")
    parser.add_argument("--ecosystem", help="OSV ecosystem such as npm")
    parser.add_argument("--version", help="Specific package version")
    parser.add_argument(
        "--input-file",
        type=Path,
        help="Read a saved OSV response from a local JSON file instead of the network",
    )
    return parser.parse_args()


def load_response(args: argparse.Namespace) -> dict[str, object]:
    if args.input_file is not None:
        return json.loads(args.input_file.read_text())

    if not args.package or not args.ecosystem:
        raise SystemExit(
            "Provide --package and --ecosystem, or use --input-file for offline mode."
        )

    payload: dict[str, object] = {
        "package": {"name": args.package, "ecosystem": args.ecosystem}
    }
    if args.version:
        payload["version"] = args.version

    request = urllib.request.Request(
        OSV_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        return json.load(response)


def advisory_is_suspicious(advisory: dict[str, object]) -> bool:
    advisory_id = str(advisory.get("id", ""))
    text_parts = [
        advisory_id,
        str(advisory.get("summary", "")),
        str(advisory.get("details", "")),
    ]
    suspicous_aliases = advisory.get("aliases", [])
    assert isinstance(suspicous_aliases, list)

    for alias in suspicous_aliases:
        text_parts.append(str(alias))
    haystack = " ".join(text_parts).lower()

    return advisory_id.startswith("MAL-") or any(
        term in haystack for term in SUSPICION_TERMS
    )


def main() -> int:
    args = parse_args()
    response = load_response(args)
    vulns = response.get("vulns", [])
    if not isinstance(vulns, list):
        raise SystemExit("OSV response did not contain a vuln list")

    if not vulns:
        print("No advisories found.")
        return 0

    suspicious = False
    for advisory in vulns:
        if not isinstance(advisory, dict):
            continue

        advisory_id = str(advisory.get("id", "unknown"))
        summary = str(advisory.get("summary", "")).strip() or "(no summary)"
        aliases = ", ".join(str(alias) for alias in advisory.get("aliases", []))
        published = str(advisory.get("published", "unknown"))
        is_suspicious = advisory_is_suspicious(advisory)
        suspicious = suspicious or is_suspicious
        label = "SUSPECTED-COMPROMISE" if is_suspicious else "advisory"
        print(f"{label}: {advisory_id}")
        print(f"  summary: {summary}")
        print(f"  published: {published}")
        if aliases:
            print(f"  aliases: {aliases}")

    return 2 if suspicious else 0


if __name__ == "__main__":
    raise SystemExit(main())
