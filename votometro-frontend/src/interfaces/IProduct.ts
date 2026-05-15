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
}
