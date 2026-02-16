import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import type { ProjectNode, FileTreeNode, Theme } from "./types";
import { switchToWorktree, hasBackgroundPane } from "./tmux-manager";
import { basename } from "node:path";
import { ensureChildrenLoaded, filterFileTree } from "../components/file-tree";
import { currentTheme } from "./theme-manager";

export interface UIComponents {
  root: BoxRenderable;
  titleBox: BoxRenderable;
  titleText: TextRenderable;
  tabBar: BoxRenderable;
  contentBox: BoxRenderable;
  contentScroll: ScrollBoxRenderable;
  searchBox: BoxRenderable;
  searchInput: TextRenderable;
  searchPlaceholder: TextRenderable;
  footerBox: BoxRenderable;
}

export interface RenderState {
  activeTab: "projects" | "files";
  searchQuery: string;
  expandedPaths: Set<string>;
  renderCounter: number;
}

export function createUIComponents(renderer: CliRenderer): UIComponents {
  const theme = currentTheme();

  const root = new BoxRenderable(renderer, {
    id: "root",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    gap: 1,
    backgroundColor: theme.colors.background,
  });

  const titleBox = new BoxRenderable(renderer, {
    id: "title-box",
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.backgroundPanel,
    padding: 1,
    gap: 2,
  });
  const titleText = new TextRenderable(renderer, {
    id: "title-text",
    content: "🌳 Oak",
    fg: theme.colors.textMuted,
    bold: true,
    flexShrink: 0,
  });
  titleBox.add(titleText);

  const tabBar = new BoxRenderable(renderer, {
    id: "tab-bar",
    flexDirection: "row",
    gap: 2,
    flexShrink: 0,
  });

  const contentBox = new BoxRenderable(renderer, {
    id: "content-box",
    width: "100%",
    flexGrow: 1,
    flexDirection: "column",
    padding: 1,
  });

  const searchBox = new BoxRenderable(renderer, {
    id: "search-box",
    width: "100%",
    height: 0,
    paddingTop: 0,
    flexDirection: "row",
    gap: 1,
    visible: false,
  });
  const searchLabel = new TextRenderable(renderer, {
    id: "search-label",
    content: "⌕ ",
    fg: "#808080",
  });
  const searchInput = new TextRenderable(renderer, {
    id: "search-input",
    content: "",
    fg: "#eeeeee",
  });
  const searchPlaceholder = new TextRenderable(renderer, {
    id: "search-placeholder",
    content: "Type to filter...",
    fg: "#808080",
  });
  searchBox.add(searchLabel);
  searchBox.add(searchInput);
  searchBox.add(searchPlaceholder);

  const contentScroll = new ScrollBoxRenderable(renderer, {
    id: "content-scroll",
    width: "100%",
    flexGrow: 1,
    paddingLeft: 1,
    scrollY: true,
  });
  contentBox.add(contentScroll);
  contentBox.add(searchBox);

  const footerBox = new BoxRenderable(renderer, {
    id: "footer-box",
    width: "100%",
    padding: 1,
    backgroundColor: theme.colors.backgroundPanel,
    flexDirection: "row",
    gap: 0,
  });
  // Keys in accent color, descriptions in muted
  const footerKey1 = new TextRenderable(renderer, {
    id: "footer-key1",
    content: "Tab",
    fg: theme.colors.text,
  });
  const footerDesc1 = new TextRenderable(renderer, {
    id: "footer-desc1",
    content: ": cycle • ",
    fg: theme.colors.textMuted,
  });
  const footerKey2 = new TextRenderable(renderer, {
    id: "footer-key2",
    content: "r",
    fg: theme.colors.text,
  });
  const footerDesc2 = new TextRenderable(renderer, {
    id: "footer-desc2",
    content: ": reload • ",
    fg: theme.colors.textMuted,
  });
  const footerKey3 = new TextRenderable(renderer, {
    id: "footer-key3",
    content: "Ctrl+C",
    fg: theme.colors.text,
  });
  const footerDesc3 = new TextRenderable(renderer, {
    id: "footer-desc3",
    content: ": exit",
    fg: theme.colors.textMuted,
  });
  footerBox.add(footerKey1);
  footerBox.add(footerDesc1);
  footerBox.add(footerKey2);
  footerBox.add(footerDesc2);
  footerBox.add(footerKey3);
  footerBox.add(footerDesc3);

  titleBox.add(tabBar);
  root.add(titleBox);
  root.add(contentBox);
  root.add(footerBox);

  return {
    root,
    titleBox,
    titleText,
    tabBar,
    contentBox,
    contentScroll,
    searchBox,
    searchInput,
    searchPlaceholder,
    footerBox,
  };
}

/**
 * Update UI component colors based on current theme
 */
export function updateUIColors(ui: UIComponents): void {
  const theme = currentTheme();

  // Root background
  ui.root.backgroundColor = theme.colors.background;

  // Title box (darker panel)
  ui.titleBox.backgroundColor = theme.colors.backgroundPanel;
  ui.titleText.fg = theme.colors.primary;

  // Footer (darker panel)
  ui.footerBox.backgroundColor = theme.colors.backgroundPanel;
  const footerText = ui.footerBox.getChildren()[0] as TextRenderable;
  if (footerText) {
    footerText.fg = theme.colors.textMuted;
  }
}

export function renderProjects(
  renderer: CliRenderer,
  contentScroll: ScrollBoxRenderable,
  projectNodes: ProjectNode[],
  renderCounter: number,
  onUpdate: () => void,
): void {
  if (projectNodes.length === 0) {
    const emptyText = new TextRenderable(renderer, {
      id: `empty-projects-${renderCounter}`,
      content: "No recent projects",
      fg: "#808080",
    });
    contentScroll.add(emptyText);
    return;
  }

  projectNodes.forEach((node, i) => {
    const isExpanded = node.isExpanded;
    const expandIcon = isExpanded ? "\u{25BC}" : "\u{25B6}";
    const activeIndicator = node.isActive ? " \u2022" : "";

    const projectBox = new BoxRenderable(renderer, {
      id: `project-${renderCounter}-${i}`,
      width: "100%",
      flexDirection: "column",
      paddingBottom: 1,
    });

    const projectHeader = new BoxRenderable(renderer, {
      id: `project-header-${renderCounter}-${i}`,
      width: "100%",
    });

    const projectName = new TextRenderable(renderer, {
      id: `project-name-${renderCounter}-${i}`,
      content: `${expandIcon} ${node.name}${activeIndicator}`,
      fg: node.isActive ? "#fab283" : "#eeeeee",
    });

    projectHeader.add(projectName);

    projectHeader.onMouseDown = (event) => {
      event.stopPropagation();
      // Only toggle expand, don't switch project
      node.isExpanded = !node.isExpanded;
      setTimeout(() => onUpdate(), 0);
    };

    projectBox.add(projectHeader);

    if (isExpanded && node.worktrees.length > 0) {
      node.worktrees.forEach((wt, wtIdx) => {
        const wtBox = new BoxRenderable(renderer, {
          id: `worktree-${renderCounter}-${i}-${wtIdx}`,
          width: "100%",
          flexDirection: "column",
          paddingLeft: 2,
          onMouseOver: () => {
            wtBox.backgroundColor = "#2a2a2a";
            renderer.requestRender();
          },
          onMouseOut: () => {
            wtBox.backgroundColor = undefined;
            renderer.requestRender();
          },
        });

        // Check if this worktree has a background pane
        const hasBgPane = hasBackgroundPane(wt.path);
        const bgIndicator = hasBgPane ? " 🟢" : "";

        const wtName = new TextRenderable(renderer, {
          id: `worktree-name-${renderCounter}-${i}-${wtIdx}`,
          content: `  ⎇ ${basename(wt.path)}${bgIndicator}`,
          fg: "#7fd88f",
        });

        const wtInfo = new TextRenderable(renderer, {
          id: `worktree-info-${renderCounter}-${i}-${wtIdx}`,
          content: `    ${wt.branch} • ${wt.commit.substring(0, 7)}`,
          fg: "#808080",
        });

        wtBox.onMouseDown = (event) => {
          event.stopPropagation();
          switchToWorktree(wt.path, node.path);
          setTimeout(() => onUpdate(), 0);
        };

        wtBox.add(wtName);
        wtBox.add(wtInfo);
        projectBox.add(wtBox);
      });
    }

    contentScroll.add(projectBox);
  });
}

function getFileIcon(filename: string, isDirectory: boolean): string {
  if (isDirectory) return "▪";
  const ext = filename.split(".").pop()?.toLowerCase();
  const iconMap: Record<string, string> = {
    ts: "○",
    js: "○",
    json: "◆",
    md: "◈",
    txt: "◉",
    yml: "◈",
    yaml: "◈",
  };
  return iconMap[ext || ""] || "○";
}

function flattenFileTree(
  nodes: FileTreeNode[],
  respectExpanded = true,
  expandedPaths: Set<string>,
): FileTreeNode[] {
  const result: FileTreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children) {
      if (!respectExpanded || expandedPaths.has(node.path)) {
        result.push(
          ...flattenFileTree(node.children, respectExpanded, expandedPaths),
        );
      }
    }
  }
  return result;
}

export function renderFiles(
  renderer: CliRenderer,
  contentScroll: ScrollBoxRenderable,
  fileTree: FileTreeNode[],
  searchQuery: string,
  expandedPaths: Set<string>,
  renderCounter: number,
  onToggleFolder: (path: string) => void,
): void {
  const filteredTree = searchQuery
    ? filterFileTree(fileTree, searchQuery)
    : fileTree;
  const flatFiles = flattenFileTree(filteredTree, !searchQuery, expandedPaths);

  if (flatFiles.length === 0) {
    const emptyText = new TextRenderable(renderer, {
      id: `empty-files-${renderCounter}`,
      content: searchQuery ? "No matches found" : "No files found",
      fg: "#808080",
    });
    contentScroll.add(emptyText);
    return;
  }

  flatFiles.forEach((file, i) => {
    const indent = "  ".repeat(file.depth);
    const isExpanded = expandedPaths.has(file.path);
    const hasChildren = file.children && file.children.length > 0;

    let icon: string;
    if (file.isDirectory) {
      icon = isExpanded ? "\u{25BC}" : "\u{25B6}";
    } else {
      icon = getFileIcon(file.name, false);
    }

    const fileBox = new BoxRenderable(renderer, {
      id: `file-${renderCounter}-${i}`,
      width: "100%",
    });

    const fileName = new TextRenderable(renderer, {
      id: `file-name-${renderCounter}-${i}`,
      content: `${indent}${icon} ${file.name}`,
      fg: file.isDirectory ? "#5c9cf5" : "#eeeeee",
    });

    fileBox.add(fileName);

    if (file.isDirectory) {
      fileBox.onMouseDown = (event) => {
        event.stopPropagation();
        onToggleFolder(file.path);
      };
    }

    contentScroll.add(fileBox);
  });
}

export function clearContent(contentScroll: ScrollBoxRenderable): void {
  const children = contentScroll.getChildren();
  for (const child of children) {
    contentScroll.remove(child.id);
    child.destroyRecursively();
  }
}

export function renderThemes(
  renderer: CliRenderer,
  contentScroll: ScrollBoxRenderable,
  themes: Theme[],
  currentThemeName: string,
  renderCounter: number,
  onSelectTheme: (themeName: string) => void,
): void {
  themes.forEach((theme, i) => {
    const isSelected = theme.name === currentThemeName;
    const indicator = isSelected ? "●" : "○";

    const themeBox = new BoxRenderable(renderer, {
      id: `theme-${renderCounter}-${i}`,
      width: "100%",
      flexDirection: "row",
      gap: 2,
      paddingBottom: 1,
    });

    const themeName = new TextRenderable(renderer, {
      id: `theme-name-${renderCounter}-${i}`,
      content: `${indicator} ${theme.displayName}`,
      fg: isSelected ? theme.colors.primary : "#eeeeee",
    });

    // Color swatch showing primary color
    const colorSwatch = new TextRenderable(renderer, {
      id: `theme-swatch-${renderCounter}-${i}`,
      content: "████",
      fg: theme.colors.primary,
    });

    themeBox.add(themeName);
    themeBox.add(colorSwatch);

    themeBox.onMouseDown = (event) => {
      event.stopPropagation();
      onSelectTheme(theme.name);
    };

    contentScroll.add(themeBox);
  });
}
