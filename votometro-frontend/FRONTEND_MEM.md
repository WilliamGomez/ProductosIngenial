# FRONTEND_MEM — Votometro Frontend
> Memoria de contexto para desarrollo continuo. Actualizar tras cada cambio significativo.

---

## Stack Tecnológico

| Categoría | Tecnología |
|-----------|-----------|
| UI | React 19 + TypeScript 5.8 |
| Build | Vite 6 |
| Routing | React Router v7 |
| Autenticación | Azure MSAL (`@azure/msal-react`) |
| Estilos | Tailwind CSS 4 + DaisyUI 5 |
| HTTP | Axios (`src/services/api.ts`) |
| Reportes | `powerbi-client-react` |
| Alertas | SweetAlert2 |

---

## Gestión de Estado y Autenticación

```
MSAL (Azure AD)
  └─ useMsal / useIsAuthenticated     ← estado de autenticación OAuth
  └─ cacheLocation: "sessionStorage"  ← tokens MSAL en sessionStorage

SessionContext (src/context/SessionContext.tsx)
  ├─ user: IUser | null               ← datos del usuario (del backend)
  ├─ products: IProduct[]             ← productos habilitados
  ├─ sessionToken: string | null      ← token de sesión propio ⚠️ en localStorage
  ├─ deviceId: string | null          ← ID de dispositivo ⚠️ en localStorage
  ├─ isLoading: boolean
  ├─ validateSessionOnLogin()         ← POST /session → guarda token en localStorage
  ├─ refreshSessionState()            ← GET /user/:id → actualiza user/products
  ├─ logoutAndCleanup()               ← invalida sesión en backend + MSAL logout
  └─ heartbeat (15s)                  ← GET /users-sessions → verifica sesión activa

useAuth (src/hooks/useAuth.ts)
  └─ expone: isAuthenticated, userRole (del backend), userId, userProducts, isLoadingProducts, isMsalLoading

useAccessToken (src/hooks/useAccessToken.ts)
  └─ acquireTokenSilent → fallback acquireTokenPopup
  ⚠️ Usa accounts[0] sin validación — ver A-15

AppRouter (src/router/AppRouter.tsx)
  └─ Rutas dinámicas según userRole + hasProduct()
  └─ ⚠️ Recrea BrowserRouter en cada cambio de routes — ver M-11
```

---

## Rutas y Control de Acceso

| Ruta | Acceso | Guard activo |
|------|--------|-------------|
| `/login` | Público | `UnauthenticatedRoute` |
| `/votometro` | Admin o producto "Votometro" | Lógica inline en `AppRouter` |
| `/audivoto` | Admin o producto "Audivoto" | Lógica inline en `AppRouter` |
| `/users` | Solo Admin | Lógica inline en `AppRouter` |
| `/sessions-report` | Solo Admin | Lógica inline en `AppRouter` |
| `*` | Redirect al primer path disponible | `AppRouter` wildcard |

> **Nota:** `RequireAuth.tsx` existe pero **no está integrado** en `AppRouter`. No protege ninguna ruta actualmente (ver A-13).

---

## Flujo de Login

1. Usuario hace clic en "Iniciar sesión" → `loginPopup()` de MSAL
2. MSAL retorna `accessToken` (almacenado en `sessionStorage`)
3. Frontend llama `POST /api/session` con `{ access_token, device_id }` en el **body**
4. Backend devuelve `session_token`
5. `validateSessionOnLogin` guarda `session_token` y `device_id` en `localStorage`
6. `refreshSessionState` llama `GET /api/user/:id` para cargar user + products
7. Heartbeat inicia (intervalo 15s) → llama `GET /api/users-sessions`

---

## ⚠️ ZONAS DE RIESGO — No Romper

> Leer antes de modificar SessionContext, hooks de auth o el router.

### 🟠 A-11 · `session_token` y `device_id` en `localStorage` — extraíbles por XSS
- **Archivo:** `src/context/SessionContext.tsx:137–138, 482–483`
- **Riesgo:** `localStorage` es accesible por cualquier script en el mismo origen. Un XSS exitoso roba ambos valores y puede impersonar la sesión del usuario ante el backend.
- **Acción pendiente:** Migrar `session_token` y `device_id` a `sessionStorage` o a memoria React (ref/state) sin persistencia cross-tab.
- **NUNCA** usar `localStorage` para almacenar tokens o identificadores de sesión en nuevas funciones.

### 🟠 A-12 · Dos fuentes de verdad para el rol del usuario
- **Archivos:** `src/components/RequireAuth.tsx:16` vs `src/hooks/useAuth.ts:19`
- **Riesgo:** `RequireAuth` lee rol de `idTokenClaims.roles` (MSAL, puede estar desactualizado hasta 1h). `useAuth` lee `user.role` del backend (fuente de verdad real). Un cambio de rol en el backend no se refleja en `RequireAuth` hasta que expire el token de MSAL.
- **Acción pendiente:** Reescribir `RequireAuth` para usar `user.role` de `SessionContext`, o eliminar el componente y consolidar la lógica en `AppRouter`.
- **NUNCA** leer roles de `idTokenClaims` para decisiones de autorización.

### 🟠 A-14 · `access_token` de MSAL enviado en el body JSON al backend
- **Archivo:** `src/context/SessionContext.tsx:183–188`
- **Riesgo:** El token de MSAL se envía como `access_token: token` en el body de `invalidateSession`, además de usarse en el header `Authorization`. El token queda registrado en logs de red, Application Insights y proxies intermedios.
- **Acción pendiente:** Eliminar el campo `access_token` del body de la petición; el backend debe leerlo exclusivamente del header `Authorization: Bearer`.

---

## Reglas de Desarrollo Frontend

1. El rol del usuario **siempre** se lee de `user.role` (SessionContext/backend). Nunca de `idTokenClaims`.
2. **Nunca** guardar tokens o session IDs en `localStorage`. Usar `sessionStorage` o estado en memoria.
3. Al añadir rutas nuevas, hacerlo en `AppRouter` con la misma lógica de guardia inline (`userRole === "Admin"` o `hasProduct()`).
4. No usar `RequireAuth` hasta que sea reescrito para usar la fuente de verdad del backend.
5. Al añadir llamadas API en `logoutAndCleanup` o en el heartbeat, no incluir el `access_token` en el body.
6. Si se modifica `SessionContext`, verificar que el heartbeat no inicie múltiples intervalos paralelos.
7. Los filtros aplicados vía `filters: []` al componente `PowerBIEmbed` son **UX**, no seguridad. El control efectivo es el RLS del `EmbedToken` que el backend inyecta por usuario (`GEO_FILTERS_DESIGN.md §2.4`). No sustituir el backend por lógica de filtrado cliente.

---

## Feature en Diseño — Filtros Geográficos (cliente)

- **Nueva interfaz:** `src/interfaces/IGeoPermissions.ts` (`IGeoScope`, `IGeoPermissions`). Se añade `geo_permissions?: Record<string, IGeoPermissions>` a `IUser`.
- **Nuevo hook:** `src/hooks/useGeoPermissions.ts` — expone permisos por producto desde `SessionContext`.
- **`src/utils/GetFilters.ts`:** se reescribe para recibir `IGeoPermissions` (no `IUser`) y construir los filtros `In` sobre `cod_dep`, `cod_mun`, `id_zona`.
- **Páginas afectadas:** `src/pages/Votometro.tsx` y `src/pages/Audivoto.tsx` — retirar el `TODO: Re-enable filters` y conectar `useGeoPermissions` + `getFilters`.
- **Documento fuente:** `../GEO_FILTERS_DESIGN.md` (raíz del monorepo).
