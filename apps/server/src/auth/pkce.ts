import { createHash, randomBytes } from "node:crypto";

/** Recommended lengths per the mirpass guide (github.com/mirpri/mirpass/guide/AuthCodeFlow.md). */
const STATE_LENGTH = 16;
const VERIFIER_LENGTH = 43;

export function generateState(): string {
  return randomBytes(STATE_LENGTH).toString("hex").slice(0, STATE_LENGTH);
}

/** RFC 7636 code_verifier: unreserved characters only, base64url already satisfies that. */
export function generateCodeVerifier(): string {
  return randomBytes(48).toString("base64url").slice(0, VERIFIER_LENGTH);
}

export function codeChallengeFromVerifier(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
