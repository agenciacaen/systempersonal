"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, type ChartConfig } from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { createClient } from "@/lib/supabase/client";
import { normalizeCategoryName } from "@/lib/text";
import { Skeleton } from "@/components/ui/skeleton";
import { endOfMonth, startOfMonth, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { BarChart3 } from "lucide-react";

interface DailyPoint {
  day: number;
  label: string;
  total: number;
  [category: string]: number | string;
}

interface CategoryMeta {
  name: string;
  color: string;
}

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const baseConfig: ChartConfig = {
  total: { label: "Total" },
};

export function DailyExpenseChart({ month }: { month: Date }) {
  const [data, setData] = useState<DailyPoint[]>([]);
  const [categories, setCategories] = useState<CategoryMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalMonth, setTotalMonth] = useState(0);
  const [config, setConfig] = useState<ChartConfig>(baseConfig);

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

      const start = format(startOfMonth(month), "yyyy-MM-dd");
      const end = format(endOfMonth(month), "yyyy-MM-dd");

      const { data: rows, error } = await (supabase
        .from("transactions") as any)
        .select("amount, transaction_date, categories!inner(name, type)")
        .eq("user_id", user.id)
        .eq("type", "expense")
        .gte("transaction_date", start)
        .lte("transaction_date", end);

      if (cancelled) return;
      if (error) {
        console.error("DailyExpenseChart load error:", error);
        setLoading(false);
        return;
      }

      const daysInMonth = endOfMonth(month).getDate();
      const empty: DailyPoint[] = Array.from({ length: daysInMonth }, (_, i) => {
        const dayNum = i + 1;
        return {
          day: dayNum,
          label: String(dayNum),
          total: 0,
        };
      });

      const totals = new Map<string, number>();
      let monthTotal = 0;

      for (const r of rows ?? []) {
        const c: any = Array.isArray(r.categories) ? r.categories[0] : r.categories;
        if (!c) continue;
        const name = normalizeCategoryName(c.name);
        const amount = Math.abs(Number(r.amount) || 0);
        const occurred = new Date(r.transaction_date + "T12:00:00");
        const dayIdx = occurred.getDate() - 1;
        if (dayIdx < 0 || dayIdx >= daysInMonth) continue;
        const prev = (empty[dayIdx] as any)[name] as number | undefined;
        (empty[dayIdx] as any)[name] = (prev ?? 0) + amount;
        empty[dayIdx].total += amount;
        totals.set(name, (totals.get(name) ?? 0) + amount);
        monthTotal += amount;
      }

      const top = Array.from(totals.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      const meta: CategoryMeta[] = top.map(([name], i) => ({
        name,
        color: PALETTE[i % PALETTE.length],
      }));

      const config: ChartConfig = { ...baseConfig };
      meta.forEach((m) => {
        config[m.name] = { label: m.name, color: m.color };
      });

      if (!cancelled) {
        setData(empty);
        setCategories(meta);
        setTotalMonth(monthTotal);
        setConfig(config);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [month]);

  const hasData = categories.length > 0;
  const daysWithData = data.filter((d) => d.total > 0).length;
  const avgPerActiveDay = daysWithData > 0 ? totalMonth / daysWithData : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Despesas por Dia
          </CardTitle>
          {hasData && (
            <div className="text-right text-xs">
              <p className="text-muted-foreground">
                {daysWithData} {daysWithData === 1 ? "dia" : "dias"} com gasto
              </p>
              <p className="font-mono font-medium">
                Média: {formatCurrency(avgPerActiveDay)}
              </p>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : !hasData ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <BarChart3 className="h-8 w-8 opacity-30" />
            <p>Sem despesas neste mês</p>
          </div>
        ) : (
          <ChartContainer
            config={config}
            className="mx-auto h-64 w-full"
          >
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
              barCategoryGap={2}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                interval={data.length > 15 ? 2 : 0}
                fontSize={11}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={4}
                fontSize={11}
                tickFormatter={(v) => {
                  const n = Number(v);
                  if (n >= 1000) return `R$${(n / 1000).toFixed(1)}k`;
                  return `R$${n}`;
                }}
                width={48}
              />
              <ChartTooltip
                cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(label) => {
                      const day = Number(label);
                      if (!Number.isFinite(day)) return label;
                      const d = new Date(month.getFullYear(), month.getMonth(), day);
                      return format(d, "dd 'de' MMMM", { locale: ptBR });
                    }}
                    formatter={(value, name) => (
                      <div className="flex flex-1 items-center justify-between gap-3">
                        <span className="text-muted-foreground">{name}</span>
                        <span className="font-mono font-medium tabular-nums">
                          {formatCurrency(Number(value))}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              {categories.map((c) => (
                <Bar
                  key={c.name}
                  dataKey={c.name}
                  name={c.name}
                  stackId="a"
                  fill={c.color}
                  radius={[2, 2, 0, 0]}
                  maxBarSize={28}
                />
              ))}
              <ChartLegend
                content={<ChartLegendContent nameKey="name" />}
                verticalAlign="bottom"
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
