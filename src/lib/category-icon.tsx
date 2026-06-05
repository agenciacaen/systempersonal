"use client";

import {
  UtensilsCrossed, Repeat, BookOpen, Laptop, TrendingUp, Gamepad2, Home,
  Circle, Briefcase, HeartPulse, Car, ShoppingCart, ShoppingBag, Tv, GraduationCap,
  Plane, Coffee, Shirt, Receipt, Tag, Wallet, PiggyBank, CreditCard,
  Smartphone, Wifi, Lightbulb, Gift, Music, Dumbbell, Baby, Dog, Cat,
  Fuel, Wrench, Hammer, Stethoscope, Pill, BookHeart, Package, Film,
  Bus, type LucideIcon,
} from "lucide-react";

/**
 * Mapeia o campo `icon` da categoria (que pode ser:
 *  - nome Lucide (ex: "utensils-crossed", "home") — categorias default
 *  - emoji (ex: "🍔", "🏠") — categorias pessoais criadas no form
 *  - string vazia/null
 * ) para o componente Lucide correspondente.
 *
 * Detecta automaticamente: emojis são <= 4 chars sem hífen, nomes Lucide têm hífens
 * (ex: "trending-up", "heart-pulse", "gamepad-2").
 */
const LUCIDE_MAP: Record<string, LucideIcon> = {
  "utensils-crossed": UtensilsCrossed,
  "utensils": UtensilsCrossed,
  "repeat": Repeat,
  "book-open": BookOpen,
  "book": BookOpen,
  "laptop": Laptop,
  "trending-up": TrendingUp,
  "trending-down": TrendingUp,
  "gamepad-2": Gamepad2,
  "gamepad": Gamepad2,
  "home": Home,
  "house": Home,
  "circle": Circle,
  "briefcase": Briefcase,
  "briefcase-business": Briefcase,
  "heart-pulse": HeartPulse,
  "heart": HeartPulse,
  "car": Car,
  "car-front": Car,
  "shopping-cart": ShoppingCart,
  "cart": ShoppingCart,
  "shopping-bag": ShoppingBag,
  "bag": ShoppingBag,
  "package": Package,
  "film": Film,
  "bus": Bus,
  "tv": Tv,
  "television": Tv,
  "graduation-cap": GraduationCap,
  "plane": Plane,
  "plane-takeoff": Plane,
  "coffee": Coffee,
  "shirt": Shirt,
  "receipt": Receipt,
  "tag": Tag,
  "wallet": Wallet,
  "piggy-bank": PiggyBank,
  "credit-card": CreditCard,
  "smartphone": Smartphone,
  "phone": Smartphone,
  "wifi": Wifi,
  "lightbulb": Lightbulb,
  "gift": Gift,
  "music": Music,
  "dumbbell": Dumbbell,
  "baby": Baby,
  "dog": Dog,
  "cat": Cat,
  "fuel": Fuel,
  "wrench": Wrench,
  "hammer": Hammer,
  "stethoscope": Stethoscope,
  "pill": Pill,
  "book-heart": BookHeart,
};

export function isLucideIcon(icon: string | null | undefined): boolean {
  if (!icon) return false;
  const key = icon.toLowerCase().trim();
  return key in LUCIDE_MAP;
}

export function getCategoryIcon(icon: string | null | undefined): LucideIcon {
  if (!icon) return Tag;
  const key = icon.toLowerCase().trim();
  return LUCIDE_MAP[key] ?? Tag;
}

/**
 * Renderiza ícone de categoria: se for Lucide conhecido, retorna o componente;
 * caso contrário, renderiza emoji (texto) — útil para fallback.
 */
export function CategoryIcon({
  icon,
  className,
  style,
}: {
  icon: string | null | undefined;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (!icon) {
    const TagIcon = Tag;
    return <TagIcon className={className} style={style} />;
  }
  if (isLucideIcon(icon)) {
    const LucideIcon = getCategoryIcon(icon);
    return <LucideIcon className={className} style={style} />;
  }
  // Emoji ou texto fallback
  return <span className={className} style={style}>{icon}</span>;
}
