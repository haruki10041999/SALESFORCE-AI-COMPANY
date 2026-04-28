#!/usr/bin/env node
import { runPrecommitGuard } from "./precommit-guard.js";

process.exit(runPrecommitGuard());