// Rendered inside MidtermsHome.
import Link from "next/link";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useAccount } from "@/components/AccountProvider";
import { GrokConnect } from "@/components/GrokConnect";
import { api, ApiError } from "@/lib/client";
import type { Dashboard } from "./hooks";

type Message = { role: "user" | "assistant"; content: string };
/** Recent turns sent with each message; older ones stay on screen only. */
const HISTORY = 12;

/** Lets the page start the chat: `ask("", true)` opens it for a new dashboard; with text, it also sends it. */
export type ChatHandle = { ask: (text: string, fresh: boolean) => void };

/** A chat with Grok, docked bottom-right, that builds and edits the voter's dashboards. */
export function ChatDock({ ref, open, onOpenChange, openDashboard, onChanged }: {
  ref: Ref<ChatHandle>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openDashboard: Dashboard | null;
  onChanged: (dashboards: Dashboard[], focusId: string | null) => void;
}) {
  const { user, grok, loading } = useAccount();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<"open" | "new">("open");
  const scroller = useRef<HTMLDivElement>(null);
  const editing = target === "open" ? openDashboard : null;

  async function send(content: string, fresh = target === "new") {
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setText("");
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ reply: string; focusId: string | null; dashboards: Dashboard[]; changed: boolean }>("/api/midterms/dashboards/chat", {
        body: { openId: fresh ? null : (openDashboard?.id ?? null), messages: next.slice(-HISTORY) },
      });
      setMessages([...next, { role: "assistant", content: r.reply }]);
      if (r.changed) {
        onChanged(r.dashboards, r.focusId);
        setTarget("open");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Grok couldn't answer. Try again.");
    } finally {
      setBusy(false);
    }
  }

  useImperativeHandle(ref, () => ({
    ask(content, fresh) {
      onOpenChange(true);
      setTarget(fresh ? "new" : "open");
      if (content && user && grok === "connected" && !busy) void send(content, fresh);
    },
  }));

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, busy, open]);

  return (
    <>
      {open && (
        <section className="mt-chat" aria-label="Chat with Grok about your dashboards">
          <header>
            <div>
              <b>Grok</b>
              <span className="muted small">{editing ? ` · editing “${editing.layout.title}”` : " · new dashboard"}</span>
            </div>
            <div className="mt-chat-actions">
              {openDashboard && (
                <button type="button" className="btn quiet small" onClick={() => setTarget(target === "new" ? "open" : "new")}>
                  {target === "new" ? "Edit open one" : "New dashboard"}
                </button>
              )}
              <button type="button" className="mt-chat-close" aria-label="Close chat" onClick={() => onOpenChange(false)}>
                ×
              </button>
            </div>
          </header>
          {loading ? null : !user ? (
            <div className="mt-chat-body stack">
              <p>Sign in to have Grok build dashboards of the races you care about.</p>
              <p>
                <Link href="/signin?next=/midterms" className="btn">Sign in</Link>
              </p>
            </div>
          ) : grok !== "connected" ? (
            <div className="mt-chat-body">
              <GrokConnect />
            </div>
          ) : (
            <>
              <div className="mt-chat-body" ref={scroller}>
                {messages.length === 0 && (
                  <p className="muted small">
                    {editing
                      ? `Ask for changes to “${editing.layout.title}”: “add the Arizona governor race”, “split this by region”, “drop anything Likely”. Or ask about the results.`
                      : "Describe a dashboard: “every toss-up in the Rust Belt”, “California House races and propositions”, “the 20 closest House races”."}
                  </p>
                )}
                <ul className="messages">
                  {messages.map((m, i) => (
                    <li key={i} className={`msg ${m.role === "user" ? "voter" : "interviewer"}`}>
                      {m.content}
                    </li>
                  ))}
                  {busy && (
                    <li className="msg interviewer typing" aria-label="Grok is thinking">
                      <span />
                      <span />
                      <span />
                    </li>
                  )}
                </ul>
                {error && <p className="error small">{error}</p>}
              </div>
              <form
                className="mt-chat-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (text.trim() && !busy) void send(text.trim());
                }}
              >
                <input className="input" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder={editing ? "Change this dashboard…" : "Describe a dashboard…"} aria-label="Message Grok" />
                <button className="btn" disabled={busy || !text.trim()}>
                  Send
                </button>
              </form>
            </>
          )}
        </section>
      )}
      <button type="button" className={`mt-chat-fab${open ? " open" : ""}`} aria-expanded={open} onClick={() => onOpenChange(!open)}>
        <span aria-hidden>✦</span> {open ? "Close" : "Ask Grok"}
      </button>
    </>
  );
}
