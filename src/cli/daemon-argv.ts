// Shared __daemon spawn argv contract for cli.ts and cli/session.ts. Keep
// this module dependency-free: cli.ts imports it on the fast boot path.
export const DAEMON_COMMAND = "__daemon";

export interface DaemonStartArgs {
  stateFile: string;
  startupToken: string;
}

const ENCODED_PATH_PREFIX = "base64url:";

function encodeStateFile(path: string): string {
  return `${ENCODED_PATH_PREFIX}${Buffer.from(path, "utf8").toString("base64url")}`;
}

function decodeStateFile(value: string): string | undefined {
  if (!value.startsWith(ENCODED_PATH_PREFIX)) return undefined;
  const encoded = value.slice(ENCODED_PATH_PREFIX.length);
  if (!encoded) return undefined;
  const decoded = Buffer.from(encoded, "base64url").toString("utf8");
  return encodeStateFile(decoded) === value ? decoded : undefined;
}

export function buildDaemonArgv(args: DaemonStartArgs): string[] {
  return [
    DAEMON_COMMAND,
    "--state-file",
    encodeStateFile(args.stateFile),
    "--startup-token",
    args.startupToken,
  ];
}

function daemonArgvError(): Error {
  const error = new Error(
    "Daemon requires exactly __daemon --state-file <encoded-path> --startup-token <token>"
  );
  error.name = "SessionProtocolError";
  return error;
}

export function parseDaemonArgv(argv: string[]): DaemonStartArgs {
  const stateFile = argv[2] ? decodeStateFile(argv[2]) : undefined;
  if (
    argv.length !== 5 ||
    argv[0] !== DAEMON_COMMAND ||
    argv[1] !== "--state-file" ||
    !stateFile ||
    argv[3] !== "--startup-token" ||
    !argv[4]
  ) {
    throw daemonArgvError();
  }
  return { stateFile, startupToken: argv[4] };
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
