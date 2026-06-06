// ============================================================
//  Supabase Edge Function: notify-whatsapp
//
//  Sends a WhatsApp message via CallMeBot when a tagged
//  recipient visits the biodata. Triggered by a Supabase
//  Database Webhook on visits INSERT.
//
//  SETUP
//  ─────
//  1. Get a free CallMeBot API key:
//     • Save +34 644 35 36 67 as "CallMeBot" in WhatsApp contacts
//     • Send: "I allow callmebot to send me messages"
//     • You will receive your apikey in reply
//
//  2. Deploy this function:
//       supabase functions deploy notify-whatsapp
//
//  3. Set secrets in Supabase Dashboard → Edge Functions → Secrets:
//       WHATSAPP_PHONE  = your number in international format, no +
//                         e.g. 919876543210  (91 = India country code)
//       CALLMEBOT_KEY   = your CallMeBot API key (from step 1)
//
//  4. Create a Database Webhook in Supabase Dashboard
//       → Database → Webhooks → Create a new Webhook
//       Name:    notify_whatsapp_on_visit
//       Table:   visits
//       Events:  INSERT
//       Method:  POST
//       URL:     https://<project-ref>.supabase.co/functions/v1/notify-whatsapp
//       Header:  Authorization: Bearer <your-service-role-key>
//
//  The function silently skips inserts without a recipient_tag
//  so you only get notified for tagged (tracked) links.
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const payload = await req.json();
    // Supabase DB webhook shape: { type, table, schema, record, old_record }
    const record = payload?.record;

    if (!record?.recipient_tag) {
      return new Response("skip: no recipient_tag", { status: 200, headers: CORS_HEADERS });
    }

    const phone  = Deno.env.get("WHATSAPP_PHONE");
    const apikey = Deno.env.get("CALLMEBOT_KEY");

    if (!phone || !apikey) {
      console.error("notify-whatsapp: missing WHATSAPP_PHONE or CALLMEBOT_KEY secrets");
      return new Response("missing env vars", { status: 500, headers: CORS_HEADERS });
    }

    const tag    = record.recipient_tag;
    const city   = record.city        || "Unknown";
    const device = record.device_type || "Unknown device";
    const source = record.source && record.source !== "none" ? record.source : "direct";
    const time   = new Date(record.visited_at).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day:    "2-digit",
      month:  "short",
      hour:   "2-digit",
      minute: "2-digit",
    });

    const message = [
      `👤 *${tag}* just opened your biodata`,
      `📍 ${city}  |  📱 ${device}`,
      `🔗 via ${source}  |  🕐 ${time}`,
    ].join("\n");

    const callUrl = new URL("https://api.callmebot.com/whatsapp.php");
    callUrl.searchParams.set("phone",  phone);
    callUrl.searchParams.set("text",   message);
    callUrl.searchParams.set("apikey", apikey);

    const resp = await fetch(callUrl.toString());
    const body = await resp.text();

    console.log(`notify-whatsapp [${tag}]: HTTP ${resp.status}`, body.slice(0, 120));
    return new Response(body, { status: resp.ok ? 200 : 502, headers: CORS_HEADERS });

  } catch (err) {
    console.error("notify-whatsapp error:", err);
    return new Response(String(err), { status: 500, headers: CORS_HEADERS });
  }
});
