#!/usr/bin/env bash
# Headless, read-only agent review of the current branch (dual-harness: the reviewer did not write the code).
# Usage: npm run review:agent [-- <base-ref>]      Requires the Claude Code CLI (`claude`) and its auth.
set -euo pipefail
BASE="${1:-main}"
if ! command -v claude >/dev/null 2>&1; then
  echo "claude CLI not found; install Claude Code to run the agent review." >&2
  exit 2
fi
git diff --quiet "$BASE"...HEAD && { echo "No changes against $BASE."; exit 0; }

claude -p \
  --allowedTools "Read,Grep,Glob,Bash(git diff:*),Bash(git log:*),Bash(npm run verify)" \
  "You are the scene-contract-reviewer described in .claude/agents/scene-contract-reviewer.md.
Review \`git diff $BASE...HEAD\` for this OmniStage repository. Follow CLAUDE.md and .claude/rules/.
Run npm run verify. Report findings ranked by severity with file:line, a concrete failure scenario and a fix.
Do not edit any file."
