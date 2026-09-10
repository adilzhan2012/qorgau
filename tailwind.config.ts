import type { Config } from "tailwindcss";

/**
 * One theme only: Apple's dark mode. The palette is dark-first, so components
 * use the base token names directly — there are no `dark:` variants to keep in
 * sync, and nothing renders light by accident.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Display",
          "SF Pro Text",
          "Inter",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      colors: {
        // Graphite stack — deep, never pure black
        canvas: "#1C1C1E",
        surface: "#2C2C2E",
        raised: "#3A3A3C",
        ink: "#F5F5F7",
        muted: "#98989D",
        faint: "#6E6E73",

        // Mint / spring green — Apple's system green, pulled back a shade
        accent: {
          DEFAULT: "#35D07F",
          dim: "#2AA867",
          soft: "rgba(53, 208, 127, 0.12)",
        },
        // Statuses, muted — never neon
        alarm: {
          DEFAULT: "#E8705F",
          soft: "rgba(232, 112, 95, 0.12)",
        },
        warn: {
          DEFAULT: "#E0A33F",
          soft: "rgba(224, 163, 63, 0.12)",
        },
      },
      borderRadius: {
        "4xl": "1.75rem",
        "5xl": "2.25rem",
      },
      boxShadow: {
        // Depth comes from shadow, not from borders
        card: "0 1px 2px rgba(0,0,0,0.30), 0 6px 20px rgba(0,0,0,0.28)",
        lifted: "0 2px 8px rgba(0,0,0,0.34), 0 18px 50px rgba(0,0,0,0.44)",
        glow: "0 0 0 1px rgba(255,255,255,0.05), 0 8px 28px rgba(0,0,0,0.40)",
      },
      letterSpacing: {
        tightest: "-0.03em",
      },
      transitionTimingFunction: {
        apple: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      keyframes: {
        // Soft breathing halo for alert markers — fade/scale, never a flash
        breathe: {
          "0%, 100%": { opacity: "0.42", transform: "scale(1)" },
          "50%": { opacity: "0.06", transform: "scale(1.9)" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        // Progress bars fill in rather than snapping to width
        grow: {
          from: { transform: "scaleX(0)" },
          to: { transform: "scaleX(1)" },
        },
      },
      animation: {
        breathe: "breathe 3.2s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        "fade-up": "fade-up 0.4s cubic-bezier(0.4, 0, 0.2, 1) both",
        "fade-in": "fade-in 0.3s cubic-bezier(0.4, 0, 0.2, 1) both",
        grow: "grow 0.7s cubic-bezier(0.4, 0, 0.2, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
