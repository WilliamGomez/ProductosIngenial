import {
    Users,
    Search,
    Edit2,
    UserRoundCheck,
    UserRoundMinus,
    Plus,
    ChevronLeft,
    ChevronRight,
    Eye,
    UserSearch,
    Trash2,
    AlertTriangle,
    KeyRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccessToken } from "../hooks/useAccessToken";
import type { IUser } from "../interfaces/IUser";
import { deleteUser, getUsers, resetUserMfa } from "../services/api";
import {
    Avatar,
    Badge,
    Button,
    Card,
    EmptyState,
    IconButton,
    PageHeader,
    StatCard,
} from "../components/ui";
import { Spinner } from "../components/ui/Spinner";
import { useSession } from "../context/SessionContext";
import { useTableSort } from "../hooks/useTableSort";
import { cn } from "../lib/cn";

/**
 * UsersAdmin — listado y gestión de usuarios.
 *
 * Esta vista mantiene EXACTAMENTE la misma lógica que la versión legacy:
 *   · `getUsers(token)` para cargar.
 *   · `useTableSort` para ordenar columnas.
 *   · Filtros por rol/persona/estado en memoria.
 *   · Paginación cliente (20 usuarios/pág).
 *   · Modales de Registrar/Actualizar.
 *
 * Cambios visuales (sin tocar lógica):
 *   · StatCards con paleta brand para los KPIs (en lugar de orange tinted divs).
 *   · Tabla en Card con header dedicado para search + nuevo + filtros.
 *   · Badges de estado en variantes success/danger en vez de bg+text manual.
 *   · Avatar circular con iniciales por fila — mejora densidad visual.
 *   · IconButton ghost para acciones (Eye → detail, Edit2 → modal).
 *   · EmptyState elegante en lugar del "No se encontraron usuarios." plano.
 */

const getUserSortValue = (user: IUser, key: string): any => {
    switch (key) {
        case "display_name":
            return user.display_name;
        case "role":
            return user.role;
        case "email":
            return user.email;
        case "reference":
            return user.reference || "";
        case "reference2":
            return user.reference2 || "";
        case "product_name":
            return user.products?.[0]?.name || "";
        case "expiration":
            return user.products?.[0]?.expiration || "9999-12-31";
        case "enable":
            return user.enable;
        default:
            return "";
    }
};

const UsersAdmin = () => {
    const { getToken } = useAccessToken();
    const navigate = useNavigate();

    const [currentPage, setCurrentPage] = useState(1);
    const usersPerPage = 20;

    const [users, setUsers] = useState<IUser[]>([]);
    const [searchTerm, setSearchTerm] = useState("");

    const [totalUsers, setTotalUsers] = useState(0);
    const [activeUsers, setActiveUsers] = useState(0);
    const [inactiveUsers, setInactiveUsers] = useState(0);

    const [roleFilter, setRoleFilter] = useState<string[]>([]);
    const [personFilter, setPersonFilter] = useState<string[]>([]);
    const [statusFilter, setStatusFilter] = useState<string[]>([]);

    const [loading, setLoading] = useState(true);

    const { sessionToken, deviceId, user: currentUser } = useSession();
    const [userToDelete, setUserToDelete] = useState<IUser | null>(null);
    const [deleteError, setDeleteError] = useState("");
    const [isDeleting, setIsDeleting] = useState(false);
    const [resettingMfaUserId, setResettingMfaUserId] = useState<string | null>(null);

    useEffect(() => {
        getUsersList();
    }, []);

    const formatDatetimeReadable = (input: string): string => {
        if (!input) return "";
        const date = new Date(input.replace(" ", "T"));
        if (isNaN(date.getTime())) return "Fecha inválida";

        const day = date.getDate();
        const month = date.toLocaleString("es-ES", { month: "long" });
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");

        return `${day} ${month} ${year}, ${hours}:${minutes}`;
    };

    const getUsersList = async () => {
        setLoading(true);
        try {
            const token = await getToken();
            const data = await getUsers(token);
            const safeData = Array.isArray(data) ? data : [];

            setUsers(safeData);
            setTotalUsers(safeData.length);
            setActiveUsers(safeData.filter((u) => u.enable).length);
            setInactiveUsers(safeData.filter((u) => !u.enable).length);
        } catch (error) {
            console.error("Error al obtener usuarios:", error);
            setUsers([]);
            setTotalUsers(0);
            setActiveUsers(0);
            setInactiveUsers(0);
        } finally {
            setLoading(false);
        }
    };

    const confirmDeleteUser = async () => {
        if (!userToDelete?.id) return;
        setIsDeleting(true);
        setDeleteError("");
        try {
            const token = await getToken();
            await deleteUser(token, userToDelete.id);
            setUserToDelete(null);
            await getUsersList();
        } catch (error) {
            console.error("Error al eliminar usuario:", error);
            setDeleteError("No se pudo eliminar el usuario. Revisa si tiene dependencias activas o intenta de nuevo.");
        } finally {
            setIsDeleting(false);
        }
    };

    const handleResetMfa = async (targetUser: IUser) => {
        if (!window.confirm(`Restablecer MFA para ${targetUser.display_name || targetUser.email}? El usuario tendra que configurarlo de nuevo al ingresar.`)) {
            return;
        }
        setResettingMfaUserId(targetUser.id);
        try {
            const token = await getToken();
            await resetUserMfa(token, targetUser.id);
            await getUsersList();
        } catch (error) {
            console.error("Error al restablecer MFA:", error);
            alert("No se pudo restablecer el MFA del usuario.");
        } finally {
            setResettingMfaUserId(null);
        }
    };

    const getPaginationRange = (
        current: number,
        total: number,
        delta = 1
    ): (number | string)[] => {
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

    // -------- helpers de filtros (toggles) ----------------------------------
    const toggleFilter = (
        setter: React.Dispatch<React.SetStateAction<string[]>>,
        value: string
    ) => {
        setter((prev) =>
            prev.includes(value)
                ? prev.filter((v) => v !== value)
                : [...prev, value]
        );
        setCurrentPage(1);
    };

    const safeUsers = Array.isArray(users) ? users : [];

    const filteredUsers = safeUsers.filter((user) => {
        const lower = searchTerm.toLowerCase();
        const matchesSearch =
            user.name?.toLowerCase().includes(lower) ||
            user.display_name?.toLowerCase().includes(lower) ||
            user.email?.toLowerCase().includes(lower) ||
            user.phone?.toLowerCase().includes(lower);

        const matchesRole =
            roleFilter.length === 0 ||
            roleFilter.includes(user.role?.toLowerCase());
        const matchesPerson =
            personFilter.length === 0 ||
            personFilter.includes((user.type_person ?? "").toLowerCase());
        const matchesStatus =
            statusFilter.length === 0 ||
            (user.enable && statusFilter.includes("activo")) ||
            (!user.enable && statusFilter.includes("inactivo"));

        return matchesSearch && matchesRole && matchesStatus && matchesPerson;
    });

    const { sortedData, sortConfig, requestSort, getSortIcon } = useTableSort(
        filteredUsers,
        { key: "display_name", direction: "asc" },
        getUserSortValue,
        () => setCurrentPage(1)
    );

    const totalPages = Math.ceil(sortedData.length / usersPerPage);
    const paginatedUsers = sortedData.slice(
        (currentPage - 1) * usersPerPage,
        currentPage * usersPerPage
    );
    const paginationRange = getPaginationRange(currentPage, totalPages);

    const totalActiveFilters =
        roleFilter.length + personFilter.length + statusFilter.length;

    // ------------------------------------------------------------------------
    // Sub-componentes locales para sortable header (DRY)
    // ------------------------------------------------------------------------
    const SortableTh = ({
        sortKey,
        label,
        align = "left",
    }: {
        sortKey: string;
        label: string;
        align?: "left" | "center" | "right";
    }) => {
        const active = sortConfig?.key === sortKey;
        return (
            <th
                scope="col"
                onClick={() => requestSort(sortKey)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        requestSort(sortKey);
                    }
                }}
                tabIndex={0}
                className={cn(
                    "px-3 py-2 text-[11px] font-semibold uppercase tracking-wider cursor-pointer select-none",
                    "text-slate-500 hover:text-brand-600 transition-colors",
                    active && "text-brand-600",
                    align === "center" && "text-center",
                    align === "right" && "text-right"
                )}
            >
                <span
                    className={cn(
                        "inline-flex items-center gap-1",
                        align === "center" && "justify-center",
                        align === "right" && "justify-end"
                    )}
                >
                    {label}
                    {getSortIcon(sortKey)}
                </span>
            </th>
        );
    };

    if (!sessionToken || !deviceId) {
        return <Spinner />;
    }

    return (
        <div className="space-y-6">
            {/* ======================== Page header =========================== */}
            <PageHeader
                eyebrow="Administración"
                title="Usuarios"
                description="Gestiona cuentas, productos asignados y vigencia."
                actions={
                    <Button
                        leftIcon={<Plus />}
                        onClick={() => navigate("/users/new")}
                    >
                        Nuevo usuario
                    </Button>
                }
            />

            {/* ======================== KPI cards ============================ */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard
                    icon={<Users />}
                    label="Usuarios totales"
                    value={totalUsers}
                    tone="brand"
                />
                <StatCard
                    icon={<UserRoundCheck />}
                    label="Activos"
                    value={activeUsers}
                    helpText={
                        totalUsers > 0
                            ? `${Math.round(
                                  (activeUsers / totalUsers) * 100
                              )}% del total`
                            : undefined
                    }
                    tone="success"
                />
                <StatCard
                    icon={<UserRoundMinus />}
                    label="Inactivos"
                    value={inactiveUsers}
                    helpText={
                        totalUsers > 0
                            ? `${Math.round(
                                  (inactiveUsers / totalUsers) * 100
                              )}% del total`
                            : undefined
                    }
                    tone="danger"
                />
            </div>

            {/* ======================== Datatable card ======================== */}
            <Card>
                {/* Toolbar — search + filters */}
                <div className="px-6 pt-5 pb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-slate-100">
                    <div>
                        <h2 className="text-base font-semibold text-slate-900">
                            Reporte de Usuarios
                        </h2>
                        <p className="text-sm text-slate-500 mt-0.5">
                            {filteredUsers.length}{" "}
                            {filteredUsers.length === 1
                                ? "resultado"
                                : "resultados"}
                            {totalActiveFilters > 0 && (
                                <>
                                    {" "}
                                    · {totalActiveFilters} filtro
                                    {totalActiveFilters !== 1 ? "s" : ""} activo
                                    {totalActiveFilters !== 1 ? "s" : ""}
                                </>
                            )}
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute top-1/2 -translate-y-1/2 left-3 h-4 w-4 text-slate-400 pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Buscar por nombre, email o teléfono…"
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
                </div>

                {/* Filter chips row */}
                <div className="px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-slate-100 bg-slate-50/60">
                    <FilterGroup label="Rol">
                        <FilterChip
                            active={roleFilter.includes("admin")}
                            onClick={() => toggleFilter(setRoleFilter, "admin")}
                        >
                            Administrador
                        </FilterChip>
                        <FilterChip
                            active={roleFilter.includes("user")}
                            onClick={() => toggleFilter(setRoleFilter, "user")}
                        >
                            Cliente
                        </FilterChip>
                    </FilterGroup>

                    <FilterGroup label="Estado">
                        <FilterChip
                            active={statusFilter.includes("activo")}
                            onClick={() =>
                                toggleFilter(setStatusFilter, "activo")
                            }
                        >
                            Activo
                        </FilterChip>
                        <FilterChip
                            active={statusFilter.includes("inactivo")}
                            onClick={() =>
                                toggleFilter(setStatusFilter, "inactivo")
                            }
                        >
                            Inactivo
                        </FilterChip>
                    </FilterGroup>

                    <FilterGroup label="Tipo de persona">
                        <FilterChip
                            active={personFilter.includes("persona natural")}
                            onClick={() =>
                                toggleFilter(setPersonFilter, "persona natural")
                            }
                        >
                            Natural
                        </FilterChip>
                        <FilterChip
                            active={personFilter.includes("persona jurídica")}
                            onClick={() =>
                                toggleFilter(
                                    setPersonFilter,
                                    "persona jurídica"
                                )
                            }
                        >
                            Jurídica
                        </FilterChip>
                    </FilterGroup>

                    {totalActiveFilters > 0 && (
                        <button
                            type="button"
                            onClick={() => {
                                setRoleFilter([]);
                                setStatusFilter([]);
                                setPersonFilter([]);
                                setCurrentPage(1);
                            }}
                            className="ml-auto text-xs font-medium text-slate-500 hover:text-rose-600 transition-colors"
                        >
                            Limpiar filtros
                        </button>
                    )}
                </div>

                {/* Tanto la creación como la edición de usuarios viven ahora
                    en la misma página (`/users/new` / `/users/edit/:id`).
                    Los modales que vivían aquí fueron eliminados — la
                    navegación pasa por `react-router` exclusivamente. */}

                {/* ======================== Tabla ================================ */}
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-slate-50/40">
                            <tr className="border-b border-slate-200">
                                <SortableTh
                                    sortKey="display_name"
                                    label="Usuario"
                                />
                                <SortableTh
                                    sortKey="role"
                                    label="Rol"
                                    align="center"
                                />
                                <SortableTh
                                    sortKey="reference"
                                    label="Referencia"
                                    align="center"
                                />
                                <SortableTh
                                    sortKey="reference2"
                                    label="Referencia 2"
                                    align="center"
                                />
                                <SortableTh
                                    sortKey="product_name"
                                    label="Producto"
                                    align="center"
                                />
                                <SortableTh
                                    sortKey="expiration"
                                    label="Vencimiento"
                                />
                                <SortableTh
                                    sortKey="enable"
                                    label="Estado"
                                    align="center"
                                />
                                <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 text-right">
                                    Acciones
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading ? (
                                <tr>
                                    <td colSpan={8} className="py-16">
                                        <div className="flex flex-col items-center justify-center gap-3">
                                            <div className="h-10 w-10 rounded-full border-2 border-brand-200 border-t-brand-600 animate-spin" />
                                            <p className="text-sm text-slate-500 font-medium">
                                                Cargando usuarios…
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredUsers.length === 0 ? (
                                <tr>
                                    <td colSpan={8}>
                                        <EmptyState
                                            icon={<UserSearch />}
                                            title="No se encontraron usuarios"
                                            description={
                                                searchTerm ||
                                                totalActiveFilters > 0
                                                    ? "Prueba ajustando los filtros o el término de búsqueda."
                                                    : "Aún no hay usuarios registrados. Crea el primero para empezar."
                                            }
                                            action={
                                                searchTerm ||
                                                totalActiveFilters > 0 ? (
                                                    <Button
                                                        variant="secondary"
                                                        onClick={() => {
                                                            setSearchTerm("");
                                                            setRoleFilter([]);
                                                            setStatusFilter([]);
                                                            setPersonFilter([]);
                                                            setCurrentPage(1);
                                                        }}
                                                    >
                                                        Limpiar todo
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        leftIcon={<Plus />}
                                                        onClick={() =>
                                                            navigate(
                                                                "/users/new"
                                                            )
                                                        }
                                                    >
                                                        Nuevo usuario
                                                    </Button>
                                                )
                                            }
                                        />
                                    </td>
                                </tr>
                            ) : (
                                paginatedUsers.map((user, userIndex) => {
                                    // Si el usuario no tiene productos, una sola fila.
                                    if (
                                        !user.products ||
                                        user.products.length === 0
                                    ) {
                                        return (
                                            <tr
                                                key={`user-${userIndex}`}
                                                className="hover:bg-slate-50/60 transition-colors"
                                            >
                                                <td className="px-3 py-2">
                                                    <UserCell user={user} />
                                                </td>
                                                <td className="px-3 py-2 text-center">
                                                    <RoleBadge
                                                        role={user.role}
                                                    />
                                                </td>
                                                <td className="px-3 py-2 text-sm text-slate-700 uppercase tracking-wide text-center truncate max-w-[180px]">
                                                    {user.reference ? (
                                                        user.reference.toUpperCase()
                                                    ) : (
                                                        <span className="text-slate-300">
                                                            —
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 text-sm text-slate-700 uppercase tracking-wide text-center truncate max-w-[180px]">
                                                    {user.reference2 ? (
                                                        user.reference2.toUpperCase()
                                                    ) : (
                                                        <span className="text-slate-300">
                                                            —
                                                        </span>
                                                    )}
                                                </td>
                                                <td
                                                    className="px-3 py-2 text-slate-400 italic"
                                                    colSpan={2}
                                                >
                                                    Sin productos asignados
                                                </td>
                                                <td className="px-3 py-2 text-center">
                                                    <StatusBadge
                                                        enable={user.enable}
                                                    />
                                                </td>
                                                <td className="px-3 py-2">
                                                    <UserActions
                                                        user={user}
                                                        currentUserId={currentUser?.id}
                                                        onView={() =>
                                                            navigate(
                                                                `/users/${user.id}`
                                                            )
                                                        }
                                                        onEdit={() =>
                                                            navigate(
                                                                `/users/edit/${user.id}`
                                                            )
                                                        }
                                                        onDelete={() => {
                                                            setDeleteError("");
                                                            setUserToDelete(user);
                                                        }}
                                                        onResetMfa={() => handleResetMfa(user)}
                                                        isResettingMfa={resettingMfaUserId === user.id}
                                                    />
                                                </td>
                                            </tr>
                                        );
                                    }

                                    // Si tiene productos, una fila por producto con rowSpan en columnas user-level.
                                    return user.products.map(
                                        (producto, productIndex) => (
                                            <tr
                                                key={`${userIndex}-${productIndex}`}
                                                className={cn(
                                                    "hover:bg-slate-50/60 transition-colors",
                                                    productIndex === 0 &&
                                                        userIndex !== 0 &&
                                                        "border-t-2 border-slate-200"
                                                )}
                                            >
                                                {productIndex === 0 && (
                                                    <td
                                                        rowSpan={
                                                            user.products.length
                                                        }
                                                        className="px-3 py-2 align-middle"
                                                    >
                                                        <UserCell user={user} />
                                                    </td>
                                                )}
                                                {productIndex === 0 && (
                                                    <td
                                                        rowSpan={
                                                            user.products.length
                                                        }
                                                        className="px-3 py-2 text-center align-middle"
                                                    >
                                                        <RoleBadge
                                                            role={user.role}
                                                        />
                                                    </td>
                                                )}
                                                {productIndex === 0 && (
                                                    <td
                                                        rowSpan={
                                                            user.products.length
                                                        }
                                                        className="px-3 py-2 text-sm text-slate-700 uppercase tracking-wide text-center align-middle truncate max-w-[180px]"
                                                    >
                                                        {user.reference ? (
                                                            user.reference.toUpperCase()
                                                        ) : (
                                                            <span className="text-slate-300">
                                                                —
                                                            </span>
                                                        )}
                                                    </td>
                                                )}
                                                {productIndex === 0 && (
                                                    <td
                                                        rowSpan={
                                                            user.products.length
                                                        }
                                                        className="px-3 py-2 text-sm text-slate-700 uppercase tracking-wide text-center align-middle truncate max-w-[180px]"
                                                    >
                                                        {user.reference2 ? (
                                                            user.reference2.toUpperCase()
                                                        ) : (
                                                            <span className="text-slate-300">
                                                                —
                                                            </span>
                                                        )}
                                                    </td>
                                                )}
                                                <td
                                                    className={cn(
                                                        "px-3 py-2 text-center text-sm text-slate-700 uppercase tracking-wide",
                                                        !producto.enable &&
                                                            "opacity-50"
                                                    )}
                                                >
                                                    <span className="inline-flex items-center gap-2">
                                                        {producto.name?.toUpperCase()}
                                                        {!producto.enable && (
                                                            <Badge
                                                                variant="danger"
                                                                size="sm"
                                                            >
                                                                OFF
                                                            </Badge>
                                                        )}
                                                    </span>
                                                </td>
                                                <td
                                                    className={cn(
                                                        "px-3 py-2 text-left text-sm text-slate-600 lowercase tabular-nums",
                                                        !producto.enable &&
                                                            "opacity-50"
                                                    )}
                                                >
                                                    {producto.enable && producto.expiration
                                                        ? formatDatetimeReadable(
                                                              producto.expiration
                                                          ).toLowerCase()
                                                        : "—"}
                                                </td>
                                                {productIndex === 0 && (
                                                    <td
                                                        rowSpan={
                                                            user.products.length
                                                        }
                                                        className="px-3 py-2 text-center align-middle"
                                                    >
                                                        <StatusBadge
                                                            enable={user.enable}
                                                        />
                                                    </td>
                                                )}
                                                {productIndex === 0 && (
                                                    <td
                                                        rowSpan={
                                                            user.products.length
                                                        }
                                                        className="px-3 py-2 align-middle"
                                                    >
                                                        <UserActions
                                                            user={user}
                                                            currentUserId={currentUser?.id}
                                                            onView={() =>
                                                                navigate(
                                                                    `/users/${user.id}`
                                                                )
                                                            }
                                                            onEdit={() =>
                                                                navigate(
                                                                    `/users/edit/${user.id}`
                                                                )
                                                            }
                                                            onDelete={() => {
                                                                setDeleteError("");
                                                                setUserToDelete(user);
                                                            }}
                                                            onResetMfa={() => handleResetMfa(user)}
                                                            isResettingMfa={resettingMfaUserId === user.id}
                                                        />
                                                    </td>
                                                )}
                                            </tr>
                                        )
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* ======================== Paginación =========================== */}
                {!loading && filteredUsers.length > 0 && totalPages > 1 && (
                    <div className="px-6 py-4 flex items-center justify-between border-t border-slate-100">
                        <p className="text-xs text-slate-500">
                            Página{" "}
                            <span className="font-semibold text-slate-700">
                                {currentPage}
                            </span>{" "}
                            de{" "}
                            <span className="font-semibold text-slate-700">
                                {totalPages}
                            </span>
                        </p>
                        <div className="flex items-center gap-1">
                            <IconButton
                                aria-label="Página anterior"
                                size="sm"
                                onClick={() =>
                                    setCurrentPage((p) => Math.max(p - 1, 1))
                                }
                                disabled={currentPage === 1}
                            >
                                <ChevronLeft />
                            </IconButton>
                            {paginationRange.map((page, index) => {
                                if (page === "...") {
                                    return (
                                        <span
                                            key={`ellipsis-${index}`}
                                            className="px-2 text-sm text-slate-400"
                                        >
                                            …
                                        </span>
                                    );
                                }
                                const isActive = currentPage === page;
                                return (
                                    <button
                                        key={page}
                                        onClick={() =>
                                            setCurrentPage(Number(page))
                                        }
                                        className={cn(
                                            "h-8 min-w-[2rem] px-2 rounded-lg text-sm font-medium transition-colors",
                                            isActive
                                                ? "bg-brand-600 text-white shadow-sm"
                                                : "text-slate-600 hover:bg-slate-100"
                                        )}
                                    >
                                        {page}
                                    </button>
                                );
                            })}
                            <IconButton
                                aria-label="Página siguiente"
                                size="sm"
                                onClick={() =>
                                    setCurrentPage((p) =>
                                        Math.min(p + 1, totalPages)
                                    )
                                }
                                disabled={currentPage === totalPages}
                            >
                                <ChevronRight />
                            </IconButton>
                        </div>
                    </div>
                )}
            </Card>

            {userToDelete && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-sm">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="delete-user-title"
                        className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"
                    >
                        <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                                <AlertTriangle className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                                <h3 id="delete-user-title" className="text-base font-semibold text-slate-900">
                                    Eliminar usuario
                                </h3>
                                <p className="mt-1 text-sm text-slate-600">
                                    Esta acción eliminará a{" "}
                                    <span className="font-semibold text-slate-900">
                                        {userToDelete.display_name || userToDelete.email}
                                    </span>{" "}
                                    y limpiará sus productos, zonas y sesiones asociadas.
                                </p>
                            </div>
                        </div>
                        {deleteError && (
                            <div className="mt-4 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                                {deleteError}
                            </div>
                        )}
                        <div className="mt-6 flex justify-end gap-2">
                            <Button
                                variant="secondary"
                                disabled={isDeleting}
                                onClick={() => {
                                    setUserToDelete(null);
                                    setDeleteError("");
                                }}
                            >
                                Cancelar
                            </Button>
                            <Button
                                variant="danger"
                                leftIcon={<Trash2 />}
                                disabled={isDeleting}
                                onClick={confirmDeleteUser}
                            >
                                {isDeleting ? "Eliminando..." : "Eliminar"}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UsersAdmin;

// =============================================================================
// Sub-componentes locales — viven aquí porque sólo se usan en esta página y
// agruparlos hace el JSX principal mucho más legible.
// =============================================================================

/** Celda compuesta: avatar + nombre + email. Reemplaza 3 columnas separadas.
 *  Convención de formato: nombre en MAYÚSCULAS, email en minúsculas. */
const UserCell = ({ user }: { user: IUser }) => (
    <div className="flex items-center gap-3 min-w-0">
        <Avatar name={user.display_name || user.email} size="sm" />
        <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate uppercase tracking-wide">
                {user.display_name?.toUpperCase() || "—"}
            </p>
            <p className="text-xs text-slate-500 truncate lowercase">
                {user.email?.toLowerCase()}
            </p>
        </div>
    </div>
);

/** Badge específico para rol — Admin/User → variantes consistentes.
 *  Convención de formato: contenido en MAYÚSCULAS. */
const RoleBadge = ({ role }: { role: string }) => {
    if (!role) return <span className="text-slate-400 text-sm">—</span>;
    const isAdmin = role.toLowerCase() === "admin";
    return (
        <Badge
            variant={isAdmin ? "info" : "neutral"}
            size="sm"
            className="uppercase tracking-wide"
        >
            {role.toUpperCase()}
        </Badge>
    );
};

/** Badge específico para estado activo/inactivo — alineado a colores Tabler.
 *  Convención de formato: contenido en MAYÚSCULAS. */
const StatusBadge = ({ enable }: { enable: boolean }) => (
    <Badge
        variant={enable ? "success" : "danger"}
        dot
        size="sm"
        className="uppercase tracking-wide"
    >
        {enable ? "ACTIVO" : "INACTIVO"}
    </Badge>
);

/** Botones de acción para una fila de tabla. Eye → detail, Edit → modal. */
const UserActions = ({
    user,
    currentUserId,
    onView,
    onEdit,
    onDelete,
    onResetMfa,
    isResettingMfa,
}: {
    user: IUser;
    currentUserId?: string;
    onView: () => void;
    onEdit: () => void;
    onDelete: () => void;
    onResetMfa: () => void;
    isResettingMfa: boolean;
}) => {
    const isSelf = Boolean(currentUserId && user.id === currentUserId);
    return (
        <div className="flex items-center justify-end gap-1">
            <IconButton
                aria-label="Ver detalle del usuario"
                size="sm"
                onClick={onView}
            >
                <Eye />
            </IconButton>
            <IconButton aria-label="Editar usuario" size="sm" onClick={onEdit}>
                <Edit2 />
            </IconButton>
            <IconButton
                aria-label="Restablecer MFA"
                title="Restablecer MFA"
                size="sm"
                disabled={isResettingMfa}
                onClick={onResetMfa}
            >
                <KeyRound />
            </IconButton>
            <IconButton
                aria-label={isSelf ? "No puedes eliminar tu propio usuario" : "Eliminar usuario"}
                title={isSelf ? "No puedes eliminar tu propio usuario activo" : "Eliminar usuario"}
                size="sm"
                variant="danger"
                disabled={isSelf}
                onClick={onDelete}
            >
                <Trash2 />
            </IconButton>
        </div>
    );
};

/** Grupo de chips de filtro — label encima, chips clickables. */
const FilterGroup = ({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) => (
    <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {label}
        </span>
        <div className="flex items-center gap-1.5">{children}</div>
    </div>
);

/** Chip toggleable — bg slate cuando inactivo, bg brand cuando activo. */
const FilterChip = ({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) => (
    <button
        type="button"
        onClick={onClick}
        className={cn(
            "h-7 px-3 rounded-full text-xs font-medium transition-colors",
            active
                ? "bg-brand-600 text-white shadow-sm"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
        )}
    >
        {children}
    </button>
);

// Modal helper eliminado — la creación/edición de usuarios vive ahora en
// páginas dedicadas (`/users/new`, `/users/edit/:id`).
