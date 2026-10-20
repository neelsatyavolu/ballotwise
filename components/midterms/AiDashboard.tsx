// Rendered inside MidtermsHome.
import Link from "next/link";
import { useState } from "react";
import { useAccount } from "@/components/AccountProvider";
import { GrokConnect } from "@/components/GrokConnect";
import type { RaceSummary } from "@/lib/midterms/view";
import type { Dashboard } from "./hooks";
import { RaceCard } from "./RaceCard";

const EXAMPLES = [
  "Every toss-up for Senate and Governor",
  "The 20 closest House races, grouped by region",
  "Everything on the ballot in Pennsylvania and Michigan",
  "Statewide ballot measures on abortion, taxes, or elections",
];

type Props = {
  races: RaceSummary[];
  dashboards: Dashboard[] | null;
  openId: string | null;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onAsk: (text: string, fresh: boolean) => void;
  error: string | null;
  favorites: number[] | null;
  onStar: (id: number) => void;
  onStarMany: (ids: number[]) => void;
};

/** The voter's Grok-built dashboards, one tab each. Grok makes and edits them through the chat dock. */
export function AiDashboards({ races, dashboards, openId, onOpen, onRename, onDelete, onAsk, error, favorites, onStar, onStarMany }: Props) {
  const { user, grok, loading } = useAccount();
  const [renaming, setRenaming] = useState<string | null>(null);

  if (loading) return null;
  if (!user) {
    return (
      <div className="panel stack">
        <h2>Have Grok build your dashboards</h2>
        <p>Describe what you want to follow on election night, and Grok picks and groups the races. Keep as many dashboards as you like and edit them by chatting.</p>
        <p>
          <Link href="/signin?next=/midterms" className="btn">Sign in</Link>
        </p>
      </div>
    );
  }
  if (grok !== "connected") return <GrokConnect />;
  if (!dashboards) return <p className="muted">Loading your dashboards…</p>;

  const open = dashboards.find((d) => d.id === openId) ?? dashboards[0];
  const byId = new Map(races.map((r) => [r.id, r]));

  return (
    <div className="mt-ai">
      <div className="mt-dash-tabs" role="tablist" aria-label="Your dashboards">
        {dashboards.map((d) => (
          <button key={d.id} role="tab" type="button" aria-selected={d.id === open?.id} onClick={() => onOpen(d.id)}>
            {d.layout.title}
          </button>
        ))}
        <button type="button" className="mt-dash-new" onClick={() => onAsk("", true)}>
          + New dashboard
        </button>
      </div>
      {error && <p className="error small">{error}</p>}

      {!open ? (
        <div className="panel stack">
          <h2>Build your first dashboard</h2>
          <p>Tell Grok what you want to follow. It reads every race and arranges them for you. Pick one to start, or use the Ask Grok button.</p>
          <div className="examples">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="chip" onClick={() => onAsk(ex, true)}>
                {ex}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <div className="mt-section-head">
            {renaming === open.id ? (
              <form
                className="mt-rename"
                onSubmit={(e) => {
                  e.preventDefault();
                  const title = String(new FormData(e.currentTarget).get("title") ?? "").trim();
                  if (title) onRename(open.id, title);
                  setRenaming(null);
                }}
              >
                <input name="title" className="input" defaultValue={open.layout.title} maxLength={80} autoFocus aria-label="Dashboard name" />
                <button className="btn">Save</button>
                <button type="button" className="btn quiet" onClick={() => setRenaming(null)}>Cancel</button>
              </form>
            ) : (
              <h2>{open.layout.title}</h2>
            )}
            <div className="mt-dash-tools">
              <button type="button" className="btn secondary" onClick={() => onAsk("", false)}>✦ Edit with Grok</button>
              <button type="button" className="btn quiet" onClick={() => setRenaming(open.id)}>Rename</button>
              <button
                type="button"
                className="btn quiet mt-danger"
                onClick={() => {
                  if (window.confirm(`Delete “${open.layout.title}”?`)) onDelete(open.id);
                }}
              >
                Delete
              </button>
            </div>
          </div>
          {open.layout.sections.length === 0 && <p className="muted">This dashboard is empty. Ask Grok to add races.</p>}
          {open.layout.sections.map((s, i) => {
            const list = s.raceIds.map((id) => byId.get(id)).filter((r): r is RaceSummary => !!r);
            return (
              <section key={`${i}-${s.title}`} className="mt-group">
                <div className="mt-section-head">
                  <div>
                    <h3>{s.title}</h3>
                    {s.note && <p className="muted small">{s.note}</p>}
                  </div>
                  {favorites && list.length > 1 && (
                    <button type="button" className="btn quiet" onClick={() => onStarMany(list.map((r) => r.id))}>
                      Star all {list.length}
                    </button>
                  )}
                </div>
                <ul className="mt-grid">
                  {list.map((r) => (
                    <RaceCard key={r.id} race={r} starred={favorites ? favorites.includes(r.id) : null} onStar={onStar} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
