import { useCallback, useEffect, useRef, useState } from "react";
import type { IEmbedConfig } from "../interfaces/IEmbedConfig";
import { getPowerBiReport } from "../services/api";
import { useAccessToken } from "../hooks/useAccessToken";
import { PowerBIEmbed } from "powerbi-client-react";
import { Embed, models, /*Page,*/ Report, service } from "powerbi-client";
import { Spinner } from "../components/ui/Spinner";
import "powerbi-report-authoring";
import "../styles/votometro.css";
// TODO: Re-enable filters after temporary period
// import { getFilters } from "../utils/GetFilters";
// import { useAuth } from "../hooks/useAuth";
import { useSession } from "../context/SessionContext";

const Audivoto = () => {
  const REPORT_ID = "f88c2708-aa49-449a-974a-8e7f7ee972fb";
  // const PRODUCT_NAME = "Audivoto";
  const DEFAULT_REFRESH_MS = 55 * 60_000;
  const REFRESH_SAFETY_WINDOW_MS = 5 * 60_000;

  // const { userRole } = useAuth();
  const { user, sessionToken } = useSession();
  const { getToken } = useAccessToken();
  const [embbedConfig, setEmbbedConfig] = useState<IEmbedConfig | null>(null);
  const [embedKey, setEmbedKey] = useState(0);
  const reportRef = useRef<Report | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRefreshTimeout = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
  }, []);

  const getRefreshDelay = useCallback(
    (expiresOn?: string) => {
      if (!expiresOn) {
        return DEFAULT_REFRESH_MS;
      }

      const expiresAt = new Date(expiresOn).getTime();
      if (Number.isNaN(expiresAt)) {
        return DEFAULT_REFRESH_MS;
      }

      const delay = expiresAt - Date.now() - REFRESH_SAFETY_WINDOW_MS;
      if (delay <= 0) {
        return 0;
      }

      return Math.max(60_000, delay);
    },
    [DEFAULT_REFRESH_MS, REFRESH_SAFETY_WINDOW_MS]
  );

  const refreshEmbedConfig = useCallback(
    async (reason: string) => {
      try {
        const token = await getToken();
        const data = await getPowerBiReport(token, REPORT_ID, sessionToken);
        setEmbbedConfig(data);

        if (reportRef.current) {
          try {
            await reportRef.current.setAccessToken(data.accessToken);
          } catch (error) {
            console.error("[Audivoto] Failed to update access token, re-embedding", error);
            reportRef.current = null;
            setEmbedKey((prev) => prev + 1);
          }
        }

        console.info(`[Audivoto] Embed config refreshed (${reason})`);
      } catch (error) {
        console.error("[Audivoto] Failed to refresh embed config", error);
      }
    },
    [REPORT_ID, getToken, sessionToken]
  );

  const resetPowerBiReport = useCallback(() => {
    try {
      const report = reportRef.current as any;
      const element = report?.element;
      const pbiService = report?.service;
      if (pbiService && element) {
        pbiService.reset(element);
      }
    } catch (error) {
      console.warn("[Audivoto] Failed to reset Power BI report", error);
    } finally {
      reportRef.current = null;
      setEmbbedConfig(null);
      setEmbedKey((prev) => prev + 1);
    }
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [eventHandlersMap] = useState<Map<string, (event?: service.ICustomEvent<any>, embeddedEntity?: Embed) => void | null>>(
    () =>
      new Map([
        [
          "loaded",
          () => {
            console.log("Report has loaded");
          },
        ],
        [
          "rendered",
          () => {
            console.log("Report has rendered");
          },
        ],
        [
          "error",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (event?: service.ICustomEvent<any>) => {
            if (event) {
              console.error(event.detail);
              const message = String((event.detail as { message?: string })?.message ?? "").toLowerCase();
              if (message.includes("token") && message.includes("expired")) {
                void refreshEmbedConfig("token-expired");
              }
            }
          },
        ],
        ["visualClicked", () => console.log("visual clicked")],
        ["pageChanged", () => { }],
      ])
  );

  useEffect(() => {
    void refreshEmbedConfig("initial");
    return () => {
      clearRefreshTimeout();
    };
  }, [clearRefreshTimeout, refreshEmbedConfig]);

  useEffect(() => {
    window.addEventListener("votometro:session-revoked", resetPowerBiReport);
    return () => {
      window.removeEventListener("votometro:session-revoked", resetPowerBiReport);
    };
  }, [resetPowerBiReport]);

  useEffect(() => {
    if (!embbedConfig) {
      return;
    }

    clearRefreshTimeout();
    const delay = getRefreshDelay(embbedConfig.expiresOn);
    refreshTimeoutRef.current = setTimeout(() => {
      void refreshEmbedConfig("scheduled");
    }, delay);

    return () => {
      clearRefreshTimeout();
    };
  }, [clearRefreshTimeout, embbedConfig, getRefreshDelay, refreshEmbedConfig]);

  return (
    <>
      {embbedConfig && user ? (
        <PowerBIEmbed
          key={embedKey}
          embedConfig={{
            type: "report",
            id: embbedConfig.reportId,
            embedUrl: embbedConfig.embedUrl,
            accessToken: embbedConfig.accessToken,
            tokenType: models.TokenType.Embed,
            settings: {
              panes: {
                pageNavigation: {
                  visible: false,
                },
                filters: {
                  expanded: false,
                  visible: false,
                },
              },
              layoutType: models.LayoutType.Custom,
              customLayout: {
                displayOption: models.DisplayOption.FitToPage,
              },
            },
            // TODO: Re-enable filters
            // filters: getFilters(user, PRODUCT_NAME, userRole),
            filters: [],
          }}
          eventHandlers={eventHandlersMap}
          cssClassName={"reportClass"}
          getEmbeddedComponent={(embedObject: Embed) => {
            if (!reportRef.current) {
              reportRef.current = embedObject as Report;
            }
          }}
        />
      ) : (
        <Spinner />
      )}
    </>
  );
};

export default Audivoto;
