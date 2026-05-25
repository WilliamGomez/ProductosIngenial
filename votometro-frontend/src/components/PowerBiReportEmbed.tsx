import { useCallback, useEffect, useRef, useState } from "react";
import { PowerBIEmbed } from "powerbi-client-react";
import { Embed, models, Report, service } from "powerbi-client";
import "powerbi-report-authoring";
import type { IEmbedConfig } from "../interfaces/IEmbedConfig";
import { Spinner } from "./ui/Spinner";
import { getPowerBiReport } from "../services/api";
import { useAccessToken } from "../hooks/useAccessToken";
import { useSession } from "../context/SessionContext";
import "../styles/votometro.css";

interface PowerBiReportEmbedProps {
  reportId: string;
  productName: string;
}

type PowerBiEventHandler = (event?: service.ICustomEvent<unknown>, embeddedEntity?: Embed) => void | null;

const DEFAULT_REFRESH_MS = 50 * 60_000;
const REFRESH_SAFETY_WINDOW_MS = 10 * 60_000;
const MIN_MANUAL_REFRESH_INTERVAL_MS = 30_000;
const INITIAL_CACHE_MIN_TTL_MS = 2 * 60_000;

interface EmbedConfigCacheEntry {
  data?: IEmbedConfig;
  expiresAt: number;
  inFlight?: Promise<IEmbedConfig>;
}

const embedConfigCache = new Map<string, EmbedConfigCacheEntry>();

const getEmbedCacheKey = (reportId: string, sessionToken?: string | null) =>
  `${reportId}:${sessionToken || "anonymous"}`;

const getEmbedExpiresAt = (config?: IEmbedConfig) => {
  const expiresAt = config?.expiresOn ? new Date(config.expiresOn).getTime() : Number.NaN;
  return Number.isNaN(expiresAt) ? Date.now() + DEFAULT_REFRESH_MS : expiresAt;
};

const isFreshInitialCache = (entry?: EmbedConfigCacheEntry) =>
  Boolean(entry?.data && entry.expiresAt - Date.now() > INITIAL_CACHE_MIN_TTL_MS);

export const PowerBiReportEmbed = ({ reportId, productName }: PowerBiReportEmbedProps) => {
  const { user, sessionToken } = useSession();
  const { getToken } = useAccessToken();
  const [embedConfig, setEmbedConfig] = useState<IEmbedConfig | null>(null);
  const [embedKey, setEmbedKey] = useState(0);
  const reportRef = useRef<Report | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenAtRef = useRef<number | null>(null);
  const refreshInFlightRef = useRef(false);
  const lastRefreshAttemptAtRef = useRef(0);
  const activePageNameRef = useRef<string | null>(null);
  const pendingPageRestoreRef = useRef<string | null>(null);

  const clearRefreshTimeout = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
  }, []);

  const reembedReport = useCallback(() => {
    reportRef.current = null;
    setEmbedKey((prev) => prev + 1);
  }, []);

  const restorePendingPage = useCallback(async (report?: Report | null) => {
    const pageName = pendingPageRestoreRef.current;
    if (!report || !pageName) return;

    try {
      const pages = await report.getPages();
      const targetPage = pages.find((page) => page.name === pageName);
      if (targetPage) {
        await targetPage.setActive();
      }
    } catch (error) {
      console.warn(`[${productName}] Failed to restore report page after re-embed`, error);
    } finally {
      pendingPageRestoreRef.current = null;
    }
  }, [productName]);

  const getRefreshDelay = useCallback((expiresOn?: string) => {
    if (!expiresOn) return DEFAULT_REFRESH_MS;

    const expiresAt = new Date(expiresOn).getTime();
    if (Number.isNaN(expiresAt)) return DEFAULT_REFRESH_MS;

    const delay = expiresAt - Date.now() - REFRESH_SAFETY_WINDOW_MS;
    return delay <= 0 ? 0 : Math.max(60_000, delay);
  }, []);

  const refreshEmbedConfig = useCallback(
    async (reason: string, forceReembed = false) => {
      if (!sessionToken) {
        return;
      }

      const cacheKey = getEmbedCacheKey(reportId, sessionToken);
      const cachedEntry = embedConfigCache.get(cacheKey);

      if (reason === "initial" && isFreshInitialCache(cachedEntry) && cachedEntry?.data) {
        setEmbedConfig(cachedEntry.data);
        if (forceReembed) {
          reembedReport();
        }
        console.info(`[${productName}] Embed config restored from cache (${reason})`);
        return;
      }

      if (cachedEntry?.inFlight) {
        try {
          const data = await cachedEntry.inFlight;
          if (reportRef.current) {
            await reportRef.current.setAccessToken(data.accessToken);
          } else {
            setEmbedConfig(data);
            if (forceReembed) {
              reembedReport();
            }
          }
          console.info(`[${productName}] Embed refresh joined in-flight request (${reason})`);
        } catch (error) {
          console.error(`[${productName}] In-flight embed refresh failed`, error);
        }
        return;
      }

      if (refreshInFlightRef.current) {
        console.info(`[${productName}] Embed refresh skipped (${reason}): already in progress`);
        return;
      }

      const isUserDrivenRefresh = reason !== "initial" && reason !== "scheduled";
      if (isUserDrivenRefresh) {
        const elapsed = Date.now() - lastRefreshAttemptAtRef.current;
        if (elapsed < MIN_MANUAL_REFRESH_INTERVAL_MS) {
          console.info(`[${productName}] Embed refresh skipped (${reason}): throttled`);
          return;
        }
      }

      refreshInFlightRef.current = true;
      lastRefreshAttemptAtRef.current = Date.now();
      const request = (async () => {
        const token = await getToken();
        return getPowerBiReport(token, reportId, sessionToken);
      })();
      embedConfigCache.set(cacheKey, {
        data: cachedEntry?.data,
        expiresAt: cachedEntry?.expiresAt ?? 0,
        inFlight: request,
      });

      try {
        const data = await request;
        embedConfigCache.set(cacheKey, {
          data,
          expiresAt: getEmbedExpiresAt(data),
        });
        if (reportRef.current) {
          try {
            await reportRef.current.setAccessToken(data.accessToken);
            clearRefreshTimeout();
            const delay = getRefreshDelay(data.expiresOn);
            refreshTimeoutRef.current = setTimeout(() => {
              void refreshEmbedConfig("scheduled");
            }, delay);
            console.info(`[${productName}] Embed token updated without re-embedding (${reason})`);
            return;
          } catch (error) {
            console.error(`[${productName}] Failed to update access token, re-embedding`, error);
            pendingPageRestoreRef.current = activePageNameRef.current;
            setEmbedConfig(data);
            reembedReport();
            return;
          }
        }

        setEmbedConfig(data);

        if (forceReembed && !reportRef.current) {
          pendingPageRestoreRef.current = activePageNameRef.current;
          reembedReport();
          return;
        }

        console.info(`[${productName}] Embed config refreshed (${reason})`);
      } catch (error) {
        if (embedConfigCache.get(cacheKey)?.inFlight === request) {
          if (cachedEntry?.data) {
            embedConfigCache.set(cacheKey, cachedEntry);
          } else {
            embedConfigCache.delete(cacheKey);
          }
        }
        console.error(`[${productName}] Failed to refresh embed config`, error);
      } finally {
        refreshInFlightRef.current = false;
      }
    },
    [clearRefreshTimeout, getRefreshDelay, getToken, productName, reembedReport, reportId, sessionToken]
  );

  const resetPowerBiReport = useCallback(() => {
    try {
      const report = reportRef.current as unknown as { element?: HTMLElement; service?: service.Service };
      if (report?.service && report?.element) {
        report.service.reset(report.element);
      }
    } catch (error) {
      console.warn(`[${productName}] Failed to reset Power BI report`, error);
    } finally {
      reportRef.current = null;
      setEmbedConfig(null);
      setEmbedKey((prev) => prev + 1);
    }
  }, [productName]);

  const publishReportTelemetry = useCallback(
    (reportPage?: string) => {
      window.dispatchEvent(
        new CustomEvent("votometro:telemetry-context", {
          detail: {
            product: productName,
            reportPage,
          },
        })
      );
    },
    [productName]
  );

  const [eventHandlersMap] = useState<Map<string, PowerBiEventHandler>>(
    () =>
      new Map<string, PowerBiEventHandler>([
        [
          "loaded",
          (_event?: service.ICustomEvent<unknown>, embeddedEntity?: Embed) => {
            void (async () => {
              try {
                const report = embeddedEntity as Report | undefined;
                const activePage = await report?.getActivePage();
                activePageNameRef.current = activePage?.name ?? activePageNameRef.current;
                await restorePendingPage(report);
                publishReportTelemetry(activePage?.displayName || activePage?.name);
              } catch (error) {
                console.warn(`[${productName}] Failed to read active report page`, error);
                publishReportTelemetry();
              }
            })();
          },
        ],
        [
          "error",
          (event?: service.ICustomEvent<unknown>) => {
            const detail = event?.detail as { message?: string } | undefined;
            console.error(`[${productName}] Power BI embed error`, detail);
            const message = String(detail?.message ?? "").toLowerCase();
            if (message.includes("token") || message.includes("expired") || message.includes("unauthorized")) {
              void refreshEmbedConfig("embed-error", true);
            }
          },
        ],
        [
          "pageChanged",
          (event?: service.ICustomEvent<unknown>) => {
            const page = (event?.detail as { newPage?: { displayName?: string; name?: string } } | undefined)?.newPage;
            activePageNameRef.current = page?.name ?? activePageNameRef.current;
            publishReportTelemetry(page?.displayName || page?.name);
          },
        ],
      ])
  );

  useEffect(() => {
    if (!sessionToken) return;
    void refreshEmbedConfig("initial", true);
    return clearRefreshTimeout;
  }, [clearRefreshTimeout, refreshEmbedConfig, sessionToken]);

  useEffect(() => {
    window.addEventListener("votometro:session-revoked", resetPowerBiReport);
    return () => window.removeEventListener("votometro:session-revoked", resetPowerBiReport);
  }, [resetPowerBiReport]);

  useEffect(() => {
    const recoverIfNeeded = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }

      hiddenAtRef.current = null;
      void refreshEmbedConfig("visibility-token-refresh");
    };

    const onFocus = () => {
      if (document.visibilityState === "visible") {
        void refreshEmbedConfig("window-focus");
      }
    };

    document.addEventListener("visibilitychange", recoverIfNeeded);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", recoverIfNeeded);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshEmbedConfig]);

  useEffect(() => {
    if (!embedConfig) return;

    clearRefreshTimeout();
    const delay = getRefreshDelay(embedConfig.expiresOn);
    refreshTimeoutRef.current = setTimeout(() => {
      void refreshEmbedConfig("scheduled");
    }, delay);

    return clearRefreshTimeout;
  }, [clearRefreshTimeout, embedConfig, getRefreshDelay, refreshEmbedConfig]);

  if (!embedConfig || !user) {
    return <Spinner />;
  }

  return (
    <PowerBIEmbed
      key={embedKey}
      embedConfig={{
        type: "report",
        id: embedConfig.reportId,
        embedUrl: embedConfig.embedUrl,
        accessToken: embedConfig.accessToken,
        tokenType: models.TokenType.Embed,
        settings: {
          panes: {
            pageNavigation: { visible: false },
            filters: { expanded: false, visible: false },
          },
          layoutType: models.LayoutType.Custom,
          customLayout: {
            displayOption: models.DisplayOption.FitToWidth,
          },
        },
        filters: [],
      }}
      eventHandlers={eventHandlersMap}
      cssClassName="reportClass"
      getEmbeddedComponent={(embedObject: Embed) => {
        reportRef.current = embedObject as Report;
      }}
    />
  );
};

export default PowerBiReportEmbed;
