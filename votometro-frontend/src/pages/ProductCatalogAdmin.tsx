import { useEffect, useMemo, useState } from "react";
import { BarChart3, CheckCircle2, Plus, Save, ShieldCheck } from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Spinner,
} from "../components/ui";
import { useAccessToken } from "../hooks/useAccessToken";
import { resolveLucideIcon } from "../lib/lucideIcon";
import {
  getProductReportCatalog,
  upsertProductReportCatalog,
  type IProductReportCatalogItem,
} from "../services/api";
import { cn } from "../lib/cn";

const emptyProduct: IProductReportCatalogItem = {
  id: null,
  name: "",
  display_name: "",
  route_path: "",
  powerbi_report_id: "",
  powerbi_workspace_id: "",
  powerbi_tenant_id: "",
  icon: "BarChart3",
  display_order: 100,
  is_report_enabled: true,
  description: "",
};

const inputClasses =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";
const labelClasses =
  "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500";

const normalizeRoute = (value: string) => {
  const route = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (!route) return "";
  return route.startsWith("/") ? route : `/${route}`;
};

const guidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const parsePowerBiReportInput = (value: string) => {
  const input = value.trim();
  if (!input) return { reportId: "", workspaceId: null, error: "" };
  if (guidPattern.test(input)) return { reportId: input, workspaceId: null, error: "" };

  try {
    const url = new URL(input);
    const path = decodeURIComponent(url.pathname);
    const secureEmbedMatch = path.match(
      /\/groups\/([0-9a-f-]{36})\/reports\/([0-9a-f-]{36})/i,
    );
    if (secureEmbedMatch) {
      return {
        workspaceId: secureEmbedMatch[1],
        reportId: secureEmbedMatch[2],
        error: "",
      };
    }

    if (url.hostname.endsWith("powerbi.com") && path === "/view") {
      return {
        reportId: input,
        workspaceId: null,
        error:
          "Ese enlace es de 'Publicar en web' (/view?r=...). Para embed seguro necesitas el report_id GUID real del reporte en el workspace.",
      };
    }
  } catch {
    // Not a URL; validation below will show the GUID error.
  }

  return {
    reportId: input,
    workspaceId: null,
    error:
      "Pega un report_id GUID o una URL segura de Power BI con /groups/{workspaceId}/reports/{reportId}.",
  };
};

export default function ProductCatalogAdmin() {
  const { getToken } = useAccessToken();
  const [items, setItems] = useState<IProductReportCatalogItem[]>([]);
  const [selected, setSelected] =
    useState<IProductReportCatalogItem>(emptyProduct);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const SelectedIcon = resolveLucideIcon(selected.icon, BarChart3);

  const sortedItems = useMemo(
    () =>
      [...items].sort(
        (a, b) => (a.display_order ?? 100) - (b.display_order ?? 100),
      ),
    [items],
  );

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      setItems(await getProductReportCatalog(token, true));
    } catch (err) {
      console.error("[ProductCatalogAdmin] load failed", err);
      setError("No se pudo cargar el catalogo de productos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const updateField = <K extends keyof IProductReportCatalogItem>(
    key: K,
    value: IProductReportCatalogItem[K],
  ) => {
    setSelected((prev) => ({ ...prev, [key]: value }));
  };

  const validate = () => {
    if (!selected.name.trim())
      return "El nombre tecnico del producto es requerido.";
    if (!selected.display_name.trim()) return "El nombre visible es requerido.";
    if (!selected.route_path.trim().startsWith("/"))
      return "La ruta debe iniciar con /.";
    if (!guidPattern.test(selected.powerbi_report_id.trim())) {
      return "El report_id debe ser un GUID valido de Power BI.";
    }
    if (
      selected.powerbi_workspace_id &&
      !guidPattern.test(selected.powerbi_workspace_id.trim())
    ) {
      return "El workspace_id debe ser un GUID valido o dejarse vacio.";
    }
    if (
      selected.powerbi_tenant_id &&
      !guidPattern.test(selected.powerbi_tenant_id.trim())
    ) {
      return "El tenant_id debe ser un GUID valido o dejarse vacio.";
    }
    return "";
  };

  const save = async () => {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const token = await getToken();
      const payload = {
        ...selected,
        route_path: normalizeRoute(selected.route_path),
        display_order: Number(selected.display_order) || 100,
        powerbi_workspace_id: selected.powerbi_workspace_id?.trim() || null,
        powerbi_tenant_id: selected.powerbi_tenant_id?.trim() || null,
      };
      const savedItem = await upsertProductReportCatalog(token, payload);
      setSelected(savedItem);
      setItems((prev) => {
        const others = prev.filter((item) => item.id !== savedItem.id);
        return [...others, savedItem];
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      console.error("[ProductCatalogAdmin] save failed", err);
      setError(
        "No se pudo guardar el producto. Revisa duplicados de ruta o report_id.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Spinner />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">
            Administracion
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            Productos e informes embebidos
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Aqui se registra la metadata segura del informe. Los tokens embed,
            secretos, tenant y credenciales siguen en backend/Key Vault y se
            generan por solicitud.
          </p>
        </div>
        <Button
          leftIcon={<Plus />}
          variant="secondary"
          onClick={() => {
            setSelected(emptyProduct);
            setError("");
          }}
        >
          Nuevo producto
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}
      {saved && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          Producto guardado.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Catalogo actual</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="max-h-[34rem] space-y-2 overflow-y-auto pr-2">
              {sortedItems.map((item) => (
                <button
                  key={item.id ?? item.name}
                  type="button"
                  onClick={() => {
                    setSelected(item);
                    setError("");
                  }}
                  className={cn(
                    "w-full rounded-lg border px-3 py-3 text-left transition-colors",
                    selected.id === item.id
                      ? "border-brand-200 bg-brand-50"
                      : "border-slate-200 bg-white hover:bg-slate-50",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {item.display_name || item.name}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.route_path}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        item.is_report_enabled
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-500",
                      )}
                    >
                      {item.is_report_enabled ? "Activo" : "Off"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                <SelectedIcon className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Configuracion del informe</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  No pegues tokens ni secretos aqui.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardBody>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Nombre tecnico">
                <input
                  className={inputClasses}
                  value={selected.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  placeholder="Votometro"
                />
              </Field>
              <Field label="Nombre visible">
                <input
                  className={inputClasses}
                  value={selected.display_name}
                  onChange={(event) =>
                    updateField("display_name", event.target.value)
                  }
                  placeholder="Votometro"
                />
              </Field>
              <Field label="Ruta en la plataforma">
                <input
                  className={inputClasses}
                  value={selected.route_path}
                  onChange={(event) =>
                    updateField(
                      "route_path",
                      normalizeRoute(event.target.value),
                    )
                  }
                  placeholder="/votometro"
                />
              </Field>
              <Field label="Orden">
                <input
                  className={inputClasses}
                  type="number"
                  value={selected.display_order}
                  onChange={(event) =>
                    updateField("display_order", Number(event.target.value))
                  }
                />
              </Field>
              <div className="md:col-span-2">
                <Field label="Power BI report_id">
                  <input
                    className={inputClasses}
                    value={selected.powerbi_report_id}
                    onChange={(event) => {
                      const parsed = parsePowerBiReportInput(event.target.value);
                      updateField("powerbi_report_id", parsed.reportId);
                      if (parsed.workspaceId) {
                        updateField("powerbi_workspace_id", parsed.workspaceId);
                      }
                      setError(parsed.error);
                    }}
                    placeholder="report_id GUID o URL /groups/{workspaceId}/reports/{reportId}"
                  />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Workspace override" hint="Opcional">
                  <input
                    className={inputClasses}
                    value={selected.powerbi_workspace_id ?? ""}
                    onChange={(event) =>
                      updateField("powerbi_workspace_id", event.target.value)
                    }
                    placeholder="Usa POWER_BI_GROUP_ID si se deja vacio"
                  />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Tenant Power BI" hint="Opcional">
                  <input
                    className={inputClasses}
                    value={selected.powerbi_tenant_id ?? ""}
                    onChange={(event) =>
                      updateField("powerbi_tenant_id", event.target.value)
                    }
                    placeholder="Usa POWER_BI_TENANT_ID si se deja vacio"
                  />
                </Field>
              </div>
              <Field label="Icono">
                <div className="flex gap-2">
                  <input
                    className={inputClasses}
                    value={selected.icon ?? ""}
                    onChange={(event) => updateField("icon", event.target.value)}
                    placeholder="BarChart3"
                  />
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600">
                    <SelectedIcon className="h-5 w-5" />
                  </div>
                </div>
              </Field>
              <Field label="Estado">
                <select
                  className={inputClasses}
                  value={selected.is_report_enabled ? "1" : "0"}
                  onChange={(event) =>
                    updateField("is_report_enabled", event.target.value === "1")
                  }
                >
                  <option value="1">Activo</option>
                  <option value="0">Inactivo</option>
                </select>
              </Field>
              <div className="md:col-span-2">
                <Field label="Descripcion" hint="Opcional">
                  <textarea
                    className={cn(inputClasses, "min-h-24 resize-y")}
                    value={selected.description ?? ""}
                    onChange={(event) =>
                      updateField("description", event.target.value)
                    }
                  />
                </Field>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
              <div className="flex gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-600" />
                <p>
                  El backend valida permisos, genera embed token y aplica RLS.
                  Esta pantalla solo habilita el catalogo de rutas y reportes.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <Button leftIcon={<Save />} onClick={save} disabled={saving}>
                {saving ? "Guardando..." : "Guardar producto"}
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className={labelClasses}>
        {label}
        {hint && (
          <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">
            {hint}
          </span>
        )}
      </span>
      {children}
    </label>
  );
}
