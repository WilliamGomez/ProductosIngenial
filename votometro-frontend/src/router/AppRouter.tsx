import { type RouteObject, RouterProvider, createBrowserRouter, Navigate } from "react-router-dom";
import { Suspense, lazy, useMemo } from "react";
import { useAuth } from "../hooks/useAuth";
import { useSession } from "../context/SessionContext";
import { Spinner } from "../components/ui/Spinner";
import MainLayout from "../layouts/MainLayout";
import { isProductActive } from "../utils/productStatus";

// Lazy-loaded pages
const Login = lazy(() => import("../pages/Login"));
const MfaGate = lazy(() => import("../pages/MfaGate"));
const Votometro = lazy(() => import("../pages/Votometro"));
const AudiVoto = lazy(() => import("../pages/Audivoto"));
const UserAdmin = lazy(() => import("../pages/UsersAdmin"));
const UserDetail = lazy(() => import("../pages/UserDetail"));
const UserEdit = lazy(() => import("../pages/UserEdit"));
const SessionsAdmin = lazy(() => import("../pages/SessionsAdmin"));
const SessionAnalyticsDashboard = lazy(() => import("../pages/SessionAnalyticsDashboard"));
const RolesMatrix = lazy(() => import("../pages/RolesMatrix"));
const ResetPasswordAdmin = lazy(() => import("../pages/ResetPasswordAdmin"));
const DivipolaUpload = lazy(() => import("../pages/DivipolaUpload"));

export const AppRouter = () => {
  const { isAuthenticated, userRole, userProducts, isLoadingProducts, isMsalLoading } = useAuth();
  const { user, mfaVerified, sessionToken, logoutAndCleanup } = useSession();
  const hasProduct = (name: string) => userProducts?.some((p) => p.name.toLowerCase() === name.toLowerCase() && isProductActive(p));

  const routes: RouteObject[] = useMemo(() => {
    // Wait for MSAL to finish initializing before deciding routes
    // This prevents the flash redirect to /login on page refresh
    if (isMsalLoading) {
      return [
        {
          path: "*",
          element: <Spinner />,
        },
      ];
    }

    if (!isAuthenticated) {
      return [
        { path: "/login", element: <Login /> },
        { path: "*", element: <Navigate to='/login' replace /> },
      ];
    }

    if (sessionToken && !mfaVerified) {
      return [
        {
          path: "*",
          element: <MfaGate />,
        },
      ];
    }

    // Doble validación para evitar race conditions:
    // 1. isLoadingProducts === true → estado controlado por SessionContext
    // 2. user === null → defensa adicional contra estados transitorios donde isLoading es false pero datos aún no disponibles
    if (!sessionToken && !isLoadingProducts && user === null) {
      return [
        {
          path: "*",
          element: (
            <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#dbeafe_0,#f8fafc_42%,#ecfeff_100%)] flex items-center justify-center px-4 py-8">
              <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white/95 p-6 shadow-2xl shadow-slate-200/70 backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">
                  Sesion interna no disponible
                </p>
                <h1 className="mt-2 text-xl font-bold text-slate-900">
                  No se pudo cargar la informacion de la plataforma
                </h1>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Microsoft autentico la cuenta, pero la sesion interna del aplicativo no quedo activa.
                  Cierra la sesion y vuelve a ingresar para recrearla.
                </p>
                <button
                  type="button"
                  className="mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
                  onClick={() => void logoutAndCleanup({ invalidateOnServer: false, triggerMsalLogout: true })}
                >
                  Cerrar sesion y reintentar
                </button>
              </div>
            </div>
          ),
        },
      ];
    }

    if (isLoadingProducts || user === null) {
      return [
        {
          path: "*",
          element: (
            <MainLayout>
              <Spinner />
            </MainLayout>
          ),
        },
      ];
    }

    const protectedRoutes: RouteObject[] = [];

    // Admin users get access to ALL product routes regardless of assignment
    // Non-admin users only get routes for assigned products
    if (userRole === "Admin" || hasProduct("Votometro")) {
      protectedRoutes.push({
        path: "/votometro",
        element: (
          <MainLayout>
            <Votometro />
          </MainLayout>
        ),
      });
    }

    if (userRole === "Admin" || hasProduct("Audivoto")) {
      protectedRoutes.push({
        path: "/audivoto",
        element: (
          <MainLayout>
            <AudiVoto />
          </MainLayout>
        ),
      });
    }

    // Admin-only routes (user management and session monitoring)
    if (userRole === "Admin") {
      protectedRoutes.push(
        {
          path: "/users",
          element: (
            <MainLayout>
              <UserAdmin />
            </MainLayout>
          ),
        },
        // Creación de usuario — misma página que edición (modo dinámico
        // según `useParams().id`). Debe declararse ANTES de `/users/:id`
        // para que react-router no haga match de "new" como un id.
        {
          path: "/users/new",
          element: (
            <MainLayout>
              <UserEdit />
            </MainLayout>
          ),
        },
        // Edición de usuario — página dedicada (reemplaza al modal legacy).
        // Carga el usuario via getUser(token, id) y delega a updateUserInfo
        // / updateUserproducts en submit. Cancel / post-success → /users/:id.
        {
          path: "/users/edit/:id",
          element: (
            <MainLayout>
              <UserEdit />
            </MainLayout>
          ),
        },
        // Reset de contraseña — DEBE declararse antes de `/users/:id` para
        // que el sub-segmento `reset-password` no sea match parcial del :id.
        {
          path: "/users/:id/reset-password",
          element: (
            <MainLayout>
              <ResetPasswordAdmin />
            </MainLayout>
          ),
        },
        // Detalle de usuario individual — sólo Admin. La página resuelve el
        // :id desde useParams y llama getUser(token, id). Si el id no existe
        // o el backend devuelve 401/403, UserDetail muestra un EmptyState.
        {
          path: "/users/:id",
          element: (
            <MainLayout>
              <UserDetail />
            </MainLayout>
          ),
        },
        // RBAC dinámico — gestión de roles y permisos granulares.
        {
          path: "/admin/roles",
          element: (
            <MainLayout>
              <RolesMatrix />
            </MainLayout>
          ),
        },
        // Carga del catálogo DIVIPOLA (csv del DANE).
        {
          path: "/admin/divipola",
          element: (
            <MainLayout>
              <DivipolaUpload />
            </MainLayout>
          ),
        },
        {
          path: "/sessions-report",
          element: (
            <MainLayout>
              <SessionsAdmin />
            </MainLayout>
          ),
        },
        {
          path: "/sessions-analytics",
          element: (
            <MainLayout>
              <SessionAnalyticsDashboard />
            </MainLayout>
          ),
        }
      );
    }

    // Default redirect: first available route (product routes come first for better UX)
    const defaultPath: string = protectedRoutes.length > 0 && protectedRoutes[0].path ? protectedRoutes[0].path : "/login";

    protectedRoutes.push({
      path: "*",
      element: <Navigate to={defaultPath} replace />,
    });

    return protectedRoutes;
  }, [isAuthenticated, isLoadingProducts, userProducts, userRole, user, mfaVerified, sessionToken, isMsalLoading, logoutAndCleanup]);

  const router = useMemo(() => createBrowserRouter(routes), [routes]);

  return (
    <Suspense fallback={<Spinner />}>
      <RouterProvider router={router} />
    </Suspense>
  );
};
