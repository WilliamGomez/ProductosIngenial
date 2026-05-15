# Refactorización Completada: Eliminar Anti-patrón CSV en Productos

**Fecha:** 2026-05-10  
**Arquitecto de Software:** Sistema de refactorización de datos

---

## Resumen Ejecutivo

Se ha eliminado exitosamente el anti-patrón de guardar listas separadas por comas (CSV) en las columnas `country`, `state` y `city` de la tabla `dbo.Products`. En su lugar, se implementó una relación normalizada donde cada zona geográfica es un registro en `dbo.User_Zones` vinculado a su producto específico mediante `product_id`.

### Cambios Arquitectónicos

- **Antes:** 1 Producto → CSV strings (country, state, city)
- **Después:** 1 Producto → (N) User_Zones con FK a product_id

---

## FASE 1: Base de Datos ✅

### 1.1 `db/init/02_geo_rls.sql` - ACTUALIZADO
**Cambios:**
- Agregada columna `product_id INT NULL` a `dbo.User_Zones`
- Agregada FK: `CONSTRAINT FK_UZ_product FOREIGN KEY (product_id) REFERENCES dbo.Products(id) ON DELETE CASCADE`
- Creados índices compuestos para búsquedas eficientes: `IX_UZ_product_user`
- Actualizado SP `GetUserZonesForProduct()` para recuperar zonas de un producto específico
- Actualizado SP `UpsertUserZonesForProduct()` para upsert de zonas por product_id
- Mantenidos SPs legacy para compatibilidad hacia atrás

**Status:** ✅ Completo - archivo creado/modificado y listo para deploy

### 1.2 `db/init/03_refactor_products_zones.sql` - NUEVO
**Contenido:**
- Alter table `User_Zones` para agregar `product_id` (si no existe)
- Agregar FK a `dbo.Products`
- Crear vista `V_Products_With_Zones` para consultas unificadas
- SP `MigrateProductsCSVToZones()` para migración de datos legacy (dry-run y execute)
- SP `GetUserProductsWithZones()` para recuperar productos + zonas JSON
- SP `UpsertUserProducts()` para MERGE transaccional (productos + zonas en un solo call)

**Status:** ✅ Completo - archivo creado y listo para deploy

### 1.3 `db/init/01_base_schema.sql` - PENDIENTE
**Cambios Necesarios:**
- Eliminar columnas `country`, `state`, `city` de `CREATE TABLE dbo.Products`
- Ajustar INSERT statements para NO incluir esos 3 campos
- Mantener estructura de productos: id, user_id, product_name, contract_duration, duration_unit, amount_cop, enable, created_at

**Status:** ⏳ Requiere revisión manual (archivo de 4500+ líneas)  
**Próximo Paso:** Ejecutar script de migración en SQL Server para aplicar cambios

---

## FASE 2: Backend (Python/Azure Functions) ✅

### 2.1 `domain/models/product.py` - ACTUALIZADO
**Cambios:**
- Agregada clase `UserZone` con campos: `cod_dep`, `cod_mun`, `enable`
- Agregado campo `zones: List[UserZone]` a dataclass `Product`
- Eliminados campos deprecated: `country`, `state`, `city` (comentados para referencia histórica)
- Agregado campo `id: Optional[int]` para rastrear product_id

```python
@dataclass
class UserZone:
    cod_dep: str
    cod_mun: Optional[str] = None
    enable: bool = True

@dataclass
class Product:
    # ... existing fields ...
    zones: List[UserZone] = field(default_factory=list)
    # country, state, city: DEPRECATED (eliminado)
```

**Status:** ✅ Completo

### 2.2 `app/sql/user_products_sql_adapter.py` - NUEVO
**Funcionalidad:**
- Clase `UserProductsSqlAdapter` con métodos:
  - `upsert_user_products_with_zones()`: UPSERT transaccional de productos + zonas
  - `get_user_products_with_zones()`: Recupera productos con JSON de zonas
  - `delete_user_products()`: Desactiva (soft delete) productos
  - `get_product_by_id()`: Recupera producto específico con zonas

**Características:**
- Serialización JSON de productos + zonas para envío al SP `dbo.UpsertUserProducts`
- Validación de consistencia: cod_dep/cod_mun, zonas no vacías si producto habilitado
- Manejo de errores y rollback transaccional

**Status:** ✅ Completo

### 2.3 `use_cases/upsert_user_products.py` - ACTUALIZADO
**Cambios:**
- Refactorizado para recibir productos CON zonas anidadas (NO CSV)
- Nuevo método `execute(user_id, products_data)` que:
  - Valida cada producto y su array de zonas
  - Crea objetos `Product` con `UserZone[]`
  - Delega persistencia a `UserProductsSqlAdapter`
- Logging detallado de operaciones

**Status:** ✅ Completo

### 2.4 `app/functions/http_functions/user_functions.py` - ACTUALIZADO
**Cambios:**
- Actualizado endpoint `PUT /api/user-products/{user_id}`:
  - Ahora espera payload JSON con array de productos + zonas anidadas
  - Usa nuevo `UserProductsSqlAdapter` en lugar del anterior
  - Validación mejorada de JSON structure
  - Documentación inline del formato esperado

**Payload Esperado:**
```json
[
  {
    "id": null,
    "name": "Votometro",
    "contract_duration": 1,
    "duration_unit": "years",
    "enable": true,
    "amount_cop": 150000,
    "zones": [
      {"cod_dep": "05", "cod_mun": null},
      {"cod_dep": "81", "cod_mun": "81001"}
    ]
  }
]
```

**Status:** ✅ Completo

---

## FASE 3: Frontend (React/TypeScript) ✅

### 3.1 `src/services/api.ts` - ACTUALIZADO
**Cambios:**
- Agregadas interfaces:
  - `IProduct` con campo `zones: IUserZone[]` (NO CSV)
  - Documentación mejorada
- Actualizada función `updateUserproducts()`:
  - Signature: `(token, userId, products: IProduct[])`
  - Envía productos CON zonas anidadas directamente
  - Documentación inline del formato JSON esperado

**Status:** ✅ Completo

### 3.2 `src/components/UpdateUser.tsx` - ACTUALIZADO
**Cambios:**
- Actualizada función `handleSubmitProducts()`:
  - Construye array de productos CON zonas anidadas (no CSV)
  - Parsea duración del formato "1 años" → número + unidad
  - Inyecta directamente `votometroZones` y `audivotoZones` en el payload
  - Envía al backend con `updateUserproducts(token, userId, productsToSend)`
- Importado `updateUserproducts` de `api.ts`
- Manejo de errores y loading states

**Lógica de Construcción de Payload:**
```javascript
// ANTES: Generaba CSV strings como "ANTIOQUIA,CAUCA" en campo 'state'
// AHORA: Envía array de zonas
{
  name: "Votometro",
  zones: [
    { cod_dep: "05", cod_mun: null },  // Departamento completo
    { cod_dep: "81", cod_mun: "81001" }  // Municipio específico
  ]
}
```

**Status:** ✅ Completo

---

## Archivos Modificados

| Archivo | Tipo | Estado | Descripción |
|---------|------|--------|-------------|
| `db/init/02_geo_rls.sql` | SQL | ✅ Modificado | Agregada FK product_id, nuevos SPs |
| `db/init/03_refactor_products_zones.sql` | SQL | ✅ Creado | Nuevos SPs y vistas para refactor |
| `db/init/01_base_schema.sql` | SQL | ⏳ Pendiente | Eliminar columnas CSV (requiere revisión) |
| `domain/models/product.py` | Python | ✅ Modificado | Agregada clase UserZone, zone list |
| `app/sql/user_products_sql_adapter.py` | Python | ✅ Creado | Nuevo adaptador SQL para productos + zonas |
| `use_cases/upsert_user_products.py` | Python | ✅ Modificado | Refactorizado para procesar zonas |
| `app/functions/http_functions/user_functions.py` | Python | ✅ Modificado | Endpoint actualizado, import nuevo |
| `src/services/api.ts` | TypeScript | ✅ Modificado | Interfaces y función actualizadas |
| `src/components/UpdateUser.tsx` | React/TS | ✅ Modificado | handleSubmitProducts refactorizada |
| `db/MIGRATION_NOTES.md` | Markdown | ✅ Creado | Documentación de cambios |

---

## Plan de Deployment

### Orden de Ejecución:

1. **Database (SQL Server):**
   ```sql
   -- 1. Ejecutar 02_geo_rls.sql (actualiza User_Zones con product_id FK)
   EXEC sp_executesql @02_geo_rls.sql
   
   -- 2. Ejecutar 03_refactor_products_zones.sql (crea SPs y vista)
   EXEC sp_executesql @03_refactor_products_zones.sql
   
   -- 3. OPCIONAL: Ejecutar migración de datos legacy
   EXEC dbo.MigrateProductsCSVToZones @dry_run = 1   -- Ver cambios
   EXEC dbo.MigrateProductsCSVToZones @dry_run = 0   -- Aplicar
   
   -- 4. Actualizar 01_base_schema.sql (eliminar columnas CSV)
   -- Requiere revisión manual y down + up migration
   ```

2. **Backend (Azure Functions):**
   - Deploy archivos Python modificados
   - Validar imports en `use_cases` y `app/sql`
   - Testear endpoint `PUT /api/user-products/{userId}` con nuevo payload

3. **Frontend (React):**
   - Build y deploy de archivos TypeScript modificados
   - Testear `ProductsSelector` → `UpdateUser` → API flow
   - Validar JSON de productos + zonas en DevTools

---

## Validación Post-Deploy

### Backend:

```python
# Test payload
products = [
    {
        "name": "Votometro",
        "contract_duration": 1,
        "duration_unit": "years",
        "enable": True,
        "amount_cop": 150000,
        "zones": [
            {"cod_dep": "05", "cod_mun": None},
            {"cod_dep": "81", "cod_mun": "81001"}
        ]
    }
]

# Test SQL
EXEC dbo.UpsertUserProducts 
    @user_id = 'USER_UUID',
    @products_json = JSON_ARRAY(...)
```

### Frontend:

```javascript
// Verificar en DevTools que payload es:
// Array of Products con zones array, NO strings CSV
console.log(productsToSend)
// Output: [{name: "Votometro", zones: [{cod_dep, cod_mun}, ...], ...}]
```

### Database:

```sql
-- Verificar estructura
SELECT * FROM dbo.User_Zones WHERE product_id IS NOT NULL
SELECT * FROM dbo.V_Products_With_Zones

-- Verificar FK
EXEC sp_fkeys @pktable_name = 'Products'
```

---

## Notas Importantes

### Compatibilidad Hacia Atrás:
- SPs legacy `GetUserZones()` y `UpsertUserZones()` se mantienen (sin product_id)
- Old adapters `UserSqlAdapter` aún funcionan para consultas que no involucren zonas

### Mitigación de Riesgos:
- Todos los cambios en BD son ADDITIVE (no destructivos)
- Datos legacy en columnas CSV se preservan durante fase 1
- Migración de datos es OPTIONAL y reversible (dry-run first)
- FK `ON DELETE CASCADE` limpia zonas automáticamente si producto se elimina

### Performance:
- Índice `IX_UZ_product_user` optimiza queries de zonas por producto
- JSON serialization en SP es eficiente para volúmenes <1000 productos/usuario
- No hay N+1 queries: SP devuelve JSON anidado

---

## Próximos Pasos (pre-baseline)

1. ✅ **Fases 1-3 completadas:** Código lista para review
2. ✅ **Database Migration:** Scripts SQL ejecutados (Hard Reset 3NF)
3. ✅ **Deployment:** Docker Compose operativo (nginx + backend + mssql)
4. ⏳ **Testing:** Unit tests, integration tests, E2E en ProductsSelector
5. ⏳ **Security hardening:** Ver `AUDITORIA_OWASP_TOP10.md` para prioridades

---

## Contacto

Para preguntas o cambios, consultar con el Arquitecto de Software responsable de esta refactorización.

---

---

# Estabilización y Baseline Pre-Azure

**Fecha:** 2026-05-15
**Autores:** Ingenial AI Engineering

Esta sección documenta los hitos técnicos que llevaron el proyecto a un estado **estable y desplegable** antes del paso a producción en Azure.

---

## 1. Hard Reset de Base de Datos (3NF)

**Problema:** La tabla `dbo.Products` acumulaba columnas heredadas (`country`, `state`, `city`) con listas separadas por comas — un anti-patrón que impedía filtros eficientes, consultas SQL correctas y la aplicación de RLS granular en Power BI.

**Solución aplicada (`db/init/11_hard_reset_schema.sql`):**

Se reestructuró el modelo a Tercera Forma Normal completa:

```
Antes:  Users → Products (1:N, con CSV en country/state/city)

Después:
  dbo.Products        → catálogo maestro (id, name)
  dbo.User_Products   → contratos        (user_id FK, product_id FK, duración, monto, enable)
  dbo.User_Zones      → zonas geográficas (user_product_id FK, cod_dep, cod_mun, enable)
```

La tabla `dbo.User_Zones` vincula las zonas **al contrato** (`user_product_id`), no directamente al usuario. Esto permite que un mismo usuario tenga zonas distintas por producto (Votometro vs Audivoto).

**Impacto:** Todos los adaptadores SQL (`user_products_sql_adapter.py`, `user_zones_sql_adapter.py`), los use cases (`upsert_user_products.py`) y el frontend (`api.ts`, `UpdateUser.tsx`) fueron actualizados para el nuevo esquema.

---

## 2. Corrección Universal UTF-8 y Serialización JSON

**Problema:** El backend de Azure Functions emitía respuestas con mojibake (caracteres especiales corruptos) en cualquier campo que contuviera tildes, ñ, o tipos Python no serializables por defecto (`datetime`, `Decimal`, `UUID`). Las respuestas llegaban al frontend con `\uXXXX` sin decodificar o con errores 500 al serializar.

**Solución (`shared/utils.py` — función `json_response`):**

```python
# Antes: json.dumps(data) → bytes ASCII con \uXXXX + errores con Decimal/datetime
# Después:
body: bytes = json.dumps(
    data,
    ensure_ascii=False,   # tildes y ñ sin escape
    default=str           # datetime / Decimal / UUID como string automáticamente
).encode("utf-8")

return func.HttpResponse(
    body=body,
    status_code=status_code,
    mimetype="application/json; charset=utf-8",
)
```

Todos los endpoints del backend ahora pasan por `json_response()` — ningún HTTP trigger construye la respuesta manualmente.

---

## 3. Estandarización Geográfica DIVIPOLA (2/3 dígitos)

**Problema:** Los códigos DANE de departamento y municipio circulaban con anchos variables entre capas: SQL guardaba `"5"`, Python devolvía `"05"`, y React enviaba `"005"`. Los joins fallaban silenciosamente y el RLS de Power BI no matcheaba.

**Regla canónica implementada en todas las capas:**

| Capa | Implementación |
|------|---------------|
| Python (SQL adapter) | `str(row).strip().zfill(2)` para `cod_dep`; `str(row).strip()[-3:].zfill(3)` para `cod_mun` |
| SQL (SP) | `RIGHT('00' + LTRIM(RTRIM(cod_dep)), 2)` |
| React (api.ts) | Interfaz tipada — los valores vienen ya normalizados del backend |
| Power BI (customData) | Formato `"DD:MMM:"` — 2 chars para dep + 3 chars para mun, separadas por `\|` |

**Ejemplo de `customData`:** `"05:001:|05:002:|81::"` = Medellín + Bello + todo Arauca.

---

## 4. Módulo de Auditoría de Sesiones

**Implementación completa del ciclo de vida de sesión:**

### 4.1. Tablas SQL (08_session_audit.sql, 09_revoke_session.sql, 10_session_detail.sql)

```sql
-- Columnas añadidas a dbo.UserSessions
login_time, last_activity_time, logout_time, status

-- Tabla nueva de telemetría de navegación
dbo.Session_Navigation_Logs (
    log_id BIGINT, session_id FK,
    page_route NVARCHAR(512), time_spent_seconds INT, created_at DATETIME2
)
```

### 4.2. Heartbeat Frontend → Backend

El frontend envía cada 15 segundos:

```typescript
PUT /api/sessions/heartbeat
{ session_token: string, pages: [{ route: string, seconds: number }] }
```

El backend (`SessionSqlAdapter.record_heartbeat()`) registra el tiempo por ruta e invalida la sesión si `idle > 7200s`, devolviendo `401 { code: "SESSION_REVOKED" }`.

### 4.3. Revocación por Administrador

`POST /api/manage/sessions/revoke` permite al Admin invalidar cualquier sesión activa. La ruta usa el prefijo `manage/` (no `admin/`) para evitar conflicto con el namespace reservado de Azure Functions.

### 4.4. Vista de auditoría

`GET /api/manage/sessions/{session_id}/detail` devuelve la sesión completa + historial de navegación para el panel de auditoría del Admin.

---

## 5. Corrección de Rutas Azure Functions (admin/ → manage/)

**Problema:** Azure Functions reserva el prefijo `admin/` para sus endpoints de administración internos. Los endpoints registrados con `route="admin/sessions/..."` generaban el error:

```
The 'GetSessionActivityDetail' function is in error: The specified route conflicts
with one or more built in routes.
```

**Solución:** Renombrado en backend y frontend:

| Antes | Después |
|-------|---------|
| `route="admin/sessions/revoke"` | `route="manage/sessions/revoke"` |
| `route="admin/sessions/{id}/detail"` | `route="manage/sessions/{id}/detail"` |
| `api.post("/admin/sessions/revoke")` | `api.post("/manage/sessions/revoke")` |
| `` api.get(`/admin/sessions/${id}/detail`) `` | `` api.get(`/manage/sessions/${id}/detail`) `` |

---

## 6. Auditoría de Seguridad OWASP Top 10 (2026-05-14)

Se realizó una auditoría white-box completa del proyecto. Resultado: **19 hallazgos** con IDs `HAL-XX`.

| Severidad | Cantidad |
|-----------|---------|
| 🔴 Crítico | 4 |
| 🟠 Alto | 5 |
| 🟡 Medio | 6 |
| 🔵 Bajo | 3 |
| ℹ️ Informativo | 3 |

Ver `AUDITORIA_OWASP_TOP10.md` para el detalle completo y `ROOT_MEMORY.md` para el resumen ejecutivo.

---

## 7. Estado del Baseline (2026-05-15)

```
✅ Docker Compose operativo (nginx + Azure Functions + SQL Server)
✅ Esquema 3NF aplicado y seed de catálogo (Votometro, Audivoto)
✅ Heartbeat de sesiones con telemetría por ruta y timeout 2h
✅ UTF-8 / JSON serialización corregida en todos los endpoints
✅ DIVIPOLA estandarizado en todas las capas (2/3 dígitos)
✅ Power BI RLS con EffectiveIdentity (POWER_BI_DISABLE_RLS=1 para dev)
✅ RBAC dinámico (Roles + Permisos) implementado
✅ Auditoría OWASP Top 10 completada — 4 Críticos identificados

⏳ Hallazgos HAL-01..HAL-17 pendientes de remediar antes de producción
⏳ Tests unitarios e integración pendientes
⏳ CI/CD hacia Azure pendiente de configurar
```
