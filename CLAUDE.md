@AGENTS.md

## Claude Code specifics

- Skills live in `.agents/skills/` (shared with other agents); `.claude/skills` is a symlink to it. Use them:
  `run-lab-task`, `add-lab-task`, `verify-before-push`, `labwatch-dev`, `terraform-change`, `pr-review`,
  `defense-prep`.
- Project subagents in `.claude/agents/`: `lab-reviewer`, `test-runner`, `infra-auditor` (all read-only or
  check-only).
- Delegate long implementation work (multi-file changes, builds, browser checks) to subagents so the main thread
  stays free for the user's questions.
- Parallel work goes into separate `git worktree`s — never switch branches in a checkout someone else is using.
- Headless browser checks (Edge on Windows): hard `timeout`, a unique temporary profile, kill the process afterwards.
- Run Claude Code from WSL (`~/projects/syssoft-labs`): the skills symlink is not materialised on a Windows checkout
  unless `core.symlinks=true` and Developer Mode are enabled.
