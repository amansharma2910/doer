---
type: fix_plan
issue: pnpm-store-committed-to-history
severity: medium
status: applied
related_feature: daily-task-planner
linear_issue: null
created: 2026-10-21
updated: 2026-10-21
---

# Fix plan: the pnpm package store is committed to git history

Severity is medium because there is no runtime, product, or security impact (the
store holds only public npm tarballs and no credentials), but it inflates every
clone of the repository and regenerates on the documented dev path, so it recurs
until the creation site is fixed.

## 1. Issue

`frontend/.pnpm-store/` is tracked in git. It holds 7,863 files and 122 MB on
disk, which is 7,863 of the 7,976 files tracked in the entire repository, or
98.6% of them. Measured against the object graph, the store accounts for 8,449 of
8,933 objects and 27.63 MB of the 29.3 MB packfile, which is 98.1% of all
repository bytes. Everything that is not the store comes to 484 objects and
0.53 MB.

It entered in two commits, both on 2026-10-21:

- `a816af6` "M5: dashboard, chat, heatmap, and settings" added 7,382 store files
- `cd13e16` "Close the remaining coverage and contract gaps" added 481 more

Both are pure additions to the store path, with no modifications or deletions.

Three refs keep the store reachable. `refs/heads/main` carries it at HEAD. The
local-only tag `pre-trailer-strip` (at `bea564a`) pins an orphaned pre-rewrite
lineage that also contains all 7,863 files. `refs/original/refs/heads/main` is a
leftover from the earlier `filter-branch` run during the commit trailer strip and
pins the same orphan lineage.

## 2. Business Impact

There is no user-facing or product impact. Nothing in the application reads the
store, and the dependency chain from the defect has no runtime leg at all.

The harm is to development throughput and to the repository as an asset:

- Every clone and fetch transfers 27.63 MB of vendored npm tarball content for a
  codebase whose real content is 0.53 MB.
- `git status`, `git grep`, editor indexers, and AI tooling traverse 122 MB of
  noise on every operation, which is a direct tax on iteration speed.
- The Docker build context carries 122 MB that the build discards.
- It recurs. `docker compose up` is the documented dev command in `README.md:29`,
  and it regenerates the directory, so any fresh clone reproduces the condition.

## 3. Root Cause

Two independent failures. The first put the bytes on disk, the second let them
into a commit. Conflating them is why a `.gitignore` entry alone would not close
this.

### Creation: pnpm's cross-device store fallback, inside the compose container

The `web` service in `docker-compose.yml` bind-mounts the project into the
container and installs there:

```yaml
  web:
    image: node:23-slim
    working_dir: /web
    command: sh -c "npm install -g pnpm@10.33.2 && pnpm install && pnpm dev --host 0.0.0.0"
    volumes:
      - ./frontend:/web
      - doer-web-modules:/web/node_modules
```

pnpm resolves its store by writing a probe file into the project root and testing
whether it can hardlink that probe into its home directory. In the container the
project root is a virtiofs bind mount and the pnpm home is on overlayfs, so the
hardlink test fails and the home-directory branch is skipped. `rootLinkTarget`
then returns the shallowest hardlink-capable directory, which is `/web` itself.
The guard that should redirect back to the home store at that point is
ineffective: `dirsAreEqual` tests `path.relative(dir1, dir2) === "."`, but
`path.relative('/web', '/web')` returns the empty string, so the comparison is
false even when the two paths are identical. Execution falls through to
`path.join(pkgRoot, '.pnpm-store', STORE_VERSION)`, which is `/web/.pnpm-store/v10`
in the container and `frontend/.pnpm-store/v10` on the host. Read from the
installed pnpm 10.33.2 bundle, not from recall.

Four lines of evidence confirm container origin over host origin:

1. Platform fingerprint, which is decisive. The committed store contains only
   linux-arm64 native packages (`@esbuild/linux-arm64@0.21.5`,
   `@rollup/rollup-linux-arm64-gnu@4.64.12`,
   `@tailwindcss/oxide-linux-arm64-gnu@4.3.3`,
   `lightningcss-linux-arm64-gnu@1.32.0`) and zero darwin packages. The host
   store at `~/Library/pnpm/store/v10` holds the darwin-arm64 counterparts of
   those same versions and no Linux ones. A macOS host pnpm could not have
   written this store. On Apple Silicon, `node:23-slim` runs linux/arm64.
2. The host install is excluded. `frontend/node_modules/.modules.yaml` records
   `storeDir = '/Users/amansharma2910/Library/pnpm/store/v10'`, the global store.
3. Timeline. Store `checkedAt` timestamps span 00:54:01 to 01:30:17. `a816af6`
   committed at 00:56:25, `cd13e16` at 01:31:31. `cd13e16` also added vitest to
   `frontend/package.json`, matching the second install that fetched vitest,
   chai, and tinybench, all of which are present in the store. The bind mount was
   introduced in `1843e55` at 00:34:43, about 20 minutes before the first write.
4. The alternative was ruled out, not assumed. No `.npmrc` blob has ever existed
   at any path on any ref, and `git log --all -S'store-dir'` is empty. There was
   never any configuration directing the store here.

The `web-build` stage in the Dockerfile hits the same pnpm fallback but writes to
an image layer with no host bind mount, so it cannot produce a host-visible
directory and is not a cause.

### Control: the ignore list never covered it

`.gitignore:19-23` enumerates known Node artifacts:

```
# Node
node_modules/
dist/
.vite/
*.tsbuildinfo
```

There is no `.pnpm-store` entry and no `frontend/.gitignore`.
`git check-ignore -v frontend/.pnpm-store/v10/index` exits 1, confirming the path
was never ignored. The list enumerates artifacts the author had anticipated, so a
cache directory that had not been seen before passed straight through a blanket
`git add`.

## 4. Chosen Strategy and Rationale

Three layers, chosen because the creation site and the commit control are
separate failures that need separate fixes. The user explicitly requested removal
from history rather than untracking alone, and selected the compose volume for
prevention over an ignore-only approach.

**Layer 1, stop the commit.** Add `.pnpm-store/` to the Node block in
`.gitignore`, with no leading slash so it matches at any depth, covering
`frontend/.pnpm-store` today and any future workspace package. This is the only
version-controlled control that protects a fresh clone.

**Layer 2, stop the creation.** Mask the fallback target with a container-local
named volume in the `web` service, mirroring how `doer-web-modules` already
handles `node_modules` in that same block:

```yaml
      - doer-web-store:/web/.pnpm-store
```

with `doer-web-store:` declared under the top-level `volumes:`. Even when pnpm
resolves the store to `/web/.pnpm-store`, the bytes land in the volume and never
reach the host bind mount. A secondary benefit is that the install cache now
persists across `docker compose up` instead of being refetched each time.

**Layer 3, remove it from history.** `git filter-repo --invert-paths --path
frontend/.pnpm-store`, then delete `refs/original/refs/heads/main` and the
`pre-trailer-strip` tag, expire the reflog, `gc --prune=now`, and force-push
`main`. `filter-repo` is preferred over `filter-branch` because the earlier
`filter-branch` run in this repository is what left `refs/original` behind, and
that ref is exactly what would otherwise keep all 27.63 MB alive.

Rejected alternatives:

- **A committed `.npmrc` with `store-dir`.** Redundant on the host, since pnpm
  already resolves to the global store there, and an active trap if committed: a
  relative `store-dir` resolves against the npmrc's own directory and would put
  the store back inside the repository. Only an absolute path works, and no
  single absolute path is valid both on the macOS host and inside the container.
- **A pre-commit hook.** Dead on arrival here. `core.hooksPath` is unset, and the
  existing `.git/hooks/commit-msg` documents the reason in its own comment: a
  fresh clone will not have it. It would not have prevented this and will not
  protect the next clone.
- **`.dockerignore`.** Orthogonal to this defect. The store is already excluded
  from the install step by line ordering in the Dockerfile, and after layer 1 it
  is not in git at all. Worth adding on its own merits and recorded below as
  follow-up, but not part of this fix.
- **Untracking without a history rewrite.** Stops future growth but leaves
  27.63 MB in every clone. Explicitly declined by the user.

## 5. Affected Files

| Path | Change |
|---|---|
| `.gitignore` | Add `.pnpm-store/` to the Node block |
| `docker-compose.yml` | Add the `doer-web-store` volume to the `web` service and to the top-level `volumes:` |
| `frontend/.pnpm-store/**` | 7,863 files removed from the working tree and from all of history |
| `refs/original/refs/heads/main` | Deleted (filter-branch leftover) |
| `refs/tags/pre-trailer-strip` | Deleted (local only, pins the orphan lineage) |

No application source file changes. `frontend/pnpm-lock.yaml` is outside the
filtered path and its blob stays byte-identical.

## 6. Regression Risk

Low on the code, moderate on the coordination.

- **Nothing depends on the store.** Broad greps for `pnpm-store`, `store-dir`,
  `storeDir`, and `store_dir` across the working tree and all of history return
  zero hits. There is no CI. No `package.json` script references it.
- **The Docker build cannot regress.** `pnpm install --frozen-lockfile` runs at
  `Dockerfile:26` with only `package.json` and `pnpm-lock.yaml` present; the
  store is copied in at line 27, after the install it could have served. Removing
  it strictly reduces context size.
- **The store was never a usable cache anyway.** It holds 121 of the 188 packages
  in the lockfile, and every missing entry is a foreign-platform optional binary.
  It could not have satisfied a `--frozen-lockfile` install on any platform
  without reaching the registry.
- **No commit becomes empty**, so the history shape is preserved: 22 commits
  before, 22 after. `a816af6` carries 10 non-store files and `cd13e16` carries 18.
- **No secret exposure and no rotation needed.** All 7,742 store blobs were
  scanned for private key blocks and for `npm_`, `AKIA`, `ghp_`, `sk-`, `AIza`,
  and `xox` token patterns, and for all 10 long values in the untracked `.env`.
  Zero hits. Coverage was proven rather than sampled: the object graph contains
  only two distinct store trees, and HEAD's tree is the strict superset of the
  other.
- **Coordination is the real risk.** Every commit SHA changes. Anyone holding a
  clone must re-clone or `git reset --hard origin/main`; a plain `git pull` will
  attempt a merge and reintroduce the old objects. Mitigated here by the repo
  having a single branch, 22 commits, a clean tree, local equal to origin, and
  one contributor.
- **GitHub retains unreachable objects** addressable by SHA for a period after a
  force-push, so the remote size will not drop immediately. Since the content is
  public npm tarballs with no secrets, this is a cosmetic lag and not an
  exposure.

## 7. Test Plan

Run after the rewrite, before and after the force-push as marked.

1. **Nothing tracked.** `git ls-files | grep -c pnpm-store` returns 0, and
   `git ls-files | wc -l` returns 113 (down from 7,976).
2. **Nothing reachable, the real check.**
   `git rev-list --objects --all --reflog | grep -c 'frontend/\.pnpm-store'`
   returns 0. This covers every ref and the reflog, not just HEAD.
3. **Refs are gone.** `git show-ref | grep -c 'refs/original'` returns 0 and
   `git tag | grep -c pre-trailer-strip` returns 0.
4. **Size actually dropped.** `git count-objects -vH` reports `size-pack` in low
   single-digit MB, well under the starting 29.3 MB.
5. **History shape preserved.** `git rev-list --count HEAD` returns 22, and
   `git log --oneline` shows the same 22 subjects in the same order.
6. **Non-store content survived.** `frontend/package.json` still contains
   `vitest` and `packageManager`, `docs/roadmap.md` is present, and
   `frontend/pnpm-lock.yaml` hashes identically to the pre-rewrite blob.
7. **Build still works.** `pnpm install --frozen-lockfile` succeeds in
   `frontend/` against the global store, and `pnpm build` produces `dist/`.
8. **Prevention holds.** `git check-ignore -v frontend/.pnpm-store` exits 0 and
   names the new `.gitignore` line. After `docker compose up`, `ls frontend/` shows
   no `.pnpm-store` directory on the host.
9. **Remote is clean.** After the force-push, a fresh
   `git clone https://github.com/amansharma2910/doer.git` into a scratch directory
   has a `.git` in low single-digit MB and 113 tracked files.

## 8. Rollback Plan

A verified full backup exists at
`/Users/amansharma2910/projects/doer-pre-pnpm-rewrite.bundle` (28 MB), created
before any destructive step. `git bundle verify` reports a complete history and
lists `refs/heads/main`, `refs/remotes/origin/main`, `refs/tags/pre-trailer-strip`,
and `HEAD` at `25eaa7e`.

To roll back locally:

```
git clone /Users/amansharma2910/projects/doer-pre-pnpm-rewrite.bundle doer-restored
```

To roll back the remote, push the restored `main` back to origin with `--force`.
The pre-rewrite HEAD is `25eaa7e7068402cd87acbff7570e6d58ed4b956c`, so a recovery
is verifiable by SHA.

Keep the bundle until the test plan passes and a fresh clone has been confirmed
working, then delete it. It is stored outside the repository, so it is not itself
at risk from the rewrite.
