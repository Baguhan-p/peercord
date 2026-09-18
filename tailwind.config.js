/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        d: {
          950: "#111214",
          900: "#1e1f22",
          850: "#232428",
          800: "#2b2d31",
          750: "#2f3136",
          700: "#313338",
          650: "#35373c",
          600: "#383a40",
          500: "#4e5058",
          400: "#6d6f78",
          300: "#949ba4",
          200: "#b5bac1",
          100: "#dbdee1",
          text: "#f2f3f5",
          accent: "#5865f2",
          "accent-hover": "#4752c4",
          green: "#23a55a",
          yellow: "#f0b232",
          red: "#f23f43",
        },
      },
      fontFamily: {
        sans: [
          "gg sans",
          "Noto Sans",
          "Helvetica Neue",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "Consolas", "Menlo", "monospace"],
      },
      keyframes: {
        "pulse-ring": {
          "0%": { transform: "scale(0.85)", opacity: "0.7" },
          "70%": { transform: "scale(1.6)", opacity: "0" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 1.8s cubic-bezier(0.4,0,0.6,1) infinite",
      },
    },
  },
  plugins: [],
};
