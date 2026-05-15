import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "../../lib/cn";

/**
 * IconButton — botón cuadrado para iconos (acciones de tabla, toggles).
 *
 * Variantes:
 *   · ghost  → transparente; hover: bg slate-100. Default para acciones
 *              secundarias en tablas (eye, edit, dots).
 *   · solid  → bg brand-600; texto blanco. Para CTAs primarias compactas.
 *   · soft   → bg brand-50, texto brand-700. Para iconos enfatizados sin
 *              dominar visualmente.
 *   · danger → bg transparent → hover bg rose-50 + text rose-600.
 *
 * Tamaños sm (28px) / md (36px) / lg (40px). Se diseñan en múltiplos de 4
 * para alinear con el grid Tailwind.
 *
 * Accesibilidad: NO renderiza children visibles que no sean iconos. El
 * caller DEBE pasar `aria-label` para que screen readers anuncien la
 * acción. Los iconos lucide-react son decorativos por sí solos.
 */

type Variant = "ghost" | "solid" | "soft" | "danger";
type Size = "sm" | "md" | "lg";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: Variant;
    size?: Size;
    "aria-label": string; // requerido — no opcional
}

const variantStyles: Record<Variant, string> = {
    ghost: "text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:bg-slate-100",
    solid: "bg-brand-600 text-white hover:bg-brand-700 focus-visible:bg-brand-700 shadow-sm",
    soft: "bg-brand-50 text-brand-700 hover:bg-brand-100 focus-visible:bg-brand-100",
    danger: "text-slate-500 hover:bg-rose-50 hover:text-rose-600 focus-visible:bg-rose-50 focus-visible:text-rose-600",
};

const sizeStyles: Record<Size, string> = {
    sm: "h-7 w-7 [&>svg]:h-3.5 [&>svg]:w-3.5",
    md: "h-9 w-9 [&>svg]:h-4 [&>svg]:w-4",
    lg: "h-10 w-10 [&>svg]:h-5 [&>svg]:w-5",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
    function IconButton(
        { variant = "ghost", size = "md", className, type = "button", ...rest },
        ref
    ) {
        return (
            <button
                ref={ref}
                type={type}
                className={cn(
                    "inline-flex items-center justify-center rounded-lg transition-colors duration-150",
                    "disabled:opacity-50 disabled:pointer-events-none",
                    variantStyles[variant],
                    sizeStyles[size],
                    className
                )}
                {...rest}
            />
        );
    }
);
