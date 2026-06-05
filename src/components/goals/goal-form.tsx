"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/stores/app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DialogFooter } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { addMonths } from "date-fns";
import { normalizeCategoryName } from "@/lib/text";

interface Category {
  id: string;
  name: string;
}

interface GoalFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function GoalForm({ onSuccess, onCancel }: GoalFormProps) {
  const { month } = useAppStore();
  const [description, setDescription] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [type, setType] = useState<"goal" | "budget">("goal");
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("categories")
      .select("id, name")
      .then(({ data }) => {
        if (data) setCategories(data.filter((c) => c.name).map((c) => ({ ...c, name: normalizeCategoryName(c.name) })));
      });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetAmount) {
      toast.error("Defina o valor da meta");
      return;
    }

    const value = parseFloat(targetAmount.replace(/\./g, "").replace(",", "."));
    if (isNaN(value) || value <= 0) {
      toast.error("Valor inválido");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const refMonth = month.toISOString().slice(0, 10);

    if (type === "goal") {
      if (!description) {
        toast.error("Descreva a meta");
        setLoading(false);
        return;
      }
      const { error } = await supabase.from("monthly_goals").insert({
        user_id: user.id,
        description,
        savings_goal: value,
        reference_month: refMonth,
      });
      if (error) { toast.error(error.message); setLoading(false); return; }
    } else {
      if (!categoryId) {
        toast.error("Selecione uma categoria");
        setLoading(false);
        return;
      }
      const { error } = await supabase.from("category_budgets").insert({
        user_id: user.id,
        category_id: categoryId,
        limit_amount: value,
        reference_month: refMonth,
      });
      if (error) { toast.error(error.message); setLoading(false); return; }
    }

    toast.success(type === "goal" ? "Meta criada!" : "Orçamento criado!");
    setLoading(false);
    onSuccess?.();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Tipo</Label>
        <Select value={type} onValueChange={(v) => { if (v === "goal" || v === "budget") setType(v); }}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="goal">Meta</SelectItem>
            <SelectItem value="budget">Orçamento por Categoria</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {type === "goal" && (
        <div className="space-y-2">
          <Label htmlFor="goal-desc">Descrição</Label>
          <Input id="goal-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: Economizar para viagem" />
        </div>
      )}

      {type === "budget" && (
        <div className="space-y-2">
          <Label>Categoria</Label>
          <Select value={categoryId} onValueChange={(v) => setCategoryId(v)}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label>Valor alvo (R$)</Label>
        <Input value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} placeholder="0,00" inputMode="decimal" />
      </div>

      <DialogFooter>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
        )}
        <Button type="submit" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Criar
        </Button>
      </DialogFooter>
    </form>
  );
}
