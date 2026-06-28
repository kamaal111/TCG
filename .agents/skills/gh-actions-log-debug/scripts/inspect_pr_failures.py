#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from typing import Any


def run_command(
    args: list[str], cwd: str, check: bool = True
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=cwd, check=check, capture_output=True, text=True)


def gh_json(args: list[str], cwd: str) -> Any:
    completed = run_command(["gh", *args], cwd=cwd)
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Failed to decode JSON from: {' '.join(args)}") from exc


def gh_text(args: list[str], cwd: str, check: bool = True) -> str:
    completed = run_command(["gh", *args], cwd=cwd, check=check)
    return completed.stdout


def git_text(args: list[str], cwd: str) -> str:
    completed = run_command(["git", *args], cwd=cwd)
    return completed.stdout.strip()


def resolve_pr(repo: str, pr: str | None) -> dict[str, Any]:
    json_fields = "number,url,headRefName,headRefOid,baseRefName,title"
    if pr:
        return gh_json(["pr", "view", pr, "--json", json_fields], repo)
    return gh_json(["pr", "view", "--json", json_fields], repo)


def list_checks(repo: str, pr_selector: str | None) -> list[dict[str, Any]]:
    json_fields = (
        "bucket,completedAt,description,event,link,name,startedAt,state,workflow"
    )
    args = ["pr", "checks"]
    if pr_selector:
        args.append(pr_selector)
    args.extend(["--json", json_fields])
    checks = gh_json(args, repo)
    if not isinstance(checks, list):
        raise RuntimeError("Unexpected gh pr checks response")
    return checks


def list_runs(repo: str, sha: str, limit: int) -> list[dict[str, Any]]:
    json_fields = "databaseId,workflowName,name,status,conclusion,url,createdAt,number,displayTitle,headSha,headBranch,event"
    runs = gh_json(
        ["run", "list", "--commit", sha, "--json", json_fields, "-L", str(limit)], repo
    )
    if not isinstance(runs, list):
        raise RuntimeError("Unexpected gh run list response")
    return runs


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def score_run(check: dict[str, Any], run: dict[str, Any]) -> tuple[int, int]:
    workflow = normalize_text(check.get("workflow"))
    name = normalize_text(check.get("name"))
    run_workflow = normalize_text(run.get("workflowName"))
    run_name = normalize_text(run.get("name"))

    score = 0
    if workflow and workflow == run_workflow:
        score += 3
    if name and name == run_name:
        score += 2
    if workflow and workflow in run_workflow:
        score += 1
    if name and name in run_name:
        score += 1

    run_number = int(run.get("number") or 0)
    return score, run_number


def match_run(
    check: dict[str, Any], runs: list[dict[str, Any]]
) -> dict[str, Any] | None:
    matching_runs = [
        run
        for run in runs
        if run.get("conclusion") == "failure" or run.get("status") != "completed"
    ]
    if not matching_runs:
        matching_runs = runs

    ranked = sorted(matching_runs, key=lambda run: score_run(check, run), reverse=True)
    if not ranked:
        return None
    best = ranked[0]
    if score_run(check, best)[0] == 0 and len(ranked) > 1:
        return None
    return best


def fetch_logs(repo: str, run_id: int) -> str:
    commands = [
        ["run", "view", str(run_id), "--log-failed"],
        ["run", "view", str(run_id), "--log"],
    ]

    for args in commands:
        result = run_command(["gh", *args], cwd=repo, check=False)
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout
    return ""


def extract_snippet(log_text: str, max_lines: int, context: int) -> list[str]:
    lines = log_text.splitlines()
    if not lines:
        return []

    patterns = [
        re.compile(
            r"\b(error|errors|failed|failure|exception|traceback)\b", re.IGNORECASE
        ),
        re.compile(
            r"\b(no such file|command not found|exit code|returned non-zero)\b",
            re.IGNORECASE,
        ),
    ]

    indexes: list[int] = []
    for index, line in enumerate(lines):
        if any(pattern.search(line) for pattern in patterns):
            indexes.append(index)

    if not indexes:
        snippet = lines[-max_lines:]
        return snippet

    first = max(indexes[0] - context, 0)
    last = min(indexes[0] + context + 1, len(lines))
    snippet = lines[first:last]
    if len(snippet) > max_lines:
        snippet = snippet[:max_lines]
    return snippet


def ensure_auth(repo: str) -> None:
    result = run_command(["gh", "auth", "status"], cwd=repo, check=False)
    if result.returncode != 0:
        message = (
            result.stderr.strip() or result.stdout.strip() or "gh auth status failed"
        )
        raise RuntimeError(message)


def build_report(
    repo: str, pr: str | None, max_runs: int, max_lines: int, context: int
) -> dict[str, Any]:
    ensure_auth(repo)

    pr_info = resolve_pr(repo, pr)
    pr_selector = str(pr_info["number"])
    head_sha = pr_info["headRefOid"]
    checks = list_checks(repo, pr_selector)
    runs = list_runs(repo, head_sha, max_runs)

    failures: list[dict[str, Any]] = []
    for check in checks:
        if check.get("bucket") != "fail":
            continue

        run = match_run(check, runs)
        log_text = fetch_logs(repo, int(run["databaseId"])) if run else ""
        failures.append(
            {
                "check": check,
                "run": run,
                "snippet": extract_snippet(
                    log_text, max_lines=max_lines, context=context
                ),
            }
        )

    return {
        "repo": git_text(["remote", "get-url", "origin"], repo),
        "branch": git_text(["branch", "--show-current"], repo),
        "head_sha": head_sha,
        "pr": pr_info,
        "failures": failures,
    }


def print_text_report(report: dict[str, Any]) -> None:
    pr = report["pr"]
    print(f"PR #{pr['number']}: {pr['title']}")
    print(f"URL: {pr['url']}")
    print(f"Branch: {pr['headRefName']} -> {pr['baseRefName']}")
    print(f"Head SHA: {report['head_sha']}")

    failures = report["failures"]
    if not failures:
        print("No failing GitHub Actions checks found for the current PR head.")
        return

    for failure in failures:
        check = failure["check"]
        run = failure["run"]
        print("")
        print(f"Check: {check.get('name')}")
        print(f"Workflow: {check.get('workflow')}")
        print(f"State: {check.get('state')} ({check.get('bucket')})")
        if check.get("link"):
            print(f"Check URL: {check['link']}")
        if run:
            print(f"Run ID: {run.get('databaseId')}")
            print(f"Run URL: {run.get('url')}")
            print(f"Run Status: {run.get('status')} / {run.get('conclusion')}")
        else:
            print("Run match: not found")

        snippet = failure["snippet"]
        if snippet:
            print("Log snippet:")
            for line in snippet:
                print(line)
        else:
            print("Log snippet: unavailable")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Inspect failing GitHub Actions checks for a PR using gh."
    )
    parser.add_argument("--repo", default=".", help="Repository path")
    parser.add_argument(
        "--pr",
        default=None,
        help="PR number, URL, or branch. Defaults to current branch PR.",
    )
    parser.add_argument(
        "--max-runs",
        type=int,
        default=30,
        help="Maximum workflow runs to inspect for the head SHA.",
    )
    parser.add_argument(
        "--max-lines",
        type=int,
        default=80,
        help="Maximum snippet lines to print per failure.",
    )
    parser.add_argument(
        "--context",
        type=int,
        default=20,
        help="Lines of context around the first likely failure.",
    )
    parser.add_argument(
        "--json", action="store_true", help="Print JSON instead of a text report."
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo = os.path.abspath(args.repo)

    try:
        report = build_report(
            repo, args.pr, args.max_runs, args.max_lines, args.context
        )
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.strip()
        stdout = exc.stdout.strip()
        message = stderr or stdout or str(exc)
        print(message, file=sys.stderr)
        return exc.returncode or 1
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print_text_report(report)

    return 1 if report["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
