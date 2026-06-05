"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebarStore } from "@/store/sidebarStore";
import type { ReactNode } from "react";

export interface SidebarSubItem {
  label: string;
  href: string;
}

export interface SidebarItemProps {
  icon: React.ElementType;
  label: string;
  href: string;
  isActive?: boolean;
  endDecorator?: ReactNode;
  onNavigate?: () => void;
  disabled?: boolean;
  subItems?: SidebarSubItem[];
}

export function SidebarItem({
  icon: Icon,
  label,
  href,
  isActive,
  endDecorator,
  onNavigate,
  disabled,
  subItems,
}: SidebarItemProps) {
  const { isMobile } = useSidebarStore();
  const pathname = usePathname();
  const isDesktop = !isMobile;

  const isCurrentlyActive =
    isActive !== undefined
      ? isActive
      : pathname === href || pathname.startsWith(href + "/");

  const hasSubItems = subItems && subItems.length > 0;

  if (disabled) {
    return (
      <div
        className={cn(
          "mb-1 flex items-center whitespace-nowrap overflow-hidden rounded-md px-3 py-2 text-sm font-medium transition-all duration-300",
          "text-muted-foreground opacity-60 cursor-not-allowed select-none",
          isDesktop && "justify-center px-2 group-hover:justify-start group-hover:px-3"
        )}
        title={isDesktop ? `${label} (Em breve)` : undefined}
      >
        <Icon className={cn("h-5 w-5 shrink-0 transition-all", isDesktop ? "group-hover:mr-3" : "mr-3")} />
        <span className={cn("flex-1 truncate text-left transition-all duration-300", isDesktop && "hidden group-hover:block")}>
          {label}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <Link
        href={href}
        onClick={() => onNavigate?.()}
        className={cn(
          "mb-1 flex items-center whitespace-nowrap overflow-hidden rounded-md px-3 py-2 text-sm font-medium transition-all duration-300",
          isCurrentlyActive
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          isDesktop && "justify-center px-2 group-hover:justify-start group-hover:px-3"
        )}
        title={isDesktop && !hasSubItems ? label : undefined}
      >
        <Icon className={cn("h-5 w-5 shrink-0 transition-all", isDesktop ? "group-hover:mr-3" : "mr-3")} />
        <span className={cn("flex-1 truncate text-left transition-all duration-300", isDesktop && "hidden group-hover:block")}>
          {label}
        </span>
        {endDecorator && !hasSubItems && (
          <div className={cn(isDesktop && "hidden group-hover:block")}>
            {endDecorator}
          </div>
        )}
      </Link>
    </div>
  );
}
