export const SESSION_NAME_ERROR =
  "Session names must start with a letter or number and contain at most 64 letters, numbers, dots, dashes, or underscores";

export function isValidSessionName(name: string): boolean {
  return name.length > 0 &&
    name.length <= 64 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name);
}
