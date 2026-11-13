import React, { createContext, useContext, useState, useEffect } from "react";
import { Palette, RotateCcw, X } from "lucide-react";

// ============================================================================
// 1. DESIGN TOKENS (TEMA DEĞİŞKENLERİ) TANIMLARI
// ============================================================================
export type ThemePresetId =
  | "ELEKTRA_PRO"
  | "MIDNIGHT_SLATE"
  | "WARM_BOUTIQUE"
  | "HIGH_CONTRAST";
export type BorderRadiusToken = "NONE" | "COMPACT" | "ROUNDED" | "PILL";
export type DensityToken = "COMPACT" | "COMFORTABLE";

export interface DesignTokens {
  presetId: ThemePresetId;
  headerBg: string;
  headerText: string;
  accentColor: string;
  surfaceBg: string;
  cardBg: string;
  borderRadius: BorderRadiusToken;
  density: DensityToken;
  // Rack Pastel Durum Renkleri (Özelleştirilebilir)
  rackInhouseBg: string;
  rackAvailableBg: string;
  rackDueOutBg: string;
  rackBlockedBg: string;
}

export const THEME_PRESETS: Record<ThemePresetId, { label: string; tokens: DesignTokens }> = {
  ELEKTRA_PRO: {
    label: "Klasik PMS (Lacivert / Gri)",
    tokens: {
      presetId: "ELEKTRA_PRO",
      headerBg: "#0f172a",
      headerText: "#f8fafc",
      accentColor: "#0284c7",
      surfaceBg: "#f1f5f9",
      cardBg: "#ffffff",
      borderRadius: "COMPACT",
      density: "COMPACT",
      rackInhouseBg: "#e0f2fe",
      rackAvailableBg: "#d1fae5",
      rackDueOutBg: "#fef3c7",
      rackBlockedBg: "#ffe4e6",
    },
  },
  MIDNIGHT_SLATE: {
    label: "Gece Vardiyası (Koyu Antrasit)",
    tokens: {
      presetId: "MIDNIGHT_SLATE",
      headerBg: "#09090b",
      headerText: "#fafafa",
      accentColor: "#6366f1",
      surfaceBg: "#e2e8f0",
      cardBg: "#f8fafc",
      borderRadius: "ROUNDED",
      density: "COMFORTABLE",
      rackInhouseBg: "#dbeafe",
      rackAvailableBg: "#dcfce7",
      rackDueOutBg: "#ffedd5",
      rackBlockedBg: "#fee2e2",
    },
  },
  WARM_BOUTIQUE: {
    label: "Butik Otel (Sıcak Kum / Zümrüt)",
    tokens: {
      presetId: "WARM_BOUTIQUE",
      headerBg: "#1c1917",
      headerText: "#fafaf9",
      accentColor: "#059669",
      surfaceBg: "#f5f5f4",
      cardBg: "#ffffff",
      borderRadius: "ROUNDED",
      density: "COMFORTABLE",
      rackInhouseBg: "#e0f2fe",
      rackAvailableBg: "#d1fae5",
      rackDueOutBg: "#fef9c3",
      rackBlockedBg: "#fecdd3",
    },
  },
  HIGH_CONTRAST: {
    label: "Yüksek Kontrast (Net Okuma)",
    tokens: {
      presetId: "HIGH_CONTRAST",
      headerBg: "#000000",
      headerText: "#ffffff",
      accentColor: "#2563eb",
      surfaceBg: "#e5e7eb",
      cardBg: "#ffffff",
      borderRadius: "NONE",
      density: "COMPACT",
      rackInhouseBg: "#bae6fd",
      rackAvailableBg: "#bbf7d0",
      rackDueOutBg: "#fde68a",
      rackBlockedBg: "#fecaca",
    },
  },
};

const RADIUS_MAP: Record<BorderRadiusToken, string> = {
  NONE: "0px",
  COMPACT: "6px",
  ROUNDED: "12px",
  PILL: "18px",
};

interface ThemeContextValue {
  tokens: DesignTokens;
  updateToken: <K extends keyof DesignTokens>(key: K, value: DesignTokens[K]) => void;
  applyPreset: (presetId: ThemePresetId) => void;
  resetTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ============================================================================
// 2. THEME PROVIDER (CSS VARIABLES OLARAK TÜM UYGULAMAYA ENJEKTE EDER)
// ============================================================================
export function PmsThemeProvider({ children }: { children: React.ReactNode }) {
  const [tokens, setTokens] = useState<DesignTokens>(() => {
    if (typeof window === "undefined") return THEME_PRESETS.ELEKTRA_PRO.tokens;
    const saved = localStorage.getItem("stayflow_theme_tokens");
    if (saved) {
      try {
        return { ...THEME_PRESETS.ELEKTRA_PRO.tokens, ...JSON.parse(saved) };
      } catch {
        return THEME_PRESETS.ELEKTRA_PRO.tokens;
      }
    }
    return THEME_PRESETS.ELEKTRA_PRO.tokens;
  });

  // Değişiklikleri hem CSS değişkenlerine hem localStorage'a yaz
  useEffect(() => {
    localStorage.setItem("stayflow_theme_tokens", JSON.stringify(tokens));
    const root = document.documentElement;
    root.style.setProperty("--pms-header-bg", tokens.headerBg);
    root.style.setProperty("--pms-header-text", tokens.headerText);
    root.style.setProperty("--pms-accent", tokens.accentColor);
    root.style.setProperty("--pms-surface-bg", tokens.surfaceBg);
    root.style.setProperty("--pms-card-bg", tokens.cardBg);
    root.style.setProperty("--pms-radius", RADIUS_MAP[tokens.borderRadius]);
    root.style.setProperty("--pms-rack-inhouse", tokens.rackInhouseBg);
    root.style.setProperty("--pms-rack-available", tokens.rackAvailableBg);
    root.style.setProperty("--pms-rack-dueout", tokens.rackDueOutBg);
    root.style.setProperty("--pms-rack-blocked", tokens.rackBlockedBg);
  }, [tokens]);

  const updateToken = <K extends keyof DesignTokens>(key: K, value: DesignTokens[K]) => {
    setTokens((prev) => ({ ...prev, [key]: value }));
  };

  const applyPreset = (presetId: ThemePresetId) => {
    setTokens({ ...THEME_PRESETS[presetId].tokens });
  };

  const resetTheme = () => {
    setTokens({ ...THEME_PRESETS.ELEKTRA_PRO.tokens });
  };

  return (
    <ThemeContext.Provider value={{ tokens, updateToken, applyPreset, resetTheme }}>
      <div
        className={`min-h-screen bg-[var(--pms-surface-bg)] transition-colors duration-200 ${
          tokens.density === "COMPACT" ? "text-[12px]" : "text-[13px]"
        }`}
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function usePmsTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("usePmsTheme must be used inside PmsThemeProvider");
  return ctx;
}

// ============================================================================
// 3. CANLI TEMA ÖZELLEŞTİRME PANELİ (SAĞ ÜST BUTONDAN AÇILIR)
// ============================================================================
export function ThemeCustomizerDrawer() {
  const { tokens, updateToken, applyPreset, resetTheme } = usePmsTheme();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        title="Tema ve Görünüm Ayarları"
        className="flex items-center gap-1.5 px-2.5 py-2 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-sky-300 whitespace-nowrap cursor-pointer"
      >
        <Palette className="w-3.5 h-3.5" />
        <span>Tema</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex justify-end">
          <div className="w-80 bg-white h-full shadow-2xl border-l border-slate-300 p-4 flex flex-col justify-between overflow-y-auto text-slate-800 text-xs">
            <div className="flex flex-col gap-4">
              {/* Başlık */}
              <div className="flex items-center justify-between pb-2.5 border-b border-slate-200">
                <span className="font-extrabold text-sm flex items-center gap-1.5">
                  <Palette className="w-4 h-4 text-sky-600" />
                  <span>TEMA MOTORU (TOKENS)</span>
                </span>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="text-slate-400 hover:text-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* 1. Hazır Temalar */}
              <div>
                <label className="font-bold text-slate-600 block mb-1.5">
                  Hazır Tema Şablonu
                </label>
                <div className="grid grid-cols-1 gap-1.5">
                  {(Object.keys(THEME_PRESETS) as ThemePresetId[]).map((id) => (
                    <button
                      type="button"
                      key={id}
                      onClick={() => applyPreset(id)}
                      className={`px-3 py-2 rounded border text-left font-bold transition cursor-pointer ${
                        tokens.presetId === id
                          ? "border-sky-600 bg-sky-50 text-sky-900"
                          : "border-slate-200 hover:bg-slate-50 text-slate-700"
                      }`}
                    >
                      {THEME_PRESETS[id].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. Köşe Yuvarlaklığı */}
              <div>
                <label className="font-bold text-slate-600 block mb-1.5">
                  Köşe Yuvarlaklığı
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(["NONE", "COMPACT", "ROUNDED", "PILL"] as BorderRadiusToken[]).map((r) => (
                    <button
                      type="button"
                      key={r}
                      onClick={() => updateToken("borderRadius", r)}
                      className={`py-1.5 rounded border font-bold text-[10px] cursor-pointer ${
                        tokens.borderRadius === r
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white text-slate-700 border-slate-300"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* 3. Veri Yoğunluğu */}
              <div>
                <label className="font-bold text-slate-600 block mb-1.5">
                  Ekran Veri Yoğunluğu
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(["COMPACT", "COMFORTABLE"] as DensityToken[]).map((d) => (
                    <button
                      type="button"
                      key={d}
                      onClick={() => updateToken("density", d)}
                      className={`py-1.5 rounded border font-bold text-[11px] cursor-pointer ${
                        tokens.density === d
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white text-slate-700 border-slate-300"
                      }`}
                    >
                      {d === "COMPACT" ? "Yoğun" : "Ferah"}
                    </button>
                  ))}
                </div>
              </div>

              {/* 4. Özel Renk Seçiciler */}
              <div className="flex flex-col gap-2 pt-2 border-t border-slate-200">
                <span className="font-bold text-slate-600">Özel Renk Ayarları</span>
                <label className="flex items-center justify-between">
                  <span>Üst Menü Rengi</span>
                  <input
                    type="color"
                    value={tokens.headerBg}
                    onChange={(e) => updateToken("headerBg", e.target.value)}
                    className="w-8 h-6 cursor-pointer border-0"
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span>Vurgu / Aktif Sekme Rengi</span>
                  <input
                    type="color"
                    value={tokens.accentColor}
                    onChange={(e) => updateToken("accentColor", e.target.value)}
                    className="w-8 h-6 cursor-pointer border-0"
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span>Zemin Rengi</span>
                  <input
                    type="color"
                    value={tokens.surfaceBg}
                    onChange={(e) => updateToken("surfaceBg", e.target.value)}
                    className="w-8 h-6 cursor-pointer border-0"
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span>Kart Rengi</span>
                  <input
                    type="color"
                    value={tokens.cardBg}
                    onChange={(e) => updateToken("cardBg", e.target.value)}
                    className="w-8 h-6 cursor-pointer border-0"
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span>Rack: Inhouse Oda Rengi</span>
                  <input
                    type="color"
                    value={tokens.rackInhouseBg}
                    onChange={(e) => updateToken("rackInhouseBg", e.target.value)}
                    className="w-8 h-6 cursor-pointer border-0"
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span>Rack: Boş Oda Rengi</span>
                  <input
                    type="color"
                    value={tokens.rackAvailableBg}
                    onChange={(e) => updateToken("rackAvailableBg", e.target.value)}
                    className="w-8 h-6 cursor-pointer border-0"
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span>Rack: Due Out Oda Rengi</span>
                  <input
                    type="color"
                    value={tokens.rackDueOutBg}
                    onChange={(e) => updateToken("rackDueOutBg", e.target.value)}
                    className="w-8 h-6 cursor-pointer border-0"
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span>Rack: Kapalı / OOO Oda Rengi</span>
                  <input
                    type="color"
                    value={tokens.rackBlockedBg}
                    onChange={(e) => updateToken("rackBlockedBg", e.target.value)}
                    className="w-8 h-6 cursor-pointer border-0"
                  />
                </label>
              </div>
            </div>

            <button
              type="button"
              onClick={resetTheme}
              className="mt-4 flex items-center justify-center gap-1.5 w-full py-2 rounded border border-slate-300 hover:bg-slate-100 font-bold text-slate-700 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Varsayılan Temaya Dön</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
