"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Phone, Plus, Star, Trash2, Loader2, Smartphone, CheckCircle2, Clock, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface WhatsAppPhone {
  id: string;
  phone: string;
  label: string | null;
  is_primary: boolean;
  verified: boolean;
  last_seen_at: string | null;
  created_at: string;
}

function formatPhone(phone: string): string {
  if (phone.length === 13 && phone.startsWith("55")) {
    const ddd = phone.substring(2, 4);
    const rest = phone.substring(4);
    if (rest.length === 9) {
      return `+55 (${ddd}) ${rest.substring(0, 5)}-${rest.substring(5)}`;
    }
    if (rest.length === 8) {
      return `+55 (${ddd}) ${rest.substring(0, 4)}-${rest.substring(4)}`;
    }
  }
  return phone;
}

function normalizePhoneInput(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function WhatsAppPhonesCard() {
  const [phones, setPhones] = useState<WhatsAppPhone[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<WhatsAppPhone | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await (supabase.from as any)("whatsapp_phones")
      .select("id, phone, label, is_primary, verified, last_seen_at, created_at")
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) {
      console.error(error);
      toast.error("Erro ao carregar números");
    } else {
      setPhones((data ?? []) as WhatsAppPhone[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd() {
    const normalized = normalizePhoneInput(newPhone);
    if (!normalized) {
      toast.error("Digite um número de telefone");
      return;
    }
    if (normalized.length < 10 || normalized.length > 15) {
      toast.error("Número deve ter entre 10 e 15 dígitos");
      return;
    }
    if (phones.some((p) => p.phone === normalized)) {
      toast.error("Esse número já está cadastrado");
      return;
    }
    setSubmitting(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Sessão expirada. Faça login novamente.");
      setSubmitting(false);
      return;
    }
    const { error } = await (supabase.from as any)("whatsapp_phones")
      .insert({
        user_id: user.id,
        phone: normalized,
        label: newLabel.trim() || null,
        is_primary: phones.length === 0,
        verified: true,
      });
    setSubmitting(false);
    if (error) {
      if (error.code === "23505") {
        toast.error("Esse número já está em uso por outra conta");
      } else {
        toast.error(error.message);
      }
      return;
    }
    toast.success("Número adicionado. Pode enviar mensagens por ele agora.");
    setNewPhone("");
    setNewLabel("");
    load();
  }

  async function handleSetPrimary(phone: WhatsAppPhone) {
    if (phone.is_primary) return;
    const supabase = createClient();
    const { error } = await (supabase.from as any)("whatsapp_phones")
      .update({ is_primary: true })
      .eq("id", phone.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${formatPhone(phone.phone)} agora é principal`);
    load();
  }

  async function handleRemove() {
    if (!confirmRemove) return;
    setRemoving(true);
    const supabase = createClient();
    const { error } = await (supabase.from as any)("whatsapp_phones")
      .delete()
      .eq("id", confirmRemove.id);
    setRemoving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Número removido");
    setConfirmRemove(null);
    load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Smartphone className="h-4 w-4" />
            Números do WhatsApp
          </span>
          <Badge variant="secondary">{phones.length} cadastrado{phones.length === 1 ? "" : "s"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground flex gap-2">
          <MessageCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>
            Cadastre quantos números quiser (pessoal, trabalho, etc). Cada um deles
            poderá enviar comandos ao agente e gerenciar suas finanças.
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : phones.length === 0 ? (
          <div className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
            Nenhum número cadastrado
          </div>
        ) : (
          <div className="space-y-2">
            {phones.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-lg border p-3 bg-card"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Phone className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-mono text-sm font-medium">
                      {formatPhone(p.phone)}
                    </p>
                    {p.is_primary && (
                      <Badge className="gap-1 text-[10px] font-normal" variant="default">
                        <Star className="h-2.5 w-2.5 fill-current" />
                        Principal
                      </Badge>
                    )}
                    {p.verified ? (
                      <Badge className="gap-1 text-[10px] font-normal" variant="secondary">
                        <CheckCircle2 className="h-2.5 w-2.5" />
                        Verificado
                      </Badge>
                    ) : (
                      <Badge className="gap-1 text-[10px] font-normal" variant="outline">
                        <Clock className="h-2.5 w-2.5" />
                        Pendente
                      </Badge>
                    )}
                    {p.label && (
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {p.label}
                      </Badge>
                    )}
                  </div>
                  {p.last_seen_at && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Visto por último {formatDistanceToNow(new Date(p.last_seen_at), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  {!p.is_primary && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSetPrimary(p)}
                      title="Tornar principal"
                    >
                      <Star className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirmRemove(p)}
                    title="Remover"
                    disabled={phones.length === 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="new-phone" className="text-xs">Número</Label>
              <Input
                id="new-phone"
                inputMode="numeric"
                placeholder="44999998888"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-label" className="text-xs">Rótulo (opcional)</Label>
              <Input
                id="new-label"
                placeholder="Trabalho"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                maxLength={30}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={handleAdd} disabled={submitting || !newPhone.trim()} className="w-full sm:w-auto">
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar
                  </>
                )}
              </Button>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Apenas dígitos. Será salvo como E.164 (ex: 5544999998888).
          </p>
        </div>
      </CardContent>

      <AlertDialog open={!!confirmRemove} onOpenChange={(o) => !o && !removing && setConfirmRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover número?</AlertDialogTitle>
            <AlertDialogDescription>
              O número <span className="font-mono font-medium">{confirmRemove && formatPhone(confirmRemove.phone)}</span> deixará de poder enviar mensagens ao agente. Você pode cadastrá-lo novamente depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
