import { type HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

/**
 * Badge — chip de estado / categoría.
 *
 * Variantes:
 *   · success → verde (Activo, Habilitado, OK)
 *   · danger  → rojo  (Inactivo, Deshabilitado, Error)
 *   · warning → ámbar (Vencido, Pendiente)
 *   · info    → azul  (Admin, In Progress)
 *   · neutral → slate (default, etiquetas sin valencia)
 *
 * Decisión: usamos paletas "soft" (bg-XXX-50/100 + text-XXX-700) en lugar
 * de bg sólido + texto blanco. Razón: en datatables denso, los badges con
 * fondo saturado se sienten gritones. Los soft-tones son el patrón Tabler.
 */

type Variant = "success" | "danger" | "warning" | "info" | "neutral" | "brand";
type Size = "sm" | "md";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
    variant?: Variant;
    size?: Size;
    /**
     * Si se pasa, se renderiza un punto de color a la izquierda.
     * Útil para señales de status (online/offline).
     */
    dot?: boolean;
}

const variantStyles: Record<Variant, { container: string; dot: string }> = {
    success: {
        container: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
        dot: "bg-emerald-500",
    },
    danger: {
        container: "bg-rose-50 text-rose-700 ring-rose-600/20",
        dot: "bg-rose-500",
    },
    warning: {
        container: "bg-amber-50 text-amber-800 ring-amber-600/20",
        dot: "bg-amber-500",
    },
    info: {
        container: "bg-sky-50 text-sky-700 ring-sky-600/20",
        dot: "bg-sky-500",
    },
    neutral: {
        container: "bg-slate-100 text-slate-700 ring-slate-500/20",
        dot: "bg-slate-400",
    },
    brand: {
        container: "bg-brand-50 text-brand-700 ring-brand-600/20",
        dot: "bg-brand-500",
    },
};

const sizeStyles: Record<Size, string> = {
    sm: "px-2 py-0.5 text-[11px]",
    md: "px-2.5 py-1 text-xs",
};

export const Badge = ({
    variant = "neutral",
    size = "md",
    dot = false,
    className,
    children,
    ...rest
}: BadgeProps) => {
    const v = variantStyles[variant];
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 rounded-full font-medium ring-1 ring-inset whitespace-nowrap",
                v.container,
                sizeStyles[size],
                className
            )}
            {...rest}
        >
            {dot && (
                <span
                    aria-hidden
                    className={cn("h-1.5 w-1.5 rounded-full", v.dot)}
                />
            )}
            {children}
        </span>
    );
};
