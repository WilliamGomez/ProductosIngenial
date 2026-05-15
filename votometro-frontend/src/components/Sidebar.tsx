import {
    Users,
    Network,
    Binoculars,
    Archive,
    ChevronsLeft,
    ChevronsRight,
    ShieldCheck,
    Map,
    type LucideIcon,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useSidebar } from "../layouts/SidebarContext";
import { cn } from "../lib/cn";

/**
 * Sidebar — navegación lateral colapsable (Tabler/Vuexy-style).
 *
 * Estados:
 *   · expandido (w-64) → ícono + label
 *   · colapsado (w-16) → solo ícono, label aparece en tooltip al hover
 *
 * El estado collapsed vive en SidebarContext (persistido en localStorage),
 * así que MainLayout puede sincronizar el padding-left del contenido.
 *
 * Lógica de items: SE PRESERVA TAL CUAL la del Sidebar legacy:
 *   · Admin ve todos los items.
 *   · User ve sólo los productos que tiene habilitados.
 *   · /users y /sessions-report son Admin-only.
 *
 * NO toca useAuth — sólo lee userRole + userProducts.
 */

interface NavItem {
    to: string;
    label: string;
    icon: LucideIcon;
    /** Función que decide si este item se muestra para el user actual. */
    visible: (ctx: {
        userRole: string | undefined;
        hasProduct: (name: string) => boolean | undefined;
    }) => boolean;
}

const NAV_ITEMS: NavItem[] = [
    {
        to: "/votometro",
        label: "Votometro",
        icon: Archive,
        visible: ({ userRole, hasProduct }) =>
            userRole === "Admin" || !!hasProduct("Votometro"),
    },
    {
        to: "/audivoto",
        label: "Audivoto",
        icon: Binoculars,
        visible: ({ userRole, hasProduct }) =>
            userRole === "Admin" || !!hasProduct("Audivoto"),
    },
    {
        to: "/users",
        label: "Usuarios",
        icon: Users,
        visible: ({ userRole }) => userRole === "Admin",
    },
    {
        to: "/admin/roles",
        label: "Roles",
        icon: ShieldCheck,
        visible: ({ userRole }) => userRole === "Admin",
    },
    {
        to: "/admin/divipola",
        label: "Divipol",
        icon: Map,
        visible: ({ userRole }) => userRole === "Admin",
    },
    {
        to: "/sessions-report",
        label: "Sesiones",
        icon: Network,
        visible: ({ userRole }) => userRole === "Admin",
    },
];

export default function Sidebar() {
    const { userRole, userProducts } = useAuth();
    const { collapsed, toggle } = useSidebar();

    const hasProduct = (name: string) =>
        userProducts?.some(
            (p) => p.name.toLowerCase() === name.toLowerCase() && p.enable
        );

    const items = NAV_ITEMS.filter((item) =>
        item.visible({ userRole, hasProduct })
    );

    return (
        <aside
            className={cn(
                "fixed top-0 left-0 z-40 h-screen bg-white border-r border-slate-200 flex flex-col",
                "transition-[width] duration-200 ease-in-out",
                collapsed ? "w-16" : "w-64"
            )}
            aria-label="Navegación principal"
        >
            {/* ---------- Brand ---------- */}
            <div
                className={cn(
                    "flex items-center h-16 border-b border-slate-100 flex-shrink-0",
                    collapsed ? "justify-center px-0" : "px-5 gap-3"
                )}
            >
                <img
                    src="/logo.svg"
                    alt="Logo"
                    className="h-8 w-8 flex-shrink-0"
                />
                {!collapsed && (
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 leading-none">
                            Ingenial IA
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5 leading-none">
                            Suite de productos
                        </p>
                    </div>
                )}
            </div>

            {/* ---------- Nav items ---------- */}
            <nav
                className={cn(
                    "flex-1 overflow-y-auto py-4",
                    collapsed ? "px-2" : "px-3"
                )}
            >
                {!collapsed && (
                    <p className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Navegación
                    </p>
                )}
                <ul className="space-y-1">
                    {items.map((item) => {
                        const Icon = item.icon;
                        return (
                            <li key={item.to}>
                                <NavLink
                                    to={item.to}
                                    aria-label={`Ir a ${item.label}`}
                                    title={collapsed ? item.label : undefined}
                                    className={({ isActive }) =>
                                        cn(
                                            "group relative flex items-center rounded-lg text-sm font-medium transition-colors duration-150",
                                            collapsed
                                                ? "h-10 w-12 justify-center"
                                                : "h-10 px-3 gap-3",
                                            isActive
                                                ? "bg-brand-50 text-brand-700"
                                                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                                        )
                                    }
                                >
                                    {({ isActive }) => (
                                        <>
                                            {/* Barra activa a la izquierda — indicator visual extra */}
                                            {isActive && (
                                                <span
                                                    aria-hidden
                                                    className={cn(
                                                        "absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-brand-600",
                                                        collapsed
                                                            ? "h-6"
                                                            : "h-6"
                                                    )}
                                                />
                                            )}
                                            <Icon
                                                className={cn(
                                                    "h-5 w-5 flex-shrink-0",
                                                    isActive
                                                        ? "text-brand-600"
                                                        : "text-slate-400 group-hover:text-slate-600"
                                                )}
                                            />
                                            {!collapsed && (
                                                <span className="truncate">
                                                    {item.label}
                                                </span>
                                            )}
                                        </>
                                    )}
                                </NavLink>
                            </li>
                        );
                    })}
                </ul>
            </nav>

            {/* ---------- Toggle collapse ---------- */}
            <div
                className={cn(
                    "border-t border-slate-100 p-3 flex flex-shrink-0",
                    collapsed ? "justify-center" : "justify-end"
                )}
            >
                <button
                    type="button"
                    onClick={toggle}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                    aria-label={
                        collapsed ? "Expandir sidebar" : "Colapsar sidebar"
                    }
                    title={collapsed ? "Expandir" : "Colapsar"}
                >
                    {collapsed ? (
                        <ChevronsRight className="h-4 w-4" />
                    ) : (
                        <ChevronsLeft className="h-4 w-4" />
                    )}
                </button>
            </div>
        </aside>
    );
}
