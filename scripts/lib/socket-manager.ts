// Single instance management via Unix socket

import { existsSync, unlinkSync } from "fs";
import { createServer, createConnection, type Socket } from "net";
import { join } from "path";
import { homedir } from "os";

const DATA_DIR = join(homedir(), ".local", "share", "git-worktree-manager");
const SOCKET_FILE = join(DATA_DIR, "tui.sock");

export function debug(...args: unknown[]): void {
  // Will be injected by main app
}

export function setDebugFn(fn: (...args: unknown[]) => void): void {
  Object.assign(debug, fn);
}

/**
 * Check if an existing instance is running
 * Returns: "none" = no existing instance, "connected" = found existing instance, "stale" = stale socket cleaned up
 */
export function checkExistingInstance(): Promise<
  "none" | "connected" | "stale"
> {
  debug("checkExistingInstance called");
  return new Promise((resolve) => {
    if (!existsSync(SOCKET_FILE)) {
      debug("Socket file does not exist, no existing instance");
      resolve("none");
      return;
    }

    debug("Socket file exists, attempting connection...");
    const client = createConnection(SOCKET_FILE);
    const timeout = setTimeout(() => {
      debug("Connection timeout, no existing instance responding");
      client.destroy();
      resolve("stale");
    }, 500);

    client.on("connect", () => {
      clearTimeout(timeout);
      debug("Connected to existing instance");
      client.end();
      resolve("connected");
    });

    client.on("error", (err) => {
      clearTimeout(timeout);
      debug("Connection error:", err.message);
      // Socket file exists but no server - clean it up
      try {
        unlinkSync(SOCKET_FILE);
        debug("Cleaned up stale socket file");
      } catch {}
      resolve("stale");
    });
  });
}

/**
 * Send reload command to existing instance
 */
export function sendReloadCommand(dir: string): Promise<boolean> {
  debug("sendReloadCommand called with dir:", dir);
  return new Promise((resolve) => {
    const client = createConnection(SOCKET_FILE);
    const timeout = setTimeout(() => {
      debug("Reload command timeout");
      client.destroy();
      resolve(false);
    }, 1000);

    client.on("connect", () => {
      debug("Connected, sending reload command");
      client.write(JSON.stringify({ command: "reload", dir }));
      client.end();
      clearTimeout(timeout);
      resolve(true);
    });

    client.on("error", (err) => {
      debug("Error sending reload command:", err.message);
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

/**
 * Create socket server for single instance detection
 */
export function createSocketServer(onReload: (dir: string) => void): void {
  debug("Creating socket server...");

  // Clean up existing socket if stale
  if (existsSync(SOCKET_FILE)) {
    try {
      unlinkSync(SOCKET_FILE);
      debug("Cleaned up existing socket file");
    } catch (err) {
      debug("Error cleaning up socket:", err);
    }
  }

  const server = createServer((socket: Socket) => {
    debug("Client connected to socket server");

    socket.on("data", (data) => {
      try {
        const message = JSON.parse(data.toString());
        debug("Received message:", message);

        if (message.command === "reload" && message.dir) {
          debug("Reload command received for dir:", message.dir);
          onReload(message.dir);
        }
      } catch (err) {
        debug("Error parsing socket message:", err);
      }
    });

    socket.on("error", (err) => {
      debug("Socket error:", err);
    });
  });

  server.listen(SOCKET_FILE, () => {
    debug("Socket server listening on:", SOCKET_FILE);
  });

  server.on("error", (err) => {
    debug("Socket server error:", err);
  });

  // Clean up socket on exit
  process.on("exit", () => {
    try {
      if (existsSync(SOCKET_FILE)) {
        unlinkSync(SOCKET_FILE);
      }
    } catch {}
  });

  process.on("SIGINT", () => {
    try {
      if (existsSync(SOCKET_FILE)) {
        unlinkSync(SOCKET_FILE);
      }
    } catch {}
    process.exit(0);
  });
}

/**
 * Get socket file path
 */
export function getSocketFile(): string {
  return SOCKET_FILE;
}
