import { type HTMLAttributes, useMemo } from "react";
import { cn } from "../../lib/cn";

/**
 * Avatar — círculo con iniciales o imagen.
 *
 * Sin imagen: deriva 1-2 iniciales del nombre y elige un color de fondo
 * determinístico (hash del nombre → indice en una paleta de soft-tones).
 * Razón del hash: dos usuarios distintos siempre obtienen el mismo color
 * en cualquier parte de la app (consistencia visual sin estado externo).
 *
 * Tamaños responsive — sm (avatar de tabla), md (navbar), lg (page header),
 * xl (perfil hero).
 */

type Size = "xs" | "sm" | "md" | "lg" | "xl";

interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
    name?: string | null;
    src?: string | null;
    size?: Size;
    /**
     * Si true, dibuja un anillo blanco alrededor (útil sobre fondos de color).
     */
    ring?: boolean;
}

const sizeStyles: Record<Size, string> = {
    xs: "h-6 w-6 text-[10px]",
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-14 w-14 text-base",
    xl: "h-20 w-20 text-2xl",
};

// Paleta de fondos (soft tones) — pares (bg, text) que dan suficiente
// contraste para iniciales legibles (ratio > 4.5:1 sobre el color claro).
const PALETTE = [
    "bg-brand-100 text-brand-700",
    "bg-emerald-100 text-emerald-700",
    "bg-amber-100 text-amber-800",
    "bg-rose-100 text-rose-700",
    "bg-violet-100 text-violet-700",
    "bg-sky-100 text-sky-700",
    "bg-pink-100 text-pink-700",
    "bg-teal-100 text-teal-700",
];

const getInitials = (name?: string | null): string => {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return (parts[0]![0] ?? "" + parts[parts.length - 1]![0] ?? "")
        .concat(parts[parts.length - 1]![0] ?? "")
        .slice(0, 2)
        .toUpperCase();
};

const getColorIndex = (name?: string | null): number => {
    if (!name) return 0;
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = (hash << 5) - hash + name.charCodeAt(i);
        hash |= 0; // forzar int32
    }
    return Math.abs(hash) % PALETTE.length;
};

export const Avatar = ({
    name,
    src,
    size = "md",
    ring = false,
    className,
    ...rest
}: AvatarProps) => {
    const initials = useMemo(() => getInitials(name), [name]);
    const colorClass = useMemo(() => PALETTE[getColorIndex(name)]!, [name]);

    return (
        <div
            className={cn(
                "inline-flex items-center justify-center rounded-full font-semibold select-none flex-shrink-0",
                sizeStyles[size],
                !src && colorClass,
                ring && "ring-2 ring-white",
                className
            )}
            aria-label={name ?? "Avatar"}
            {...rest}
        >
            {src ? (
                <img
                    src={src}
                    alt={name ?? "Avatar"}
                    className="h-full w-full rounded-full object-cover"
                />
            ) : (
                <span className="leading-none">{initials}</span>
            )}
        </div>
    );
};
