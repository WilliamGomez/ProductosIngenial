from dataclasses import dataclass


@dataclass
class DivipolaEntry:
    """Fila del catalogo electoral DIVIPOLA de Registraduria.

    `mun` es el codigo local de 3 digitos. Para el contrato de la app,
    cod_mun = dep + mun.
    """

    cod_eleccion: str
    dep: str
    nom_dep: str
    mun: str
    nom_mun: str
    zz: str = ""
    pp: str = ""
    nom_puesto: str = ""

    @property
    def cod_dep(self) -> str:
        return self.dep

    @property
    def cod_mun(self) -> str:
        return f"{self.dep}{self.mun}"
