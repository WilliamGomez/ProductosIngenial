import { useMemo, useState } from "react";
import { Map, ChevronDown, ChevronRight, MapPin, Layers, Search } from "lucide-react";
import type { IDepartment } from "../interfaces/IDepartments";
import type { IMunicipio } from "../interfaces/IMunicipio";
import type { IUserZone } from "../services/api";
import { Badge } from "./ui";
import { cn } from "../lib/cn";

/**
 * ZonesSelector — interfaz para asignar zonas geográficas a un usuario.
 *
 * Modelo: arbol "departamento → municipios". Para cada depto:
 *   · Si está expandido, muestra sus municipios con checkboxes individuales.
 *   · El checkbox del depto tiene 3 estados:
 *       · marcado (todos los municipios + el depto completo)
 *       · indeterminado (algunos municipios marcados, NO el depto completo)
 *       · vacío (ninguna asignación)
 *
 * Salida (`onChange`): array `IUserZone[]` con la convención:
 *   · `{cod_dep, cod_mun: null}`  → todo el departamento
 *   · `{cod_dep, cod_mun}`        → municipio específico
 */

interface Props {
    departments: IDepartment[];
    municipalities: IMunicipio[];
    value: IUserZone[];
    onChange: (next: IUserZone[]) => void;
    disabled?: boolean;
}

// UI uses dep+mun (5) as a unique key; backend stores local mun (3).
const pad2 = (n: number | string) => String(n).padStart(2, "0");
const pad5 = (dep: number | string, mun: number | string) =>
    pad2(dep) + String(mun).padStart(3, "0");
const toUiMunCode = (codDep: string, codMun: string | null) => {
    if (codMun == null) return null;
    const raw = String(codMun).trim();
    return raw.length <= 3 ? pad5(codDep, raw) : raw.padStart(5, "0");
};

const ZonesSelector = ({
    departments,
    municipalities,
    value,
    onChange,
    disabled,
}: Props) => {
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [filter, setFilter] = useState("");

    // -- Indexar municipios por código de departamento (2 dígitos) ---------
    const munByDep = useMemo(() => {
        const m: Record<string, IMunicipio[]> = {};
        for (const mu of municipalities) {
            const key = pad2(mu.dpto);
            if (!m[key]) m[key] = [];
            m[key].push(mu);
        }
        for (const k of Object.keys(m)) {
            m[k].sort((a, b) => a.name.localeCompare(b.name, "es"));
        }
        return m;
    }, [municipalities]);

    // -- Indexar `value` para lookups O(1) ---------------------------------
    const selDepFull = useMemo(
        () => new Set(value.filter((z) => z.cod_mun == null).map((z) => z.cod_dep)),
        [value]
    );
    const selMuns = useMemo(
        () =>
            new Set(
                value
                    .filter((z) => z.cod_mun != null)
                    .map((z) => toUiMunCode(z.cod_dep, z.cod_mun as string) as string)
            ),
        [value]
    );

    // -- Estado tri-state por departamento --------------------------------
    type DepState = "all" | "some" | "none";
    const depStateOf = (codDep: string): DepState => {
        if (selDepFull.has(codDep)) return "all";
        const muns = munByDep[codDep] ?? [];
        if (muns.length === 0) return "none";
        const sel = muns.filter((m) => selMuns.has(pad5(m.dpto, m.code))).length;
        if (sel === 0) return "none";
        if (sel === muns.length) return "all"; // visualmente equivale a "todos"
        return "some";
    };

    // -- Toggle helpers ----------------------------------------------------
    const setDepartmentAll = (codDep: string, on: boolean) => {
        const next: IUserZone[] = [];
        // Conservamos todo lo que NO es de este depto
        for (const z of value) {
            if (z.cod_dep !== codDep) next.push(z);
        }
        if (on) next.push({ cod_dep: codDep, cod_mun: null });
        onChange(next);
    };

    const toggleMunicipality = (codDep: string, codMun: string) => {
        let next: IUserZone[] = [];
        // Si el depto completo está marcado, "bajamos" a granularidad municipal:
        // expandimos a todos los municipios EXCEPTO el que se está toggleando.
        if (selDepFull.has(codDep)) {
            const muns = (munByDep[codDep] ?? []).map((m) => pad5(m.dpto, m.code));
            for (const z of value) {
                if (z.cod_dep !== codDep) next.push(z);
            }
            for (const m of muns) {
                if (m !== codMun) next.push({ cod_dep: codDep, cod_mun: m });
            }
        } else {
            const wasSelected = selMuns.has(codMun);
            next = value.filter(
                (z) => !(z.cod_dep === codDep && toUiMunCode(z.cod_dep, z.cod_mun) === codMun)
            );
            if (!wasSelected) next.push({ cod_dep: codDep, cod_mun: codMun });
        }
        onChange(next);
    };

    const toggleExpand = (codDep: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            next.has(codDep) ? next.delete(codDep) : next.add(codDep);
            return next;
        });
    };

    // -- Filtro de búsqueda ------------------------------------------------
    const visibleDeps = useMemo(() => {
        const sorted = [...departments].sort((a, b) =>
            a.name.localeCompare(b.name, "es")
        );
        const q = filter.trim().toLowerCase();
        if (!q) return sorted;
        return sorted.filter((d) => {
            if (d.name.toLowerCase().includes(q)) return true;
            const codDep = pad2(d.code);
            return (munByDep[codDep] ?? []).some((m) =>
                m.name.toLowerCase().includes(q)
            );
        });
    }, [departments, filter, munByDep]);

    // -- Estadísticas del badge superior ----------------------------------
    const stats = useMemo(() => {
        const fullDeps = selDepFull.size;
        const singleMuns = selMuns.size;
        return { fullDeps, singleMuns };
    }, [selDepFull, selMuns]);

    return (
        <div className="space-y-3">
            {/* Resumen */}
            <div className="flex flex-wrap items-center gap-2">
                <Badge variant="info" size="sm" className="uppercase tracking-wide">
                    <Layers className="h-3 w-3" />
                    {stats.fullDeps} departamentos completos
                </Badge>
                <Badge variant="success" size="sm" className="uppercase tracking-wide">
                    <MapPin className="h-3 w-3" />
                    {stats.singleMuns} municipios sueltos
                </Badge>
                {value.length === 0 && (
                    <Badge variant="warning" size="sm" className="uppercase tracking-wide">
                        Sin zonas asignadas
                    </Badge>
                )}
            </div>

            {/* Buscador */}
            <div className="relative">
                <Search className="absolute top-1/2 -translate-y-1/2 left-3 h-4 w-4 text-slate-400 pointer-events-none" />
                <input
                    type="text"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Buscar departamento o municipio…"
                    className={cn(
                        "h-9 pl-9 pr-3 w-full rounded-lg text-sm bg-white",
                        "border border-slate-200 text-slate-900 placeholder:text-slate-400",
                        "focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20",
                        "transition-colors"
                    )}
                />
            </div>

            {/* Lista de departamentos */}
            <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[480px] overflow-y-auto bg-white">
                {visibleDeps.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-slate-500">
                        <Map className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                        Sin resultados. ¿Está cargado el catálogo DIVIPOLA?
                    </div>
                ) : (
                    visibleDeps.map((d) => {
                        const codDep = pad2(d.code);
                        const state = depStateOf(codDep);
                        const isOpen = expanded.has(codDep);
                        const muns = munByDep[codDep] ?? [];
                        return (
                            <div key={codDep}>
                                {/* Fila depto */}
                                <div className="flex items-center px-4 py-2.5 hover:bg-slate-50/60">
                                    <button
                                        type="button"
                                        onClick={() => toggleExpand(codDep)}
                                        className="flex-shrink-0 inline-flex h-6 w-6 items-center justify-center text-slate-400 hover:text-slate-700"
                                        aria-label={
                                            isOpen ? "Colapsar" : "Expandir"
                                        }
                                    >
                                        {isOpen ? (
                                            <ChevronDown className="h-4 w-4" />
                                        ) : (
                                            <ChevronRight className="h-4 w-4" />
                                        )}
                                    </button>
                                    <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            disabled={disabled}
                                            checked={state === "all"}
                                            ref={(el) => {
                                                if (el)
                                                    el.indeterminate =
                                                        state === "some";
                                            }}
                                            onChange={(e) =>
                                                setDepartmentAll(
                                                    codDep,
                                                    e.target.checked
                                                )
                                            }
                                            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/20"
                                        />
                                        <span className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
                                            {d.name}
                                        </span>
                                        <Badge
                                            variant="neutral"
                                            size="sm"
                                            className="font-mono text-[10px]"
                                        >
                                            {codDep}
                                        </Badge>
                                        <span className="text-xs text-slate-400 ml-auto">
                                            {muns.length} mun.
                                        </span>
                                    </label>
                                </div>

                                {/* Lista de municipios (expandible) */}
                                {isOpen && (
                                    <ul className="bg-slate-50/40 px-4 py-2 pl-12 space-y-1">
                                        {muns.length === 0 && (
                                            <li className="text-xs text-slate-400 italic">
                                                No hay municipios en el catálogo
                                                para este departamento.
                                            </li>
                                        )}
                                        {muns.map((m) => {
                                            const codMun = pad5(m.dpto, m.code);
                                            const checked =
                                                selDepFull.has(codDep) ||
                                                selMuns.has(codMun);
                                            return (
                                                <li
                                                    key={codMun}
                                                    className="flex items-center gap-2"
                                                >
                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            disabled={
                                                                disabled
                                                            }
                                                            checked={checked}
                                                            onChange={() =>
                                                                toggleMunicipality(
                                                                    codDep,
                                                                    codMun
                                                                )
                                                            }
                                                            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/20"
                                                        />
                                                        <span className="text-sm text-slate-700">
                                                            {m.name}
                                                        </span>
                                                        <span className="text-[10px] text-slate-400 font-mono">
                                                            {codMun}
                                                        </span>
                                                    </label>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default ZonesSelector;
