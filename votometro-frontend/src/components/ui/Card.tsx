import { type HTMLAttributes, forwardRef } from "react";
import { cn } from "../../lib/cn";

/**
 * Card — contenedor base del nuevo design system.
 *
 * Decisiones:
 *   · `rounded-2xl`: corners más suaves que el legacy (rounded-xl) — alinea
 *     con el look Tabler/Vuexy moderno.
 *   · `border` + `border-slate-200`: borde de 1px hairline en lugar de
 *     depender sólo de la sombra. Da definición sobre fondos slate-50.
 *   · `shadow-sm`: sombra muy sutil (Tailwind: 0 1px 2px rgba(0,0,0,.05)).
 *     Para dashboards modernos esto es suficiente — sombras grandes hacen
 *     que la UI se vea "del 2014".
 *   · No padding por default: el caller decide el spacing interno con
 *     <CardHeader> / <CardBody> / <CardFooter>. Esto evita "padding
 *     sumado" cuando el caller también quiere dar padding propio.
 */
type CardProps = HTMLAttributes<HTMLDivElement>;

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
    { className, ...props },
    ref
) {
    return (
        <div
            ref={ref}
            className={cn(
                "bg-white border border-slate-200 rounded-2xl shadow-sm",
                className
            )}
            {...props}
        />
    );
});

export const CardHeader = ({
    className,
    ...props
}: HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn(
            "px-6 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between gap-4",
            className
        )}
        {...props}
    />
);

export const CardTitle = ({
    className,
    ...props
}: HTMLAttributes<HTMLHeadingElement>) => (
    <h3
        className={cn(
            "text-base font-semibold text-slate-900 tracking-tight",
            className
        )}
        {...props}
    />
);

export const CardDescription = ({
    className,
    ...props
}: HTMLAttributes<HTMLParagraphElement>) => (
    <p className={cn("text-sm text-slate-500", className)} {...props} />
);

export const CardBody = ({
    className,
    ...props
}: HTMLAttributes<HTMLDivElement>) => (
    <div className={cn("p-6", className)} {...props} />
);

export const CardFooter = ({
    className,
    ...props
}: HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn(
            "px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2",
            className
        )}
        {...props}
    />
);
