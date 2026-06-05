"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, AlertCircle } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { normalizeCategoryName } from "@/lib/text";

interface BudgetAlert {
  category_id: string;
  category_name: string;
  category_color: string;
  category_icon: string | null;
  limit_amount: number;
  current_amount: number;
  pct: number;
}

export function BudgetAlerts({ month }: { month: Date }) {
  const [alerts, setAlerts] = useState<BudgetAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const refMonth = month.toISOString().slice(0, 10);

    const { data } = await supabase
      .from("category_budgets")
      .select("category_id, limit_amount, current_amount, categories!inner(name, color, icon)")
      .eq("user_id", user.id)
      .eq("reference_month", refMonth);

    if (data) {
      const list = (data as any[]).map((b) => ({
        category_id: b.category_id,
        category_name: normalizeCategoryName(b.categories?.name) || "Categoria",
        category_color: b.categories?.color ?? "#6b7280",
        category_icon: b.categories?.icon ?? null,
        limit_amount: Number(b.limit_amount),
        current_amount: Number(b.current_amount),
        pct: b.limit_amount > 0 ? (Number(b.current_amount) / Number(b.limit_amount)) * 100 : 0,
      })).filter((b) => b.pct >= 80);
      list.sort((a, b) => b.pct - a.pct);
      setAlerts(list);
    }
    setLoading(false);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("budget-alerts-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "category_budgets" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  if (loading) return null;
  if (alerts.length === 0) return null;

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Alertas de Orçamento
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {alerts.map((a) => {
          const over = a.pct >= 100;
          return (
            <div key={a.category_id} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  {over && <AlertCircle className="h-4 w-4 text-destructive" />}
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded text-sm"
                    style={{ backgroundColor: `${a.category_color}20` }}
                  >
                    {a.category_icon ?? "•"}
                  </span>
                  <span className="font-medium">{a.category_name}</span>
                </div>
                <span className={`font-semibold ${over ? "text-destructive" : "text-amber-600"}`}>
                  {a.pct.toFixed(0)}%
                </span>
              </div>
              <Progress
                value={Math.min(a.pct, 100)}
                className="h-1.5"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{formatCurrency(a.current_amount)} de {formatCurrency(a.limit_amount)}</span>
                {over && <span className="text-destructive font-medium">Estourado em {formatCurrency(a.current_amount - a.limit_amount)}</span>}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
