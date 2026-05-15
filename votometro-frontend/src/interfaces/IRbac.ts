/**
 * Tipos compartidos para el módulo RBAC dinámico (Roles + Permisos).
 *
 * Forma sincronizada con `_serialize_role` y `ListPermissionsUseCase` del
 * backend. Si cambia la respuesta del API, actualizar aquí también.
 */

export interface IPermission {
  id: string;
  name: string;            // ej. "users.read"
  resource: string;        // ej. "users"
  action: string;          // ej. "read"
  module: string;          // agrupador UI: "Usuarios", "PowerBI", ...
  description?: string | null;
}

export interface IRole {
  id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
  is_system: boolean;
  created_at?: string | null;
  permissions: IPermission[];
}

/** GET /permissions ya viene agrupado por módulo desde el backend. */
export type IPermissionsByModule = Record<string, IPermission[]>;
