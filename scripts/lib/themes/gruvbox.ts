import type { Theme } from "../types";

export const gruvboxTheme: Theme = {
  name: "gruvbox",
  displayName: "Gruvbox",
  colors: {
    primary: "#83a598", // Blue
    secondary: "#d3869b", // Purple
    accent: "#fe8019", // Orange

    error: "#fb4934", // Red
    warning: "#fabd2f", // Yellow
    success: "#b8bb26", // Green
    info: "#8ec07c", // Aqua

    text: "#ebdbb2", // Light0
    textMuted: "#928374", // Gray

    background: "#282828", // Bg0
    backgroundPanel: "#1d2021", // Bg0_h (hard)

    border: "#504945", // Bg2
    borderFocused: "#83a598",
  },
};
