// Shared __daemon spawn argv contract for cli.ts and cli/session.ts. Keep
// this module dependency-free: cli.ts imports it on the fast boot path.
export const DAEMON_COMMAND = "__daemon";

export interface DaemonStartArgs {
  stateFile: string;
  startupToken: string;
}

export function buildDaemonArgv(args: DaemonStartArgs): string[] {
  return [
    DAEMON_COMMAND,
    "--state-file",
    args.stateFile,
    "--startup-token",
    args.startupToken,
  ];
}

export function parseDaemonArgv(argv: string[]): DaemonStartArgs {
  const optionValue = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const stateFile = optionValue("--state-file");
  const startupToken = optionValue("--startup-token");
  if (!stateFile || !startupToken) {
    const error = new Error("Daemon requires --state-file and --startup-token");
    error.name = "SessionProtocolError";
    throw error;
  }
  return { stateFile, startupToken };
}
