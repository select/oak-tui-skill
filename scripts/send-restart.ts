#!/usr/bin/env bun
// Helper script to send restart command to running TUI instance

import { sendRestartCommand } from "./lib/socket-manager";

const success = await sendRestartCommand();
process.exit(success ? 0 : 1);
