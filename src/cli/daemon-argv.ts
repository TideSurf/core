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

function daemonArgvError(): Error {
  const error = new Error(
    "Daemon requires exactly __daemon --state-file <path> --startup-token <token>"
  );
  error.name = "SessionProtocolError";
  return error;
}

export function parseDaemonArgv(argv: string[]): DaemonStartArgs {
  if (
    argv.length !== 5 ||
    argv[0] !== DAEMON_COMMAND ||
    argv[1] !== "--state-file" ||
    !argv[2] ||
    argv[3] !== "--startup-token" ||
    !argv[4]
  ) {
    throw daemonArgvError();
  }
  return { stateFile: argv[2], startupToken: argv[4] };
}

/** Match the complete internal daemon argv suffix using exact tokens. */
export function matchesDaemonArgv(
  argv: readonly string[],
  expected: DaemonStartArgs
): boolean {
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] !== DAEMON_COMMAND) continue;
    try {
      const parsed = parseDaemonArgv(argv.slice(index));
      return (
        parsed.stateFile === expected.stateFile &&
        parsed.startupToken === expected.startupToken
      );
    } catch {
      // An exact command token with a malformed suffix is not our daemon.
    }
  }
  return false;
}
