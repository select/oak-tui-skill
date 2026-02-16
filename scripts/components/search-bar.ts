import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import { currentTheme } from "../lib/theme-manager";

export interface SearchBarProps {
  isActive: boolean;
  query: string;
  placeholder?: string;
}

export interface SearchBarComponents {
  container: BoxRenderable;
  icon: TextRenderable;
  input: TextRenderable;
  placeholder: TextRenderable;
}

/**
 * Create a reusable search bar component
 * - Shows "/" hint when inactive
 * - Shows search input when active
 * - Positioned at bottom of content area
 */
export function createSearchBar(
  renderer: CliRenderer,
  id: string,
  placeholder: string = "Search...",
): SearchBarComponents {
  const theme = currentTheme();

  const container = new BoxRenderable(renderer, {
    id: `search-bar-${id}`,
    width: "100%",
    height: "auto",
    flexDirection: "row",
    gap: 1,
    paddingTop: 1,
  });

  const icon = new TextRenderable(renderer, {
    id: `search-icon-${id}`,
    content: "/",
    fg: theme.colors.textMuted,
  });

  const input = new TextRenderable(renderer, {
    id: `search-input-${id}`,
    content: "",
    fg: theme.colors.text,
  });

  const placeholderText = new TextRenderable(renderer, {
    id: `search-placeholder-${id}`,
    content: placeholder,
    fg: theme.colors.textMuted,
    visible: true,
  });

  container.add(icon);
  container.add(input);
  container.add(placeholderText);

  return {
    container,
    icon,
    input,
    placeholder: placeholderText,
  };
}

/**
 * Update search bar state
 */
export function updateSearchBar(
  components: SearchBarComponents,
  isActive: boolean,
  query: string,
): void {
  const theme = currentTheme();

  if (isActive) {
    // Active search mode
    components.icon.content = "/";
    components.icon.fg = theme.colors.primary;
    components.input.content = query;
    components.input.visible = true;
    components.placeholder.visible = query.length === 0;
  } else {
    // Inactive - show hint
    components.icon.content = "/";
    components.icon.fg = theme.colors.textMuted;
    components.input.content = "";
    components.input.visible = false;
    components.placeholder.content = "Press / to search";
    components.placeholder.visible = true;
  }
}

/**
 * Handle search input key
 * Returns the new query string, or null if key was not handled
 */
export function handleSearchKey(
  key: string,
  currentQuery: string,
): string | null {
  if (key === "backspace") {
    return currentQuery.slice(0, -1);
  } else if (key.length === 1 && key !== "/") {
    // Single character input (excluding / which toggles search)
    return currentQuery + key;
  }
  return null;
}
