import { createRoot } from "react-dom/client";
import { PublicClientApplication, EventType } from "@azure/msal-browser";
import type { EventMessage, AuthenticationResult } from "@azure/msal-browser";

import App from "./App.tsx";
import "./index.css";
import { authConfigError, msalConfig } from "./authConfig.ts";

const rootElement = document.getElementById("root") as HTMLElement;

if (authConfigError) {
  rootElement.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#0f172a;font-family:Inter,system-ui,sans-serif;padding:24px;">
      <section style="max-width:560px;border:1px solid #fecaca;background:#fff;border-radius:12px;padding:24px;box-shadow:0 20px 45px rgba(15,23,42,.08);">
        <p style="margin:0 0 8px;color:#b91c1c;font-weight:700;">Configuración de autenticación incompleta</p>
        <h1 style="margin:0 0 12px;font-size:24px;line-height:1.2;">No se puede iniciar sesión con Microsoft.</h1>
        <p style="margin:0;color:#475569;line-height:1.5;">${authConfigError}. Reconstruye la imagen del frontend con los build args VITE_AZURE_CLIENT_ID, VITE_AZURE_TENANT_ID y VITE_BACKEND_URL.</p>
      </section>
    </main>
  `;
  throw new Error(authConfigError);
}

export const msalInstance = new PublicClientApplication(msalConfig);

const accounts = msalInstance.getAllAccounts();

if (accounts.length > 0) {
  msalInstance.setActiveAccount(accounts[0]);
}

// =============================================================================
// Bootstrap MSAL
// -----------------------------------------------------------------------------
// CAMBIO 2026-05-09 (fix COOP / "Cargando..." infinito):
//   La app pasó de `loginPopup()` a `loginRedirect()` para evitar el bloqueo
//   de Cross-Origin-Opener-Policy con popups a `login.microsoftonline.com`.
//
//   `handleRedirectPromise()` ES OBLIGATORIO en el bootstrap cuando se usa
//   el flow redirect. Procesa el hash `#code=...&state=...` que Entra ID
//   añade a la URL al volver de la pantalla de login. Sin esto:
//     · MSAL nunca dispara LOGIN_SUCCESS
//     · `useIsAuthenticated()` queda en `false`
//     · `inProgress` queda en `HandleRedirect` por siempre
//     · AppRouter se queda en <Spinner /> ("Cargando..." infinito)
//
//   Tras procesar el hash, hacemos `setActiveAccount(...)` con la cuenta
//   resultante para que `useAccessToken().getToken()` funcione vía
//   `acquireTokenSilent` sin necesidad de popup adicional.
// =============================================================================
msalInstance
  .initialize()
  .then(() => msalInstance.handleRedirectPromise())
  .then((response) => {
    // Si veníamos de un redirect exitoso, fija la cuenta como activa
    // inmediatamente — antes de renderizar el árbol React.
    if (response?.account) {
      msalInstance.setActiveAccount(response.account);
    }

    // Defensa: si no vino respuesta de redirect pero hay cuentas previas
    // en el cache de MSAL (sessionStorage), elige la primera como activa.
    const accounts = msalInstance.getAllAccounts();
    if (accounts.length > 0 && !msalInstance.getActiveAccount()) {
      msalInstance.setActiveAccount(accounts[0]);
    }

    msalInstance.addEventCallback((event: EventMessage) => {
      if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
        const payload = event.payload as AuthenticationResult;
        msalInstance.setActiveAccount(payload.account);
      }
    });

    const root = createRoot(rootElement);
    root.render(<App pca={msalInstance} />);
  })
  .catch((err) => {
    // No queremos un white-screen silencioso si el bootstrap de MSAL falla:
    // log + render del árbol igual, para que la app pueda mostrar /login y
    // el usuario tenga oportunidad de re-iniciar el flow.
    // eslint-disable-next-line no-console
    console.error("[main] MSAL bootstrap failed:", err);
    const root = createRoot(rootElement);
    root.render(<App pca={msalInstance} />);
  });
