import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { invoke, listen } from "./tauri";
import { DEFAULT_SETTINGS, type Settings } from "./types";

interface SettingsContextValue {
  settings: Settings;
  loaded: boolean;
  save: (patch: Partial<Settings>) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  save: async () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    invoke<Settings>("get_settings")
      .then((s) => {
        if (alive) setSettings({ ...DEFAULT_SETTINGS, ...s });
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoaded(true);
      });
    listen<Settings>("settings-changed", (s) => setSettings({ ...DEFAULT_SETTINGS, ...s })).then((u) => {
      if (alive) unlisten = u;
      else u();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const save = useCallback(
    async (patch: Partial<Settings>) => {
      let next: Settings = settings;
      setSettings((prev) => {
        next = { ...prev, ...patch };
        return next;
      });
      // setSettings cập nhật đồng bộ ở trên trong React 19 khi gọi từ sự kiện;
      // vẫn tính lại để chắc chắn gửi bản mới nhất.
      next = { ...settings, ...patch };
      await invoke("save_settings", { settings: next });
    },
    [settings],
  );

  return <SettingsContext.Provider value={{ settings, loaded, save }}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  return useContext(SettingsContext);
}
