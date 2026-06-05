"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AccountForm } from "@/components/accounts/account-form";
import { formatCurrency } from "@/lib/format";
import { Plus, Wallet, Pencil, Trash2, CreditCard, Banknote, PiggyBank, TrendingUp, Power, PowerOff, TrendingDown, TrendingUp as TrendingUpIcon, Filter, X } from "lucide-react";
import { toast } from "sonner";
import { format, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { normalizeCategoryName, normalizeText } from "@/lib/text";

interface Account {
  id: string;
  name: string;
  type: string;
  initial_balance: number;
  active: boolean;
  current_balance?: number;
  total_income?: number;
  total_expense?: number;
  calculated_balance?: number;
  has_override?: boolean;
  current_balance_override?: number | null;
  balance_override_at?: string | null;
  balance_override_note?: string | null;
}

interface AccountTransaction {
  id: string;
  type: "income" | "expense";
  amount: number;
  description: string;
  transaction_date: string;
  status: string;
  category_name: string | null;
  category_color: string | null;
  category_icon: string | null;
}

const TYPE_META: Record<string, { label: string; icon: React.ElementType }> = {
  cash: { label: "Dinheiro", icon: Banknote },
  checking: { label: "Conta Corrente", icon: Wallet },
  savings: { label: "Poupança", icon: PiggyBank },
  credit_card: { label: "Cartão de Crédito", icon: CreditCard },
  investment: { label: "Investimento", icon: TrendingUp },
};

type Period = "all" | "current_month" | "last_30" | "last_month" | "last_90";
type TypeFilter = "all" | "income" | "expense";

const PERIOD_LABEL: Record<Period, string> = {
  all: "Todos os períodos",
  current_month: "Mês atual",
  last_month: "Mês passado",
  last_30: "Últimos 30 dias",
  last_90: "Últimos 90 dias",
};

function getPeriodDates(period: Period): { start: string | null; end: string | null } {
  const today = new Date();
  if (period === "all") return { start: null, end: null };
  if (period === "current_month") return { start: format(startOfMonth(today), "yyyy-MM-dd"), end: format(endOfMonth(today), "yyyy-MM-dd") };
  if (period === "last_month") {
    const lm = subMonths(today, 1);
    return { start: format(startOfMonth(lm), "yyyy-MM-dd"), end: format(endOfMonth(lm), "yyyy-MM-dd") };
  }
  if (period === "last_30") return { start: format(subDays(today, 30), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
  if (period === "last_90") return { start: format(subDays(today, 90), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
  return { start: null, end: null };
}

export default function ContasPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("current_month");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [transactions, setTransactions] = useState<AccountTransaction[]>([]);
  const [loadingTx, setLoadingTx] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("view_account_balances")
      .select("account_id, account_name, account_type, initial_balance, current_balance, total_income, total_expense, calculated_balance, has_override, current_balance_override, balance_override_at, balance_override_note")
      .eq("user_id", user.id)
      .order("account_name");
    if (data) {
      setAccounts(
        data.map((r: any) => ({
          id: r.account_id,
          name: r.account_name,
          type: r.account_type,
          initial_balance: Number(r.initial_balance || 0),
          current_balance: Number(r.current_balance || 0),
          total_income: Number(r.total_income || 0),
          total_expense: Number(r.total_expense || 0),
          calculated_balance: Number(r.calculated_balance || 0),
          has_override: !!r.has_override,
          current_balance_override: r.current_balance_override != null ? Number(r.current_balance_override) : null,
          balance_override_at: r.balance_override_at ?? null,
          balance_override_note: r.balance_override_note ?? null,
          active: true,
        }))
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("balances-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "accounts" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  // Carrega transações filtradas quando muda conta / período / tipo
  useEffect(() => {
    if (!selectedAccount) {
      setTransactions([]);
      return;
    }
    const supabase = createClient();
    const { start, end } = getPeriodDates(period);
    setLoadingTx(true);

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoadingTx(false); return; }

      console.log("[contas/tx] starting", {
        accountId: selectedAccount,
        userId: user.id,
        period, start, end, typeFilter,
      });

      // Tenta RPC primeiro
      const { data: rpcData, error: rpcError, status, statusText } = await (supabase.rpc as any)(
        "get_transactions_by_account",
        {
          p_user_id: user.id,
          p_account_id: selectedAccount,
          p_start_date: start,
          p_end_date: end,
          p_type: typeFilter,
        }
      );

      console.log("[contas/tx] rpc response", {
        status, statusText,
        rpcError: rpcError?.message ?? null,
        rpcErrorCode: rpcError?.code ?? null,
        rpcErrorDetails: rpcError?.details ?? null,
        rpcErrorHint: rpcError?.hint ?? null,
        rpcDataLength: Array.isArray(rpcData) ? rpcData.length : null,
        rpcDataSample: Array.isArray(rpcData) ? rpcData.slice(0, 2) : rpcData,
      });

      if (!rpcError && Array.isArray(rpcData)) {
        setTransactions(
          rpcData.map((r: any) => ({
            id: r.id,
            type: r.type,
            amount: Number(r.amount),
            description: normalizeText(r.description),
            transaction_date: r.transaction_date,
            status: r.status,
            category_name: normalizeCategoryName(r.category_name),
            category_color: r.category_color,
            category_icon: r.category_icon,
          }))
        );
        setLoadingTx(false);
        return;
      }

      // Fallback: query direta (se RPC falhar)
      console.warn("[contas/tx] RPC get_transactions_by_account falhou, usando fallback:", rpcError?.message);
      let q = supabase
        .from("transactions")
        .select("id, type, amount, description, transaction_date, status, category:categories(name, color, icon)")
        .eq("user_id", user.id)
        .eq("account_id", selectedAccount);
      if (start) q = q.gte("transaction_date", start);
      if (end) q = q.lte("transaction_date", end);
      if (typeFilter !== "all") q = q.eq("type", typeFilter);
      q = q.order("transaction_date", { ascending: false }).limit(200);
      const { data, error } = await q;
      console.log("[contas/tx] fallback response", {
        error: error?.message ?? null,
        dataLength: Array.isArray(data) ? data.length : null,
        dataSample: Array.isArray(data) ? data.slice(0, 2) : data,
      });
      if (error) {
        console.error("[contas/tx] Fallback query falhou:", error);
        toast.error(`Erro ao buscar transações: ${error.message}`);
      }
      if (data) {
        setTransactions(
          data.map((r: any) => ({
            id: r.id,
            type: r.type,
            amount: Number(r.amount),
            description: normalizeText(r.description),
            transaction_date: r.transaction_date,
            status: r.status,
            category_name: normalizeCategoryName(r.category?.name),
            category_color: r.category?.color ?? null,
            category_icon: r.category?.icon ?? null,
          }))
        );
      }
      setLoadingTx(false);
    })();
  }, [selectedAccount, period, typeFilter]);

  async function toggleActive(acc: Account) {
    const supabase = createClient();
    const { error } = await supabase
      .from("accounts")
      .update({ active: !acc.active })
      .eq("id", acc.id);
    if (error) toast.error(error.message);
    else toast.success(acc.active ? "Conta desativada" : "Conta ativada");
  }

  async function handleDelete(id: string) {
    if (!confirm("Tem certeza? Esta ação não pode ser desfeita.")) return;
    const supabase = createClient();
    const { error } = await supabase.from("accounts").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Conta removida");
      if (selectedAccount === id) setSelectedAccount(null);
      load();
    }
  }

  const selectedAcc = useMemo(() => accounts.find((a) => a.id === selectedAccount), [accounts, selectedAccount]);

  const txSummary = useMemo(() => {
    const inc = transactions.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const exp = transactions.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    return { inc, exp, net: inc - exp, count: transactions.length };
  }, [transactions]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Contas</h1>
        <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger className="inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground text-sm font-medium h-9 px-4 py-2 hover:bg-primary/90">
            <Plus className="h-4 w-4" />
            Nova Conta
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Editar Conta" : "Nova Conta"}</DialogTitle>
            </DialogHeader>
            <AccountForm
              defaultValues={
                editing
                  ? {
                      ...editing,
                      initial_balance: String(editing.initial_balance),
                      has_override: editing.has_override,
                      current_balance_override: editing.current_balance_override,
                      calculated_balance: editing.calculated_balance,
                    }
                  : undefined
              }
              onSuccess={() => { setDialogOpen(false); setEditing(null); load(); }}
              onCancel={() => { setDialogOpen(false); setEditing(null); }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">Carregando...</div>
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Wallet className="mb-2 h-8 w-8" />
          <p>Nenhuma conta cadastrada</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {accounts.map((acc) => {
            const meta = TYPE_META[acc.type] ?? TYPE_META.checking;
            const Icon = meta.icon;
            const current = acc.current_balance ?? acc.initial_balance;
            const inc = acc.total_income ?? 0;
            const exp = acc.total_expense ?? 0;
            const isSelected = selectedAccount === acc.id;
            return (
              <Card
                key={acc.id}
                className={`${!acc.active ? "opacity-60" : ""} cursor-pointer transition-colors ${isSelected ? "ring-2 ring-primary" : "hover:bg-accent/30"}`}
                onClick={() => setSelectedAccount(isSelected ? null : acc.id)}
              >
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{normalizeText(acc.name)}</p>
                        {!acc.active && <Badge variant="secondary">Inativa</Badge>}
                        {acc.has_override && (
                          <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400" title={acc.balance_override_note || "Saldo ajustado manualmente"}>
                            🔧 Ajustado
                          </Badge>
                        )}
                        {isSelected && <Badge>Mês atual</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{meta.label}</p>
                      {(inc > 0 || exp > 0) && (
                        <p className="text-xs text-muted-foreground">
                          {inc > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{formatCurrency(inc)}</span>}
                          {inc > 0 && exp > 0 && " · "}
                          {exp > 0 && <span className="text-red-600 dark:text-red-400">-{formatCurrency(exp)}</span>}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Saldo atual</p>
                      <p className={`font-semibold ${current < 0 ? "text-destructive" : ""}`}>{formatCurrency(current)}</p>
                      {acc.has_override && acc.calculated_balance != null && acc.calculated_balance !== current && (
                        <p className="text-xs text-muted-foreground" title="Saldo que seria calculado pelas transações">
                          (calc: {formatCurrency(acc.calculated_balance)})
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => toggleActive(acc)} title={acc.active ? "Desativar" : "Ativar"}>
                        {acc.active ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => { setEditing(acc); setDialogOpen(true); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(acc.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {selectedAcc && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Filter className="h-4 w-4 text-primary" />
                Movimentações — {normalizeText(selectedAcc.name)}
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setSelectedAccount(null)} title="Fechar">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Tabs value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
                <TabsList>
                  <TabsTrigger value="all">Todas</TabsTrigger>
                  <TabsTrigger value="income">
                    <TrendingUpIcon className="mr-1 h-3 w-3" /> Receitas
                  </TabsTrigger>
                  <TabsTrigger value="expense">
                    <TrendingDown className="mr-1 h-3 w-3" /> Despesas
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PERIOD_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Receitas no período</p>
                  <p className="text-lg font-semibold text-primary">{formatCurrency(txSummary.inc)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Despesas no período</p>
                  <p className="text-lg font-semibold text-destructive">{formatCurrency(txSummary.exp)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Saldo do período</p>
                  <p className={`text-lg font-semibold ${txSummary.net >= 0 ? "text-primary" : "text-destructive"}`}>
                    {formatCurrency(txSummary.net)}
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-1">
              {loadingTx ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Carregando...</p>
              ) : transactions.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma transação no período</p>
              ) : (
                <div className="max-h-96 overflow-y-auto rounded-md border">
                  {transactions.map((t) => (
                    <div key={t.id} className="flex items-center justify-between border-b p-3 last:border-0 hover:bg-accent/30">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-full ${t.type === "income" ? "bg-primary/10" : "bg-destructive/10"}`}>
                          {t.type === "income" ? (
                            <TrendingUpIcon className="h-4 w-4 text-primary" />
                          ) : (
                            <TrendingDown className="h-4 w-4 text-destructive" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{t.description}</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(t.transaction_date + "T00:00:00"), "dd/MM/yyyy")}
                            {t.category_name && ` · ${t.category_name}`}
                            {t.status === "pending_review" && " · pendente"}
                          </p>
                        </div>
                      </div>
                      <p className={`font-semibold ${t.type === "income" ? "text-primary" : "text-destructive"}`}>
                        {t.type === "income" ? "+" : "-"}{formatCurrency(t.amount)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
