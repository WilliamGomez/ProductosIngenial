import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from "react";
import { cn } from "../../lib/cn";

/**
 * Button — primitivo de acción con texto.
 *
 * Variantes:
 *   · primary    → bg brand-600 + texto blanco. CTA principal.
 *   · secondary  → bg white + border slate-200 + texto slate-700.
 *   · ghost      → transparent + hover slate-100.
 *   · danger     → bg rose-600 + texto blanco.
 *
 * Tamaños:
 *   · sm  → 32px alto, text-xs
 *   · md  → 38px alto, text-sm  ← default (alineado con inputs sm de Tabler)
 *   · lg  → 44px alto, text-sm
 *
 * Slots:
 *   · leftIcon / rightIcon — para que el caller no tenga que pelearse con
 *     el spacing dentro del label. Vienen ya dimensionados (16px).
 *
 * NOTA: NO usa DaisyUI `btn` para evitar la cascada de estilos default
 * de DaisyUI que cambia entre versiones. Tailwind puro es predecible.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: Variant;
    size?: Size;
    leftIcon?: ReactNode;
    rightIcon?: ReactNode;
    fullWidth?: boolean;
}

const variantStyles: Record<Variant, string> = {
    primary:
        "bg-brand-600 text-white hover:bg-brand-700 focus-visible:bg-brand-700 shadow-sm shadow-brand-600/10",
    secondary:
        "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 focus-visible:bg-slate-50 shadow-sm",
    soft: "bg-brand-50 text-brand-700 hover:bg-brand-100 focus-visible:bg-brand-100",
    ghost: "bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900",
    danger: "bg-rose-600 text-white hover:bg-rose-700 focus-visible:bg-rose-700 shadow-sm shadow-rose-600/10",
};

const sizeStyles: Record<Size, string> = {
    sm: "h-8 px-3 text-xs gap-1.5 [&_svg]:h-3.5 [&_svg]:w-3.5",
    md: "h-9 px-4 text-sm gap-2 [&_svg]:h-4 [&_svg]:w-4",
    lg: "h-11 px-5 text-sm gap-2 [&_svg]:h-5 [&_svg]:w-5",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    {
        variant = "primary",
        size = "md",
        leftIcon,
        rightIcon,
        fullWidth = false,
        className,
        type = "button",
        children,
        ...rest
    },
    ref
) {
    return (
        <button
            ref={ref}
            type={type}
            className={cn(
                "inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-150 whitespace-nowrap",
                "disabled:opacity-50 disabled:pointer-events-none",
                variantStyles[variant],
                sizeStyles[size],
                fullWidth && "w-full",
                className
            )}
            {...rest}
        >
            {leftIcon}
            {children}
            {rightIcon}
        </button>
    );
});
