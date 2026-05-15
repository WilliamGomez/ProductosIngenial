/// <reference types="vite/client" />

// =============================================================================
// Tipado de variables de entorno expuestas a Vite (`import.meta.env.*`).
// -----------------------------------------------------------------------------
// Reglas:
//   1. Toda variable consumida por el código debe estar declarada aquí.
//   2. Sólo `VITE_*` es accesible desde el cliente — Vite no expone otras.
//   3. NUNCA poner secretos (client_secret, function key) — todo lo declarado
//      acaba embebido en el bundle JS público.
// =============================================================================

interface ImportMetaEnv {
  // --- Azure AD / MSAL (públicos, embebidos en el bundle) -------------------
  readonly VITE_AZURE_CLIENT_ID: string;
  readonly VITE_AZURE_TENANT_ID: string;
  /** Scope expuesto por la API. Por defecto `api://<clientId>/user_impersonation`. */
  readonly VITE_AZURE_API_SCOPE?: string;
  /** Override opcional del redirectUri MSAL. Si falta, se usa window.location.origin. */
  readonly VITE_REDIRECT_URI?: string;

  // --- Backend ---------------------------------------------------------------
  readonly VITE_BACKEND_URL: string;

  // --- Dev-only --------------------------------------------------------------
  /**
   * Bypass de auth para desarrollo local.
   * NUNCA leer en producción — `import.meta.env.DEV` colapsa la rama
   * y el tree-shaker elimina el código del bundle prod.
   */
  readonly VITE_LOCAL_AUTH_BYPASS?: "true" | "false";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
