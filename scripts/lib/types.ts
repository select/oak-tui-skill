// Core types and interfaces for Git Worktree Manager

export interface ThemeColors {
  primary: string; // Main accent color
  secondary: string; // Secondary accent
  accent: string; // Tertiary accent

  error: string;
  warning: string;
  success: string;
  info: string;

  text: string; // Primary text
  textMuted: string; // Secondary text

  background: string; // Main background
  backgroundPanel: string; // Header/footer (darker)

  border: string;
  borderFocused: string;
}

export interface Theme {
  name: string;
  displayName: string;
  colors: ThemeColors;
}

export interface Worktree {
  path: string;
  branch: string;
  commit: string;
  isPrunable: boolean;
}

export interface ProjectNode {
  path: string;
  name: string;
  worktrees: Worktree[];
  isExpanded: boolean;
  isActive: boolean;
}

export interface TmuxSession {
  paneId: string;
  projectPath: string;
}

export interface BackgroundPane {
  paneId: string;
  worktreePath: string;
  projectPath: string;
  createdAt: number; // timestamp
}

export type TabId = "projects" | "files" | "themes";

export interface Tab {
  id: TabId;
  label: string;
}
