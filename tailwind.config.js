/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // QUIET POWER — neutrals
        void:     "#06060A",   // pure deep
        carbon:   "#0B0B11",   // base canvas
        slate:    "#11111A",   // raised
        titanium: "#16161F",   // panel
        chrome:   "#1F1F2A",   // border / hairline
        steel:    "#2A2A36",
        bone:     "#F6F5F1",   // warm off-white text
        ash:      "#A2A2B0",   // secondary text
        ghost:    "#65656F",   // tertiary
        whisper:  "#3D3D48",   // hairline+
        // Brand accents (cyber-neon funk — taper through scroll)
        violet:   "#8B5CF6",   // hero primary
        mint:     "#5EEAD4",   // hero secondary
        flare:    "#F0ABFC",   // hero rare highlight
        deep:     "#5B21B6",   // violet darker
        // Refined accents (mid/lower)
        silver:   "#94A3B8",
        warm:     "#E2D8C5",   // editorial cream accent
      },
      fontFamily: {
        sans:    ['"Geist"', "ui-sans-serif", "system-ui", "sans-serif"],
        serif:   ['"Fraunces"', "ui-serif", "Georgia", "serif"],
        mono:    ['"Geist Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.06em",
        tighter2: "-0.045em",
        wider2:   "0.16em",
      },
      lineHeight: {
        crush: "0.85",
      },
      boxShadow: {
        "glow-violet":  "0 0 60px -10px rgba(139,92,246,0.65), 0 0 120px -20px rgba(139,92,246,0.25)",
        "glow-mint":    "0 0 60px -10px rgba(94,234,212,0.55), 0 0 120px -20px rgba(94,234,212,0.2)",
        "card-soft":    "0 30px 80px -30px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.04)",
        "edge":         "inset 0 0 0 1px rgba(255,255,255,0.06)",
        "edge-bright":  "inset 0 0 0 1px rgba(255,255,255,0.10)",
      },
      animation: {
        "marquee":         "marquee 50s linear infinite",
        "marquee-slow":    "marquee 120s linear infinite",
        "drift":           "drift 22s ease-in-out infinite",
        "drift-slow":      "drift 38s ease-in-out infinite",
        "shimmer":         "shimmer 3.2s linear infinite",
        "blink":           "blink 1.4s steps(2) infinite",
        "spin-slower":     "spin 28s linear infinite",
      },
      keyframes: {
        marquee: {
          "0%":   { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        drift: {
          "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1)" },
          "33%":      { transform: "translate3d(3%, -2%, 0) scale(1.05)" },
          "66%":      { transform: "translate3d(-2%, 3%, 0) scale(0.97)" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0" },
        },
      },
      backgroundImage: {
        "grid-soft":       "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
        "grid-violet":     "linear-gradient(rgba(139,92,246,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,0.06) 1px, transparent 1px)",
        "vignette":        "radial-gradient(ellipse at center, transparent 0%, rgba(6,6,10,0.85) 75%)",
        "shimmer-line":    "linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)",
      },
    },
  },
  plugins: [],
};
