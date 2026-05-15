import { type ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * EmptyState — placeholder centrado para listados vacíos / sin resultados.
 * Reemplaza los "No se encontraron usuarios." monocromos del legacy.
 */
interface EmptyStateProps {
    icon?: ReactNode;
    title: string;
    description?: string;
    action?: ReactNode;
    className?: string;
}

export const EmptyState = ({
    icon,
    title,
    description,
    action,
    className,
}: EmptyStateProps) => (
    <div
        className={cn(
            "flex flex-col items-center justify-center text-center py-12 px-4",
            className
        )}
    >
        {icon && (
            <div
                className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 mb-4 [&>svg]:h-6 [&>svg]:w-6"
                aria-hidden
            >
                {icon}
            </div>
        )}
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {description && (
            <p className="mt-1 text-sm text-slate-500 max-w-sm">
                {description}
            </p>
        )}
        {action && <div className="mt-4">{action}</div>}
    </div>
);
