// Keep structured log context small and JSON-safe instead of passing raw errors.
// A fetch failure usually carries the useful detail on `cause` (an
// UND_ERR_CONNECT_TIMEOUT code, for instance), so that is flattened in too.
export function getErrorDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return {
      errorMessage: String(error),
    };
  }

  const cause = error.cause;
  const causeCode =
    cause && typeof cause === "object" && "code" in cause
      ? cause.code
      : undefined;

  return {
    errorName: error.name,
    errorMessage: error.message,
    causeName: cause instanceof Error ? cause.name : undefined,
    causeMessage: cause instanceof Error ? cause.message : undefined,
    causeCode,
  };
}
