# AGENTS.md

Everything is in [README.md](README.md). Start with [What to build first](README.md#what-to-build-first). Only build sections marked *now* or *next* unless the owner asks for more.

- **How to work:** make the sensible call, keep going, and say what you decided in the commit message. See [Working on this repo](README.md#working-on-this-repo).
- **Before you finish:** run `pnpm check` and `pnpm test`.
- **Commit and push:** straight to `main`, without asking. Run `git pull --rebase` first. No branches, no PRs, no CI or releases for now. Set the repo-local git identity from [Working on this repo](README.md#working-on-this-repo) first.
- **Don't:** change `gh auth`, set global git config, force-push `main`, or edit a migration that has shipped.
- **Unsure?** Follow [Making decisions](README.md#making-decisions). Decide it yourself and write it into the README. Only add an [open question](README.md#open-questions) for destructive, fundamental, costly or outward-facing choices.
