import type { Theme } from "../types";

export const tokyonightTheme: Theme = {
  name: "tokyonight",
  displayName: "Tokyo Night",
  colors: {
    primary: "#82aaff", // Blue
    secondary: "#c099ff", // Purple
    accent: "#ff966c", // Orange

    error: "#ff757f", // Red
    warning: "#ffc777", // Yellow
    success: "#c3e88d", // Green
    info: "#86e1fc", // Cyan

    text: "#c8d3f5", // Foreground
    textMuted: "#636da6", // Comment

    background: "#222436", // Background
    backgroundPanel: "#1e2030", // Background darker

    border: "#3b4261", // Border
    borderFocused: "#82aaff",
  },
};
