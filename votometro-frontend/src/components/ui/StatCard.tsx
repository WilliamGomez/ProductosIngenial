import { type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Card } from "./Card";

/**
 * StatCard — KPI tile (ícono + label + valor + delta opcional).
 * Diseño Tabler-style: ícono en cuadrado tinted, valor grande tabular-nums.
 *
 *   <StatCard
 *     icon={<Users />}
 *     label="Usuarios totales"
 *     value={42}
 *     tone="brand"
 *   />
 */
type Tone = "brand" | "success" | "danger" | "warning" | "info";

interface StatCardProps {
    icon: ReactNode;
    label: string;
    value: ReactNode;
    /** Texto auxiliar pequeño debajo del valor (ej. "+12% vs ayer"). */
    helpText?: ReactNode;
    tone?: Tone;
    className?: string;
}

const toneStyles: Record<Tone, { bg: string; fg: string }> = {
    brand: { bg: "bg-brand-50", fg: "text-brand-600" },
    success: { bg: "bg-emerald-50", fg: "text-emerald-600" },
    danger: { bg: "bg-rose-50", fg: "text-rose-600" },
    warning: { bg: "bg-amber-50", fg: "text-amber-600" },
    info: { bg: "bg-sky-50", fg: "text-sky-600" },
};

export const StatCard = ({
    icon,
    label,
    value,
    helpText,
    tone = "brand",
    className,
}: StatCardProps) => {
    const t = toneStyles[tone];
    return (
        <Card className={cn("p-3.5", className)}>
            <div className="flex items-center gap-3">
                <div
                    className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0",
                        t.bg,
                        t.fg,
                        "[&>svg]:h-5 [&>svg]:w-5"
                    )}
                    aria-hidden
                >
                    {icon}
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide leading-tight">
                        {label}
                    </p>
                    <p className="mt-0.5 text-xl font-bold text-slate-900 tabular-nums leading-tight">
                        {value}
                    </p>
                    {helpText && (
                        <p className="mt-0.5 text-[11px] text-slate-500 leading-tight">
                            {helpText}
                        </p>
                    )}
                </div>
            </div>
        </Card>
    );
};
