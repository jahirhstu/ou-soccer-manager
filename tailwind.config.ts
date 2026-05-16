import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        pitch: "#0f7a4a",
        ink: "#18212f",
        line: "#dce5df"
      },
      boxShadow: {
        soft: "0 14px 40px rgba(20, 32, 27, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
