// Vite config used only by Ladle. Ladle adds its own React plugin.
// Tailwind is needed so the utility classes in components (and Apps SDK UI) get styles.
import tailwindcss from "@tailwindcss/vite";

export default {
  plugins: [tailwindcss()],
};
