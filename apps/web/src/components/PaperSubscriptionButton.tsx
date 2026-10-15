import { useEffect, useRef, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { fetchPaperSubscription, setPaperSubscription } from "../api";
import { useToast } from "../ToastContext";

export function PaperSubscriptionButton({ docId }: { docId: string }) {
  const { showToast } = useToast();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setSubscribed(null);
    fetchPaperSubscription(docId).then(result => { if (!cancelled) setSubscribed(result.subscribed); })
      .catch(err => { if (!cancelled) showToast(String(err), "error"); });
    return () => { cancelled = true; };
  }, [docId, showToast]);
  async function toggle() {
    if (pending.current || subscribed === null) return;
    pending.current = true; setBusy(true);
    try { setSubscribed((await setPaperSubscription(docId, !subscribed)).subscribed); }
    catch (err) { showToast(String(err), "error"); }
    finally { pending.current = false; setBusy(false); }
  }
  return <button type="button" className="pxr-btn" disabled={busy || subscribed === null} aria-pressed={subscribed ?? false}
    title={subscribed ? "Unsubscribe from new comments" : "Notify me when someone comments on this paper"}
    onClick={() => void toggle()} style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
    {subscribed ? <BellRing size={13} aria-hidden="true" /> : <Bell size={13} aria-hidden="true" />}
    {subscribed ? "Subscribed" : "Subscribe"}
  </button>;
}
