# Power BI · Reglas DAX para Row-Level Security (RLS)

Fecha: 2026-04-23  
Autores: Data Platform + Backend  
Referencias: `GEO_RLS_DATA_PATH.md`, `use_cases/power_bi_data.py`,
`app/power_bi/power_bi_adapter.py`.

Este documento es **prescriptivo** para el equipo de Power BI: indica los
roles que deben existir en cada `.pbix` y las expresiones DAX que deben
copiarse literalmente para que el embed token emitido por el backend aplique
aislamiento geográfico server-side.

> **Regla operativa**: cualquier publicación nueva de un `.pbix` al workspace
> "Votometro" debe verificar que los roles `Admin` y `GeoScope` existen y
> pasan la prueba de "View as role" antes de mergear a `main`.

---

## 1. Esquema del modelo

El modelo debe contener las dimensiones geográficas canónicas. Los nombres
de columna son sensibles a mayúsculas y deben coincidir con el bind de
`claims.User_Zones_RLS` emitido por el backend.

| Tabla          | Columna clave | Tipo   | Observaciones                                  |
| -------------- | ------------- | ------ | ---------------------------------------------- |
| `Departments`  | `cod_dep`     | string | PK natural del departamento.                   |
| `Municipalities` | `cod_mun`   | string | FK → `Departments.cod_dep`.                    |
| `Zones`        | `cod_zona`    | string | FK → `Municipalities.cod_mun` (+ `cod_dep`).   |

Tablas de hechos (`Votes`, `Mesas`, `Audios`…) se relacionan con `Zones` por
`cod_zona` (y a `Municipalities`/`Departments` por propagación). Todo filtro
aplicado a la dimensión geográfica se propaga a los hechos vía
`CROSSFILTER` estándar.

---

## 2. Bind table emitida por el backend

`PowerBIUseCase.execute_for_user` inyecta en la `EffectiveIdentity` una
tabla virtual llamada **`User_Zones_RLS`** con tres columnas:

```
cod_dep  | cod_mun  | cod_zona
---------|----------|---------
"11"     | ""       | ""        ← scope DEPARTMENT (todo Bogotá)
"76"     | "76001"  | ""        ← scope MUNICIPALITY (Cali entero)
"08"     | "08001"  | "BRQ-07"  ← scope ZONE (zona específica)
```

Las filas con columnas vacías representan *wildcards ascendentes*: una
fila con `cod_mun=""` y `cod_zona=""` significa "todo el departamento".

En DAX esta tabla se referencia como:

```DAX
VAR __UserZones = SELECTCOLUMNS( 'User_Zones_RLS',
    "ud", [cod_dep], "um", [cod_mun], "uz", [cod_zona] )
```

---

## 3. Rol **GeoScope** — usuarios estándar

Aplicar el filtro a **`Zones`** (la tabla con cardinalidad más baja desde la
que se puede filtrar toda la cadena geográfica hacia los hechos).

### 3.1 Expresión DAX (vía A — `claims` / bind table, recomendada)

Pegar como *Table filter DAX expression* sobre la tabla **`Zones`**:

```DAX
VAR __Zones = 'User_Zones_RLS'
RETURN
COUNTROWS(
    FILTER(
        __Zones,
        ( [cod_dep] = Zones[cod_dep] || [cod_dep] = "" )
        && ( [cod_mun] = Zones[cod_mun] || [cod_mun] = "" )
        && ( [cod_zona] = Zones[cod_zona] || [cod_zona] = "" )
    )
) > 0
```

Razonamiento: cada fila de `Zones` se compara contra todas las filas
autorizadas; si alguna coincide (permitiendo wildcard `""` en cualquier
nivel), la fila pasa el filtro.

### 3.2 Expresión DAX (vía B — `CUSTOMDATA()`, respaldo ≤ 1024 bytes)

Si un `.pbix` heredado no puede consumir bind tables, se usa
`CUSTOMDATA()` con el CSV `cod_dep:cod_mun:cod_zona|...` producido por
`PowerBIUseCase._encode_custom_data`.

```DAX
VAR __Custom = CUSTOMDATA()
VAR __Scope  =
    Zones[cod_dep] & ":" & Zones[cod_mun] & ":" & Zones[cod_zona]
VAR __Dep    = Zones[cod_dep] & "::"
VAR __Mun    = Zones[cod_dep] & ":" & Zones[cod_mun] & ":"
RETURN
    NOT ISBLANK(__Custom)
    && (
        PATHCONTAINS( SUBSTITUTE(__Custom, "|", "|"), __Scope )
        || PATHCONTAINS( SUBSTITUTE(__Custom, "|", "|"), __Dep )
        || PATHCONTAINS( SUBSTITUTE(__Custom, "|", "|"), __Mun )
    )
```

> Limitación: `PATHCONTAINS` opera sobre un separador `|`, por lo que
> cualquier cambio al formato del CSV debe reflejarse aquí. **Vía A es
> preferida**; vía B solo se activa si la vía A falla en el renderizado.

### 3.3 Validación manual ("View as role")

1. Modelar → "View as" → **Others** → role: `GeoScope`.
2. En **Others** agregar un `User_Zones_RLS` con una fila de prueba.
3. Verificar que las visualizaciones muestran únicamente el scope declarado.
4. Repetir con `cod_mun=""` y `cod_zona=""` para verificar wildcards.

---

## 4. Rol **Admin** — sin filtros

Rol vacío (filtro `TRUE`) sobre `Zones`:

```DAX
TRUE
```

La identidad efectiva para usuarios con `role == "Admin"` se envía con
`roles=["Admin"]` y `customData="admin"` (no contiene `claims`). Por
contrato el rol Admin **no debe aplicar ningún filtro**; cualquier otro
comportamiento es un bug de modelo.

---

## 5. Publicación de un reporte nuevo

Checklist al publicar un `.pbix` nuevo al workspace Votometro:

1. [ ] El modelo contiene `Departments`, `Municipalities`, `Zones` con las
       columnas canónicas y relaciones activas.
2. [ ] Rol **`GeoScope`** creado sobre `Zones` con DAX de §3.1 (preferido)
       o §3.2 (fallback).
3. [ ] Rol **`Admin`** creado sobre `Zones` con `TRUE`.
4. [ ] "View as role" validado con tres casos: wildcard de departamento,
       de municipio y zona exacta.
5. [ ] GUID del reporte agregado a `REPORT_TO_PRODUCT_MAP` en
       `use_cases/power_bi_data.py` (regla 5 de `BACKEND_MEM.md`).
6. [ ] Prueba smoke: `GET /power-bi/{reportId}` con Bearer de un usuario
       con zonas asignadas devuelve 200 y el dashboard muestra solo esas
       zonas.
7. [ ] Prueba de regresión: el mismo usuario sin zonas asignadas ve
       **cero filas** (no el universo completo).

---

## 6. Debugging rápido

| Síntoma                                       | Causa probable                                                                                  | Fix                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Usuario ve todos los datos                    | Rol `GeoScope` no aplicado o modelo no propaga filtro `Zones → facts`.                          | Revisar relaciones activas; re-ejecutar "View as role".      |
| Usuario ve *nada* pese a tener zonas          | Nombres de columna desalineados (`cod_dep` vs `CodDep`).                                        | Renombrar en el modelo; el bind es case-sensitive.           |
| Error `The role 'GeoScope' does not exist`    | El `.pbix` publicado no contiene el rol.                                                        | Abrir en Desktop, crear rol, re-publicar.                    |
| Token emitido pero reporte falla al renderizar | `customData` > 1024 bytes (truncado) o caracteres inválidos.                                   | Usar vía A (bind table) o reducir zonas por usuario.         |

---

Sources:

- [GEO_RLS_DATA_PATH.md](computer:///sessions/optimistic-focused-franklin/mnt/Votometro/GEO_RLS_DATA_PATH.md)
- [power_bi_data.py](computer:///sessions/optimistic-focused-franklin/mnt/Votometro/votometro-backend/use_cases/power_bi_data.py)
- [power_bi_adapter.py](computer:///sessions/optimistic-focused-franklin/mnt/Votometro/votometro-backend/app/power_bi/power_bi_adapter.py)
