import type { CliRenderer } from "@opentui/core";
import { BoxRenderable, TextRenderable } from "@opentui/core";
import type { TabId } from "./types";
import { currentTheme } from "./theme-manager";

export interface FooterHint {
  key: string;
  label: string;
}

export interface FooterComponents {
  footerBox: BoxRenderable;
  footerKeys: TextRenderable[];
  footerDescs: TextRenderable[];
  footerBullets: TextRenderable[];
}

/**
 * Create footer UI components
 */
export function createFooter(renderer: CliRenderer): FooterComponents {
  const theme = currentTheme();

  // Footer with keyboard hints
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
  });

  // Create 4 key-desc-bullet sets using loops
  const footerKeys: TextRenderable[] = [];
  const footerDescs: TextRenderable[] = [];
  const footerBullets: TextRenderable[] = [];

  const initialHints: FooterHint[] = [
    { key: "↹", label: ": cycle " },
    { key: "r", label: ": reload " },
    { key: "d", label: ": remove " },
    { key: "q", label: ": quit" },
  ];

  for (let i = 0; i < 4; i++) {
    const hint = initialHints[i];

    // Key
    const key = new TextRenderable(renderer, {
      id: `footer-key${i + 1}`,
      content: hint.key,
      fg: theme.colors.text,
    });
    footerKeys.push(key);

    // Description
    const desc = new TextRenderable(renderer, {
      id: `footer-desc${i + 1}`,
      content: hint.label,
      fg: theme.colors.textMuted,
    });
    footerDescs.push(desc);

    // Bullet separator (except after last item)
    if (i < 3) {
      const bullet = new TextRenderable(renderer, {
        id: `footer-bullet${i + 1}`,
        content: "• ",
        fg: "#2d3748", // Search background color for subtle appearance
      });
      footerBullets.push(bullet);
    }
  }

  // Add all renderables to footer box in order
  for (let i = 0; i < 4; i++) {
    footerBox.add(footerKeys[i]);
    footerBox.add(footerDescs[i]);
    if (i < 3) {
      footerBox.add(footerBullets[i]);
    }
  }

  return {
    footerBox,
    footerKeys,
    footerDescs,
    footerBullets,
  };
}

/**
 * Update footer hints based on search state
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
): void {
  const { footerKeys, footerDescs, footerBullets } = components;

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

  let hints: FooterHint[] = [];

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

  // Update footer components
  for (let i = 0; i < 4; i++) {
    if (i < hints.length) {
      footerKeys[i].content = hints[i].key;
      footerDescs[i].content = hints[i].label;
      footerKeys[i].visible = true;
      footerDescs[i].visible = true;
      if (i < footerBullets.length) {
        footerBullets[i].visible = i < hints.length - 1;
      }
    } else {
      footerKeys[i].visible = false;
      footerDescs[i].visible = false;
      if (i < footerBullets.length) {
        footerBullets[i].visible = false;
      }
    }
  }
}
