import react from "@vitejs/plugin-react"
import path from "path"
import { defineConfig } from "vite"
import checker from "vite-plugin-checker"
import svgr from "vite-plugin-svgr"

export default defineConfig(() => {
  return {
    // Relative asset URLs, so a self-hosted build works at the domain root
    // and under a sub path without being rebuilt.
    base: "./",
    plugins: [
      checker({
        typescript: true,
      }),
      react(),
      svgr({
        include: "**/*.svg",
        svgrOptions: {
          plugins: ["@svgr/plugin-svgo", "@svgr/plugin-jsx"],
          exportType: "default",
        },
      }),
    ],
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, "edit.html"),
        },
      },
      minify: false,
      sourcemap: true,
    },
    publicDir: "public",
    server: {
      port: 3000,
      open: "/edit",
    },
    resolve: {
      alias: {
        react: path.resolve("../node_modules/react"),
      },
      dedupe: ["react", "react-dom"],
    },
    envDir: "..",
  }
})
