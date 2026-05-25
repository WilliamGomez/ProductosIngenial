import {
  Activity,
  BarChart3,
  Clock3,
  Download,
  Eye,
  Filter,
  Globe,
  MonitorSmartphone,
  PieChart,
  Route,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getSessionAnalytics } from "../services/api";
import { useAccessToken } from "../hooks/useAccessToken";
import type {
  ISessionAnalytics,
  ISessionAnalyticsBrowser,
  ISessionAnalyticsProduct,
  ISessionAnalyticsRecentSession,
  ISessionAnalyticsRoute,
  ISessionAnalyticsTimeBucket,
  ISessionAnalyticsUser,
} from "../interfaces/ISessionInfo";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader, StatCard } from "../components/ui";
import { cn } from "../lib/cn";

const PRODUCT_COLORS: Record<string, string> = {
  Votometro: "#2563eb",
  Audivoto: "#10b981",
  Otros: "#64748b",
};

const formatTime = (seconds?: number): string => {
  const value = Number(seconds || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 && hours === 0) parts.push(`${secs}s`);
  return parts.length ? parts.join(" ") : "0s";
};

const formatDate = (value?: string): string => {
  if (!value) return "-";
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const pct = (value: number, max: number) => `${Math.max(max ? (value / max) * 100 : 0, value > 0 ? 2 : 0)}%`;

const excelEscape = (value: unknown): string => {
  const raw = String(value ?? "");
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return safe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

const downloadExcelWorkbook = (data: ISessionAnalytics, filteredRoutes: ISessionAnalyticsRoute[]) => {
  const table = (title: string, headers: string[], rows: Array<Array<string | number | undefined>>) => `
    <h2>${excelEscape(title)}</h2>
    <table border="1">
      <thead><tr>${headers.map((h) => `<th>${excelEscape(h)}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>${row.map((cell) => `<td>${excelEscape(cell)}</td>`).join("")}</tr>`).join("")}
      </tbody>
    </table>
  `;

  const html = `
    <html>
      <head><meta charset="utf-8" /></head>
      <body>
        ${table("Resumen", ["Metrica", "Valor"], [
          ["Dias", data.days],
          ["Sesiones", data.summary.total_sessions],
          ["Usuarios unicos", data.summary.total_users],
          ["Sesiones activas", data.summary.active_sessions],
          ["Sesiones expiradas", data.summary.expired_sessions],
          ["Segundos observados", data.summary.tracked_seconds],
        ])}
        ${table("Rutas filtradas", ["Producto", "Area", "Ruta", "Segundos", "Sesiones", "Eventos"], filteredRoutes.map((r) => [
          r.product_name,
          r.report_area,
          r.page_route,
          r.total_seconds,
          r.sessions,
          r.events,
        ]))}
        ${table("Usuarios top", ["Usuario", "Email", "Sesiones", "Segundos", "Ultima actividad"], data.top_users.map((u) => [
          u.display_name,
          u.email,
          u.sessions,
          u.total_seconds,
          u.last_activity_time,
        ]))}
        ${table("Horarios", ["Hora", "Segundos", "Sesiones", "Eventos"], data.by_hour.map((h) => [
          h.hour,
          h.total_seconds,
          h.sessions,
          h.events,
        ]))}
        ${table("Navegadores", ["Navegador", "Sesiones", "Usuarios"], data.browsers.map((b) => [
          b.browser,
          b.sessions,
          b.users,
        ]))}
        ${table("Sesiones recientes", ["Usuario", "Email", "IP", "Estado", "Inicio", "Ultima actividad", "Segundos"], data.recent_sessions.map((s) => [
          s.display_name,
          s.email,
          s.ip_address,
          s.status,
          s.issued_at,
          s.last_activity_time,
          s.tracked_seconds,
        ]))}
      </body>
    </html>
  `;

  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `analitica-sesiones-${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const BarRow = ({
  label,
  value,
  max,
  detail,
  tone = "bg-brand-500",
}: {
  label: string;
  value: number;
  max: number;
  detail?: string;
  tone?: string;
}) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="min-w-0 truncate font-medium text-slate-700">{label}</span>
      <span className="shrink-0 tabular-nums text-slate-500">{formatTime(value)}</span>
    </div>
    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
      <div className={cn("h-full rounded-full", tone)} style={{ width: pct(value, max) }} />
    </div>
    {detail && <p className="text-xs text-slate-400">{detail}</p>}
  </div>
);

const AnalyticsListCard = ({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) => (
  <Card className="min-h-[18rem] overflow-hidden">
    <CardHeader>
      <CardTitle className="inline-flex items-center gap-2">
        <span className="text-brand-600 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        {title}
      </CardTitle>
    </CardHeader>
    <CardBody>
      <div className="max-h-[24rem] space-y-4 overflow-y-auto pr-2">{children}</div>
    </CardBody>
  </Card>
);

const LineChart = ({ data }: { data: ISessionAnalyticsTimeBucket[] }) => {
  const width = 760;
  const height = 220;
  const padding = 28;
  const values = data.map((item) => Number(item.total_seconds || 0));
  const max = Math.max(...values, 1);
  const points = data.map((item, index) => {
    const x = padding + (data.length <= 1 ? 0 : (index / (data.length - 1)) * (width - padding * 2));
    const y = height - padding - (Number(item.total_seconds || 0) / max) * (height - padding * 2);
    return { x, y, item };
  });
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const lastPoint = points.length > 0 ? points[points.length - 1] : undefined;
  const lastDate = data.length > 0 ? data[data.length - 1]?.date : "-";
  const area = `${path} L ${lastPoint?.x ?? padding} ${height - padding} L ${padding} ${height - padding} Z`;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-slate-50/50">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-64 w-full">
        <path d={area} fill="#dbeafe" opacity="0.8" />
        <path d={path} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" />
        {points.map((point) => (
          <g key={point.item.date || point.x}>
            <circle cx={point.x} cy={point.y} r="4" fill="#2563eb">
              <title>{`${point.item.date}: ${formatTime(point.item.total_seconds)}`}</title>
            </circle>
          </g>
        ))}
      </svg>
      <div className="flex justify-between px-4 pb-3 text-xs text-slate-400">
        <span>{data[0]?.date || "-"}</span>
        <span>{lastDate || "-"}</span>
      </div>
    </div>
  );
};

const DonutChart = ({ data }: { data: ISessionAnalyticsProduct[] }) => {
  const total = data.reduce((sum, item) => sum + Number(item.total_seconds || 0), 0) || 1;
  let offset = 25;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="flex flex-col items-center gap-4 md:flex-row md:items-center">
      <svg viewBox="0 0 120 120" className="h-44 w-44 -rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="16" />
        {data.map((item) => {
          const value = Number(item.total_seconds || 0);
          const dash = (value / total) * circumference;
          const strokeDasharray = `${dash} ${circumference - dash}`;
          const circle = (
            <circle
              key={item.product_name}
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke={PRODUCT_COLORS[item.product_name] || PRODUCT_COLORS.Otros}
              strokeWidth="16"
              strokeDasharray={strokeDasharray}
              strokeDashoffset={offset}
              strokeLinecap="round"
            >
              <title>{`${item.product_name}: ${formatTime(value)}`}</title>
            </circle>
          );
          offset -= dash;
          return circle;
        })}
      </svg>
      <div className="w-full space-y-2">
        {data.map((item) => (
          <div key={item.product_name} className="flex items-center justify-between gap-3 text-sm">
            <span className="inline-flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: PRODUCT_COLORS[item.product_name] || PRODUCT_COLORS.Otros }}
              />
              <span className="truncate font-medium text-slate-700">{item.product_name}</span>
            </span>
            <span className="shrink-0 tabular-nums text-slate-500">{formatTime(item.total_seconds)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const HourHeatmap = ({ data }: { data: ISessionAnalyticsTimeBucket[] }) => {
  const byHour = new Map(data.map((item) => [Number(item.hour), Number(item.total_seconds || 0)]));
  const max = Math.max(...data.map((item) => Number(item.total_seconds || 0)), 1);
  return (
    <div className="grid grid-cols-6 gap-2 sm:grid-cols-8 lg:grid-cols-12">
      {Array.from({ length: 24 }, (_, hour) => {
        const value = byHour.get(hour) || 0;
        const alpha = Math.max(value / max, value > 0 ? 0.18 : 0.04);
        return (
          <div
            key={hour}
            className="rounded-lg border border-slate-100 px-2 py-2 text-center"
            style={{ backgroundColor: `rgba(37, 99, 235, ${alpha})` }}
            title={`${hour}:00 - ${formatTime(value)}`}
          >
            <p className="text-[11px] font-semibold text-slate-700">{String(hour).padStart(2, "0")}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">{formatTime(value)}</p>
          </div>
        );
      })}
    </div>
  );
};

const SessionAnalyticsDashboard = () => {
  const { getToken } = useAccessToken();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<ISessionAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [productFilter, setProductFilter] = useState("Todos");
  const [browserFilter, setBrowserFilter] = useState("Todos");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const token = await getToken();
        const analytics = await getSessionAnalytics(token, days);
        if (mounted) setData(analytics);
      } catch (err) {
        console.error("[SessionAnalyticsDashboard] load failed", err);
        if (mounted) setError("No se pudo cargar la analitica de sesiones.");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [days, getToken]);

  const productOptions = useMemo(
    () => ["Todos", ...(data?.by_product || []).map((item) => item.product_name)],
    [data]
  );
  const browserOptions = useMemo(
    () => ["Todos", ...(data?.browsers || []).map((item) => item.browser)],
    [data]
  );

  const filteredRoutes = useMemo(() => {
    const lower = query.trim().toLowerCase();
    return (data?.top_routes || []).filter((item) => {
      const productOk = productFilter === "Todos" || item.product_name === productFilter;
      const textOk =
        !lower ||
        item.page_route.toLowerCase().includes(lower) ||
        item.report_area.toLowerCase().includes(lower) ||
        item.product_name.toLowerCase().includes(lower);
      return productOk && textOk;
    });
  }, [data, productFilter, query]);

  const filteredBrowsers = useMemo(() => {
    return (data?.browsers || []).filter((item) => browserFilter === "Todos" || item.browser === browserFilter);
  }, [browserFilter, data]);

  const filteredRecentSessions = useMemo(() => {
    const lower = query.trim().toLowerCase();
    return (data?.recent_sessions || []).filter((session) => {
      if (!lower) return true;
      return (
        session.display_name?.toLowerCase().includes(lower) ||
        session.email?.toLowerCase().includes(lower) ||
        session.ip_address?.toLowerCase().includes(lower)
      );
    });
  }, [data, query]);

  const maxRoute = useMemo(
    () => Math.max(...filteredRoutes.map((item) => Number(item.total_seconds || 0)), 1),
    [filteredRoutes]
  );
  const maxUser = useMemo(
    () => Math.max(...(data?.top_users || []).map((item) => Number(item.total_seconds || 0)), 1),
    [data]
  );
  const maxHour = useMemo(
    () => Math.max(...(data?.by_hour || []).map((item) => Number(item.total_seconds || 0)), 1),
    [data]
  );

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6">
      <PageHeader
        eyebrow="Analitica"
        title="Uso global de informes"
        description="Analiza permanencia, informes, horarios, usuarios, navegadores y sesiones desde una vista consolidada."
      />

      <Card>
        <CardBody className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-4">
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Periodo</span>
              <select value={days} onChange={(event) => setDays(Number(event.target.value))} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm">
                {[7, 30, 90, 180].map((value) => (
                  <option key={value} value={value}>{value} dias</option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Producto</span>
              <select value={productFilter} onChange={(event) => setProductFilter(event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm">
                {productOptions.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Navegador</span>
              <select value={browserFilter} onChange={(event) => setBrowserFilter(event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm">
                {browserOptions.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Buscar</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Usuario, ruta, IP..."
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={!data}
            onClick={() => data && downloadExcelWorkbook(data, filteredRoutes)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Download className="h-4 w-4" />
            Exportar Excel
          </button>
        </CardBody>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-slate-100 bg-white py-20">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
        </div>
      ) : error || !data ? (
        <EmptyState icon={<BarChart3 />} title="Sin analitica disponible" description={error || "No hay datos para mostrar."} />
      ) : (
        <>
          {!data.has_user_agent && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              El desglose de navegadores empezara a poblarse con las nuevas sesiones. Las sesiones anteriores no tenian User-Agent almacenado.
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={<Activity />} label="Sesiones" value={data.summary.total_sessions || 0} tone="brand" />
            <StatCard icon={<Users />} label="Usuarios unicos" value={data.summary.total_users || 0} tone="info" />
            <StatCard icon={<Clock3 />} label="Tiempo observado" value={formatTime(data.summary.tracked_seconds)} tone="success" />
            <StatCard icon={<Eye />} label="Promedio por sesion" value={formatTime(Math.round(data.summary.avg_tracked_seconds || 0))} tone="warning" />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <Card className="xl:col-span-3">
              <CardHeader>
                <CardTitle className="inline-flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-brand-600" />
                  Tendencia de uso por fecha
                </CardTitle>
              </CardHeader>
              <CardBody>
                <LineChart data={data.by_date.slice(-30)} />
              </CardBody>
            </Card>
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle className="inline-flex items-center gap-2">
                  <PieChart className="h-4 w-4 text-brand-600" />
                  Distribucion por informe
                </CardTitle>
              </CardHeader>
              <CardBody>
                <DonutChart data={data.by_product} />
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2">
                <Filter className="h-4 w-4 text-brand-600" />
                Mapa de calor por hora
              </CardTitle>
            </CardHeader>
            <CardBody>
              <HourHeatmap data={data.by_hour} />
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <AnalyticsListCard title="Donde pasan mas tiempo" icon={<Route />}>
              {filteredRoutes.length === 0 ? (
                <p className="text-sm text-slate-500">Sin rutas para los filtros actuales.</p>
              ) : (
                filteredRoutes.map((item) => (
                  <BarRow
                    key={item.page_route}
                    label={item.report_area || item.page_route}
                    value={Number(item.total_seconds || 0)}
                    max={maxRoute}
                    detail={`${item.product_name} - ${item.sessions} sesiones - ${item.events} eventos`}
                    tone={item.product_name === "Audivoto" ? "bg-emerald-500" : "bg-brand-500"}
                  />
                ))
              )}
            </AnalyticsListCard>

            <AnalyticsListCard title="Usuarios con mayor actividad" icon={<Users />}>
              {data.top_users.map((item: ISessionAnalyticsUser) => (
                <BarRow
                  key={item.user_id}
                  label={item.display_name || item.email}
                  value={Number(item.total_seconds || 0)}
                  max={maxUser}
                  detail={`${item.email} - ${item.sessions} sesiones - ultima actividad ${formatDate(item.last_activity_time)}`}
                  tone="bg-sky-500"
                />
              ))}
            </AnalyticsListCard>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <AnalyticsListCard title="Horarios mas visitados" icon={<Clock3 />}>
              {data.by_hour.map((item: ISessionAnalyticsTimeBucket) => (
                <BarRow
                  key={item.hour}
                  label={`${String(item.hour).padStart(2, "0")}:00`}
                  value={Number(item.total_seconds || 0)}
                  max={maxHour}
                  detail={`${item.sessions} sesiones - ${item.events} eventos`}
                  tone="bg-violet-500"
                />
              ))}
            </AnalyticsListCard>

            <AnalyticsListCard title="Navegadores" icon={<MonitorSmartphone />}>
              {filteredBrowsers.map((item: ISessionAnalyticsBrowser) => (
                <div key={item.browser} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{item.browser}</p>
                    <p className="text-xs text-slate-400">{item.users} usuarios</p>
                  </div>
                  <Badge variant="neutral" className="tabular-nums">{item.sessions} sesiones</Badge>
                </div>
              ))}
            </AnalyticsListCard>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2">
                <Globe className="h-4 w-4 text-brand-600" />
                Sesiones recientes
              </CardTitle>
            </CardHeader>
            <div className="max-h-[30rem] overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">Usuario</th>
                    <th className="px-4 py-3">IP</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Ultima actividad</th>
                    <th className="px-4 py-3 text-right">Tiempo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRecentSessions.map((session: ISessionAnalyticsRecentSession) => (
                    <tr key={session.session_id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-800">{session.display_name || "-"}</p>
                        <p className="text-xs text-slate-400">{session.email}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{session.ip_address || "-"}</td>
                      <td className="px-4 py-3">
                        <Badge variant={session.is_active ? "success" : session.status === "Expired_Idle" ? "warning" : "neutral"} dot>
                          {session.status || (session.is_active ? "Active" : "Closed")}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(session.last_activity_time || session.issued_at)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-700">
                        {formatTime(session.tracked_seconds)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

export default SessionAnalyticsDashboard;
