import axios from "axios";

/**
 * Interface para un Producto contratado por un Usuario.
 * ACTUALIZADO 2026-05-10: Ahora incluye `zones` array directamente.
 */
export interface IProduct {
  id?: number | null; // null es válido para productos nuevos
  name: string; // "Votometro" | "Audivoto"
  contract_duration: number;
  duration_unit: string; // "years" | "months" | "days" | "hours"
  enable: boolean;
  amount_cop?: number;
  zones: IUserZone[]; // NUEVO: Zonas anidadas, NO CSV strings
  expiration?: string;
  created_at?: string;
  display_name?: string | null;
  route_path?: string | null;
  powerbi_report_id?: string | null;
  powerbi_workspace_id?: string | null;
  powerbi_tenant_id?: string | null;
  icon?: string | null;
  display_order?: number;
  is_report_enabled?: boolean;
  description?: string | null;
}

export interface IProductReportCatalogItem {
  id?: number | null;
  name: string;
  display_name: string;
  route_path: string;
  powerbi_report_id: string;
  powerbi_workspace_id?: string | null;
  powerbi_tenant_id?: string | null;
  icon?: string | null;
  display_order: number;
  is_report_enabled: boolean;
  description?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/**
 * Interfaz mejorada para updateUserproducts.
 * Ahora espera productos CON sus zonas anidadas.
 */
import type { ISessionResponse } from "../interfaces/ISessionResponse";
import type { IEmbedConfig } from "../interfaces/IEmbedConfig";
import type { IUser } from "../interfaces/IUser";
import type { IDepartment } from "../interfaces/IDepartments";
import type { IMunicipio } from "../interfaces/IMunicipio";
import type { ICountry } from "../interfaces/ICountry";
import type { ISessionInfo } from "../interfaces/ISessionInfo";
import type { ISessionActivityDetail } from "../interfaces/ISessionInfo";
import type { ISessionAnalytics } from "../interfaces/ISessionInfo";

// =============================================================================
// FIX HTTP 405 (Causa Raíz idéntica a la #1 de authConfig.ts):
//   Antes: `baseURL: import.meta.env.VITE_BASE_ENDPOINT`.
//   Esa env var NO existe ni en `.env.example` ni en los `args` del
//   docker-compose. Resultado: `baseURL = undefined` → axios construye
//   las URLs como rutas relativas → `POST /session` se enviaba a
//   `http://localhost:8080/session` (el nginx que sirve el SPA), no al
//   backend en `http://localhost:7071/api/session`. nginx no acepta POST
//   sobre rutas estáticas y respondía 405 (Method Not Allowed).
//
//   Ahora se consume el nombre real (`VITE_BACKEND_URL`), alineado con
//   `.env.example`, `Dockerfile` (ARG/ENV) y `authConfig.ts`.
//
// Validación rápida en consola del browser tras rebuild:
//   > console.log(import.meta.env.VITE_BACKEND_URL)
//   "http://localhost:7071/api"
// =============================================================================
const apiBaseURL = (import.meta.env.VITE_BACKEND_URL ?? "").trim();

if (!apiBaseURL) {
  throw new Error(
    "[api] Missing VITE_BACKEND_URL. Expected same-origin '/api'.",
  );
}

if (!import.meta.env.DEV && /^https?:\/\//i.test(apiBaseURL)) {
  throw new Error(
    "[api] Invalid VITE_BACKEND_URL for production. Expected same-origin '/api', not an absolute URL.",
  );
}

// eslint-disable-next-line no-console
console.info("[api] Axios baseURL", apiBaseURL);

const api = axios.create({
  baseURL: apiBaseURL,
  timeout: 60000,
});

// Invalida una sesión específica desde el panel de auditoría.
// Nota: la firma quedó simplificada — el caller pasa el `sessionId` y aquí
// armamos el body `{ session_id }` esperado por el backend. Esto evita que
// cada vista tenga que recordar la forma exacta del payload.
export const invalidateSession = async (
  token: string,
  sessionId: string,
): Promise<void> => {
  return api
    .post(
      "/invalidate-session",
      { session_id: sessionId },
      { headers: { Authorization: `Bearer ${token}` } },
    )
    .then(function (response) {
      return response.data;
    })
    .catch(function (error) {
      return Promise.reject(error);
    });
};

export const revokeUserSession = async (
  token: string,
  sessionId: string,
): Promise<void> => {
  return api
    .post(
      "/manage/sessions/revoke",
      { session_id: sessionId },
      { headers: { Authorization: `Bearer ${token}` } },
    )
    .then(function (response) {
      return response.data;
    })
    .catch(function (error) {
      return Promise.reject(error);
    });
};

export const validateSession = async (
  token: string,
  data: object,
): Promise<ISessionResponse> => {
  return api
    .post<ISessionResponse>("/session", data, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then(function (response) {
      return response.data;
    })
    .catch(function (error) {
      return Promise.reject(error);
    });
};

export const forceLogoutAll = async (token: string): Promise<void> => {
  return api
    .post<void>(
      "/session/force-logout-all",
      {},
      { headers: { Authorization: `Bearer ${token}` } },
    )
    .then((response) => response.data)
    .catch((error) => Promise.reject(error));
};

export interface IMfaStatus {
  user_id: string;
  email: string;
  display_name: string;
  mfa_enabled: boolean;
  mfa_enrolled_at?: string | null;
  has_secret: boolean;
  session_status?:
    | "MFA_Pending"
    | "Active"
    | "Closed"
    | "Expired_Idle"
    | "Revoked_by_Admin"
    | null;
  mfa_verified: boolean;
  mfa_required: boolean;
}

export interface IMfaSetupStart {
  secret: string;
  otpauth_uri: string;
  issuer: string;
  account: string;
}

export const getMfaStatus = async (
  token: string,
  sessionToken?: string | null,
): Promise<IMfaStatus> => {
  return api
    .get<IMfaStatus>("/mfa/status", {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(sessionToken ? { "X-Session-Token": sessionToken } : {}),
      },
      params: sessionToken ? { session_token: sessionToken } : {},
    })
    .then((response) => response.data);
};

export const startMfaSetup = async (token: string): Promise<IMfaSetupStart> => {
  return api
    .post<IMfaSetupStart>(
      "/mfa/setup/start",
      {},
      { headers: { Authorization: `Bearer ${token}` } },
    )
    .then((response) => response.data);
};

export const verifyMfaSetup = async (
  token: string,
  sessionToken: string,
  code: string,
): Promise<IMfaStatus> => {
  return api
    .post<IMfaStatus>(
      "/mfa/setup/verify",
      { session_token: sessionToken, code },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Session-Token": sessionToken,
        },
      },
    )
    .then((response) => response.data);
};

export const verifyMfaChallenge = async (
  token: string,
  sessionToken: string,
  code: string,
): Promise<IMfaStatus> => {
  return api
    .post<IMfaStatus>(
      "/mfa/challenge/verify",
      { session_token: sessionToken, code },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Session-Token": sessionToken,
        },
      },
    )
    .then((response) => response.data);
};

export const resetUserMfa = async (
  token: string,
  userId: string,
): Promise<void> => {
  return api
    .post<void>(
      `/admin/users/${userId}/mfa/reset`,
      {},
      { headers: { Authorization: `Bearer ${token}` } },
    )
    .then((response) => response.data);
};

// NOTA: El helper plural `getPowerBiReports` (GET /power-bi) fue retirado el
// 2026-04-23 junto con el endpoint backend. El listado de reportes
// disponibles se deriva ahora del producto habilitado del usuario y cada
// reporte se solicita individualmente via `getPowerBiReport`, que emite un
// embed token con RLS server-side (ver GEO_RLS_DATA_PATH.md).
export const getPowerBiReport = async (
  token: string,
  reportId: string,
  sessionToken?: string | null,
): Promise<IEmbedConfig> => {
  return api
    .get<IEmbedConfig>(`/power-bi/${reportId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(sessionToken ? { "X-Session-Token": sessionToken } : {}),
      },
    })
    .then(function (response) {
      return response.data;
    })
    .catch(function (error) {
      return Promise.reject(error);
    });
};

export const getProductReportCatalog = async (
  token: string,
  includeDisabled = true,
): Promise<IProductReportCatalogItem[]> => {
  return api
    .get<IProductReportCatalogItem[]>("/products/catalog", {
      headers: { Authorization: `Bearer ${token}` },
      params: { include_disabled: includeDisabled ? 1 : 0 },
    })
    .then((response) => response.data);
};

export const upsertProductReportCatalog = async (
  token: string,
  data: IProductReportCatalogItem,
): Promise<IProductReportCatalogItem> => {
  return api
    .post<IProductReportCatalogItem>("/products/catalog", data, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then((response) => response.data);
};

export const getUser = async (
  token: string,
  userId: string | undefined,
): Promise<IUser> => {
  return api
    .get<IUser>(`/user/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then(function (response) {
      return response.data;
    })
    .catch(function (error) {
      console.error("[api.getUser] Request failed:", error);
      return Promise.reject(error);
    });
};

export const getUsers = async (token: string): Promise<IUser[]> => {
  return api
    .get<IUser[]>(`/user`, { headers: { Authorization: `Bearer ${token}` } })
    .then(function (response) {
      return response.data;
    })
    .catch(function (error) {
      return Promise.reject(error);
    });
};

export const getCountries = async (token: string): Promise<ICountry[]> => {
  try {
    const response = await api.get<ICountry[]>(`/countries`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  } catch (error) {
    return await Promise.reject(error);
  }
};

export const getDepartments = async (token: string): Promise<IDepartment[]> => {
  try {
    const response = await api.get<IDepartment[]>(`/departments`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  } catch (error) {
    return await Promise.reject(error);
  }
};

export const getMunicipalities = async (
  token: string,
): Promise<IMunicipio[]> => {
  try {
    const response = await api.get<IMunicipio[]>(`/municipality`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  } catch (error) {
    return await Promise.reject(error);
  }
};

export const updateUserInfo = async (
  token: string,
  userId: string,
  data: object,
): Promise<void> => {
  return api
    .put<void>(`/user/${userId}`, data, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then(function (response) {
      return response.data;
    })
    .catch(function (error) {
      return Promise.reject(error);
    });
};

export const updateUserproducts = async (
  token: string,
  userId: string,
  products: IProduct[],
): Promise<void> => {
  /**
   * Envía productos CON sus zonas geográficas anidadas.
   *
   * Payload esperado:
   * [
   *   {
   *     "id": null,
   *     "name": "Votometro",
   *     "contract_duration": 1,
   *     "duration_unit": "years",
   *     "enable": true,
   *     "amount_cop": 150000,
   *     "zones": [
   *       {"cod_dep": "05", "cod_mun": null},
   *       {"cod_dep": "81", "cod_mun": "001"}
   *     ]
   *   }
   * ]
   */
  return api
    .put<void>(`/user-products/${userId}`, products, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then(function (response) {
      return response.data;
    })
    .catch(function (error) {
      return Promise.reject(error);
    });
};

export const createUser = async (
  token: string,
  data: object,
): Promise<ISessionResponse> => {
  return api
    .post<ISessionResponse>("/user", data, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then(function (response) {
      return response.data;
    })
    .catch(function (error) {
      return Promise.reject(error);
    });
};

export const deleteUser = async (
  token: string,
  userId: string,
): Promise<void> => {
  return api
    .delete<void>(`/user/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then((response) => response.data)
    .catch((error) => Promise.reject(error));
};

export const getUsersSessionsInfo = async (
  token: string,
  deviceId?: string,
): Promise<ISessionInfo[]> => {
  const params = deviceId ? { device_id: deviceId } : {};
  return api
    .get<ISessionInfo[]>(`/users-sessions`, {
      headers: { Authorization: `Bearer ${token}` },
      params,
    })
    .then(function (response) {
      return response.data;
    })
    .catch(function (error) {
      return Promise.reject(error);
    });
};

export const getSessionActivityDetail = async (
  token: string,
  sessionId: string,
): Promise<ISessionActivityDetail> => {
  return api
    .get<ISessionActivityDetail>(`/manage/sessions/${sessionId}/detail`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then((response) => response.data)
    .catch((error) => Promise.reject(error));
};

export const getSessionAnalytics = async (
  token: string,
  days = 30,
): Promise<ISessionAnalytics> => {
  return api
    .get<ISessionAnalytics>("/manage/sessions/analytics", {
      headers: { Authorization: `Bearer ${token}` },
      params: { days },
    })
    .then((response) => response.data)
    .catch((error) => Promise.reject(error));
};

export interface ISessionHeartbeatPage {
  route: string;
  seconds: number;
}

export interface ISessionHeartbeatResponse {
  session_id: string;
  idle_seconds: number;
  inserted_logs: number;
  status: string;
}

export const sendSessionHeartbeat = async (
  token: string,
  sessionToken: string,
  pages: ISessionHeartbeatPage[],
): Promise<ISessionHeartbeatResponse> => {
  return api
    .put<ISessionHeartbeatResponse>(
      "/sessions/heartbeat",
      { session_token: sessionToken, pages },
      { headers: { Authorization: `Bearer ${token}` } },
    )
    .then((response) => response.data)
    .catch((error) => Promise.reject(error));
};

// =============================================================================
// RBAC dinámico — Roles + Permisos. Backend valida JWT + role=Admin.
// =============================================================================
import type { IPermissionsByModule, IRole } from "../interfaces/IRbac";

export const listPermissionsGrouped = async (
  token: string,
): Promise<IPermissionsByModule> => {
  return api
    .get<IPermissionsByModule>("/permissions", {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then((r) => r.data);
};

export const listRoles = async (token: string): Promise<IRole[]> => {
  return api
    .get<IRole[]>("/roles", { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.data);
};

export const getRole = async (
  token: string,
  roleId: string,
): Promise<IRole> => {
  return api
    .get<IRole>(`/roles/${roleId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then((r) => r.data);
};

export const createRole = async (
  token: string,
  data: { name: string; description?: string },
): Promise<IRole> => {
  return api
    .post<IRole>("/roles", data, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then((r) => r.data);
};

export const updateRole = async (
  token: string,
  roleId: string,
  data: { name?: string; description?: string; is_active?: boolean },
): Promise<IRole> => {
  return api
    .put<IRole>(`/roles/${roleId}`, data, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then((r) => r.data);
};

export const updateRolePermissions = async (
  token: string,
  roleId: string,
  permissionIds: string[],
): Promise<void> => {
  return api
    .put<void>(
      `/roles/${roleId}/permissions`,
      { permission_ids: permissionIds },
      { headers: { Authorization: `Bearer ${token}` } },
    )
    .then((r) => r.data);
};

export const deleteRole = async (
  token: string,
  roleId: string,
): Promise<void> => {
  return api
    .delete<void>(`/roles/${roleId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then((r) => r.data);
};

// =============================================================================
// Admin endpoints — gating de rol Admin se valida también en el backend.
// =============================================================================

export const updateUserRole = async (
  token: string,
  userId: string,
  role: "User" | "Admin",
): Promise<void> => {
  return api
    .put<void>(
      `/user/${userId}/role`,
      { role },
      { headers: { Authorization: `Bearer ${token}` } },
    )
    .then((response) => response.data)
    .catch((error) => Promise.reject(error));
};

export const resetUserPassword = async (
  token: string,
  userId: string,
  newPassword: string,
  forceChangeNextSignin: boolean = true,
): Promise<void> => {
  return api
    .post<void>(
      `/user/${userId}/reset-password`,
      {
        new_password: newPassword,
        force_change_next_signin: forceChangeNextSignin,
      },
      { headers: { Authorization: `Bearer ${token}` } },
    )
    .then((response) => response.data)
    .catch((error) => Promise.reject(error));
};

// =============================================================================
// DIVIPOLA · catálogo geográfico + asignación de zonas por usuario
// =============================================================================

export interface IUserZone {
  cod_dep: string;
  cod_mun: string | null; // null = departamento completo
}

export interface IDivipolaUploadResponse {
  inserted: number;
  updated: number;
  total: number;
  header_detected?: boolean;
  rows_in_csv?: number;
}

export interface IDivipolaStatus {
  rows: number;
}

/**
 * POST /api/divipola/upload — multipart/form-data, campo `file`.
 * Query opcional `?mode=replace` para truncar el catálogo antes de insertar.
 */
export const uploadDivipola = async (
  token: string,
  file: File,
  mode?: "replace",
): Promise<IDivipolaUploadResponse> => {
  const formData = new FormData();
  formData.append("file", file);
  const url = mode ? `/divipola/upload?mode=${mode}` : "/divipola/upload";
  return api
    .post<IDivipolaUploadResponse>(url, formData, {
      headers: {
        Authorization: `Bearer ${token}`,
        // Importante: NO seteamos Content-Type a mano — axios+FormData
        // generan el boundary automáticamente. Si forzamos el header,
        // el parser cgi del backend no encuentra el boundary y rechaza.
      },
      timeout: 120000, // 2min: el CSV puede tener miles de filas
    })
    .then((r) => r.data);
};

export const getDivipolaStatus = async (
  token: string,
): Promise<IDivipolaStatus> => {
  return api
    .get<IDivipolaStatus>("/divipola/status", {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then((r) => r.data);
};

/**
 * PUT /api/user/{userId}/zones — reemplaza el set completo de zonas.
 * `zones=[]` limpia todas las asignaciones del usuario.
 */
export const upsertUserZones = async (
  token: string,
  userId: string,
  zones: IUserZone[],
): Promise<void> => {
  return api
    .put<void>(
      `/user/${userId}/zones`,
      { zones },
      { headers: { Authorization: `Bearer ${token}` } },
    )
    .then((r) => r.data);
};

export default api;
