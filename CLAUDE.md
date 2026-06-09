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
