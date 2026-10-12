/** Connection failures may recover on a later request using a fresh pooled connection. */
export function isDatabaseUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return new Set([
    "PROTOCOL_CONNECTION_LOST", "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR", "PROTOCOL_ENQUEUE_AFTER_QUIT",
    "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EHOSTUNREACH", "ENETUNREACH",
    "ER_CON_COUNT_ERROR", "ER_SERVER_SHUTDOWN",
  ]).has(String(error.code));
}
