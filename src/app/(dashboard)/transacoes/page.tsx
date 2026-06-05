"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/stores/app-store";
import { useTransactionDrawer } from "@/stores/transaction-drawer";
import { formatCurrency, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TransactionSheet } from "@/components/transactions/transaction-sheet";
import { Plus, ChevronLeft, ChevronRight, ArrowRightLeft, Search, Pencil, Trash2, X, Loader2 } from "lucide-react";
import { addMonths, subMonths } from "date-fns";
import { toast } from "sonner";
import { normalizeCategoryName } from "@/lib/text";

interface Transaction {
  id: string;
  description: string;
  amount: number;
  type: "income" | "expense";
  transaction_date: string;
  category_name?: string;
  account_name?: string;
  account_id?: string;
  category_id?: string;
}

interface FilterState {
  search: string;
  account: string;
  category: string;
}

export default function TransactionsPage() {
  const { month, setMonth } = useAppStore();
  const { openDrawer } = useTransactionDrawer();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string; type: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<FilterState>({ search: "", account: "", category: "" });
  const PAGE_SIZE = 20;

  // Seleção em massa
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmSingle, setConfirmSingle] = useState<Transaction | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadAccountsAndCategories = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [accountsRes, categoriesRes] = await Promise.all([
      supabase.from("accounts").select("id, name").eq("user_id", user.id),
      supabase.from("categories").select("id, name, type"),
    ]);
    if (accountsRes.data) setAccounts(accountsRes.data);
    if (categoriesRes.data) setCategories(categoriesRes.data);
  }, []);

  const loadTransactions = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setLoading(true);
    const startDate = month.toISOString().slice(0, 10);
    const endDate = addMonths(month, 1).toISOString().slice(0, 10);

    let query = supabase
      .from("transactions")
      .select("id, description, amount, type, transaction_date, account_id, category_id, categories(name), accounts(name)")
      .gte("transaction_date", startDate)
      .lt("transaction_date", endDate)
      .eq("user_id", user.id)
      .order("transaction_date", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    if (tab === "income") query = query.eq("type", "income");
    if (tab === "expense") query = query.eq("type", "expense");
    if (filters.account) query = query.eq("account_id", filters.account);
    if (filters.category) query = query.eq("category_id", filters.category);
    if (filters.search) query = query.ilike("description", `%${filters.search}%`);

    const { data } = await query;
    if (data) {
      setTransactions(
        data.map((t: any) => ({
          ...t,
          category_name: normalizeCategoryName(t.categories?.name),
          account_name: t.accounts?.name,
        }))
      );
    }
    setLoading(false);
  }, [month, tab, page, filters]);

  useEffect(() => { loadAccountsAndCategories(); }, [loadAccountsAndCategories]);
  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("transactions-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, () => loadTransactions())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadTransactions]);

  // Limpar seleção ao mudar filtros/página/aba
  useEffect(() => { setSelected(new Set()); }, [month, tab, page, filters]);

  const prevMonth = () => { setMonth(subMonths(month, 1)); setPage(1); };
  const nextMonth = () => { setMonth(addMonths(month, 1)); setPage(1); };

  // ===== Ações de exclusão =====
  async function deleteTransactions(ids: string[]) {
    if (ids.length === 0) return;
    setDeleting(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setDeleting(false); return; }

    // Filtra por user_id para segurança extra (defense in depth — RLS já deveria cobrir)
    const { error, count } = await supabase
      .from("transactions")
      .delete({ count: "exact" })
      .in("id", ids)
      .eq("user_id", user.id);

    setDeleting(false);
    if (error) {
      toast.error(`Erro ao excluir: ${error.message}`);
      return;
    }
    toast.success(`${count ?? ids.length} transação(ões) excluída(s)`);
    setSelected(new Set());
    setConfirmSingle(null);
    setConfirmBulk(false);
    // Realtime vai disparar loadTransactions automaticamente
  }

  // ===== Seleção =====
  const allSelected = transactions.length > 0 && transactions.every((t) => selected.has(t.id));
  const someSelected = transactions.some((t) => selected.has(t.id)) && !allSelected;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(transactions.map((t) => t.id)));
    }
  }
  function clearSelection() { setSelected(new Set()); }

  // Resumo da seleção (para o diálogo de confirmação em massa)
  const selectionSummary = useMemo(() => {
    const sel = transactions.filter((t) => selected.has(t.id));
    const inc = sel.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const exp = sel.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    return { count: sel.length, inc, exp, net: inc - exp };
  }, [transactions, selected]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Transações</h1>
        <Button onClick={() => openDrawer()}>
          <Plus className="mr-2 h-4 w-4" />
          Nova
        </Button>
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

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por descrição..."
            className="pl-8"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
        </div>
        <Select value={filters.account || "all"} onValueChange={(v) => setFilters((f) => ({ ...f, account: v === "all" ? "" : v }))}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Conta" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as contas</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.category || "all"} onValueChange={(v) => setFilters((f) => ({ ...f, category: v === "all" ? "" : v }))}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>{normalizeCategoryName(c.name)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={(v) => { setTab(v); setPage(1); }}>
        <TabsList>
          <TabsTrigger value="all">Todas</TabsTrigger>
          <TabsTrigger value="income">Receitas</TabsTrigger>
          <TabsTrigger value="expense">Despesas</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm text-muted-foreground">
                {transactions.length} transação(ões)
              </CardTitle>
              {transactions.length > 0 && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="select-all"
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={toggleAll}
                  />
                  <label htmlFor="select-all" className="text-xs cursor-pointer select-none text-muted-foreground">
                    Selecionar todas
                  </label>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">Carregando...</div>
              ) : transactions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <ArrowRightLeft className="mb-2 h-8 w-8" />
                  <p>Nenhuma transação encontrada</p>
                </div>
              ) : (
                <div className="divide-y">
                  {transactions.map((t) => {
                    const isSelected = selected.has(t.id);
                    return (
                      <div
                        key={t.id}
                        className={`flex items-center gap-3 py-3 px-2 -mx-2 rounded transition-colors ${isSelected ? "bg-primary/5" : "hover:bg-accent/20"}`}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleOne(t.id)}
                          aria-label={`Selecionar ${t.description}`}
                        />
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="font-medium truncate">{t.description}</span>
                          <span className="text-sm text-muted-foreground">
                            {formatDate(t.transaction_date)}
                            {t.category_name && ` · ${t.category_name}`}
                            {t.account_name && ` · ${t.account_name}`}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`font-semibold ${t.type === "income" ? "text-primary" : "text-destructive"}`}>
                            {t.type === "income" ? "+" : "-"}
                            {formatCurrency(t.amount)}
                          </span>
                          <Badge variant={t.type === "income" ? "default" : "destructive"} className="hidden sm:inline-flex">
                            {t.type === "income" ? "Receita" : "Despesa"}
                          </Badge>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openDrawer(t.id)} title="Editar">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setConfirmSingle(t)}
                            title="Excluir"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex items-center justify-between pt-4">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <span className="text-sm text-muted-foreground">Página {page}</span>
                <Button variant="outline" size="sm" disabled={transactions.length < PAGE_SIZE} onClick={() => setPage((p) => p + 1)}>
                  Próxima
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <TransactionSheet />

      {/* Barra flutuante de ação em massa */}
      {selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-lg border bg-background shadow-lg p-2 pr-3">
          <Badge variant="secondary" className="ml-1">
            {selected.size} selecionada(s)
          </Badge>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirmBulk(true)}
            disabled={deleting}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Excluir selecionadas
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={clearSelection}
            title="Limpar seleção"
            disabled={deleting}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Confirmação: exclusão única */}
      <AlertDialog open={!!confirmSingle} onOpenChange={(o) => !o && setConfirmSingle(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir transação?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmSingle && (
                <div className="space-y-2">
                  <p>Esta ação não pode ser desfeita.</p>
                  <div className="rounded border bg-muted/30 p-3 text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium">{confirmSingle.description}</span>
                      <span className={confirmSingle.type === "income" ? "text-primary font-semibold" : "text-destructive font-semibold"}>
                        {confirmSingle.type === "income" ? "+" : "-"}
                        {formatCurrency(confirmSingle.amount)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatDate(confirmSingle.transaction_date)}
                      {confirmSingle.account_name && ` · ${confirmSingle.account_name}`}
                      {confirmSingle.category_name && ` · ${confirmSingle.category_name}`}
                    </div>
                  </div>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmSingle && deleteTransactions([confirmSingle.id])}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação: exclusão em massa */}
      <AlertDialog open={confirmBulk} onOpenChange={(o) => !o && setConfirmBulk(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {selectionSummary.count} transação(ões)?</AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-2">
                <p>Esta ação não pode ser desfeita.</p>
                <div className="rounded border bg-muted/30 p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span>Receitas:</span>
                    <span className="text-primary font-semibold">+{formatCurrency(selectionSummary.inc)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Despesas:</span>
                    <span className="text-destructive font-semibold">-{formatCurrency(selectionSummary.exp)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-1">
                    <span>Impacto no saldo:</span>
                    <span className={`font-semibold ${selectionSummary.net >= 0 ? "text-primary" : "text-destructive"}`}>
                      {selectionSummary.net >= 0 ? "+" : ""}{formatCurrency(selectionSummary.net)}
                    </span>
                  </div>
                </div>
                {selectionSummary.count > 0 && transactions.length > selectionSummary.count && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    ⚠️ Apenas as {selectionSummary.count} transações visíveis nesta página serão excluídas. Para excluir todas, navegue pelas páginas e use a seleção.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTransactions(Array.from(selected))}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Excluir {selectionSummary.count} transação(ões)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
