import { useEffect, useRef, useState, type ReactNode } from "react";
import { Reply, Pencil, Trash2, ThumbsUp, ThumbsDown, Lock, Unlock, Sparkles } from "lucide-react";
import type { Annotation, HumanAnnotation, Role, Visibility } from "@paper-xray/contracts";
import { deleteComment, replyToComment, updateComment, voteOnAnnotation } from "../api";
import { canDeleteComment } from "./comment-threads";
import { UserIdentity } from "./UserIdentity";
import { useToast } from "../ToastContext";
import { AiReplyComposer } from "./AiReplyComposer";
import { CommentText } from "./CommentText";

type Props = {
  annotation: Annotation;
  byParent: Map<string, HumanAnnotation[]>;
  userId: string | null;
  role?: Role;
  onChanged: () => void;
  rootHeader?: ReactNode;
  rootContent?: ReactNode;
  /** When set, an extra icon button is shown in the root comment's actions to toggle run visibility. */
  runVisibilityAction?: {
    currentVisibility: Visibility;
    onToggle: () => void;
  };
};

export function AnnotationDiscussion(props: Props) {
  // Flatten rendering so arbitrarily deep threads keep a usable width.
  const rows: { annotation: Annotation; depth: number; parentName?: string }[] = [];
  const stack = [{ annotation: props.annotation, depth: 0, parentName: undefined as string | undefined }];
  const visited = new Set<string>();
  while (stack.length) {
    const row = stack.pop()!;
    const kind = "authorId" in row.annotation ? "human" : "agent";
    const key = `${kind}:${row.annotation.id}`;
    if (visited.has(key)) continue;
    visited.add(key); rows.push(row);
    const children = props.byParent.get(key) ?? [];
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ annotation: children[i], depth: row.depth + 1, parentName: "authorId" in row.annotation ? row.annotation.ai ? "AI" : row.annotation.authorName ?? "Member" : "Lens" });
    }
  }
  return <div className="pxr-discussion">
    {rows.map(row => <CommentRow key={row.annotation.id} {...props} {...row} />)}
  </div>;
}

function CommentRow({ annotation, userId, role, onChanged, depth, rootHeader, rootContent, runVisibilityAction }: Props & { depth: number; parentName?: string }) {
  const { showToast } = useToast();
  const human = "authorId" in annotation ? annotation : null;
  const deleted = !!human?.deletedAt;
  const [mode, setMode] = useState<"edit" | "reply" | "delete" | "ai" | null>(null);
  const generating = human?.ai?.status === "queued" || human?.ai?.status === "running";
  const [draft, setDraft] = useState("");
  const [initialDraft, setInitialDraft] = useState("");
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [votes, setVotes] = useState(annotation.votes ?? { upvotes: 0, downvotes: 0, myVote: 0 });
  const [voting, setVoting] = useState(false);
  const votePending = useRef(false);
  useEffect(() => {
    setVotes(annotation.votes ?? { upvotes: 0, downvotes: 0, myVote: 0 });
  }, [annotation.votes]);
  async function vote(value: -1 | 1) {
    if (!userId || votePending.current) return;
    votePending.current = true; setVoting(true);
    try {
      setVotes(await voteOnAnnotation(annotation.docId, annotation.id, human ? "human" : "agent", votes.myVote === value ? 0 : value));
      onChanged();
    } catch (err) { showToast(err instanceof Error ? err.message : String(err), "error"); }
    finally { votePending.current = false; setVoting(false); }
  }
  const own = human?.authorId === userId && !!userId;
  function open(next: "edit" | "reply" | "delete" | "ai") {
    const initial = next === "edit" ? human!.body : "";
    setMode(next); setDraft(initial); setInitialDraft(initial);
    setVersion(human?.version ?? 0);
  }
  async function submit() {
    if (!mode || mode === "ai" || busy) return;
    setBusy(true);
    try {
      if (mode === "edit") await updateComment(annotation.docId, annotation.id, draft.trim(), version);
      else if (mode === "delete") await deleteComment(annotation.docId, annotation.id, version);
      else await replyToComment(annotation.docId, annotation.id, human ? "human" : "agent", draft.trim());
      setMode(null); setDraft(""); onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
      onChanged();
    } finally { setBusy(false); }
  }
  return <div id={`pxr-comment-${annotation.id}`} className="pxr-comment" data-root={depth === 0} data-agent={!human} data-action-open={mode !== null} tabIndex={userId ? 0 : undefined} style={{ marginLeft: Math.min(depth, 4) * 10, borderLeft: depth ? "2px solid var(--border)" : undefined, paddingLeft: depth ? 9 : 0, fontSize: 12 }}>
    <div className="pxr-comment-header">
      <div className="pxr-comment-heading">
        {depth === 0 && rootHeader ? rootHeader : <UserIdentity name={human?.ai ? "AI" : human?.authorName} />}
        {human?.ai && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--text-muted)", overflowWrap: "anywhere" }}
          title={`${human.ai.providerName} · Requested by ${human.authorName ?? "Member"}`}>{human.ai.model}</span>}
      </div>
    {userId && <div className="pxr-comment-actions" role="group" aria-label="Comment actions">
      {depth === 0 && runVisibilityAction && (
        <button
          type="button"
          title={runVisibilityAction.currentVisibility === "private" ? "Share run with org" : "Make run private"}
          aria-label={runVisibilityAction.currentVisibility === "private" ? "Share run with org" : "Make run private"}
          onClick={(e) => { e.stopPropagation(); runVisibilityAction.onToggle(); }}
        >
          {runVisibilityAction.currentVisibility === "private" ? (
            <Unlock size={15} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Lock size={15} strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
      )}
      <button type="button" title="Reply" aria-label="Reply" disabled={busy || generating} onClick={(e) => { e.stopPropagation(); open("reply"); }}>
        <Reply size={15} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {!deleted && <button type="button" title="Reply with AI" aria-label="Reply with AI" disabled={busy || generating} onClick={(e) => { e.stopPropagation(); open("ai"); }}>
        <Sparkles size={15} strokeWidth={1.75} aria-hidden="true" />
      </button>}
      {own && !deleted && !human?.ai && <button type="button" title="Edit" aria-label="Edit" disabled={busy} onClick={(e) => { e.stopPropagation(); open("edit"); }}>
        <Pencil size={15} strokeWidth={1.75} aria-hidden="true" />
      </button>}
      {human && !deleted && canDeleteComment(human, userId, role) && <button type="button" className="pxr-comment-delete" title="Delete" aria-label="Delete" disabled={busy} onClick={(e) => { e.stopPropagation(); open("delete"); }}>
        <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
      </button>}
    </div>}
    </div>
    {depth === 0 && rootContent}
    {human && mode !== "edit" && <CommentText style={{ color: deleted ? "var(--text-muted)" : "var(--text)" }}>
      {deleted ? "[Comment deleted]" : generating ? human.ai?.status === "queued" ? "AI reply queued…" : "AI is thinking…"
        : human.ai?.status === "failed" ? human.ai.error ?? "AI reply failed. Please try again." : human.body}
    </CommentText>}
    {!deleted && (!human?.ai || human.ai.status === "succeeded") && <div className="pxr-comment-votes" role="group" aria-label="Votes" aria-busy={voting} onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label={`Upvote, ${votes.upvotes}`} title={votes.myVote === 1 ? "Remove upvote" : "Upvote"}
        aria-pressed={votes.myVote === 1} disabled={!userId || voting || busy} onClick={() => void vote(1)}>
        <ThumbsUp size={13} strokeWidth={1.75} aria-hidden="true" /><span>{votes.upvotes}</span>
      </button>
      <button type="button" aria-label={`Downvote, ${votes.downvotes}`} title={votes.myVote === -1 ? "Remove downvote" : "Downvote"}
        aria-pressed={votes.myVote === -1} disabled={!userId || voting || busy} onClick={() => void vote(-1)}>
        <ThumbsDown size={13} strokeWidth={1.75} aria-hidden="true" /><span>{votes.downvotes}</span>
      </button>
    </div>}
    {mode === "ai" && userId && <AiReplyComposer annotation={annotation} userId={userId} onChanged={onChanged} onClose={() => setMode(null)} />}
    {mode && mode !== "ai" && <form
      className={mode === "delete" ? "pxr-comment-confirm" : "pxr-comment-editor"}
      aria-busy={busy}
      onClick={(e) => e.stopPropagation()}
      onBlur={e => {
        if (!busy && mode !== "delete" && draft === initialDraft && !e.currentTarget.contains(e.relatedTarget)) {
          setMode(null);
        }
      }}
      onSubmit={e => { e.preventDefault(); void submit(); }}
    >
      {mode === "delete" ? <p>Delete this comment? Replies will be kept.</p> : <>
        <textarea
          aria-label={mode === "edit" ? "Edit comment" : "Reply"} autoFocus value={draft}
          placeholder={mode === "reply" ? "Write a reply…" : "Edit your comment…"}
          onChange={e => setDraft(e.target.value)} maxLength={10000} rows={3} disabled={busy}
          onKeyDown={e => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (draft.trim()) void submit();
            }
          }}
        />
      </>}
      <div className="pxr-comment-editor-footer">
        <div className="pxr-comment-editor-buttons">
          <button className="pxr-btn" type="button" disabled={busy} onClick={() => { setMode(null); }}>Cancel</button>
          <button className={`pxr-btn ${mode === "delete" ? "pxr-btn-danger" : "pxr-btn-primary"}`} type="submit" disabled={busy || (mode !== "delete" && !draft.trim())}>
            {busy ? "Saving…" : mode === "delete" ? "Delete" : mode === "edit" ? "Save" : "Reply"}
          </button>
        </div>
      </div>
    </form>}
  </div>;
}
