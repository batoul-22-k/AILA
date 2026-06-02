export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#172033",
        cloud: "#f6f8fc",
        role: {
          bg: "var(--role-bg)",
          surface: "var(--role-surface)",
          primary: "var(--role-primary)",
          accent: "var(--role-accent)",
          text: "var(--role-text)",
          soft: "var(--role-soft)",
          hover: "var(--role-hover)",
          border: "var(--role-border)",
          glow: "var(--role-glow)",
          secondary: "var(--role-secondary)",
        },
        brand: {
          50: "#effaf9",
          100: "#d8f3f1",
          500: "#16a3a3",
          600: "#0d8587",
          700: "#0f6d70",
        },
        coral: "#f26d5b",
        gold: "#f5b84b",
        violet: "#8067dc",
      },
      borderRadius: {
        smart: "16px",
      },
      boxShadow: {
        soft: "0 16px 40px rgba(15, 23, 42, 0.07)",
        lift: "0 24px 70px rgba(15, 23, 42, 0.12)",
        glass: "0 18px 55px rgba(15, 23, 42, 0.09)",
      },
    },
  },
  plugins: [],
};
