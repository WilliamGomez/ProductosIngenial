import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMsal } from "@azure/msal-react";
import axios from "axios";
import Swal from "sweetalert2";

import type { IUser } from "../interfaces/IUser";
import type { IProduct } from "../interfaces/IProduct";
import type { ISessionInfo } from "../interfaces/ISessionInfo";
import { getUser, getUsersSessionsInfo, invalidateSession, validateSession } from "../services/api";
import { getDeviceId } from "../utils/GetDeviceId";
import { protectedResources } from "../authConfig";
import {
  isDevBypassActive,
  MOCK_USER,
  MOCK_SESSION_TOKEN,
  MOCK_DEVICE_ID,
  getMockProducts,
} from "../devAuth/devBypass";

interface ValidateSessionPayload {
  sessionToken: string;
  deviceId: string;
  userId?: string | null;
}

interface LogoutOptions {
  invalidateOnServer?: boolean;
  triggerMsalLogout?: boolean;
  reason?: string;
}

interface SessionContextValue {
  user: IUser | null;
  products: IProduct[];
  sessionToken: string | null;
  deviceId: string | null;
  isLoading: boolean;
  refreshSessionState: (sessionTokenOverride?: string, userIdOverride?: string) => Promise<void>;
  validateSessionOnLogin: (payload: ValidateSessionPayload) => Promise<void>;
  logoutAndCleanup: (options?: LogoutOptions) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

const STORAGE_KEYS = {
  sessionToken: "session_token",
  deviceId: "device_id",
} as const;

const HEARTBEAT_INTERVAL_MS = 15_000; // Check every 15 seconds for single-session enforcement

// Map internal reason codes to user-friendly messages
const getLogoutMessage = (reason: string): { title: string; text: string } | null => {
  if (reason.includes("Session not found") || reason.includes("Session marked as inactive")) {
    return {
      title: "Sesión terminada",
      text: "Tu sesión fue terminada porque se detectó un inicio de sesión en otro dispositivo.",
    };
  }
  if (reason.includes("Session blocked")) {
    return {
      title: "Sesión bloqueada",
      text: "Tu sesión fue bloqueada por un administrador.",
    };
  }
  if (reason.includes("Session unauthorized")) {
    return {
      title: "Sesión expirada",
      text: "Tu sesión ha expirado. Por favor inicia sesión nuevamente.",
    };
  }
  if (reason.includes("revoked by administrator")) {
    return {
      title: "Sesion finalizada",
      text: "Su sesion ha sido finalizada por el administrador.",
    };
  }
  if (reason.includes("User is disabled")) {
    return {
      title: "Usuario deshabilitado",
      text: "Tu cuenta ha sido deshabilitada. Contacta al administrador.",
    };
  }
  return null;
};

const findMatchingSession = (sessions: ISessionInfo[], userId: string, deviceId: string | null, sessionToken: string | null) => {
  return sessions.find((session) => {
    if (session.user_id !== userId) {
      return false;
    }

    if (deviceId && session.device_id === deviceId) {
      return true;
    }

    if (sessionToken && session.session_token === sessionToken) {
      return true;
    }

    return false;
  });
};

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  // ---------------------------------------------------------------------------
  // DEV BYPASS — short-circuit total: NO hooks de MSAL, NO heartbeat, NO
  // llamadas al backend. Devuelve un SessionContextValue inmutable con
  // MOCK_USER (rol Admin + productos completos).
  //
  // Seguridad: `isDevBypassActive()` requiere `import.meta.env.DEV === true`,
  // que Vite reemplaza literalmente por `false` en build prod → este bloque
  // entero queda como dead code y es eliminado por tree-shaking. Las Rules
  // of Hooks no se rompen porque el "if" se colapsa a una sola rama en
  // tiempo de build, no hay path divergente en runtime.
  // ---------------------------------------------------------------------------
  if (isDevBypassActive()) {
    const mockValue: SessionContextValue = {
      user: MOCK_USER,
      products: getMockProducts(),
      sessionToken: MOCK_SESSION_TOKEN,
      deviceId: MOCK_DEVICE_ID,
      isLoading: false,
      refreshSessionState: async () => {
        // no-op: en bypass no hay backend que consultar.
      },
      validateSessionOnLogin: async () => {
        // no-op: el botón de login se cortocircuita aguas arriba.
      },
      logoutAndCleanup: async () => {
        // eslint-disable-next-line no-console
        console.warn(
          "[DevBypass] logoutAndCleanup llamado. En bypass no hay sesión real que invalidar. Apaga VITE_LOCAL_AUTH_BYPASS para flujo real."
        );
      },
    };
    return <SessionContext.Provider value={mockValue}>{children}</SessionContext.Provider>;
  }

  const { instance } = useMsal();

  const [user, setUser] = useState<IUser | null>(null);
  const [products, setProducts] = useState<IProduct[]>([]);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [explicitUserId, setExplicitUserId] = useState<string | null>(null);
  const MAX_HEARTBEAT_FAILURES = 5;

  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const isRefreshingRef = useRef<boolean>(false);
  const heartbeatFailureCountRef = useRef<number>(0);
  // Sentinel para evitar disparar el bootstrap post-redirect más de una vez
  // (StrictMode monta los efectos dos veces en dev, y el flujo de redirect
  // hace re-render varios veces antes de que `user` esté seteado).
  const postRedirectBootstrapRef = useRef<boolean>(false);

  const activeAccount = instance.getActiveAccount();
  const derivedUserId = (activeAccount?.idTokenClaims?.oid as string | undefined) ?? null;
  const resolvedUserId = explicitUserId ?? derivedUserId;

  // Keep userIdRef in sync - this allows startHeartbeat to read the latest value immediately
  userIdRef.current = resolvedUserId;

  const setSessionIdentifiers = useCallback((tokenValue: string | null, deviceValue: string | null) => {
    setSessionToken(tokenValue);
    sessionTokenRef.current = tokenValue;
    setDeviceId(deviceValue);
    deviceIdRef.current = deviceValue;
  }, []);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const cleanupLocalSession = useCallback(() => {
    clearHeartbeat();
    setSessionIdentifiers(null, null);
    setUser(null);
    setProducts([]);
    setIsLoading(false);
    localStorage.removeItem(STORAGE_KEYS.sessionToken);
    localStorage.removeItem(STORAGE_KEYS.deviceId);
  }, [clearHeartbeat, setSessionIdentifiers]);

  const acquireApiToken = useCallback(async (): Promise<string> => {
    const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];

    if (!account) {
      console.error("[acquireApiToken] No active account available");
      throw new Error("No active account available to acquire token");
    }

    const request = {
      account,
      scopes: protectedResources.api.scopes,
    };

    try {
      const response = await instance.acquireTokenSilent(request);
      return response.accessToken;
    } catch (silentError) {
      console.warn("[acquireApiToken] Silent acquisition failed, trying popup", silentError);

      try {
        const response = await instance.acquireTokenPopup(request);
        return response.accessToken;
      } catch (popupError) {
        console.error("[acquireApiToken] Both silent and popup failed", popupError);
        throw popupError;
      }
    }
  }, [instance]);

  const logoutAndCleanup = useCallback(
    async (options?: LogoutOptions) => {
      const { invalidateOnServer = true, triggerMsalLogout = true, reason } = options ?? {};

      if (reason) {
        console.info(`[Logout] Reason: ${reason}`);
      }

      const currentSessionToken = sessionTokenRef.current;
      const currentDeviceId = deviceIdRef.current;

      if (invalidateOnServer && currentSessionToken && currentDeviceId) {
        try {
          const token = await acquireApiToken();
          // Tras refactor de api.ts, `invalidateSession` recibe el sessionId
          // como string y arma `{ session_id }` internamente. Usamos el
          // session_token como identificador (el backend lo resuelve igual).
          await invalidateSession(token, currentSessionToken);
        } catch (error) {
          console.error("Failed to invalidate remote session", error);
        }
      }

      cleanupLocalSession();
      setExplicitUserId(null);

      if (triggerMsalLogout) {
        try {
          // Show logout message BEFORE redirect if there's a reason
          if (reason) {
            const message = getLogoutMessage(reason);
            if (message) {
              await Swal.fire({
                title: message.title,
                text: message.text,
                icon: "warning",
                confirmButtonText: "Aceptar",
              });
            }
          }
          // Use logoutRedirect instead of logoutPopup to avoid requiring user interaction
          // This is important for automatic session invalidation (e.g., when another device logs in)
          await instance.logoutRedirect({
            postLogoutRedirectUri: "/login",
            account: instance.getActiveAccount() ?? undefined,
          });
        } catch (error) {
          console.error("Failed to logout from MSAL", error);
        }
      }
    },
    [acquireApiToken, cleanupLocalSession, instance]
  );

  const refreshSessionState = useCallback(async (sessionTokenOverride?: string, userIdOverride?: string) => {
    // Evitar llamadas concurrentes a refreshSessionState
    // Esto previene peticiones duplicadas a /user/:userId
    if (isRefreshingRef.current) {
      console.warn('[refreshSessionState] Already in progress, skipping');
      return;
    }

    const effectiveSessionToken = sessionTokenOverride ?? sessionTokenRef.current;

    if (!effectiveSessionToken) {
      console.warn('[refreshSessionState] No session token available');
      setIsLoading(false);
      return;
    }

    // CRITICAL FIX: Use userIdOverride if provided, otherwise fall back to resolvedUserId
    // This prevents race condition where explicitUserId state hasn't updated yet
    const effectiveUserId = userIdOverride ?? resolvedUserId;

    if (!effectiveUserId) {
      console.warn('[refreshSessionState] No resolved user ID available');
      setIsLoading(false);
      return;
    }
    isRefreshingRef.current = true;
    setIsLoading(true);

    try {
      const token = await acquireApiToken();
      const data = await getUser(token, effectiveUserId);

      if (!data.enable) {
        console.warn('[refreshSessionState] User is disabled, logging out');
        await logoutAndCleanup();
        return;
      }

      // Ensure products is always an array
      const normalizedProducts = Array.isArray(data.products) ? data.products : [];

      setUser(data);
      setProducts(normalizedProducts);
    } catch (error) {
      console.error("[refreshSessionState] Failed to refresh session state", error);

      // On error, we should still set loading to false to prevent infinite spinner
      // but we should also cleanup the session if the error is auth-related
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 401 || status === 403) {
          console.error('[refreshSessionState] Authentication error, logging out');
          await logoutAndCleanup({
            invalidateOnServer: false,
            triggerMsalLogout: true,
            reason: 'Failed to refresh session: authentication error'
          });
          return;
        }
      }
    } finally {
      setIsLoading(false);
      isRefreshingRef.current = false;
    }
  }, [acquireApiToken, logoutAndCleanup, resolvedUserId]);

  const runHeartbeatCheck = useCallback(async () => {
    try {
      // Step 1: Acquire token (may fail temporarily)
      let token: string;
      try {
        token = await acquireApiToken();
      } catch (tokenError) {
        console.warn("[Heartbeat] Failed to acquire token", tokenError);

        // Increment failure counter using ref
        heartbeatFailureCountRef.current += 1;
        const newCount = heartbeatFailureCountRef.current;

        // Only logout after consecutive failures
        if (newCount >= MAX_HEARTBEAT_FAILURES) {
          console.error("[Heartbeat] Max failures reached, logging out");
          await logoutAndCleanup({
            invalidateOnServer: false,
            triggerMsalLogout: true,
            reason: "Heartbeat: Failed to acquire token after multiple attempts"
          });
        } else {
          console.warn(`[Heartbeat] Token acquisition failed (${newCount}/${MAX_HEARTBEAT_FAILURES}), will retry`);
        }
        return; // Exit early, don't check session
      }

      // Step 2: Fetch session info
      let sessions: ISessionInfo[];
      const currentDeviceId = deviceIdRef.current;
      try {
        sessions = await getUsersSessionsInfo(token, currentDeviceId ?? undefined);
      } catch (apiError) {
        console.warn("[Heartbeat] Failed to fetch session info", apiError);

        // Check if it's a network error vs authorization error
        if (axios.isAxiosError(apiError)) {
          const isNetworkError = !apiError.response; // No response = network issue
          const isTimeout = apiError.code === 'ECONNABORTED';

          if (isNetworkError || isTimeout) {
            // Network errors are temporary, don't count as failures
            console.warn("[Heartbeat] Network error detected, will retry next cycle");
            return; // Exit early, keep session alive
          }

          // Authorization errors (401, 403) should trigger logout
          if (apiError.response?.status === 401 || apiError.response?.status === 403) {
            console.error("[Heartbeat] Authorization error, logging out");
            await logoutAndCleanup({
              invalidateOnServer: false,
              triggerMsalLogout: true,
              reason: "Heartbeat: Session unauthorized"
            });
            return;
          }
        }

        // Unknown error, increment counter using ref
        heartbeatFailureCountRef.current += 1;
        const newCount = heartbeatFailureCountRef.current;

        if (newCount >= MAX_HEARTBEAT_FAILURES) {
          console.error("[Heartbeat] Max failures reached, logging out");
          await logoutAndCleanup({
            invalidateOnServer: false,
            triggerMsalLogout: true,
            reason: "Heartbeat: API errors after multiple attempts"
          });
        } else {
          console.warn(`[Heartbeat] API error (${newCount}/${MAX_HEARTBEAT_FAILURES}), will retry`);
        }
        return;
      }

      // Step 3: Validate session
      const currentSessionToken = sessionTokenRef.current;
      const currentUserId = userIdRef.current;

      if (!currentUserId || !currentSessionToken) {
        return;
      }

      const matchingSession = findMatchingSession(sessions, currentUserId, currentDeviceId, currentSessionToken);

      if (!matchingSession) {
        // Double-check: wait 2 seconds and retry once before logging out
        // This helps avoid race conditions during login/refresh
        console.warn("[Heartbeat] No matching session found, will retry once in 2 seconds...");
        await new Promise(resolve => setTimeout(resolve, 2000));

        try {
          const retryToken = await acquireApiToken();
          const retrySessions = await getUsersSessionsInfo(retryToken, currentDeviceId ?? undefined);
          const retryMatch = findMatchingSession(retrySessions, currentUserId, currentDeviceId, currentSessionToken);

          if (retryMatch && retryMatch.is_active) {
            console.info("[Heartbeat] Session found on retry, continuing");
            heartbeatFailureCountRef.current = 0;
            return;
          }
        } catch (retryError) {
          console.warn("[Heartbeat] Retry also failed", retryError);
        }

        console.warn("[Heartbeat] Session still not found after retry, logging out");
        await logoutAndCleanup({
          invalidateOnServer: false,
          triggerMsalLogout: true,
          reason: "Heartbeat: Session not found after retry"
        });
        return;
      }

      if (matchingSession.is_active === false) {
        if (matchingSession.status === "Revoked_by_Admin") {
          window.dispatchEvent(new CustomEvent("votometro:session-revoked"));
          await logoutAndCleanup({
            invalidateOnServer: false,
            triggerMsalLogout: true,
            reason: "Session unauthorized: revoked by administrator"
          });
          return;
        }
        console.warn("[Heartbeat] Session is inactive, logging out");
        await logoutAndCleanup({
          invalidateOnServer: false,
          triggerMsalLogout: true,
          reason: "Heartbeat: Session marked as inactive"
        });
        return;
      }

      if (matchingSession.is_blocked === true) {
        console.warn("[Heartbeat] Session is blocked, logging out");
        await logoutAndCleanup({
          invalidateOnServer: false,
          triggerMsalLogout: true,
          reason: "Heartbeat: Session blocked"
        });
        return;
      }

      // Success! Reset failure counter using ref
      if (heartbeatFailureCountRef.current > 0) {
        heartbeatFailureCountRef.current = 0;
      }

    } catch (unexpectedError) {
      // Catch-all for any unexpected errors
      console.error("[Heartbeat] Unexpected error", unexpectedError);

      heartbeatFailureCountRef.current += 1;
      const newCount = heartbeatFailureCountRef.current;

      if (newCount >= MAX_HEARTBEAT_FAILURES) {
        console.error("[Heartbeat] Max failures reached after unexpected error, logging out");
        await logoutAndCleanup({
          invalidateOnServer: false,
          triggerMsalLogout: true,
          reason: "Heartbeat: Unexpected errors after multiple attempts"
        });
      }
    }
  }, [
    acquireApiToken,
    logoutAndCleanup,
  ]);

  const startHeartbeat = useCallback((userIdOverride?: string) => {
    clearHeartbeat();

    // Use userIdOverride if provided, otherwise fall back to userIdRef
    const effectiveUserId = userIdOverride ?? userIdRef.current;

    if (!sessionTokenRef.current || !deviceIdRef.current || !effectiveUserId) {
      return;
    }

    // Update the ref with the effective userId for subsequent heartbeat checks
    userIdRef.current = effectiveUserId;

    // Run heartbeat check immediately to detect invalidated sessions right away
    // This is critical for single-session enforcement: when a user logs in on another
    // device/browser, the old session is invalidated and should be detected immediately
    // which is the problem reported by the client
    void runHeartbeatCheck();

    heartbeatRef.current = setInterval(() => {
      void runHeartbeatCheck();
    }, HEARTBEAT_INTERVAL_MS);
  }, [clearHeartbeat, runHeartbeatCheck]);

  const validateSessionOnLogin = useCallback(
    async ({ sessionToken: incomingSessionToken, deviceId: incomingDeviceId, userId }: ValidateSessionPayload) => {
      setSessionIdentifiers(incomingSessionToken, incomingDeviceId);
      if (userId) {
        setExplicitUserId(userId);
      }

      localStorage.setItem(STORAGE_KEYS.sessionToken, incomingSessionToken);
      localStorage.setItem(STORAGE_KEYS.deviceId, incomingDeviceId);

      // Pass userId directly to refreshSessionState to avoid race condition
      await refreshSessionState(incomingSessionToken, userId ?? undefined);

      // Start heartbeat after refreshSessionState completes
      // Pass userId directly to avoid race condition with state update
      startHeartbeat(userId ?? undefined);
    },
    [refreshSessionState, setSessionIdentifiers, startHeartbeat]
  );

  useEffect(() => {
    const storedSessionToken = localStorage.getItem(STORAGE_KEYS.sessionToken);
    const storedDeviceId = localStorage.getItem(STORAGE_KEYS.deviceId);

    if (storedSessionToken || storedDeviceId) {
      setSessionIdentifiers(storedSessionToken, storedDeviceId);
    }

    setIsInitialized(true);

    return () => {
      clearHeartbeat();
    };
  }, [clearHeartbeat, setSessionIdentifiers]);

  useEffect(() => {
    if (!isInitialized) {
      return;
    }

    if (!sessionTokenRef.current || !deviceIdRef.current) {
      setIsLoading(false);
      return;
    }

    if (!resolvedUserId) {
      return;
    }

    // Don't trigger refreshSessionState if already refreshing
    if (isRefreshingRef.current) {
      return;
    }

    void refreshSessionState(sessionTokenRef.current);
    startHeartbeat();
  }, [isInitialized, refreshSessionState, resolvedUserId, startHeartbeat]);

  // ---------------------------------------------------------------------------
  // POST-REDIRECT BOOTSTRAP
  // ---------------------------------------------------------------------------
  // Caso de uso: el user vuelve de Entra ID tras `loginRedirect()`. `main.tsx`
  // ya procesó el hash con `handleRedirectPromise()`, MSAL marca al user como
  // autenticado (`activeAccount != null`) PERO el componente `<Login />` ya
  // fue desmontado por AppRouter (al pasar `isAuthenticated` a true). El
  // handshake con el backend (`POST /api/session` + `setUser`) jamás corre y
  // el AppRouter queda atorado en el bloque `user === null` → spinner infinito.
  //
  // Solución: detectar la condición aquí, fuera del árbol de rutas, y
  // disparar el handshake una sola vez. El `postRedirectBootstrapRef` evita
  // bucles si la llamada falla y el efecto vuelve a evaluarse.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isInitialized) return;
    if (postRedirectBootstrapRef.current) return;
    if (sessionTokenRef.current) return; // ya hay sesión persistida
    if (user !== null) return;            // ya hay user hidratado

    const account = instance.getActiveAccount();
    if (!account) return;                 // MSAL aún no listo

    postRedirectBootstrapRef.current = true;

    (async () => {
      try {
        setIsLoading(true);
        const account2 = instance.getActiveAccount();
        if (!account2) {
          postRedirectBootstrapRef.current = false;
          return;
        }

        // Token MSAL silencioso (sin popup — el redirect ya autenticó).
        const tokenResp = await instance.acquireTokenSilent({
          account: account2,
          scopes: protectedResources.api.scopes,
        });
        const accessToken = tokenResp.accessToken;
        const newDeviceId = getDeviceId();

        const data = await validateSession(accessToken, {
          access_token: accessToken,
          device_id: newDeviceId,
        });

        const oidClaim = account2.idTokenClaims?.oid as string | undefined;
        const userId = oidClaim ?? account2.localAccountId ?? null;

        await validateSessionOnLogin({
          sessionToken: data.session_token,
          deviceId: newDeviceId,
          userId,
        });
      } catch (err) {
        console.error("[SessionContext] post-redirect bootstrap failed", err);
        // Reset del sentinel para permitir reintento manual (recarga).
        postRedirectBootstrapRef.current = false;
        setIsLoading(false);
      }
    })();
  }, [isInitialized, user, instance, validateSessionOnLogin]);

  const contextValue = useMemo<SessionContextValue>(
    () => ({
      user,
      products,
      sessionToken,
      deviceId,
      isLoading,
      refreshSessionState,
      validateSessionOnLogin,
      logoutAndCleanup,
    }),
    [deviceId, isLoading, logoutAndCleanup, products, refreshSessionState, sessionToken, user, validateSessionOnLogin]
  );

  return <SessionContext.Provider value={contextValue}>{children}</SessionContext.Provider>;
};

export const useSession = () => {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error("useSession must be used within a SessionProvider");
  }

  return context;
};
