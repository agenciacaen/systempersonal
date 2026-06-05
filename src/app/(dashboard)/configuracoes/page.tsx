"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { LogOut, User, PiggyBank, ChevronRight, Webhook, Copy, Check, Download, ExternalLink, Wallet, Tag } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";

export default function ConfiguracoesPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [webhookStats, setWebhookStats] = useState<{ total: number; last7d: number } | null>(null);

  const webhookUrl = userId
    ? `https://sliviaqjauiqanzmhzqo.supabase.co/functions/v1/evolution-webhook`
    : "";

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (data.user) {
        setUserEmail(data.user.email ?? null);
        setUserId(data.user.id);

        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, phone")
          .eq("id", data.user.id)
          .single();
        if (profile) {
          setFullName(profile.full_name ?? "");
          setPhone(profile.phone ?? "");
        }

        const { count: total } = await supabase
          .from("webhook_events")
          .select("id", { count: "exact", head: true });

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const { count: last7d } = await supabase
          .from("webhook_events")
          .select("id", { count: "exact", head: true })
          .gte("created_at", sevenDaysAgo.toISOString());

        setWebhookStats({ total: total ?? 0, last7d: last7d ?? 0 });
      }
    });
  }, []);

  async function handleSaveProfile() {
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName, phone })
      .eq("id", user.id);
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Perfil atualizado");
    }
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    toast.success("Sessão encerrada");
    router.push("/login");
  }

  async function handleExportCSV() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from("transactions")
      .select("transaction_date, type, amount, description, source, status, categories(name), accounts(name)")
      .eq("user_id", user.id)
      .order("transaction_date", { ascending: false });

    if (error) {
      toast.error("Erro ao exportar");
      return;
    }

    const headers = ["Data", "Tipo", "Valor", "Descrição", "Categoria", "Conta", "Origem", "Status"];
    const rows = (data ?? []).map((t: any) => [
      t.transaction_date,
      t.type === "income" ? "Receita" : "Despesa",
      String(t.amount).replace(".", ","),
      `"${(t.description ?? "").replace(/"/g, '""')}"`,
      t.categories?.name ?? "",
      t.accounts?.name ?? "",
      t.source ?? "",
      t.status ?? "",
    ]);

    const csv = [headers, ...rows]
      .map((r) => r.join(";"))
      .join("\n");

    const BOM = "\uFEFF";
    const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transacoes_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${rows.length} transações exportadas`);
  }

  function copyWebhook() {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    toast.success("URL copiada");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Perfil</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={userEmail ?? ""} disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fullname">Nome completo</Label>
            <Input id="fullname" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Seu nome" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Telefone (WhatsApp)</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+55 11 99999 9999" />
          </div>
          <Button onClick={handleSaveProfile} disabled={loading}>
            {loading ? "Salvando..." : "Salvar"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
            <span>Integração WhatsApp (Evolution API)</span>
            <Badge variant="default">Ativo</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>URL do Webhook</Label>
            <div className="flex gap-2">
              <Input value={webhookUrl} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={copyWebhook}>
                {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Configure esta URL no painel da Evolution API para receber mensagens
            </p>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-2xl font-bold">{webhookStats?.total ?? 0}</p>
              <p className="text-xs text-muted-foreground">Eventos recebidos</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{webhookStats?.last7d ?? 0}</p>
              <p className="text-xs text-muted-foreground">Últimos 7 dias</p>
            </div>
          </div>

          <div className="rounded-md border bg-muted/50 p-3 text-sm">
            <p className="font-medium mb-1">Exemplos de uso:</p>
            <ul className="space-y-1 text-muted-foreground text-xs">
              <li>• "gastei 120 no mercado"</li>
              <li>• "recebi 1500 de freela"</li>
              <li>• "paguei 89 da internet hoje"</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Gerenciar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          <Link href="/contas" className="flex items-center gap-3 py-3 border-b">
            <Wallet className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium">Contas Financeiras</p>
              <p className="text-xs text-muted-foreground">Carteiras, contas correntes, cartões</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
          <Link href="/categorias" className="flex items-center gap-3 py-3 border-b">
            <Tag className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium">Categorias</p>
              <p className="text-xs text-muted-foreground">Personalize suas categorias de gasto</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
          <button
            onClick={handleExportCSV}
            className="flex w-full items-center gap-3 py-3 text-left"
          >
            <Download className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium">Exportar CSV</p>
              <p className="text-xs text-muted-foreground">Baixar todas as transações</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Sessão</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" className="w-full" onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Sair da Conta
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
