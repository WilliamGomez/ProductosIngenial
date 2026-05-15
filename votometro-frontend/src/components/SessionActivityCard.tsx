import { Clock, Globe, PieChart, Route } from "lucide-react";
import type { ISessionActivityDetail } from "../interfaces/ISessionInfo";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "./ui";
import { cn } from "../lib/cn";

const formatTime = (time: number): string => {
  if (!time || Number.isNaN(time)) return "0s";
  const hours = Math.floor(time / 3600);
  const minutes = Math.floor((time % 3600) / 60);
  const seconds = time % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}min`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
};

const formatDate = (value?: string): string => {
  if (!value) return "-";
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "Fecha invalida";
  return date.toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const statusMeta = (detail: ISessionActivityDetail) => {
  if (detail.status === "Expired_Idle") {
    return { label: "Expirada por Inactividad", variant: "warning" as const };
  }
  if (detail.status === "Revoked_by_Admin") {
    return { label: "Revocada por Admin", variant: "danger" as const };
  }
  if (detail.status === "Active" || detail.is_active) {
    return { label: "Activa", variant: "success" as const };
  }
  return { label: "Cerrada", variant: "neutral" as const };
};

const productKeyForRoute = (route: string): "Votometro" | "Audivoto" | "Otros" => {
  const normalized = route.toLowerCase();
  if (normalized.includes("votometro")) return "Votometro";
  if (normalized.includes("audivoto")) return "Audivoto";
  return "Otros";
};

interface ProductTotal {
  name: string;
  seconds: number;
  tone: string;
}

export const SessionActivityCard = ({ detail }: { detail: ISessionActivityDetail }) => {
  const meta = statusMeta(detail);
  const totalSeconds = Number(detail.total_seconds ?? detail.diff_seconds ?? 0);
  const pages = Array.isArray(detail.pages) ? detail.pages : [];
  const productTotalsMap = pages.reduce<Record<string, number>>((acc, page) => {
    const key = productKeyForRoute(page.page_route);
    acc[key] = (acc[key] ?? 0) + Number(page.time_spent_seconds || 0);
    return acc;
  }, {});

  const productTotals: ProductTotal[] = [
    { name: "Votometro", seconds: productTotalsMap.Votometro ?? 0, tone: "bg-brand-500" },
    { name: "Audivoto", seconds: productTotalsMap.Audivoto ?? 0, tone: "bg-emerald-500" },
    { name: "Otros", seconds: productTotalsMap.Otros ?? 0, tone: "bg-slate-400" },
  ].filter((item) => item.seconds > 0);

  const trackedSeconds = productTotals.reduce((sum, item) => sum + item.seconds, 0);
  const chartTotal = Math.max(trackedSeconds, totalSeconds, 1);

  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Actividad de sesion</CardTitle>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {formatDate(detail.login_time ?? detail.issued_at)}
              </span>
              <span className="inline-flex items-center gap-1.5 font-mono">
                <Globe className="h-3.5 w-3.5" />
                {detail.ip_address || "-"}
              </span>
            </div>
          </div>
          <Badge variant={meta.variant} dot className="uppercase tracking-wide">
            {meta.label}
          </Badge>
        </div>
      </CardHeader>
      <CardBody className="space-y-5">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <PieChart className="h-4 w-4" />
            Distribucion por producto
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100 flex">
            {productTotals.length === 0 ? (
              <div className="h-full w-full bg-slate-200" />
            ) : (
              productTotals.map((item) => (
                <div
                  key={item.name}
                  className={cn("h-full", item.tone)}
                  style={{ width: `${Math.max((item.seconds / chartTotal) * 100, 2)}%` }}
                  title={`${item.name}: ${formatTime(item.seconds)}`}
                />
              ))
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
            {productTotals.map((item) => (
              <span key={item.name} className="inline-flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-full", item.tone)} />
                {item.name}: {formatTime(item.seconds)}
              </span>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Route className="h-4 w-4" />
            Pestanas visitadas
          </div>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
            {pages.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">Sin navegacion registrada.</p>
            ) : (
              pages.map((page) => (
                <div key={page.log_id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{page.page_route}</p>
                    <p className="text-xs text-slate-400">{formatDate(page.created_at)}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-700">
                    {formatTime(page.time_spent_seconds)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tiempo total</span>
          <span className="text-base font-bold tabular-nums text-slate-900">{formatTime(totalSeconds)}</span>
        </div>
      </CardBody>
    </Card>
  );
};

export default SessionActivityCard;
