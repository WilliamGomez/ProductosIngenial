# Votometro Frontend

Frontend de la plataforma **Ingenial IA** para monitoreo y auditoría electoral, con dashboards embebidos de Power BI y gestión de usuarios basada en roles.

## Stack tecnológico

| Categoría | Tecnología |
|-----------|-----------|
| UI | React 19 + TypeScript 5.8 |
| Build | Vite 6 |
| Routing | React Router v7 |
| Autenticación | Azure MSAL (OAuth 2.0) |
| Estilos | Tailwind CSS 4 + DaisyUI 5 |
| HTTP | Axios |
| Reportes | Power BI Embedded |
| Íconos | Lucide React |
| Alertas | SweetAlert2 |

## Estructura del proyecto

```
src/
├── assets/          # Imágenes y logos
├── components/      # Componentes reutilizables
│   └── ui/          # Componentes UI genéricos (Spinner, etc.)
├── context/         # Providers de React Context (SessionContext)
├── hooks/           # Custom hooks (useAuth, useAccessToken, useTableSort)
├── interfaces/      # Interfaces TypeScript de los modelos de datos
├── layouts/         # Layouts de página (MainLayout)
├── pages/           # Componentes de página / rutas
├── router/          # Configuración de rutas (AppRouter)
├── services/        # Capa de comunicación con la API (api.ts)
├── styles/          # Estilos globales adicionales
├── types/           # Tipos TypeScript auxiliares
└── utils/           # Utilidades (GetDeviceId, GetFilters)
```

## Páginas y rutas

| Ruta | Componente | Acceso |
|------|-----------|--------|
| `/login` | `Login` | Público |
| `/votometro` | `Votometro` | Usuarios con producto Votometro / Admin |
| `/audivoto` | `Audivoto` | Usuarios con producto AudiVoto / Admin |
| `/users` | `UsersAdmin` | Solo Admin |
| `/sessions-report` | `SessionsAdmin` | Solo Admin |
| `*` | Redirect | — |

Las rutas se cargan de forma lazy (code splitting) y se generan dinámicamente según el rol y los productos asignados al usuario.

## Autenticación y sesiones

- **Azure AD / MSAL** gestiona el login (popup) y la renovación silenciosa de tokens.
- Tras autenticarse, el frontend valida la sesión contra el backend (`POST /session`) y almacena el `sessionToken` y un `deviceId` persistente (localStorage).
- **Control de sesión única:** un heartbeat cada 15 segundos verifica que la sesión siga activa. Si el usuario inicia sesión desde otro dispositivo, la sesión anterior se invalida y se fuerza el logout automáticamente.
- Los **roles** (`Admin` / `User`) provienen del backend, no de los claims del token de Azure.

## Gestión de estado

Se usa **React Context API** sin librerías externas.

- **`SessionContext`** — estado global principal: usuario, productos, sessionToken, deviceId, estado de carga y lógica del heartbeat.
- **`useAuth`** — combina el estado de MSAL con SessionContext y expone: `isAuthenticated`, `userRole`, `userId`, `userProducts`, `isLoadingProducts`, `isMsalLoading`.
- **`useAccessToken`** — adquiere el token de Azure (silent → popup como fallback).
- **`useTableSort`** — lógica de ordenamiento para tablas (soporta string, number, date, boolean).

## Servicios API

`src/services/api.ts` contiene una instancia de Axios con `baseURL = VITE_BASE_ENDPOINT` y timeout de 60 s. Todos los endpoints requieren `Authorization: Bearer {token}`.

| Endpoint | Método | Propósito |
|----------|--------|-----------|
| `/session` | POST | Validar sesión y obtener sessionToken |
| `/invalidate-session` | POST | Invalidar una sesión específica |
| `/session/force-logout-all` | POST | Forzar logout de todas las sesiones del usuario |
| `/power-bi` | GET | Listar reportes Power BI |
| `/power-bi/{reportId}` | GET | Obtener configuración de embed de un reporte |
| `/user` | GET / POST | Listar o crear usuarios (Admin) |
| `/user/{userId}` | GET / PUT | Obtener o actualizar usuario |
| `/user-products/{userId}` | PUT | Actualizar productos asignados al usuario |
| `/users-sessions` | GET | Listar sesiones activas (Admin) |
| `/countries` / `/departments` / `/municipality` | GET | Datos geográficos para filtros |

## Power BI

Los reportes se renderizan con `powerbi-client-react`. El token de embed se renueva automáticamente antes de su expiración (ventana de seguridad de 5 minutos, ciclo por defecto de 55 minutos). Si la renovación falla, se re-embebe el reporte completo.

## Variables de entorno

Crear un archivo `.env` en la raíz con:

```env
VITE_BASE_ENDPOINT=     # URL base de la API backend
VITE_CLIENT_ID=         # App ID de Azure AD
VITE_TENANT_ID=         # Tenant ID de Azure AD
VITE_REDIRECT_URI=      # URI de redirección OAuth (ej. http://localhost:5173)
VITE_CLIENT_ID_SCOPE=   # Scope del API (normalmente el mismo App ID)
```

## Comandos

```bash
# Instalar dependencias
pnpm install

# Servidor de desarrollo
pnpm dev

# Build de producción
pnpm build

# Vista previa del build
pnpm preview

# Linting
pnpm lint
```

## Roles y control de acceso

| Rol | Acceso |
|-----|--------|
| `Admin` | Todas las rutas: reportes, gestión de usuarios y sesiones |
| `User` | Solo las rutas de los productos que tenga asignados |

Si un usuario no tiene productos asignados, se le redirige a `/login`.
