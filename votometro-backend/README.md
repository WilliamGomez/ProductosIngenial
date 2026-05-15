# Votometro Backend

Backend de la plataforma **Votometro** construido con **Azure Functions (Python)**. Gestiona usuarios, sesiones, datos geográficos y reportes embebidos de Power BI, integrando **Azure AD (MS Graph)** y **SQL Server**.

---

## Arquitectura

Sigue **Clean Architecture** con cuatro capas desacopladas:

```
votometro-backend/
├── function_app.py          # Entry point — registra los blueprints de Azure Functions
├── domain/                  # Lógica de negocio pura (modelos, excepciones, interfaces)
│   ├── models/              # Entidades: User, Product, Department, Municipality, Power BI
│   ├── repositories/        # Interfaces abstractas (contratos de repositorios)
│   └── exceptions.py        # Excepciones de dominio
├── app/                     # Adaptadores externos
│   ├── ms_graph/            # Integración con Azure AD vía MS Graph API
│   ├── power_bi/            # Integración con Power BI API
│   ├── sql/                 # Adaptadores SQL Server (pyodbc + stored procedures)
│   └── functions/
│       └── http_functions/  # Azure HTTP-triggered functions (endpoints)
├── use_cases/               # Orquestación de lógica de aplicación
└── shared/                  # Utilidades: autenticación MSAL, verificación JWT, helpers
```

---

## Tecnologías

| Paquete | Versión | Uso |
|---|---|---|
| `azure-functions` | latest | Framework Azure Functions |
| `msal` | 1.32.3 | Adquisición de tokens OAuth (MS Graph y Power BI) |
| `PyJWT` + `cryptography` | 2.8.0 / 43.0.3 | Verificación de tokens JWT de Azure AD |
| `pyodbc` | 5.2.0 | Conexión a SQL Server |
| `pandas` | 2.2.3 | Agrupación de resultados SQL |
| `requests` | 2.32.3 | Llamadas HTTP a APIs externas |
| `pytz` + `python-dateutil` | 2025.2 / 2.9.0 | Manejo de zonas horarias y fechas |

---

## Configuración

Las variables de entorno se definen en `local.settings.json` para desarrollo local y en la configuración de la Function App en Azure para producción.

| Variable | Descripción |
|---|---|
| `TENANT_ID` | ID del tenant de Azure AD |
| `MS_CLIENT_ID` | Client ID de la app en MS Graph |
| `MS_CLIENT_SECRET` | Secret de la app en MS Graph |
| `MS_OBJECT_ID` | Object ID del service principal |
| `POWER_BI_CLIENT_ID` | Client ID del service principal de Power BI |
| `POWER_BI_CLIENT_SECRET` | Secret del service principal de Power BI |
| `POWER_BI_GROUP_ID` | ID del workspace de Power BI |
| `SQL_CONNECTION_STRING` | Cadena de conexión ODBC a SQL Server |

---

## Endpoints

### Usuarios

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/user` | Crear usuario (Azure AD + SQL) |
| `GET` | `/api/user` | Listar todos los usuarios |
| `GET` | `/api/user/{user_id}` | Obtener usuario por ID |
| `PUT` | `/api/user/{user_id}` | Actualizar usuario |
| `PUT` | `/api/user-products/{user_id}` | Actualizar productos/suscripciones del usuario |

**Body `POST /api/user`:**
```json
{
  "display_name": "Juan Pérez",
  "email": "juan@empresa.com",
  "phone": "+573001234567",
  "password": "TempPass123!",
  "role": "User",
  "type_person": "natural",
  "type_dni": "CC",
  "identity_document": "1234567890",
  "reference": "ref1",
  "reference2": "ref2",
  "personal_email": "juan@personal.com",
  "products": [
    {
      "name": "Votometro",
      "contract_duration": 12,
      "duration_unit": "months",
      "country": 1,
      "state": 5,
      "city": 76001,
      "amount_cop": 1000000.00,
      "enable": true
    }
  ]
}
```

### Sesiones

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/session` | Crear sesión (invalida sesiones previas) |
| `POST` | `/api/invalidate-session` | Cerrar sesión en dispositivo específico |
| `POST` | `/api/session/force-logout-all` | Cerrar sesión en todos los dispositivos |
| `GET` | `/api/users-sessions` | Listar sesiones activas (requiere token admin) |

**Body `POST /api/session`:**
```json
{ "access_token": "JWT_TOKEN", "device_id": "device-uuid" }
```
**Respuesta:** `{ "session_token": "uuid" }`

> **Nota:** Se permite una sola sesión activa por usuario. Al iniciar sesión se invalidan todas las sesiones anteriores.

### Datos Geográficos

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/countries` | Listar países |
| `GET` | `/api/departments` | Listar departamentos |
| `GET` | `/api/municipality` | Listar municipios |

### Power BI

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/power-bi` | Listar reportes del workspace |
| `GET` | `/api/power-bi/{reportId}` | Obtener token de embedding para un reporte |

El acceso a reportes está controlado por el producto habilitado del usuario (`REPORT_TO_PRODUCT_MAP`). Los usuarios con rol `Admin` tienen acceso a todos los reportes.

---

## Modelos de Dominio

### `User`

```python
@dataclass
class User:
    display_name: str
    email: str
    phone: str
    enable: bool = True
    id: Optional[str] = None          # Azure AD Object ID
    department: str = "IngenialAI"
    role: str = "User"
    password: str = None
    type_person: str = None
    type_dni: str = None
    identity_document: str = None
    reference: str = None
    reference2: str = None
    personal_email: str = None
    created_at: Optional[datetime] = None
    products: List[Product] = field(default_factory=list)
```

### `Product`

```python
@dataclass
class Product:
    name: str                          # Ej: "Votometro", "Audivoto"
    contract_duration: float
    duration_unit: str                 # "months" | "days" | "years"
    expiration: Optional[datetime] = None
    country: Optional[int] = None
    state: Optional[int] = None
    city: Optional[int] = None
    enable: Optional[bool] = True
    amount_cop: Optional[float] = None
```

---

## Casos de Uso

| Use Case | Descripción |
|---|---|
| `CreateUserUseCase` | Crea usuario en Azure AD, asigna rol, guarda metadata y productos en SQL |
| `UpdateUserUseCase` | Actualiza usuario en Azure AD y SQL; reasigna roles si cambian |
| `UpdateUserProductsUseCase` | Estado deseado: habilita productos enviados, deshabilita los demás |
| `ValidateSessionUseCase` | Invalida sesiones previas, genera nuevo token de sesión |
| `InvalidateSessionUseCase` | Invalida sesión de un dispositivo específico |
| `ForceLogoutAllDevicesUseCase` | Invalida todas las sesiones del usuario |
| `PowerBIUseCase` | Obtiene reportes y genera tokens de embedding |

---

## Autenticación y Seguridad

- **JWT (Azure AD):** Los tokens se verifican con las claves públicas del tenant (RS256). Se valida firma, expiración, audience e issuer.
- **MSAL:** Tokens de servicio para MS Graph y Power BI se adquieren con `client_credentials` y se cachean en memoria.
- **RBAC:** Roles `Admin` y `User` gestionados como App Roles en Azure AD.
- **Autorización por producto:** Los reportes de Power BI sólo son accesibles si el usuario tiene el producto correspondiente habilitado.

---

## Base de Datos

Toda la interacción con SQL Server se realiza mediante **stored procedures**. Los principales son:

| Stored Procedure | Propósito |
|---|---|
| `InsertUser` | Insertar usuario |
| `UpdateUser` | Actualizar usuario |
| `GetUserById` | Obtener usuario con productos |
| `GetUsersWithProducts` | Listar todos los usuarios con productos |
| `UpsertProduct` | Insertar o actualizar producto |
| `CreateUserSession` | Crear registro de sesión |
| `InvalidateUserSessions` | Invalidar sesión por dispositivo |
| `InvalidateAllUserSessions` | Invalidar todas las sesiones de un usuario |
| `GetActiveSessionByUserId` | Obtener sesión activa |
| `GetUserSessionsInfo` | Listar info de sesiones activas |
| `ListDepartments` | Listar departamentos |
| `ListMunicipalities` | Listar municipios |

---

## Desarrollo Local

```bash
# Instalar dependencias
pip install -r requirements.txt

# Configurar variables de entorno en local.settings.json

# Iniciar la Function App localmente (requiere Azure Functions Core Tools)
func start
```

La app estará disponible en `http://localhost:7071`.
