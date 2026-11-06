import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// VITE_BASE lets the same code run at "/" (hub.velite.in) or under a sub-path (GitHub Pages).
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || "/",
});
