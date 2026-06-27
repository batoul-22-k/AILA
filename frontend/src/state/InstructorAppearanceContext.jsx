import { createContext, useContext, useEffect, useMemo, useState } from "react";

export const appPalettes = {
  "soft-mint-dashboard": {
    name: "Soft Mint Dashboard",
    feeling: "Airy SaaS workspace with white surfaces, soft shadows, mint accents, and calm teal controls.",
    colors: {
      bg: "#F4F5F4",
      surface: "#FFFFFF",
      softSurface: "#F8FAF8",
      primary: "#2B7886",
      accent: "#79D99C",
      success: "#79D99C",
      warning: "#F4B860",
      error: "#EF6B6B",
      text: "#101418",
      muted: "#6B7280",
      border: "#E8ECEA",
    },
  },
  "academic-classic": {
    name: "Academic Classic",
    feeling: "Classical modern academic workspace with ink, prussian blue, denim, and alabaster tones.",
    colors: {
      bg: "#E0E1DD",
      surface: "#F7F8F5",
      primary: "#1B263B",
      accent: "#415A77",
      success: "#3F6F58",
      text: "#0D1B2A",
      border: "#778DA9",
    },
  },
  "modern-slate": {
    name: "Modern Slate",
    feeling: "Focused, minimal, professional.",
    colors: {
      bg: "#F8FAFC",
      surface: "#FFFFFF",
      primary: "#334155",
      accent: "#0369A1",
      success: "#15803D",
      text: "#1E293B",
      border: "#E2E8F0",
    },
  },
  "teal-professional": {
    name: "Teal Professional",
    feeling: "Fresh, calm, eye-comfortable.",
    colors: {
      bg: "#F7F7F5",
      surface: "#FFFFFF",
      primary: "#0F766E",
      accent: "#0EA5A4",
      success: "#2E7D32",
      text: "#243B3A",
      border: "#DDE5E3",
    },
  },
};

export const densityOptions = {
  comfortable: "Comfortable",
  compact: "Compact",
  focus: "Focus Mode",
};

export const layoutOptions = {
  "sidebar-classic": "Sidebar Classic",
  "collapsible-sidebar": "Collapsible Sidebar",
  "top-navigation": "Top Navigation",
};

export const motionOptions = {
  smooth: "Smooth",
  minimal: "Minimal",
  reduced: "Reduced Motion",
};

export const accessibilityOptions = {
  standard: "Standard",
  "high-contrast": "High Contrast",
  readable: "Readable Text",
};

const defaults = {
  palette: "soft-mint-dashboard",
  density: "comfortable",
  layout: "sidebar-classic",
  motion: "smooth",
  accessibility: "standard",
};

const storageKey = "instructorAppearance";
const appStorageKey = "appAppearance";
const InstructorAppearanceContext = createContext(null);

function getStoredAppearance() {
  try {
    const stored = window.localStorage.getItem(appStorageKey) || window.localStorage.getItem(storageKey) || "{}";
    const parsed = JSON.parse(stored);
    if (!parsed.palette || parsed.palette === "academic-classic" || !appPalettes[parsed.palette]) parsed.palette = defaults.palette;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

function toCssVars(paletteKey) {
  const palette = appPalettes[paletteKey] ?? appPalettes[defaults.palette];
  return {
    "--color-bg": palette.colors.bg,
    "--color-surface": palette.colors.surface,
    "--color-soft-surface": palette.colors.softSurface ?? "#F8FAF8",
    "--color-primary": palette.colors.primary,
    "--color-accent": palette.colors.accent,
    "--color-success": palette.colors.success,
    "--color-warning": palette.colors.warning ?? "#F4B860",
    "--color-error": palette.colors.error ?? "#EF6B6B",
    "--color-text": palette.colors.text,
    "--color-border": palette.colors.border,
    "--color-muted": palette.colors.muted ?? "color-mix(in srgb, var(--color-text) 64%, transparent)",
    "--role-bg": "var(--color-bg)",
    "--role-surface": "var(--color-surface)",
    "--role-primary": "var(--color-primary)",
    "--role-primary-strong": "var(--color-primary)",
    "--role-accent": "var(--color-accent)",
    "--role-secondary": "var(--color-success)",
    "--role-info": "color-mix(in srgb, var(--color-primary) 10%, var(--color-surface))",
    "--role-error": "var(--color-error)",
    "--role-soft": "color-mix(in srgb, var(--color-accent) 18%, var(--color-surface))",
    "--role-hover": "var(--color-soft-surface)",
    "--role-text": "var(--color-text)",
    "--role-border": "var(--color-border)",
    "--role-glow": "rgba(43, 120, 134, 0.14)",
    "--role-card-border": "rgba(15, 23, 42, 0.06)",
    "--role-card-shadow": "0 18px 45px rgba(15, 23, 42, 0.08)",
    "--role-radius": "28px",
    "--role-card-padding": "1.5rem",
    "--role-dark-soft": "color-mix(in srgb, var(--color-primary) 20%, transparent)",
    "--role-dark-text": "var(--color-primary)",
  };
}

export function InstructorThemeProvider({ children }) {
  const [appearance, setAppearanceState] = useState(getStoredAppearance);

  useEffect(() => {
    window.localStorage.setItem(appStorageKey, JSON.stringify(appearance));
    window.localStorage.setItem(storageKey, JSON.stringify(appearance));
    document.documentElement.setAttribute("data-app-theme", appearance.palette);
    document.documentElement.setAttribute("data-instructor-theme", appearance.palette);
    document.documentElement.setAttribute("data-density", appearance.density);
    document.documentElement.setAttribute("data-layout-style", appearance.layout);
    document.documentElement.setAttribute("data-motion", appearance.motion);
    document.documentElement.setAttribute("data-accessibility", appearance.accessibility);
  }, [appearance]);

  const value = useMemo(
    () => ({
      ...appearance,
      cssVars: toCssVars(appearance.palette),
      paletteMeta: appPalettes[appearance.palette] ?? appPalettes[defaults.palette],
      setAppearance: (patch) => setAppearanceState((current) => ({ ...current, ...patch })),
      resetAppearance: () => setAppearanceState(defaults),
    }),
    [appearance],
  );

  return <InstructorAppearanceContext.Provider value={value}>{children}</InstructorAppearanceContext.Provider>;
}

export function useInstructorAppearance() {
  const context = useContext(InstructorAppearanceContext);
  if (!context) throw new Error("useInstructorAppearance must be used inside InstructorThemeProvider");
  return context;
}

export const instructorPalettes = appPalettes;
export const AppAppearanceProvider = InstructorThemeProvider;
export const useAppAppearance = useInstructorAppearance;
