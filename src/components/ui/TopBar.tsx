"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSidebarStore } from "@/store/sidebarStore";
import { Menu, User, LogOut, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

const breadcrumbMap: Record<string, string> = {
  dashboard: "Dashboard",
  transacoes: "Transações",
  contas: "Contas",
  categorias: "Categorias",
  metas: "Metas e Orçamento",
  orcamento: "Orçamento",
  nova: "Nova",
  configuracoes: "Configurações",
};

export function TopBar({ userEmail }: { userEmail: string | null }) {
  const { toggle } = useSidebarStore();
  const location = usePathname();
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    toast.success("Sessão encerrada");
    router.push("/login");
  }

  const pathNames = location.split("/").filter((x) => x);
  const initials = userEmail?.charAt(0).toUpperCase() ?? "?";

  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between border-b bg-card px-4 border-border">
      <div className="flex items-center gap-4">
        <button
          onClick={toggle}
          className="text-muted-foreground hover:text-foreground md:hidden"
          title="Alternar Menu"
        >
          <Menu className="h-6 w-6" />
        </button>

        <nav className="hidden md:flex items-center space-x-1 text-sm font-medium text-muted-foreground">
          {pathNames.map((value, index) => {
            const isLast = index === pathNames.length - 1;
            const title = breadcrumbMap[value] || value;
            const url = `/${pathNames.slice(0, index + 1).join("/")}`;

            return (
              <Fragment key={`${value}-${index}`}>
                {index > 0 && <ChevronRight className="mx-1 h-4 w-4" />}
                {isLast ? (
                  <span className="truncate font-semibold text-foreground">
                    {title.charAt(0).toUpperCase() + title.slice(1)}
                  </span>
                ) : (
                  <Link
                    href={url}
                    className="truncate text-muted-foreground transition-colors hover:text-primary"
                  >
                    {title.charAt(0).toUpperCase() + title.slice(1)}
                  </Link>
                )}
              </Fragment>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-8 w-8 rounded-full">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/10 text-primary uppercase">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{userEmail}</p>
                <p className="text-xs leading-none text-muted-foreground">
                  Conta pessoal
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/configuracoes")}>
              <User className="mr-2 h-4 w-4" />
              <span>Meu Perfil</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              variant="destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>Sair da conta</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
