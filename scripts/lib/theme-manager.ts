import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Theme } from "./types";
import { allThemes } from "./themes";

// Config file path
const DATA_DIR = join(homedir(), ".local", "share", "oak-tui");
const CONFIG_FILE = join(DATA_DIR, "config.json");

// Theme registry
const themes: Map<string, Theme> = new Map();
let currentThemeName = "opencode";

/**
 * Register a theme in the registry
 */
export function registerTheme(theme: Readonly<Theme>): void {
  themes.set(theme.name, theme);
}

/**
 * Register all built-in themes
 */
export function registerAllThemes(): void {
  for (const theme of allThemes) {
    registerTheme(theme);
  }
}

/**
 * Set the current theme by name
 * @returns true if theme was found and set, false otherwise
 */
export function setTheme(name: string): boolean {
  if (!themes.has(name)) {
    return false;
  }
  currentThemeName = name;
  saveThemePreference(name);
  return true;
}

/**
 * Get the current theme
 */
export function currentTheme(): Theme {
  return themes.get(currentThemeName) ?? themes.get("opencode")!;
}

/**
 * Get the current theme name
 */
export function currentThemeName_(): string {
  return currentThemeName;
}

/**
 * Get all available theme names, sorted with opencode first
 */
export function availableThemeNames(): string[] {
  return Array.from(themes.keys()).sort((a, b) => {
    if (a === "opencode") return -1;
    if (b === "opencode") return 1;
    return a.localeCompare(b);
  });
}

/**
 * Get all available themes as Theme objects, sorted with opencode first
 */
export function availableThemes(): Theme[] {
  return availableThemeNames()
    .map((name) => themes.get(name)!)
    .filter(Boolean);
}

/**
 * Get a specific theme by name
 */
export function getTheme(name: string): Theme | undefined {
  return themes.get(name);
}

/**
 * Type guard to check if a value is a config object
 */
function isConfigObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Load theme preference from config file
 */
export function loadThemePreference(): void {
  try {
    if (existsSync(CONFIG_FILE)) {
      const data = readFileSync(CONFIG_FILE, "utf-8");
      const parsed: unknown = JSON.parse(data);
      if (!isConfigObject(parsed)) return;
      const themeName = parsed.theme;
      if (typeof themeName === "string" && themes.has(themeName)) {
        currentThemeName = themeName;
      }
    }
  } catch {
    // Ignore errors, use default theme
  }
}

/**
 * Save theme preference to config file
 */
function saveThemePreference(themeName: string): void {
  try {
    // Ensure data directory exists
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    // Load existing config or create new
    let config: Record<string, unknown> = {};
    if (existsSync(CONFIG_FILE)) {
      try {
        const data = readFileSync(CONFIG_FILE, "utf-8");
        const parsed: unknown = JSON.parse(data);
        if (isConfigObject(parsed)) {
          config = parsed;
        }
      } catch {
        // Ignore parse errors, start fresh
      }
    }

    // Update theme
    config.theme = themeName;

    // Write config
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch {
    // Ignore write errors
  }
}

/**
 * Initialize the theme system
 * Call this at startup
 */
export function initThemes(): void {
  registerAllThemes();
  loadThemePreference();
}
