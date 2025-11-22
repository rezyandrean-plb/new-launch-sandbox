import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#B40101",
        "primary-dark": "#950101",
        dark: "#0F0F0F",
        background: "#F5F5F5",
        foreground: "#0F0F0F",
      },
    },
  },
  plugins: [],
};

export default config;
