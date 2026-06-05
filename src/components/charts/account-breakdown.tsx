"use client";

import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

export interface AccountBreakdown {
  account_id: string;
  account_name: string;
  account_type: string;
  total_income: number;
  total_expense: number;
  transaction_count: number;
}

const TYPE_LABEL: Record<string, string> = {
  cash: "Dinheiro",
  checking: "Conta Corrente",
  savings: "Poupança",
  credit_card: "Cartão de Crédito",
  investment: "Investimento",
};

const chartConfig = {
  income: {
    label: "Receitas",
    color: "var(--primary)",
  },
  expense: {
    label: "Despesas",
    color: "var(--destructive)",
  },
} satisfies ChartConfig;

interface Props {
  data: AccountBreakdown[];
  monthLabel?: string;
}

export function AccountBreakdownChart({ data, monthLabel }: Props) {
  const chartData = data
    .filter((d) => d.total_income > 0 || d.total_expense > 0)
    .map((d) => ({
      name: d.account_name,
      income: Number(d.total_income),
      expense: Number(d.total_expense),
      net: Number(d.total_income) - Number(d.total_expense),
      type: TYPE_LABEL[d.account_type] ?? d.account_type,
    }));

  const totalIncome = chartData.reduce((s, d) => s + d.income, 0);
  const totalExpense = chartData.reduce((s, d) => s + d.expense, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Movimentação por Conta
        </CardTitle>
        {monthLabel && (
          <CardDescription className="text-xs">
            {monthLabel}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            Sem movimentação neste período
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-around text-center text-xs">
              <div>
                <p className="text-muted-foreground">Total receitas</p>
                <p className="text-base font-semibold text-primary">{formatCurrency(totalIncome)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Total despesas</p>
                <p className="text-base font-semibold text-destructive">{formatCurrency(totalExpense)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Saldo</p>
                <p className={`text-base font-semibold ${totalIncome - totalExpense >= 0 ? "text-primary" : "text-destructive"}`}>
                  {formatCurrency(totalIncome - totalExpense)}
                </p>
              </div>
            </div>
            <ChartContainer config={chartConfig} className="h-64 w-full">
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" hide tickFormatter={(v) => formatCurrency(Number(v))} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  width={90}
                  className="text-xs"
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      hideLabel
                      formatter={(value, name) => (
                        <div className="flex flex-1 items-center justify-between gap-2">
                          <span className="text-muted-foreground">{name === "income" ? "Receitas" : "Despesas"}</span>
                          <span className="font-mono font-medium">{formatCurrency(Number(value))}</span>
                        </div>
                      )}
                    />
                  }
                />
                <Bar dataKey="income" fill="var(--primary)" radius={[0, 4, 4, 0]} stackId="a" />
                <Bar dataKey="expense" fill="var(--destructive)" radius={[0, 4, 4, 0]} stackId="b" />
              </BarChart>
            </ChartContainer>
          </>
        )}
      </CardContent>
    </Card>
  );
}
