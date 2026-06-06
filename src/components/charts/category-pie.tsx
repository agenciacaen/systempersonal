"use client";

import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Cell } from "recharts";
import { Tag } from "lucide-react";

interface CategoryBreakdown {
  name: string;
  value: number;
  fill?: string;
}

const SLICE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--primary)",
  "var(--destructive)",
  "var(--muted-foreground)",
];

export function CategoryPieChart({ data }: { data: CategoryBreakdown[] }) {
  const chartData = data
    .filter((d) => d.value > 0)
    .map((d, i) => ({
      ...d,
      fill: d.fill ?? SLICE_COLORS[i % SLICE_COLORS.length],
    }));

  const total = chartData.reduce((s, d) => s + d.value, 0);

  const config: ChartConfig = {
    value: { label: "Valor" },
  };
  chartData.forEach((d) => {
    config[d.name] = { label: d.name, color: d.fill };
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Despesas por Categoria
        </CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Tag className="h-8 w-8 opacity-30" />
            <p>Sem despesas neste mês</p>
          </div>
        ) : (
          <>
            <ChartContainer
              config={config}
              className="mx-auto h-64 w-full"
            >
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ left: 8, right: 32, top: 4, bottom: 4 }}
                barCategoryGap={6}
              >
                <CartesianGrid horizontal={false} strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  type="number"
                  hide
                  tickFormatter={(v) => formatCurrency(Number(v))}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  width={100}
                  fontSize={12}
                  className="text-xs"
                />
                <ChartTooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                  content={
                    <ChartTooltipContent
                      hideLabel
                      nameKey="name"
                      formatter={(value, name) => (
                        <div className="flex flex-1 items-center justify-between gap-2">
                          <span className="text-muted-foreground">{name}</span>
                          <span className="font-mono font-medium tabular-nums">
                            {formatCurrency(Number(value))}
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={28}>
                  {chartData.map((entry, idx) => (
                    <Cell key={`cell-${idx}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
            <div className="mt-3 space-y-1.5">
              {chartData.map((c) => {
                const pct = total > 0 ? (c.value / total) * 100 : 0;
                return (
                  <div
                    key={c.name}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ background: c.fill }}
                      />
                      <span className="truncate text-muted-foreground">{c.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono tabular-nums">{formatCurrency(c.value)}</span>
                      <span className="text-muted-foreground tabular-nums w-10 text-right">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
