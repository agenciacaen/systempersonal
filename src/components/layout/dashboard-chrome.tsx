"use client";

import { Sidebar } from "@/components/sidebar/Sidebar";
import { TopBar } from "@/components/ui/TopBar";

export function DashboardChrome({
  userEmail,
  children,
}: {
  userEmail: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background flex-col">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar userEmail={userEmail} />
        <div className="flex flex-col flex-1 transition-all duration-300 ease-in-out w-full md:ml-16 overflow-hidden bg-background">
          <TopBar userEmail={userEmail} />
          <main className="flex-1 overflow-y-auto w-full p-4 md:p-6 lg:p-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
