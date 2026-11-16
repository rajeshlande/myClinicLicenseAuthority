#!/usr/bin/env bash
# =============================================================================
# push-groundwork.sh — publish the OPD multi-tenant groundwork (P1 → P8e + T1 + T5 + T6 + CI runtime fixes)
# =============================================================================
# Supersedes push-v3.0.0.sh, which is stale for this state: it asserts
# EXPECT_MAIN=da36c7b (Central is now c3d3456), tells you to run Central schema v4
# (it is v8), and has no path for the myClinic repo at all.
#
# Two repos, FAST-FORWARD ONLY, never --force:
#   myClinic  b1e174e (v1.43.0, on origin) -> 3f18863   23 commits
#   Central   da36c7b (v3.1.0)             -> c3d3456   15 commits
# No new tags exist at either HEAD, so only main is pushed.
#
#   ./push-groundwork.sh                       # push both, cloning fresh from the bundles
#   DRY_RUN=1 ./push-groundwork.sh             # verify + show the range, push nothing
#   ONLY=myclinic ./push-groundwork.sh         # one repo
#   MYCLINIC_REPO=/path/to/myClinic ./push-groundwork.sh    # use your existing clone
#
# Env overrides: MYCLINIC_BUNDLE CENTRAL_BUNDLE MYCLINIC_ORIGIN CENTRAL_ORIGIN
#                MYCLINIC_REPO CENTRAL_REPO EXPECT_MYCLINIC EXPECT_CENTRAL
#                ONLY DRY_RUN WORKDIR
# =============================================================================
set -euo pipefail

MYCLINIC_BUNDLE="${MYCLINIC_BUNDLE:-/home/user/myclinic-groundwork.bundle}"
CENTRAL_BUNDLE="${CENTRAL_BUNDLE:-/home/user/myclinic-license-authority-groundwork.bundle}"
MYCLINIC_ORIGIN="${MYCLINIC_ORIGIN:-https://github.com/rajeshlande/myClinic.git}"
CENTRAL_ORIGIN="${CENTRAL_ORIGIN:-https://github.com/rajeshlande/myClinicLicenseAuthority.git}"
MYCLINIC_REPO="${MYCLINIC_REPO:-}"
CENTRAL_REPO="${CENTRAL_REPO:-}"
EXPECT_MYCLINIC="${EXPECT_MYCLINIC:-3f1886319ff5feb9ba9b57e94d91aad6fa17ef1e}"
EXPECT_CENTRAL="${EXPECT_CENTRAL:-c3d34564d19f0237bc57e869babc8acb6a4d823f}"
ONLY="${ONLY:-both}"
DRY_RUN="${DRY_RUN:-0}"
WORKDIR="${WORKDIR:-/tmp/push-groundwork}"

push_one() {
  local name="$1" bundle="$2" origin="$3" expect="$4" repo="$5"
  echo ""
  echo "=============================================================="
  echo ">> $name"

  [ -f "$bundle" ] || { echo "!! bundle not found: $bundle"; return 1; }
  # `git bundle verify` needs to run INSIDE a repository, and this script starts in
  # whatever directory the operator is in — so check readability here and do the full
  # verify after the cd below. (push-v3.0.0.sh verifies up front and therefore fails
  # with "need a repository to verify a bundle" unless run from inside a clone.)
  git bundle list-heads "$bundle" >/dev/null 2>&1 || { echo "!! bundle unreadable: $bundle"; return 1; }
  echo "   bundle readable: $bundle"

  if [ -n "$repo" ]; then
    echo "   using your existing clone: $repo"
    cd "$repo"
    git remote add gw-bundle "$bundle" 2>/dev/null || git remote set-url gw-bundle "$bundle"
    git fetch -q gw-bundle main
    git checkout -q main
    git merge --ff-only gw-bundle/main >/dev/null   # ff-only: refuses a divergent bundle
    git remote remove gw-bundle
  else
    local work="$WORKDIR/$name"
    echo "   cloning the bundle into $work"
    rm -rf "$work"; mkdir -p "$WORKDIR"
    git clone -q "$bundle" "$work"
    cd "$work"
    git checkout -q main
  fi

  git bundle verify "$bundle" >/dev/null 2>&1 || { echo "!! bundle verify failed: $bundle"; return 1; }
  echo "   bundle verified (records a complete history)"

  # A bundle clone points origin at the bundle FILE; retarget it at the real remote.
  git remote set-url origin "$origin" 2>/dev/null || git remote add origin "$origin"

  local have; have=$(git rev-parse main)
  echo "   main = $have"
  if [ "$have" != "$expect" ]; then
    echo "!! main is $have but this script expects $expect."
    echo "!! Refusing to push: the bundle is stale, or the groundwork moved on and"
    echo "!! EXPECT_${name^^} needs updating. Nothing was pushed."
    return 1
  fi

  echo "   fetching $origin to confirm a fast-forward ..."
  git fetch -q origin || { echo "!! fetch failed — credentials or network?"; return 1; }

  if git rev-parse --verify -q origin/main >/dev/null; then
    if ! git merge-base --is-ancestor origin/main main; then
      echo "!! origin/main ($(git rev-parse --short origin/main)) is NOT an ancestor of main."
      echo "!! That is not a fast-forward and this script never forces. Inspect:"
      echo "!!   git log --oneline origin/main..main   (ours)  /  main..origin/main   (theirs)"
      return 1
    fi
    local n; n=$(git rev-list --count origin/main..main)
    echo "   fast-forward $(git rev-parse --short origin/main) -> $(git rev-parse --short main) ($n commits):"
    git log --oneline origin/main..main | sed 's/^/     /'
  else
    echo "   origin has no main yet — this creates the branch."
  fi

  local tags; tags=$(git tag --points-at main | tr '\n' ' ')
  if [ -n "$tags" ]; then
    echo "   note: tag(s) sit at main: $tags — pushed separately only if you intend to."
  else
    echo "   no tag at main; only main is pushed."
  fi

  if [ "$DRY_RUN" = "1" ]; then
    echo "   DRY_RUN=1 — verified and stopped. Nothing pushed."
    return 0
  fi

  git push origin main     # plain push: git itself refuses a non-fast-forward
  echo "   pushed. remote main is now: $(git ls-remote --heads origin main | cut -f1)"
}

echo "push-groundwork — OPD multi-tenant groundwork (P1 → P8e + T1 + T5), ff-only, never --force"
[ "$DRY_RUN" = "1" ] && echo "DRY_RUN=1: will verify and report, not push."

case "$ONLY" in
  myclinic) push_one myclinic "$MYCLINIC_BUNDLE" "$MYCLINIC_ORIGIN" "$EXPECT_MYCLINIC" "$MYCLINIC_REPO" ;;
  central)  push_one central  "$CENTRAL_BUNDLE"  "$CENTRAL_ORIGIN"  "$EXPECT_CENTRAL"  "$CENTRAL_REPO" ;;
  both)     push_one myclinic "$MYCLINIC_BUNDLE" "$MYCLINIC_ORIGIN" "$EXPECT_MYCLINIC" "$MYCLINIC_REPO"
            push_one central  "$CENTRAL_BUNDLE"  "$CENTRAL_ORIGIN"  "$EXPECT_CENTRAL"  "$CENTRAL_REPO" ;;
  *) echo "!! ONLY must be myclinic, central or both"; exit 2 ;;
esac

[ "$DRY_RUN" = "1" ] && { echo ""; echo ">> dry run complete."; exit 0; }

cat <<'AFTER'

==============================================================
>> Both repos pushed. Now, in order:

 1. GitHub Pages redeploys from main in BOTH repos. Watch the two "Deploy to
    GitHub Pages" runs — they now include the §13.3 guards (check:tenant-accessor,
    check:tenant-secrets, check:admin-static) and the CNAME write/assert steps.
    Also watch "Browser acceptance harnesses (T6)" in myClinic: a separate job
    (not part of verify) that builds both variants and runs the eight asserting
    suites. It runs on main too, which ci.yml deliberately skips. Green runs
    close the §12.3 box "both CI pipelines green".

 2. Central database: run supabase/schema.sql in the live Central SQL editor.
    It is schema v8 now (not v4), idempotent and additive — it adds
    public_workspace_by_slug(p_slug), the keep-warm surface, the workspaces
    directory columns and (v8) public.workspace_audit_log, the append-only
    operator trail the #/directory console writes. Then re-run
    supabase/schema-tests.sql: expect 73 PASS (the original 56, plus the 11 §12
    operator-runbook checks added for §14, plus the 6 §13 audit-log checks). A
    different number means the live database is not where this bundle expects it.

 3. Custom domains — OPD-DEPLOYMENT-RUNBOOK.md §3, per repo:
      set the PAGES_CNAME variable (or commit public/CNAME), add the DNS record,
      verify the domain in Pages settings, enforce HTTPS.

 4. Supabase Auth + CORS — OPD-DEPLOYMENT-RUNBOOK.md §4:
      the Master project's redirect allowlist must list BOTH app domains (with the
      hash fragments), and every tenant project must allow the clinic origin for
      REST/Auth/Realtime. PKCE stays on.

 5. Do NOT set VITE_WORKSPACE_DIRECTORY yet. Production must stay single-project
    until the pilot — that flag is the whole rollback story
    (OPD-PILOT-MIGRATION-RUNBOOK.md §0/§6: level 1 = redeploy flag-off in <15 min).

 6. Pilot, in order: D1 Master-token check on a scratch tenant -> provision ONE
    clinic with `npm run provision:tenant` -> verify tenant_status()/my_workspaces()
    -> flip the flag for that deploy -> the acceptance list -> rehearse the rollback.

 7. Only after the pilot passes: the terminal cutover (delete supabase.js, strip
    VITE_SUPABASE_*, baselines -> 0). Not before — D5 is pilot-first.
AFTER
