#!/usr/bin/env python3
"""Load shared configuration for the dependency-upgrade skill."""

from __future__ import annotations

import json
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parent.parent
CONFIG_FILE = SKILL_ROOT / "config.json"


def load_config() -> dict[str, int]:
    raw_config = json.loads(CONFIG_FILE.read_text())
    minimum_release_age_days = raw_config.get("minimum_release_age_days")
    if not isinstance(minimum_release_age_days, int):
        raise ValueError(
            "dependency-upgrade skill config must define integer "
            "'minimum_release_age_days'"
        )
    return {"minimum_release_age_days": minimum_release_age_days}


def minimum_release_age_days() -> int:
    return load_config()["minimum_release_age_days"]
