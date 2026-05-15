import { type ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * PageHeader — bloque title + description + slot acciones.
 * Convención de uso: 1 PageHeader por vista, justo debajo del Navbar.
 *
 *   <PageHeader
 *     title="Gestión de Usuarios"
 *     description="Administra usuarios, roles y productos asignados."
 *     actions={<Button>Nuevo usuario</Button>}
 *   />
 */
interface PageHeaderProps {
    title: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    /** Breadcrumb / back button arriba del título (opcional). */
    eyebrow?: ReactNode;
    className?: string;
}

export const PageHeader = ({
    title,
    description,
    actions,
    eyebrow,
    className,
}: PageHeaderProps) => (
    <div
        className={cn(
            "flex flex-col gap-4 mb-6 sm:flex-row sm:items-end sm:justify-between",
            className
        )}
    >
        <div className="min-w-0">
            {eyebrow && (
                <div className="mb-2 text-xs font-medium text-slate-500">
                    {eyebrow}
                </div>
            )}
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                {title}
            </h1>
            {description && (
                <p className="mt-1 text-sm text-slate-500 max-w-2xl">
                    {description}
                </p>
            )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
);
