#!/usr/bin/env bash
set -euo pipefail

marker=$1
pr=$2
body_file=$3
repo=${REPO:-${GITHUB_REPOSITORY:?GITHUB_REPOSITORY or REPO must be set}}

comment_id=$(gh api "repos/$repo/issues/$pr/comments" --paginate \
	--jq "[.[] | select(.user.login == \"github-actions[bot]\" and (.body | startswith(\"$marker\")))][0].id // empty")
if [ -n "$comment_id" ]; then
	gh api -X PATCH "repos/$repo/issues/comments/$comment_id" -F "body=@$body_file"
else
	gh api "repos/$repo/issues/$pr/comments" -F "body=@$body_file"
fi
