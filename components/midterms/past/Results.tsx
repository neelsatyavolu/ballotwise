// The past-elections map's results table: in the hover tooltip, and larger in the sidebar.
import { lastName, marginOf, type Row } from "@/lib/midterms/pastResults";
import { swingLabel, type Swing } from "@/lib/midterms/pastShift";
import { marginLabel } from "@/lib/midterms/view";

const fmt = new Intl.NumberFormat("en-US");
const pct = (n: number) => `${n.toFixed(2)}%`;

/** The map's colors: the Democrat and Republican by party, the third slot purple (or a minor party's own hue). */
export function rowColor(row: Row): string {
  if (row.slot === "d") return "var(--dem)";
  if (row.slot === "r") return "var(--rep)";
  if (!row.slot) return "var(--muted)";
  if (row.party === "LIB") return "var(--lib)";
  if (row.party === "GRE") return "var(--gre)";
  return "var(--oth)";
}

const label = (row: Row) => (row.party ? `${row.name} (${row.party})` : row.name);

/** "+4.39% Trump", in the leader's color. */
function Margin({ rows }: { rows: Row[] }) {
  const m = marginOf(rows);
  if (!m) return <div className="mt-past-margin tie">{rows.some((r) => r.votes > 0) ? "Tied" : "No votes"}</div>;
  return (
    <div className="mt-past-margin" style={{ background: rowColor(m.leader) }}>
      <b>+{pct(m.pct)}</b>
      <span>{lastName(m.leader.name)}</span>
    </div>
  );
}

/** The Swing view's tooltip: the place's margin in each race, and how far it moved, in that party's color. */
export function SwingTip({ title, subtitle, swing, year, base }: { title: string; subtitle?: string; swing: Swing | null; year: number; base: number }) {
  const color = !swing || swing.shift === 0 ? "var(--el-raised)" : swing.shift > 0 ? "var(--dem)" : "var(--rep)";
  return (
    <div className="mt-past-tip-body">
      <table>
        <thead>
          <tr>
            <th>
              {title}
              {subtitle ? <small>{subtitle}</small> : null}
            </th>
            <th className="num">Margin</th>
          </tr>
        </thead>
        <tbody>
          {swing ? (
            [[year, swing.now], [base, swing.then]].map(([y, m]) => (
              <tr key={y} style={{ "--row": m > 0 ? "var(--dem)" : m < 0 ? "var(--rep)" : "var(--muted)" } as React.CSSProperties}>
                <td>{y}</td>
                <td className="num">{marginLabel(m)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={2} className="muted">No {base} result to compare</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="mt-past-tip-margin">
        <span className="mt-past-th">Swing</span>
        <div className={swing ? "mt-past-margin" : "mt-past-margin tie"} style={swing ? { background: color } : undefined}>
          <b>{swing ? swingLabel(swing.shift) : "–"}</b>
          <span>since {base}</span>
        </div>
      </div>
    </div>
  );
}

/** The tooltip: the place's name over its candidates, with the margin beside them as on DDHQ's map. */
export function ResultsTip({ title, subtitle, rows }: { title: string; subtitle?: string; rows: Row[] }) {
  const total = rows.reduce((n, r) => n + r.votes, 0);
  return (
    <div className="mt-past-tip-body">
      <table>
        <thead>
          <tr>
            <th>
              {title}
              {subtitle ? <small>{subtitle}</small> : null}
            </th>
            <th className="num">Votes</th>
            <th className="num">Pct</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} style={{ "--row": rowColor(r) } as React.CSSProperties}>
              <td>{label(r)}</td>
              <td className="num">{fmt.format(r.votes)}</td>
              <td className="num">{total ? pct((r.votes / total) * 100) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-past-tip-margin">
        <span className="mt-past-th">Margin</span>
        <Margin rows={rows} />
      </div>
    </div>
  );
}

/** The sidebar's table, with the party in its own column. */
export function ResultsTable({ rows }: { rows: Row[] }) {
  const total = rows.reduce((n, r) => n + r.votes, 0);
  return (
    <table className="mt-past-table">
      <thead>
        <tr>
          <th>Candidate</th>
          <th>Party</th>
          <th className="num">Votes</th>
          <th className="num">Pct</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} style={{ "--row": rowColor(r) } as React.CSSProperties}>
            <td>{r.name}</td>
            <td>{r.party}</td>
            <td className="num">{fmt.format(r.votes)}</td>
            <td className="num">{total ? pct((r.votes / total) * 100) : "–"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
