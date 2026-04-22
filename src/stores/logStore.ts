import { create } from "zustand";
import type { LogEvent } from "../lib/types";

const MAX = 200;

type LogLine = LogEvent & { id: number; timestamp: string };

type State = {
  lines: LogLine[];
};

type Actions = {
  push: (level: LogEvent["level"], message: string) => void;
  clear: () => void;
};

let counter = 0;

export const useLogStore = create<State & Actions>((set) => ({
  lines: [],
  push(level, message) {
    const line: LogLine = {
      id: ++counter,
      level,
      message,
      timestamp: new Date().toISOString(),
    };
    set((s) => {
      const next = [...s.lines, line];
      if (next.length > MAX) next.splice(0, next.length - MAX);
      return { lines: next };
    });
  },
  clear() {
    set({ lines: [] });
  },
}));

export function pushLog(level: LogEvent["level"], message: string): void {
  useLogStore.getState().push(level, message);
}
