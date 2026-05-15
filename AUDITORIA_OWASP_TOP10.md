# AUDITORÍA DE SEGURIDAD — OWASP TOP 10
## Proyecto: Votometro (White-Box Security Review)

**Fecha:** 2026-05-15  
**Alcance:** Backend (Python/Azure Functions), Frontend (React/TypeScript), SQL Server, Infraestructura Docker  
**Metodología:** Análisis estático de caja blanca (SAST + revisión arquitectónica)  
**Clasificador de Riesgo:** CVSS v3.1 cualitativo

---

## RESUMEN EJECUTIVO

| Nivel | Cantidad |
|-------|----------|
| 🔴 Crítico | 4 |
| 🟠 Alto | 5 |
| 🟡 Medio | 6 |
| 🟢 Bajo | 3 |
| ℹ️ Informativo | 3 |

**Los hallazgos más graves son:** la ausencia total de autenticación en los endpoints de gestión de usuarios (permite a cualquier cliente anónimo leer, crear y modificar usuarios), el kill switch de RLS que concede acceso irrestricto a todos los datos de Power BI, y la exposición directa del puerto 7071 del backend (bypass completo de nginx y sus controles de seguridad).

---

## HALLAZGOS DETALLADOS

---

### A01 — BROKEN ACCESS CONTROL (Control de Acceso)

---

#### HAL-01 🔴 CRÍTICO — Ausencia total de autenticación en endpoints de gestión de usuarios

**Archivos afectados:**
- `votometro-backend/app/functions/http_functions/user_functions.py` — líneas 42-320 (todas las funciones)

**Descripción técnica:**

Los siguientes endpoints operan con `auth_level=func.AuthLevel.ANONYMOUS` y **no ejecutan ninguna verificación de JWT ni de rol** antes de procesar la petición:

| Método | Ruta | Operación |
|--------|------|-----------|
| `POST` | `/api/user` | Crear usuario en Azure AD + SQL |
| `GET` | `/api/user` | Listar todos los usuarios |
| `GET` | `/api/user/{user_id}` | Obtener detalle de cualquier usuario |
| `PUT` | `/api/user/{user_id}` | Modificar cualquier usuario (incluido su rol) |
| `PUT` | `/api/user/{user_id}/zones` | Reasignar zonas geográficas de cualquier usuario |
| `PUT` | `/api/user-products/{user_id}` | Modificar contratos de productos |

A diferencia del módulo `admin_functions.py` (que sí implementa `_require_admin`), ninguno de estos handlers valida el Bearer token ni comprueba si el llamante existe en la base de datos. Cualquier cliente HTTP sin credenciales puede ejecutar estas operaciones.

```python
# user_functions.py línea 84 — sin ninguna validación de identidad
@users_bp.route(route="user", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def list_users(req: func.HttpRequest) -> func.HttpResponse:
    # ← No hay decode_token(), no hay verificación de rol
    sql_repo = UserSqlAdapter()
    use_case = ListUsersUseCase(sql_repo)
    users = use_case.execute()  # Devuelve TODOS los usuarios
```

**Remediación:**

Aplicar el mismo patrón que `admin_functions.py` en todos los endpoints sensibles: verificar el Bearer token con `decode_token()`, resolver el `oid` del llamante, consultar su rol en SQL, y retornar 401/403 si no cumple el requisito. Para endpoints que modifican datos de un usuario específico, verificar además que `caller_oid == user_id` (o que el caller sea Admin).

---

#### HAL-02 🔴 CRÍTICO — IDOR: Cualquier usuario autenticado puede leer y modificar datos de cualquier otro usuario

**Archivos afectados:**
- `votometro-backend/app/functions/http_functions/user_functions.py` — líneas 112-139, 144-201, 212-253, 265-319

**Descripción técnica:**

Aunque se corrigiera la ausencia de autenticación (HAL-01), el diseño actual no implementa ninguna verificación de ownership. Un usuario autenticado podría enviar `GET /api/user/OTRO_UUID` para obtener el perfil completo de cualquier otro usuario del sistema, o `PUT /api/user/OTRO_UUID` para modificar su rol, email, estado (enable/disable) y datos de identidad.

```python
# user_functions.py línea 158-161
user_id = req.route_params.get("user_id")  # Proviene del path — sin validar
user = User(
    id=user_id,
    role=data.get("role"),  # El llamante puede asignarse el rol "Admin"
    ...
)
```

Este es un Insecure Direct Object Reference (IDOR) clásico. La combinación con HAL-01 lo convierte en un vector de escalada de privilegios horizontal y vertical.

**Remediación:**

En endpoints que operan sobre recursos de un usuario específico, tras verificar el JWT, comparar el `oid` del token con el `user_id` de la ruta: si no coinciden y el rol del llamante no es `Admin`, rechazar con 403.

---

#### HAL-03 🟠 ALTO — Endpoint de carga DIVIPOLA sin autenticación ni autorización

**Archivos afectados:**
- `votometro-backend/app/functions/http_functions/divipola_functions.py` — líneas 97-136

**Descripción técnica:**

El endpoint `POST /api/divipola/upload` permite subir un CSV y reemplazar el catálogo geográfico electoral completo (`dbo.DIVIPOLA`). El modo `?mode=replace` trunca la tabla antes de insertar. El propio código documenta el problema con un comentario:

```python
# divipola_functions.py línea 101
auth_level=func.AuthLevel.ANONYMOUS,   # TODO: envolver con _require_admin antes de prod
```

Un atacante externo podría vaciar o corromper el catálogo DIVIPOLA, afectando los filtros RLS de Power BI y la integridad de toda la información geográfica del sistema electoral.

**Remediación:**

Envolver el handler con `_require_admin` (ya implementado en `admin_functions.py`) antes de continuar en producción. Adicionalmente, validar el contenido del CSV contra el esquema esperado y limitar el tamaño máximo del archivo.

---

#### HAL-04 🟠 ALTO — Sesiones de Admin: validación de sesión activa solo en Power BI

**Archivos afectados:**
- `votometro-backend/app/functions/http_functions/power_bi_functions.py` — líneas 36-44
- `votometro-backend/app/functions/http_functions/sessions_functions.py` — líneas 100-131 (`AdminRevokeSession`)

**Descripción técnica:**

La función `_assert_active_session` (que verifica que el llamante tenga una sesión con status `Active`) solo se implementa en `power_bi_functions.py`. El endpoint `POST /api/manage/sessions/revoke` y `GET /api/manage/sessions/{session_id}/detail` únicamente verifican que el token JWT sea válido y que el rol en SQL sea `Admin`, pero no comprueban que la sesión del admin esté activa en ese momento.

Un token JWT válido de un admin cuya sesión ya fue cerrada o revocada sigue pudiendo revocar sesiones de otros usuarios durante los ~60 minutos que dura el JWT, sin que el backend lo detecte.

**Remediación:**

Aplicar `_assert_active_session` (o su equivalente) consistentemente en **todos** los endpoints sensibles de administración, no solo en Power BI.

---

### A02 — CRYPTOGRAPHIC FAILURES (Fallas Criptográficas)

---

#### HAL-05 🟠 ALTO — La lista de audiencias JWT acepta tokens de Microsoft Graph

**Archivos afectados:**
- `votometro-backend/shared/utils.py` — líneas 194-201

**Descripción técnica:**

La lista `valid_audiences` incluye el identificador de Microsoft Graph API:

```python
valid_audiences = [
    client_id,
    f"api://{client_id}",
    f"https://{client_id}",
    "00000003-0000-0000-c000-000000000000",  # MS Graph API (temporal)
    "51ddd54e-2de6-4faf-8181-9dbddbbe72fa",  # Frontend app ID
    f"api://d29a0628-b1a4-44de-a872-a801324d7506",
]
```

El identificador `00000003-0000-0000-c000-000000000000` corresponde a Microsoft Graph. Un atacante que obtenga un token válido emitido por Azure AD para Graph API (un recurso completamente distinto) puede usarlo para autenticarse contra este backend. Los tokens para Graph API se emiten con el mismo tenant y pueden ser solicitados por cualquier aplicación que tenga consentimiento. El comentario `(temporal)` sugiere que esta entrada fue añadida como workaround y nunca fue eliminada.

**Remediación:**

Eliminar `00000003-0000-0000-c000-000000000000` de `valid_audiences`. Solo deben aceptarse tokens cuya audiencia corresponda al backend de la propia aplicación (`api://d29a0628-...` o el `client_id` del backend).

---

#### HAL-06 🟡 MEDIO — Caché de claves públicas JWKS sin TTL ni invalidación

**Archivos afectados:**
- `votometro-backend/shared/utils.py` — líneas 57, 76-93

**Descripción técnica:**

```python
_jwks_cache = None  # Variable global — persiste durante toda la vida del worker

def get_azure_ad_public_keys() -> Dict:
    global _jwks_cache
    if _jwks_cache is not None:
        return _jwks_cache  # Nunca se invalida
    ...
```

El caché de claves públicas de Azure AD se llena una vez y nunca expira. Azure AD rota sus claves de firma periódicamente. Si una clave es comprometida y Azure AD la revoca, el backend seguirá aceptando tokens firmados con esa clave hasta que se reinicie el worker (potencialmente horas o días). No existe ningún mecanismo de TTL, ningún fallback para intentar refrescar el caché cuando falla la verificación de firma.

**Remediación:**

Implementar TTL en el caché (ej. 24 horas máximo). Si `jwt.decode` lanza `InvalidSignatureError` con una clave del caché, invalidar el caché e intentar refrescar las claves antes de reportar error definitivo.

---

#### HAL-07 🟡 MEDIO — Client ID del backend hardcodeado en el bundle JavaScript público

**Archivos afectados:**
- `votometro-frontend/src/authConfig.ts` — línea 50

**Descripción técnica:**

```typescript
const BACKEND_API_CLIENT_ID = "d29a0628-b1a4-44de-a872-a801324d7506";
```

Este valor es bakeado en el bundle de JavaScript de producción y accesible por cualquier persona que inspeccione el código fuente del SPA. Si bien el Client ID por sí solo no es suficiente para comprometer cuentas (requiere credenciales o tokens válidos), su exposición facilita el reconocimiento y la ingeniería social. Combinado con el Tenant ID (también presente en el bundle), reduce la entropía de ataques de phishing dirigido.

**Remediación:**

Mover `BACKEND_API_CLIENT_ID` a `VITE_AZURE_API_CLIENT_ID` como variable de entorno de build para hacer explícita su naturaleza semipública y permitir diferenciación por entorno. No es un secreto en sentido estricto, pero no debería estar hardcodeado.

---

#### HAL-08 🟡 MEDIO — Secretos de aplicación en variables de entorno de contenedores sin mecanismo de rotación

**Archivos afectados:**
- `docker-compose.yml` — líneas 338-345 (servicio `backend`)

**Descripción técnica:**

```yaml
environment:
  MS_CLIENT_SECRET: ${MS_CLIENT_SECRET}
  POWER_BI_CLIENT_SECRET: ${POWER_BI_CLIENT_SECRET}
  SQL_CONNECTION_STRING: ${SQL_CONNECTION_STRING}
```

Las credenciales de aplicación se inyectan como variables de entorno Docker, lo que significa que son visibles en `docker inspect`, en los logs de composición, y potencialmente en herramientas de observabilidad. No existe ningún mecanismo de rotación: si estas credenciales son comprometidas, requieren intervención manual.

Adicionalmente, el servicio `db-init` recibe variables de entorno que no necesita:

```yaml
# docker-compose.yml líneas 133-141 (db-init)
MS_CLIENT_ID: ${MS_CLIENT_ID}
POWER_BI_GROUP_ID: ${POWER_BI_GROUP_ID}
SQL_CONNECTION_STRING: ${SQL_CONNECTION_STRING}
```

**Remediación:**

En producción, usar Azure Key Vault con Managed Identity en lugar de variables de entorno para secretos. El servicio `db-init` solo necesita `MSSQL_SA_PASSWORD` y las variables de bootstrap; eliminar los demás. Para el entorno Docker local, usar Docker secrets en lugar de variables de entorno.

---

### A03 — INJECTION (Inyección)

---

#### HAL-09 🟢 BAJO — Construcción dinámica de cláusula IN con placeholders (revisado: bajo riesgo)

**Archivos afectados:**
- `votometro-backend/app/sql/user_sql_adapter.py` — líneas 320-351

**Descripción técnica:**

```python
placeholders = ",".join(["?" for _ in product_names])
query = f"""
    UPDATE up SET enable = 0
    FROM dbo.User_Products up
    INNER JOIN dbo.Products p ON p.id = up.product_id
    WHERE up.user_id = ? AND p.name NOT IN ({placeholders})
"""
cursor.execute(query, (user_id, *product_names))
```

La cláusula `IN` se construye con f-string, pero los valores son siempre `?` (placeholders parametrizados), no valores interpolados directamente. pyodbc pasa los valores reales como parámetros separados, lo que previene SQL injection. El riesgo es **bajo** pero el patrón es frágil: si un futuro desarrollador reemplaza los `?` por f-string values, introduce inyección.

**Remediación:**

Documentar explícitamente por qué este patrón es seguro. Considerar usar un Stored Procedure o `TABLE-VALUED PARAMETER` de SQL Server para listas variables, eliminando la necesidad de construir SQL dinámico en Python.

---

#### HAL-10 🟠 ALTO — Fuga de información interna en mensajes de error

**Archivos afectados:**
- Múltiples handlers en `user_functions.py`, `sessions_functions.py`, `power_bi_functions.py`

**Descripción técnica:**

La mayoría de los handlers retornan `str(error)` directamente al cliente HTTP en caso de excepción no controlada:

```python
# user_functions.py líneas 71-76
except Exception as error:
    logging.error(f"CreateUser: {error}")
    return func.HttpResponse(
        json.dumps(dict(error=str(error))),
        status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
    )
```

Los mensajes de error de pyodbc frecuentemente incluyen nombres de tablas (`dbo.UserSessions`), nombres de Stored Procedures (`EXEC CreateUserSession`), fragmentos de la cadena de conexión SQL, y detalles del esquema de base de datos. Esta información facilita el reconocimiento previo a un ataque dirigido.

**Remediación:**

Implementar un handler centralizado de excepciones que: (1) loguee el error completo con traceback para diagnóstico interno, (2) retorne al cliente únicamente un mensaje genérico como `"Internal server error"` más un correlation ID para trazabilidad. Solo retornar detalles técnicos en entornos de desarrollo (controlado por variable de entorno `ENVIRONMENT`).

---

### A04 — INSECURE DESIGN (Diseño Inseguro)

---

#### HAL-11 🔴 CRÍTICO — Kill switch permanente de RLS: todos los usuarios ven todos los datos de Power BI

**Archivos afectados:**
- `votometro-backend/use_cases/power_bi_data.py` — líneas 96-103

**Descripción técnica:**

La función `_build_identity` tiene un bloque con un `return` prematuro que hace que **todo el código de filtrado geográfico sea inalcanzable** (dead code):

```python
def _build_identity(self, user, product_name):
    username = user.get(POWER_BI_RLS_USERNAME_FIELD) or user["id"]

    # KILL SWITCH TEMPORAL: DESACTIVACIÓN DE RLS GEOGRÁFICO
    return {
        "username": username,
        # "roles": [DAX_ROLE_ADMIN],  ← comentado
        "customData": "admin",        # ← TODOS los usuarios reciben acceso admin
        "auditableContext": user_id,
    }, 0
    # =================================================================

    # El código siguiente NUNCA SE EJECUTA
    if user["role"] == "Admin":
        ...
    zones = target_product.get("zones", [])
    ...
```

Aunque el código subyacente existe, el `return` en la línea 98 lo hace inaccesible. Todos los usuarios —independientemente de su rol, zonas asignadas o estado del contrato— reciben `"customData": "admin"`, lo que concede acceso a la totalidad de los datos del modelo Power BI. Este comportamiento viola el principio de mínimo privilegio y puede constituir una brecha regulatoria (acceso a datos electorales no autorizados).

Adicionalmente, `POWER_BI_DISABLE_RLS` está configurado como:
```python
POWER_BI_DISABLE_RLS = os.getenv("POWER_BI_DISABLE_RLS", "1").lower() in {"1", "true", "yes"}
```
El default `"1"` significa que RLS está **desactivado por defecto** incluso si el kill switch anterior se elimina.

**Remediación:**

Eliminar el bloque `return` del kill switch. Cambiar el default de `POWER_BI_DISABLE_RLS` a `"0"` (RLS activo por defecto). Validar en un entorno de staging que el filtrado geográfico funciona correctamente antes de activar en producción.

---

#### HAL-12 🟡 MEDIO — El cliente reporta su propio tiempo de actividad al heartbeat (telemetría manipulable)

**Archivos afectados:**
- `votometro-backend/app/sql/session_sql_adapter.py` — líneas 298-311
- `votometro-frontend/src/hooks/useSessionTelemetry.ts` — líneas 42-53

**Descripción técnica:**

El frontend calcula localmente cuántos segundos pasó en cada ruta y envía esos valores al backend:

```typescript
// useSessionTelemetry.ts línea 47
const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
```

El backend inserta estos valores directamente en `dbo.Session_Navigation_Logs` sin ninguna validación de sanidad:

```python
# session_sql_adapter.py línea 302-310
for page in pages:
    route = str(page.get("route") or "").strip()[:512]
    seconds = int(page.get("seconds") or 0)
    if not route or seconds <= 0:
        continue
    cursor.execute(INSERT INTO dbo.Session_Navigation_Logs...)
```

Un usuario puede falsificar datos de telemetría enviando valores arbitrarios de `seconds`. Además, enviar heartbeats frecuentes mantiene la sesión activa indefinidamente sin limitación del servidor, evadiendo el timeout de inactividad de 2 horas.

**Remediación:**

Imponer un límite máximo de segundos por heartbeat/página (ej. no más de `HEARTBEAT_INTERVAL_MS / 1000 * 1.5 = 180s`). Calcular el tiempo de inactividad real en el servidor mediante `DATEDIFF` entre el `last_activity_time` real de la sesión, no confiando en los valores reportados por el cliente.

---

### A05 — SECURITY MISCONFIGURATION (Configuración Errónea)

---

#### HAL-13 🔴 CRÍTICO — Puerto 7071 del backend expuesto directamente, bypasseando nginx

**Archivos afectados:**
- `docker-compose.yml` — línea 331

**Descripción técnica:**

```yaml
# docker-compose.yml
backend:
  ports:
    - "7071:7071"  # ← Expone el Azure Functions runtime directamente al host
```

El diseño de seguridad del proyecto usa nginx como reverse proxy para aplicar headers CSP, HSTS, X-Frame-Options, y evitar CORS preflight. Sin embargo, al exponer el puerto 7071 directamente al host, cualquier cliente puede llamar al backend directamente sin pasar por nginx, eludiendo completamente todos esos controles. Combinado con HAL-01 (ausencia de auth en endpoints de usuario), esto crea un vector de ataque trivialmente explotable.

**Remediación:**

Eliminar la sección `ports` del servicio `backend` en docker-compose. Las comunicaciones entre nginx y el backend se realizan a través de la red interna Docker (`votometro-network`) — el mapeo de puertos al host no es necesario para el funcionamiento. Solo exponer al host los puertos estrictamente necesarios para usuarios (8080 del frontend).

---

#### HAL-14 🟠 ALTO — Puerto SQL Server 1433 expuesto al host

**Archivos afectados:**
- `docker-compose.yml` — línea 51

**Descripción técnica:**

```yaml
database:
  ports:
    - "1433:1433"
```

El servidor SQL Server con credenciales SA está accesible desde el host y potencialmente desde la red local (dependiendo del firewall del sistema operativo). Las credenciales SA son las más privilegiadas en SQL Server. Si el archivo `.env` contiene `MSSQL_SA_PASSWORD` con una contraseña débil o si es expuesto, permite acceso directo con privilegios de sistema a la base de datos.

**Remediación:**

Para producción, eliminar el mapeo del puerto 1433. Para desarrollo, considerar mapearlo solo a `127.0.0.1:1433:1433` para limitar la exposición a la red local.

---

#### HAL-15 🟡 MEDIO — `unsafe-inline` en Content-Security-Policy

**Archivos afectados:**
- `votometro-frontend/nginx.conf` — línea 99

**Descripción técnica:**

```nginx
add_header Content-Security-Policy "\
...
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; \
...
```

La directiva `'unsafe-inline'` en `style-src` permite la inyección de estilos CSS arbitrarios a través de atributos `style=` en elementos HTML. Aunque CSS injection tiene menor impacto que JS injection, puede usarse para robar datos mediante técnicas como CSS-based keylogger o para modificar la interfaz de usuario de forma maliciosa (clickjacking dentro de la página).

**Remediación:**

Migrar de Tailwind runtime a una solución que no requiera `unsafe-inline`: usar Tailwind compilado (modo JIT/build-time), que genera el CSS durante el build de Vite. Los estilos resultantes se sirven como archivos `.css` estáticos permitidos por `style-src 'self'`.

---

#### HAL-16 🟡 MEDIO — Validación de JWT con `verify_aud: False` y validación manual incompleta

**Archivos afectados:**
- `votometro-backend/shared/utils.py` — líneas 203-228

**Descripción técnica:**

```python
payload = jwt.decode(
    access_token,
    public_key,
    algorithms=["RS256"],
    options={
        "verify_signature": True,
        "verify_exp": True,
        "verify_aud": False,  # ← Desactivado
        "verify_iss": False,  # ← Desactivado
    }
)

# Validación manual posterior
if token_audience not in valid_audiences:
    raise ValueError(...)
if not token_issuer.startswith("https://login.microsoftonline.com/") and \
   not token_issuer.startswith("https://sts.windows.net/"):
    raise ValueError(...)
```

Aunque la validación manual existe, desactivar las validaciones nativas de PyJWT introduce fragilidad: si la validación manual contiene un error lógico (como ocurre con HAL-05, donde `valid_audiences` acepta Graph tokens), PyJWT no actúa como red de seguridad.

**Remediación:**

Habilitar `verify_aud: True` y `verify_iss: True` en PyJWT, pasando los valores esperados directamente: `audience=[client_id, f"api://{client_id}"]` y `issuer=expected_issuer`. Esto consolida la lógica de validación y reduce el riesgo de errores en validación manual paralela.

---

### A07 — IDENTIFICATION AND AUTHENTICATION FAILURES (Fallas de Autenticación)

---

#### HAL-17 🟠 ALTO — Sin validación de sesión activa en endpoints críticos de usuario

**Archivos afectados:**
- `votometro-backend/app/functions/http_functions/user_functions.py`
- `votometro-backend/app/functions/http_functions/admin_functions.py`

**Descripción técnica:**

Los endpoints de Power BI implementan `_assert_active_session` que verifica que el `session_token` sea válido y que la sesión tenga `status = 'Active'`. Sin embargo, todos los demás endpoints críticos (modificación de usuarios, RBAC, zonas) solo verifican el JWT, sin validar si el usuario tiene una sesión activa en el sistema.

Esto significa que:
1. Un token JWT robado (válido por ~60 minutos) permite operar en el sistema aunque la sesión haya sido revocada por un administrador.
2. El mecanismo de revocación de sesiones (`RevokeUserSession`) no tiene efecto sobre los endpoints no-PowerBI durante el tiempo de vida restante del JWT.

**Remediación:**

Extraer `_assert_active_session` a `shared/utils.py` como función reutilizable e invocarla desde todos los endpoints que realicen operaciones con estado. Alternativamente, reducir el tiempo de expiración del JWT a 15 minutos y usar refresh tokens, de modo que la revocación de sesión tenga efecto práctico más rápidamente.

---

#### HAL-18 🟡 MEDIO — Contraseña inicial del usuario transmitida en texto claro en el body JSON

**Archivos afectados:**
- `votometro-backend/use_cases/create_user.py` — línea 40
- `votometro-backend/app/ms_graph/user_graph_adapter.py` — líneas 22-30

**Descripción técnica:**

```python
# create_user.py línea 40
password = user_data.get("password")

# user_graph_adapter.py líneas 28-30
"passwordProfile": {
    "forceChangePasswordNextSignIn": True,
    "password": user.password,
},
```

La contraseña inicial del usuario se recibe en el body JSON del request `POST /api/user` como campo `"password"` en texto plano. Aunque la comunicación es HTTPS, la contraseña puede aparecer en:
- Logs de Azure Functions (si el body es logueado en modo debug)
- Herramientas de desarrollo del navegador del administrador
- Trazas de Application Insights si están mal configuradas

**Remediación:**

Generar la contraseña inicial aleatoria en el servidor (backend), no recibirla del frontend. El flujo debería ser: el admin crea el usuario sin campo `password`, el backend genera una contraseña temporal segura (`secrets.token_urlsafe(16)`), la envía a la Graph API, y notifica al usuario vía email que debe cambiarla en el primer login (el flag `forceChangePasswordNextSignIn: True` ya está presente).

---

#### HAL-19 🟢 BAJO — MSAL: tokens almacenados en `sessionStorage`

**Archivos afectados:**
- `votometro-frontend/src/authConfig.ts` — línea 88

**Descripción técnica:**

```typescript
cache: {
  cacheLocation: "sessionStorage" as const,
  storeAuthStateInCookie: false,
},
```

`sessionStorage` es más seguro que `localStorage` (no persiste entre sesiones del navegador ni es accesible desde otras pestañas/dominios). Sin embargo, sigue siendo accesible mediante JavaScript, lo que lo hace vulnerable a ataques XSS. Si un script malicioso se ejecuta en el contexto de la aplicación, puede robar los tokens de MSAL.

El propio código documenta esto como "deuda aceptada" (`NOTA B-05 del DIAGNOSTIC_REPORT.md`).

**Remediación:**

Evaluar el uso de `storeAuthStateInCookie: true` con cookies `HttpOnly; SameSite=Strict; Secure`. Las cookies HttpOnly no son accesibles desde JavaScript, eliminando el vector de robo de tokens por XSS. Requiere coordinación con el backend para manejar la validación de cookies.

---

### INFORMATIVO — Buenas Prácticas Identificadas

---

#### INFO-01 ✅ Dev Bypass con eliminación en tiempo de compilación

**Archivo:** `votometro-frontend/src/devAuth/devBypass.ts`

El mecanismo de bypass de desarrollo utiliza `import.meta.env.DEV` como gate de tiempo de compilación. Vite reemplaza esta constante por `false` en builds de producción, permitiendo al tree-shaker eliminar el código de bypass completamente del bundle final. El diseño es robusto y correcto.

---

#### INFO-02 ✅ Hardening de contenedores Docker

**Archivo:** `docker-compose.yml`

Los contenedores `backend` y `frontend` implementan:
- `read_only: true` (sistema de archivos raíz inmutable)
- `cap_drop: ALL` (sin capacidades Linux)
- `no-new-privileges: true`
- Usuarios no-root (`10001:10001` en backend, `101:101` en frontend)
- Límites de recursos (CPU, memoria, PIDs)
- tmpfs explícitos para directorios que requieren escritura

Esto reduce significativamente la superficie de ataque en caso de compromiso del contenedor.

---

#### INFO-03 ✅ Row-Level Security con EffectiveIdentity en Power BI

**Archivo:** `votometro-backend/use_cases/power_bi_data.py` y `power_bi_adapter.py`

La arquitectura RLS de Power BI está correctamente diseñada: el backend genera el embed token con `identities[].customData` que propaga las zonas geográficas del usuario al modelo DAX. El código de generación de identidad existe y está correcto (aunque inaccesible por el kill switch — ver HAL-11). Una vez que el kill switch se elimine, el sistema tiene la infraestructura correcta para aplicar filtrado geográfico.

---

## MATRIZ DE RIESGOS

| ID | Hallazgo | Categoría OWASP | Riesgo | Explotabilidad | Impacto |
|----|----------|-----------------|--------|----------------|---------|
| HAL-01 | Sin auth en endpoints de usuario | A01 | 🔴 Crítico | Alta | Crítico |
| HAL-02 | IDOR en recursos de usuario | A01 | 🔴 Crítico | Alta | Alto |
| HAL-11 | Kill switch RLS Power BI activo | A04 | 🔴 Crítico | Nula (interna) | Crítico |
| HAL-13 | Puerto 7071 expuesto al host | A05 | 🔴 Crítico | Alta | Alto |
| HAL-03 | DIVIPOLA upload sin auth | A01 | 🟠 Alto | Alta | Alto |
| HAL-04 | Sesión admin no validada en admin-ops | A01 | 🟠 Alto | Media | Medio |
| HAL-05 | JWT acepta tokens de MS Graph | A07 | 🟠 Alto | Media | Alto |
| HAL-10 | Fuga de detalles internos en errores | A03 | 🟠 Alto | Alta | Medio |
| HAL-14 | Puerto SQL 1433 expuesto | A05 | 🟠 Alto | Media | Crítico |
| HAL-17 | Sin validación sesión activa en endpoints | A07 | 🟠 Alto | Media | Medio |
| HAL-06 | JWKS cache sin TTL | A02 | 🟡 Medio | Baja | Medio |
| HAL-07 | Client ID hardcodeado en bundle | A02 | 🟡 Medio | Alta | Bajo |
| HAL-08 | Secretos en env vars Docker | A02 | 🟡 Medio | Baja | Alto |
| HAL-12 | Telemetría de sesión manipulable | A04 | 🟡 Medio | Alta | Bajo |
| HAL-15 | CSP unsafe-inline en styles | A05 | 🟡 Medio | Media | Medio |
| HAL-16 | JWT verify_aud/iss desactivados | A07 | 🟡 Medio | Baja | Medio |
| HAL-18 | Contraseña en texto plano en request | A07 | 🟡 Medio | Baja | Medio |
| HAL-09 | SQL dinámico con placeholders | A03 | 🟢 Bajo | Muy baja | Bajo |
| HAL-19 | Tokens MSAL en sessionStorage | A07 | 🟢 Bajo | Baja | Medio |

---

## PLAN DE REMEDIACIÓN PRIORIZADO

### Prioridad 1 — Acción Inmediata (antes de siguiente despliegue)
1. **HAL-11**: Eliminar el kill switch de RLS (o documentar formalmente si es una decisión de negocio temporal con fecha de reversión).
2. **HAL-13**: Eliminar el mapeo de puerto `7071:7071` del docker-compose.
3. **HAL-01 + HAL-02**: Añadir verificación de JWT y rol en todos los endpoints de `user_functions.py`.

### Prioridad 2 — Corto Plazo (próximo sprint)
4. **HAL-05**: Eliminar `00000003-0000-0000-c000-000000000000` de `valid_audiences`.
5. **HAL-03**: Aplicar `_require_admin` en `divipola_functions.py`.
6. **HAL-10**: Centralizar el manejo de errores para no filtrar detalles internos.
7. **HAL-14**: Restringir la exposición del puerto 1433 al loopback.

### Prioridad 3 — Mediano Plazo (próximo trimestre)
8. **HAL-17**: Implementar validación de sesión activa en todos los endpoints sensibles.
9. **HAL-18**: Mover generación de contraseña inicial al servidor.
10. **HAL-06**: Implementar TTL y mecanismo de refresh en caché JWKS.
11. **HAL-08**: Migrar secretos a Azure Key Vault con Managed Identity.
12. **HAL-16**: Activar `verify_aud` y `verify_iss` en PyJWT.

---

*Auditoría realizada mediante análisis estático de caja blanca. No se ejecutaron exploits ni se realizaron pruebas dinámicas contra el entorno. Los hallazgos reflejan vulnerabilidades identificadas en el código fuente y la configuración en el momento del análisis.*
