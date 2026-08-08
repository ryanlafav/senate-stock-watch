from lib import name_match

MEMBERS = [
    {"bioguide_id": "A000383", "first_name": "Alan", "last_name": "Armstrong"},
    {"bioguide_id": "M001198", "first_name": "Roger", "last_name": "Marshall"},
    {"bioguide_id": "M000934", "first_name": "Jerry", "last_name": "Moran"},
    {"bioguide_id": "S000148", "first_name": "Charles", "last_name": "Schumer"},
]


def test_exact_match():
    idx = name_match.build_index(MEMBERS, [])
    assert name_match.match_filer("Alan", "Armstrong", idx) == "A000383"


def test_match_ignores_case_and_trailing_whitespace():
    idx = name_match.build_index(MEMBERS, [])
    # real eFD data has trailing double-space last names, e.g. "Moran,  "
    assert name_match.match_filer("jerry", "moran  ", idx) == "M000934"


def test_unique_last_name_fallback():
    idx = name_match.build_index(MEMBERS, [])
    # nickname "Chuck" doesn't match official first name "Charles", but
    # Schumer is a unique last name among current senators
    assert name_match.match_filer("Chuck", "Schumer", idx) == "S000148"


def test_no_match_returns_none():
    idx = name_match.build_index(MEMBERS, [])
    assert name_match.match_filer("Nobody", "Nowhere", idx) is None


def test_override_takes_precedence():
    overrides = [{"efd_name_raw": "Bernie Moreno", "bioguide_id": "M001111"}]
    members = MEMBERS + [{"bioguide_id": "M000000", "first_name": "Bernardo", "last_name": "Moreno"}]
    idx = name_match.build_index(members, overrides)
    assert name_match.match_filer("Bernie", "Moreno", idx) == "M001111"


def test_ambiguous_last_name_without_override_is_unmatched():
    members = MEMBERS + [
        {"bioguide_id": "X1", "first_name": "Pat", "last_name": "Smith"},
        {"bioguide_id": "X2", "first_name": "Chris", "last_name": "Smith"},
    ]
    idx = name_match.build_index(members, [])
    assert name_match.match_filer("Unknownfirst", "Smith", idx) is None
