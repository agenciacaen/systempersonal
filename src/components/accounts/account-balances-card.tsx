"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { Landmark, Wallet, PiggyBank, CreditCard, Banknote, Building2 } from "lucide-react";

interface AccountBalance {
  id: string;
  name: string;
  type: string;
  current_balance: number;
  initial_balance: number;
  has_override: boolean;
  total_income: number;
  total_expense: number;
}

const TYPE_ICON: Record<string, React.ElementType> = {
  checking: Landmark,
  savings: PiggyBank,
  cash: Banknote,
  credit_card: CreditCard,
  investment: Building2,
};

const TYPE_LABEL: Record<string, string> = {
  checking: "Conta Corrente",
  savings: "Poupança",
  cash: "Dinheiro",
  credit_card: "Cartão de Crédito",
  investment: "Investimento",
};

export function AccountBalancesCard() {
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: rows, error } = await (supabase
        .from("view_account_balances") as any)
        .select("account_id, account_name, account_type, initial_balance, total_income, total_expense, current_balance_override, current_balance, has_override")
        .eq("user_id", user.id)
        .order("current_balance", { ascending: false });

      if (cancelled) return;
      if (error) {
        console.error("AccountBalances load error:", error);
        setLoading(false);
        return;
      }

      const items: AccountBalance[] = (rows ?? []).map((r: any) => ({
        id: r.account_id,
        name: r.account_name,
        type: r.account_type,
        initial_balance: Number(r.initial_balance) || 0,
        current_balance: Number(r.current_balance) || 0,
        has_override: !!r.has_override,
        total_income: Number(r.total_income) || 0,
        total_expense: Number(r.total_expense) || 0,
      }));

      setAccounts(items);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const total = accounts.reduce((s, a) => s + a.current_balance, 0);
  const maxAbs = Math.max(...accounts.map((a) => Math.abs(a.current_balance)), 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Saldos por Conta
          </CardTitle>
          {accounts.length > 0 && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total consolidado</p>
              <p className="font-mono text-lg font-semibold">{formatCurrency(total)}</p>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Wallet className="h-8 w-8 opacity-30" />
            <p>Nenhuma conta cadastrada</p>
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map((a) => {
              const Icon = TYPE_ICON[a.type] ?? Landmark;
              const pct = (Math.abs(a.current_balance) / maxAbs) * 100;
              const totalPct = total > 0 ? (a.current_balance / total) * 100 : 0;
              const isNegative = a.current_balance < 0;
              return (
                <div key={a.id} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                          isNegative ? "bg-destructive/10" : "bg-primary/10"
                        }`}
                      >
                        <Icon
                          className={`h-3.5 w-3.5 ${
                            isNegative ? "text-destructive" : "text-primary"
                          }`}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{a.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {TYPE_LABEL[a.type] ?? a.type}
                          {a.has_override && " · saldo manual"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className={`font-mono text-sm font-semibold tabular-nums ${
                          isNegative ? "text-destructive" : ""
                        }`}
                      >
                        {formatCurrency(a.current_balance)}
                      </p>
                      {total !== 0 && (
                        <p className="text-[10px] text-muted-foreground tabular-nums">
                          {totalPct.toFixed(0)}% do total
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all ${
                        isNegative ? "bg-destructive" : "bg-primary"
                      }`}
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
