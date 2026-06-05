"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/stores/app-store";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { GoalForm } from "@/components/goals/goal-form";
import { Target, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, subMonths } from "date-fns";
import { normalizeCategoryName, normalizeText } from "@/lib/text";

interface Goal {
  id: string;
  description: string;
  target_amount: number;
  current_amount: number;
  category_name?: string;
}

export default function MetasPage() {
  const { month, setMonth } = useAppStore();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const refMonth = month.toISOString().slice(0, 10);
    const [goalsRes, budgetsRes] = await Promise.all([
      supabase.from("monthly_goals").select("id, description, savings_goal, current_amount").eq("user_id", user.id).eq("reference_month", refMonth),
      supabase.from("category_budgets").select("id, limit_amount, current_amount, categories!inner(name)").eq("user_id", user.id).eq("reference_month", refMonth),
    ]);

    setGoals([
      ...(goalsRes.data?.map((g: any) => ({ ...g, target_amount: g.savings_goal, name: normalizeText(g.name), category_name: undefined })) ?? []),
      ...(budgetsRes.data?.map((b: any) => ({
        id: b.id,
        description: `Orçamento: ${normalizeCategoryName(b.categories.name)}`,
        target_amount: b.limit_amount,
        current_amount: b.current_amount,
        category_name: normalizeCategoryName(b.categories.name),
      })) ?? []),
    ]);
    setLoading(false);
  }, [month]);

  useEffect(() => { load(); }, [month, load]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("goals-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "monthly_goals" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "category_budgets" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const prevMonth = () => setMonth(subMonths(month, 1));
  const nextMonth = () => setMonth(addMonths(month, 1));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Metas e Orçamento</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger className="inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground text-sm font-medium h-9 px-4 py-2 hover:bg-primary/90">
            <Plus className="h-4 w-4" />
            Nova Meta
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Criar Meta ou Orçamento</DialogTitle>
            </DialogHeader>
            <GoalForm onSuccess={() => { setDialogOpen(false); load(); }} onCancel={() => setDialogOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" size="icon" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-40 text-center text-sm font-medium capitalize">
          {new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(month)}
        </span>
        <Button variant="outline" size="icon" onClick={nextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">Carregando...</div>
      ) : goals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Target className="mb-2 h-8 w-8" />
          <p>Nenhuma meta ou orçamento definido</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {goals.map((goal) => {
            const progress = goal.target_amount > 0 ? Math.min((goal.current_amount / goal.target_amount) * 100, 100) : 0;
            return (
              <Card key={goal.id}>
                <CardHeader>
                  <CardTitle className="text-base">{goal.description}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Progresso</span>
                    <span className="font-medium">{formatCurrency(goal.current_amount)} / {formatCurrency(goal.target_amount)}</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                  <div className="text-right text-xs text-muted-foreground">{Math.round(progress)}%</div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
