import { StanceOvals } from "./guide/bits";

/** A worked example of one comparison row, so the page shows what a guide looks like before sign-up. */
export function Specimen() {
  return (
    <figure className="specimen" aria-label="Example of one issue compared across candidates">
      <figcaption className="specimen-cap">Example from a city council race</figcaption>
      <h3>Housing near transit</h3>
      <div className="specimen-sides">
        <span>Keep current height limits</span>
        <span>Allow mid-rise near stations</span>
      </div>
      <div className="specimen-row">
        <span className="who">Candidate A</span>
        <StanceOvals stance={1} label="Leans toward allowing mid-rise" />
      </div>
      <div className="specimen-row">
        <span className="who">Candidate B</span>
        <StanceOvals stance={-2} label="Strongly keep current limits" />
      </div>
      <div className="specimen-row">
        <span className="who you">Your answer</span>
        <StanceOvals voter stance={2} label="Strongly allow mid-rise" />
      </div>
    </figure>
  );
}
