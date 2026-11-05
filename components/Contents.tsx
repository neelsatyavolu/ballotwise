// "On this page": jump links for a long reading page, from its section headings.

/** A section heading's anchor, from its text. */
export const anchor = (heading: string) => heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function Contents({ sections }: { sections: readonly string[] }) {
  return (
    <nav className="contents" aria-label="On this page">
      <span className="contents-label">On this page</span>
      <ol>
        {sections.map((s) => (
          <li key={s}>
            <a href={`#${anchor(s)}`}>{s}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
