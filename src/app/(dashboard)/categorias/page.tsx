"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { CategoryForm } from "@/components/categories/category-form";
import { CategoryIcon } from "@/lib/category-icon";
import { Plus, Tag, Pencil, Trash2, Hash, TrendingUp, TrendingDown, AlertTriangle, Loader2, Inbox } from "lucide-react";
import { toast } from "sonner";
import { normalizeCategoryName, normalizeList } from "@/lib/text";

interface Category {
  id: string;
  name: string;
  type: "income" | "expense";
  color: string;
  icon: string | null;
  tags: string[];
  usage_count?: number;
}

const TYPE_META = {
  expense: { label: "Despesas", tabValue: "expense" },
  income: { label: "Receitas", tabValue: "income" },
} as const;

export default function CategoriasPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);

  // Exclusão
  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null);
  const [usageCount, setUsageCount] = useState<number>(0);
  const [usageLoading, setUsageLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: catData } = await supabase
      .from("categories")
      .select("id, name, type, color, icon, tags")
      .order("type", { ascending: false })
      .order("name");

    const { data: txData } = await supabase
      .from("transactions")
      .select("category_id")
      .eq("user_id", user.id);

    const counts: Record<string, number> = {};
    if (txData) {
      for (const t of txData) {
        if (t.category_id) counts[t.category_id] = (counts[t.category_id] ?? 0) + 1;
      }
    }

    if (catData) {
      const normalized = normalizeList(catData as any[], (c) => c.name);
      setCategories(
        normalized.map((c: any) => ({
          id: c.id,
          name: normalizeCategoryName(c.name),
          type: c.type,
          color: c.color,
          icon: c.icon,
          tags: c.tags ?? [],
          usage_count: counts[c.id] ?? 0,
        }))
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("categories-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  async function openDeleteDialog(cat: Category) {
    setConfirmDelete(cat);
    setUsageLoading(true);
    const supabase = createClient();
    const { count } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("category_id", cat.id);
    setUsageCount(count ?? 0);
    setUsageLoading(false);
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("categories")
      .delete()
      .eq("id", confirmDelete.id)
      .select("id");
    setDeleting(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data || data.length === 0) {
      toast.error("Não foi possível excluir.");
      return;
    }

    const parts: string[] = [`Categoria "${confirmDelete.name}" removida`];
    if (usageCount > 0) parts.push(`${usageCount} transação(ões) desvinculada(s)`);
    toast.success(parts.join(" · "));

    setConfirmDelete(null);
    load();
  }

  const grouped = useMemo(() => ({
    expense: categories.filter((c) => c.type === "expense"),
    income: categories.filter((c) => c.type === "income"),
  }), [categories]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    categories.forEach((c) => c.tags?.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [categories]);

  function CategoryRow({ cat }: { cat: Category }) {
    const usage = cat.usage_count ?? 0;
    return (
      <Card>
        <CardContent className="flex items-center justify-between p-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
              style={{ backgroundColor: `${cat.color}20`, color: cat.color }}
            >
              <CategoryIcon icon={cat.icon} className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium truncate">{cat.name}</p>
                <Badge variant="outline" className="text-[10px] gap-1 shrink-0 font-normal">
                  <Hash className="h-2.5 w-2.5" />
                  {cat.color.toUpperCase()}
                </Badge>
              </div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {cat.tags && cat.tags.length > 0 ? (
                  cat.tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="text-[10px] font-normal"
                      style={{ backgroundColor: `${cat.color}15`, color: cat.color }}
                    >
                      {tag}
                    </Badge>
                  ))
                ) : (
                  <span className="text-[10px] text-muted-foreground italic">sem tags</span>
                )}
                {usage > 0 && (
                  <span className="text-[10px] text-muted-foreground">· {usage} {usage === 1 ? "uso" : "usos"}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => { setEditing(cat); setDialogOpen(true); }}
              title="Editar"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={() => openDeleteDialog(cat)}
              title="Excluir"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  function EmptySection({ type }: { type: "expense" | "income" }) {
    const meta = TYPE_META[type];
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground border border-dashed rounded-lg">
        <Inbox className="mb-2 h-6 w-6 opacity-50" />
        <p className="text-sm">Nenhuma categoria de {meta.label.toLowerCase()} cadastrada</p>
      </div>
    );
  }

  function Section({ type }: { type: "expense" | "income" }) {
    const meta = TYPE_META[type];
    const list = grouped[type];
    return (
      <TabsContent value={type} className="mt-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {type === "expense" ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
            <span className="font-medium">
              {list.length} {list.length === 1 ? "categoria" : "categorias"} de {meta.label.toLowerCase()}
            </span>
          </div>
        </div>
        {list.length === 0 ? (
          <EmptySection type={type} />
        ) : (
          <div className="space-y-2">
            {list.map((cat) => <CategoryRow key={cat.id} cat={cat} />)}
          </div>
        )}
      </TabsContent>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Categorias</h1>
          <p className="text-sm text-muted-foreground">
            Organize receitas e despesas com cores, ícones e tags
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nova categoria
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Editar categoria" : "Nova categoria"}</DialogTitle>
            </DialogHeader>
            <CategoryForm
              defaultValues={
                editing
                  ? {
                      id: editing.id,
                      name: editing.name,
                      type: editing.type,
                      color: editing.color,
                      icon: editing.icon ?? "",
                      tags: editing.tags ?? [],
                    }
                  : undefined
              }
              allTags={allTags}
              onSuccess={() => { setDialogOpen(false); setEditing(null); load(); }}
              onCancel={() => { setDialogOpen(false); setEditing(null); }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {allTags.length > 0 && (
        <div className="rounded-lg border bg-muted/30 px-3 py-2 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Tags em uso:</span>
          {allTags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando categorias...
        </div>
      ) : categories.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Tag className="mb-2 h-8 w-8 opacity-50" />
          <p className="font-medium">Nenhuma categoria cadastrada</p>
          <p className="text-xs mt-1">Crie sua primeira categoria acima</p>
        </div>
      ) : (
        <Tabs defaultValue="expense">
          <TabsList>
            <TabsTrigger value="expense" className="gap-1.5">
              <TrendingDown className="h-3.5 w-3.5" />
              Despesas ({grouped.expense.length})
            </TabsTrigger>
            <TabsTrigger value="income" className="gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" />
              Receitas ({grouped.income.length})
            </TabsTrigger>
          </TabsList>
          <Section type="expense" />
          <Section type="income" />
        </Tabs>
      )}

      {/* Confirmação de exclusão */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && !deleting && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir categoria?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            {confirmDelete && (
              <div className="rounded border bg-muted/30 p-3 text-sm flex items-center gap-3">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
                  style={{ backgroundColor: `${confirmDelete.color}20`, color: confirmDelete.color }}
                >
                  <CategoryIcon icon={confirmDelete.icon} className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium truncate">{confirmDelete.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {confirmDelete.type === "expense" ? "Despesa" : "Receita"}
                    {confirmDelete.tags && confirmDelete.tags.length > 0 && ` · ${confirmDelete.tags.join(", ")}`}
                  </p>
                </div>
              </div>
            )}

            {usageLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Verificando...
              </div>
            ) : usageCount > 0 ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 p-3 flex gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-900 dark:text-amber-200">
                  {usageCount} transação(ões) vinculada(s) serão desvinculadas automaticamente.
                </div>
              </div>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting || usageLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
