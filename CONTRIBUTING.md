# Contributing

Thanks for your interest in improving `srch`. This guide covers the development
workflow used in this repository.

## Workflow

1. **Create a branch.** Each change lives on its own branch, created from `main`.
   This repo uses [git worktrees](https://git-scm.com/docs/git-worktree) so
   multiple branches can be checked out side by side:

   ```bash
   wt switch --create <branch> --base main
   ```

   A plain `git switch -c <branch> main` works too.

2. **Make your changes.** Keep them focused and match the surrounding code style.

3. **Validate locally.** Both commands must pass before you open a PR:

   ```bash
   npm run check   # tsc --noEmit type check
   npm test        # node --test test suite
   ```

4. **Commit.** Use [Conventional Commits](https://www.conventionalcommits.org/)
   (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, ...). Keep each
   commit logically scoped.

5. **Open a pull request** against `main` describing what changed and why.

## Notes

- `srch` is the SDK; `search` is the CLI binary. The CLI is a thin frontend over
  the SDK, so most changes belong in `src/`.
- TypeScript must stay strict: no `any`, no `@ts-ignore`, and no skipped tests.
