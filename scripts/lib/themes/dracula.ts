import type { Theme } from "../types";

export const draculaTheme: Theme = {
  name: "dracula",
  displayName: "Dracula",
  colors: {
    primary: "#bd93f9", // Purple
    secondary: "#ff79c6", // Pink
    accent: "#8be9fd", // Cyan

    error: "#ff5555", // Red
    warning: "#f1fa8c", // Yellow
    success: "#50fa7b", // Green
    info: "#8be9fd", // Cyan

    text: "#f8f8f2", // Foreground
    textMuted: "#6272a4", // Comment

    background: "#282a36", // Background
    backgroundPanel: "#21222c", // Current Line (darker)

    border: "#44475a", // Selection
    borderFocused: "#bd93f9",
  },
};
