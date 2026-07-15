#!/usr/bin/env node

import { VERSION } from "./version.js";

const argv = process.argv.slice(2);

function importFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`tidesurf: CLI runtime failed to load: ${message}\n`);
  process.exitCode = 5;
}

async function startDaemon(args: string[]): Promise<void> {
  const stateIndex = args.indexOf("--state-file");
  const stateFile = stateIndex === -1 ? undefined : args[stateIndex + 1];
  if (!stateFile) {
    const error = new Error("Daemon requires --state-file");
    error.name = "SessionProtocolError";
    throw error;
  }
  const { runDaemon } = await import("./cli/daemon.js");
  await runDaemon(stateFile);
}

if (argv.length === 1 && (argv[0] === "-V" || argv[0] === "--version")) {
  process.stdout.write(`${VERSION}\n`);
} else if (argv[0] === "__daemon") {
  void startDaemon(argv).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`tidesurf: ${message}\n`);
    process.exitCode = error instanceof Error && error.name === "SessionProtocolError" ? 5 : 4;
  });
} else if (
  argv.length === 0 ||
  (argv.length === 1 && (
    argv[0] === "-h" ||
    argv[0] === "--help" ||
    argv[0] === "help"
  ))
) {
  void import("./cli/help.js").then(({ generalHelp }) => {
    process.stdout.write(`${generalHelp()}\n`);
  }, importFailure);
} else {
  void import("./cli-program.js").then(({ runCliProcess }) => {
    runCliProcess(argv);
  }, importFailure);
}
