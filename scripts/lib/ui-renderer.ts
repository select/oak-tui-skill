import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  createTextAttributes,
  type CliRenderer,
  type MouseEvent,
} from "@opentui/core";
import Fuse, { type FuseResult } from "fuse.js";
import type {
  ProjectNode,
  ReadonlyProjectNode,
  Theme,
  GroupedIssues,
  BeadsIssue,
} from "./types";
import type { ReadonlyFileTreeNode } from "../components/file-tree";
import {
  getPriorityIcon,
  getPriorityColor,
  getTypeColor,
} from "./beads-manager";
import {
  switchToWorktree,
  hasBackgroundPane,
  getCurrentWorktreePath,
} from "./tmux-manager";
import {
  getGlobalState,
  worktreeHasBackgroundPanes,
  type OakProjectsState,
  createNewPaneForWorktree,
  getProjectsInConfigOrder,
  getVisibleForegroundPanes,
  cycleToNextVisiblePane,
  addPaneToMultiView,
} from "./project-state";
import { createFooter, type FooterComponents } from "./footer";
import {
  createModalComponents,
  type ModalComponents,
} from "../components/modal";
import { basename } from "node:path";
import {
  filterFileTree,
  flattenFileTree,
  toMutableNode,
} from "../components/file-tree";
import { currentTheme } from "./theme-manager";

// Helper to count total selectable items (projects + their worktrees if expanded)
export function getSelectableCount(
  projectNodes: readonly ReadonlyProjectNode[],
  expandedProjects: ReadonlySet<string>,
): number {
  let count = 0;
  for (const node of projectNodes) {
    count++; // Project header
    if (expandedProjects.has(node.path)) {
      count += node.worktrees.length;
    }
  }
  return count;
}

// Helper to get the item at a given flat index
export function getItemAtIndex(
  projectNodes: readonly ReadonlyProjectNode[],
  expandedProjects: ReadonlySet<string>,
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
    if (expandedProjects.has(projectNodes[i].path)) {
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

/**
 * Factory function to create hover handlers that change background color on mouse over/out.
 * Avoids re-rendering if the item is already selected (keyboard selection).
 *
 * @param renderable - The renderable to apply hover effect to
 * @param renderer - The CLI renderer for requesting re-renders
 * @param isSelected - Whether the item is currently selected (keyboard selection)
 * @returns Object with onMouseOver and onMouseOut handlers
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- BoxRenderable and CliRenderer are mutable external types
function createHoverHandlers(
  renderable: BoxRenderable,
  renderer: CliRenderer,
  isSelected: boolean,
): {
  onMouseOver: () => void;
  onMouseOut: () => void;
} {
  return {
    onMouseOver: () => {
      if (!isSelected) {
        renderable.backgroundColor = "#3a3a3a";
        void Promise.resolve().then(() => {
          renderer.requestRender();
        });
      }
    },
    onMouseOut: () => {
      if (!isSelected) {
        renderable.backgroundColor = undefined;
        void Promise.resolve().then(() => {
          renderer.requestRender();
        });
      }
    },
  };
}

// Helper to count total visible files (respecting expanded state and search filter)
export function getFilesSelectableCount(
  fileTree: readonly ReadonlyFileTreeNode[],
  searchQuery: string,
  expandedPaths: ReadonlySet<string>,
): number {
  const filteredTree = searchQuery
    ? filterFileTree(fileTree, searchQuery)
    : fileTree.map(toMutableNode);
  const flatFiles = flattenFileTree(filteredTree, expandedPaths, searchQuery);
  return flatFiles.length;
}

// Helper to get file at a given flat index
export function getFileAtIndex(
  fileTree: readonly ReadonlyFileTreeNode[],
  searchQuery: string,
  expandedPaths: ReadonlySet<string>,
  index: number,
): ReadonlyFileTreeNode | null {
  const filteredTree = searchQuery
    ? filterFileTree(fileTree, searchQuery)
    : fileTree.map(toMutableNode);
  const flatFiles = flattenFileTree(filteredTree, expandedPaths, searchQuery);
  return flatFiles[index] ?? null;
}

// Filter projects by search query using fuzzy search
export function filterProjects(
  projectNodes: readonly ReadonlyProjectNode[],
  searchQuery: string,
): ProjectNode[] {
  // Convert readonly to mutable copy
  const toMutable = (node: ReadonlyProjectNode): ProjectNode => ({
    path: node.path,
    name: node.name,
    worktrees: [...node.worktrees],
    isExpanded: node.isExpanded,
    isActive: node.isActive,
  });

  if (!searchQuery) return projectNodes.map(toMutable);
  const fuse = new Fuse(projectNodes.map(toMutable), {
    keys: ["name", "worktrees.branch"],
    threshold: 0.4,
    ignoreLocation: true,
  });
  // Auto-expand matching projects to show worktrees
  return fuse
    .search(searchQuery)
    .map((result: Readonly<FuseResult<ProjectNode>>) => ({
      ...result.item,
      isExpanded: true,
    }));
}

// Filter board issues by search query using fuzzy search
export function filterBoardIssues(
  grouped: Readonly<GroupedIssues>,
  searchQuery: string,
): GroupedIssues {
  if (!searchQuery) return { ...grouped };
  const filterIssues = (issues: readonly BeadsIssue[]) => {
    if (issues.length === 0) return [];
    const fuse = new Fuse([...issues], {
      keys: ["title", "id"],
      threshold: 0.4,
      ignoreLocation: true,
    });
    return fuse
      .search(searchQuery)
      .map((result: Readonly<FuseResult<BeadsIssue>>) => result.item);
  };
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
  footer: FooterComponents;
  modal: ModalComponents;
}

export interface RenderState {
  activeTab: "projects" | "files";
  searchQuery: string;
  expandedPaths: Set<string>;
  renderCounter: number;
}

// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- CliRenderer is a mutable external library type
export function createUIComponents(renderer: CliRenderer): UIComponents {
  const theme = currentTheme();

  const root = new BoxRenderable(renderer, {
    id: "root",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: theme.colors.background,
  });

  const titleBox = new BoxRenderable(renderer, {
    id: "title-box",
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.backgroundPanel,
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    paddingBottom: 1,
    flexShrink: 0,
    gap: 2,
  });
  const titleText = new TextRenderable(renderer, {
    id: "title-text",
    content: "🌳 Oak",
    fg: theme.colors.textMuted,
    attributes: createTextAttributes({ bold: true }),
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
    paddingLeft: 1,
    paddingTop: 1,
    marginTop: 1,
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
    paddingBottom: 2,
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

  // Create footer
  const footer = createFooter(renderer);

  // Create modal (will be added last to render on top)
  const modal = createModalComponents(renderer, theme);

  titleBox.add(tabBar);
  root.add(titleBox);
  root.add(contentBox);
  root.add(searchBoxOuter);
  root.add(footer.footerBox);
  // Add modal overlay last so it renders on top of everything
  root.add(modal.overlay);

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
    footer,
    modal,
  };
}

/**
 * Update UI component colors based on current theme
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- UIComponents contains mutable renderables
export function updateUIColors(ui: UIComponents): void {
  const theme = currentTheme();

  // Root background
  ui.root.backgroundColor = theme.colors.background;

  // Title box (darker panel)
  ui.titleBox.backgroundColor = theme.colors.backgroundPanel;
  ui.titleText.fg = theme.colors.primary;

  // Footer (darker panel)
  ui.footer.footerBox.backgroundColor = theme.colors.backgroundPanel;
  const footerChild = ui.footer.footerBox.getChildren()[0];
  if (footerChild instanceof TextRenderable) {
    footerChild.fg = theme.colors.textMuted;
  }

  // Modal
  ui.modal.container.backgroundColor = theme.colors.backgroundPanel;
  ui.modal.container.borderColor = theme.colors.border;
}

// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- CliRenderer and ScrollBoxRenderable are mutable external types
export function renderProjects(
  renderer: CliRenderer,
  contentScroll: ScrollBoxRenderable,
  projectNodes: ProjectNode[],
  renderCounter: number,
  expandedProjects: Set<string>,
  onUpdate: () => void,
  selectedIndex: number = -1,
  activeWorktreePath?: string,
  onWorktreeSwitch?: (worktreePath: string, projectPath: string) => void,
  debug: boolean = false,
): void {
  // Use activeWorktreePath if provided, otherwise fall back to current working directory
  const currentPath = activeWorktreePath ?? getCurrentWorktreePath();

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

  for (let i = 0; i < projectNodes.length; i++) {
    const node = projectNodes[i];
    const isExpanded = expandedProjects.has(node.path);
    const expandIcon = isExpanded ? "\u{25BC}" : "\u{25B6}";

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
    });

    // Apply hover handlers
    const projectHoverHandlers = createHoverHandlers(
      projectHeader,
      renderer,
      projectIsSelected,
    );
    projectHeader.onMouseOver = projectHoverHandlers.onMouseOver;
    projectHeader.onMouseOut = projectHoverHandlers.onMouseOut;

    const expandIconText = new TextRenderable(renderer, {
      id: `project-expand-${renderCounter}-${i}`,
      content: `${debug && projectIsSelected ? "→ " : ""}${expandIcon} `,
      fg: "#666666",
    });

    const projectName = new TextRenderable(renderer, {
      id: `project-name-${renderCounter}-${i}`,
      content: node.name,
      fg: "#eeeeee",
    });

    projectHeader.add(expandIconText);
    projectHeader.add(projectName);

    projectHeader.onMouse = (event: MouseEvent) => {
      try {
        // Only handle left-click up events
        if (event.type === "up" && event.button === 0) {
          event.stopPropagation();
          // Toggle expand state in the Set
          if (isExpanded) {
            expandedProjects.delete(node.path);
          } else {
            expandedProjects.add(node.path);
          }
          // Use setTimeout to defer re-render until after mouse event completes
          setTimeout(() => {
            onUpdate();
          }, 0);
        }
      } catch {
        // Ignore mouse handler errors
      }
    };

    projectBox.add(projectHeader);

    if (isExpanded && node.worktrees.length > 0) {
      for (let wtIdx = 0; wtIdx < node.worktrees.length; wtIdx++) {
        const wt = node.worktrees[wtIdx];
        // Track if this worktree is selected
        const wtIsSelected = selectedIndex === flatIndex;
        flatIndex++;

        const wtBox = new BoxRenderable(renderer, {
          id: `worktree-${renderCounter}-${i}-${wtIdx}`,
          width: "100%",
          flexDirection: "column",
          paddingLeft: 1,
          backgroundColor: wtIsSelected ? "#3a3a3a" : undefined,
        });

        // Apply hover handlers
        const wtHoverHandlers = createHoverHandlers(
          wtBox,
          renderer,
          wtIsSelected,
        );
        wtBox.onMouseOver = wtHoverHandlers.onMouseOver;
        wtBox.onMouseOut = wtHoverHandlers.onMouseOut;

        // Check if this worktree is the current active pane (purple circle)
        const isCurrentPane = currentPath === wt.path;
        // Check if this worktree has a background pane (orange dot)
        // Check both legacy tmux-manager tracking and new YAML state
        const state = getGlobalState();
        const hasBgPane = hasBackgroundPane(wt.path) || worktreeHasBackgroundPanes(state, wt.path);

        // Big purple circle for current active pane, small orange dot for background pane
        let indicator = "";
        if (isCurrentPane) {
          indicator = " \u25CF"; // Big filled circle in purple
        } else if (hasBgPane) {
          indicator = " \u2022"; // Small bullet in orange
        }

        // Determine the indicator color
        let indicatorColor = "";
        if (isCurrentPane) {
          indicatorColor = "#a855f7"; // Purple for current active pane
        } else if (hasBgPane) {
          indicatorColor = "#f97316"; // Orange for background pane
        }

        const wtName = new TextRenderable(renderer, {
          id: `worktree-name-${renderCounter}-${i}-${wtIdx}`,
          content: `${debug && wtIsSelected ? "→ " : ""} ⎇ ${basename(wt.path)}`,
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
          content: `   ${wt.branch} • ${wt.commit.substring(0, 7)}`,
          fg: "#808080",
        });

        wtBox.onMouseDown = (
          event: Readonly<{ stopPropagation: () => void }>,
        ) => {
          event.stopPropagation();
          if (onWorktreeSwitch) {
            onWorktreeSwitch(wt.path, node.path);
          } else {
            switchToWorktree(wt.path, node.path);
            // Use setTimeout to defer re-render until after mouse event completes
            setTimeout(() => {
              onUpdate();
            }, 0);
          }
        };

        // Create a row for name + indicator
        const wtNameRow = new BoxRenderable(renderer, {
          id: `worktree-name-row-${renderCounter}-${i}-${wtIdx}`,
          flexDirection: "row",
        });
        wtNameRow.add(wtName);
        if (wtIndicator !== null) {
          wtNameRow.add(wtIndicator);
        }

        wtBox.add(wtNameRow);
        wtBox.add(wtInfo);
        projectBox.add(wtBox);
      }
    }

    contentScroll.add(projectBox);
  }
}

// ============================================================================
// State-based Projects Rendering (from YAML state)
// ============================================================================

/**
 * Item types in the flattened project list for keyboard navigation
 */
export type StateProjectItemType = "project" | "worktree" | "pane";

export interface StateProjectItem {
  type: StateProjectItemType;
  projectPath: string;
  worktreePath?: string;
  paneId?: string;
  isBackground?: boolean; // For panes: whether the pane is in background session
}

/**
 * Count selectable items in state-based project view
 */
export function getStateSelectableCount(
  state: OakProjectsState,
  expandedProjects: ReadonlySet<string>,
  expandedWorktrees: ReadonlySet<string>,
  leftPaneId: string | null,
  oakWindowId: string | null = null,
): number {
  let count = 0;
  const projects = getProjectsInConfigOrder(state);

  for (const project of projects) {
    count++; // Project header

    if (expandedProjects.has(project.path)) {
      const worktrees = Object.values(project.worktrees);
      for (const wt of worktrees) {
        count++; // Worktree

        if (expandedWorktrees.has(wt.path)) {
          // Count visible panes - must match rendering logic
          const visiblePanes = wt.panes.filter((p) => {
            if (p.isBackground) return true;
            // Only show foreground panes that are in the same window as Oak
            if (oakWindowId != null && p.windowId !== oakWindowId) return false;
            return !p.isBackground;
          });
          count += visiblePanes.length;
        }
      }
    }
  }

  return count;
}

/**
 * Get item at index in state-based project view
 */
export function getStateItemAtIndex(
  state: OakProjectsState,
  expandedProjects: ReadonlySet<string>,
  expandedWorktrees: ReadonlySet<string>,
  index: number,
  leftPaneId: string | null,
  oakWindowId: string | null = null,
): StateProjectItem | null {
  let currentIndex = 0;
  const projects = getProjectsInConfigOrder(state);

  for (const project of projects) {
    if (currentIndex === index) {
      return { type: "project", projectPath: project.path };
    }
    currentIndex++;

    if (expandedProjects.has(project.path)) {
      const worktrees = Object.values(project.worktrees);
      for (const wt of worktrees) {
        if (currentIndex === index) {
          return { type: "worktree", projectPath: project.path, worktreePath: wt.path };
        }
        currentIndex++;

        if (expandedWorktrees.has(wt.path)) {
          // Only iterate visible panes - must match rendering logic
          const visiblePanes = wt.panes.filter((p) => {
            if (p.isBackground) return true;
            // Only show foreground panes that are in the same window as Oak
            if (oakWindowId != null && p.windowId !== oakWindowId) return false;
            return !p.isBackground;
          });

          for (const pane of visiblePanes) {
            if (currentIndex === index) {
              return {
                type: "pane",
                projectPath: project.path,
                worktreePath: wt.path,
                paneId: pane.paneId,
                isBackground: pane.isBackground,
              };
            }
            currentIndex++;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Render projects from YAML state with pane hierarchy
 */
export function renderProjectsFromState(
  renderer: CliRenderer,
  contentScroll: ScrollBoxRenderable,
  state: OakProjectsState,
  renderCounter: number,
  expandedProjects: Set<string>,
  expandedWorktrees: Set<string>,
  onUpdate: () => void,
  selectedIndex: number = -1,
  activeWorktreePath: string | null,
  oakPaneId: string,
  leftPaneId: string | null,
  debug: boolean = false,
  oakWindowId: string | null = null,
): void {
  const projects = getProjectsInConfigOrder(state);

  if (projects.length === 0) {
    const emptyText = new TextRenderable(renderer, {
      id: `empty-projects-${renderCounter}`,
      content: "No recent projects",
      fg: "#808080",
    });
    contentScroll.add(emptyText);
    return;
  }

  let flatIndex = 0;

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    const isExpanded = expandedProjects.has(project.path);
    const expandIcon = isExpanded ? "\u{25BC}" : "\u{25B6}";

    const projectBox = new BoxRenderable(renderer, {
      id: `project-${renderCounter}-${i}`,
      width: "100%",
      flexDirection: "column",
      paddingBottom: 1,
    });

    // Project header
    const projectIsSelected = selectedIndex === flatIndex;
    flatIndex++;

    const projectHeader = new BoxRenderable(renderer, {
      id: `project-header-${renderCounter}-${i}`,
      width: "100%",
      flexDirection: "row",
      backgroundColor: projectIsSelected ? "#3a3a3a" : undefined,
    });

    const projectHoverHandlers = createHoverHandlers(projectHeader, renderer, projectIsSelected);
    projectHeader.onMouseOver = projectHoverHandlers.onMouseOver;
    projectHeader.onMouseOut = projectHoverHandlers.onMouseOut;

    const expandIconText = new TextRenderable(renderer, {
      id: `project-expand-${renderCounter}-${i}`,
      content: `${debug && projectIsSelected ? "→ " : ""}${expandIcon} `,
      fg: "#666666",
    });

    const projectName = new TextRenderable(renderer, {
      id: `project-name-${renderCounter}-${i}`,
      content: project.name,
      fg: "#eeeeee",
      flexGrow: 1,
    });

    // Beads indicator: dashed circle on the right
    const beadsIndicator = project.beads.enabled
      ? new TextRenderable(renderer, {
          id: `project-beads-${renderCounter}-${i}`,
          content: "◌",
          fg: "#666666",
        })
      : null;

    // Use space-between layout for project header
    projectHeader.justifyContent = "space-between";

    // Left side: expand icon + name
    const projectLeft = new BoxRenderable(renderer, {
      id: `project-left-${renderCounter}-${i}`,
      flexDirection: "row",
    });
    projectLeft.add(expandIconText);
    projectLeft.add(projectName);

    projectHeader.add(projectLeft);
    if (beadsIndicator) projectHeader.add(beadsIndicator);

    projectHeader.onMouse = (event: MouseEvent) => {
      try {
        if (event.type === "up" && event.button === 0) {
          event.stopPropagation();
          if (isExpanded) {
            expandedProjects.delete(project.path);
          } else {
            expandedProjects.add(project.path);
          }
          // Use setTimeout to defer re-render until after mouse event completes
          setTimeout(() => { onUpdate(); }, 0);
        }
      } catch {
        // Ignore mouse handler errors
      }
    };

    projectBox.add(projectHeader);

    // Worktrees
    if (isExpanded) {
      const worktrees = Object.values(project.worktrees);

      for (let wtIdx = 0; wtIdx < worktrees.length; wtIdx++) {
        const wt = worktrees[wtIdx];
        const wtIsSelected = selectedIndex === flatIndex;
        flatIndex++;

        const wtIsExpanded = expandedWorktrees.has(wt.path);

        // Calculate visible panes to display in the list:
        // - All background panes (orange ◌) in any window
        // - All foreground panes (purple ●) in the CURRENT window only
        const visiblePanes = wt.panes.filter((p) => {
          if (p.isBackground) return true;
          // Only show foreground panes that are in the same window as Oak
          if (oakWindowId != null && p.windowId !== oakWindowId) return false;
          return !p.isBackground;
        });

        // Count foreground panes in current window for multi-view indicator
        const foregroundPanes = wt.panes.filter((p) => {
          if (p.isBackground) return false;
          // Only count foreground panes in the current window
          if (oakWindowId != null && p.windowId !== oakWindowId) return false;
          return true;
        });
        const foregroundCount = foregroundPanes.length;

        const wtExpandIcon = visiblePanes.length > 0
          ? (wtIsExpanded ? "\u{25BC}" : "\u{25B6}")
          : " ";

        // Check if this worktree is the current active one
        const isCurrentWorktree = activeWorktreePath !== null && (
          activeWorktreePath === wt.path ||
          activeWorktreePath.startsWith(wt.path + "/")
        );

        // Check for background panes
        const hasBgPanes = wt.panes.some((p) => p.isBackground);

        // Container for worktree + its panes (no background highlight here)
        const wtBox = new BoxRenderable(renderer, {
          id: `worktree-${renderCounter}-${i}-${wtIdx}`,
          flexDirection: "column",
          paddingLeft: 1,
        });

        // Header box for worktree info only (this gets the background highlight)
        const wtHeaderBox = new BoxRenderable(renderer, {
          id: `worktree-header-${renderCounter}-${i}-${wtIdx}`,
          flexDirection: "column",
          backgroundColor: wtIsSelected ? "#3a3a3a" : undefined,
        });

        const wtHoverHandlers = createHoverHandlers(wtHeaderBox, renderer, wtIsSelected);
        wtHeaderBox.onMouseOver = wtHoverHandlers.onMouseOver;
        wtHeaderBox.onMouseOut = wtHoverHandlers.onMouseOut;

        // Indicator: purple for current, orange for background panes
        let indicator = "";
        let indicatorColor = "";
        if (isCurrentWorktree) {
          indicator = " \u25CF"; // Big filled circle
          indicatorColor = "#a855f7"; // Purple
        } else if (hasBgPanes) {
          indicator = " \u2022"; // Small bullet
          indicatorColor = "#f97316"; // Orange
        }

        const wtNameRow = new BoxRenderable(renderer, {
          id: `worktree-name-row-${renderCounter}-${i}-${wtIdx}`,
          flexDirection: "row",
        });

        const wtExpandText = new TextRenderable(renderer, {
          id: `worktree-expand-${renderCounter}-${i}-${wtIdx}`,
          content: `${debug && wtIsSelected ? "→ " : ""}${wtExpandIcon} `,
          fg: "#666666",
        });

        const wtName = new TextRenderable(renderer, {
          id: `worktree-name-${renderCounter}-${i}-${wtIdx}`,
          content: `⎇ ${basename(wt.path)}`,
          fg: "#7fd88f",
        });

        const wtIndicator = indicatorColor
          ? new TextRenderable(renderer, {
              id: `worktree-indicator-${renderCounter}-${i}-${wtIdx}`,
              content: indicator,
              fg: indicatorColor,
            })
          : null;

        // Pane count badge
        // Show multi-view count if there are multiple foreground panes
        // Otherwise show total visible panes (background + active foreground)
        const paneCountBadge = foregroundCount > 1
          ? new TextRenderable(renderer, {
              id: `worktree-pane-count-${renderCounter}-${i}-${wtIdx}`,
              content: ` (${foregroundCount} visible)`,
              fg: "#a855f7", // Purple to indicate multi-view
            })
          : visiblePanes.length > 0
          ? new TextRenderable(renderer, {
              id: `worktree-pane-count-${renderCounter}-${i}-${wtIdx}`,
              content: ` (${visiblePanes.length})`,
              fg: "#666666",
            })
          : null;

        wtNameRow.add(wtExpandText);
        wtNameRow.add(wtName);
        if (wtIndicator) wtNameRow.add(wtIndicator);
        if (paneCountBadge) wtNameRow.add(paneCountBadge);

        const wtInfo = new TextRenderable(renderer, {
          id: `worktree-info-${renderCounter}-${i}-${wtIdx}`,
          content: `     ${wt.branch}`,
          fg: "#606060",
          wrapMode: "none",
        });

        // Click on worktree header = create new pane or toggle expand
        wtHeaderBox.onMouseDown = (event: Readonly<{ stopPropagation: () => void }>) => {
          event.stopPropagation();
          // Toggle expand if has visible panes, otherwise create new pane
          if (visiblePanes.length > 0) {
            if (wtIsExpanded) {
              expandedWorktrees.delete(wt.path);
            } else {
              expandedWorktrees.add(wt.path);
            }
            // Use setTimeout to defer re-render until after mouse event completes
            setTimeout(() => { onUpdate(); }, 0);
          } else {
            // No visible panes - create a new one
            createNewPaneForWorktree(wt.path, oakPaneId);
            setTimeout(() => { onUpdate(); }, 0);
          }
        };

        // Add name row and info to header box
        wtHeaderBox.add(wtNameRow);
        wtHeaderBox.add(wtInfo);
        
        // Add header box to worktree container
        wtBox.add(wtHeaderBox);

        // Panes (if expanded) - use already computed visiblePanes
        if (wtIsExpanded && visiblePanes.length > 0) {

          for (let paneIdx = 0; paneIdx < visiblePanes.length; paneIdx++) {
            const pane = visiblePanes[paneIdx];
            const paneIsSelected = selectedIndex === flatIndex;
            flatIndex++;

            const paneBox = new BoxRenderable(renderer, {
              id: `pane-${renderCounter}-${i}-${wtIdx}-${paneIdx}`,
              width: "100%",
              flexDirection: "row",
              paddingLeft: 3,
              backgroundColor: paneIsSelected ? "#3a3a3a" : undefined,
            });

            // Apply hover handlers - use same color as keyboard selection
            const paneHoverHandlers = createHoverHandlers(paneBox, renderer, paneIsSelected);
            paneBox.onMouseOver = paneHoverHandlers.onMouseOver;
            paneBox.onMouseOut = paneHoverHandlers.onMouseOut;

            // Pane icon and status
            const paneIcon = pane.isBackground ? "◌" : "●";
            const paneIconColor = pane.isBackground ? "#f97316" : "#a855f7";

            const paneIconText = new TextRenderable(renderer, {
              id: `pane-icon-${renderCounter}-${i}-${wtIdx}-${paneIdx}`,
              content: `${debug && paneIsSelected ? "→ " : ""}${paneIcon} `,
              fg: paneIconColor,
            });

            // Show current command and location info
            // Prefer paneTitle if it's meaningful (not the default hostname/username)
            const paneTitle = pane.paneTitle ?? "";
            const user = process.env.USER ?? "";
            const titleLower = paneTitle.toLowerCase();
            const isDefaultTitle = paneTitle === "" || 
              titleLower === user.toLowerCase() || 
              titleLower.includes(user.toLowerCase()) ||
              titleLower === "bash" || 
              titleLower === "zsh";
            const paneCommand = isDefaultTitle ? pane.currentCommand : paneTitle;
            const paneLabel = pane.isBackground
              ? `${pane.sessionName}:${pane.windowId}`
              : "active";

            const paneText = new TextRenderable(renderer, {
              id: `pane-text-${renderCounter}-${i}-${wtIdx}-${paneIdx}`,
              content: `${paneCommand} ${pane.paneId} (${paneLabel})`,
              fg: "#a0a0a0",
            });

            // Click on pane behavior:
            // - Background pane: add to multi-view (instead of swapping)
            // - Foreground pane with 1 visible: no-op
            // - Foreground pane with multiple visible: cycle focus to next pane
            paneBox.onMouseDown = (event: Readonly<{ stopPropagation: () => void }>) => {
              event.stopPropagation();
              
              // Count visible foreground panes
              const visiblePanes = getVisibleForegroundPanes(oakPaneId);
              
              if (pane.isBackground) {
                // Background pane: add to multi-view
                addPaneToMultiView(pane.paneId, true, oakPaneId);
                // Use setTimeout to defer re-render until after mouse event completes
                setTimeout(() => { onUpdate(); }, 0);
              } else if (visiblePanes.length === 1) {
                // Only one foreground pane visible: no-op
              } else if (visiblePanes.length > 1) {
                // Multiple foreground panes visible: cycle focus to next pane
                cycleToNextVisiblePane(oakPaneId);
                // No need to update content since we're just changing focus
              }
            };

            paneBox.add(paneIconText);
            paneBox.add(paneText);
            wtBox.add(paneBox);
          }
        }

        projectBox.add(wtBox);
      }
    }

    contentScroll.add(projectBox);
  }
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
  return iconMap[ext ?? ""] ?? "○";
}

// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- CliRenderer and ScrollBoxRenderable are mutable external types
export function renderFiles(
  renderer: CliRenderer,
  contentScroll: ScrollBoxRenderable,
  fileTree: readonly ReadonlyFileTreeNode[],
  searchQuery: string,
  expandedPaths: ReadonlySet<string>,
  renderCounter: number,
  onToggleFolder: (path: string) => void,
  selectedIndex: number = -1,
  debug: boolean = false,
  rootPath?: string,
): void {
  // Show root path at the top in muted color
  if (rootPath != null && rootPath !== "") {
    const rootPathBox = new BoxRenderable(renderer, {
      id: `files-root-path-box-${renderCounter}`,
      width: "100%",
      paddingBottom: 1,
    });
    const rootPathText = new TextRenderable(renderer, {
      id: `files-root-path-${renderCounter}`,
      content: rootPath,
      fg: "#666666",
    });
    rootPathBox.add(rootPathText);
    contentScroll.add(rootPathBox);
  }

  const filteredTree = searchQuery
    ? filterFileTree(fileTree, searchQuery)
    : fileTree.map(toMutableNode);
  const flatFiles = flattenFileTree(filteredTree, expandedPaths, searchQuery);

  if (flatFiles.length === 0) {
    const emptyText = new TextRenderable(renderer, {
      id: `empty-files-${renderCounter}`,
      content: searchQuery ? "No matches found" : "No files found",
      fg: "#808080",
    });
    contentScroll.add(emptyText);
    return;
  }

  for (let i = 0; i < flatFiles.length; i++) {
    const file = flatFiles[i];
    const indent = "  ".repeat(file.depth);
    const isExpanded = expandedPaths.has(file.path);
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
    });

    // Apply hover handlers
    const fileHoverHandlers = createHoverHandlers(
      fileBox,
      renderer,
      isSelected,
    );
    fileBox.onMouseOver = fileHoverHandlers.onMouseOver;
    fileBox.onMouseOut = fileHoverHandlers.onMouseOut;

    const fileName = new TextRenderable(renderer, {
      id: `file-name-${renderCounter}-${i}`,
      content: `${debug && isSelected ? "→ " : ""}${indent}${icon} ${file.name}`,
      fg: file.isDirectory ? "#5c9cf5" : "#eeeeee",
    });

    fileBox.add(fileName);

    if (file.isDirectory) {
      fileBox.onMouseDown = (
        event: Readonly<{ stopPropagation: () => void }>,
      ) => {
        event.stopPropagation();
        onToggleFolder(file.path);
      };
    }

    contentScroll.add(fileBox);
  }
}

// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- ScrollBoxRenderable is a mutable external type
export function clearContent(contentScroll: ScrollBoxRenderable): void {
  const children = contentScroll.getChildren();
  for (const child of children) {
    contentScroll.remove(child.id);
    child.destroyRecursively();
  }
}

// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- CliRenderer and ScrollBoxRenderable are mutable external types
export function renderThemes(
  renderer: CliRenderer,
  contentScroll: ScrollBoxRenderable,
  themes: readonly Theme[],
  currentThemeName: string,
  renderCounter: number,
  onSelectTheme: (themeName: string) => void,
  selectedIndex: number,
): void {
  for (let i = 0; i < themes.length; i++) {
    const theme = themes[i];
    const isSelected = theme.name === currentThemeName;
    const isKeyboardSelected = i === selectedIndex;
    const indicator = isSelected ? "●" : "○";

    const themeBox = new BoxRenderable(renderer, {
      id: `theme-${renderCounter}-${i}`,
      width: "100%",
      flexDirection: "row",
      gap: 2,
      paddingBottom: 1,
      backgroundColor: isKeyboardSelected ? "#3a3a3a" : undefined,
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

    themeBox.onMouseDown = (
      event: Readonly<{ stopPropagation: () => void }>,
    ) => {
      event.stopPropagation();
      onSelectTheme(theme.name);
    };

    contentScroll.add(themeBox);
  }
}

// Board section labels
const BOARD_SECTIONS: { key: keyof GroupedIssues; label: string }[] = [
  { key: "in_progress", label: "In Progress" },
  { key: "ready", label: "Ready" },
  { key: "blocked", label: "Blocked" },
  { key: "closed", label: "Closed" },
];

// Track last click for double-click detection
let lastClickTime = 0;
let lastClickIssueId = "";

// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- CliRenderer and ScrollBoxRenderable are mutable external types
export function renderBoard(
  renderer: CliRenderer,
  contentScroll: ScrollBoxRenderable,
  groupedIssues: Readonly<GroupedIssues>,
  renderCounter: number,
  selectedIndex: number,
  onSelectIssue: (issue: Readonly<BeadsIssue>) => void,
  onOpenIssue?: (issue: Readonly<BeadsIssue>) => void,
  debug: boolean = false,
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

      // Left side: Type badge (colored dot)
      const typeBadge = new TextRenderable(renderer, {
        id: `board-type-${renderCounter}-${flatIndex}`,
        content: `${debug && isSelected ? "→ " : ""}●`,
        fg: getTypeColor(issue.issue_type),
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

      // Apply hover handlers
      const issueHoverHandlers = createHoverHandlers(
        issueBox,
        renderer,
        isSelected,
      );
      issueBox.onMouseOver = issueHoverHandlers.onMouseOver;
      issueBox.onMouseOut = issueHoverHandlers.onMouseOut;

      issueBox.onMouseDown = (
        event: Readonly<{ stopPropagation: () => void }>,
      ) => {
        event.stopPropagation();
        const now = Date.now();
        const isDoubleClick =
          now - lastClickTime < 400 && lastClickIssueId === issue.id;

        if (isDoubleClick && onOpenIssue !== undefined) {
          onOpenIssue(issue);
        } else {
          onSelectIssue(issue);
        }

        lastClickTime = now;
        lastClickIssueId = issue.id;
      };

      sectionBox.add(issueBox);
      flatIndex++;
    }

    contentScroll.add(sectionBox);
  }
}
