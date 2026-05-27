import { createElement, forwardRef } from "react";
import { FileBarChart, type LucideIcon, type LucideProps } from "lucide-react";
import {
  DynamicIcon,
  iconNames,
  type IconName,
} from "lucide-react/dynamic";

const iconNameSet = new Set<string>(iconNames);

const toKebabIconName = (value: string) =>
  value
    .trim()
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();

export const normalizeLucideIconName = (
  iconName?: string | null,
): IconName | null => {
  const rawName = (iconName ?? "").trim();
  if (!rawName) return null;
  if (iconNameSet.has(rawName)) return rawName as IconName;

  const kebabName = toKebabIconName(rawName);
  return iconNameSet.has(kebabName) ? (kebabName as IconName) : null;
};

export const resolveLucideIcon = (
  iconName?: string | null,
  fallback: LucideIcon = FileBarChart,
): LucideIcon => {
  const normalizedName = normalizeLucideIconName(iconName);
  if (!normalizedName) return fallback;

  return forwardRef<SVGSVGElement, LucideProps>((props, ref) =>
    createElement(DynamicIcon, {
      ...props,
      ref,
      name: normalizedName,
      fallback: () => createElement(fallback, props),
    }),
  ) as LucideIcon;
};
