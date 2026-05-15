import { useEffect, useRef, useState } from "react";
import { LogOut, Shield, ChevronDown, User as UserIcon } from "lucide-react";
import { useSession } from "../context/SessionContext";
import { useAccessToken } from "../hooks/useAccessToken";
import { forceLogoutAll } from "../services/api";
import Swal from "sweetalert2";
import withReactContent from "sweetalert2-react-content";
import { Avatar } from "./ui/Avatar";
import { Badge } from "./ui/Badge";
import { cn } from "../lib/cn";

const MySwal = withReactContent(Swal);

/**
 * Navbar — barra superior moderna.
 *
 * Contenido:
 *   · Izquierda: hueco (la marca vive en el sidebar — patrón Tabler).
 *   · Derecha:   avatar + dropdown con info de usuario y acciones.
 *
 * Acciones del dropdown (mismas que el Navbar legacy, sólo reorganizadas):
 *   · Cerrar todas las sesiones (con SweetAlert confirm)
 *   · Cerrar sesión
 *
 * NO toca:
 *   · `useSession()` — sigue dando user/isLoading/logoutAndCleanup.
 *   · `forceLogoutAll(token)` — misma firma.
 *   · MSAL (todo pasa via SessionContext.logoutAndCleanup).
 */
export default function Navbar() {
    const { logoutAndCleanup, user, isLoading } = useSession();
    const { getToken } = useAccessToken();

    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);

    // Cierra el dropdown al click fuera o al presionar Esc.
    // Patrón estándar para menús — no merece deps externas (Headless UI, Radix).
    useEffect(() => {
        if (!menuOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (
                menuRef.current &&
                !menuRef.current.contains(e.target as Node)
            ) {
                setMenuOpen(false);
            }
        };
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === "Escape") setMenuOpen(false);
        };

        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleEsc);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleEsc);
        };
    }, [menuOpen]);

    const handleLogout = async () => {
        setMenuOpen(false);
        await logoutAndCleanup();
    };

    const handleCloseAllSessions = async () => {
        setMenuOpen(false);
        const result = await MySwal.fire({
            title: "¿Cerrar todas las sesiones?",
            html: `
                <p>Esto cerrará tu sesión en <strong>todos los dispositivos</strong>.</p>
                <p>Tendrás que volver a iniciar sesión.</p>
            `,
            icon: "warning",
            showCancelButton: true,
            confirmButtonText: "Sí, cerrar todas",
            cancelButtonText: "Cancelar",
            confirmButtonColor: "#e11d48", // rose-600 — alineado con el design system
            cancelButtonColor: "#64748b", // slate-500
        });

        if (result.isConfirmed) {
            try {
                const token = await getToken();
                await forceLogoutAll(token);
                await logoutAndCleanup({
                    invalidateOnServer: false,
                    triggerMsalLogout: true,
                    reason: "User requested force logout all sessions",
                });
                await MySwal.fire({
                    title: "Sesiones cerradas",
                    text: "Todas tus sesiones han sido cerradas. Por favor inicia sesión nuevamente.",
                    icon: "success",
                    timer: 3000,
                });
            } catch (error) {
                console.error("Error closing all sessions:", error);
                await MySwal.fire({
                    title: "Error",
                    text: "No se pudieron cerrar todas las sesiones. Por favor intenta nuevamente.",
                    icon: "error",
                });
            }
        }
    };

    const displayName = user?.display_name ?? user?.name ?? "—";
    const role = user?.role;

    return (
        <header
            className={cn(
                "sticky top-0 z-30 h-16 bg-white/80 backdrop-blur-md",
                "border-b border-slate-200",
                "flex items-center justify-end gap-3 px-6"
            )}
        >
            {/* User chip + dropdown ----------------------------------------- */}
            <div className="relative" ref={menuRef}>
                <button
                    type="button"
                    onClick={() => setMenuOpen((v) => !v)}
                    className={cn(
                        "inline-flex items-center gap-3 rounded-full pl-1 pr-3 py-1",
                        "border border-slate-200 bg-white hover:bg-slate-50 transition-colors",
                        "focus-visible:ring-2 focus-visible:ring-brand-500/30"
                    )}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                >
                    <Avatar
                        name={displayName}
                        size="sm"
                        ring
                        className="ring-slate-100"
                    />
                    <div className="hidden md:flex flex-col items-start min-w-0">
                        <span className="text-sm font-semibold text-slate-900 truncate max-w-[160px] leading-tight">
                            {isLoading ? "Cargando…" : displayName}
                        </span>
                        {role && (
                            <span className="text-[11px] text-slate-500 leading-tight mt-0.5">
                                {role}
                            </span>
                        )}
                    </div>
                    <ChevronDown
                        className={cn(
                            "h-4 w-4 text-slate-400 transition-transform duration-150",
                            menuOpen && "rotate-180"
                        )}
                    />
                </button>

                {menuOpen && (
                    <div
                        role="menu"
                        className={cn(
                            "absolute right-0 mt-2 w-72 origin-top-right",
                            "rounded-xl border border-slate-200 bg-white shadow-lg",
                            "animate-fade-in-up overflow-hidden"
                        )}
                    >
                        {/* Header del dropdown — info expandida del usuario */}
                        <div className="px-4 py-4 bg-slate-50 border-b border-slate-100">
                            <div className="flex items-center gap-3">
                                <Avatar name={displayName} size="md" />
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-slate-900 truncate">
                                        {displayName}
                                    </p>
                                    <p className="text-xs text-slate-500 truncate">
                                        {user?.email ?? ""}
                                    </p>
                                    {role && (
                                        <Badge
                                            variant={
                                                role === "Admin"
                                                    ? "info"
                                                    : "neutral"
                                            }
                                            size="sm"
                                            className="mt-1.5"
                                        >
                                            {role}
                                        </Badge>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Acciones */}
                        <div className="py-1">
                            <button
                                type="button"
                                onClick={() => setMenuOpen(false)}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                                role="menuitem"
                                disabled
                                title="Próximamente"
                            >
                                <UserIcon className="h-4 w-4 text-slate-400" />
                                <span className="flex-1 text-left">
                                    Mi perfil
                                </span>
                                <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                                    Próx.
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={handleCloseAllSessions}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                                role="menuitem"
                            >
                                <Shield className="h-4 w-4 text-slate-400" />
                                Cerrar todas las sesiones
                            </button>
                        </div>

                        <div className="border-t border-slate-100 py-1">
                            <button
                                type="button"
                                onClick={handleLogout}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-rose-600 hover:bg-rose-50"
                                role="menuitem"
                            >
                                <LogOut className="h-4 w-4" />
                                Cerrar sesión
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </header>
    );
}
