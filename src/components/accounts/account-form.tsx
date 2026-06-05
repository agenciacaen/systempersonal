"use client";

import { useState, useEffect } from "react";
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
import { Loader2, RotateCcw, Pencil, X } from "lucide-react";
import { toast } from "sonner";

const ACCOUNT_TYPES = [
  { value: "cash", label: "Dinheiro" },
  { value: "checking", label: "Conta Corrente" },
  { value: "savings", label: "Poupança" },
  { value: "credit_card", label: "Cartão de Crédito" },
  { value: "investment", label: "Investimento" },
];

interface AccountFormData {
  name: string;
  type: string;
  initial_balance: string;
  active: boolean;
}

interface AccountFormProps {
  defaultValues?: Partial<AccountFormData> & {
    id?: string;
    current_balance_override?: number | null;
    has_override?: boolean;
    calculated_balance?: number;
  };
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function AccountForm({ defaultValues, onSuccess, onCancel }: AccountFormProps) {
  const [name, setName] = useState(defaultValues?.name ?? "");
  const [type, setType] = useState(defaultValues?.type ?? "checking");
  const [initialBalance, setInitialBalance] = useState(defaultValues?.initial_balance ?? "0");
  const [active, setActive] = useState(defaultValues?.active ?? true);
  const [loading, setLoading] = useState(false);

  // Override (saldo atual editável)
  const hasInitialOverride = !!defaultValues?.has_override;
  const [hasOverride, setHasOverride] = useState(hasInitialOverride);
  const [overrideValue, setOverrideValue] = useState(
    defaultValues?.current_balance_override != null
      ? Number(defaultValues.current_balance_override).toFixed(2).replace(".", ",")
      : ""
  );
  const [overrideNote, setOverrideNote] = useState("");
  const [editingOverride, setEditingOverride] = useState(false);

  useEffect(() => {
    if (defaultValues?.id) {
      setHasOverride(!!defaultValues?.has_override);
      setOverrideValue(
        defaultValues?.current_balance_override != null
          ? Number(defaultValues.current_balance_override).toFixed(2).replace(".", ",")
          : ""
      );
    }
  }, [defaultValues?.id, defaultValues?.has_override, defaultValues?.current_balance_override]);

  const calculated = Number(defaultValues?.calculated_balance ?? 0);
  const isEdit = !!defaultValues?.id;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name) {
      toast.error("Informe o nome da conta");
      return;
    }
    const balance = parseFloat(initialBalance.replace(/\./g, "").replace(",", "."));
    if (isNaN(balance)) {
      toast.error("Saldo inválido");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const payload = {
      user_id: user.id,
      name,
      type,
      initial_balance: balance,
      active,
    };

    let accountId = defaultValues?.id;

    if (isEdit && accountId) {
      const { error } = await supabase.from("accounts").update(payload).eq("id", accountId);
      if (error) { toast.error(error.message); setLoading(false); return; }
    } else {
      const { data: inserted, error } = await supabase.from("accounts").insert(payload).select("id").maybeSingle();
      if (error) { toast.error(error.message); setLoading(false); return; }
      accountId = inserted?.id;
    }

    // Aplica override se solicitado
    if (isEdit && hasOverride && overrideValue !== "") {
      const ovr = parseFloat(overrideValue.replace(/\./g, "").replace(",", "."));
      if (isNaN(ovr)) {
        toast.error("Valor do saldo atual inválido");
        setLoading(false);
        return;
      }
      const { error: rpcErr } = await (supabase.rpc as any)("set_account_balance_override", {
        p_account_id: accountId,
        p_new_balance: ovr,
        p_note: overrideNote || null,
      });
      if (rpcErr) { toast.error(`Saldo base salvo, mas override falhou: ${rpcErr.message}`); setLoading(false); return; }
    } else if (isEdit && hasInitialOverride && !hasOverride) {
      // usuário desmarcou o override → limpar
      const { error: rpcErr } = await (supabase.rpc as any)("clear_account_balance_override", {
        p_account_id: accountId,
      });
      if (rpcErr) { toast.error(`Saldo base salvo, mas falhou ao limpar override: ${rpcErr.message}`); setLoading(false); return; }
    }

    setLoading(false);
    toast.success(isEdit ? "Conta atualizada!" : "Conta criada!");
    onSuccess?.();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="acc-name">Nome</Label>
        <Input
          id="acc-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Nubank, Carteira"
        />
      </div>

      <div className="space-y-2">
        <Label>Tipo</Label>
        <Select value={type} onValueChange={(v) => setType(v as any)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACCOUNT_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="acc-balance">Saldo inicial (R$)</Label>
        <Input
          id="acc-balance"
          value={initialBalance}
          onChange={(e) => setInitialBalance(e.target.value)}
          placeholder="0,00"
          inputMode="decimal"
        />
        <p className="text-xs text-muted-foreground">
          Valor de partida. O saldo atual é calculado pelas receitas e despesas.
        </p>
      </div>

      {isEdit && (
        <div className="rounded-lg border border-dashed p-3 space-y-2 bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="acc-override"
                checked={hasOverride}
                onChange={(e) => {
                  setHasOverride(e.target.checked);
                  if (e.target.checked) setEditingOverride(true);
                }}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="acc-override" className="cursor-pointer">
                Definir saldo atual manualmente
              </Label>
            </div>
            {hasInitialOverride && !editingOverride && overrideValue && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium">
                🔧 Saldo ajustado
              </span>
            )}
          </div>
          {hasOverride && (
            <div className="space-y-2 pl-6">
              <p className="text-xs text-muted-foreground">
                Saldo calculado: <strong>{calculated.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong>.
                Defina um valor diferente para sobrescrever.
              </p>
              <Input
                value={overrideValue}
                onChange={(e) => setOverrideValue(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
              />
              <Input
                value={overrideNote}
                onChange={(e) => setOverrideNote(e.target.value)}
                placeholder="Motivo (opcional, ex: 'erro de lançamento')"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setHasOverride(false);
                    setOverrideValue("");
                    setOverrideNote("");
                    setEditingOverride(false);
                  }}
                >
                  <X className="mr-1 h-3 w-3" /> Cancelar ajuste
                </Button>
                {hasInitialOverride && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      const supabase = createClient();
                      const { error } = await (supabase.rpc as any)("clear_account_balance_override", {
                        p_account_id: defaultValues?.id,
                      });
                      if (error) { toast.error(error.message); return; }
                      setHasOverride(false);
                      setOverrideValue("");
                      setOverrideNote("");
                      toast.success("Override removido. Saldo voltou a ser calculado.");
                      onSuccess?.();
                    }}
                  >
                    <RotateCcw className="mr-1 h-3 w-3" /> Voltar a calcular
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="acc-active"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        <Label htmlFor="acc-active" className="cursor-pointer">Conta ativa</Label>
      </div>

      <div className="flex gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" className="flex-1" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isEdit ? "Atualizar" : "Criar"}
        </Button>
      </div>
    </form>
  );
}
