/**
 * cn — minimal className composer (style ≈ clsx, sin la dep externa).
 *
 * Acepta strings, arrays anidados, undefined/false/null (filtrados),
 * objetos { className: condicion } donde sólo se incluye la key si su
 * value es truthy. Devuelve un único string con espacios normalizados.
 *
 * Uso:
 *   cn("base", isActive && "active", { "text-red-500": hasError })
 *
 * Por qué no clsx: añadir una dep para algo de 8 líneas no merece la pena.
 * Si en el futuro hace falta resolver conflictos de Tailwind (ej. "p-2 p-4"),
 * cambiar a `tailwind-merge` que sí necesita ser real.
 */
export type ClassValue =
    | string
    | number
    | null
    | false
    | undefined
    | ClassValue[]
    | Record<string, unknown>;

export function cn(...inputs: ClassValue[]): string {
    const parts: string[] = [];

    for (const input of inputs) {
        if (!input) continue;

        if (typeof input === "string" || typeof input === "number") {
            parts.push(String(input));
            continue;
        }

        if (Array.isArray(input)) {
            const inner = cn(...input);
            if (inner) parts.push(inner);
            continue;
        }

        if (typeof input === "object") {
            for (const [key, value] of Object.entries(input)) {
                if (value) parts.push(key);
            }
        }
    }

    return parts.join(" ").trim();
}
