const MAX_LENGTH = 500;

export function errorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error && cause.message && !message.includes(cause.message)) {
    message = `${message}: ${cause.message}`;
  }
  return message.length > MAX_LENGTH ? `${message.slice(0, MAX_LENGTH - 1)}…` : message;
}
