import { useEffect, useMemo, useState } from "react";
import {
    ShieldCheck,
    Plus,
    Trash2,
    Save,
    Lock,
    AlertCircle,
    CheckCircle2,
    X,
} from "lucide-react";
import { useAccessToken } from "../hooks/useAccessToken";
import {
    listPermissionsGrouped,
    listRoles,
    getRole,
    createRole,
    updateRolePermissions,
    deleteRole,
} from "../services/api";
import type { IPermissionsByModule, IRole } from "../interfaces/IRbac";
import {
    Badge,
    Button,
    Card,
    CardBody,
    CardHeader,
    CardTitle,
    EmptyState,
    PageHeader,
} from "../components/ui";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "../lib/cn";

/**
 * RolesMatrix — vista admin de RBAC dinámico.
 *
 * Layout master-detail:
 *   ┌───────────────┬──────────────────────────────────┐
 *   │ Rail Roles    │ Detalle: nombre + acciones       │
 *   │ ─────────────  │ ─────────────────────────────────│
 *   │ • SuperAdmin 🔒│  ▼ Módulo Usuarios               │
 *   │ • Admin    🔒  │     [x] users.read               │
 *   │ • User     🔒  │     [ ] users.write              │
 *   │ • Auditor      │  ▼ Módulo PowerBI                │
 *   │   + Nuevo rol  │     [x] powerbi.view             │
 *   └───────────────┴──────────────────────────────────┘
 *
 * Reglas de negocio reflejadas en UI:
 *   · Roles `is_system=true` muestran un candado y deshabilitan delete.
 *   · `SuperAdmin` además bloquea los checkboxes (catálogo completo
 *     forzado por el backend).
 *   · La barra de feedback inline confirma guardado / errores sin
 *     usar SweetAlert para no romper el flujo de selección.
 */

const RolesMatrix = () => {
    const { getToken } = useAccessToken();

    const [roles, setRoles] = useState<IRole[]>([]);
    const [permissionsByModule, setPermissionsByModule] =
        useState<IPermissionsByModule>({});
    const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    // Draft: Set de permission_id seleccionados para el rol activo
    const [draft, setDraft] = useState<Set<string>>(new Set());
    const [draftBaseline, setDraftBaseline] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState<{
        ok: boolean;
        msg: string;
    } | null>(null);

    const [showCreate, setShowCreate] = useState(false);

    // ---- Bootstrap --------------------------------------------------------
    useEffect(() => {
        void bootstrap();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const bootstrap = async () => {
        setLoading(true);
        try {
            const token = await getToken();
            const [rolesData, permsData] = await Promise.all([
                listRoles(token),
                listPermissionsGrouped(token),
            ]);
            setRoles(rolesData);
            setPermissionsByModule(permsData);
            if (rolesData.length > 0) await selectRole(rolesData[0].id);
        } finally {
            setLoading(false);
        }
    };

    const selectRole = async (roleId: string) => {
        setSelectedRoleId(roleId);
        const token = await getToken();
        const full = await getRole(token, roleId);
        setRoles((prev) => prev.map((r) => (r.id === roleId ? full : r)));
        const ids = new Set(full.permissions.map((p) => p.id));
        setDraft(ids);
        setDraftBaseline(new Set(ids));
        setFeedback(null);
    };

    // ---- Toggle helpers ---------------------------------------------------
    const togglePermission = (permId: string) => {
        setDraft((prev) => {
            const next = new Set(prev);
            next.has(permId) ? next.delete(permId) : next.add(permId);
            return next;
        });
    };

    const toggleModule = (module: string, allOn: boolean) => {
        const moduleIds = (permissionsByModule[module] ?? []).map((p) => p.id);
        setDraft((prev) => {
            const next = new Set(prev);
            moduleIds.forEach((id) =>
                allOn ? next.delete(id) : next.add(id)
            );
            return next;
        });
    };

    // ---- Diff dirty -------------------------------------------------------
    const isDirty = useMemo(() => {
        if (draft.size !== draftBaseline.size) return true;
        for (const id of draft) if (!draftBaseline.has(id)) return true;
        return false;
    }, [draft, draftBaseline]);

    const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? null;
    const isSuperAdmin = selectedRole?.name === "SuperAdmin";

    // ---- Save ------------------------------------------------------------
    const handleSave = async () => {
        if (!selectedRole || !isDirty) return;
        setSaving(true);
        setFeedback(null);
        try {
            const token = await getToken();
            await updateRolePermissions(token, selectedRole.id, [...draft]);
            setDraftBaseline(new Set(draft));
            setFeedback({ ok: true, msg: "Permisos actualizados" });
        } catch (err: any) {
            setFeedback({
                ok: false,
                msg: err?.response?.data?.error ?? "No se pudo guardar",
            });
        } finally {
            setSaving(false);
            setTimeout(() => setFeedback(null), 2500);
        }
    };

    const handleDelete = async () => {
        if (!selectedRole || selectedRole.is_system) return;
        if (
            !window.confirm(
                `¿Eliminar el rol "${selectedRole.name}"? Esta acción no puede deshacerse.`
            )
        )
            return;
        const token = await getToken();
        await deleteRole(token, selectedRole.id);
        const remaining = roles.filter((r) => r.id !== selectedRole.id);
        setRoles(remaining);
        if (remaining[0]) {
            await selectRole(remaining[0].id);
        } else {
            setSelectedRoleId(null);
            setDraft(new Set());
            setDraftBaseline(new Set());
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-20">
                <Spinner />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <PageHeader
                eyebrow="Administración"
                title="Roles y permisos"
                description="Define roles personalizados y configura su matriz de permisos."
                actions={
                    <Button
                        leftIcon={<Plus />}
                        onClick={() => setShowCreate(true)}
                    >
                        Nuevo rol
                    </Button>
                }
            />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* ============= Rail izquierdo ============= */}
                <Card className="lg:col-span-4">
                    <CardHeader>
                        <CardTitle>Roles</CardTitle>
                    </CardHeader>
                    {roles.length === 0 ? (
                        <EmptyState
                            icon={<ShieldCheck />}
                            title="Sin roles"
                            description="Crea el primer rol para empezar."
                        />
                    ) : (
                        <ul className="divide-y divide-slate-100">
                            {roles.map((r) => {
                                const active = r.id === selectedRoleId;
                                return (
                                    <li key={r.id}>
                                        <button
                                            type="button"
                                            onClick={() => selectRole(r.id)}
                                            className={cn(
                                                "w-full flex items-center gap-3 px-6 py-3 text-left transition-colors",
                                                active
                                                    ? "bg-brand-50"
                                                    : "hover:bg-slate-50"
                                            )}
                                        >
                                            <div
                                                className={cn(
                                                    "flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0",
                                                    active
                                                        ? "bg-brand-100 text-brand-700"
                                                        : "bg-slate-100 text-slate-500"
                                                )}
                                            >
                                                <ShieldCheck className="h-4 w-4" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p
                                                    className={cn(
                                                        "text-sm font-semibold uppercase tracking-wide truncate",
                                                        active
                                                            ? "text-brand-700"
                                                            : "text-slate-900"
                                                    )}
                                                >
                                                    {r.name.toUpperCase()}
                                                </p>
                                                {r.description && (
                                                    <p className="text-xs text-slate-500 truncate">
                                                        {r.description}
                                                    </p>
                                                )}
                                            </div>
                                            {r.is_system && (
                                                <Lock className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                                            )}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </Card>

                {/* ============= Detalle derecho ============= */}
                <Card className="lg:col-span-8 overflow-hidden">
                    {!selectedRole ? (
                        <EmptyState
                            icon={<ShieldCheck />}
                            title="Selecciona un rol"
                            description="Elige un rol del listado para ver y editar sus permisos."
                        />
                    ) : (
                        <>
                            <CardHeader>
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <CardTitle>
                                            {selectedRole.name}
                                            {selectedRole.is_system && (
                                                <Badge
                                                    variant="info"
                                                    size="sm"
                                                    className="ml-2 uppercase tracking-wide"
                                                >
                                                    SISTEMA
                                                </Badge>
                                            )}
                                        </CardTitle>
                                        {selectedRole.description && (
                                            <p className="text-sm text-slate-500 mt-0.5">
                                                {selectedRole.description}
                                            </p>
                                        )}
                                    </div>
                                    {!selectedRole.is_system && (
                                        <Button
                                            variant="secondary"
                                            leftIcon={<Trash2 />}
                                            size="sm"
                                            onClick={handleDelete}
                                        >
                                            Eliminar
                                        </Button>
                                    )}
                                </div>
                            </CardHeader>
                            <CardBody className="space-y-5 max-h-[560px] overflow-y-auto">
                                {Object.entries(permissionsByModule).map(
                                    ([module, perms]) => {
                                        const allOn = perms.every((p) =>
                                            draft.has(p.id)
                                        );
                                        return (
                                            <section
                                                key={module}
                                                className="border border-slate-200 rounded-xl"
                                            >
                                                <header className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/60">
                                                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                                                        {module}
                                                    </h3>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            toggleModule(
                                                                module,
                                                                allOn
                                                            )
                                                        }
                                                        disabled={isSuperAdmin}
                                                        className={cn(
                                                            "text-xs font-medium px-2 py-1 rounded transition-colors",
                                                            "text-brand-600 hover:bg-brand-50",
                                                            "disabled:text-slate-300 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                                                        )}
                                                    >
                                                        {allOn
                                                            ? "Quitar todos"
                                                            : "Marcar todos"}
                                                    </button>
                                                </header>
                                                <ul className="divide-y divide-slate-100">
                                                    {perms.map((p) => {
                                                        const checked =
                                                            draft.has(p.id);
                                                        return (
                                                            <li
                                                                key={p.id}
                                                                className={cn(
                                                                    "flex items-center gap-3 px-4 py-3",
                                                                    isSuperAdmin &&
                                                                        "opacity-60"
                                                                )}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    id={`perm-${p.id}`}
                                                                    checked={
                                                                        checked
                                                                    }
                                                                    disabled={
                                                                        isSuperAdmin
                                                                    }
                                                                    onChange={() =>
                                                                        togglePermission(
                                                                            p.id
                                                                        )
                                                                    }
                                                                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/20"
                                                                />
                                                                <label
                                                                    htmlFor={`perm-${p.id}`}
                                                                    className="flex-1 min-w-0 cursor-pointer"
                                                                >
                                                                    <p className="text-sm font-medium text-slate-900 lowercase tracking-wide">
                                                                        {p.name}
                                                                    </p>
                                                                    {p.description && (
                                                                        <p className="text-xs text-slate-500 truncate">
                                                                            {
                                                                                p.description
                                                                            }
                                                                        </p>
                                                                    )}
                                                                </label>
                                                                <Badge
                                                                    variant="neutral"
                                                                    size="sm"
                                                                    className="font-mono text-[10px] uppercase"
                                                                >
                                                                    {p.action}
                                                                </Badge>
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            </section>
                                        );
                                    }
                                )}
                            </CardBody>
                            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3 bg-white">
                                {feedback && (
                                    <span
                                        className={cn(
                                            "inline-flex items-center gap-1.5 text-xs font-medium",
                                            feedback.ok
                                                ? "text-emerald-600"
                                                : "text-rose-600"
                                        )}
                                    >
                                        {feedback.ok ? (
                                            <CheckCircle2 className="h-3.5 w-3.5" />
                                        ) : (
                                            <AlertCircle className="h-3.5 w-3.5" />
                                        )}
                                        {feedback.msg}
                                    </span>
                                )}
                                <Button
                                    leftIcon={<Save />}
                                    onClick={handleSave}
                                    disabled={!isDirty || saving || isSuperAdmin}
                                >
                                    {saving ? "Guardando…" : "Guardar permisos"}
                                </Button>
                            </div>
                        </>
                    )}
                </Card>
            </div>

            {showCreate && (
                <CreateRoleModal
                    onClose={() => setShowCreate(false)}
                    onCreated={async (created) => {
                        setRoles((prev) => [...prev, created]);
                        setShowCreate(false);
                        await selectRole(created.id);
                    }}
                />
            )}
        </div>
    );
};

export default RolesMatrix;

// =============================================================================
// CreateRoleModal — UI mínima de creación. Inline en el mismo archivo para
// mantener el módulo cohesivo.
// =============================================================================
interface CreateRoleModalProps {
    onClose: () => void;
    onCreated: (role: IRole) => void;
}

const CreateRoleModal = ({ onClose, onCreated }: CreateRoleModalProps) => {
    const { getToken } = useAccessToken();
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        if (name.trim().length < 3) {
            setError("El nombre debe tener al menos 3 caracteres.");
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            const token = await getToken();
            const created = await createRole(token, {
                name: name.trim(),
                description: description.trim() || undefined,
            });
            onCreated(created);
        } catch (err: any) {
            setError(
                err?.response?.data?.error ?? "No se pudo crear el rol."
            );
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    onClick={onClose}
                    className="absolute top-3 right-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
                    aria-label="Cerrar"
                >
                    <X className="h-4 w-4" />
                </button>
                <h2 className="text-lg font-bold text-slate-900">Crear rol</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                    Define un rol vacío. Después podrás asignarle permisos.
                </p>
                <div className="mt-5 space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                            Nombre
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Ej. Auditor"
                            maxLength={40}
                            className="w-full px-3 py-2 rounded-lg text-sm bg-white border border-slate-200 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                            Descripción{" "}
                            <span className="text-slate-400">(opcional)</span>
                        </label>
                        <textarea
                            rows={3}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="¿Para qué se usará este rol?"
                            maxLength={200}
                            className="w-full px-3 py-2 rounded-lg text-sm bg-white border border-slate-200 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                        />
                    </div>
                    {error && (
                        <p className="text-xs font-medium text-rose-600">
                            {error}
                        </p>
                    )}
                </div>
                <div className="mt-6 flex justify-end gap-3">
                    <Button
                        variant="secondary"
                        onClick={onClose}
                        disabled={submitting}
                    >
                        Cancelar
                    </Button>
                    <Button onClick={submit} disabled={submitting}>
                        {submitting ? "Creando…" : "Crear rol"}
                    </Button>
                </div>
            </div>
        </div>
    );
};
