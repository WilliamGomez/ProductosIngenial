import type { IProduct } from "./IProduct";

export interface IRegisterUserFormData {
  nombre: string;
  telefono: string;
  email: string;
  personalEmail: string;
  password: string;
  confirmPassword: string;
  referencia: string;
  referencia2: string;
  tipoPersona: string;
  tipoDNI: string;
  numeroDNI: string;
  tipoUsuario: string;
  tiempoContratacionVotometro: string;
  tiempoContratacionAudivoto: string;
  products: { name: string }[];
}

export interface IProductsFormData {
  tiempoContratacionVotometro: string;
  tiempoContratacionAudivoto: string;
  initialProducts: IProduct[];
  newProducts: { id?: number | string | null; name: string }[];
}

export interface IUserInfoFormData {
  display_name: string;
  phone: string;
  email: string;
  personal_email: string;
  reference: string;
  reference2: string;
  identity_document: string;
  type_person: string;
  type_dni: string;
  role: string;
  enable: boolean;
}
