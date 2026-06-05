import { create } from "zustand";

interface TransactionDrawerState {
  open: boolean;
  transactionId: string | null;
  openDrawer: (id?: string) => void;
  closeDrawer: () => void;
}

export const useTransactionDrawer = create<TransactionDrawerState>((set) => ({
  open: false,
  transactionId: null,
  openDrawer: (id?: string) => set({ open: true, transactionId: id ?? null }),
  closeDrawer: () => set({ open: false, transactionId: null }),
}));
