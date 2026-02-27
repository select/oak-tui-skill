import type { CliRenderer } from "@opentui/core";
import { BoxRenderable, TextRenderable } from "@opentui/core";
import type { TabId } from "./types";
import type { ConfirmDeleteState } from "../components/confirm-popup";
import { currentTheme } from "./theme-manager";

export interface FooterHint {
  key: string;
  label: string;
}

export interface FooterComponents {
  footerBox: BoxRenderable;
  renderer: CliRenderer;
  renderCounter: number;
}

/**
 * Create footer UI components
 */
export function createFooter(renderer: CliRenderer): FooterComponents {
  const theme = currentTheme();

  // Footer with keyboard hints - overflow hidden to prevent line breaks
  const footerBox = new BoxRenderable(renderer, {
    id: "footer-box",
    width: "100%",
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    paddingBottom: 1,
    backgroundColor: theme.colors.backgroundPanel,
    flexDirection: "row",
    gap: 0,
    flexShrink: 0,
    overflow: "hidden",
  });

  return {
    footerBox,
    renderer,
    renderCounter: 0,
  };
}

/**
 * Clear all children from footer box
 */
function clearFooter(footerBox: BoxRenderable): void {
  const children = footerBox.getChildren();
  for (const child of children) {
    footerBox.remove(child.id);
    child.destroyRecursively();
  }
}

/**
 * Render footer hints dynamically
 */
function renderFooterHints(
  components: FooterComponents,
  hints: FooterHint[],
): void {
  const { footerBox, renderer } = components;
  const theme = currentTheme();

  // Clear existing content
  clearFooter(footerBox);

  // Increment render counter for unique IDs
  components.renderCounter++;
  const counter = components.renderCounter;

  // Add hints dynamically
  for (let i = 0; i < hints.length; i++) {
    const hint = hints[i];

    // Skip empty hints
    if (!hint.key && !hint.label) continue;

    // Key
    const key = new TextRenderable(renderer, {
      id: `footer-key-${counter}-${i}`,
      content: hint.key,
      fg: theme.colors.text,
    });
    footerBox.add(key);

    // Description
    const desc = new TextRenderable(renderer, {
      id: `footer-desc-${counter}-${i}`,
      content: hint.label,
      fg: theme.colors.textMuted,
    });
    footerBox.add(desc);

    // Bullet separator (except after last item)
    if (i < hints.length - 1) {
      const bullet = new TextRenderable(renderer, {
        id: `footer-bullet-${counter}-${i}`,
        content: "• ",
        fg: "#2d3748",
      });
      footerBox.add(bullet);
    }
  }
}

/**
 * Update footer hints based on search state and confirm delete state
 */
export function updateFooter(
  components: FooterComponents,
  activeTab: TabId,
  searchState: {
    projectsSearchMode: boolean;
    projectsSearchQuery: string;
    boardSearchMode: boolean;
    boardSearchQuery: string;
    searchMode: boolean;
    searchQuery: string;
  },
  confirmDeleteState?: ConfirmDeleteState,
): void {
  let hints: FooterHint[] = [];

  // If confirm delete popup is visible, show delete confirmation hints
  if (confirmDeleteState?.visible === true) {
    hints = [
      { key: "d", label: ": delete " },
      { key: "c", label: ": cancel " },
      { key: "Esc", label: ": cancel" },
    ];
  } else {
    // Determine current search state based on active tab
    let isSearchMode = false;
    let hasSearchQuery = false;

    if (activeTab === "projects") {
      isSearchMode = searchState.projectsSearchMode;
      hasSearchQuery = searchState.projectsSearchQuery.length > 0;
    } else if (activeTab === "board") {
      isSearchMode = searchState.boardSearchMode;
      hasSearchQuery = searchState.boardSearchQuery.length > 0;
    } else if (activeTab === "files") {
      isSearchMode = searchState.searchMode;
      hasSearchQuery = searchState.searchQuery.length > 0;
    }

    // When actively typing in search (and has at least one character)
    if (isSearchMode && hasSearchQuery) {
      hints = [
        { key: "↹", label: ": cycle " },
        { key: "r", label: ": reload " },
        { key: "Esc", label: ": cancel " },
        { key: "↵", label: ": apply" },
      ];
    }
    // When actively typing in search (empty)
    else if (isSearchMode) {
      hints = [
        { key: "↹", label: ": cycle " },
        { key: "r", label: ": reload " },
        { key: "Esc", label: ": cancel " },
        { key: "q", label: ": quit" },
      ];
    }
    // When filter is applied (has query but not in search mode)
    else if (hasSearchQuery) {
      hints = [
        { key: "↹", label: ": cycle " },
        { key: "/", label: ": search " },
        { key: "Esc", label: ": clear " },
        { key: "↵", label: ": clear" },
      ];
    }
    // Default state
    else {
      if (activeTab === "projects") {
        hints = [
          { key: "↹", label: ": cycle " },
          { key: "r", label: ": reload " },
          { key: "d", label: ": remove " },
          { key: "/", label: ": search" },
        ];
      } else {
        hints = [
          { key: "↹", label: ": cycle " },
          { key: "r", label: ": reload " },
          { key: "/", label: ": search " },
          { key: "q", label: ": quit" },
        ];
      }
    }
  }

  // Render the hints dynamically
  renderFooterHints(components, hints);
}
