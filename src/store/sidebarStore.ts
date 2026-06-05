import { create } from "zustand";

interface SidebarState {
  isExpanded: boolean;
  isMobile: boolean;
  expand: () => void;
  collapse: () => void;
  toggle: () => void;
  setIsMobile: (isMobile: boolean) => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  isExpanded: false,
  isMobile: false,
  expand: () => set({ isExpanded: true }),
  collapse: () => set({ isExpanded: false }),
  toggle: () => set((state) => ({ isExpanded: !state.isExpanded })),
  setIsMobile: (isMobile) => set({ isMobile }),
}));
