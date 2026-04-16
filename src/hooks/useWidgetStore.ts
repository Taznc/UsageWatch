import { useEffect, useRef, useState } from "react";
import { load } from "@tauri-apps/plugin-store";
import type { Store } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";
import { useWidget } from "../context/WidgetContext";
import { isTauriRuntime } from "../widget/preview";
import type { WidgetOverlayLayout } from "../types/widget";
import { normalizeWidgetOverlayLayout, WIDGET_LAYOUT_STORE_KEY } from "../widget/layout";

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
  const tauri = isTauriRuntime();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!tauri) return;
    async function init() {
      const store = await load("credentials.json", { autoSave: false, defaults: {} });
      storeRef.current = store;
      dispatch({ type: "SET_LAYOUT", layout: normalizeWidgetOverlayLayout(await store.get(WIDGET_LAYOUT_STORE_KEY)) });
      setHydrated(true);
    }
    init();
  }, [dispatch, tauri]);

  useEffect(() => {
    if (!tauri) return;
    const unlisten = listen<WidgetOverlayLayout>("widget-layout-updated", (event) => {
      dispatch({ type: "SET_LAYOUT", layout: normalizeWidgetOverlayLayout(event.payload) });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [dispatch, tauri]);

  const saveRef = useRef(
    debounce(async (layout: WidgetOverlayLayout, store: Store | null) => {
      if (!store) return;
      await store.set(WIDGET_LAYOUT_STORE_KEY, layout);
      await store.save();
      await emit("widget-layout-updated", layout);
    }, 120)
  );

  function savePosition(x: number, y: number) {
    const layout = { ...state.layout, position: { x, y } };
    dispatch({ type: "SET_LAYOUT", layout });
    if (tauri) {
      saveRef.current(layout, storeRef.current);
    }
  }

  function saveLayout(layout: WidgetOverlayLayout) {
    dispatch({ type: "SET_LAYOUT", layout });
    if (tauri) {
      saveRef.current(layout, storeRef.current);
    }
  }

  return { savePosition, saveLayout, hydrated };
}
