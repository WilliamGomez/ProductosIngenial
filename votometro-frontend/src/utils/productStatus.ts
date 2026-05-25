import type { IProduct } from "../interfaces/IProduct";

export const parseProductExpiration = (value?: string): Date | null => {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const date = new Date(hasTimezone ? normalized : `${normalized}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const isProductExpired = (product: Pick<IProduct, "expiration">): boolean => {
  const expiration = parseProductExpiration(product.expiration);
  return Boolean(expiration && expiration.getTime() <= Date.now());
};

export const isProductActive = (product: Pick<IProduct, "enable" | "expiration">): boolean =>
  product.enable !== false && !isProductExpired(product);

export const productStatus = (
  product: Pick<IProduct, "enable" | "expiration">
): { label: string; variant: "success" | "danger" | "warning" } => {
  if (isProductExpired(product)) return { label: "Vencido", variant: "warning" };
  if (product.enable === false) return { label: "Deshabilitado", variant: "danger" };
  return { label: "Activo", variant: "success" };
};
