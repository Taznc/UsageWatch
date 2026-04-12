import { useEffect, useRef } from "react";
import { load } from "@tauri-apps/plugin-store";
import type { Store } from "@tauri-apps/plugin-store";
import { useWidget } from "../context/WidgetContext";
import { DEFAULT_WIDGET_PREFERENCES, type WidgetLayout } from "../types/widget";
import { isTauriRuntime } from "../widget/preview";

const STORE_KEY = "widget_layout";

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

function normalizeLayout(saved: unknown): WidgetLayout | null {
  if (!saved || typeof saved !== "object") return null;
  const candidate = saved as {
    version?: unknown;
    position?: { x?: unknown; y?: unknown };
    preferences?: WidgetLayout["preferences"];
  };

  const x = typeof candidate.position?.x === "number" ? candidate.position.x : 200;
  const y = typeof candidate.position?.y === "number" ? candidate.position.y : 100;

  return {
    version: typeof candidate.version === "number" ? candidate.version : 1,
    position: { x, y },
    preferences: {
      ...DEFAULT_WIDGET_PREFERENCES,
      ...candidate.preferences,
      claude: {
        ...DEFAULT_WIDGET_PREFERENCES.claude,
        ...candidate.preferences?.claude,
      },
      codex: {
        ...DEFAULT_WIDGET_PREFERENCES.codex,
        ...candidate.preferences?.codex,
      },
      cursor: {
        ...DEFAULT_WIDGET_PREFERENCES.cursor,
        ...candidate.preferences?.cursor,
      },
    },
  };
}

export function useWidgetStore() {
  const { state, dispatch } = useWidget();
  const storeRef = useRef<Store | null>(null);
  const tauri = isTauriRuntime();

  useEffect(() => {
    if (!tauri) return;
    async function init() {
      const store = await load("credentials.json", { autoSave: false, defaults: {} });
      storeRef.current = store;
      const saved = normalizeLayout(await store.get(STORE_KEY));
      if (saved) {
        dispatch({ type: "SET_LAYOUT", layout: saved });
      }
    }
    init();
  }, [dispatch, tauri]);

  const saveRef = useRef(
    debounce(async (layout: WidgetLayout, store: Store | null) => {
      if (!store) return;
      await store.set(STORE_KEY, layout);
      await store.save();
    }, 300)
  );

  useEffect(() => {
    if (!tauri) return;
    saveRef.current(state.layout, storeRef.current);
  }, [state.layout, tauri]);

  function savePosition(x: number, y: number) {
    dispatch({
      type: "SET_LAYOUT",
      layout: { ...state.layout, position: { x, y } },
    });
  }

  return { savePosition };
}
