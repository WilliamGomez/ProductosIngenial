import { useIsAuthenticated } from "@azure/msal-react";
import { Navigate } from "react-router-dom";

import type { ReactNode } from "react";

export const UnauthenticatedRoute = ({ children }: { children: ReactNode }) => {
  const isAuthenticated = useIsAuthenticated();
  return !isAuthenticated ? children : <Navigate to='/' />;
};
