"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TransactionForm } from "./transaction-form";
import { useTransactionDrawer } from "@/stores/transaction-drawer";

export function TransactionSheet() {
  const { open, transactionId, closeDrawer } = useTransactionDrawer();

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) closeDrawer(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{transactionId ? "Editar Transação" : "Nova Transação"}</DialogTitle>
          <DialogDescription>
            {transactionId ? "Altere os dados da transação" : "Preencha os dados da nova transação"}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          <TransactionForm
            defaultValues={transactionId ? { id: transactionId } : undefined}
            onSuccess={closeDrawer}
            onCancel={closeDrawer}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
