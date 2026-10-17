# Ballotwise design

A nonpartisan voter guide. The look borrows from a paper ballot and civic print: cool white stock, navy ink, fill-in ovals, and a red-white-blue flag stripe.

## Rules
- **Flag colors, never party colors.** Old Glory blue carries the header and actions; flag red marks only the voter's own answers, the countdown, and the stripe. Red and blue never map to a candidate or party.
- **Party is text, never color.** Candidates get no colored chips, no photos, and the same template. Candidate stances are drawn in neutral ink.
- **Candidate order is shuffled** on every load and says so.
- **The oval is the signature.** Answers, stances and the match scale are drawn as five ballot ovals. Filling one is the only decorative motion.
- Every claim shows its sources inline as small numbered links. Unsourced positions say so.

## Tokens
| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#F6F7F9` | `#0D1526` | page |
| `--sheet` | `#FFFFFF` | `#142039` | raised surfaces |
| `--ink` | `#18213A` | `#EDF0F5` | text, candidate ovals |
| `--muted` | `#586379` | `#9BA7BC` | secondary text |
| `--rule` | `#D5DBE5` | `#26334D` | borders |
| `--accent` | `#0A3161` | `#8FB0E8` | actions, links (Old Glory blue) |
| `--red` | `#B31942` | `#F0647F` | the voter's marks, countdown, stripe (Old Glory red) |
| `--navy` | `#0A3161` | `#0A2552` | header |
| `--mark` | `#E4ECF8` | `#22355A` | source highlight |

## Type
- **Source Serif 4** for page titles, race titles, and candidate names.
- **Public Sans** (the US Web Design System face) for everything else.
- Scale: 14 / 16 / 18 / 22 / 30 / 44. Body 16/1.55, serif headings at 1.15. Numbers are tabular.
- Sentence case everywhere. No all-caps labels.

## Shape
Corners are 6px on inputs, buttons and panels and fully round on ovals. Use 1px rules, not shadows. Content is left-aligned, the reading column is 680px, and the comparison grid is up to 1120px.
