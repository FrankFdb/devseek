# Human Acceptance Cases

Use the latest fully completed `runs/<timestamp>/workspace` only after the
automated four-round journey reports `ok: true`. Record OS, display server,
VS Code version, candidate VSIX name/SHA-256, commands, exit codes, screenshots,
and the resulting JSON/PPM files.

## Cases

| ID | Test | Method | Expected result |
| --- | --- | --- | --- |
| H1 | Build and self-test | Run `./test.sh` | Exit 0; no warnings promoted by `-Werror`; self-test passes |
| H2 | Fraction interaction | Start the app, select Fractions, change total and selected using mouse and keyboard | Pie/fraction graphic and labels update immediately; controls remain readable |
| H3 | Number-line interaction | Select Number Line and move the marker to -10, 0, and 10 | Marker and value agree at every boundary; no overlap |
| H4 | Quiz workflow | Complete 3+4 and 8-3, including one wrong retry, backspace, submit, and next | Feedback is visible and non-color-only; score counts submitted/correct answers correctly |
| H5 | Deterministic artifacts | Run `--script assets/fraction-number-line.actions --snapshot /tmp/math.ppm --state /tmp/math.json` | Exit 0; PPM is nonblank and at least 640x480; JSON matches visible state |
| H6 | Invalid input | Run `--script assets/invalid.actions --snapshot /tmp/invalid.ppm --state /tmp/invalid.json` | Non-zero exit; readable diagnostic; no false success artifacts |
| H7 | Real X11 smoke | Under a real display run `--smoke-frames 3 --width 800 --height 600` | A real X11 window opens, renders three frames, handles events, and exits 0 |
| H8 | Responsive layout | Repeat live smoke/interaction at 640x480 and 1024x640 | Title, tabs, controls, diagrams, focus indicators, and feedback do not overlap or clip |

## Result Submission

Return a folder containing `environment.txt`, `commands.log`, `results.md`,
screenshots for H2/H3/H4/H8, and H5 JSON/PPM artifacts. In `results.md`, record
each ID as `PASS`, `FAIL`, or `BLOCKED`, with the first observable mismatch and
the exact reproduction command. That folder is sufficient for a later DevSeek
review without relying on verbal summaries.
