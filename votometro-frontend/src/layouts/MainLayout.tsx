import { type ReactNode } from "react";
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";
import { SidebarProvider, useSidebar } from "./SidebarContext";
import { cn } from "../lib/cn";
import { useSessionTelemetry } from "../hooks/useSessionTelemetry";

/**
 * MainLayout — shell de la aplicación autenticada.
 *
 * Estructura:
 *   ┌──────────────────────────────────────┐
 *   │ Sidebar │   Navbar (sticky)         │
 *   │ (fixed) │   ────────────────────────│
 *   │         │   <main> (children)       │
 *   │         │                           │
 *   └──────────────────────────────────────┘
 *
 * El Sidebar es `fixed` (no participa del flex del documento). Para que el
 * contenido no quede tapado, el wrapper aplica `ml-16` (sidebar colapsado)
 * o `ml-64` (sidebar expandido) en función del estado del SidebarContext.
 *
 * Por qué SidebarProvider vive aquí (y no en App/main.tsx): el sidebar
 * sólo existe dentro de la zona autenticada — Login.tsx no lo usa. Así
 * mantenemos el contexto colocado donde realmente se consume y evitamos
 * que el Provider envuelva rutas que no lo necesitan.
 */

interface MainLayoutProps {
    children: ReactNode;
}

/**
 * Inner component — necesita estar dentro del Provider para poder usar
 * `useSidebar()`. Es un patrón común cuando el layout root también provee
 * el contexto que él mismo consume.
 */
const MainLayoutInner = ({ children }: MainLayoutProps) => {
    const { collapsed } = useSidebar();
    useSessionTelemetry();

    return (
        <div className="min-h-screen bg-slate-50">
            <Sidebar />

            {/* Contenedor del contenido — desplazado a la derecha del Sidebar.
                Transición suave del margin-left para acompañar la animación del
                propio Sidebar (200ms ease-in-out, mismas curvas). */}
            <div
                className={cn(
                    "flex flex-col min-h-screen",
                    "transition-[margin] duration-200 ease-in-out",
                    collapsed ? "ml-16" : "ml-64"
                )}
            >
                <Navbar />

                <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
                    {/* Container — full-width hasta 2xl (1536px) para que las
                        datatables aprovechen el espacio disponible. Tope sano
                        para no romper la legibilidad en monitores ultra-wide. */}
                    <div className="mx-auto w-full max-w-screen-2xl">{children}</div>
                </main>
            </div>
        </div>
    );
};

export default function MainLayout({ children }: MainLayoutProps) {
    return (
        <SidebarProvider>
            <MainLayoutInner>{children}</MainLayoutInner>
        </SidebarProvider>
    );
}
