// Cloudflare Pages Function — POST /api/intake
// ---------------------------------------------------------------------------
// Same-origin endpoint the homeinsfl.com form posts to. It forwards the request
// to PoliFlow's public intake endpoint, attaching the secret X-Intake-Key on the
// server side so the key NEVER appears in browser code. The browser never talks
// to PoliFlow directly — it only ever calls /api/intake on its own origin.
//
// Set these in Cloudflare:  Pages project → Settings → Environment variables
//   POLIFLOW_INTAKE_URL   full URL of PoliFlow's endpoint, including the path,
//                         e.g.  https://your-app.replit.app/api/public/intake
//   INTAKE_API_KEY        the SAME long random string you set in Replit Secrets
//
// Note on the CAPTCHA token: the form's `turnstileToken` is passed straight
// through in the body — PoliFlow verifies it. We must NOT verify it here:
// Turnstile tokens are single-use, so verifying at the edge would consume the
// token and PoliFlow's own check would then fail.

const ALLOWED_ORIGINS = new Set([
  "https://homeinsfl.com",
  "https://www.homeinsfl.com",
]);

function corsHeaders(origin) {
  const h = { Vary: "Origin" };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}

function json(obj, status, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...(extraHeaders || {}) },
  });
}

// CORS preflight (only fires for cross-origin; same-origin posts skip it).
export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");
  const cors = corsHeaders(origin);

  const url = env.POLIFLOW_INTAKE_URL;
  const key = env.INTAKE_API_KEY;
  if (!url || !key) {
    // Misconfiguration — fail loudly in logs, generic message to the client.
    console.error("[intake proxy] missing POLIFLOW_INTAKE_URL or INTAKE_API_KEY");
    return json({ message: "Intake is temporarily unavailable." }, 500, cors);
  }

  // Read the raw body and forward it verbatim. This handles both the small
  // "captured" payload and the larger "quote-ready" payload (base64 files)
  // without re-serializing.
  let body;
  try {
    body = await request.text();
  } catch {
    return json({ message: "Could not read request body." }, 400, cors);
  }

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Intake-Key": key,
        // PoliFlow's CORS allowlist requires a recognized Origin. A server-side
        // fetch doesn't send one automatically, so we set it explicitly.
        Origin: "https://homeinsfl.com",
      },
      body,
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json",
        ...cors,
      },
    });
  } catch (err) {
    console.error("[intake proxy] upstream fetch failed:", err && err.message);
    return json({ message: "Could not reach the quote service. Please try again." }, 502, cors);
  }
}
