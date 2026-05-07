/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ARCADE PHANTOM — base
        void:     "#06060A",
        coal:     "#0E0E14",
        ink:      "#14141C",
        dust:     "#1F1F2A",
        haze:     "#2A2A38",
        bone:     "#F5F5F0",
        ash:      "#9494A6",
        ghost:    "#5A5A6A",
        // Brand neons
        phosphor: "#CCFF00", // primary CRT lime
        magenta:  "#FF1F8A", // arcade pink
        plasma:   "#FF6B00", // warning orange
        ultra:    "#00E0FF", // electric blue accent
        blood:    "#FF2D2D", // alarm red
      },
      fontFamily: {
        display: ['"Bungee"', "system-ui", "sans-serif"],
        head:    ['"Anton"', "Impact", "sans-serif"],
        body:    ['"Sora"', "system-ui", "sans-serif"],
        mono:    ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      letterSpacing: {
        brutal: "-0.04em",
        wider2: "0.18em",
      },
      boxShadow: {
        "phosphor": "0 0 24px rgba(204,255,0,0.45), 0 0 64px rgba(204,255,0,0.15)",
        "magenta":  "0 0 24px rgba(255,31,138,0.45), 0 0 64px rgba(255,31,138,0.15)",
        "plasma":   "0 0 24px rgba(255,107,0,0.45)",
        "card":     "0 30px 60px -20px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.04)",
        "inset-edge": "inset 0 0 0 1px rgba(255,255,255,0.06)",
      },
      animation: {
        "marquee":         "marquee 40s linear infinite",
        "marquee-slow":    "marquee 90s linear infinite",
        "marquee-reverse": "marquee-reverse 55s linear infinite",
        "grid-drift":      "grid-drift 60s linear infinite",
        "scan-line":       "scan-line 6s linear infinite",
        "flicker":         "flicker 6s linear infinite",
        "pulse-ring":      "pulse-ring 2.4s ease-out infinite",
        "spin-slow":       "spin 18s linear infinite",
        "spin-slower":     "spin 32s linear infinite reverse",
        "ticker-flip":     "ticker-flip 0.8s ease-out",
        "blink-caret":     "blink-caret 1s step-end infinite",
        "noise":           "noise 0.8s steps(8) infinite",
      },
      keyframes: {
        marquee: {
          "0%":   { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        "marquee-reverse": {
          "0%":   { transform: "translateX(-50%)" },
          "100%": { transform: "translateX(0)" },
        },
        "grid-drift": {
          "0%":   { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "60px 60px" },
        },
        "scan-line": {
          "0%":   { transform: "translateY(-10vh)" },
          "100%": { transform: "translateY(110vh)" },
        },
        flicker: {
          "0%, 100%":         { opacity: "1" },
          "1.5%, 1.7%":       { opacity: "0.4" },
          "1.6%":             { opacity: "0.85" },
          "60%, 60.4%":       { opacity: "0.7" },
        },
        "pulse-ring": {
          "0%":   { transform: "scale(0.6)", opacity: "0.85" },
          "80%":  { transform: "scale(2.2)", opacity: "0" },
          "100%": { transform: "scale(2.2)", opacity: "0" },
        },
        "ticker-flip": {
          "0%":   { transform: "translateY(100%)", opacity: "0" },
          "100%": { transform: "translateY(0)",    opacity: "1" },
        },
        "blink-caret": {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0" },
        },
        noise: {
          "0%":   { transform: "translate(0,0)" },
          "20%":  { transform: "translate(-2%,1%)" },
          "40%":  { transform: "translate(1%,-2%)" },
          "60%":  { transform: "translate(-1%,2%)" },
          "80%":  { transform: "translate(2%,-1%)" },
          "100%": { transform: "translate(0,0)" },
        },
      },
      backgroundImage: {
        "grid-phosphor": "linear-gradient(rgba(204,255,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(204,255,0,0.05) 1px, transparent 1px)",
        "grid-fine":     "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
        "radial-vignette": "radial-gradient(ellipse at center, transparent 0%, rgba(6,6,10,0.95) 70%)",
      },
    },
  },
  plugins: [],
};
