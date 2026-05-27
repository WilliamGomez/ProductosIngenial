export interface IProduct {
  id?: number | null;
  name: string;
  expiration?: string;
  contract_duration: number;
  duration_unit: string;
  enable: boolean;
  amount_cop?: number;
  zones: { cod_dep: string; cod_mun: string | null; enable?: boolean }[];
  country?: string;
  state?: string;
  city?: string;
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
