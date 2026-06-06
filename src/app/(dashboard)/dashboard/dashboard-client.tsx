"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/stores/app-store";
import { formatCurrency, formatMonth } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, DollarSign, Wallet, Target, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { addMonths, subMonths } from "date-fns";
import { MonthlyTrendChart } from "@/components/charts/monthly-trend";
import { CategoryPieChart } from "@/components/charts/category-pie";
import { AccountBreakdownChart, type AccountBreakdown } from "@/components/charts/account-breakdown";
import { BudgetAlerts } from "@/components/goals/budget-alerts";
import { DailyExpenseChart } from "@/components/charts/daily-expense";
import { normalizeCategoryName } from "@/lib/text";

interface DashboardData {
  total_income: number;
  total_expense: number;
  net_balance: number;
  savings_value: number;
  total_transactions: number;
  goal_savings_goal: number;
  goal_expense_limit: number | null;
  goal_progress_pct: number;
  prev_total_income: number;
  prev_total_expense: number;
  prev_net_balance: number;
  total_account_balance: number;
}

interface MonthlyTrend {
  month: string;
  receitas: number;
  despesas: number;
}

interface CategoryBreakdown {
  name: string;
  value: number;
}

interface Props {
  initialMonth: string;
  initialSummary: DashboardData | null;
  initialTrend: MonthlyTrend[];
  initialCategories: CategoryBreakdown[];
  initialAccountBreakdown: AccountBreakdown[];
}

export function DashboardClient({ initialMonth, initialSummary, initialTrend, initialCategories, initialAccountBreakdown }: Props) {
  const { month, setMonth } = useAppStore();
  const [data, setData] = useState<DashboardData | null>(initialSummary);
  const [trend, setTrend] = useState<MonthlyTrend[]>(initialTrend);
  const [categories, setCategories] = useState<CategoryBreakdown[]>(initialCategories);
  const [accountBreakdown, setAccountBreakdown] = useState<AccountBreakdown[]>(initialAccountBreakdown);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const initial = new Date(initialMonth);
    if (month.getTime() !== initial.getTime()) {
      setMonth(initial);
    }
  }, [initialMonth, month, setMonth]);

  const loadData = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setLoading(true);
    const refMonth = month.toISOString().slice(0, 10);

    const [summaryRes, trendRes, categoryRes, accountRes] = await Promise.all([
      supabase.rpc("get_dashboard_summary", {
        p_user_id: user.id,
        p_reference_month: refMonth,
      }),
      supabase.rpc("get_monthly_trend", {
        p_user_id: user.id,
        p_months: 6,
      }),
      supabase.rpc("get_category_breakdown", {
        p_user_id: user.id,
        p_reference_month: refMonth,
      }),
      (supabase.rpc as any)("get_account_breakdown", {
        p_user_id: user.id,
        p_reference_month: refMonth,
      }),
    ]);

    if (summaryRes.data) {
      const first = (summaryRes.data as any[])[0] ?? summaryRes.data;
      setData(first as DashboardData);
    }
    if (trendRes.data) {
      const raw = trendRes.data as {
        reference_month: string;
        total_income: number;
        total_expense: number;
      }[];
      setTrend(
        raw.map((r) => ({
          month: r.reference_month,
          receitas: Number(r.total_income),
          despesas: Number(r.total_expense),
        }))
      );
    }
    if (categoryRes.data) {
      const breakdown = categoryRes.data as {
        category_name: string;
        total_amount: number;
      }[];
      setCategories(
        breakdown
          .filter((c) => !c.category_name?.startsWith("_"))
          .map((c) => ({ name: normalizeCategoryName(c.category_name) || "Outros", value: Number(c.total_amount) }))
      );
    }
    if (accountRes.data) {
      setAccountBreakdown(accountRes.data as AccountBreakdown[]);
    }
    setLoading(false);
  }, [month]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("dashboard-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, () => loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "monthly_goals" }, () => loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "category_budgets" }, () => loadData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadData]);

  const prevMonth = () => setMonth(subMonths(month, 1));
  const nextMonth = () => setMonth(addMonths(month, 1));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-40 text-center text-sm font-medium capitalize">
            {formatMonth(month)}
          </span>
          <Button variant="outline" size="icon" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Receitas"
          value={data?.total_income ?? 0}
          prev={data?.prev_total_income}
          icon={TrendingUp}
          loading={loading}
          className="border-primary/30"
        />
        <KpiCard
          title="Despesas"
          value={data?.total_expense ?? 0}
          prev={data?.prev_total_expense}
          icon={TrendingDown}
          loading={loading}
          inverse
          className="border-destructive/30"
        />
        <KpiCard
          title="Saldo do Mês"
          value={data?.net_balance ?? 0}
          prev={data?.prev_net_balance}
          icon={DollarSign}
          loading={loading}
        />
        <KpiCard
          title="Economia"
          value={data?.savings_value ?? 0}
          icon={Wallet}
          loading={loading}
        />
      </div>

      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
        <CardContent className="flex items-center justify-between gap-4 p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15">
              <Wallet className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Saldo Atual (todas as contas)</p>
              <p className="text-2xl sm:text-3xl font-bold tracking-tight">
                {formatCurrency(data?.total_account_balance ?? 0)}
              </p>
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground hidden sm:block">
            <p>Receitas − Despesas do mês</p>
            <p className="font-medium text-foreground">
              {formatCurrency(data?.net_balance ?? 0)}
            </p>
          </div>
        </CardContent>
      </Card>

      {data && data.goal_savings_goal > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="h-4 w-4 text-primary" />
                Meta de Economia
              </CardTitle>
              <span className="text-sm font-medium text-muted-foreground">
                {data.goal_progress_pct.toFixed(0)}%
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {formatCurrency(data.savings_value)} de {formatCurrency(data.goal_savings_goal)}
              </span>
              {data.goal_progress_pct >= 100 ? (
                <Badge className="bg-primary">Meta atingida!</Badge>
              ) : data.goal_progress_pct < 50 ? (
                <Badge variant="destructive">Abaixo do esperado</Badge>
              ) : (
                <Badge variant="secondary">No ritmo</Badge>
              )}
            </div>
            <Progress value={Math.min(data.goal_progress_pct, 100)} className="h-2" />
          </CardContent>
        </Card>
      )}

      <BudgetAlerts month={month} />

      <div className="grid gap-6 lg:grid-cols-2">
        <MonthlyTrendChart data={trend} />
        <AccountBreakdownChart data={accountBreakdown} monthLabel={formatMonth(month)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <CategoryPieChart data={categories} />
        <DailyExpenseChart month={month} />
      </div>
    </div>
  );
}

function KpiCard({
  title, value, prev, icon: Icon, loading, className, inverse,
}: {
  title: string;
  value: number;
  prev?: number;
  icon: React.ElementType;
  loading: boolean;
  className?: string;
  inverse?: boolean;
}) {
  const delta = prev !== undefined && prev !== 0 ? ((value - prev) / prev) * 100 : null;
  const betterWhenLower = inverse;
  const trendUp = delta !== null && delta > 0;
  const isGood = delta === null ? null : (trendUp ? !betterWhenLower : betterWhenLower);
  const deltaColor = isGood === null ? "text-muted-foreground" : isGood ? "text-primary" : "text-destructive";

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-1">
        {loading ? (
          <Skeleton className="h-8 w-32" />
        ) : (
          <>
            <div className="text-2xl font-bold">{formatCurrency(value)}</div>
            {delta !== null && prev !== 0 && (
              <div className={`flex items-center gap-1 text-xs ${deltaColor}`}>
                {delta === 0 ? (
                  <Minus className="h-3 w-3" />
                ) : trendUp ? (
                  <ArrowUp className="h-3 w-3" />
                ) : (
                  <ArrowDown className="h-3 w-3" />
                )}
                <span>{Math.abs(delta).toFixed(1)}% vs mês anterior</span>
              </div>
            )}
            {delta !== null && prev === 0 && (
              <div className="text-xs text-muted-foreground">Sem comparação anterior</div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
