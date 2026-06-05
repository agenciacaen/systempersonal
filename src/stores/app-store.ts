import { create } from "zustand";

interface AppState {
  month: Date;
  setMonth: (month: Date) => void;
}

export const useAppStore = create<AppState>((set) => ({
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  setMonth: (month: Date) => set({ month }),
}));
