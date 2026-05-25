import { useCallback } from "react";
import { useMsal } from "@azure/msal-react";
import { protectedResources } from "../authConfig";
import { isDevBypassActive, MOCK_ACCESS_TOKEN } from "../devAuth/devBypass";

export const useAccessToken = () => {
  const { instance } = useMsal();

  const getToken = useCallback(async (): Promise<string> => {
    // -------------------------------------------------------------------------
    // DEV BYPASS — devuelve token dummy. Si una llamada axios accidental
    // pega al backend con este token, el backend devolverá 401 (esperado).
    // Eliminado del bundle prod por tree-shake.
    // -------------------------------------------------------------------------
    if (isDevBypassActive()) return MOCK_ACCESS_TOKEN;

    const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];

    if (!account) {
      throw new Error("No active account available to acquire token");
    }

    const request = {
      account,
      scopes: protectedResources.api.scopes,
    };

    try {
      const response = await instance.acquireTokenSilent(request);
      return response.accessToken;
    } catch {
      const response = await instance.acquireTokenPopup(request);
      return response.accessToken;
    }
  }, [instance]);

  return { getToken };
};
