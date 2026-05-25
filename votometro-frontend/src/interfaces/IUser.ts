import type { IProduct } from "./IProduct";

export interface IUser {
  id: string;
  display_name: string;
  name?: string;
  password?: string;
  email: string;
  personal_email?: string;
  phone: string;
  reference?: string;
  reference2?: string;
  identity_document: string;
  type_person?: string;
  type_dni?: string;
  enable: boolean;
  department: string;
  role: string;
  mfa_enabled?: boolean;
  mfa_enrolled_at?: string | null;
  products: IProduct[];
  created_at?: string;
}
