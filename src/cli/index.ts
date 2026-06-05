#!/usr/bin/env node
import { Command } from "commander";
import { extractCommand } from "../commands/extract.js";
import { inspectCommand } from "../commands/inspect.js";
import { installCommand } from "../commands/install.js";

const program = new Command();

program
  .name("dbrief")
  .description("Extract Codex session activity into daily artifacts")
  .version("0.1.0");

program
  .command("extract")
  .description("Extract session data for a target date or date range")
  .option("--date <date>", "Target date (today, yesterday, or YYYY-MM-DD)")
  .option("--from <date>", "Start date for range extraction (YYYY-MM-DD)")
  .option("--to <date>", "End date for range extraction (YYYY-MM-DD)")
  .option("--out <path>", "Output file path (single day) or directory (range)")
  .option("--codex-dir <path>", "Codex data directory", "~/.codex")
  .action(extractCommand);

program
  .command("install")
  .description("Install the dbrief-note skill into the current project")
  .action(installCommand);

program
  .command("inspect")
  .description("Inspect a daily artifact")
  .requiredOption("--input <path>", "Input artifact file")
  .option("--format <format>", "Output format (summary)")
  .action(inspectCommand);

program.parse();
