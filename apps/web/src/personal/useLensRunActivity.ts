import { useCallback, useState } from "react";

/** Runs own their pending flag; finishing one cannot clear another run. */
export function createLensRunActivity(onChange: (keys: ReadonlySet<string>) => void) {
  const pending = new Set<string>();
  return async (key: string, work: () => Promise<void>): Promise<void> => {
    if (pending.has(key)) return;
    pending.add(key); onChange(new Set(pending));
    try { await work(); }
    finally { pending.delete(key); onChange(new Set(pending)); }
  };
}

export function useLensRunActivity(docId: string) {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [track] = useState(() => createLensRunActivity(setPending));
  const trackLensRun = useCallback((lensId: string, work: () => Promise<void>) => track(`${docId}:${lensId}`, work), [docId, track]);
  return { trackLensRun, isLensRunning: (lensId: string) => pending.has(`${docId}:${lensId}`) };
}
