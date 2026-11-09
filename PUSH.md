# Pushing `myClinicLicenseAuthority` (`v2.2.1`) to GitHub

Your full Git repository history (`main` branch + `v1.0.0` .. `v2.2.1` tags) is packaged into **`myclinic-license-authority-v2.2.1.bundle`**.

---

## Step 1 — Download the Versioned Bundle

Download **`myclinic-license-authority-v2.2.1.bundle`** from the workspace viewer (`/home/user/myclinic-license-authority-v2.2.1.bundle`).

Optional integrity check:

```bash
git bundle verify ./myclinic-license-authority-v2.2.1.bundle
```

---

## Step 2 — Fast-Forward & Push to `rajeshlande/myClinicLicenseAuthority`

Inside your existing local `myClinicLicenseAuthority` folder:

```bash
git fetch ./myclinic-license-authority-v2.2.1.bundle "refs/tags/*:refs/tags/*"
git merge --ff-only v2.2.1
npm ci && npm run verify
git push origin main && git push origin v2.2.1
```

*(Or if cloning fresh into a new directory:)*

```bash
git clone myclinic-license-authority-v2.2.1.bundle myClinicLicenseAuthority
cd myClinicLicenseAuthority
git checkout main
git remote set-url origin https://github.com/rajeshlande/myClinicLicenseAuthority.git
git push -u origin main --tags
```

---

## Step 3 — GitHub Pages & Cloud Supabase Secrets

1. Open **`https://github.com/rajeshlande/myClinicLicenseAuthority` → Settings → Secrets and variables → Actions → Secrets** and ensure both secrets are set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` *(public anon/publishable key only — never `service_role`)*
2. Open **Settings → Pages** and ensure **Source** is set to **GitHub Actions**.
3. In your **Central Supabase → SQL Editor**, run `supabase/schema.sql` once so the additive `v2.2.x` client sync receipt columns (`last_synced_tier`, `last_synced_status`, `last_synced_expires_at`) are enabled.
