// =============================================================================
// authConfig.ts — configuración MSAL alineada con .env del monorepo
// -----------------------------------------------------------------------------
// FIX (Causa Raíz #1):
//   Antes este archivo leía VITE_CLIENT_ID, VITE_TENANT_ID, VITE_REDIRECT_URI,
//   VITE_CLIENT_ID_SCOPE, VITE_BASE_ENDPOINT — nombres que NO existen en
//   `.env.example` ni en los `args` del docker-compose. Resultado:
//   `clientId: undefined` → `PublicClientApplication` arrancaba malformado →
//   `inProgress` jamás llegaba a `None` → AppRouter quedaba colgado en
//   <Spinner /> ("Loading infinito"). Ahora se consumen los nombres
//   reales (`VITE_AZURE_*`, `VITE_BACKEND_URL`).
//
// FIX (Causa Raíz #2):
//   `redirectUri` ahora cae a `window.location.origin` si la env var no
//   está presente, evitando que MSAL crashee con redirect_uri_mismatch
//   en setups de dev donde sólo se inyectaron los IDs.
//
// NOTA (B-05 del DIAGNOSTIC_REPORT.md):
//   `cacheLocation: "sessionStorage"` se mantiene a propósito — evita que
//   tokens de MSAL se persistan entre cierres de browser. La consecuencia
//   conocida (sesiones por pestaña no compartidas) es deuda aceptada.
// =============================================================================

import { LogLevel } from "@azure/msal-browser";

const clientId   = import.meta.env.VITE_AZURE_CLIENT_ID;
const tenantId   = import.meta.env.VITE_AZURE_TENANT_ID;

// -----------------------------------------------------------------------------
// FIX AADSTS500011 — el bug:
//   El fallback anterior derivaba apiScope del propio `clientId` del frontend
//   (`api://${clientId}/user_impersonation`). Como el App Registration del SPA
//   NO expone una API, el AS de Azure rechazaba el token request con:
//     AADSTS500011: The resource principal named api://<frontend-id> was not
//     found in the tenant.
//
//   Arquitectura correcta: el frontend (SPA) pide tokens para la API expuesta
//   por el App Registration DEL BACKEND. Por eso el scope debe apuntar al
//   Application ID URI del backend, no al del SPA.
//
//   `clientId` (VITE_AZURE_CLIENT_ID = 51ddd54e-…) sigue siendo el ID con
//   el que el SPA se identifica ante Azure AD; SOLO cambia el `aud` del
//   access token solicitado.
// -----------------------------------------------------------------------------
// Application (client) ID del App Registration del **backend** (Azure
// Functions). Hardcodeado por decisión de producto: este valor es el
// destino fijo del access token y no varía por entorno (mismo backend
// app registration en dev/staging/prod). Si en el futuro hace falta
// variar por entorno, cambiar a VITE_AZURE_API_CLIENT_ID en .env.
const BACKEND_API_CLIENT_ID = "d29a0628-b1a4-44de-a872-a801324d7506";

const apiScope =
  import.meta.env.VITE_AZURE_API_SCOPE ||
  `api://${BACKEND_API_CLIENT_ID}/user_impersonation`;

const apiEndpoint = import.meta.env.VITE_BACKEND_URL;

// Validación temprana — falla ruidosamente al cargar la app si falta
// configuración esencial. Mejor un console.error visible que un spinner
// infinito sin pista.
if (!clientId || !tenantId || !apiEndpoint) {
  // eslint-disable-next-line no-console
  console.error("[authConfig] Faltan VITE_AZURE_* / VITE_BACKEND_URL", {
    hasClientId:  !!clientId,
    hasTenantId:  !!tenantId,
    hasApiScope:  !!apiScope,
    hasEndpoint:  !!apiEndpoint,
  });
}

// redirectUri: tiene que coincidir EXACTAMENTE con uno de los registrados
// en el portal de Azure (incluyendo trailing slash, esquema y puerto).
// `window.location.origin` es la opción portable: en dev resuelve a
// `http://localhost:8080`, en prod a `https://<dominio>`.
const redirectUri =
  import.meta.env.VITE_REDIRECT_URI ||
  (typeof window !== "undefined" ? window.location.origin : "/");

export const msalConfig = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri,
    postLogoutRedirectUri: `${redirectUri}/login`,
    navigateToLoginRequestUrl: false,
  },
  cache: {
    cacheLocation: "sessionStorage" as const,
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level: LogLevel, message: string, containsPii: boolean) => {
        if (containsPii || !import.meta.env.DEV) return;
        // eslint-disable-next-line no-console
        console.log(`[MSAL ${LogLevel[level]}] ${message}`);
      },
      logLevel: import.meta.env.DEV ? LogLevel.Verbose : LogLevel.Warning,
    },
  },
};

export const loginRequest = {
  scopes: apiScope ? [apiScope] : [],
};

export const graphConfig = {
  graphMeEndpoint: "https://graph.microsoft.com/v1.0/me",
};

export const protectedResources = {
  api: {
    endpoint: apiEndpoint,
    scopes: apiScope ? [apiScope] : [],
  },
};
