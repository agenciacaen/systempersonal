"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

const PRESET_COLORS = [
  "#10b981", "#ef4444", "#3b82f6", "#f59e0b", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
  "#06b6d4", "#a855f7", "#eab308", "#f43f5e", "#22c55e",
];

const PRESET_ICONS = [
  "utensils-crossed", "shopping-cart", "home", "car", "heart-pulse",
  "graduation-cap", "gamepad-2", "tv", "shopping-bag", "package",
  "briefcase", "laptop", "trending-up", "coffee", "wallet",
  "plane", "pill", "baby", "dog", "gift",
];

const SUGGESTED_TAGS = [
  "essencial", "fixo", "variavel", "mensal", "diario",
  "investimento", "lazer", "trabalho", "familia", "saude",
];

interface CategoryFormData {
  name: string;
  type: "income" | "expense";
  color: string;
  icon: string;
  tags: string[];
}

interface CategoryFormProps {
  defaultValues?: Partial<CategoryFormData> & { id?: string };
  onSuccess?: () => void;
  onCancel?: () => void;
  allTags?: string[];
}

export function CategoryForm({ defaultValues, onSuccess, onCancel, allTags = [] }: CategoryFormProps) {
  const [name, setName] = useState(defaultValues?.name ?? "");
  const [type, setType] = useState<"income" | "expense">(defaultValues?.type ?? "expense");
  const [color, setColor] = useState(defaultValues?.color ?? PRESET_COLORS[0]);
  const [icon, setIcon] = useState(defaultValues?.icon ?? PRESET_ICONS[0]);
  const [tags, setTags] = useState<string[]>(defaultValues?.tags ?? []);
  const [newTag, setNewTag] = useState("");
  const [loading, setLoading] = useState(false);

  function addTag(tag: string) {
    const t = tag.trim().toLowerCase();
    if (!t) return;
    if (tags.includes(t)) return;
    if (t.length > 24) {
      toast.error("Tag muito longa (máx 24 caracteres)");
      return;
    }
    setTags([...tags, t]);
    setNewTag("");
  }

  function removeTag(tag: string) {
    setTags(tags.filter((t) => t !== tag));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name) {
      toast.error("Informe o nome da categoria");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload = {
      name,
      type,
      color,
      icon,
      tags,
    };

    const { error } = defaultValues?.id
      ? await (supabase.from("categories") as any).update(payload).eq("id", defaultValues.id)
      : await (supabase.from("categories") as any).insert(payload);

    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(defaultValues?.id ? "Categoria atualizada!" : "Categoria criada!");
    onSuccess?.();
  }

  // Combina sugestões conhecidas (presets + tags já em uso) excluindo as já escolhidas
  const availableSuggestions = Array.from(
    new Set([...SUGGESTED_TAGS, ...allTags])
  ).filter((t) => !tags.includes(t)).slice(0, 10);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Tipo</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={type === "expense" ? "default" : "outline"}
            className="flex-1"
            onClick={() => setType("expense")}
          >
            Despesa
          </Button>
          <Button
            type="button"
            variant={type === "income" ? "default" : "outline"}
            className="flex-1"
            onClick={() => setType("income")}
          >
            Receita
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="cat-name">Nome</Label>
        <Input
          id="cat-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Alimentação, Salário"
        />
      </div>

      <div className="space-y-2">
        <Label>Ícone</Label>
        <div className="flex flex-wrap gap-1">
          {PRESET_ICONS.map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIcon(i)}
              className={`flex h-9 w-9 items-center justify-center rounded border transition-colors ${
                icon === i ? "border-primary bg-primary/10" : "border-input hover:bg-accent"
              }`}
              title={i}
            >
              <i className={`lucide lucide-${i} h-4 w-4`} />
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Cor</Label>
        <div className="flex flex-wrap gap-1">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`h-8 w-8 rounded-full border-2 transition-transform ${
                color === c ? "scale-110 border-foreground" : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
              aria-label={c}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="cat-tags">Tags</Label>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <Badge
                key={t}
                variant="secondary"
                className="text-xs gap-1 pr-1"
                style={{ backgroundColor: `${color}15`, color }}
              >
                {t}
                <button
                  type="button"
                  onClick={() => removeTag(t)}
                  className="ml-0.5 hover:bg-black/10 rounded-sm p-0.5"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <div className="flex gap-1">
          <Input
            id="cat-tags"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag(newTag);
              }
            }}
            placeholder="Digite uma tag e pressione Enter"
            className="h-8 text-sm"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => addTag(newTag)}
            disabled={!newTag.trim()}
            className="h-8 px-2"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        {availableSuggestions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            <span className="text-[10px] text-muted-foreground self-center">Sugestões:</span>
            {availableSuggestions.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => addTag(t)}
                className="text-[10px] px-1.5 py-0.5 rounded border border-dashed hover:bg-accent text-muted-foreground hover:text-foreground"
              >
                + {t}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" className="flex-1" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {defaultValues?.id ? "Atualizar" : "Criar"}
        </Button>
      </div>
    </form>
  );
}
