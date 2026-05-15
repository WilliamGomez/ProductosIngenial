import { MapPin } from "lucide-react";
import type { IDepartment } from "../interfaces/IDepartments";
import type { IMunicipio } from "../interfaces/IMunicipio";
import type { IUserZone } from "../services/api";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "./ui";

interface GeographicAssignmentCardProps {
  title?: string;
  zones?: Array<IUserZone & { enable?: boolean }>;
  departamentos: IDepartment[];
  municipios: IMunicipio[];
}

const normalizeDep = (value?: string | number | null): string =>
  value == null ? "" : String(value).padStart(2, "0").slice(-2);

const normalizeMun = (value?: string | number | null): string | null =>
  value == null || value === "" ? null : String(value).padStart(3, "0").slice(-3);

const GeographicAssignmentCard = ({
  title = "Asignacion geografica",
  zones = [],
  departamentos,
  municipios,
}: GeographicAssignmentCardProps) => {
  const activeZones = zones.filter((zone) => zone.enable !== false);

  const resolveZoneLabel = (zone: IUserZone): string => {
    const depCode = normalizeDep(zone.cod_dep);
    const munCode = normalizeMun(zone.cod_mun);
    const department = departamentos.find((item) => normalizeDep(item.code) === depCode);
    const municipality = munCode
      ? municipios.find(
          (item) =>
            normalizeDep(item.dpto) === depCode &&
            normalizeMun(item.code) === munCode
        )
      : null;

    const depName = department?.name ?? depCode;
    if (!munCode) return `${depName} - Departamento completo`;
    return `${depName} - ${municipality?.name ?? munCode}`;
  };

  return (
    <Card className="border-slate-200 bg-slate-50/50 shadow-none">
      <CardHeader className="px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm">{title}</CardTitle>
          <Badge variant="neutral" size="sm">
            {activeZones.length}
          </Badge>
        </div>
      </CardHeader>
      <CardBody className="px-4 pb-4 pt-0">
        {activeZones.length === 0 ? (
          <p className="text-sm text-slate-500">Sin zonas asignadas.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {activeZones.map((zone, index) => {
              const depCode = normalizeDep(zone.cod_dep);
              const munCode = normalizeMun(zone.cod_mun);
              return (
                <span
                  key={`${depCode}-${munCode ?? "all"}-${index}`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700"
                  title={`${depCode}${munCode ? `-${munCode}` : ""}`}
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-brand-500" />
                  <span className="truncate">{resolveZoneLabel(zone)}</span>
                </span>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
};

export default GeographicAssignmentCard;
