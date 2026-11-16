#!/usr/bin/env bash
# =============================================================================
# push-branches.sh — publish the OPD groundwork to NEW BRANCHES only
# =============================================================================
# Owner decision 2026-11-16: we are NOT committing or pushing anything to `main`.
# Remote main stays frozen at the baseline; the branches are merged later by PR.
#
#   myClinic  b1e174e (remote main, FROZEN)  ->  multi_clinic             3f18863   23 commits
#   Central   da36c7b (remote main, FROZEN)  ->  central_tenent_mangement  <bundle tip>  17 commits (15 code + 2 opd/)
#
# `v2/account-trust-validation` (28b71ef, 15 commits of PARALLEL work by another
# agent) is NEVER touched. It forked from the same b1e174e and shares none of our
# commits; pushing our tip to that ref would need --force and would delete it.
#
# Method: BUNDLE. Both bundles were cut with `--all`, so a clone carries every
# ref. We push an EXPLICIT refs/heads/<branch>:refs/heads/<branch> refspec:
#   - never --force, never --force-with-lease
#   - never a refspec whose destination is refs/heads/main
#   - refuse if the remote branch already exists at a different sha
#   - refuse if remote `main` is not at the expected baseline
#   - refuse if the bundle's own `main` is not the pinned local main
# The branch tip sha is DERIVED FROM THE BUNDLE at run time, so refreshing the
# opd/ snapshot (which moves that tip) never makes this script stale.
#
#   ./push-branches.sh                     # push both branches
#   DRY_RUN=1 ./push-branches.sh           # verify everything, push nothing
#   ONLY=myclinic ./push-branches.sh       # one repo
#   COMMANDS=1 ./push-branches.sh          # print the raw git commands, exit
#
# Env overrides: MYCLINIC_BUNDLE CENTRAL_BUNDLE MYCLINIC_ORIGIN CENTRAL_ORIGIN
#                MYCLINIC_BRANCH CENTRAL_BRANCH EXPECT_MYCLINIC_MAIN
#                EXPECT_CENTRAL_MAIN EXPECT_MYCLINIC_REMOTE_MAIN
#                EXPECT_CENTRAL_REMOTE_MAIN ONLY DRY_RUN COMMANDS WORKDIR
#
# NOTE ON CI: a push to a non-main branch fires `ci.yml` (both repos use
# `push: branches-ignore: [main]`) but NOT `pages.yml` (`push: [main]`) and NOT
# myClinic's `e2e.yml` (`push: [main]`). After pushing, OPEN A PULL REQUEST on
# each repo to get the T6 e2e job + a second CI run, and use `workflow_dispatch`
# on pages.yml (select the branch) only if you want a Pages build before the
# eventual main merge. Set the PAGES_CNAME repo variable first, or the deploy
# warns and lands on the default *.github.io domain.
# =============================================================================
set -euo pipefail

MYCLINIC_BUNDLE="${MYCLINIC_BUNDLE:-/home/user/myclinic-multi-clinic.bundle}"
CENTRAL_BUNDLE="${CENTRAL_BUNDLE:-/home/user/central-tenent-mangement.bundle}"
MYCLINIC_ORIGIN="${MYCLINIC_ORIGIN:-https://github.com/rajeshlande/myClinic.git}"
CENTRAL_ORIGIN="${CENTRAL_ORIGIN:-https://github.com/rajeshlande/myClinicLicenseAuthority.git}"
MYCLINIC_BRANCH="${MYCLINIC_BRANCH:-multi_clinic}"
CENTRAL_BRANCH="${CENTRAL_BRANCH:-central_tenent_mangement}"
# Pinned LOCAL main tips (the tips the bundles' `main` ref must carry).
EXPECT_MYCLINIC_MAIN="${EXPECT_MYCLINIC_MAIN:-3f1886319ff5feb9ba9b57e94d91aad6fa17ef1e}"
EXPECT_CENTRAL_MAIN="${EXPECT_CENTRAL_MAIN:-c3d34564d19f0237bc57e869babc8acb6a4d823f}"
# Pinned REMOTE main baselines. We never push to these; we only assert them.
EXPECT_MYCLINIC_REMOTE_MAIN="${EXPECT_MYCLINIC_REMOTE_MAIN:-b1e174ee00abc6b533e364fa578b5b017802c2d2}"
EXPECT_CENTRAL_REMOTE_MAIN="${EXPECT_CENTRAL_REMOTE_MAIN:-da36c7be4938acee46a6ff63ec81ac5ee63d0af2}"
ONLY="${ONLY:-both}"
DRY_RUN="${DRY_RUN:-0}"
COMMANDS="${COMMANDS:-0}"
WORKDIR="${WORKDIR:-/tmp/push-branches}"

die() { echo "  ERROR: $*" >&2; exit 1; }

if [ "$COMMANDS" = "1" ]; then
  cat <<EOF
Raw commands (bare repo + explicit refspec fetch; no --force, no main).
Do NOT use a plain git clone here: when several refs share one tip SHA a
clone can invent a master branch and lose refs/heads/<branch>.

  git init -q --bare myclinic-branches.git
  git -C myclinic-branches.git bundle verify "$MYCLINIC_BUNDLE"
  git -C myclinic-branches.git fetch -q "$MYCLINIC_BUNDLE" 'refs/heads/*:refs/heads/*'
  git -C myclinic-branches.git push "$MYCLINIC_ORIGIN" "refs/heads/$MYCLINIC_BRANCH:refs/heads/$MYCLINIC_BRANCH"

  git init -q --bare central-branches.git
  git -C central-branches.git bundle verify "$CENTRAL_BUNDLE"
  git -C central-branches.git fetch -q "$CENTRAL_BUNDLE" 'refs/heads/*:refs/heads/*'
  git -C central-branches.git push "$CENTRAL_ORIGIN" "refs/heads/$CENTRAL_BRANCH:refs/heads/$CENTRAL_BRANCH"

Check first:  git ls-remote --heads <origin>
EOF
  exit 0
fi

case "$ONLY" in
  both|myclinic|central) ;;
  *) die "ONLY must be both|myclinic|central (got '$ONLY')" ;;
esac
[ "$MYCLINIC_BRANCH" = "main" ] && die "refusing to push to main"
[ "$CENTRAL_BRANCH" = "main" ] && die "refusing to push to main"
[ "$MYCLINIC_BRANCH" = "v2/account-trust-validation" ] && die "refusing to touch the parallel v2 branch"
[ "$CENTRAL_BRANCH" = "v2/account-trust-validation" ] && die "refusing to touch the parallel v2 branch"

abspath() { python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$1"; }

push_one() {
  local name="$1" bundle="$2" origin="$3" branch="$4" expect_main="$5" expect_remote_main="$6"
  bundle="$(abspath "$bundle")"
  [ -f "$bundle" ] || die "$name: bundle not found: $bundle"

  echo ""
  echo "=============================================================="
  echo "  $name  →  $origin  refs/heads/$branch"
  echo "=============================================================="

  # A BARE repo + an explicit refspec fetch, NOT `git clone`: when several
  # refs share one SHA (myClinic's main/central_tenent_mangement/multi_clinic
  # are all 3f18863), `git clone <bundle>` cannot resolve HEAD and silently
  # invents a `master` branch with no refs/heads/main at all. Fetching
  # refs/heads/*:refs/heads/* preserves every branch name exactly.
  local repo="$WORKDIR/$name"
  rm -rf "$repo"
  git init -q --bare "$repo" || die "$name: git init failed"
  git -C "$repo" bundle verify "$bundle" >/dev/null || die "$name: bundle verify failed"
  git -C "$repo" fetch -q "$bundle" 'refs/heads/*:refs/heads/*' \
    || die "$name: fetch from bundle failed"

  local main_sha tip
  main_sha="$(git -C "$repo" rev-parse 'refs/heads/main^{commit}')" \
    || die "$name: bundle has no main ref"
  [ "$main_sha" = "$expect_main" ] \
    || die "$name: bundle main is ${main_sha:0:7}, expected ${expect_main:0:7} — re-cut the bundle"
  tip="$(git -C "$repo" rev-parse "refs/heads/$branch^{commit}")" \
    || die "$name: bundle has no refs/heads/$branch — was it cut with --all?"
  echo "  bundle verified · all refs/heads/* imported"
  echo "  main=${main_sha:0:7}  $branch=${tip:0:7}"

  local remote_main remote_branch
  remote_main="$(git ls-remote "$origin" 'refs/heads/main' | awk '{print $1}')" \
    || die "$name: cannot read remote main"
  [ "$remote_main" = "$expect_remote_main" ] \
    || die "$name: remote main is ${remote_main:0:7}, expected ${expect_remote_main:0:7} — STOP, do not guess"
  echo "  remote main FROZEN at ${remote_main:0:7} (we never push to it)"

  remote_branch="$(git ls-remote "$origin" "refs/heads/$branch" | awk '{print $1}')"
  if [ -n "$remote_branch" ] && [ "$remote_branch" != "$tip" ]; then
    die "$name: refs/heads/$branch already exists at ${remote_branch:0:7}, not ${tip:0:7}. No --force. Open a PR or pick a new branch name."
  fi
  if [ "$remote_branch" = "$tip" ]; then
    echo "  $branch is already up to date at ${tip:0:7} — nothing to do"
    return 0
  fi

  local count
  count="$(git -C "$repo" rev-list --count "$expect_remote_main..$tip")"
  echo "  creating $branch: ${expect_remote_main:0:7} → ${tip:0:7}  ($count commits)"
  echo "  refspec: refs/heads/$branch:refs/heads/$branch   (no --force, no main)"

  if [ "$DRY_RUN" = "1" ]; then
    echo "  DRY_RUN=1 — verified and stopped. Nothing pushed."
    return 0
  fi

  git -C "$repo" push "$origin" "refs/heads/$branch:refs/heads/$branch"
  echo "  pushed. Now open a PR on $name (base: main) to get CI + the T6 e2e job."
}

mkdir -p "$WORKDIR"
if [ "$ONLY" != "central" ]; then
  push_one myclinic "$MYCLINIC_BUNDLE" "$MYCLINIC_ORIGIN" "$MYCLINIC_BRANCH" \
    "$EXPECT_MYCLINIC_MAIN" "$EXPECT_MYCLINIC_REMOTE_MAIN"
fi
if [ "$ONLY" != "myclinic" ]; then
  push_one central "$CENTRAL_BUNDLE" "$CENTRAL_ORIGIN" "$CENTRAL_BRANCH" \
    "$EXPECT_CENTRAL_MAIN" "$EXPECT_CENTRAL_REMOTE_MAIN"
fi

echo ""
echo "=============================================================="
if [ "$DRY_RUN" = "1" ]; then
  echo "  DRY RUN COMPLETE — both rails verified, nothing pushed."
else
  echo "  DONE. Remote main on both repos is still at the baseline."
  echo "  Next: open a PR per repo (ci.yml + myClinic e2e.yml fire on PR),"
  echo "        then merge to main later, or dispatch pages.yml manually."
fi
echo "=============================================================="
