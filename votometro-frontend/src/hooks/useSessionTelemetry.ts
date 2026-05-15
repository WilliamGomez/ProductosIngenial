import { useCallback, useEffect, useRef } from "react";
import axios from "axios";
import { useLocation } from "react-router-dom";

import { isDevBypassActive } from "../devAuth/devBypass";
import { useAccessToken } from "./useAccessToken";
import { useIdleTimer } from "./useIdleTimer";
import { useSession } from "../context/SessionContext";
import { sendSessionHeartbeat, type ISessionHeartbeatPage } from "../services/api";

const HEARTBEAT_INTERVAL_MS = 120_000;
const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;

const clearBrowserSessionState = () => {
  localStorage.clear();
  sessionStorage.clear();
  document.cookie.split(";").forEach((cookie) => {
    const name = cookie.split("=")[0]?.trim();
    if (!name) return;
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });
};

const notifySessionRevoked = () => {
  window.dispatchEvent(new CustomEvent("votometro:session-revoked"));
};

export const useSessionTelemetry = () => {
  const location = useLocation();
  const { getToken } = useAccessToken();
  const { sessionToken, user, logoutAndCleanup } = useSession();

  const activeRouteRef = useRef(location.pathname);
  const activeStartedAtRef = useRef<number | null>(
    document.visibilityState === "visible" ? Date.now() : null
  );
  const pendingSecondsByRouteRef = useRef<Record<string, number>>({});
  const flushingRef = useRef(false);

  const enabled = Boolean(sessionToken && user && !isDevBypassActive());

  const addElapsedForActiveRoute = useCallback(() => {
    const startedAt = activeStartedAtRef.current;
    if (startedAt == null) return;

    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    activeStartedAtRef.current = Date.now();

    if (elapsedSeconds <= 0) return;

    const route = activeRouteRef.current;
    pendingSecondsByRouteRef.current[route] =
      (pendingSecondsByRouteRef.current[route] ?? 0) + elapsedSeconds;
  }, []);

  const readAndClearPendingPages = useCallback((): ISessionHeartbeatPage[] => {
    const pending = pendingSecondsByRouteRef.current;
    pendingSecondsByRouteRef.current = {};

    return Object.entries(pending)
      .filter(([, seconds]) => seconds > 0)
      .map(([route, seconds]) => ({ route, seconds }));
  }, []);

  const restorePendingPages = useCallback((pages: ISessionHeartbeatPage[]) => {
    pages.forEach((page) => {
      pendingSecondsByRouteRef.current[page.route] =
        (pendingSecondsByRouteRef.current[page.route] ?? 0) + page.seconds;
    });
  }, []);

  const flushTelemetry = useCallback(async () => {
    if (!enabled || !sessionToken || flushingRef.current) return;

    addElapsedForActiveRoute();
    const pages = readAndClearPendingPages();
    if (pages.length === 0) return;

    flushingRef.current = true;
    try {
      const token = await getToken();
      await sendSessionHeartbeat(token, sessionToken, pages);
    } catch (error) {
      restorePendingPages(pages);

      if (axios.isAxiosError(error) && error.response?.status === 401) {
        const code = (error.response.data as { code?: string } | undefined)?.code;
        if (code === "SESSION_REVOKED") {
          notifySessionRevoked();
        }
        clearBrowserSessionState();
        await logoutAndCleanup({
          invalidateOnServer: false,
          triggerMsalLogout: true,
          reason: code === "SESSION_REVOKED"
            ? "Session unauthorized: revoked by administrator"
            : "Session unauthorized: idle timeout",
        });
      }
    } finally {
      flushingRef.current = false;
    }
  }, [
    addElapsedForActiveRoute,
    enabled,
    getToken,
    logoutAndCleanup,
    readAndClearPendingPages,
    restorePendingPages,
    sessionToken,
  ]);

  useIdleTimer({
    enabled,
    timeoutMs: IDLE_TIMEOUT_MS,
    onIdle: async () => {
      clearBrowserSessionState();
      await logoutAndCleanup({
        invalidateOnServer: true,
        triggerMsalLogout: true,
        reason: "Session unauthorized: local idle timeout",
      });
    },
  });

  useEffect(() => {
    if (!enabled) return;

    addElapsedForActiveRoute();
    activeRouteRef.current = location.pathname;
    activeStartedAtRef.current = document.visibilityState === "visible" ? Date.now() : null;
  }, [addElapsedForActiveRoute, enabled, location.pathname]);

  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        addElapsedForActiveRoute();
        activeStartedAtRef.current = null;
        void flushTelemetry();
        return;
      }

      activeStartedAtRef.current = Date.now();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [addElapsedForActiveRoute, enabled, flushTelemetry]);

  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      void flushTelemetry();
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      void flushTelemetry();
    };
  }, [enabled, flushTelemetry]);
};
