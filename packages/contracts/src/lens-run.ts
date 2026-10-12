/** One current server-side run per document/lens; no public task identifier. */
export interface LensRunActivity {
  lensId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  stage: "queued" | "model" | "verifying" | "completed" | "failed";
  producedCount: number | null;
  submittedCount: number | null;
  error: string | null;
  updatedAt: string;
}
