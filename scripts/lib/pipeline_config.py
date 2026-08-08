"""Loads the YAML config files in config/ relative to the repo root."""
from __future__ import annotations

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
CONFIG_DIR = REPO_ROOT / "config"


def load_config() -> dict:
    with (CONFIG_DIR / "pipeline_config.yaml").open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_committee_industry_map() -> dict:
    with (CONFIG_DIR / "committee_industry_map.yaml").open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_name_overrides() -> list[dict]:
    with (CONFIG_DIR / "name_overrides.yaml").open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return data.get("overrides", []) if data else []
