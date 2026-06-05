import { Suspense } from "react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { DashboardClient } from "./dashboard-client";
import { DashboardSkeleton } from "@/components/layout/dashboard-skeleton";
import { normalizeCategoryName } from "@/lib/text";

export const dynamic = "force-dynamic";

async function getInitialDashboardData(referenceMonth: string) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [summaryRes, trendRes, categoryRes, accountRes] = await Promise.all([
    supabase.rpc("get_dashboard_summary", {
      p_user_id: user.id,
      p_reference_month: referenceMonth,
    }),
    supabase.rpc("get_monthly_trend", {
      p_user_id: user.id,
      p_months: 6,
    }),
    supabase.rpc("get_category_breakdown", {
      p_user_id: user.id,
      p_reference_month: referenceMonth,
    }),
    (supabase.rpc as any)("get_account_breakdown", {
      p_user_id: user.id,
      p_reference_month: referenceMonth,
    }),
  ]);

  return {
    summary: (summaryRes.data as any[])?.[0] ?? null,
    trend: (trendRes.data as any[]) ?? [],
    categories: (categoryRes.data as any[]) ?? [],
    accountBreakdown: (accountRes.data as any[]) ?? [],
  };
}

export default async function DashboardPage() {
  const now = new Date();
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  const refMonth = month.toISOString().slice(0, 10);
  const data = await getInitialDashboardData(refMonth);

  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardClient
        initialMonth={month.toISOString()}
        initialSummary={data?.summary ?? null}
        initialTrend={(data?.trend ?? []).map((r: any) => ({
          month: r.reference_month,
          receitas: Number(r.total_income),
          despesas: Number(r.total_expense),
        }))}
        initialCategories={(data?.categories ?? [])
          .filter((c: any) => !c.category_name?.startsWith("_"))
          .map((c: any) => ({ name: normalizeCategoryName(c.category_name) || "Outros", value: Number(c.total_amount) }))}
        initialAccountBreakdown={(data?.accountBreakdown ?? []).map((r: any) => ({
          account_id: r.account_id,
          account_name: r.account_name,
          account_type: r.account_type,
          total_income: Number(r.total_income || 0),
          total_expense: Number(r.total_expense || 0),
          transaction_count: Number(r.transaction_count || 0),
        }))}
      />
    </Suspense>
  );
}
