import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
    ArrowLeft,
    Edit2,
    Mail,
    Phone,
    AtSign,
    IdCard,
    Building2,
    Package,
    Calendar,
    MapPin,
    AlertCircle,
    CheckCircle2,
    Clock,
    UserCircle2,
    Hash,
    BadgeCheck,
    ShieldCheck,
} from "lucide-react";
import { useAccessToken } from "../hooks/useAccessToken";
import { getDepartments, getMunicipalities, getUser } from "../services/api";
import type { IUser } from "../interfaces/IUser";
import type { IProduct } from "../interfaces/IProduct";
import type { IDepartment } from "../interfaces/IDepartments";
import type { IMunicipio } from "../interfaces/IMunicipio";
import GeographicAssignmentCard from "../components/GeographicAssignmentCard";
import {
    Avatar,
    Badge,
    Button,
    Card,
    CardBody,
    CardHeader,
    CardTitle,
    EmptyState,
} from "../components/ui";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "../lib/cn";

/**
 * UserDetail — perfil completo de un usuario (`/users/:id`).
 *
 * Datos cargados via `getUser(token, id)` — misma firma que ya usa la app.
 * Sólo Admin debería poder llegar aquí; el gating se hace en AppRouter, no
 * en esta página. Si alguien navega manualmente y no tiene permisos, el
 * backend devolverá 401/403 y caemos al estado de error.
 *
 * Layout (Social Profile Card):
 * ┌─────────────────────────────────────────────────────────┐
 * │  Hero: avatar prominente centrado                       │
 * │  Nombre · Rol · Estado · Tipo persona                   │
 * ├─────────────────────────────────────────────────────────┤
 * │  Info Personal      │  Contacto                         │
 * ├─────────────────────────────────────────────────────────┤
 * │  Productos asignados (scroll interno)                   │
 * └─────────────────────────────────────────────────────────┘
 *
 * Reglas visuales:
 * · UUID nunca se imprime en texto plano (rutas/peticiones lo conservan).
 * · Card de Productos usa `overflow-hidden` + scroll interno para evitar
 * desbordamientos cuando los productos tienen listas largas de ciudades.
 */

const formatDateLong = (input?: string): string => {
    if (!input) return "—";
    const date = new Date(input.replace(" ", "T"));
    if (isNaN(date.getTime())) return "Fecha inválida";
    return date.toLocaleString("es-ES", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
};

const formatDateShort = (input?: string): string => {
    if (!input) return "—";
    const date = new Date(input.replace(" ", "T"));
    if (isNaN(date.getTime())) return "Fecha inválida";
    return date.toLocaleDateString("es-ES", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
};

/** Deriva un estado del producto basado en `enable` + `expiration`. */
const productStatus = (
    p: IProduct
): { label: string; variant: "success" | "danger" | "warning" } => {
    if (!p.enable) return { label: "Deshabilitado", variant: "danger" };
    if (p.expiration) {
        const exp = new Date(p.expiration.replace(" ", "T")).getTime();
        const now = Date.now();
        if (!isNaN(exp) && exp < now)
            return { label: "Vencido", variant: "warning" };
    }
    return { label: "Activo", variant: "success" };
};

const UserDetail = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { getToken } = useAccessToken();

    const [user, setUser] = useState<IUser | null>(null);
    const [departamentos, setDepartamentos] = useState<IDepartment[]>([]);
    const [municipios, setMunicipios] = useState<IMunicipio[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadUser();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const loadUser = async () => {
        if (!id) {
            setError("ID de usuario inválido");
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const token = await getToken();
            const [data, departmentsData, municipalitiesData] = await Promise.all([
                getUser(token, id),
                getDepartments(token),
                getMunicipalities(token),
            ]);
            setUser(data);
            setDepartamentos(Array.isArray(departmentsData) ? departmentsData : []);
            setMunicipios(Array.isArray(municipalitiesData) ? municipalitiesData : []);
        } catch (err) {
            console.error("Error al cargar usuario:", err);
            setError(
                "No se pudo cargar el usuario. Es posible que no exista o no tengas permisos."
            );
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-20">
                <Spinner />
            </div>
        );
    }

    if (error || !user) {
        return (
            <Card>
                <EmptyState
                    icon={<AlertCircle />}
                    title="Usuario no encontrado"
                    description={
                        error ?? "No pudimos encontrar este usuario."
                    }
                    action={
                        <Button
                            variant="secondary"
                            leftIcon={<ArrowLeft />}
                            onClick={() => navigate("/users")}
                        >
                            Volver a usuarios
                        </Button>
                    }
                />
            </Card>
        );
    }

    // Nombre visible — preferimos display_name; si no existe, parte local del
    // email (todo antes de la @). Nunca mostramos el UUID en texto plano.
    const displayName =
        user.display_name?.trim() ||
        (user.email ? user.email.split("@")[0] : "—");

    return (
        <div className="space-y-6">
            {/* ====================== Back link + acciones ==================== */}
            <div className="flex items-center justify-between gap-4">
                <button
                    type="button"
                    onClick={() => navigate("/users")}
                    className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-brand-600 transition-colors"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Volver a usuarios
                </button>
                <div className="flex items-center gap-2">
                    <Button
                        variant="secondary"
                        leftIcon={<ShieldCheck />}
                        onClick={() =>
                            navigate(`/users/${user.id}/reset-password`)
                        }
                    >
                        Restablecer contraseña
                    </Button>
                    <Button
                        leftIcon={<Edit2 />}
                        onClick={() => navigate(`/users/edit/${user.id}`)}
                    >
                        Editar usuario
                    </Button>
                </div>
            </div>

            {/* ============================ Hero (Social card) =================
                Layout centrado tipo "social profile card":
                  · Banner brand sutil
                  · Avatar prominente (xl) sobresaliendo del banner
                  · Nombre + email + badges centrados
                Las acciones se mantienen arriba (back/edit), no compiten con
                la jerarquía visual del hero. */}
            <Card className="overflow-hidden">
                <div className="h-28 bg-gradient-to-br from-brand-500 via-brand-600 to-brand-700" />
                <CardBody className="-mt-16 pt-0 pb-6">
                    <div className="flex flex-col items-center text-center">
                        <Avatar
                            name={displayName}
                            size="xl"
                            ring
                            className="ring-4 ring-white shadow-xl"
                        />
                        <h1 className="mt-3 text-2xl font-bold text-slate-900 tracking-tight uppercase">
                            {displayName.toUpperCase()}
                        </h1>
                        {user.email && (
                            <p className="mt-1 text-sm text-slate-500 lowercase break-all">
                                {user.email.toLowerCase()}
                            </p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                            {user.role && (
                                <Badge
                                    variant={
                                        user.role.toLowerCase() === "admin"
                                            ? "info"
                                            : "neutral"
                                    }
                                    className="uppercase tracking-wide"
                                >
                                    {user.role.toUpperCase()}
                                </Badge>
                            )}
                            <Badge
                                variant={user.enable ? "success" : "danger"}
                                dot
                                className="uppercase tracking-wide"
                            >
                                {user.enable ? "ACTIVO" : "INACTIVO"}
                            </Badge>
                            {user.type_person && (
                                <Badge
                                    variant="neutral"
                                    className="uppercase tracking-wide"
                                >
                                    {user.type_person.toUpperCase()}
                                </Badge>
                            )}
                        </div>
                    </div>
                </CardBody>
            </Card>

            {/* ============================ Info grid ========================= */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Información Personal */}
                <Card className="lg:col-span-5">
                    <CardHeader>
                        <CardTitle>Información personal</CardTitle>
                    </CardHeader>
                    <CardBody>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                            <InfoRow
                                icon={<UserCircle2 />}
                                label="Nombre"
                                value={displayName}
                            />
                            <InfoRow
                                icon={<BadgeCheck />}
                                label="Rol"
                                value={user.role || "—"}
                            />
                            <InfoRow
                                icon={<Building2 />}
                                label="Tipo de persona"
                                value={user.type_person || "—"}
                            />
                            <InfoRow
                                icon={<IdCard />}
                                label={user.type_dni || "Documento"}
                                value={user.identity_document || "—"}
                            />
                            <InfoRow
                                icon={<Hash />}
                                label="Referencia"
                                value={user.reference || "—"}
                            />
                            <InfoRow
                                icon={<Hash />}
                                label="Referencia 2"
                                value={user.reference2 || "—"}
                            />
                        </div>
                    </CardBody>
                </Card>

                {/* Contacto + Metadata (combined right column) */}
                <Card className="lg:col-span-7">
                    <CardHeader>
                        <CardTitle>Contacto</CardTitle>
                    </CardHeader>
                    <CardBody>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                            <InfoRow
                                icon={<Mail />}
                                label="Email institucional"
                                value={user.email}
                            />
                            <InfoRow
                                icon={<AtSign />}
                                label="Email personal"
                                value={user.personal_email || "—"}
                            />
                            <InfoRow
                                icon={<Phone />}
                                label="Teléfono"
                                value={user.phone || "—"}
                            />
                            <InfoRow
                                icon={<MapPin />}
                                label="Departamento"
                                value={user.department || "—"}
                            />
                            <InfoRow
                                icon={<Calendar />}
                                label="Creado el"
                                value={formatDateLong(user.created_at)}
                            />
                        </div>
                    </CardBody>
                </Card>
            </div>

            {/* ============================ Productos =========================
                `overflow-hidden` en la Card raíz + `overflow-y-auto` en el
                <ul> evita que listas largas de ciudades/departamentos rompan
                el contenedor cuando un producto tiene cobertura amplia. */}
            <Card className="overflow-hidden">
                <CardHeader>
                    <div>
                        <CardTitle>Productos asignados</CardTitle>
                        <CardTitle className="text-sm text-slate-500 mt-0.5">
                            {user.products?.length ?? 0}{" "}
                            {user.products?.length === 1
                                ? "producto"
                                : "productos"}
                        </CardTitle>
                    </div>
                </CardHeader>

                {!user.products || user.products.length === 0 ? (
                    <EmptyState
                        icon={<Package />}
                        title="Sin productos asignados"
                        description="Este usuario aún no tiene productos vinculados a su cuenta."
                    />
                ) : (
                    <ul className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                        {user.products.map((p) => {
                            const status = productStatus(p);
                            return (
                                <li
                                    key={p.id}
                                    className="px-6 py-4 flex flex-col sm:flex-row sm:items-start gap-4 min-w-0"
                                >
                                    {/* Icono del producto */}
                                    <div
                                        className={cn(
                                            "flex h-11 w-11 items-center justify-center rounded-xl flex-shrink-0",
                                            p.enable
                                                ? "bg-brand-50 text-brand-600"
                                                : "bg-slate-100 text-slate-400"
                                        )}
                                    >
                                        <Package className="h-5 w-5" />
                                    </div>

                                    {/* Nombre + ubicación (truncate-safe) */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p
                                                className={cn(
                                                    "text-sm font-semibold uppercase tracking-wide",
                                                    p.enable
                                                        ? "text-slate-900"
                                                        : "text-slate-500"
                                                )}
                                            >
                                                {p.name?.toUpperCase()}
                                            </p>
                                            <Badge
                                                variant={status.variant}
                                                size="sm"
                                                dot
                                                className="uppercase tracking-wide"
                                            >
                                                {status.label.toUpperCase()}
                                            </Badge>
                                        </div>
                                        <div className="mt-3">
                                            <GeographicAssignmentCard
                                                title="Asignación geográfica"
                                                zones={p.zones ?? []}
                                                departamentos={departamentos}
                                                municipios={municipios}
                                            />
                                        </div>
                                    </div>

                                    {/* Vencimiento + duración (right-aligned, fija) */}
                                    <div className="flex flex-row sm:flex-col sm:items-end gap-4 sm:gap-1.5 flex-shrink-0">
                                        <div className="flex flex-col sm:items-end gap-0.5 min-w-[110px]">
                                            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 uppercase tracking-wide">
                                                <Clock className="h-3 w-3" />
                                                Vence
                                            </span>
                                            <span className="text-sm font-medium text-slate-700 tabular-nums lowercase">
                                                {formatDateShort(
                                                    p.expiration
                                                ).toLowerCase()}
                                            </span>
                                        </div>
                                        {p.contract_duration ? (
                                            <div className="flex flex-col sm:items-end gap-0.5 min-w-[110px]">
                                                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 uppercase tracking-wide">
                                                    <CheckCircle2 className="h-3 w-3" />
                                                    Duración
                                                </span>
                                                <span className="text-sm font-medium text-slate-700">
                                                    {p.contract_duration}{" "}
                                                    {p.duration_unit ?? ""}
                                                </span>
                                            </div>
                                        ) : null}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Card>

            {/* La edición de usuario migró a página dedicada (/users/edit/:id);
                el modal anterior fue eliminado. Botón "Editar" arriba navega
                a esa ruta directamente. */}
        </div>
    );
};

export default UserDetail;

// =============================================================================
// Sub-componentes
// =============================================================================

const InfoRow = ({
    icon,
    label,
    value,
}: {
    icon: React.ReactNode;
    label: string;
    value: React.ReactNode;
}) => (
    <div className="flex items-start gap-3 min-w-0">
        <div
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 text-slate-500 flex-shrink-0 [&>svg]:h-4 [&>svg]:w-4"
            aria-hidden
        >
            {icon}
        </div>
        <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                {label}
            </p>
            <p className="mt-0.5 text-sm font-medium text-slate-900 break-words">
                {value}
            </p>
        </div>
    </div>
);