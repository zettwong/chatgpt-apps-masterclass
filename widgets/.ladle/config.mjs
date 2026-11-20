/** @type {import('@ladle/react').UserConfig} */
export default {
  // Ladle 5 runs on its own Vite 6, but the project's vite.config.ts uses
  // @vitejs/plugin-react 6 (built for Vite 8). Loading it breaks Ladle's dev
  // server (blank page, 404s), so Ladle gets its own minimal Vite config.
  viteConfig: ".ladle/vite.config.mjs",
};
