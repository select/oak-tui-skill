import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import type { ProjectNode, Theme, GroupedIssues, BeadsIssue } from "./types";
import type { FileTreeNode } from "../components/file-tree";
import {
  getPriorityIcon,
  getPriorityLabel,
  getPriorityColor,
  getTypeColor,
  getTypeIcon,
  capitalize,
} from "./beads-manager";
import {
  switchToWorktree,
  hasBackgroundPane,
  getCurrentWorktreePath,
} from "./tmux-manager";
import { basename } from "node:path";
import { ensureChildrenLoaded, filterFileTree } from "../components/file-tree";
import { currentTheme } from "./theme-manager";

// Helper to count total selectable items (projects + their worktrees if expanded)
export function getSelectableCount(projectNodes: ProjectNode[]): number {
  let count = 0;
  for (const node of projectNodes) {
    count++; // Project header
    if (node.isExpanded) {
      count += node.worktrees.length;
    }
  }
  return count;
}

// Helper to get the item at a given flat index
export function getItemAtIndex(
  projectNodes: ProjectNode[],
  index: number,
): {
  type: "project" | "worktree";
  projectIndex: number;
  worktreeIndex?: number;
} | null {
  let currentIndex = 0;
  for (let i = 0; i < projectNodes.length; i++) {
    if (currentIndex === index) {
      return { type: "project", projectIndex: i };
    }
    currentIndex++;
    if (projectNodes[i].isExpanded) {
      for (let j = 0; j < projectNodes[i].worktrees.length; j++) {
        if (currentIndex === index) {
          return { type: "worktree", projectIndex: i, worktreeIndex: j };
        }
        currentIndex++;
      }
    }
  }
  return null;
}

// Helper to count total visible files (respecting expanded state and search filter)
export function getFilesSelectableCount(
  fileTree: FileTreeNode[],
  searchQuery: string,
  expandedPaths: Set<string>,
): number {
  const filteredTree = searchQuery
    ? filterFileTree(fileTree, searchQuery)
    : fileTree;
  const flatFiles = flattenFileTree(filteredTree, !searchQuery, expandedPaths);
  return flatFiles.length;
}

// Helper to get file at a given flat index
export function getFileAtIndex(
  fileTree: FileTreeNode[],
  searchQuery: string,
  expandedPaths: Set<string>,
  index: number,
): FileTreeNode | null {
  const filteredTree = searchQuery
    ? filterFileTree(fileTree, searchQuery)
    : fileTree;
  const flatFiles = flattenFileTree(filteredTree, !searchQuery, expandedPaths);
  return flatFiles[index] || null;
}

// Filter projects by search query (matches project name or worktree branches)
export function filterProjects(
  projectNodes: ProjectNode[],
  searchQuery: string,
): ProjectNode[] {
  if (!searchQuery) return projectNodes;
  const query = searchQuery.toLowerCase();
  return projectNodes.filter((project) => {
    // Match project name
    if (project.name.toLowerCase().includes(query)) return true;
    // Match any worktree branch
    return project.worktrees.some((wt) =>
      wt.branch.toLowerCase().includes(query),
    );
  });
}

// Filter board issues by search query (matches title or id)
export function filterBoardIssues(
  grouped: GroupedIssues,
  searchQuery: string,
): GroupedIssues {
  if (!searchQuery) return grouped;
  const query = searchQuery.toLowerCase();
  const filterIssues = (issues: BeadsIssue[]) =>
    issues.filter(
      (issue) =>
        issue.title.toLowerCase().includes(query) ||
        issue.id.toLowerCase().includes(query),
    );
  return {
    in_progress: filterIssues(grouped.in_progress),
    ready: filterIssues(grouped.ready),
    blocked: filterIssues(grouped.blocked),
    closed: filterIssues(grouped.closed),
  };
}

export interface UIComponents {
  root: BoxRenderable;
  titleBox: BoxRenderable;
  titleText: TextRenderable;
  tabBar: BoxRenderable;
  contentBox: BoxRenderable;
  contentScroll: ScrollBoxRenderable;
  searchBoxOuter: BoxRenderable;
  searchBox: BoxRenderable;
  searchInput: TextRenderable;
  searchCursor: TextRenderable;
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
    gap: 1,
  });

  // Search box container (outer wrapper for visibility control)
  const searchBoxOuter = new BoxRenderable(renderer, {
    id: "search-box-outer",
    width: "100%",
    paddingLeft: 1,
    paddingRight: 1,
    flexDirection: "row",
    visible: false,
    backgroundColor: "#2d3748",
    paddingTop: 1,
    paddingBottom: 1,
  });

  // Colorful left border (1 char wide) - primary accent color
  const searchBorder = new BoxRenderable(renderer, {
    id: "search-border",
    width: 1,
    backgroundColor: theme.colors.primary,
  });

  // Search box with lighter background
  const searchBox = new BoxRenderable(renderer, {
    id: "search-box",
    flexGrow: 1,
    flexDirection: "row",
    gap: 0,
    backgroundColor: "#2d3748",
    paddingLeft: 1,
    paddingRight: 1,
  });
  const searchInput = new TextRenderable(renderer, {
    id: "search-input",
    content: "",
    fg: theme.colors.text,
  });
  const searchCursor = new TextRenderable(renderer, {
    id: "search-cursor",
    content: "|",
    fg: theme.colors.textMuted,
    visible: false,
  });
  const searchPlaceholder = new TextRenderable(renderer, {
    id: "search-placeholder",
    content: "Type to filter...",
    fg: theme.colors.textMuted,
    visible: true,
  });
  searchBox.add(searchInput);
  searchBox.add(searchCursor);
  searchBox.add(searchPlaceholder);
  searchBoxOuter.add(searchBorder);
  searchBoxOuter.add(searchBox);

  const contentScroll = new ScrollBoxRenderable(renderer, {
    id: "content-scroll",
    width: "100%",
    flexGrow: 1,
    paddingLeft: 1,
    scrollY: true,
  });
  contentBox.add(contentScroll);

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
    content: "d",
    fg: theme.colors.text,
  });
  const footerDesc3 = new TextRenderable(renderer, {
    id: "footer-desc3",
    content: ": remove • ",
    fg: theme.colors.textMuted,
  });
  const footerKey4 = new TextRenderable(renderer, {
    id: "footer-key4",
    content: "Ctrl+C",
    fg: theme.colors.text,
  });
  const footerDesc4 = new TextRenderable(renderer, {
    id: "footer-desc4",
    content: ": exit",
    fg: theme.colors.textMuted,
  });
  footerBox.add(footerKey1);
  footerBox.add(footerDesc1);
  footerBox.add(footerKey2);
  footerBox.add(footerDesc2);
  footerBox.add(footerKey3);
  footerBox.add(footerDesc3);
  footerBox.add(footerKey4);
  footerBox.add(footerDesc4);

  titleBox.add(tabBar);
  root.add(titleBox);
  root.add(contentBox);
  root.add(searchBoxOuter);
  root.add(footerBox);

  return {
    root,
    titleBox,
    titleText,
    tabBar,
    contentBox,
    contentScroll,
    searchBoxOuter,
    searchBox,
    searchInput,
    searchCursor,
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
  selectedIndex: number = -1,
): void {
  // Get current active worktree path
  const currentPath = getCurrentWorktreePath();

  if (projectNodes.length === 0) {
    const emptyText = new TextRenderable(renderer, {
      id: `empty-projects-${renderCounter}`,
      content: "No recent projects",
      fg: "#808080",
    });
    contentScroll.add(emptyText);
    return;
  }

  let flatIndex = 0; // Track flat index for keyboard selection

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

    // Track if this project header is selected
    const projectIsSelected = selectedIndex === flatIndex;
    flatIndex++;

    const projectHeader = new BoxRenderable(renderer, {
      id: `project-header-${renderCounter}-${i}`,
      width: "100%",
      flexDirection: "row",
      backgroundColor: projectIsSelected ? "#3a3a3a" : undefined,
      onMouseOver: () => {
        if (!projectIsSelected) {
          projectHeader.backgroundColor = "#3a3a3a";
          renderer.requestRender();
        }
      },
      onMouseOut: () => {
        if (!projectIsSelected) {
          projectHeader.backgroundColor = undefined;
          renderer.requestRender();
        }
      },
    });

    const expandIconText = new TextRenderable(renderer, {
      id: `project-expand-${renderCounter}-${i}`,
      content: `${expandIcon} `,
      fg: "#666666",
    });

    const projectName = new TextRenderable(renderer, {
      id: `project-name-${renderCounter}-${i}`,
      content: `${node.name}${activeIndicator}`,
      fg: node.isActive ? "#fab283" : "#eeeeee",
    });

    projectHeader.add(expandIconText);
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
        // Track if this worktree is selected
        const wtIsSelected = selectedIndex === flatIndex;
        flatIndex++;

        const wtBox = new BoxRenderable(renderer, {
          id: `worktree-${renderCounter}-${i}-${wtIdx}`,
          width: "100%",
          flexDirection: "column",
          paddingLeft: 2,
          backgroundColor: wtIsSelected ? "#3a3a3a" : undefined,
          onMouseOver: () => {
            if (!wtIsSelected) {
              wtBox.backgroundColor = "#3a3a3a";
              renderer.requestRender();
            }
          },
          onMouseOut: () => {
            if (!wtIsSelected) {
              wtBox.backgroundColor = undefined;
              renderer.requestRender();
            }
          },
        });

        // Check if this worktree is the current active pane (purple dot)
        const isCurrentPane = currentPath === wt.path;
        // Check if this worktree has a background pane (orange dot)
        const hasBgPane = hasBackgroundPane(wt.path);

        // Purple dot for current open pane, orange dot for background pane
        let indicator = "";
        if (isCurrentPane) {
          indicator = " \u2022"; // Small bullet in purple (color applied via fg)
        } else if (hasBgPane) {
          indicator = " \u2022"; // Small bullet in orange (color applied via fg)
        }

        // Determine the indicator color
        let indicatorColor = "";
        if (isCurrentPane) {
          indicatorColor = "#a855f7"; // Purple for current pane
        } else if (hasBgPane) {
          indicatorColor = "#f97316"; // Orange for background pane
        }

        const wtName = new TextRenderable(renderer, {
          id: `worktree-name-${renderCounter}-${i}-${wtIdx}`,
          content: `  ⎇ ${basename(wt.path)}`,
          fg: "#7fd88f",
        });

        // Add indicator as separate text element with its own color
        const wtIndicator = indicatorColor
          ? new TextRenderable(renderer, {
              id: `worktree-indicator-${renderCounter}-${i}-${wtIdx}`,
              content: indicator,
              fg: indicatorColor,
            })
          : null;

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

        // Create a row for name + indicator
        const wtNameRow = new BoxRenderable(renderer, {
          id: `worktree-name-row-${renderCounter}-${i}-${wtIdx}`,
          flexDirection: "row",
        });
        wtNameRow.add(wtName);
        if (wtIndicator) {
          wtNameRow.add(wtIndicator);
        }

        wtBox.add(wtNameRow);
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
  selectedIndex: number = -1,
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
    const isSelected = i === selectedIndex;

    let icon: string;
    if (file.isDirectory) {
      icon = isExpanded ? "\u{25BC}" : "\u{25B6}";
    } else {
      icon = getFileIcon(file.name, false);
    }

    const fileBox = new BoxRenderable(renderer, {
      id: `file-${renderCounter}-${i}`,
      width: "100%",
      backgroundColor: isSelected ? "#3a3a3a" : undefined,
      onMouseOver: () => {
        if (!isSelected) {
          fileBox.backgroundColor = "#3a3a3a";
          renderer.requestRender();
        }
      },
      onMouseOut: () => {
        if (!isSelected) {
          fileBox.backgroundColor = undefined;
          renderer.requestRender();
        }
      },
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

// Board section labels
const BOARD_SECTIONS: { key: keyof GroupedIssues; label: string }[] = [
  { key: "in_progress", label: "In Progress" },
  { key: "ready", label: "Ready" },
  { key: "blocked", label: "Blocked" },
  { key: "closed", label: "Closed" },
];

export function renderBoard(
  renderer: CliRenderer,
  contentScroll: ScrollBoxRenderable,
  groupedIssues: GroupedIssues,
  renderCounter: number,
  selectedIndex: number,
  onSelectIssue: (issue: BeadsIssue) => void,
): void {
  let flatIndex = 0;

  for (let sectionIdx = 0; sectionIdx < BOARD_SECTIONS.length; sectionIdx++) {
    const section = BOARD_SECTIONS[sectionIdx];
    const issues = groupedIssues[section.key];

    // Section container with border
    const sectionBox = new BoxRenderable(renderer, {
      id: `board-section-${section.key}-${renderCounter}`,
      width: "100%",
      flexDirection: "column",
      border: true,
      borderStyle: "rounded",
      borderColor: "#484848",
      title: `${section.label} (${issues.length})`,
      titleAlignment: "left",
      marginTop: sectionIdx === 0 ? 0 : 1,
      overflow: "hidden",
    });

    // Empty state
    if (issues.length === 0) {
      const emptyText = new TextRenderable(renderer, {
        id: `board-empty-text-${section.key}-${renderCounter}`,
        content: "(none)",
        fg: "#808080",
      });

      sectionBox.add(emptyText);
      contentScroll.add(sectionBox);
      continue;
    }

    // Issue cards
    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i];
      const isSelected = flatIndex === selectedIndex;

      // Issue container (2 lines)
      const isLastInSection = i === issues.length - 1;
      const issueBox = new BoxRenderable(renderer, {
        id: `board-issue-${renderCounter}-${flatIndex}`,
        width: "100%",
        flexDirection: "column",
        backgroundColor: isSelected ? "#3a3a3a" : undefined,
        overflow: "hidden",
        marginBottom: isLastInSection ? 0 : 1,
      });

      // Line 1: Type + issue-id on left, priority icon on right
      const badgeLine = new BoxRenderable(renderer, {
        id: `board-badges-${renderCounter}-${flatIndex}`,
        width: "100%",
        flexDirection: "row",
        justifyContent: "space-between",
        overflow: "hidden",
      });

      // Left side: Type badge (colored block)
      const typeBadge = new BoxRenderable(renderer, {
        id: `board-type-${renderCounter}-${flatIndex}`,
        backgroundColor: getTypeColor(issue.issue_type),
        width: 1,
      });

      // Right side: Issue ID + Priority icon
      const rightSide = new BoxRenderable(renderer, {
        id: `board-right-${renderCounter}-${flatIndex}`,
        flexDirection: "row",
        gap: 1,
      });

      const issueId = new TextRenderable(renderer, {
        id: `board-id-${renderCounter}-${flatIndex}`,
        content: issue.id,
        fg: "#808080",
      });

      const priorityIcon = new TextRenderable(renderer, {
        id: `board-priority-${renderCounter}-${flatIndex}`,
        content: getPriorityIcon(issue.priority),
        fg: getPriorityColor(issue.priority),
      });

      rightSide.add(issueId);
      rightSide.add(priorityIcon);

      badgeLine.add(typeBadge);
      badgeLine.add(rightSide);

      // Line 2: Title (indented, overflow hidden)
      const titleText = new TextRenderable(renderer, {
        id: `board-title-${renderCounter}-${flatIndex}`,
        content: issue.title,
        fg: "#eeeeee",
      });

      issueBox.add(badgeLine);
      issueBox.add(titleText);

      // Mouse handlers
      issueBox.onMouseOver = () => {
        issueBox.backgroundColor = "#3a3a3a";
        renderer.requestRender();
      };

      issueBox.onMouseOut = () => {
        issueBox.backgroundColor = isSelected ? "#3a3a3a" : undefined;
        renderer.requestRender();
      };

      issueBox.onMouseDown = (event) => {
        event.stopPropagation();
        onSelectIssue(issue);
      };

      sectionBox.add(issueBox);
      flatIndex++;
    }

    contentScroll.add(sectionBox);
  }
}
