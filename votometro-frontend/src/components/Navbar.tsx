    import { useEffect, useRef, useState } from "react";
    import { LogOut, ChevronDown, User as UserIcon, Maximize2, Minimize2 } from "lucide-react";
    import { useSession } from "../context/SessionContext";
    import { Avatar } from "./ui/Avatar";
    import { Badge } from "./ui/Badge";
    import { cn } from "../lib/cn";

    /**
     * Navbar: barra superior con toggle de pantalla completa y menu de usuario.
     */
    export default function Navbar() {
        const { logoutAndCleanup, user, isLoading } = useSession();

        const [menuOpen, setMenuOpen] = useState(false);
        const [isFullscreen, setIsFullscreen] = useState(false);
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

        useEffect(() => {
            const syncFullscreenState = () => {
                setIsFullscreen(Boolean(document.fullscreenElement));
            };

            syncFullscreenState();
            document.addEventListener("fullscreenchange", syncFullscreenState);
            return () => {
                document.removeEventListener("fullscreenchange", syncFullscreenState);
            };
        }, []);

        const handleLogout = async () => {
            setMenuOpen(false);
            await logoutAndCleanup();
        };

        const handleToggleFullscreen = async () => {
            try {
                if (document.fullscreenElement) {
                    await document.exitFullscreen();
                    return;
                }
                await document.documentElement.requestFullscreen();
            } catch (error) {
                console.warn("[Navbar] fullscreen toggle failed", error);
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
                <button
                    type="button"
                    onClick={handleToggleFullscreen}
                    className={cn(
                        "inline-flex h-10 w-10 items-center justify-center rounded-full",
                        "border border-slate-200 bg-white text-slate-500 transition-colors",
                        "hover:bg-slate-50 hover:text-slate-900",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30"
                    )}
                    title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
                    aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
                    aria-pressed={isFullscreen}
                >
                    {isFullscreen ? (
                        <Minimize2 className="h-4 w-4" />
                    ) : (
                        <Maximize2 className="h-4 w-4" />
                    )}
                </button>

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
                                        <div className="flex items-center gap-1.5">
                                            <UserIcon className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                                            <p className="truncate text-sm font-semibold text-slate-900">
                                                {displayName}
                                            </p>
                                        </div>
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
