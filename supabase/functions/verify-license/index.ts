import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import {
  create,
  getNumericDate,
  type Header,
  type Payload,
} from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface VerifyLicenseRequest {
  license_key?: unknown;
  machine_fingerprint?: unknown;
}

interface SubscriptionRow {
  id: string;
  customer_email: string;
  status: "active" | "suspended" | "expired";
  tier: string;
  max_machines: number;
  expires_at: string;
}

interface LicenseWithSubscriptionRow {
  id: string;
  license_key: string;
  is_active: boolean;
  subscription_id: string;
  subscriptions: SubscriptionRow | SubscriptionRow[];
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7-day offline capability interval

let cachedSigningKey: CryptoKey | null = null;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Decodes a PKCS#8 PEM private key from `LICENSE_PRIVATE_KEY` into a raw DER
 * ArrayBuffer for WebCrypto `crypto.subtle.importKey("pkcs8", ...)`.
 * Rejects legacy PKCS#1 headers early with a clear diagnostic error.
 */
function pkcs8PemToArrayBuffer(pemInput: string): ArrayBuffer {
  const normalizedPem = pemInput.replace(/\\n/g, "\n").trim();

  if (normalizedPem.includes("RSA PRIVATE")) {
    throw new Error(
      "LICENSE_PRIVATE_KEY must be in PKCS#8 format, not legacy PKCS#1.",
    );
  }

  const base64Body = normalizedPem
    .replace(/-----(?:BEGIN|END) [A-Z0-9 ]+-----/g, "")
    .replace(/\s+/g, "");

  if (!base64Body) {
    throw new Error("LICENSE_PRIVATE_KEY PEM body is empty or malformed.");
  }

  const binaryString = atob(base64Body);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

async function getPrivateSigningKey(): Promise<CryptoKey> {
  if (cachedSigningKey) {
    return cachedSigningKey;
  }

  const rawPrivateKey = Deno.env.get("LICENSE_PRIVATE_KEY");
  if (!rawPrivateKey) {
    throw new Error(
      "Missing required environment secret: LICENSE_PRIVATE_KEY",
    );
  }

  const keyBuffer = pkcs8PemToArrayBuffer(rawPrivateKey);
  cachedSigningKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBuffer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  return cachedSigningKey;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { error: "Method Not Allowed. Expected POST." },
      405,
    );
  }

  try {
    let body: VerifyLicenseRequest;
    try {
      body = (await req.json()) as VerifyLicenseRequest;
    } catch {
      return jsonResponse({ error: "Invalid JSON request body." }, 400);
    }

    const licenseKey =
      typeof body.license_key === "string"
        ? body.license_key.trim().toUpperCase()
        : "";
    let machineFingerprint =
      typeof body.machine_fingerprint === "string"
        ? body.machine_fingerprint.trim()
        : "";

    if (!licenseKey || licenseKey.length > 128) {
      return jsonResponse(
        { error: "A valid 'license_key' string is required." },
        400,
      );
    }

    if (!machineFingerprint || machineFingerprint.length > 512) {
      return jsonResponse(
        { error: "A valid 'machine_fingerprint' string is required." },
        400,
      );
    }

    // Normalize `web:<origin>` fingerprints (used by myClinic's sync-clinic-license
    // Edge Function as well as direct browser origins) so casing or trailing slashes
    // cannot consume duplicate seats, and populate `allowed_origin` on both paths.
    let effectiveOrigin: string | null = null;
    if (/^web:/i.test(machineFingerprint)) {
      const webMatch = /^web:(https?:\/\/[^|\s]+?)(\|[^\s]+)?$/i.exec(
        machineFingerprint,
      );
      if (!webMatch) {
        return jsonResponse(
          {
            error:
              "Web deployment fingerprint must follow 'web:https://<origin>'.",
          },
          400,
        );
      }
      const normalizedWebOrigin = webMatch[1]
        .trim()
        .toLowerCase()
        .replace(/\/+$/, "");
      const suffix = webMatch[2] ?? "";
      machineFingerprint = `web:${normalizedWebOrigin}${suffix}`;
      effectiveOrigin = normalizedWebOrigin;
    }

    // Browser anti-cloning check: when an HTTP Origin header is present,
    // require the fingerprint to bind to that exact normalized origin.
    const rawOrigin =
      req.headers.get("origin")?.trim().toLowerCase().replace(/\/+$/, "") ||
      null;
    if (rawOrigin && rawOrigin !== "null") {
      if (effectiveOrigin !== rawOrigin) {
        return jsonResponse(
          {
            error: `Browser origin mismatch: fingerprint must be scoped to 'web:${rawOrigin}'.`,
          },
          403,
        );
      }
      effectiveOrigin = rawOrigin;
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(
        "[verify-license] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      );
      return jsonResponse(
        { error: "Internal validator configuration error." },
        500,
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: rawRecord, error: lookupError } = await supabase
      .from("licenses")
      .select(
        `
        id,
        license_key,
        is_active,
        subscription_id,
        subscriptions!inner (
          id,
          customer_email,
          status,
          tier,
          max_machines,
          expires_at
        )
      `,
      )
      .eq("license_key", licenseKey)
      .maybeSingle();

    if (lookupError) {
      console.error("[verify-license] Database lookup error:", lookupError);
      return jsonResponse(
        { error: "Failed to query license authority." },
        500,
      );
    }

    if (!rawRecord) {
      return jsonResponse({ error: "Invalid license key." }, 403);
    }

    const licenseRecord = rawRecord as unknown as LicenseWithSubscriptionRow;
    const subscription = Array.isArray(licenseRecord.subscriptions)
      ? licenseRecord.subscriptions[0]
      : licenseRecord.subscriptions;

    if (!subscription) {
      return jsonResponse(
        { error: "Orphaned license record; subscription missing." },
        403,
      );
    }

    if (!licenseRecord.is_active) {
      return jsonResponse(
        { error: "License key has been deactivated by the administrator." },
        403,
      );
    }

    if (subscription.status !== "active") {
      return jsonResponse(
        {
          error: `Subscription is currently '${subscription.status}'. Renewal or reactivation required.`,
        },
        403,
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAtDate = new Date(subscription.expires_at);

    if (
      Number.isNaN(expiresAtDate.getTime()) ||
      now.getTime() >= expiresAtDate.getTime()
    ) {
      await supabase
        .from("subscriptions")
        .update({ status: "expired" })
        .eq("id", subscription.id)
        .eq("status", "active");

      return jsonResponse(
        {
          error: `Subscription expired on ${subscription.expires_at}.`,
        },
        403,
      );
    }

    const { data: existingMachine, error: machineFetchError } = await supabase
      .from("activated_machines")
      .select("id")
      .eq("license_id", licenseRecord.id)
      .eq("machine_fingerprint", machineFingerprint)
      .maybeSingle();

    if (machineFetchError) {
      console.error(
        "[verify-license] Machine lookup failed:",
        machineFetchError,
      );
      return jsonResponse(
        { error: "Failed to verify hardware fingerprint." },
        500,
      );
    }

    if (existingMachine) {
      const { error: heartbeatError } = await supabase
        .from("activated_machines")
        .update({ last_heartbeat: nowIso })
        .eq("id", existingMachine.id);

      if (heartbeatError) {
        console.error(
          "[verify-license] Heartbeat update failed:",
          heartbeatError,
        );
        return jsonResponse(
          { error: "Failed to record machine heartbeat." },
          500,
        );
      }
    } else {
      const { count: registeredCount, error: countError } = await supabase
        .from("activated_machines")
        .select("id", { count: "exact", head: true })
        .eq("license_id", licenseRecord.id);

      if (countError) {
        console.error("[verify-license] Machine count failed:", countError);
        return jsonResponse(
          { error: "Failed to inspect hardware seat consumption." },
          500,
        );
      }

      const currentNodes = registeredCount ?? 0;
      if (currentNodes >= subscription.max_machines) {
        return jsonResponse(
          {
            error: `Hardware seat limit reached (${currentNodes}/${subscription.max_machines} machines registered).`,
          },
          403,
        );
      }

      const { error: insertMachineError } = await supabase
        .from("activated_machines")
        .insert({
          license_id: licenseRecord.id,
          machine_fingerprint: machineFingerprint,
          activated_at: nowIso,
          last_heartbeat: nowIso,
        });

      if (insertMachineError) {
        if (insertMachineError.code === "23505") {
          await supabase
            .from("activated_machines")
            .update({ last_heartbeat: nowIso })
            .eq("license_id", licenseRecord.id)
            .eq("machine_fingerprint", machineFingerprint);
        } else if (insertMachineError.code === "53400") {
          return jsonResponse(
            {
              error: `Hardware seat limit reached (max ${subscription.max_machines} machines).`,
            },
            403,
          );
        } else {
          console.error(
            "[verify-license] Machine registration failed:",
            insertMachineError,
          );
          return jsonResponse(
            { error: "Failed to bind hardware fingerprint." },
            500,
          );
        }
      }
    }

    const signingKey = await getPrivateSigningKey();

    const header: Header = {
      alg: "RS256",
      typ: "JWT",
    };

    const payload: Payload = {
      iss: "myclinic-license-authority",
      sub: subscription.id,
      license_key: licenseRecord.license_key,
      tier: subscription.tier,
      machine_fingerprint: machineFingerprint,
      ...(effectiveOrigin ? { allowed_origin: effectiveOrigin } : {}),
      max_machines: subscription.max_machines,
      subscription_expires_at: subscription.expires_at,
      iat: getNumericDate(0),
      exp: getNumericDate(TOKEN_TTL_SECONDS),
    };

    const token = await create(header, payload, signingKey);

    return jsonResponse({ token }, 200);
  } catch (err) {
    console.error("[verify-license] Unhandled error:", err);
    return jsonResponse(
      {
        error: "Unexpected internal validator failure.",
      },
      500,
    );
  }
});
