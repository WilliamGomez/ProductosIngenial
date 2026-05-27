import { useMemo } from "react";
import { useParams } from "react-router-dom";
import PowerBiReportEmbed from "../components/PowerBiReportEmbed";
import { useAuth } from "../hooks/useAuth";

interface ReportProduct {
  name: string;
  display_name?: string | null;
  route_path?: string | null;
  powerbi_report_id?: string | null;
  powerbi_tenant_id?: string | null;
  is_report_enabled?: boolean;
  enable?: boolean;
  expiration?: string;
}

const normalizeRoute = (value?: string | null) =>
  (value || "").trim().toLowerCase().replace(/^\/+/, "");

const isReportProductActive = (product?: ReportProduct | null) => {
  if (!product) return false;
  if (product.enable === false) return false;
  if (!product.expiration) return true;
  return new Date(product.expiration).getTime() > Date.now();
};

export default function ProductReportPage({
  productOverride,
}: {
  productOverride?: ReportProduct;
}) {
  const { routeSlug } = useParams<{ routeSlug: string }>();
  const { userProducts } = useAuth();

  const product = useMemo(() => {
    const slug = normalizeRoute(routeSlug);
    if (productOverride) return productOverride;
    return userProducts?.find((item) => {
      const route = normalizeRoute(item.route_path);
      const name = normalizeRoute(item.name);
      return route === slug || name === slug;
    });
  }, [productOverride, routeSlug, userProducts]);

  if (!product?.powerbi_report_id) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
        El informe no tiene un report_id configurado en el catalogo.
      </div>
    );
  }

  if (
    !productOverride &&
    (!isReportProductActive(product) || product.is_report_enabled === false)
  ) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        Este producto no esta activo para su usuario.
      </div>
    );
  }

  return (
    <PowerBiReportEmbed
      key={`${product.powerbi_report_id}:${product.route_path || product.name}`}
      reportId={product.powerbi_report_id}
      productName={product.display_name || product.name}
    />
  );
}
