import { useIsAuthenticated } from "@azure/msal-react";
import { Navigate } from "react-router-dom";
import { useMsal } from "@azure/msal-react";
import type { ReactNode } from "react";

interface RequireAuthProps {
  children: ReactNode;
  allowedRoles?: string[];
}

export const RequireAuth = ({ children, allowedRoles }: RequireAuthProps) => {
  const { instance } = useMsal();
  const activeAccount = instance.getActiveAccount();

  const isAuthenticated = useIsAuthenticated();
  const userRoles = activeAccount?.idTokenClaims?.roles || [];

  if (!isAuthenticated) {
    return <Navigate to='/login' />;
  }

  if (!userRoles || userRoles.length === 0) {
    return <Navigate to='/login' />;
  }

  if (allowedRoles && !allowedRoles.some((role) => userRoles.includes(role))) {
    return <Navigate to='/unauthorized' />;
  }

  return children;
};
