from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
SKILL_ROOT = REPO_ROOT / ".agents/skills/dependency-upgrade-best-practices"
SKILL_CONFIG = json.loads((SKILL_ROOT / "config.json").read_text())
DEFAULT_MINIMUM_RELEASE_AGE_DAYS = SKILL_CONFIG["minimum_release_age_days"]
SCRIPTS_DIR = REPO_ROOT / ".agents/skills/dependency-upgrade-best-practices/scripts"
LIST_NPM_VERSIONS = SCRIPTS_DIR / "list_npm_versions.py"
LIST_SWIFT_PACKAGE_TAGS = SCRIPTS_DIR / "list_swift_package_tags.py"
CHECK_OSV_ADVISORIES = SCRIPTS_DIR / "check_osv_advisories.py"


def run_python_script(script: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(script), *args],
        check=False,
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )


def utc_zulu(days_ago: int) -> str:
    timestamp = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return timestamp.replace(microsecond=0).isoformat().replace("+00:00", "Z")


@contextmanager
def temporary_directory_with_cleanup_retry() -> Path:
    temp_dir = Path(tempfile.mkdtemp())
    try:
        yield temp_dir
    finally:
        for attempt in range(5):
            try:
                shutil.rmtree(temp_dir)
                break
            except OSError as error:
                if error.errno != 66 or attempt == 4:
                    raise
                time.sleep(0.2)


class ListNpmVersionsTests(unittest.TestCase):
    def test_filters_prereleases_and_reports_latest_eligible_using_default_policy(
        self,
    ) -> None:
        metadata = {
            "time": {
                "created": utc_zulu(90),
                "modified": utc_zulu(1),
                "1.0.0": utc_zulu(DEFAULT_MINIMUM_RELEASE_AGE_DAYS + 14),
                "1.1.0": utc_zulu(DEFAULT_MINIMUM_RELEASE_AGE_DAYS + 3),
                "1.2.0": utc_zulu(DEFAULT_MINIMUM_RELEASE_AGE_DAYS - 4),
                "1.3.0-beta.1": utc_zulu(DEFAULT_MINIMUM_RELEASE_AGE_DAYS + 7),
            }
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            metadata_file = Path(temp_dir) / "npm-metadata.json"
            metadata_file.write_text(json.dumps(metadata))

            result = run_python_script(
                LIST_NPM_VERSIONS,
                "demo-package",
                "--metadata-file",
                str(metadata_file),
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("latest_eligible: 1.1.0", result.stdout)
        self.assertIn("1.2.0", result.stdout)
        self.assertIn(
            f"minimum_age_days: {DEFAULT_MINIMUM_RELEASE_AGE_DAYS}",
            result.stdout,
        )
        self.assertIn("too-new", result.stdout)
        self.assertNotIn("1.3.0-beta.1", result.stdout)

    def test_reports_when_no_version_meets_minimum_age(self) -> None:
        metadata = {
            "time": {
                "created": utc_zulu(30),
                "modified": utc_zulu(1),
                "2.0.0": utc_zulu(2),
            }
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            metadata_file = Path(temp_dir) / "npm-metadata.json"
            metadata_file.write_text(json.dumps(metadata))

            result = run_python_script(
                LIST_NPM_VERSIONS,
                "demo-package",
                "--metadata-file",
                str(metadata_file),
                "--min-age-days",
                str(DEFAULT_MINIMUM_RELEASE_AGE_DAYS),
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("latest_eligible: none", result.stdout)
        self.assertIn("2.0.0", result.stdout)


class ListSwiftPackageTagsTests(unittest.TestCase):
    def init_repo(self, repo: Path) -> None:
        subprocess.run(
            ["git", "init"],
            cwd=repo,
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            ["git", "config", "user.email", "test@example.com"],
            cwd=repo,
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test User"],
            cwd=repo,
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            ["git", "config", "gc.auto", "0"],
            cwd=repo,
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            ["git", "config", "gc.autoDetach", "false"],
            cwd=repo,
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            ["git", "config", "maintenance.auto", "false"],
            cwd=repo,
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            ["git", "config", "maintenance.autoDetach", "false"],
            cwd=repo,
            check=True,
            capture_output=True,
            text=True,
        )

    def commit_and_tag(
        self,
        repo: Path,
        filename: str,
        contents: str,
        commit_days_ago: int,
        tag: str,
    ) -> None:
        file_path = repo / filename
        file_path.write_text(contents)
        env = os.environ.copy()
        timestamp = (
            datetime.now(timezone.utc) - timedelta(days=commit_days_ago)
        ).replace(microsecond=0)
        iso_timestamp = timestamp.strftime("%Y-%m-%dT%H:%M:%S+0000")
        env["GIT_AUTHOR_DATE"] = iso_timestamp
        env["GIT_COMMITTER_DATE"] = iso_timestamp
        env["GIT_DISABLE_REPO_GC"] = "1"

        subprocess.run(
            ["git", "add", filename],
            cwd=repo,
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            ["git", "commit", "-m", f"Add {tag} fixture"],
            cwd=repo,
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            ["git", "tag", tag],
            cwd=repo,
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )

    def test_prefers_newest_eligible_stable_tag_using_default_policy(self) -> None:
        with temporary_directory_with_cleanup_retry() as temp_dir:
            repo = temp_dir / "swift-package"
            repo.mkdir()
            self.init_repo(repo)
            self.commit_and_tag(
                repo,
                "Package.swift",
                "// 1.0.0\n",
                DEFAULT_MINIMUM_RELEASE_AGE_DAYS + 20,
                "1.0.0",
            )
            self.commit_and_tag(
                repo,
                "Package.swift",
                "// 1.1.0\n",
                DEFAULT_MINIMUM_RELEASE_AGE_DAYS + 2,
                "1.1.0",
            )
            self.commit_and_tag(
                repo,
                "Package.swift",
                "// prerelease\n",
                DEFAULT_MINIMUM_RELEASE_AGE_DAYS - 2,
                "1.2.0-beta.1",
            )
            self.commit_and_tag(
                repo,
                "README.md",
                "# Notes\n",
                DEFAULT_MINIMUM_RELEASE_AGE_DAYS + 10,
                "release-candidate",
            )

            result = run_python_script(
                LIST_SWIFT_PACKAGE_TAGS,
                str(repo),
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("latest_eligible: 1.1.0", result.stdout)
        self.assertIn("1.0.0", result.stdout)
        self.assertIn(
            f"minimum_age_days: {DEFAULT_MINIMUM_RELEASE_AGE_DAYS}",
            result.stdout,
        )
        self.assertNotIn("1.2.0-beta.1", result.stdout)
        self.assertNotIn("release-candidate", result.stdout)

    def test_includes_prereleases_when_requested(self) -> None:
        with temporary_directory_with_cleanup_retry() as temp_dir:
            repo = temp_dir / "swift-package"
            repo.mkdir()
            self.init_repo(repo)
            self.commit_and_tag(repo, "Package.swift", "// stable\n", 8, "1.0.0")
            self.commit_and_tag(repo, "Package.swift", "// prerelease\n", 2, "1.1.0-beta.1")

            result = run_python_script(
                LIST_SWIFT_PACKAGE_TAGS,
                str(repo),
                "--min-age-days",
                "1",
                "--include-prerelease",
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("latest_eligible: 1.1.0-beta.1", result.stdout)
        self.assertIn("1.1.0-beta.1", result.stdout)

    def test_reads_tags_from_dirty_local_repo(self) -> None:
        with temporary_directory_with_cleanup_retry() as temp_dir:
            repo = temp_dir / "swift-package"
            repo.mkdir()
            self.init_repo(repo)
            self.commit_and_tag(repo, "Package.swift", "// stable\n", 8, "1.0.0")
            (repo / "Package.swift").write_text("// dirty working tree\n")

            result = run_python_script(
                LIST_SWIFT_PACKAGE_TAGS,
                str(repo),
                "--min-age-days",
                "1",
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("latest_eligible: 1.0.0", result.stdout)
        self.assertIn("1.0.0", result.stdout)


class CheckOsvAdvisoriesTests(unittest.TestCase):
    def test_returns_zero_for_non_suspicious_advisory(self) -> None:
        payload = {
            "vulns": [
                {
                    "id": "GHSA-safe-0001",
                    "summary": "Prototype pollution in parser",
                    "published": utc_zulu(14),
                    "aliases": ["CVE-2025-0001"],
                }
            ]
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = Path(temp_dir) / "osv.json"
            fixture.write_text(json.dumps(payload))
            result = run_python_script(
                CHECK_OSV_ADVISORIES,
                "--input-file",
                str(fixture),
            )

        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("advisory: GHSA-safe-0001", result.stdout)
        self.assertNotIn("SUSPECTED-COMPROMISE", result.stdout)

    def test_returns_two_for_suspected_compromise(self) -> None:
        payload = {
            "vulns": [
                {
                    "id": "MAL-2025-demo",
                    "summary": "Malicious package release exfiltrates CI secrets",
                    "published": utc_zulu(3),
                    "aliases": ["GHSA-demo-1234"],
                }
            ]
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = Path(temp_dir) / "osv.json"
            fixture.write_text(json.dumps(payload))
            result = run_python_script(
                CHECK_OSV_ADVISORIES,
                "--input-file",
                str(fixture),
            )

        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("SUSPECTED-COMPROMISE: MAL-2025-demo", result.stdout)
        self.assertIn("exfiltrates CI secrets", result.stdout)


if __name__ == "__main__":
    unittest.main()
