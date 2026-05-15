import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
import { useSession } from "../context/SessionContext";
import { isDevBypassActive, MOCK_USER, getMockProducts } from "../devAuth/devBypass";

export type AppRole = "User" | "Admin" | undefined;

export const useAuth = () => {
  // ---------------------------------------------------------------------------
  // DEV BYPASS — devuelve un perfil Admin autenticado sin tocar MSAL.
  // Eliminado del bundle prod por tree-shake (ver devBypass.ts).
  // ---------------------------------------------------------------------------
  if (isDevBypassActive()) {
    return {
      isAuthenticated: true,
      userRole: MOCK_USER.role as AppRole,
      userId: MOCK_USER.id,
      userProducts: getMockProducts(),
      isLoadingProducts: false,
      isMsalLoading: false,
    };
  }

  const { instance, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const { products: userProducts, isLoading: isLoadingProducts, user } = useSession();

  const activeAccount = instance.getActiveAccount();

  // MSAL is still initializing or processing authentication
  const isMsalLoading = inProgress !== InteractionStatus.None;

  // CRITICAL FIX: Read role from backend user data (user.role) instead of MSAL token claims
  // The backend is the source of truth for user roles, not Azure AD token claims
  const userRole: AppRole = user?.role as AppRole;

  const userId: string | undefined = activeAccount?.idTokenClaims?.oid ? activeAccount.idTokenClaims.oid : undefined;

  const resolvedUserId: string | undefined = user?.id ?? userId;

  return { isAuthenticated, userRole, userId: resolvedUserId, userProducts, isLoadingProducts, isMsalLoading };
};
