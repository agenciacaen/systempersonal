"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, type ChartConfig } from "@/components/ui/chart";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { createClient } from "@/lib/supabase/client";
import { normalizeCategoryName } from "@/lib/text";
import { Skeleton } from "@/components/ui/skeleton";
import { addMonths, endOfMonth, startOfMonth, format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface DailyPoint {
  day: string;
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
  "var(--primary)",
  "var(--destructive)",
  "var(--muted-foreground)",
];

const chartConfig = {
  value: { label: "Valor" },
} satisfies ChartConfig;

export function DailyExpenseChart({ month }: { month: Date }) {
  const [data, setData] = useState<DailyPoint[]>([]);
  const [categories, setCategories] = useState<CategoryMeta[]>([]);
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

      const start = format(startOfMonth(month), "yyyy-MM-dd");
      const end = format(endOfMonth(month), "yyyy-MM-dd");

      const { data: rows, error } = await (supabase
        .from("transactions") as any)
        .select("amount, transaction_date, categories!inner(name, type, color)")
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
        return { day: String(dayNum) };
      });

      const totals = new Map<string, number>();
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
        totals.set(name, (totals.get(name) ?? 0) + amount);
      }

      const top = Array.from(totals.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      const meta: CategoryMeta[] = top.map(([name], i) => ({
        name,
        color: PALETTE[i % PALETTE.length],
      }));

      if (!cancelled) {
        setData(empty);
        setCategories(meta);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [month]);

  const lines = categories.length;
  const heightClass = lines <= 1 ? "h-56" : lines <= 3 ? "h-64" : "h-72";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Despesas por dia
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : data.length === 0 || categories.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            Sem despesas neste mês
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className={`mx-auto w-full ${heightClass}`}
          >
            <LineChart
              data={data}
              margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                interval="preserveStartEnd"
                fontSize={11}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={4}
                fontSize={11}
                tickFormatter={(v) => {
                  if (v >= 1000) return `R$${(v / 1000).toFixed(1)}k`;
                  return `R$${v}`;
                }}
                width={48}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="line"
                    labelFormatter={(label) => {
                      const day = Number(label);
                      if (!Number.isFinite(day)) return label;
                      const ref = month;
                      const d = new Date(ref.getFullYear(), ref.getMonth(), day);
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
                <Line
                  key={c.name}
                  type="monotone"
                  dataKey={c.name}
                  name={c.name}
                  stroke={c.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls
                />
              ))}
              <ChartLegend
                content={<ChartLegendContent nameKey="name" />}
                verticalAlign="bottom"
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
