# Pushing `myClinicLicenseAuthority` (`v2.0.0`) to GitHub

Your full Git repository history (`main` branch + `v1.0.0` .. `v2.0.0` tags) is packaged into **`myclinic-license-authority.bundle`**.

---

## Step 1 — Download the Bundle

Download **`myclinic-license-authority.bundle`** from the workspace viewer (`/home/user/myclinic-license-authority.bundle`).

Optional integrity check:

```bash
git bundle verify myclinic-license-authority.bundle
```

---

## Step 2 — Push to `rajeshlande/myClinicLicenseAuthority`

Run on your machine where `myclinic-license-authority.bundle` was downloaded:

```bash
git clone myclinic-license-authority.bundle myClinicLicenseAuthority
cd myClinicLicenseAuthority
git checkout main
git remote set-url origin https://github.com/rajeshlande/myClinicLicenseAuthority.git
git push -u origin main --tags
```

*(If you already cloned an earlier bundle locally, update and push inside that folder instead:)*

```bash
git pull /path/to/myclinic-license-authority.bundle main --tags
git remote set-url origin https://github.com/rajeshlande/myClinicLicenseAuthority.git
git push -u origin main --tags
```

---

## Step 3 — GitHub Pages & Cloud Supabase Secrets

1. Open **`https://github.com/rajeshlande/myClinicLicenseAuthority` → Settings → Secrets and variables → Actions → Secrets** and ensure both secrets are set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` *(public anon/publishable key only — never `service_role`)*
2. Open **Settings → Pages** and ensure **Source** is set to **GitHub Actions**.
3. In your **Authority Supabase Dashboard → Authentication → Providers → Email**, disable **Allow new users to sign up** once your admin operator accounts are created.
