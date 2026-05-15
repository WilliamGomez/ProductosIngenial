import {
    Search,
    ChevronLeft,
    ChevronRight,
    Activity,
    Ban,
    Network,
    Globe,
    SearchX,
    Eye,
    LogOut,
} from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccessToken } from "../hooks/useAccessToken";
import { getSessionActivityDetail, getUsersSessionsInfo, getUsers, revokeUserSession } from "../services/api";
import SessionActivityCard from "../components/SessionActivityCard";
import type { ISessionActivityDetail, ISessionInfo } from "../interfaces/ISessionInfo";
import type { IUser } from "../interfaces/IUser"; // <-- Importamos la interfaz
import { useTableSort } from "../hooks/useTableSort";
import {
    Avatar,
    Badge,
    Card,
    EmptyState,
    IconButton,
    PageHeader,
    StatCard,
} from "../components/ui";
import { cn } from "../lib/cn";

// Creamos una interfaz extendida para la sesion fusionada con el usuario
interface IMergedSession extends ISessionInfo {
    reference?: string;
    reference2?: string;
    products?: any[];
}

const SessionsAdmin = () => {
    const { getToken } = useAccessToken();
    const navigate = useNavigate();

    const [sessions, setSessions] = useState<IMergedSession[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [loading, setLoading] = useState(true);
    const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
    const [sessionDetail, setSessionDetail] = useState<ISessionActivityDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const usersPerPage = 20;

    useEffect(() => {
        getSessionsInfoList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const getSessionsInfoList = async () => {
        setLoading(true);
        try {
            const token = await getToken();
            
            // Magia Frontend: Llamamos a ambas APIs al mismo tiempo
            const [sessionsData, usersData] = await Promise.all([
                getUsersSessionsInfo(token),
                getUsers(token)
            ]);

            const safeSessions = Array.isArray(sessionsData) ? sessionsData : [];
            const safeUsers = Array.isArray(usersData) ? (usersData as IUser[]) : [];

            // Cruzamos la data: Buscamos el usuario dueno de la sesion y le extraemos ref y productos
            const mergedData = safeSessions.map((session) => {
                const matchedUser = safeUsers.find((u) => u.id === session.user_id);
                return {
                    ...session,
                    reference: matchedUser?.reference || "",
                    reference2: matchedUser?.reference2 || "",
                    products: matchedUser?.products || []
                };
            });

            setSessions(mergedData);
        } catch (err) {
            console.error("Error al obtener sesiones o usuarios:", err);
            setSessions([]);
        } finally {
            setLoading(false);
        }
    };

    const handleCloseSession = async (sessionId: string) => {
        if (!sessionId) return;
        if (!window.confirm("Estas seguro de cerrar esta sesion de forma forzada?")) return;
        try {
            const token = await getToken();
            await revokeUserSession(token, sessionId);
            // Recargamos la tabla para reflejar el nuevo estado (is_active=false /
            // is_blocked=true segun lo que devuelva el backend).
            await getSessionsInfoList();
        } catch (err) {
            console.error("Error al invalidar la sesion:", err);
            alert("No se pudo cerrar la sesion. Intenta nuevamente.");
        }
    };

    const safeSessions = Array.isArray(sessions) ? sessions : [];

    const filteredSessions = safeSessions.filter((session) => {
        const lower = searchTerm.toLowerCase();
        const status = session.status ?? (session.is_active ? "Active" : "Closed");

        const matchesSearch =
            session.display_name?.toLowerCase().includes(lower) ||
            session.email?.toLowerCase().includes(lower) ||
            session.ip_address?.toLowerCase().includes(lower) ||
            session.reference?.toLowerCase().includes(lower);

        const matchesStatus =
            statusFilter.length === 0 ||
            (status === "Active" && statusFilter.includes("activa")) ||
            (status === "Expired_Idle" && statusFilter.includes("expirada")) ||
            (session.is_blocked && statusFilter.includes("bloqueada")) ||
            (status === "Closed" && !session.is_blocked && statusFilter.includes("inactiva"));

        return matchesSearch && matchesStatus;
    });

    const { sortedData, sortConfig, requestSort, getSortIcon } = useTableSort(
        filteredSessions,
        { key: "issued_at", direction: "desc" },
        undefined,
        () => setCurrentPage(1)
    );

    const formatTime = (time: number): string => {
        if (!time || isNaN(time)) return "0 segundos";
        const hours = Math.floor(time / 3600);
        const minutes = Math.floor((time % 3600) / 60);
        const seconds = time % 60;
        const parts: string[] = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (seconds > 0 && hours === 0) parts.push(`${seconds}s`);
        return parts.length > 0 ? parts.join(" ") : "0s";
    };

    const formatDatetimeReadable = (input: string): string => {
        if (!input) return "";
        const date = new Date(input.replace(" ", "T"));
        if (isNaN(date.getTime())) return "Fecha invalida";
        return date.toLocaleString("es-ES", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    const loadSessionDetail = async (sessionId?: string | null) => {
        if (!sessionId) return;
        if (expandedSessionId === sessionId) {
            setExpandedSessionId(null);
            setSessionDetail(null);
            return;
        }
        setExpandedSessionId(sessionId);
        setSessionDetail(null);
        setDetailLoading(true);
        try {
            const token = await getToken();
            const detail = await getSessionActivityDetail(token, sessionId);
            setSessionDetail(detail);
        } catch (err) {
            console.error("Error al obtener detalle de sesion:", err);
        } finally {
            setDetailLoading(false);
        }
    };

    const getPaginationRange = (current: number, total: number, delta = 1): (number | string)[] => {
        const range: (number | string)[] = [];
        const left = Math.max(2, current - delta);
        const right = Math.min(total - 1, current + delta);
        range.push(1);
        if (left > 2) range.push("...");
        for (let i = left; i <= right; i++) range.push(i);
        if (right < total - 1) range.push("...");
        if (total > 1) range.push(total);
        return range;
    };

    const totalPages = Math.ceil(sortedData.length / usersPerPage);
    const paginatedSessions = sortedData.slice((currentPage - 1) * usersPerPage, currentPage * usersPerPage);
    const paginationRange = getPaginationRange(currentPage, totalPages);

    const totalSessions = safeSessions.length;
    const activeSessions = safeSessions.filter((s) => s.is_active).length;
    const blockedSessions = safeSessions.filter((s) => s.is_blocked).length;

    const toggleStatus = (value: string) => {
        setStatusFilter((prev) => prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]);
        setCurrentPage(1);
    };

    const SortableTh = ({ sortKey, label, align = "left" }: { sortKey: string; label: string; align?: "left" | "center" | "right" }) => {
        const active = sortConfig?.key === sortKey;
        return (
            <th
                onClick={() => requestSort(sortKey)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        requestSort(sortKey);
                    }
                }}
                tabIndex={0}
                className={cn(
                    "px-4 py-3 text-[11px] font-bold uppercase tracking-wider cursor-pointer select-none",
                    "text-slate-500 hover:text-brand-600 transition-colors",
                    active && "text-brand-600",
                    align === "center" && "text-center",
                    align === "right" && "text-right"
                )}
            >
                <span className={cn("inline-flex items-center gap-1", align === "center" && "justify-center", align === "right" && "justify-end")}>
                    {label}
                    {getSortIcon(sortKey)}
                </span>
            </th>
        );
    };

    const FilterChip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
        <button
            type="button"
            onClick={onClick}
            className={cn("h-7 px-3 rounded-full text-xs font-medium transition-colors", active ? "bg-brand-600 text-white shadow-sm" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100")}
        >
            {children}
        </button>
    );

    return (
        <div className="space-y-6 max-w-screen-2xl mx-auto">
            <PageHeader
                eyebrow="Auditoria"
                title="Sesiones"
                description="Monitorea quien accede a la plataforma, desde que IP y por cuanto tiempo."
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard icon={<Network />} label="Sesiones registradas" value={totalSessions} tone="brand" />
                <StatCard icon={<Activity />} label="Activas ahora" value={activeSessions} tone="success" />
                <StatCard icon={<Ban />} label="Bloqueadas" value={blockedSessions} tone="danger" />
            </div>

            <Card className="w-full">
                <div className="px-6 pt-5 pb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-slate-100">
                    <div>
                        <h2 className="text-base font-semibold text-slate-900">
                            Reporte de sesiones
                        </h2>
                        <p className="text-sm text-slate-500 mt-0.5">
                            {filteredSessions.length} {filteredSessions.length === 1 ? "resultado" : "resultados"}
                        </p>
                    </div>
                    <div className="relative">
                        <Search className="absolute top-1/2 -translate-y-1/2 left-3 h-4 w-4 text-slate-400 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Buscar por nombre, email, IP o Ref..."
                            value={searchTerm}
                            onChange={(e) => {
                                setSearchTerm(e.target.value);
                                setCurrentPage(1);
                            }}
                            className={cn(
                                "h-9 pl-9 pr-3 w-72 rounded-lg text-sm bg-white",
                                "border border-slate-200 text-slate-900 placeholder:text-slate-400",
                                "focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20",
                                "transition-colors"
                            )}
                        />
                    </div>
                </div>

                <div className="px-6 py-3 flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mr-2">Estado</span>
                    <FilterChip active={statusFilter.includes("activa")} onClick={() => toggleStatus("activa")}>Activa</FilterChip>
                    <FilterChip active={statusFilter.includes("inactiva")} onClick={() => toggleStatus("inactiva")}>Inactiva</FilterChip>
                    <FilterChip active={statusFilter.includes("expirada")} onClick={() => toggleStatus("expirada")}>Expirada</FilterChip>
                    <FilterChip active={statusFilter.includes("bloqueada")} onClick={() => toggleStatus("bloqueada")}>Bloqueada</FilterChip>
                    {statusFilter.length > 0 && (
                        <button type="button" onClick={() => { setStatusFilter([]); setCurrentPage(1); }} className="ml-auto text-xs font-medium text-slate-500 hover:text-rose-600 transition-colors">
                            Limpiar filtros
                        </button>
                    )}
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-slate-50/40">
                            <tr className="border-b border-slate-200">
                                <SortableTh sortKey="display_name" label="Usuario" />
                                <SortableTh sortKey="reference" label="Referencia" align="center" />
                                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 text-center">Productos</th>
                                <SortableTh sortKey="ip_address" label="IP" align="center" />
                                <SortableTh sortKey="issued_at" label="Inicio" align="left" />
                                <SortableTh sortKey="diff_seconds" label="Duracion" align="center" />
                                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 text-center">Estado</th>
                                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading ? (
                                <tr>
                                    <td colSpan={8} className="py-16">
                                        <div className="flex flex-col items-center justify-center gap-3">
                                            <div className="h-10 w-10 rounded-full border-2 border-brand-200 border-t-brand-600 animate-spin" />
                                            <p className="text-sm text-slate-500 font-medium">Cargando datos cruzados...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredSessions.length === 0 ? (
                                <tr>
                                    <td colSpan={8}>
                                        <EmptyState
                                            icon={<SearchX />}
                                            title="No hay sesiones"
                                            description={searchTerm || statusFilter.length > 0 ? "Ajusta los filtros para ver mas resultados." : "Aun no se han registrado sesiones."}
                                        />
                                    </td>
                                </tr>
                            ) : (
                                paginatedSessions.map((session, idx) => (
                                    <Fragment key={session.session_id ?? `${idx}-${session.user_id}`}>
                                    <tr className="hover:bg-slate-50/60 transition-colors">
                                        {/* USUARIO */}
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <Avatar name={session.display_name || session.email} size="sm" />
                                                <div className="min-w-0">
                                                    <p className="text-sm font-semibold text-slate-900 truncate uppercase tracking-wide">
                                                        {session.display_name?.toUpperCase() || "-"}
                                                    </p>
                                                    <p className="text-xs text-slate-500 truncate lowercase">
                                                        {session.email?.toLowerCase()}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>

                                        {/* REFERENCIA */}
                                        <td className="px-4 py-3 text-center text-sm text-slate-500 uppercase tracking-wide">
                                            {session.reference ? session.reference.toUpperCase() : "-"}
                                        </td>

                                        {/* PRODUCTOS (Span con inicial) */}
                                        <td className="px-4 py-3 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                {session.products && session.products.length > 0 ? (
                                                    session.products.map((p: any, i: number) => {
                                                        const prodName = typeof p === 'string' ? p : (p.name || '');
                                                        if (!prodName) return null;
                                                        return (
                                                            <span
                                                                key={i}
                                                                className="inline-flex h-6 w-6 items-center justify-center rounded bg-slate-100 border border-slate-200 text-[10px] font-bold text-slate-600 uppercase"
                                                                title={prodName}
                                                            >
                                                                {prodName.charAt(0).toUpperCase()}
                                                            </span>
                                                        );
                                                    })
                                                ) : (
                                                    <span className="text-xs text-slate-400">-</span>
                                                )}
                                            </div>
                                        </td>

                                        {/* IP */}
                                        <td className="px-4 py-3 text-center">
                                            <span className="inline-flex items-center justify-center gap-1.5 text-xs text-slate-600 font-mono tabular-nums">
                                                <Globe className="h-3 w-3 text-slate-400" />
                                                {session.ip_address || "-"}
                                            </span>
                                        </td>

                                        {/* INICIO */}
                                        <td className="px-4 py-3 text-left text-sm text-slate-600 tabular-nums lowercase">
                                            {formatDatetimeReadable(session.issued_at).toLowerCase()}
                                        </td>

                                        {/* DURACION */}
                                        <td className="px-4 py-3 text-center text-sm text-slate-700 tabular-nums font-medium">
                                            {session.is_active ? "en proceso..." : session.is_blocked ? "-" : formatTime(session.diff_seconds)}
                                        </td>

                                        {/* ESTADO */}
                                        <td className="px-4 py-3 text-center">
                                            {session.status === "Expired_Idle" ? (
                                                <Badge variant="warning" dot size="sm" className="uppercase text-[10px] tracking-wide">EXPIRADA</Badge>
                                            ) : session.is_active ? (
                                                <Badge variant="success" dot size="sm" className="uppercase text-[10px] tracking-wide">ACTIVA</Badge>
                                            ) : session.is_blocked ? (
                                                <Badge variant="danger" dot size="sm" className="uppercase text-[10px] tracking-wide">BLOQUEADA</Badge>
                                            ) : (
                                                <Badge variant="warning" dot size="sm" className="uppercase text-[10px] tracking-wide">INACTIVA</Badge>
                                            )}
                                        </td>

                                        {/* ACCIONES */}
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <IconButton aria-label="Ver usuario" size="sm" onClick={() => navigate(`/users/${session.user_id}`)}>
                                                    <Eye className="w-4 h-4 text-slate-400 hover:text-brand-600" />
                                                </IconButton>
                                                {session.session_id && (
                                                    <IconButton aria-label="Ver actividad" size="sm" onClick={() => loadSessionDetail(session.session_id)}>
                                                        <Activity className={cn("w-4 h-4", expandedSessionId === session.session_id ? "text-brand-600" : "text-slate-400 hover:text-brand-600")} />
                                                    </IconButton>
                                                )}
                                                {session.status === "Active" && (
                                                <IconButton aria-label="Cerrar sesión" size="sm" onClick={() => handleCloseSession((session as any).session_id || session.user_id)}>
                                                    <LogOut className="w-4 h-4 text-slate-400 hover:text-rose-600" />
                                                </IconButton>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                    {expandedSessionId === session.session_id && (
                                        <tr>
                                            <td colSpan={8} className="bg-slate-50/70 px-4 py-4">
                                                {detailLoading ? (
                                                    <div className="flex items-center justify-center gap-3 rounded-lg border border-slate-100 bg-white py-8 text-sm font-medium text-slate-500">
                                                        <div className="h-5 w-5 rounded-full border-2 border-brand-200 border-t-brand-600 animate-spin" />
                                                        Cargando actividad...
                                                    </div>
                                                ) : sessionDetail ? (
                                                    <SessionActivityCard detail={sessionDetail} />
                                                ) : (
                                                    <div className="rounded-lg border border-rose-100 bg-white px-4 py-3 text-sm text-rose-600">
                                                        No se pudo cargar el detalle de actividad.
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    )}
                                    </Fragment>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Paginacion */}
                {!loading && filteredSessions.length > 0 && totalPages > 1 && (
                    <div className="px-6 py-4 flex items-center justify-between border-t border-slate-100">
                        <p className="text-xs text-slate-500">
                            Pagina <span className="font-semibold text-slate-700">{currentPage}</span> de <span className="font-semibold text-slate-700">{totalPages}</span>
                        </p>
                        <div className="flex items-center gap-1">
                            <IconButton aria-label="Pagina anterior" size="sm" onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))} disabled={currentPage === 1}>
                                <ChevronLeft />
                            </IconButton>
                            {paginationRange.map((page, idx) => {
                                if (page === "...") {
                                    return <span key={`ellipsis-${idx}`} className="px-2 text-sm text-slate-400">...</span>;
                                }
                                const isActive = currentPage === page;
                                return (
                                    <button
                                        key={page}
                                        onClick={() => setCurrentPage(Number(page))}
                                        className={cn("h-8 min-w-[2rem] px-2 rounded-lg text-sm font-medium transition-colors", isActive ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100")}
                                    >
                                        {page}
                                    </button>
                                );
                            })}
                            <IconButton aria-label="Pagina siguiente" size="sm" onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))} disabled={currentPage === totalPages}>
                                <ChevronRight />
                            </IconButton>
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
};

export default SessionsAdmin;
