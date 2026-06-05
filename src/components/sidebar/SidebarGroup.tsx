"use client";

import type { ReactNode } from "react";
import { useSidebarStore } from "@/store/sidebarStore";
import { cn } from "@/lib/utils";

export interface SidebarGroupProps {
  label: string;
  children: ReactNode;
}

export function SidebarGroup({ label, children }: SidebarGroupProps) {
  const { isMobile } = useSidebarStore();
  const isDesktop = !isMobile;

  return (
    <div className="mb-4">
      {isDesktop ? (
        <>
          <h4 className="mb-1 hidden px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground group-hover:block">
            {label}
          </h4>
          <div className="mb-1 flex h-4 w-full items-center justify-center group-hover:hidden">
            <div className="w-6 border-b border-border" />
          </div>
        </>
      ) : (
        <h4 className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </h4>
      )}
      <div className={cn("space-y-1", isDesktop && "flex flex-col items-center group-hover:block")}>
        {children}
      </div>
    </div>
  );
}
