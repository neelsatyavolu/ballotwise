"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { blank, decodeShare, fromSections, isGrid, template, TEMPLATES, type GridLayout, type TemplateId } from "@/lib/midterms/decisionView";
import type { Overview } from "@/lib/midterms/view";
import { useLive } from "../hooks";
import { ModeNav } from "../ModeNav";
import { DecisionView } from "./DecisionView";
import { useGridDashboards } from "./store";

const TEMPLATE_NOTE: Record<TemplateId, string> = {
  senate: "Senate balance of power, then the ten closest Senate races with results and maps.",
  house: "The closest House races: map, results, market chart, vote drops and vote history.",
  midterm: "House, Senate and governors side by side: chamber control, the map and forecast charts.",
};

/** /midterms/dashboards: the viewer's Decision View dashboards, the templates, and a blank board. */
export function DashboardsHome() {
  const store = useGridDashboards();
  return (
    <div className="wrap mt mt-dv-home">
      <ModeNav current="/midterms/dashboards" />
      <header className="mt-hero">
        <h1>Dashboards</h1>
        <span className="muted">Arrange races, maps, markets and forecast charts on a grid, then present or share it.</span>
      </header>
      {store.error && <p className="error">{store.error}</p>}
      {!store.signedIn && !store.loading && (
        <p className="muted small">
          Dashboards you make are kept in this browser. <Link href="/signin?next=/midterms/dashboards">Sign in</Link> to keep them on your account.
        </p>
      )}
      <section className="mt-dv-list">
        <h2>Your dashboards</h2>
        {store.loading ? (
          <p className="muted">Loading…</p>
        ) : store.list?.length ? (
          <ul>
            {store.list.map((d) => (
              <li key={d.id}>
                <Link href={`/midterms/dashboards/${d.id}`}>
                  <b>{d.layout.title}</b>
                  <span>{d.layout.panels.length} panels · {d.layout.size.replace("x", " × ")}</span>
                </Link>
                <button
                  type="button"
                  className="btn quiet small mt-danger"
                  onClick={() => {
                    if (window.confirm(`Delete “${d.layout.title}”?`)) void store.remove(d.id);
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None yet. Start from a template or a blank grid.</p>
        )}
        {store.signedIn && store.all.some((d) => !isGrid(d.layout)) && (
          <p className="muted small">Grok-built dashboards are on the overview&apos;s My dashboards tab, where each can open as a grid.</p>
        )}
      </section>
      <section className="mt-dv-list">
        <h2>Start from</h2>
        <ul className="mt-dv-templates">
          {(Object.keys(TEMPLATES) as TemplateId[]).map((t) => (
            <li key={t}>
              <Link href={`/midterms/dashboards/new?template=${t}`}>
                <b>{TEMPLATES[t]}</b>
                <span>{TEMPLATE_NOTE[t]}</span>
              </Link>
            </li>
          ))}
          <li>
            <Link href="/midterms/dashboards/new">
              <b>Blank grid</b>
              <span>An empty 24 × 16 grid to fill with “Add element”.</span>
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}

/** /midterms/dashboards/new: makes a dashboard (template, blank, or from a Grok dashboard), then opens it. */
export function NewDashboard() {
  const params = useSearchParams();
  const router = useRouter();
  const store = useGridDashboards();
  const { data } = useLive<Overview>("/api/midterms");
  const started = useRef(false);
  const [failed, setFailed] = useState(false);
  const kind = params.get("template") as TemplateId | null;
  const from = params.get("from");

  useEffect(() => {
    if (started.current || store.loading || (kind && !data)) return;
    let layout: GridLayout | null = null;
    if (kind && kind in TEMPLATES && data) layout = template(kind, data.races);
    else if (from) {
      const source = store.all.find((d) => d.id === from);
      if (source && !isGrid(source.layout)) layout = fromSections(source.layout);
    }
    started.current = true;
    void store.create(layout ?? blank()).then((id) => (id ? router.replace(`/midterms/dashboards/${id}`) : setFailed(true)));
  }, [store, data, kind, from, router]);

  return (
    <div className="wrap mt">
      <p className="muted">{failed ? store.error ?? "Couldn't make the dashboard." : "Setting up your dashboard…"}</p>
    </div>
  );
}

/** /midterms/dashboards/[id]: one of the viewer's dashboards, editable. */
export function DashboardPage({ id }: { id: string }) {
  const store = useGridDashboards();
  const params = useSearchParams();
  const found = store.list?.find((d) => d.id === id);
  if (store.loading) return <div className="wrap mt"><p className="muted">Loading the dashboard…</p></div>;
  if (!found) {
    return (
      <div className="wrap mt">
        <p>That dashboard isn&apos;t here. It may be on another account or browser.</p>
        <p><Link href="/midterms/dashboards">All dashboards</Link></p>
      </div>
    );
  }
  return <DecisionView key={found.id} layout={found.layout} onSave={(layout) => store.save(id, layout)} popout={params.get("popout") === "1"} />;
}

/** /midterms/dashboards/view?d=…: a shared dashboard, read-only, with a button to keep a copy. */
export function SharedDashboard() {
  const params = useSearchParams();
  const router = useRouter();
  const store = useGridDashboards();
  const layout = decodeShare(params.get("d") ?? "");
  if (!layout) {
    return (
      <div className="wrap mt">
        <p>This dashboard link is incomplete or damaged.</p>
        <p><Link href="/midterms/dashboards">All dashboards</Link></p>
      </div>
    );
  }
  const copy = () => void store.create({ ...layout, title: `${layout.title} (copy)`.slice(0, 80) }).then((id) => id && router.push(`/midterms/dashboards/${id}`));
  return <DecisionView layout={layout} onCopy={copy} popout={params.get("popout") === "1"} />;
}
