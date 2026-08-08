"""Join eFD PTR filer names to a bioguide_id from congress-legislators.

eFD search result rows give filer first/last name as separate columns (e.g.
"Alan" / "Armstrong"). This is matched against each current senator's official
first/last name from congress-legislators. Real-world wrinkles observed
against the live site: a filer's eFD first name can be a nickname that
differs from their official name (e.g. "Bernie" vs. official "Bernardo"
Moreno), so exact matches are supplemented by `config/name_overrides.yaml` for
anything that doesn't resolve automatically. Unmatched names are never
silently dropped - they're returned separately so the caller can log them as
warnings for a human to add an override.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def normalize(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = s.lower().strip()
    s = re.sub(r"[.,]", "", s)
    s = re.sub(r"\s+", " ", s)
    tokens = [t for t in s.split(" ") if t not in _SUFFIXES]
    return " ".join(tokens)


@dataclass
class NameIndex:
    full_name_to_bioguide: dict[str, str]
    last_name_to_bioguides: dict[str, list[str]]
    override_map: dict[str, str]


def build_index(members: list[dict], overrides: list[dict]) -> NameIndex:
    full_name_to_bioguide: dict[str, str] = {}
    last_name_to_bioguides: dict[str, list[str]] = {}

    for m in members:
        key = normalize(f"{m['first_name']} {m['last_name']}")
        full_name_to_bioguide[key] = m["bioguide_id"]
        last_key = normalize(m["last_name"])
        last_name_to_bioguides.setdefault(last_key, []).append(m["bioguide_id"])

    override_map = {
        normalize(o["efd_name_raw"]): o["bioguide_id"] for o in overrides
    }

    return NameIndex(full_name_to_bioguide, last_name_to_bioguides, override_map)


def match_filer(first_name: str, last_name: str, index: NameIndex) -> str | None:
    raw_combo = normalize(f"{first_name} {last_name}")

    if raw_combo in index.override_map:
        return index.override_map[raw_combo]

    if raw_combo in index.full_name_to_bioguide:
        return index.full_name_to_bioguide[raw_combo]

    # Fallback: unique last-name match (only trust this when there's exactly
    # one current senator with that last name, to avoid mis-joining e.g. two
    # senators who happen to share a surname).
    last_key = normalize(last_name)
    candidates = index.last_name_to_bioguides.get(last_key, [])
    if len(candidates) == 1:
        return candidates[0]

    return None
