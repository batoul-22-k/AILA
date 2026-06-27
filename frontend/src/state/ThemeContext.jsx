import { createContext, useContext, useEffect, useMemo } from "react";

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  useEffect(() => {
    document.documentElement.classList.remove("dark");
    window.localStorage.setItem("theme", "light");
  }, []);

  const value = useMemo(
    () => ({
      theme: "light",
      toggleTheme: () => {},
    }),
    [],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
