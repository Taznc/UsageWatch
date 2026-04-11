/**
 * Handles loading/saving the widget layout from tauri-plugin-store.
 * Call this ONCE from WidgetWindow. Child components dispatch actions
 * to WidgetContext directly; this hook observes state changes and persists them.
 */
import { useEffect, useRef } from "react";
import { load } from "@tauri-apps/plugin-store";
import type { Store } from "@tauri-apps/plugin-store";
import { useWidget } from "../context/WidgetContext";
import type { WidgetLayout } from "../types/widget";

const STORE_KEY = "widget_layout";

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

export function useWidgetStore() {
  const { state, dispatch } = useWidget();
  const storeRef = useRef<Store | null>(null);

  // Load saved layout once on mount
  useEffect(() => {
    async function init() {
      const store = await load("credentials.json", { autoSave: false, defaults: {} });
      storeRef.current = store;
      const saved = await store.get<WidgetLayout>(STORE_KEY);
      if (saved && Array.isArray(saved.placedTiles) && saved.placedTiles.length > 0) {
        dispatch({
          type: "SET_LAYOUT",
          layout: {
            ...saved,
            version: 1,
            columns: saved.columns === 1 ? 1 : 2, // normalise
          },
        });
      }
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist whenever layout changes (debounced to avoid hammering disk)
  const saveRef = useRef(
    debounce(async (layout: WidgetLayout, store: Store | null) => {
      if (!store) return;
      await store.set(STORE_KEY, layout);
      await store.save();
    }, 300)
  );

  useEffect(() => {
    saveRef.current(state.layout, storeRef.current);
  }, [state.layout]);

  // Position is saved from WidgetWindow's onMoved event
  function savePosition(x: number, y: number) {
    dispatch({
      type: "SET_LAYOUT",
      layout: { ...state.layout, position: { x, y } },
    });
  }

  return { savePosition };
}
