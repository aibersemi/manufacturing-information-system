"""
Normalisasi file generated agar output codegen stabil di Git.
"""

# Template harus identik dengan output generator, termasuk baris signature.
# pylint: disable=line-too-long

import sys
from pathlib import Path

UNSAFE_ORVAL_WITH_QUERY_KEY = """const withQueryKey = <T extends object, K>(query: T, queryKey: K): T & { queryKey: K } => {
  const result = { queryKey } as T & { queryKey: K };
  for (const key of Object.keys(query)) {
    // The explicit queryKey always wins, matching the previous
    // `{ ...query, queryKey }` spread where it was set last.
    if (key === 'queryKey') continue;
    Object.defineProperty(result, key, {
      enumerable: true,
      configurable: true,
      get: () => (query as Record<string, unknown>)[key],
    });
  }
  return result;
};
"""

HARDENED_ORVAL_WITH_QUERY_KEY = """const withQueryKey = <T extends object, K>(query: T, queryKey: K): T & { queryKey: K } => {
  Object.defineProperty(query, 'queryKey', {
    value: queryKey,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return query as T & { queryKey: K };
};
"""


def harden_orval_query_key_helper(content: str) -> str:
    return content.replace(UNSAFE_ORVAL_WITH_QUERY_KEY, HARDENED_ORVAL_WITH_QUERY_KEY)


def normalize_file(path: Path) -> None:
    content = path.read_text(encoding="utf-8")
    normalized = harden_orval_query_key_helper(content).rstrip() + "\n"
    if normalized != content:
        path.write_text(normalized, encoding="utf-8")


def main(paths: list[str]) -> None:
    for raw_path in paths:
        root = Path(raw_path)
        if root.is_file():
            normalize_file(root)
            continue

        for path in root.rglob("*.ts"):
            normalize_file(path)


if __name__ == "__main__":
    main(sys.argv[1:])
