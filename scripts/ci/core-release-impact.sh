#!/usr/bin/env bash
# Release Please assigns commits to products by file path.
set -euo pipefail

base=${1:?expected a base revision}
head=${2:?expected a head revision}
core_paths=('packages/core/src' ':(exclude,glob)**/*.test.*' ':(exclude,glob)**/*.md' ':(exclude)packages/core/src/testing' ':(exclude,glob)**/fixtures/**')
fix_header='^fix(\(([^)]+)\))?!?:[[:space:]]'

check_fix() {
  local title=$1 range=$2 scope product paths core
  [[ $title =~ $fix_header ]] || return 0
  scope=${BASH_REMATCH[2]:-}
  core=$(git diff --no-renames --name-only "$range" -- "${core_paths[@]}")
  [[ -n $core ]] || return 0

  local -a products missing=()
  case "$scope" in
    studio) products=(apps/studio) ;;
    cli) products=(packages/cli) ;;
    *) products=(apps/studio packages/cli) ;;
  esac
  # Match the destination of a rename across packages, as GitHub does for a changed file.
  paths=$(git -c core.quotePath=false diff --name-only --find-renames "$range")
  for product in "${products[@]}"; do
    if ! grep -Eq "^\"?$product/" <<< "$paths"; then
      missing+=("$product/")
    fi
  done
  if (( ${#missing[@]} )); then
    echo "$range ($title): missing Release Please paths: ${missing[*]}. Include a regression test or release note under each affected product in the fix commit." >&2
    echo 'For a single affected product, use fix(studio) or fix(cli) as the commit and squash PR scope.' >&2
    return 1
  fi
}

commits=$(git log --full-history --format=%H "$base..$head" -- "${core_paths[@]}")
for commit in $commits; do
  title=$(git show -s --format=%s "$commit")
  check_fix "$title" "$commit^1..$commit"
done
# GitHub can squash a PR into a fix even if none of its individual commits is a fix.
check_fix "${PR_TITLE:-}" "$base...$head"
echo "Checked shared-core fixes in $base..$head for release impact."
