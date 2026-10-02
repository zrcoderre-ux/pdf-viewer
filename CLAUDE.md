# Project guidelines

## Workflow

- After completing a given task, squash merge the changes into `main` (and push
  `main`). Develop on the designated feature branch as usual, then collapse that
  branch's commits into a single commit on `main` via squash merge.
- A task is "complete" once work on the user's prompt is finished and the user
  has not sent a follow-up asking for something else. If the user sends more
  requests, wait until all of them are resolved before merging — don't merge
  between follow-ups. If work finishes and the user has not messaged, go ahead
  and merge.

## Project notes

- `PROJECT_SUMMARY.md` is the short orientation: the architecture, what to
  know before changing code, known-good test cases and the file list. The
  detail is in `Design Notes/` (how the code works and why, one file per
  area) and `User Guide/` (the README's feature pages). `PROJECT_SUMMARY.md`
  and `README.md` link each file with a one-line summary.
- Read the notes file for the area you are changing, not all of them. Search
  them by function or file name, e.g. `grep -rn "spreadTops" "Design Notes"`.
- New notes go into the topic file, or a new one, not into
  `PROJECT_SUMMARY.md` or `README.md`, which stay short. Refer to a notes file
  by its plain path: an `@` import in a CLAUDE.md is loaded into every session.
