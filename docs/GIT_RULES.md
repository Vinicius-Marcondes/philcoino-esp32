# Git rules

Read this file before using Git in this repository.

## Protect shared work

- Never push directly to `origin master`.
- Work on a focused branch and submit changes through a pull request.
- Stage and commit only files you intentionally changed. The workspace may contain unrelated user work.
- Review the exact staged diff before committing.
- Do not discard, reset, overwrite, or reformat unrelated changes.
- Keep generated files, dependencies, caches, native build output, secrets, and local machine state out of commits.

## Pull requests

- If using an automated agent, it must create pull requests with the GitHub Connector or the `gh` CLI.
- Give the pull request one clear goal and describe the affected files/areas and the motivation.
- Include verification results and call out checks that could not be run.
- Keep product behavior changes separate from unrelated cleanup or documentation rewrites.

## Commit scope

A commit should explain:

1. what changed;
2. which part of the project is affected; and
3. why the change is needed.

Avoid committing dependency installation output unless the dependency change is explicitly part of the task and has been approved.
