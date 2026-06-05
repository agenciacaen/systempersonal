"use client";

import { useEffect } from "react";
import { useSidebarStore } from "@/store/sidebarStore";
import { SidebarGroup } from "./SidebarGroup";
import { SidebarItem } from "./SidebarItem";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  ArrowRightLeft,
  Target,
  Settings,
  LogOut,
  Hexagon,
  Wallet,
  Tag,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface SidebarContentProps {
  userEmail: string | null;
  onNavigate?: () => void;
}

function SidebarContent({ userEmail, onNavigate }: SidebarContentProps) {
  const { isMobile } = useSidebarStore();
  const router = useRouter();
  const initials = userEmail?.charAt(0).toUpperCase() ?? "?";

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    toast.success("Sessão encerrada");
    router.push("/login");
  }

  const textClasses = isMobile
    ? "block"
    : "hidden group-hover:block transition-all duration-200";

  return (
    <>
      <div className="flex h-16 items-center border-b border-border px-4">
        <div className="flex items-center gap-2 overflow-hidden">
          <Hexagon className="h-8 w-8 shrink-0 text-primary" />
          <span className={cn("whitespace-nowrap text-xl font-bold", textClasses)}>
            Finanças
          </span>
        </div>
      </div>

      <nav
        className="flex-1 overflow-y-auto overflow-x-hidden p-3"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <SidebarGroup label="Menu">
          <SidebarItem icon={LayoutDashboard} label="Dashboard" href="/dashboard" onNavigate={onNavigate} />
          <SidebarItem icon={ArrowRightLeft} label="Transações" href="/transacoes" onNavigate={onNavigate} />
          <SidebarItem icon={Wallet} label="Contas" href="/contas" onNavigate={onNavigate} />
          <SidebarItem icon={Tag} label="Categorias" href="/categorias" onNavigate={onNavigate} />
          <SidebarItem icon={Target} label="Metas e Orçamento" href="/metas" onNavigate={onNavigate} />
          <SidebarItem icon={Settings} label="Configurações" href="/configuracoes" onNavigate={onNavigate} />
        </SidebarGroup>
      </nav>

      <div className="border-t border-border p-3">
        <div
          className={cn(
            "flex flex-col sm:flex-row items-center",
            "justify-center group-hover:justify-between"
          )}
        >
          <div className="flex items-center overflow-hidden">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary">
              <span className="font-semibold text-foreground">{initials}</span>
            </div>
            <div className={cn("ml-3 truncate", textClasses)}>
              <p className="truncate text-sm font-medium">{userEmail}</p>
              <p className="truncate text-xs text-muted-foreground">Conta</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className={cn(
              "rounded-md p-2 text-muted-foreground hover:bg-secondary shrink-0",
              isMobile
                ? "ml-auto"
                : "mt-2 group-hover:mt-0 group-hover:ml-auto w-full group-hover:w-auto flex justify-center group-hover:justify-start"
            )}
            title="Sair"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </div>
    </>
  );
}

export function Sidebar({ userEmail }: { userEmail: string | null }) {
  const { isExpanded, isMobile, expand, collapse, setIsMobile } = useSidebarStore();

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) collapse();
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, [setIsMobile, collapse]);

  if (isMobile) {
    return (
      <Sheet open={isExpanded} onOpenChange={(open) => (open ? expand() : collapse())}>
        <SheetContent side="left" className="w-64 flex-col bg-card p-0 flex border-r border-border">
          <SheetHeader className="sr-only">
            <SheetTitle>Menu de Navegação</SheetTitle>
          </SheetHeader>
          <SidebarContent userEmail={userEmail} onNavigate={() => collapse()} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      className={cn(
        "group fixed inset-y-0 left-0 z-50 hidden md:flex flex-col border-r bg-card transition-all duration-300 ease-in-out border-border",
        "w-16 hover:w-60"
      )}
    >
      <SidebarContent userEmail={userEmail} />
    </aside>
  );
}
