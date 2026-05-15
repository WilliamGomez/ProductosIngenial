# DIAGNOSTIC REPORT — VOTOMETRO
**Fecha:** 2026-03-30
**Auditor:** Análisis Estático de Seguridad y Arquitectura
**Alcance:** `votometro-backend/` (Azure Functions / Python) · `votometro-frontend/` (React + Vite / TypeScript)

---

## Índice de Auditoría por Capas

### BACKEND

| # | Capa | Archivos clave |
|---|------|---------------|
| 1 | **Auth / JWT / MSAL** | `shared/msal_auth.py`, `shared/power_bi_auth.py`, `use_cases/validate_session.py`, `use_cases/invalidate_session.py`, `use_cases/force_logout_all_devices.py` |
| 2 | **SQL / Dominio / Repositorios** | `app/sql/*.py`, `domain/repositories/*.py`, `domain/models/*.py`, `domain/exceptions.py` |
| 3 | **HTTP Functions / Controladores** | `app/functions/http_functions/*.py`, `function_app.py` |
| 4 | **Power BI / MS Graph (Integraciones externas)** | `app/power_bi/power_bi_adapter.py`, `app/ms_graph/user_graph_adapter.py`, `shared/utils.py` |
| 5 | **Casos de Uso / Lógica de Negocio** | `use_cases/*.py` |
| 6 | **CI/CD / Configuración** | `.github/workflows/deploy_to_azure.yml`, `host.json`, `requirements.txt` |

### FRONTEND

| # | Capa | Archivos clave |
|----|------|---------------|
| 7  | **Auth / Sesión / MSAL** | `src/authConfig.ts`, `src/hooks/useAuth.ts`, `src/hooks/useAccessToken.ts`, `src/context/SessionContext.tsx` |
| 8  | **Routing / Guards de Acceso** | `src/router/AppRouter.tsx`, `src/components/RequireAuth.tsx`, `src/components/UnauthenticatedRoute.tsx` |
| 9  | **Servicios / API Client** | `src/services/api.ts` |
| 10 | **UI / PowerBI Embed** | `src/pages/Votometro.tsx`, `src/pages/Audivoto.tsx`, `src/utils/GetFilters.ts`, `src/interfaces/IEmbedConfig.ts` |
| 11 | **Gestión de Usuarios / Sesiones (Admin)** | `src/pages/UsersAdmin.tsx`, `src/pages/SessionsAdmin.tsx`, `src/components/RegisterUser.tsx`, `src/components/UpdateUser.tsx` |
| 12 | **CI/CD / Configuración** | `.github/workflows/deploy_to_azure.yml`, `vite.config.ts`, `tsconfig*.json` |

---

## Hallazgos Críticos y Medios

---

### CAPA 1 — Backend: Auth / JWT / MSAL

#### Severidad: CRÍTICA 🔴

**C-01 · Endpoints de gestión de usuarios completamente sin autenticación**
- **Archivo:** `app/functions/http_functions/user_functions.py`
- **Líneas:** 23, 60, 83, 114, 161 (`auth_level=func.AuthLevel.ANONYMOUS`)
- **Descripción:** Los endpoints `POST /user`, `GET /user`, `GET /user/{user_id}`, `PUT /user/{user_id}` y `PUT /user-products/{user_id}` no realizan ninguna verificación de JWT. Cualquier actor no autenticado puede crear usuarios, listar el directorio completo, modificar roles y asignar productos sin presentar credencial alguna.
- **Vector:** Acceso directo a la URL pública de la Azure Function.

**C-02 · Bypass de audiencia JWT mediante IDs hardcodeados (`verify_aud: False`)**
- **Archivo:** `shared/utils.py`
- **Líneas:** 114–133
- **Descripción:** La verificación nativa de `aud` e `iss` está deshabilitada (`verify_aud: False`, `verify_iss: False`). La `valid_audiences` incluye `"00000003-0000-0000-c000-000000000000"` (MS Graph) y el ID hardcodeado de la app frontend. Un token emitido por Azure AD para MS Graph —con permisos distintos al backend— es aceptado como válido para autenticarse contra el API. El comentario en el código dice explícitamente `# MS Graph API (temporal)`, indicando deuda técnica aceptada y nunca resuelta.
- **Vector:** Audience Confusion Attack — un atacante con un token de MS Graph válido puede llamar al backend.

**C-03 · Todos los endpoints usan `AuthLevel.ANONYMOUS` (eliminación de defensa en profundidad)**
- **Archivo:** `app/functions/http_functions/sessions_functions.py`, `user_functions.py`, `power_bi_functions.py`, `department_functions.py`, `municipality_functions.py`, `countries_functions.py`
- **Descripción:** Azure Functions ofrece autenticación a nivel de plataforma mediante function keys. Al fijar `ANONYMOUS` en todos los endpoints, se elimina esa capa de defensa. Si la verificación JWT falla o tiene un bug, no hay segunda barrera.

---

#### Severidad: ALTA 🟠

**A-01 · Token JWT transmitido en el body JSON (exposición en logs y proxies)**
- **Archivo:** `app/functions/http_functions/sessions_functions.py`
- **Líneas:** 32, 75, 185
- **Descripción:** Los endpoints `POST /session`, `POST /invalidate-session` y `POST /session/force-logout-all` reciben el `access_token` en el cuerpo HTTP, no en el header `Authorization`. Los tokens en el body son registrados por middlewares, API Gateways, Application Insights y cualquier proxy de red. Los tokens deberían transmitirse exclusivamente en el header `Authorization: Bearer`.

**A-02 · DoS por sesión: login invalida TODAS las sesiones activas sin notificación**
- **Archivo:** `use_cases/validate_session.py`
- **Línea:** 12
- **Descripción:** `invalidate_all_sessions(user_id)` se ejecuta en cada login. Un actor malicioso que logre obtener un token Azure AD válido de la víctima (p.ej. mediante phishing) puede entrar en un bucle de login-logout, manteniendo a la víctima permanentemente deslogueada (session hijacking + DoS). Adicionalmente, usuarios legítimos con múltiples dispositivos pierden su sesión activa sin advertencia.

**A-03 · JWKS cache sin TTL — ceguera ante rotación de claves de Azure AD**
- **Archivo:** `shared/utils.py`
- **Líneas:** 13, 36–46
- **Descripción:** `_jwks_cache` es una variable global que se rellena una sola vez y nunca se invalida. Azure AD rota sus claves de firma periódicamente. Cuando eso ocurra, el servidor seguirá usando el conjunto de claves antiguo hasta que la instancia se reinicie. En escenario de compromiso, si Azure AD revoca una clave, el servidor continuará aceptando tokens firmados con ella durante el tiempo de vida de la instancia.

**A-04 · Fuga de mensajes de error internos de Azure AD al cliente**
- **Archivo:** `shared/utils.py` línea 23; `shared/msal_auth.py` línea 23; `shared/power_bi_auth.py` línea 23
- **Descripción:** `result.get('error_description')` de MSAL (que puede contener detalles del tenant, correlation IDs y mensajes internos de Azure AD) se propaga como `str(error)` hasta el cuerpo de la respuesta HTTP al cliente a través del handler genérico `except Exception`.

---

#### Severidad: MEDIA 🟡

**M-01 · `client_id` y App IDs hardcodeados en código fuente**
- **Archivo:** `shared/utils.py`
- **Líneas:** 119–120
- **Descripción:** El UUID `51ddd54e-2de6-4faf-8181-9dbddbbe72fa` (frontend App ID) está hardcodeado. Debe moverse a variable de entorno para permitir rotación sin cambio de código y evitar exposición en el repositorio.

**M-02 · Logs de claims de token a nivel INFO en producción**
- **Archivo:** `shared/utils.py`
- **Líneas:** 71, 83, 95, 105, 110
- **Descripción:** Se loguean a nivel `INFO` el `oid` (identificador único del usuario), `aud`, `iss`, `client_id` y los `kid` disponibles. En producción estos datos alimentan Application Insights y son accesibles para cualquier rol con acceso a logs, ampliando la superficie de reconocimiento.

**M-03 · `ForceLogoutAllDevices` sin verificación de rol — operación destructiva sin autorización**
- **Archivo:** `app/functions/http_functions/sessions_functions.py`
- **Líneas:** 171–201
- **Descripción:** El endpoint solo verifica que el token JWT sea válido, pero no valida que el usuario sea Admin. El `use_case` internamente solo recibe `user_id` extraído del token propio, por lo que el atacante solo puede hacer logout de sí mismo. Sin embargo, el diseño carece de protección explícita para el caso en que el `user_id` sea pasado por otro camino (ej. si en una refactorización futura el use case se llama desde otro flujo). Adicionalmente, no existe control de rate limiting.

---

#### Severidad: BAJA / INFORMATIVA 🔵

**B-01 · MSAL sin caché compartida entre instancias (nueva instancia por invocación)**
- **Archivo:** `shared/msal_auth.py` línea 13; `shared/power_bi_auth.py` línea 13
- **Descripción:** Se instancia `ConfidentialClientApplication` en cada llamada. La caché de tokens de MSAL es local a esa instancia efímera. En entornos con múltiples instancias de Azure Functions, se generarán tokens nuevos con mayor frecuencia de la necesaria, aumentando el riesgo de throttling por Azure AD y el número de secrets en memoria simultáneamente.

**B-02 · `import uuid` sin uso en `invalidate_session.py`**
- **Archivo:** `use_cases/invalidate_session.py`
- **Línea:** 2
- **Descripción:** Import muerto. Deuda técnica menor.

---

### CAPA 2 — Backend: SQL / Dominio / Repositorios

#### Severidad: CRÍTICA 🔴

**C-04 · Contraseña de usuario devuelta en texto plano en la respuesta HTTP**
- **Archivos:** `domain/models/user.py:16`, `use_cases/create_user.py:24,34,77`, `app/functions/http_functions/user_functions.py:39`
- **Descripción:** El campo `password: str = None` existe en el modelo de dominio `User`. En `create_user.py` se asigna directamente desde el payload HTTP (`password = user_data.get("password")`). Al final del use case, `return created_user.__dict__` serializa el objeto completo, incluyendo el campo `password`. Ese dict se serializa con `json.dumps(user)` en el endpoint HTTP y se envía al cliente en la respuesta `201 Created`. La contraseña del usuario recién creado se expone en la respuesta de la API.
- **Vector:** Cualquier llamante del endpoint `POST /user` recibe la contraseña en la respuesta.

#### Severidad: ALTA 🟠

**A-05 · Fuga de conexiones: ningún adaptador SQL cierra `pyodbc.Connection`**
- **Archivos:** `app/sql/user_sql_adapter.py:12`, `app/sql/session_sql_adapter.py:13`, `app/sql/department_sql_adapter.py:10`, `app/sql/municipality_sql_adapter.py:10`
- **Descripción:** Todos los adaptadores crean `pyodbc.connect()` en `__init__` y nunca llaman a `.close()`. No existe `__del__`, `__exit__`, bloque `finally` ni context manager que garantice el cierre. Azure Functions instancia un nuevo adaptador por cada invocación sin connection pooling, lo que en picos de tráfico agota el límite de conexiones concurrentes de Azure SQL y puede resultar en denegación de servicio de la base de datos.

**A-06 · Contrato de interfaz `ISessionSqlRepository` desincronizado con implementación (firma incorrecta)**
- **Archivos:** `domain/repositories/session_sql_repository.py:24`, `app/sql/session_sql_adapter.py:42`
- **Descripción:** La interfaz abstracta declara `get_active_session(self, user_id: str) -> Row` (1 parámetro), pero la implementación concreta tiene `get_active_session(self, user_id: str, device_id: str) -> Dict | None` (2 parámetros). El contrato no cumple con Liskov Substitution. Cualquier código que instancie el tipo abstracto y llame con la firma de la interfaz producirá un `TypeError` en tiempo de ejecución.

#### Severidad: MEDIA 🟡

**M-04 · SQL dinámico con f-string en operaciones sobre `Products` (patrón de riesgo)**
- **Archivo:** `app/sql/user_sql_adapter.py:237,248`
- **Descripción:** Los métodos `disable_products_not_in_list` y `enable_products_in_list` construyen el query como f-string: `f"UPDATE Products SET enable = 0 WHERE user_id = ? AND product_name NOT IN ({placeholders})"`. Aunque los valores individuales son enlazados con `?`, la estructura del query se construye dinámicamente. Este patrón es técnicamente seguro hoy, pero es un vector de inyección latente: si en una refactorización `placeholders` llegara a incluir valores de usuario directamente (p.ej. nombres de productos sin sanitizar), el atacante podría inyectar SQL. Los queries parametrizados deben construirse sin f-strings sobre datos controlables.

**M-05 · Sin paginación ni límite en `list_users` — potencial OOM**
- **Archivo:** `app/sql/user_sql_adapter.py:57-113`
- **Descripción:** `cursor.fetchall()` carga toda la tabla de usuarios en memoria y la procesa con `pandas.DataFrame`. Sin paginación, cláusula `TOP`/`LIMIT` ni cursor lazy, una base de datos con miles de usuarios puede provocar errores de memoria (OOM) en la instancia de Azure Functions, que tiene recursos limitados por plan de consumo.

**M-06 · Mensajes de excepción exponen datos de identificación de usuario al cliente**
- **Archivo:** `domain/exceptions.py:11,18`
- **Descripción:** `UserAlreadyExistsException` incluye el email: `"El usuario con el correo '{email}' ya existe."`. `UserNotFoundException` incluye el `user_id`. Estos mensajes se propagan hasta el body de la respuesta HTTP mediante el handler genérico `except Exception → json.dumps(dict(error=str(error)))`. Un actor malicioso puede usar `POST /user` para enumerar qué emails ya están registrados en el sistema (user enumeration attack).

**M-07 · `contract_duration` negativo o cero produce fechas de expiración en el pasado sin error**
- **Archivos:** `use_cases/create_user.py:58`, `use_cases/upsert_user_products.py:27`, `shared/utils.py:16-29`
- **Descripción:** `calculate_expiration` no valida que `contract_duration > 0`. Un payload con `"contract_duration": -12` genera una fecha de expiración en el pasado que se almacena sin error ni advertencia. El producto aparecerá como expirado desde el momento de su creación, lo que puede ser explotado para crear suscripciones inválidas o para confundir la lógica de autorización de acceso a Power BI.

#### Severidad: BAJA / INFORMATIVA 🔵

**B-03 · Campo `password` en el modelo de dominio `User` — violación de principio de responsabilidad única**
- **Archivo:** `domain/models/user.py:16`
- **Descripción:** El modelo de dominio `User` contiene un campo `password`. La gestión de credenciales no pertenece al dominio de negocio de la aplicación (delegado a Azure AD). Este campo debería eliminarse del modelo para evitar que futuras implementaciones lo usen de forma incorrecta (almacenamiento local de contraseñas, logging accidental, etc.).

---

### CAPA 3 & 5 — Backend: HTTP Functions / Casos de Uso

#### Severidad: CRÍTICA 🔴

**C-05 · `GET /power-bi` devuelve embed tokens de Power BI sin ninguna autenticación** · ✅ CERRADO (2026-04-23)
- **Archivos:** `app/functions/http_functions/power_bi_functions.py:22-43`, `use_cases/power_bi_data.py:10-22`
- **Descripción:** El endpoint `GET /power-bi` ejecuta `PowerBIUseCase` que llama a `get_embed_params_for_single_report` para cada reporte y devuelve los resultados completos (incluyendo `accessToken`, `embedUrl` y configuración interna) sin verificar ningún JWT ni rol. Cualquier actor sin autenticarse puede obtener tokens de embed activos de Power BI para todos los reportes de datos electorales. Los embed tokens de Power BI permiten cargar directamente los dashboards en cualquier página web.
- **Mitigación aplicada (2026-04-23):** El endpoint plural `GET /power-bi` fue retirado. La ruta pública es ahora `GET /power-bi/{reportId}` con `auth_level=FUNCTION` (Function Key) + Bearer JWT obligatorio (`decode_token` valida firma, audiencia y expiración, cerrando también C-02). El use case ``PowerBIUseCase.execute_for_user`` construye una ``EffectiveIdentity`` por usuario y emite embed tokens con RLS server-side. Ver `GEO_RLS_DATA_PATH.md` y `docs/powerbi_dax_rules.md`.

**C-06 · Sin rollback transaccional en `CreateUserUseCase`: usuario creado en Azure AD pero fallo SQL deja estado inconsistente**
- **Archivos:** `use_cases/create_user.py:36-73`
- **Descripción:** El flujo es: (1) crear usuario en Azure AD → (2) asignar rol en Azure AD → (3) guardar metadatos en SQL. Si el paso 3 falla (timeout, error de constraints, etc.), el usuario existe activo en Azure AD con un rol asignado, pero no tiene registro en la base de datos local. El usuario puede autenticarse con Azure AD, pero cualquier consulta al backend fallará al buscarlo en SQL. No existe ningún mecanismo de compensación (eliminación del usuario de Azure AD) ni manejo del estado huérfano.

#### Severidad: ALTA 🟠

**A-07 · Sin rollback en `UpdateUserUseCase`: cambio de rol deja al usuario sin permisos si falla en Azure AD**
- **Archivo:** `use_cases/update_user.py:12-21`
- **Descripción:** Cuando cambia el rol, el flujo es: (1) eliminar TODOS los app role assignments del usuario en Azure AD → (2) asignar nuevo rol en Azure AD → (3) actualizar en Azure AD → (4) actualizar en SQL. Si el paso 2 o 3 falla tras haber ejecutado el paso 1, el usuario queda sin ningún rol en Azure AD hasta que el administrador intervenga manualmente. Durante ese tiempo, el usuario no puede acceder a ningún recurso protegido por roles.

**A-08 · Bypass de autorización en `GET /power-bi/{reportId}` para reportes no incluidos en el mapa** · ✅ CERRADO (2026-04-23)
- **Archivo:** `app/functions/http_functions/power_bi_functions.py:85-112`
- **Descripción:** La autorización solo se aplica si `REPORT_TO_PRODUCT_MAP.get(report_id)` devuelve un valor (`if required_product:`). Si se publica un reporte nuevo en Power BI que no esté mapeado en el diccionario, cualquier usuario autenticado —independientemente de sus productos— puede acceder a él. El mapa es también una allowlist hardcodeada que requiere un redeploy para cada nuevo reporte, haciendo probable que se omita en el proceso de publicación.
- **Mitigación aplicada (2026-04-23):** `REPORT_TO_PRODUCT_MAP` fue movido al use case (`use_cases/power_bi_data.py`) y convertido en **deny-by-default**: cualquier `report_id` no listado lanza `PermissionError` (→ HTTP 403) incluso para Admins si el reporte no está registrado. La regla operativa (BACKEND_MEM §5) exige actualizar el mapa en el mismo PR que publica el reporte.

**A-09 · `KeyError` no controlado en `CreateUserUseCase` y `UpdateUserProductsUseCase` → 500 con exposición de nombre de campo**
- **Archivos:** `use_cases/create_user.py:51-67`, `use_cases/upsert_user_products.py:26-31`
- **Descripción:** Los campos de productos se acceden por índice directo (`product["name"]`, `product["contract_duration"]`, `product["country"]`, etc.) sin uso de `.get()` ni validación previa. Un payload con cualquier campo omitido lanza `KeyError` que se propaga hasta el handler HTTP y se devuelve como `500 Internal Server Error` con `str(error)` (que contiene el nombre del campo faltante). El cliente debería recibir `400 Bad Request` con un mensaje descriptivo, no un 500 que expone la estructura interna.

**A-10 · Mezcla de semántica de error: `ValueError` de token inválido devuelve `409 Conflict` en `validate_session`**
- **Archivo:** `app/functions/http_functions/sessions_functions.py:46-51`
- **Descripción:** El bloque `except ValueError` del endpoint `POST /session` fue diseñado para errores de negocio (ej. usuario ya en sesión), pero también captura el `ValueError` lanzado por `decode_token` cuando el JWT es inválido o ha expirado. Un token inválido produce una respuesta `409 Conflict` en lugar del correcto `401 Unauthorized`. Esto dificulta el manejo de errores en el frontend y puede enmascarar intentos de acceso con tokens caducados o forjados como si fueran errores de lógica de negocio.

#### Severidad: MEDIA 🟡

**M-08 · `AttributeError` sin controlar en `GetUsersSessionsInfoUseCase` si `issued_at` es `None`**
- **Archivo:** `use_cases/get_users_sessions_info.py:12`
- **Descripción:** `row["issued_at"].strftime(...)` lanza `AttributeError` si alguna fila tiene `issued_at` como `None`. Este error no está capturado en el use case y llega al handler HTTP como excepción genérica, devolviendo `500 Internal Server Error`. Dado que el endpoint es de administración, esto interrumpe la vista completa de sesiones cuando hay un solo registro con dato nulo.

**M-09 · `update_user` HTTP handler sin captura de `ValueError` → 500 para inputs de usuario inválidos**
- **Archivo:** `app/functions/http_functions/user_functions.py:113-156`
- **Descripción:** A diferencia de `create_user` que tiene `except ValueError → 400`, `update_user` solo tiene `except Exception → 500`. Cualquier error de validación en el use case o en la lógica de Graph API se devuelve como 500, ocultando si el error fue causado por el cliente o por el servidor.

**M-10 · `ListCountriesUseCase` carga toda la tabla de departamentos para filtrar en Python**
- **Archivo:** `use_cases/list_countries.py:12-14`
- **Descripción:** Se llama a `list_departments()` (carga toda la tabla vía `EXEC ListDepartments`) y luego se filtra en memoria con `lambda d: d["code"] == 0`. Con el crecimiento de la tabla, esto impone carga innecesaria en la DB y en memoria. El filtro debería aplicarse en SQL.

#### Severidad: BAJA / INFORMATIVA 🔵

**B-04 · N+1 queries en `upsert_user_products`: una query SQL por producto**
- **Archivo:** `app/sql/user_sql_adapter.py:192-215`
- **Descripción:** `upsert_user_products` llama a `_get_product_id` dentro de un bucle `for product in products`, generando una query `SELECT` adicional por cada producto antes del `EXEC UpsertProduct`. Para un usuario con N productos, se ejecutan 2N queries. Debería resolverse con un upsert directo o cargando todos los IDs en una sola consulta previa al bucle.

---

### CAPAS 7 & 8 — Frontend: Auth / Sesión / MSAL / Routing

#### Severidad: ALTA 🟠

**A-11 · `session_token` y `device_id` almacenados en `localStorage` — extraíbles por XSS**
- **Archivo:** `src/context/SessionContext.tsx:137-138, 482-483`
- **Descripción:** Los identificadores de sesión propios de la aplicación se persisten con `localStorage.setItem(STORAGE_KEYS.sessionToken, ...)` y `localStorage.setItem(STORAGE_KEYS.deviceId, ...)`. A diferencia del caché de MSAL (configurado con `sessionStorage`), `localStorage` persiste entre sesiones de navegador y es accesible desde cualquier script en el mismo origen. Un ataque XSS exitoso puede leer ambos valores y presentarse al backend como la sesión legítima del usuario. Al recargar la página, los valores se restauran desde `localStorage` (líneas 496-501) sin verificar si el token sigue siendo válido contra el backend antes de iniciar el heartbeat.

**A-12 · Dos fuentes de verdad para el rol del usuario: `idTokenClaims.roles` (MSAL) vs `user.role` (backend) — guard de seguridad desincronizado**
- **Archivos:** `src/components/RequireAuth.tsx:16`, `src/hooks/useAuth.ts:19`
- **Descripción:** `RequireAuth` lee el rol de `activeAccount?.idTokenClaims?.roles` (claims del token de MSAL), mientras que `useAuth` lee `user?.role` del objeto de usuario devuelto por el backend. El propio código lo marca con el comentario `CRITICAL FIX`. Si el rol de un usuario se cambia en el backend, `RequireAuth` seguirá autorizando según el claim del token de MSAL hasta que éste expire (tokens de MSAL pueden tener vida de 1h). Cualquier ruta que use `RequireAuth` mostraría datos con permisos obsoletos.

**A-13 · `RequireAuth` no está integrado en el router activo — guard de seguridad sin efecto**
- **Archivos:** `src/components/RequireAuth.tsx`, `src/router/AppRouter.tsx`
- **Descripción:** `AppRouter` gestiona el acceso a rutas mediante lógica inline (`userRole === "Admin"`, `hasProduct("Votometro")`). El componente `RequireAuth` no envuelve ninguna ruta en el router actual; existe pero no protege nada. Si en el futuro se añaden rutas sin usar el guard inline, quedarán completamente desprotegidas y `RequireAuth` no será tenido en cuenta.

**A-14 · `logoutAndCleanup` envía el `access_token` de MSAL en el body JSON (confirma A-01 del backend)**
- **Archivo:** `src/context/SessionContext.tsx:183-188`
- **Descripción:** Al invalidar la sesión, el token de acceso se envía como `access_token: token` en el cuerpo JSON de la petición, además de usarse para el header de autorización. Confirma el vector de exposición del hallazgo A-01 del backend: el token queda registrado en logs de red, Application Insights y cualquier proxy intermedio.

**A-15 · `useAccessToken.ts`: `accounts[0]` sin guardia — excepción silenciosa si no hay cuenta activa**
- **Archivo:** `src/hooks/useAccessToken.ts:10`
- **Descripción:** `account: accounts[0]` se usa sin verificar si `accounts` tiene elementos. Si el array está vacío (estado post-logout o inicialización tardía), `accounts[0]` es `undefined`. `acquireTokenSilent` con `account: undefined` falla silenciosamente y cae al `acquireTokenPopup`, que también fallará. El error de popup no está manejado y puede propagar una excepción no controlada. Adicionalmente, duplica la lógica de `acquireApiToken` en `SessionContext` con comportamiento diferente, creando dos rutas de adquisición de token con distintas garantías.

#### Severidad: MEDIA 🟡

**M-11 · `AppRouter` recrea el `BrowserRouter` en cada cambio de rutas — potencial memory leak y pérdida de historial**
- **Archivo:** `src/router/AppRouter.tsx:114`
- **Descripción:** `const router = useMemo(() => createBrowserRouter(routes), [routes])` crea una nueva instancia de router cada vez que `routes` cambia (cambio de rol, carga de productos, etc.). React Router no está diseñado para ser reinstanciado; hacerlo en tiempo de ejecución reinicia el historial de navegación, puede causar memory leaks acumulativos y produce comportamientos inesperados en navegación programática (`navigate()`). El patrón correcto es un router estático con rutas condicionales internas.

**M-12 · Heartbeat: contador de fallos compartido entre errores de token y errores de API — logout espurio por errores mixtos**
- **Archivo:** `src/context/SessionContext.tsx:301, 350`
- **Descripción:** `heartbeatFailureCountRef` acumula tanto fallos de `acquireTokenSilent` como errores de la API de sesiones. Una combinación de 3 errores de red transitorios + 2 timeouts de token alcanza `MAX_HEARTBEAT_FAILURES = 5` y fuerza el logout del usuario, aunque ninguna de las dos causas individualmente justifique la terminación de sesión. Las notas de red se excluyen explícitamente solo para errores de tipo `isNetworkError`, pero no para timeouts genéricos ni errores HTTP 5xx del backend.

**M-13 · `UnauthenticatedRoute` redirige a `/` sin verificar si existe ruta válida para el estado actual**
- **Archivo:** `src/components/UnauthenticatedRoute.tsx:8`
- **Descripción:** Al detectar un usuario autenticado, redirige a `<Navigate to='/' replace />`. Si no existe ninguna ruta registrada para `/` en `AppRouter` (usuario sin productos asignados ni rol Admin), el router hace un wildcard redirect a `defaultPath` que puede ser `/login`, causando un loop de redirección: autenticado → `/` → sin rutas → `/login` → detecta autenticado → `/` → …

#### Severidad: BAJA / INFORMATIVA 🔵

**B-05 · `cacheLocation: "sessionStorage"` — MSAL no comparte estado entre pestañas**
- **Archivo:** `src/authConfig.ts:10`
- **Descripción:** Con `sessionStorage`, la sesión de MSAL no se comparte entre pestañas del navegador. Abrir la aplicación en una nueva pestaña desencadena un nuevo flujo de autenticación. Esto puede generar múltiples sesiones backend activas para el mismo usuario (hasta que el heartbeat de la primera pestaña las invalide), incrementando la carga sobre el endpoint `POST /session`.

**B-06 · `navigateToLoginRequestUrl: false` puede causar pérdida del deep-link post-login**
- **Archivo:** `src/authConfig.ts:7`
- **Descripción:** `navigateToLoginRequestUrl: false` hace que MSAL redirija siempre a `redirectUri` tras el login, ignorando la URL que el usuario intentaba visitar. Esto es una limitación de UX pero también puede enmascarar redirects maliciosos si en algún momento se cambia a `true` sin revisar la validación de `redirectUri`.

---

## Resumen Ejecutivo

> **Fecha de cierre de auditoría:** 2026-04-07
> **Alcance evaluado:** Capas 1–5 (Backend: Auth/JWT/MSAL, SQL/Dominio, HTTP Functions, Integraciones externas, Casos de Uso) y Capas 7–8 (Frontend: Auth/MSAL/Sesión, Routing/Guards). Las capas 6 (CI/CD Backend), 10–11 (UI/PowerBI Embed y Gestión de Usuarios Frontend) y 12 (CI/CD Frontend) quedan **fuera del alcance** de este reporte; su evaluación se pospone a una fase posterior.

---

La auditoría estática de VOTOMETRO revela una **postura de seguridad severamente comprometida**. El sistema expone recursos de alto valor electoral —datos de usuarios, reportes de Power BI y operaciones administrativas— sin las salvaguardas mínimas requeridas en un sistema de votación. Se identificaron **40 hallazgos** distribuidos de la siguiente manera:

| Severidad | Cantidad |
|-----------|----------|
| Crítica 🔴 | 6 |
| Alta 🟠 | 15 |
| Media 🟡 | 13 |
| Baja / Informativa 🔵 | 6 |
| **Total** | **40** |

Los 6 hallazgos críticos y 15 altos constituyen vectores de ataque explotables sin conocimiento previo del sistema, siendo varios de ellos aprovechables de forma anónima y sin autenticación. La confidencialidad del directorio de usuarios, la integridad de los datos electorales y la disponibilidad del servicio están en riesgo directo.

Las **tres prioridades absolutas de mitigación inmediata** son:

- **C-01 — Directorio de usuarios completamente expuesto:** Los endpoints `POST /user`, `GET /user`, `GET /user/{user_id}`, `PUT /user/{user_id}` y `PUT /user-products/{user_id}` operan con `AuthLevel.ANONYMOUS`. Cualquier actor externo puede enumerar, crear y modificar usuarios y roles sin presentar credencial alguna. Requiere implementación urgente de validación JWT en todos los endpoints de gestión de usuarios.

- **C-04 — Contraseñas devueltas en texto plano en la respuesta HTTP:** El endpoint `POST /user` serializa el objeto `User` completo —incluyendo el campo `password`— en la respuesta `201 Created`. Toda contraseña de usuario recién creado es expuesta al llamante. Requiere exclusión explícita del campo `password` antes de cualquier serialización de respuesta y eliminación del campo del modelo de dominio.

- **C-05 — Tokens de embed de Power BI accesibles sin autenticación** · ✅ CERRADO (2026-04-23): `GET /power-bi` devuelve `accessToken`, `embedUrl` y configuración completa de todos los reportes electorales sin verificar ningún JWT ni rol. Los tokens de embed permiten cargar dashboards directamente en cualquier sitio web. **Resuelto:** endpoint plural retirado; la ruta pública `GET /power-bi/{reportId}` exige Function Key + Bearer JWT y emite embed tokens con RLS server-side via `PowerBIUseCase.execute_for_user`.

Ninguno de los tres hallazgos anteriores requiere explotación sofisticada; los tres son accesibles mediante una petición HTTP directa a los endpoints públicos de la Azure Function. **No se recomienda operar el sistema en su estado actual en ningún entorno accesible desde redes no completamente aisladas.**
