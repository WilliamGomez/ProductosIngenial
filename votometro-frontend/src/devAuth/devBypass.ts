// =============================================================================
// devBypass.ts — Mock auth para desarrollo local SIN tocar Azure AD.
// -----------------------------------------------------------------------------
// MOTIVACIÓN:
//   Permite desbloquear el frontend sin un tenant de Azure válido, sin
//   loginPopup() ni heartbeat al backend. Útil para iterar UI/UX o trabajar
//   offline.
//
// SEGURIDAD — POR QUÉ ESTO ES SEGURO EN PRODUCCIÓN:
//   El gate `isDevBypassActive()` combina dos chequeos:
//
//     1. `import.meta.env.DEV`  → CONSTANTE A BUILD-TIME.
//        Vite la sustituye literalmente por `true` en `vite dev`
//        y por `false` en cualquier `vite build` (modo production).
//        El bundler de producción ve `if (false && ...) { ... }` y
//        ELIMINA el bloque completo por dead-code elimination.
//
//     2. `VITE_LOCAL_AUTH_BYPASS === "true"` → flag explícito de runtime.
//        Sólo se evalúa si el chequeo (1) ya pasó.
//
//   Conclusión: aunque alguien suba un `.env` con
//   `VITE_LOCAL_AUTH_BYPASS=true` al server de producción, el código
//   del bypass YA NO EXISTE en el bundle minificado. La verificación
//   es estructural, no defensiva.
//
//   Validación rápida tras `pnpm run build`:
//     grep -r "DEV_BYPASS_ACCESS_TOKEN" dist/   # debe devolver vacío
// =============================================================================

import type { IUser } from "../interfaces/IUser";
import type { IProduct } from "../interfaces/IProduct";

/**
 * Indica si el bypass de auth está activo.
 *
 * Devuelve `true` SOLO si:
 * - El bundle se compiló en modo development (`vite dev` o equivalente),
 * - Y la env var `VITE_LOCAL_AUTH_BYPASS` está definida como la cadena `"true"`.
 *
 * En cualquier build de producción devuelve `false` y, por tree-shaking,
 * el código que dependa de él se elimina del bundle.
 */
export const isDevBypassActive = (): boolean => {
  // Build-time gate: en producción `import.meta.env.DEV === false` y este
  // primer return permite al bundler eliminar todo el resto del módulo
  // que no sea importado en producción.
  if (!import.meta.env.DEV) return false;

  // Runtime gate: requiere opt-in explícito vía .env.
  return import.meta.env.VITE_LOCAL_AUTH_BYPASS === "true";
};

// -----------------------------------------------------------------------------
// Mock data
// -----------------------------------------------------------------------------

const FAR_FUTURE_ISO = "2099-12-31T00:00:00";

const MOCK_PRODUCTS: IProduct[] = [
  {
    id: 1,
    name: "Votometro",
    expiration: FAR_FUTURE_ISO,
    contract_duration: 999,
    duration_unit: "months",
    country: "Colombia",
    state: "Antioquia",
    city: "Medellín",
    enable: true,
    amount_cop: 0,
    zones: [{ cod_dep: "05", cod_mun: "001" }],
  },
  {
    id: 2,
    name: "Audivoto",
    expiration: FAR_FUTURE_ISO,
    contract_duration: 999,
    duration_unit: "months",
    country: "Colombia",
    state: "Antioquia",
    city: "Medellín",
    enable: true,
    amount_cop: 0,
    zones: [{ cod_dep: "05", cod_mun: "001" }],
  },
];

/**
 * Usuario ficticio inyectado cuando el bypass está activo.
 * Rol "Admin" para tener visibilidad de todas las rutas
 * (/votometro, /audivoto, /users, /sessions-report).
 */
export const MOCK_USER: IUser = {
  id: "00000000-0000-0000-0000-000000000001",
  display_name: "Dev Admin (Local Bypass)",
  name: "Dev Admin",
  email: "dev-admin@local.test",
  phone: "+57 300 000 0000",
  identity_document: "0000000000",
  enable: true,
  department: "05",
  role: "Admin",
  products: MOCK_PRODUCTS,
};

/** Productos asignados al MOCK_USER. Re-exportado para uso desde useAuth. */
export const getMockProducts = (): IProduct[] => MOCK_PRODUCTS;

/**
 * Tokens dummy. Su contenido es irrelevante porque en bypass NO se hacen
 * llamadas reales al backend; `useAccessToken().getToken()` devuelve esto
 * sólo para que cualquier consumidor que lo pase a axios reciba un string.
 *
 * Si en algún flujo del frontend se llamara al backend en modo bypass
 * (no debería), el backend lo rechazaría con 401 — comportamiento esperado.
 */
export const MOCK_SESSION_TOKEN = "DEV_BYPASS_SESSION_TOKEN_DO_NOT_USE_IN_PROD";
export const MOCK_DEVICE_ID     = "dev-bypass-device-0001";
export const MOCK_ACCESS_TOKEN  = "DEV_BYPASS_ACCESS_TOKEN_DO_NOT_USE_IN_PROD";
