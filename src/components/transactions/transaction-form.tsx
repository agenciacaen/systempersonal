"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { normalizeCategoryName } from "@/lib/text";

interface Account {
  id: string;
  name: string;
  type: string;
}

interface Category {
  id: string;
  name: string;
  type: "income" | "expense";
}

interface TransactionFormData {
  description: string;
  amount: string;
  type: "expense" | "income";
  account_id: string;
  category_id: string;
  transaction_date: string;
}

interface TransactionFormProps {
  defaultValues?: Partial<TransactionFormData> & { id?: string };
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function TransactionForm({ defaultValues, onSuccess, onCancel }: TransactionFormProps) {
  const [type, setType] = useState<"expense" | "income">(defaultValues?.type ?? "expense");
  const [description, setDescription] = useState(defaultValues?.description ?? "");
  const [amount, setAmount] = useState(defaultValues?.amount ?? "");
  const [accountId, setAccountId] = useState(defaultValues?.account_id ?? "");
  const [categoryId, setCategoryId] = useState(defaultValues?.category_id ?? "");
  const [date, setDate] = useState(defaultValues?.transaction_date ?? format(new Date(), "yyyy-MM-dd"));
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [accountsRes, categoriesRes] = await Promise.all([
        supabase.from("accounts").select("id, name, type").eq("user_id", user.id),
        supabase.from("categories").select("id, name, type"),
      ]);

      if (accountsRes.data) setAccounts(accountsRes.data);
      if (categoriesRes.data) {
        setCategories(categoriesRes.data as Category[]);
      }
      setLoadingData(false);
    }
    load();
  }, []);

  const filteredCategories = categories.filter((c) => c.type === type);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description || !amount || !accountId || !categoryId) {
      toast.error("Preencha todos os campos");
      return;
    }

    const value = parseFloat(amount.replace(/\./g, "").replace(",", "."));
    if (isNaN(value) || value <= 0) {
      toast.error("Valor inválido");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload = {
      user_id: user.id,
      account_id: accountId,
      category_id: categoryId,
      description,
      amount: value,
      type,
      transaction_date: date,
      competence_month: date.slice(0, 7) + "-01",
      source: "manual" as const,
    };

    const { error } = defaultValues?.id
      ? await supabase.from("transactions").update(payload).eq("id", defaultValues.id)
      : await supabase.from("transactions").insert(payload);

    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(defaultValues?.id ? "Transação atualizada!" : "Transação registrada!");
    onSuccess?.();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {loadingData ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">Carregando...</div>
      ) : (
        <>
          <Tabs value={type} onValueChange={(v) => setType(v as "expense" | "income")}>
            <TabsList className="w-full">
              <TabsTrigger value="expense" className="flex-1">Despesa</TabsTrigger>
              <TabsTrigger value="income" className="flex-1">Receita</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-2">
            <Label htmlFor="description">Descrição</Label>
            <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: Supermercado" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Valor (R$)</Label>
            <Input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" inputMode="decimal" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">Data</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Conta</Label>
            <Select value={accountId} onValueChange={(v) => setAccountId(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma conta" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Categoria</Label>
            <Select value={categoryId} onValueChange={(v) => setCategoryId(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma categoria" />
              </SelectTrigger>
              <SelectContent>
                {filteredCategories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{normalizeCategoryName(c.name)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2">
            {onCancel && (
              <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
                Cancelar
              </Button>
            )}
            <Button type="submit" className="flex-1" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {defaultValues?.id ? "Atualizar" : "Salvar"}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
