#!/usr/bin/env python3
"""Sanitiza un dump de Azure SQL DB para que corra en SQL Server 2022 local.

Cambios aplicados:
  1. `CREATE DATABASE ... (EDITION=..., SERVICE_OBJECTIVE=..., MAXSIZE=...)`
     → `CREATE DATABASE [<name>]`
  2. `WITH CATALOG_COLLATION = ..., LEDGER = OFF` (Azure-only) → removido.
  3. `ALTER DATABASE ... SET AUTOMATIC_INDEX_COMPACTION` → comentado.
  4. `ALTER DATABASE ... SET ENCRYPTION ON` → comentado (requiere TDE +
     Enterprise/Developer; lo dejamos fuera en dev local).
  5. `ALTER DATABASE ... SET QUERY_STORE = ON` → comentado (Azure sintaxis
     difiere ligeramente; se puede re-habilitar en SQL 2022 a mano).
  6. Inserta `USE [<db>]` después del CREATE DATABASE para asegurar contexto.

Uso:
    python3 db/sanitize.py db/init/_raw_azure.sql db/init/01_schema.sql
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

AZURE_COMMENT_PATTERNS = [
    re.compile(r"^\s*ALTER DATABASE .* SET AUTOMATIC_INDEX_COMPACTION\b.*$", re.IGNORECASE),
    re.compile(r"^\s*ALTER DATABASE .* SET ENCRYPTION\b.*$", re.IGNORECASE),
    re.compile(r"^\s*ALTER DATABASE .* SET QUERY_STORE\b.*$", re.IGNORECASE),
]

CREATE_DB_RE = re.compile(
    r"^\s*CREATE\s+DATABASE\s+\[([^\]]+)\]\s*(.*?);\s*$",
    re.IGNORECASE,
)


def main(in_path: str, out_path: str) -> None:
    src = Path(in_path).read_text(encoding="utf-8")
    out_lines: list[str] = []
    db_name: str | None = None
    inserted_use = False

    header = (
        "-- =====================================================================\n"
        "-- Schema sanitizado para SQL Server 2022 container (Votometro dev).\n"
        "-- Generado por db/sanitize.py — NO editar a mano.\n"
        "-- Fuente: dump de Azure SQL DB (UTF-16 LE convertido a UTF-8).\n"
        "-- =====================================================================\n"
    )
    out_lines.append(header)

    for raw in src.splitlines():
        line = raw

        # 1. CREATE DATABASE — reescribir.
        m = CREATE_DB_RE.match(line)
        if m:
            db_name = m.group(1)
            out_lines.append(f"IF DB_ID(N'{db_name}') IS NULL")
            out_lines.append(f"    CREATE DATABASE [{db_name}];")
            continue

        # 2. Opciones Azure-only → comentar.
        if any(p.match(line) for p in AZURE_COMMENT_PATTERNS):
            out_lines.append(f"-- [sanitize] {line.strip()}")
            continue

        # 3. Inyectar USE [db] tras el primer GO posterior al CREATE.
        if not inserted_use and db_name and line.strip().upper() == "GO":
            out_lines.append(line)
            out_lines.append(f"USE [{db_name}];")
            out_lines.append("GO")
            inserted_use = True
            continue

        out_lines.append(line)

    Path(out_path).write_text("\n".join(out_lines) + "\n", encoding="utf-8")
    print(f"[sanitize] wrote {out_path} ({len(out_lines)} lines, db={db_name})")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: sanitize.py <input.sql> <output.sql>", file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
