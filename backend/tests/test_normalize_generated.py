from scripts.normalize_generated import (
    HARDENED_ORVAL_WITH_QUERY_KEY,
    UNSAFE_ORVAL_WITH_QUERY_KEY,
    harden_orval_query_key_helper,
    normalize_file,
)


def test_harden_orval_query_key_helper_removes_dynamic_bracket_access():
    content = f"prefix\n{UNSAFE_ORVAL_WITH_QUERY_KEY}\nsuffix\n"

    hardened = harden_orval_query_key_helper(content)

    assert HARDENED_ORVAL_WITH_QUERY_KEY in hardened
    assert "(query as Record<string, unknown>)[key]" not in hardened
    assert "Object.keys(query)" not in hardened


def test_normalize_file_hardens_generated_typescript(tmp_path):
    path = tmp_path / "health.ts"
    path.write_text(f"{UNSAFE_ORVAL_WITH_QUERY_KEY}\n\n", encoding="utf-8")

    normalize_file(path)

    content = path.read_text(encoding="utf-8")
    assert content == HARDENED_ORVAL_WITH_QUERY_KEY
