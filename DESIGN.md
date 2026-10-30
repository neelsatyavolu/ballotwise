# Ballotwise design

A nonpartisan voter guide and midterms tracker. Every screen uses the tracker's dark results terminal (after Decision Desk HQ): near-black stock, white ink, hairline tiles, one yellow accent, set in Inter. The ballot ovals and the red-white-blue flag stripe carry over from the paper ballot.

## Rules
- **No party colors in the voter guide.** Yellow carries actions and links; red marks only the voter's own answers, the countdown, and the stripe. Red and blue never map to a candidate or party. The midterms tracker is the one exception: it reports counted votes, so results use party hues (see `app/midterms/midterms.css`).
- **Party is text, never color.** Candidates get no colored chips, no photos, and the same template. Candidate stances are drawn in neutral ink.
- **Candidate order is shuffled** on every load and says so.
- **The oval is the signature.** Answers, stances and the match scale are drawn as five ballot ovals. Filling one is the only decorative motion.
- Every claim shows its sources inline as small numbered links. Unsourced positions say so.

## Tokens
Always dark; there is no light theme.

| Token | Value | Use |
|---|---|---|
| `--paper` | `#121212` | page |
| `--sheet` | `#171717` | tiles, fields |
| `--el-raised` | `#262626` | selected tab or toggle, interviewer messages |
| `--el-hover` | `#1F1F1F` | row and button hover |
| `--ink` | `#FAFAFA` | text, candidate ovals |
| `--muted` | `#A1A1A1` | secondary text, labels |
| `--rule` | `#2A2A2A` | hairlines, borders |
| `--el-line` | `#434343` | hovered borders |
| `--accent` | `#FFCC00` | actions, links |
| `--red` | `#FF6568` | the voter's marks, countdown |
| `--navy` | `#121212` | header |

## Type
- **Inter** for everything; **Public Sans** for the site header only, so it is the same width on every page.
- Scale: 10.5 (labels) / 12 / 14 / 16 / 20 / 30+. Body 16/1.55, headings bold with tight tracking. Numbers are tabular.
- Sentence case for text. Table headers and small block labels are uppercase, bold, grey, 10.5–12px with 0.05em tracking.

## Shape
Corners are 8px on tiles, panels, buttons and fields, 6px on chips and inside segmented controls, and fully round on ovals. Use 1px rules, not shadows; tabs are segmented controls with the selected item raised. Content is left-aligned, the reading column is 680px, and the comparison grid is up to 1120px.
