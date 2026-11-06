# Pushing `myclinic-license-authority` to GitHub via Git Bundle

Because this sandbox does not hold your personal GitHub credentials, the full Git repository history (`main` branch + `v1.0.0` tag) is packaged into a single portable **`myclinic-license-authority.bundle`** file.

---

## Step 1 — Download the Bundle

Download **`myclinic-license-authority.bundle`** from the workspace viewer (saved at `/home/user/myclinic-license-authority.bundle` and `/home/user/myclinic-subscription-engine/myclinic-license-authority.bundle`).

Optional integrity check on your machine:

```bash
git bundle verify myclinic-license-authority.bundle
```

---

## Step 2 — Push to Your GitHub Repository

### Option A — Brand-New (Empty) GitHub Repository

1. Create an empty repository on GitHub (for example, `https://github.com/rajeshlande/myclinic-license-authority.git`) — **do not** initialize it with a README or license.
2. Run on your machine where `myclinic-license-authority.bundle` was downloaded:

```bash
git clone myclinic-license-authority.bundle myclinic-license-authority
cd myclinic-license-authority
git checkout main
git remote set-url origin https://github.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPO_NAME>.git
git push -u origin main --tags
```

### Option B — Push into an Existing GitHub Repository

If the target GitHub repository already exists:

```bash
git clone https://github.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPO_NAME>.git
cd <YOUR_REPO_NAME>
git fetch /path/to/myclinic-license-authority.bundle main:refs/heads/bundle-main --tags
git checkout main || git checkout -b main
git merge --allow-unrelated-histories bundle-main
git branch -d bundle-main
git push -u origin main --tags
```

*(Or, if you want to overwrite the remote `main` cleanly with this exact bundle history: `git push --force-with-lease origin bundle-main:main --tags`.)*

---

## Step 3 — Enable GitHub Pages (Automatic CI/CD)

Once pushed to `main`:

1. Open your GitHub repository → **Settings → Pages**.
2. Under **Build and deployment → Source**, select **GitHub Actions**.
3. [`.github/workflows/pages.yml`](.github/workflows/pages.yml) will automatically run the 22-test suite, build `dist/` with relative `./` URLs, verify secret safety, and publish your Control Room live at:
   `https://<YOUR_GITHUB_USERNAME>.github.io/<YOUR_REPO_NAME>/`
4. *(Optional — Live Cloud Supabase Mode)* Under **Settings → Secrets and variables → Actions → Secrets**, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` *(public anon/publishable key only — never `service_role`)*
   Then re-run the **Deploy to GitHub Pages** workflow from the **Actions** tab.
