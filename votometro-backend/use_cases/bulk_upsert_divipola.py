"""Bulk upsert for Registraduria electoral DIVIPOLA CSV files."""

import csv as _csv
import logging
import re
import unicodedata
from io import BytesIO
from typing import Any, List

import pandas as pd

from domain.models.divipola import DivipolaEntry
from domain.repositories.divipola_sql_repository import IDivipolaSqlRepository


_POS_COD_ELECCION = 0
_POS_DEP = 1
_POS_NOM_DEP = 2
_POS_MUN = 3
_POS_NOM_MUN = 4
_POS_ZZ = 5
_POS_PP = 6
_POS_NOM_PUESTO = 7

_HEADER_ALIASES = {
    "cod_eleccion": "cod_eleccion",
    "eleccion": "cod_eleccion",
    "dep": "dep",
    "cod_dep": "dep",
    "coddep": "dep",
    "codigo_dep": "dep",
    "codigo_departamento": "dep",
    "cod_departamento": "dep",
    "dpto": "dep",
    "nom_dep": "nom_dep",
    "nomdep": "nom_dep",
    "nombre_dep": "nom_dep",
    "nombre_departamento": "nom_dep",
    "departamento": "nom_dep",
    "nom_dpto": "nom_dep",
    "mun": "mun",
    "cod_mun": "mun",
    "codmun": "mun",
    "codigo_mun": "mun",
    "codigo_municipio": "mun",
    "cod_municipio": "mun",
    "mpio": "mun",
    "cod_mpio": "mun",
    "nom_mun": "nom_mun",
    "nommun": "nom_mun",
    "nombre_mun": "nom_mun",
    "nombre_municipio": "nom_mun",
    "municipio": "nom_mun",
    "nom_mpio": "nom_mun",
    "zz": "zz",
    "zona": "zz",
    "pp": "pp",
    "puesto": "pp",
    "nom_puesto": "nom_puesto",
    "nombre_puesto": "nom_puesto",
    "puesto_votacion": "nom_puesto",
}


def _normalize_header(value: str) -> str:
    nfkd = unicodedata.normalize("NFKD", str(value or ""))
    ascii_only = nfkd.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "_", ascii_only.lower()).strip("_")


def _first_row_looks_like_header(first_row: pd.Series) -> bool:
    if len(first_row) <= _POS_NOM_MUN:
        return False
    candidate = str(first_row.iloc[_POS_DEP]).strip().strip('"').strip("'")
    return not candidate.isdigit() and bool(re.search(r"[a-zA-Z]", candidate))


def _optional_col(data: pd.DataFrame, idx: int) -> pd.Series:
    if data.shape[1] > idx:
        return data.iloc[:, idx].astype(str)
    return pd.Series([""] * len(data), dtype=str)


def _series_or_empty(value: Any, length: int) -> pd.Series:
    if isinstance(value, pd.Series):
        return value.astype(str)
    return pd.Series([str(value or "")] * length, dtype=str)


class BulkUpsertDivipolaUseCase:
    def __init__(self, repo: IDivipolaSqlRepository):
        self._repo = repo

    def execute(self, csv_bytes: bytes, replace: bool = False) -> dict:
        if not csv_bytes:
            raise ValueError("El archivo CSV esta vacio.")

        df = None
        last_err = None
        for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
            try:
                df = pd.read_csv(
                    BytesIO(csv_bytes),
                    dtype=str,
                    encoding=enc,
                    sep=",",
                    header=None,
                    engine="python",
                    keep_default_na=False,
                    quoting=_csv.QUOTE_NONE,
                    on_bad_lines="skip",
                )
                break
            except Exception as exc:
                last_err = exc

        if df is None or df.empty:
            raise ValueError(f"No se pudo parsear el CSV: {last_err}")

        has_header = _first_row_looks_like_header(df.iloc[0])
        if has_header:
            header_row = df.iloc[0].tolist()
            idx_by_canonical = {}
            for col_idx, header in enumerate(header_row):
                canonical = _HEADER_ALIASES.get(_normalize_header(header))
                if canonical and canonical not in idx_by_canonical:
                    idx_by_canonical[canonical] = col_idx

            missing = {"dep", "nom_dep", "mun", "nom_mun"} - idx_by_canonical.keys()
            if missing:
                raise ValueError(
                    f"El CSV trae header pero le faltan columnas: {sorted(missing)}. "
                    f"Headers detectados: {header_row[:25]}"
                )

            data = df.iloc[1:].reset_index(drop=True)
            cod_eleccion_col = (
                data.iloc[:, idx_by_canonical["cod_eleccion"]]
                if "cod_eleccion" in idx_by_canonical
                else ""
            )
            dep_col = data.iloc[:, idx_by_canonical["dep"]]
            nom_dep_col = data.iloc[:, idx_by_canonical["nom_dep"]]
            mun_col = data.iloc[:, idx_by_canonical["mun"]]
            nom_mun_col = data.iloc[:, idx_by_canonical["nom_mun"]]
            zz_col = data.iloc[:, idx_by_canonical["zz"]] if "zz" in idx_by_canonical else ""
            pp_col = data.iloc[:, idx_by_canonical["pp"]] if "pp" in idx_by_canonical else ""
            nom_puesto_col = (
                data.iloc[:, idx_by_canonical["nom_puesto"]]
                if "nom_puesto" in idx_by_canonical
                else ""
            )
        else:
            required_cols = _POS_NOM_MUN + 1
            if df.shape[1] < required_cols:
                raise ValueError(
                    f"El CSV tiene {df.shape[1]} columnas; se esperaban al menos {required_cols}."
                )

            data = df
            cod_eleccion_col = _optional_col(data, _POS_COD_ELECCION)
            dep_col = data.iloc[:, _POS_DEP]
            nom_dep_col = data.iloc[:, _POS_NOM_DEP]
            mun_col = data.iloc[:, _POS_MUN]
            nom_mun_col = data.iloc[:, _POS_NOM_MUN]
            zz_col = _optional_col(data, _POS_ZZ)
            pp_col = _optional_col(data, _POS_PP)
            nom_puesto_col = _optional_col(data, _POS_NOM_PUESTO)

        out = pd.DataFrame(
            {
                "cod_eleccion": _series_or_empty(cod_eleccion_col, len(data)),
                "dep": dep_col.astype(str),
                "nom_dep": nom_dep_col.astype(str),
                "mun": mun_col.astype(str),
                "nom_mun": nom_mun_col.astype(str),
                "zz": _series_or_empty(zz_col, len(data)),
                "pp": _series_or_empty(pp_col, len(data)),
                "nom_puesto": _series_or_empty(nom_puesto_col, len(data)),
            }
        )

        for column in out.columns:
            out[column] = out[column].str.strip().str.strip('"').str.strip("'").str.strip()

        out["cod_eleccion"] = out["cod_eleccion"].replace("", "0")
        out["dep"] = out["dep"].str.zfill(2)
        out["mun"] = out["mun"].str.zfill(3)
        out["zz"] = out["zz"].where(out["zz"] == "", out["zz"].str.zfill(2))
        out["pp"] = out["pp"].where(out["pp"] == "", out["pp"].str.zfill(2))

        out = out[out["dep"].str.match(r"^\d{2}$", na=False)]
        out = out[out["mun"].str.match(r"^\d{3}$", na=False)]
        out = out[out["nom_dep"].str.len() > 0]
        out = out[out["nom_mun"].str.len() > 0]
        out = out.drop_duplicates(
            subset=["cod_eleccion", "dep", "mun", "zz", "pp", "nom_puesto"],
            keep="last",
        )

        if out.empty:
            raise ValueError("Tras la validacion no quedaron filas validas.")

        entries: List[DivipolaEntry] = [
            DivipolaEntry(
                cod_eleccion=row.cod_eleccion,
                dep=row.dep,
                nom_dep=row.nom_dep,
                mun=row.mun,
                nom_mun=row.nom_mun,
                zz=row.zz,
                pp=row.pp,
                nom_puesto=row.nom_puesto,
            )
            for row in out.itertuples(index=False)
        ]

        if replace:
            logging.info("[BulkUpsertDivipola] mode=replace -> truncate before insert")
            self._repo.truncate()

        result = self._repo.bulk_upsert(entries)
        result["header_detected"] = has_header
        result["rows_in_csv"] = int(df.shape[0]) - (1 if has_header else 0)
        logging.info("[BulkUpsertDivipola] %s", result)
        return result
