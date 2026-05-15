# Refactorización del Esquema - Eliminar Anti-patrón CSV

## Contexto
La tabla `dbo.Products` actualmente almacena información geográfica (departamentos y municipios) como strings separados por comas (CSV) en las columnas `country`, `state`, y `city`. Esta es una mala práctica de diseño (anti-patrón).

## Solución
- **Eliminar** las columnas CSV: `country`, `state`, `city`
- **Crear** una relación normalizada: `dbo.Products (1) -- (N) dbo.User_Zones`
- Cada zona geográfica es ahora un registro en `dbo.User_Zones` vinculado al `product_id`

## Cambios en el Esquema

### 1. Tabla `dbo.Products`
**ANTES:**
```sql
CREATE TABLE [dbo].[Products](
    [id] [int] IDENTITY(1,1) NOT NULL,
    [user_id] [nvarchar](100) NULL,
    [product_name] [nvarchar](100) NULL,
    [contract_duration] [int] NULL,
    [duration_unit] [nvarchar](20) NULL,
    [expiration] [datetime] NULL,
    [country] [nvarchar](20) NULL,          <-- ELIMINAR
    [state] [nvarchar](2000) NULL,          <-- ELIMINAR
    [city] [nvarchar](2000) NULL,           <-- ELIMINAR
    [enable] [bit] NULL,
    [amount_cop] [decimal](10, 2) NULL,
    ...
);
```

**DESPUÉS:**
```sql
CREATE TABLE [dbo].[Products](
    [id] [int] IDENTITY(1,1) NOT NULL,
    [user_id] [nvarchar](100) NULL,
    [product_name] [nvarchar](100) NULL,
    [contract_duration] [int] NULL,
    [duration_unit] [nvarchar](20) NULL,
    [expiration] [datetime] NULL,
    [enable] [bit] NULL,
    [amount_cop] [decimal](10, 2) NULL,
    ...
);
```

### 2. Tabla `dbo.User_Zones`
**NUEVA ESTRUCTURA:**
```sql
CREATE TABLE dbo.User_Zones (
    id          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    user_id     NVARCHAR(64)      NOT NULL,
    product_id  INT               NULL,        -- NUEVA: FK a Products(id)
    cod_dep     CHAR(2)           NOT NULL,    -- Código departamento
    cod_mun     CHAR(5)           NULL,        -- Código municipio (NULL = departamento entero)
    enable      BIT               NOT NULL DEFAULT 1,
    created_at  DATETIME2(0)      NOT NULL DEFAULT SYSUTCDATETIME(),
    
    CONSTRAINT FK_UZ_product FOREIGN KEY (product_id)
        REFERENCES dbo.Products(id) ON DELETE CASCADE,
    
    CONSTRAINT CK_UZ_codes CHECK (
        cod_mun IS NULL OR LEFT(cod_mun, 2) = cod_dep
    )
);

CREATE INDEX IX_UZ_product_user ON dbo.User_Zones(product_id, user_id)
    INCLUDE (cod_dep, cod_mun, enable);
```

## Impacto en el Código

### Backend (Python/Azure Functions)
1. **Endpoint `/api/users/{user_id}/products` (PUT/POST)**
   - Recibir JSON con estructura: `{ products: [ { name, duration, zones: [...] } ] }`
   - Cambiar lógica de almacenamiento: MERGE en Products + INSERT en User_Zones

2. **Dataclass/Model actualizado:**
   ```python
   @dataclass
   class Product:
       id: int | None
       name: str
       contract_duration: int
       duration_unit: str
       amount_cop: Decimal
       enable: bool
       zones: List[UserZone]  # Lista de zonas, NO CSV string
   
   @dataclass
   class UserZone:
       cod_dep: str
       cod_mun: str | None
       enable: bool = True
   ```

3. **Procedimiento almacenado a usar:**
   - `dbo.UpsertUserProducts` — maneja el UPSERT completo (productos + zonas)

### Frontend (React)
1. **Componente `ProductsSelector`**
   - Ya tiene `votometroZones` y `audivotoZones` como arrays de `IUserZone[]`
   - En `handleSubmitProducts`, incluir directamente los arrays en el payload JSON

2. **API Call (`api.ts`)**
   ```typescript
   interface Product {
       id?: number;
       name: string;
       contract_duration: number;
       duration_unit: string;
       enable: boolean;
       zones: IUserZone[];  // Nuevo: array directo, NO string CSV
   }
   
   async function updateUserproducts(token, userId, products: Product[]) {
       return await apiCall(`/users/${userId}/products`, 'PUT', { products });
   }
   ```

## Pasos de Migración

### Paso 1: Aplicar cambios en el esquema SQL
```bash
# Ejecutar scripts en orden:
1. 01_base_schema.sql (con cambios: eliminar columnas CSV de Products)
2. 02_geo_rls.sql (actualizado con product_id FK)
3. 03_refactor_products_zones.sql (SPs nuevos y vista)
```

### Paso 2: Migrar datos históricos (si existen)
```sql
-- Ejecutar script de migración para mapear datos CSV → product_id
EXEC dbo.MigrateProductsCSVToZones @dry_run = 1;  -- Ver qué cambiaría
EXEC dbo.MigrateProductsCSVToZones @dry_run = 0;  -- Aplicar cambios
```

### Paso 3: Actualizar backend
- Actualizar modelos de Pydantic/Dataclass
- Actualizar `sql_adapter` para usar `UpsertUserProducts` SP
- Actualizar endpoint para recibir productos con `zones` array

### Paso 4: Actualizar frontend
- Actualizar `api.ts` con nueva estructura de productos
- Actualizar `ProductsSelector` para enviar zonas anidadas
- Actualizar `UpdateUser.tsx` → `handleSubmitProducts` para usar arrays directamente

### Paso 5: Pruebas
- Unit tests: Verificar que SP `UpsertUserProducts` funciona correctamente
- Integration tests: E2E con ProductsSelector → Backend → BD
- Data validation: Verificar que datos históricos migraron correctamente

## Queries de Verificación

### Antes de la migración
```sql
-- Ver estructura antigua
SELECT TOP 1 id, product_name, state, city FROM dbo.Products
WHERE state IS NOT NULL OR city IS NOT NULL;
```

### Después de la migración
```sql
-- Ver productos con sus zonas
EXEC dbo.GetUserProductsWithZones @user_id = 'USER_UUID';

-- Ver estructura normalizada
SELECT p.id, p.product_name, uz.cod_dep, uz.cod_mun
FROM dbo.Products p
LEFT JOIN dbo.User_Zones uz ON uz.product_id = p.id
WHERE p.id = 49;  -- Example product ID
```

## Archivos Modificados

1. ✅ **db/init/02_geo_rls.sql** — Actualizado con product_id FK
2. ✅ **db/init/03_refactor_products_zones.sql** — Nuevo script con SPs y vista
3. ⏳ **db/init/01_base_schema.sql** — PENDIENTE: Eliminar columnas country/state/city (demasiado grande para edit, requiere revisión manual)
4. ⏳ **votometro-backend/.../user_products_sql_adapter.py** — PENDIENTE: Fase 2 (Backend)
5. ⏳ **votometro-frontend/src/api.ts** — PENDIENTE: Fase 3 (Frontend API)
6. ⏳ **votometro-frontend/src/components/UpdateUser.tsx** — PENDIENTE: Fase 3 (Frontend)

## Status

- [x] FASE 1a: BD - 02_geo_rls.sql actualizado con product_id FK
- [x] FASE 1b: BD - 03_refactor_products_zones.sql creado (SPs, vista, migración)
- [ ] FASE 1c: BD - 01_base_schema.sql requiere actualización manual (>4500 líneas)
- [ ] FASE 2: Backend - Modelos + sql_adapter
- [ ] FASE 3: Frontend - API + components
