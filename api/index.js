"use strict";
/*
  Get Opinion API (Vercel serverless function)
  - Express API; the page itself is served from /public
  - PostgreSQL (DATABASE_URL) for users, polls, votes, photos, reports
  - Email one-time-code login (Resend), anonymous voting via cookie
  - Optional photo screening with the Claude API (ANTHROPIC_API_KEY)
*/
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { Pool } = require("pg");
const webpush = require("web-push");
const { SEEDS } = require("../lib/seeds");

const PORT = process.env.PORT || 3000;
const POST_COST = 3;
const PHOTO_COST = 8;
const SIGNUP_BONUS = 100;
const REF_REWARD = 30;        // to the person who shared the link
const REF_WELCOME = 10;       // extra for the friend who joins
const REF_ACTIVATE_VOTES = 5; // friend's votes (while logged in) before the reward is paid
const REF_MONTHLY_CAP = 10;   // rewarded referrals per person per month
// optional "about you" groups attached to public votes; a group's split only shows once it has this many votes
const GENDERS = { w: "Women", m: "Men", nb: "Non-binary" };
const AGES = { "18-24": "18–24", "25-34": "25–34", "35-44": "35–44", "45+": "45+" };
const GROUP_MIN = 20;
const GUARD_PER_POLL = 5; // votes per poll per network+browser per day
const LOW_VOTES = 5;       // under this, verdicts carry a "based on only N votes" note
const EXTEND_MAX = 2, EXTEND_BELOW = 20; // poster can extend twice, only while under 20 votes
// admins: comma-separated login emails in ADMIN_EMAILS; feedback goes to FEEDBACK_TO (or the Gmail account)
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
const feedbackTo = () => process.env.FEEDBACK_TO || GMAIL_USER || "";
const FLAG_HIDE = 3;
const SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const RESEND_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "Get Opinion <onboarding@resend.dev>";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const MOD_MODEL = process.env.MODERATION_MODEL || "claude-haiku-5-5";
const GMAIL_USER = process.env.GMAIL_USER || "";
const GMAIL_PASS = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
const DEV_CODES = !RESEND_KEY && !(GMAIL_USER && GMAIL_PASS); // with no email service set up, codes are shown on screen for testing
let gmail = null;
function gmailTransport() {
  if (!gmail) gmail = require("nodemailer").createTransport({ service: "gmail", auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
  return gmail;
}

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
if (SECRET === "dev-secret-change-me") console.warn("Add a SESSION_SECRET in Vercel Environment Variables before sharing the app publicly.");
const pool = new Pool({ connectionString: DB_URL, max: 3, idleTimeoutMillis: 10000 });
const q = (text, params) => pool.query(text, params);

/* ---------- Schema + seeds ---------- */
async function migrate() {
  await q(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, nick TEXT NOT NULL,
    credits INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS otp_codes (
    email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
    attempts INT NOT NULL DEFAULT 0, sent_at TIMESTAMPTZ NOT NULL DEFAULT now(), sends_hour INT NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL);
  CREATE TABLE IF NOT EXISTS polls (
    id TEXT PRIMARY KEY, owner_id TEXT, cat TEXT NOT NULL, q TEXT NOT NULL,
    a TEXT NOT NULL DEFAULT '', b TEXT NOT NULL DEFAULT '', an TEXT, bn TEXT,
    kind TEXT NOT NULL DEFAULT 'text', vis TEXT NOT NULL DEFAULT 'public',
    seed BOOLEAN NOT NULL DEFAULT false, base_a INT NOT NULL DEFAULT 0, base_b INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS poll_images (
    poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE, side CHAR(1) NOT NULL,
    mime TEXT NOT NULL, data BYTEA NOT NULL, PRIMARY KEY (poll_id, side));
  CREATE TABLE IF NOT EXISTS votes (
    poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE, voter TEXT NOT NULL,
    side CHAR(1) NOT NULL, alias TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (poll_id, voter));
  CREATE TABLE IF NOT EXISTS flags (
    poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE, reporter TEXT NOT NULL,
    reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (poll_id, reporter));
  CREATE INDEX IF NOT EXISTS votes_poll ON votes(poll_id);
  CREATE INDEX IF NOT EXISTS polls_created ON polls(created_at DESC);
  ALTER TABLE polls ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;
  ALTER TABLE polls ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
  ALTER TABLE polls ADD COLUMN IF NOT EXISTS show_name BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS on_boards BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE polls ADD COLUMN IF NOT EXISTS roster JSONB;
  ALTER TABLE votes ADD COLUMN IF NOT EXISTS g TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS adult_at TIMESTAMPTZ;
  -- repeat-vote guard: a salted hash of network + browser per poll, counts only, cleared after 2 days
  CREATE TABLE IF NOT EXISTS vote_guard (
    poll_id TEXT NOT NULL, fp TEXT NOT NULL, n INT NOT NULL DEFAULT 0, day DATE NOT NULL DEFAULT CURRENT_DATE,
    PRIMARY KEY (poll_id, fp, day));
  ALTER TABLE polls ADD COLUMN IF NOT EXISTS cleared BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE polls ADD COLUMN IF NOT EXISTS review BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE polls ADD COLUMN IF NOT EXISTS hide_results BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE polls ADD COLUMN IF NOT EXISTS extended INT NOT NULL DEFAULT 0;
  ALTER TABLE polls ADD COLUMN IF NOT EXISTS warned_at TIMESTAMPTZ;
  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, message TEXT NOT NULL, reply_to TEXT, poll_id TEXT, user_id TEXT,
    done BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  ALTER TABLE votes ADD COLUMN IF NOT EXISTS age TEXT;
  -- who in a private group has voted: a name only, never their pick, no timestamp
  CREATE TABLE IF NOT EXISTS poll_voted (
    poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE, name TEXT NOT NULL, PRIMARY KEY (poll_id, name));
  CREATE TABLE IF NOT EXISTS user_week_votes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, week DATE NOT NULL, n INT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, week));
  CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS push_subs (
    endpoint TEXT PRIMARY KEY, voter TEXT NOT NULL, sub JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  ALTER TABLE push_subs ADD COLUMN IF NOT EXISTS user_id TEXT;
  ALTER TABLE push_subs ALTER COLUMN voter DROP NOT NULL;
  UPDATE push_subs SET user_id = substring(voter from 3) WHERE voter LIKE 'u:%' AND user_id IS NULL;
  UPDATE push_subs SET voter = NULL WHERE voter IS NOT NULL;
  CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user_id);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_norm TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_code TEXT UNIQUE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS votes_cast INT NOT NULL DEFAULT 0;
  CREATE INDEX IF NOT EXISTS users_email_norm ON users(email_norm);
  CREATE TABLE IF NOT EXISTS referrals (
    referee_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    referrer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), rewarded_at TIMESTAMPTZ, paid BOOLEAN NOT NULL DEFAULT false);
  CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals(referrer_id);
  CREATE TABLE IF NOT EXISTS poll_watch (
    poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE, endpoint TEXT NOT NULL, PRIMARY KEY (poll_id, endpoint));
  -- votes never point at an account: replace any account-linked voter ids with random ones
  UPDATE votes SET voter = 'x:' || md5(voter || random()::text) WHERE voter LIKE 'u:%';
  UPDATE flags SET reporter = 'x:' || md5(reporter || random()::text) WHERE reporter LIKE 'u:%';
  UPDATE votes SET alias = NULL WHERE alias IS NOT NULL;
  `);
  for (const u of (await q(`SELECT id, email FROM users WHERE email_norm IS NULL OR ref_code IS NULL`)).rows)
    await q(`UPDATE users SET email_norm=COALESCE(email_norm,$2), ref_code=COALESCE(ref_code,$3) WHERE id=$1`, [u.id, normEmail(u.email), refCode()]);
  const have = (await q(`SELECT COUNT(*)::int AS n FROM polls WHERE seed`)).rows[0].n;
  if (have >= SEEDS.length) return;
  for (const s of SEEDS) {
    const r = await q(`INSERT INTO polls (id,owner_id,cat,q,a,b,an,bn,kind,vis,seed,base_a,base_b,created_at)
      VALUES ($1,'seed',$2,$3,$4,$5,$6,$7,$8,'public',true,$9,$10,to_timestamp($11/1000.0))
      ON CONFLICT (id) DO NOTHING RETURNING id`,
      [s.id, s.cat, s.q, s.a, s.b, s.an || null, s.bn || null, s.kind, s.base[0], s.base[1], s.ts]);
    if (r.rowCount && s.kind === "image") {
      for (const side of ["a", "b"]) {
        const uri = side === "a" ? s.ai : s.bi;
        const svg = decodeURIComponent(uri.split(",")[1]);
        await q(`INSERT INTO poll_images (poll_id,side,mime,data) VALUES ($1,$2,'image/svg+xml',$3) ON CONFLICT DO NOTHING`,
          [s.id, side, Buffer.from(svg, "utf8")]);
      }
    }
  }
}

/* ---------- Helpers ---------- */
const hash = (v) => crypto.createHmac("sha256", SECRET).update(String(v)).digest("hex");
const newId = (p = "") => p + crypto.randomBytes(9).toString("base64url").replace(/[^a-zA-Z0-9]/g, "x");
const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const isEmail = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(e);
// one inbox = one person: drop "+tags" everywhere, and dots for Gmail
function normEmail(e) {
  let [local, domain] = String(e).toLowerCase().split("@");
  if (!domain) return String(e).toLowerCase();
  local = local.split("+")[0];
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return local + "@" + domain;
}
const refCode = () => Array.from(crypto.randomBytes(6), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
const CATS = ["design", "style", "dating", "everyday", "fun", "debate", "random"];

const BLOCK_WORDS = ["kill yourself","kys","go die","retard","slut","whore","faggot","nigger","rape","nude","nudes","naked","porn","onlyfans","xxx","sex tape","dick pic"];
function screenText(...parts) {
  const t = parts.filter(Boolean).join(" ").toLowerCase();
  for (const w of BLOCK_WORDS) if (new RegExp("(^|\\W)" + w.replace(/ /g, "\\s+") + "($|\\W)").test(t)) return "That wording breaks our community rules. Keep it kind and safe for everyone.";
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(t) || /(\+?\d[\d\s-]{8,}\d)/.test(t)) return "Remove phone numbers or email addresses. Polls stay anonymous.";
  if (/https?:\/\//.test(t)) return "Links aren’t allowed inside polls.";
  return null;
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((c) => { const i = c.indexOf("="); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return out;
}
function setCookie(req, res, name, value, maxAgeSec) {
  const secure = req.secure ? "; Secure" : "";
  res.append("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`);
}

/* tiny in-memory rate limiter */
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now(); const h = (hits.get(key) || []).filter((t) => now - t < windowMs);
  h.push(now); hits.set(key, h); return h.length > max;
}
if (hits.size > 5000) hits.clear();

/* ---------- App ---------- */
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
let ready = null;
app.use(async (req, res, next) => {
  if (!DB_URL) return res.status(500).json({ error: "The database isn’t connected yet. Add a Neon database in Vercel (Storage tab), then redeploy." });
  try { ready = ready || migrate(); await ready; next(); }
  catch (e) { ready = null; console.error("Database setup failed:", e.message); res.status(500).json({ error: "The database isn’t reachable right now. Try again in a moment." }); }
});
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "same-origin");
  next();
});

/* identity: anonymous id for every visitor + optional logged-in user */
app.use(async (req, res, next) => {
  try {
    const c = parseCookies(req);
    let anon = c.go_anon;
    if (!anon || !/^[A-Za-z0-9_-]{10,40}$/.test(anon)) { anon = newId(); setCookie(req, res, "go_anon", anon, 60 * 60 * 24 * 400); }
    req.anon = anon;
    req.user = null;
    if (c.go_session) {
      const r = await q(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, [hash(c.go_session)]);
      req.user = r.rows[0] || null;
      if (req.user && req.user.blocked) req.user = null;
    }
    // votes and reports are stored under this anonymous id only, never the account
    req.voter = "a:" + req.anon;
    next();
  } catch (e) { next(e); }
});

const isAdmin = (u) => !!u && ADMIN_EMAILS.length > 0 && (ADMIN_EMAILS.includes(u.email.toLowerCase()) || ADMIN_EMAILS.map(normEmail).includes(u.email_norm || normEmail(u.email)));
const meOf = (u) => u ? { loggedIn: true, nick: u.nick, email: u.email, credits: u.credits, refCode: u.ref_code, votesCast: u.votes_cast, onBoards: u.on_boards, admin: isAdmin(u) || undefined } : { loggedIn: false, credits: 0 };

/* ---------- Verdicts: what a finished poll "settled" ---------- */
// group polls get a verdict once everyone has voted (min 2); other polls need 5 votes; under 55% is too close to call
function verdictOf(p, A, B, isGroup) {
  const T = A + B;
  const label = (s) => (s === "a" ? p.a : p.b) || (s === "a" ? "Photo A" : "Photo B");
  if (!T) return { kind: "none", T, emoji: "🗳️", headline: "Voting closed with no votes", line: "Nobody voted this time." };
  const pa = Math.round(A * 100 / T), w = A >= B ? "a" : "b", pct = Math.max(pa, 100 - pa);
  const low = !isGroup && T < LOW_VOTES, note = low ? `Based on only ${T} ${T === 1 ? "vote" : "votes"}.` : "";
  if (A === B || pct < 55) return { kind: "close", T, pct, low, note, emoji: "🤝", headline: "Too close to call", line: `${pa}% to ${100 - pa}%. The crowd is split.` };
  if (p.cat === "debate" && p.an && p.bn) return { kind: "win", side: w, pct, T, low, note, emoji: "⚖️", headline: `It’s settled! ${w === "a" ? p.an : p.bn} wins`, line: `${label(w)}. ${pct}% agree.` };
  return { kind: "win", side: w, pct, T, low, note, emoji: "✅", headline: p.by ? `It’s settled for ${p.by}` : "It’s settled", line: `${label(w)} wins. ${pct}% agree.` };
}

/* ---------- Push notifications ---------- */
// Keys are created once and kept in the database, so there is nothing to set up.
let vapid = null;
async function getVapid() {
  if (vapid) return vapid;
  let row = (await q(`SELECT v FROM settings WHERE k='vapid'`)).rows[0];
  if (!row) {
    await q(`INSERT INTO settings (k,v) VALUES ('vapid',$1) ON CONFLICT (k) DO NOTHING`, [JSON.stringify(webpush.generateVAPIDKeys())]);
    row = (await q(`SELECT v FROM settings WHERE k='vapid'`)).rows[0];
  }
  vapid = JSON.parse(row.v);
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:hello@get-opinion.app", vapid.publicKey, vapid.privateKey);
  return vapid;
}
async function sendTo(rows, payload) {
  if (!rows.length) return 0;
  await getVapid();
  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(rows.map((r) => webpush.sendNotification(r.sub, body, { TTL: 86400 })));
  let sent = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") sent++;
    else if ([404, 410].includes(r.reason?.statusCode)) await q(`DELETE FROM push_subs WHERE endpoint=$1`, [rows[i].endpoint]);
    else console.error("push_failed", r.reason?.statusCode || r.reason?.message);
  }
  return sent;
}
// creators are reached through their account; voters only through devices that asked to watch a poll
async function notify({ users = [], watchPoll = null }, payload) {
  users = [...new Set(users.filter(Boolean))];
  const rows = (await q(`SELECT DISTINCT s.endpoint, s.sub FROM push_subs s
      WHERE s.user_id = ANY($1) OR s.endpoint IN (SELECT endpoint FROM poll_watch WHERE poll_id=$2)`, [users, watchPoll || "-"])).rows;
  return sendTo(rows, payload);
}
// Tell creators and voters when a timed poll's results are out. Safe to call often.
async function processClosures(limit = 5) {
  if (Math.random() < 0.05) q(`DELETE FROM vote_guard WHERE day < CURRENT_DATE - 1`).catch(() => {});
  const due = (await q(`UPDATE polls SET notified_at=now() WHERE id IN (
      SELECT id FROM polls WHERE ends_at <= now() AND notified_at IS NULL ORDER BY ends_at LIMIT $1)
    RETURNING id, q, a, b, an, bn, cat, owner_id, show_name, vis`, [limit])).rows;
  for (const p of due) {
    const c = (await q(`SELECT COUNT(*) FILTER (WHERE side='a')::int AS a, COUNT(*) FILTER (WHERE side='b')::int AS b FROM votes WHERE poll_id=$1`, [p.id])).rows[0];
    const by = p.show_name ? (await q(`SELECT nick FROM users WHERE id=$1`, [p.owner_id])).rows[0]?.nick : null;
    const v = verdictOf({ ...p, by }, c.a, c.b, false);
    await notify({ users: [p.owner_id], watchPoll: p.id }, { title: `${v.emoji} ${v.headline}`.slice(0, 90), body: `${p.q} ${v.line}${v.note ? " " + v.note : ""}`.slice(0, 180), url: `/#poll-${p.id}`, tag: "result-" + p.id });
  }
  // heads-up to the poster: ending within 3 hours with few votes (only if they turned notifications on)
  const warn = (await q(`UPDATE polls p SET warned_at=now() WHERE p.id IN (
      SELECT id FROM polls WHERE ends_at > now() AND ends_at <= now() + interval '3 hours' AND warned_at IS NULL AND extended < $1
        AND (SELECT COUNT(*) FROM votes v WHERE v.poll_id=polls.id) < $2 LIMIT 10)
    RETURNING id, q, owner_id, (SELECT COUNT(*) FROM votes v WHERE v.poll_id=p.id)::int AS n`, [EXTEND_MAX, LOW_VOTES])).rows;
  for (const w of warn) await notify({ users: [w.owner_id] }, { title: `Ending soon with only ${w.n} ${w.n === 1 ? "vote" : "votes"}`, body: `${w.q} Extend it or share it to get a stronger verdict.`, url: `/#poll-${w.id}`, tag: "warn-" + w.id });
  return due.length;
}
const MILESTONES = [1, 10, 25, 50, 100, 250, 500, 1000];

app.get("/api/push/key", async (req, res) => { res.json({ key: (await getVapid()).publicKey }); });
app.post("/api/push/subscribe", async (req, res) => {
  const sub = req.body?.sub;
  if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return res.status(400).json({ error: "That notification setup didn’t work. Try again." });
  await q(`INSERT INTO push_subs (endpoint,user_id,sub) VALUES ($1,$2,$3) ON CONFLICT (endpoint) DO UPDATE SET user_id=$2, sub=$3`,
    [sub.endpoint.slice(0, 1000), req.user?.id || null, { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } }]);
  res.json({ ok: true });
});
app.post("/api/push/unsubscribe", async (req, res) => {
  const ep = String(req.body?.endpoint || "");
  await q(`DELETE FROM poll_watch WHERE endpoint=$1`, [ep]);
  await q(`DELETE FROM push_subs WHERE endpoint=$1`, [ep]);
  res.json({ ok: true });
});
// a device asks to hear when a timed poll's results drop (stores no vote, no account)
app.post("/api/push/watch", async (req, res) => {
  const id = clean(req.body?.id, 40), ep = String(req.body?.endpoint || "");
  const ok = (await q(`SELECT 1 FROM push_subs WHERE endpoint=$1`, [ep])).rowCount;
  if (ok) await q(`INSERT INTO poll_watch (poll_id,endpoint) SELECT $1,$2 WHERE EXISTS (SELECT 1 FROM polls WHERE id=$1 AND (ends_at > now() OR roster IS NOT NULL)) ON CONFLICT DO NOTHING`, [id, ep]);
  res.json({ ok: true });
});
app.get("/api/cron", async (req, res) => {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).end();
  await q(`DELETE FROM vote_guard WHERE day < CURRENT_DATE - 1`);
  res.json({ closed: await processClosures(50) });
});

/* ---------- Auth: email one-time code ---------- */
async function sendMail({ to, subject, text, html, replyTo }) {
  if (!RESEND_KEY) {
    if (!(GMAIL_USER && GMAIL_PASS)) { console.log("[dev] email not sent (no email service):", subject); return false; }
    await gmailTransport().sendMail({ from: `"Get Opinion" <${GMAIL_USER}>`, to, subject, text, html, replyTo });
    return true;
  }
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, text, html, reply_to: replyTo }) });
  if (!r.ok) throw new Error("email_failed " + r.status);
  return true;
}
async function sendCodeEmail(email, code) {
  if (DEV_CODES) { console.log(`[dev] login code for ${email}: ${code}`); return; }
  const subject = `${code} is your Get Opinion code`;
  const text = `Your Get Opinion login code is ${code}. It expires in 10 minutes. If you didn’t ask for this, ignore this email.`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:16px;color:#1B1630"><p>Your Get Opinion login code is</p><p style="font-size:32px;font-weight:800;letter-spacing:6px">${code}</p><p>It expires in 10 minutes. If you didn’t ask for this, ignore this email.</p></div>`;
  if (!RESEND_KEY) { // free option: send from a Gmail account with an app password
    await gmailTransport().sendMail({ from: `"Get Opinion" <${GMAIL_USER}>`, to: email, subject, text, html });
    return;
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM, to: [email], subject: `${code} is your Get Opinion code`,
      text: `Your Get Opinion login code is ${code}. It expires in 10 minutes. If you didn’t ask for this, ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;font-size:16px;color:#1B1630"><p>Your Get Opinion login code is</p><p style="font-size:32px;font-weight:800;letter-spacing:6px">${code}</p><p>It expires in 10 minutes. If you didn’t ask for this, ignore this email.</p></div>`
    })
  });
  if (!r.ok) throw new Error("email_failed " + r.status + " " + (await r.text()).slice(0, 200));
}

app.post("/api/auth/request", async (req, res) => {
  const email = clean(req.body?.email, 254).toLowerCase();
  if (!isEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (limited("ip:" + req.ip, 10, 3600e3)) return res.status(429).json({ error: "Too many attempts. Try again in an hour." });
  const prev = (await q(`SELECT sent_at, sends_hour FROM otp_codes WHERE email=$1`, [email])).rows[0];
  if (prev && Date.now() - new Date(prev.sent_at).getTime() < 60e3) return res.status(429).json({ error: "Wait a minute before asking for a new code." });
  const sendsHour = prev && Date.now() - new Date(prev.sent_at).getTime() < 3600e3 ? prev.sends_hour + 1 : 1;
  if (sendsHour > 5) return res.status(429).json({ error: "Too many codes sent. Try again in an hour." });
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
  await q(`INSERT INTO otp_codes (email,code_hash,expires_at,attempts,sent_at,sends_hour) VALUES ($1,$2,now()+interval '10 minutes',0,now(),$3)
    ON CONFLICT (email) DO UPDATE SET code_hash=$2, expires_at=now()+interval '10 minutes', attempts=0, sent_at=now(), sends_hour=$3`,
    [email, hash(email + ":" + code), sendsHour]);
  try { await sendCodeEmail(email, code); }
  catch (e) { console.error(e.message); return res.status(502).json({ error: "We couldn’t send the email. Check the address and try again." }); }
  const isNew = !(await q(`SELECT 1 FROM users WHERE email=$1 OR email_norm=$2`, [email, normEmail(email)])).rowCount;
  res.json({ ok: true, isNew, devCode: DEV_CODES ? code : undefined });
});

app.post("/api/auth/verify", async (req, res) => {
  const email = clean(req.body?.email, 254).toLowerCase();
  const code = clean(req.body?.code, 6);
  const nick = clean(req.body?.nick, 24);
  const row = (await q(`SELECT * FROM otp_codes WHERE email=$1`, [email])).rows[0];
  if (!row || new Date(row.expires_at) < new Date()) return res.status(400).json({ error: "That code has expired. Ask for a new one." });
  if (row.attempts >= 5) return res.status(429).json({ error: "Too many wrong codes. Ask for a new one." });
  if (!crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(hash(email + ":" + code)))) {
    await q(`UPDATE otp_codes SET attempts=attempts+1 WHERE email=$1`, [email]);
    return res.status(400).json({ error: "That code isn’t right. Check your email and try again." });
  }
  let user = (await q(`SELECT * FROM users WHERE email=$1 OR email_norm=$2 ORDER BY (email=$1) DESC, created_at LIMIT 1`, [email, normEmail(email)])).rows[0];
  if (user && user.blocked) return res.status(403).json({ error: "This account has been blocked for breaking the community rules." });
  let bonus = 0, refBonus = 0;
  if (!user) {
    if (nick.length < 2) return res.status(400).json({ error: "Pick a nickname of at least 2 characters.", needNick: true });
    if (req.body?.adult !== true) return res.status(400).json({ error: "You need to be 18 or older and agree to the Terms to create an account.", needNick: true });
    if (screenText(nick)) return res.status(400).json({ error: "Pick a different nickname.", needNick: true });
    if (!/^[\p{L}\p{N} ._-]+$/u.test(nick)) return res.status(400).json({ error: "Nicknames can use letters, numbers, spaces, dots, dashes and underscores.", needNick: true });
    if ((await q(`SELECT 1 FROM users WHERE lower(regexp_replace(nick, '\\s+', '', 'g')) = lower(regexp_replace($1, '\\s+', '', 'g'))`, [nick])).rowCount)
      return res.status(400).json({ error: `“${nick}” is taken. Try another nickname.`, needNick: true });
    const norm = normEmail(email);
    const ref = clean(req.body?.ref, 12).toUpperCase();
    const referrer = ref ? (await q(`SELECT id, email_norm FROM users WHERE ref_code=$1`, [ref])).rows[0] : null;
    // only a genuinely new inbox counts as a referral
    const dupe = (await q(`SELECT 1 FROM users WHERE email_norm=$1`, [norm])).rowCount;
    const validRef = referrer && referrer.email_norm !== norm && !dupe;
    let code = refCode();
    while ((await q(`SELECT 1 FROM users WHERE ref_code=$1`, [code])).rowCount) code = refCode();
    user = (await q(`INSERT INTO users (id,email,nick,credits,email_norm,ref_code,adult_at) VALUES ($1,$2,$3,$4,$5,$6,now()) RETURNING *`,
      [newId("u"), email, nick, SIGNUP_BONUS + (validRef ? REF_WELCOME : 0), norm, code])).rows[0];
    bonus = SIGNUP_BONUS;
    if (validRef) { await q(`INSERT INTO referrals (referee_id, referrer_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [user.id, referrer.id]); refBonus = REF_WELCOME; }
  }
  await q(`DELETE FROM otp_codes WHERE email=$1`, [email]);
  // carry anonymous votes over to the account (skip polls the account already voted on)
  const token = crypto.randomBytes(32).toString("base64url");
  await q(`INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '60 days')`, [hash(token), user.id]);
  setCookie(req, res, "go_session", token, 60 * 60 * 24 * 60);
  res.json({ ok: true, bonus, refBonus, me: meOf(user) });
});

app.delete("/api/account", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Log in first." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM polls WHERE owner_id=$1`, [req.user.id]); // photos, votes and reports on them go too
    await client.query(`UPDATE push_subs SET user_id=NULL WHERE user_id=$1`, [req.user.id]);
    await client.query(`DELETE FROM otp_codes WHERE email=$1`, [req.user.email]);
    await client.query(`DELETE FROM users WHERE id=$1`, [req.user.id]); // sessions go with it
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  finally { client.release(); }
  setCookie(req, res, "go_session", "", 0);
  res.json({ ok: true });
});

app.post("/api/auth/logout", async (req, res) => {
  const c = parseCookies(req);
  if (c.go_session) await q(`DELETE FROM sessions WHERE token_hash=$1`, [hash(c.go_session)]);
  setCookie(req, res, "go_session", "", 0);
  res.json({ ok: true });
});

/* ---------- Polls ---------- */
async function loadPolls(where, params, req) {
  const r = await q(`
    SELECT p.*, EXTRACT(EPOCH FROM p.created_at)*1000 AS ts, EXTRACT(EPOCH FROM p.ends_at)*1000 AS ends_ms, (p.ends_at IS NOT NULL AND p.ends_at <= now()) AS closed,
      COALESCE(SUM(CASE WHEN v.side='a' THEN 1 ELSE 0 END),0)::int AS va,
      COALESCE(SUM(CASE WHEN v.side='b' THEN 1 ELSE 0 END),0)::int AS vb,
      MAX(CASE WHEN v.voter=$1 THEN v.side END) AS pick,
      (SELECT COUNT(*) FROM flags f WHERE f.poll_id=p.id)::int AS flags,
      EXISTS (SELECT 1 FROM flags f WHERE f.poll_id=p.id AND f.reporter=$1) AS i_flagged,
      (SELECT u.nick FROM users u WHERE u.id=p.owner_id AND p.show_name) AS by_nick,
      (SELECT COALESCE(json_agg(pv.name ORDER BY pv.name), '[]'::json) FROM poll_voted pv WHERE pv.poll_id=p.id) AS voted_names
    FROM polls p LEFT JOIN votes v ON v.poll_id=p.id
    WHERE ${where} GROUP BY p.id ORDER BY p.created_at DESC LIMIT 300`, [req.voter, ...params]);
  const ownerId = req.user?.id;
  const pubIds = r.rows.filter((p) => p.vis === "public").map((p) => p.id);
  const groups = {};
  if (pubIds.length) {
    const gr = (await q(`
      SELECT poll_id, 'g' AS kind, g AS k, COUNT(*) FILTER (WHERE side='a')::int AS a, COUNT(*) FILTER (WHERE side='b')::int AS b
        FROM votes WHERE poll_id = ANY($1) AND g IS NOT NULL GROUP BY poll_id, g
      UNION ALL
      SELECT poll_id, 'age', age, COUNT(*) FILTER (WHERE side='a')::int, COUNT(*) FILTER (WHERE side='b')::int
        FROM votes WHERE poll_id = ANY($1) AND age IS NOT NULL GROUP BY poll_id, age`, [pubIds])).rows;
    for (const x of gr) {
      const n = x.a + x.b; if (n < GROUP_MIN) continue;
      const label = x.kind === "g" ? GENDERS[x.k] : AGES[x.k]; if (!label) continue;
      (groups[x.poll_id] ||= []).push({ kind: x.kind, label, n, pa: Math.round(x.a * 100 / n) });
    }
  }
  const out = [];
  for (const p of r.rows) {
    const mine = !!ownerId && p.owner_id === ownerId;
    const o = {
      by: p.by_nick || undefined,
      id: p.id, cat: p.cat, q: p.q, a: p.a, b: p.b, an: p.an || undefined, bn: p.bn || undefined,
      kind: p.kind, vis: p.vis, seed: p.seed, ts: Math.round(+p.ts), mine,
      ca: p.va, cb: p.vb, pick: p.pick || null,
      hidden: (p.flags >= (p.review ? 1 : FLAG_HIDE) && !p.cleared) || p.i_flagged,
      endsAt: p.ends_ms ? Math.round(+p.ends_ms) : null, closed: !!p.closed
    };
    if (p.kind === "image") { o.ai = `/img/${p.id}/a`; o.bi = `/img/${p.id}/b`; }
    if (Array.isArray(p.roster) && p.roster.length) {
      o.roster = p.roster; o.votedNames = p.voted_names || [];
      o.groupDone = o.votedNames.length >= p.roster.length;
    }
    // timed polls keep the split secret from everyone except the creator until results drop;
    // group polls keep it secret from everyone, creator included, until the whole group has voted
    const groupSealed = o.roster && !o.groupDone && !o.closed;
    o.extended = p.extended || 0; o.hideResults = !!p.hide_results;
    if ((o.endsAt && !o.closed && !mine && p.hide_results) || groupSealed) { o.total = o.ca + o.cb; o.ca = null; o.cb = null; o.sealed = true; }
    if (groups[o.id] && !o.sealed) o.groups = groups[o.id];
    o.settled = !!(o.closed || o.groupDone);
    out.push(o);
  }
  return out;
}

app.get("/api/state", async (req, res) => {
  try { await processClosures(3); } catch (e) { console.error("closures", e.message); }
  const polls = await loadPolls(`(p.vis='public' OR p.owner_id=$2)`, [req.user?.id || "-"], req);
  const me = meOf(req.user);
  if (req.user) {
    const r = (await q(`SELECT COUNT(*) FILTER (WHERE paid)::int AS joined, COUNT(*) FILTER (WHERE rewarded_at IS NULL)::int AS pending FROM referrals WHERE referrer_id=$1`, [req.user.id])).rows[0];
    const mine = (await q(`SELECT u.nick, r.rewarded_at FROM referrals r JOIN users u ON u.id=r.referrer_id WHERE r.referee_id=$1`, [req.user.id])).rows[0];
    me.referrals = { joined: r.joined, pending: r.pending, earned: r.joined * REF_REWARD, reward: REF_REWARD, welcome: REF_WELCOME, need: REF_ACTIVATE_VOTES,
      invitedBy: mine ? { nick: mine.nick, done: !!mine.rewarded_at } : null };
  }
  res.json({ me, polls, devCodes: DEV_CODES });
});

app.get("/api/poll/:id", async (req, res) => {
  const polls = await loadPolls(`p.id=$2`, [req.params.id], req);
  if (!polls.length) return res.status(404).json({ error: "This poll isn’t available." });
  res.json({ poll: polls[0] });
});

/* ---------- Leaderboards ---------- */
app.get("/api/leaderboard", async (req, res) => {
  const week = req.query.period !== "all";
  const since = week ? "date_trunc('week', now())" : "'-infinity'::timestamptz";
  // most-voted public polls (starter polls excluded); "asked by" only when the poster chose to show it
  const polls = (await q(`
    SELECT p.id, p.q, p.cat, p.kind, CASE WHEN p.show_name THEN u.nick END AS by, COUNT(v.voter)::int AS votes
    FROM polls p LEFT JOIN users u ON u.id=p.owner_id LEFT JOIN votes v ON v.poll_id=p.id
    WHERE NOT p.seed AND p.vis='public' AND p.created_at >= ${since}
      AND (SELECT COUNT(*) FROM flags f WHERE f.poll_id=p.id) < ${FLAG_HIDE}
    GROUP BY p.id, u.nick ORDER BY votes DESC, p.created_at DESC LIMIT 10`)).rows;
  // askers: only polls they posted with their name count toward a public rank
  const askers = (await q(`
    SELECT u.nick, COUNT(DISTINCT p.id)::int AS polls, COUNT(v.voter)::int AS votes
    FROM users u JOIN polls p ON p.owner_id=u.id AND p.show_name AND p.vis='public' AND p.created_at >= ${since}
    LEFT JOIN votes v ON v.poll_id=p.id
    GROUP BY u.id ORDER BY votes DESC, polls DESC LIMIT 10`)).rows;
  // voters: how many votes, never what they picked; nickname only if they opted in
  const vq = week
    ? `SELECT u.id, u.nick, u.on_boards, w.n FROM user_week_votes w JOIN users u ON u.id=w.user_id WHERE w.week = date_trunc('week', now())::date AND w.n > 0`
    : `SELECT id, nick, on_boards, votes_cast AS n FROM users WHERE votes_cast > 0`;
  const ranked = (await q(`SELECT *, RANK() OVER (ORDER BY n DESC) AS rank FROM (${vq}) x ORDER BY n DESC LIMIT 200`)).rows;
  const voters = ranked.slice(0, 10).map((r) => ({ rank: +r.rank, n: r.n, nick: r.on_boards || r.id === req.user?.id ? r.nick : null, you: r.id === req.user?.id }));
  let me = null;
  if (req.user) { const r = ranked.find((x) => x.id === req.user.id); me = r ? { rank: +r.rank, n: r.n } : { rank: null, n: 0 }; }
  res.json({ period: week ? "week" : "all", polls, askers, voters, me });
});
app.post("/api/me/boards", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Log in first." });
  await q(`UPDATE users SET on_boards=$1 WHERE id=$2`, [req.body?.on === true, req.user.id]);
  res.json({ ok: true, onBoards: req.body?.on === true });
});

app.get("/api/profile/:nick", async (req, res) => {
  const u = (await q(`SELECT id, nick, created_at FROM users WHERE lower(nick)=lower($1)`, [clean(req.params.nick, 24)])).rows[0];
  if (!u) return res.status(404).json({ error: "No one by that name here." });
  const polls = (await loadPolls(`p.owner_id=$2 AND p.show_name AND p.vis='public'`, [u.id], req)).filter((p) => !p.hidden);
  if (!polls.length && u.id !== req.user?.id) return res.status(404).json({ error: "This person hasn’t posted any polls with their name yet." });
  res.json({ nick: u.nick, since: new Date(u.created_at).getTime(), polls });
});

/* ---------- Share links with a preview card (WhatsApp, Instagram, iMessage…) ---------- */
let Resvg = null;
try { Resvg = require("@resvg/resvg-js").Resvg; } catch (e) { console.error("preview images off:", e.message); }
const FONT = path.join(__dirname, "..", "lib", "fonts", "bric.ttf");
const xml = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
function wrapText(text, size, maxW, maxLines) {
  const per = size * 0.5, words = String(text).split(/\s+/); const lines = []; let cur = "";
  for (const w of words) { const t = cur ? cur + " " + w : w; if (t.length * per > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + "…"; }
  return lines;
}
const origin = (req) => process.env.PUBLIC_URL || `${req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http")}://${req.headers["x-forwarded-host"] || req.headers.host}`;
async function previewPoll(id) {
  const p = (await q(`SELECT p.id, p.q, p.a, p.b, p.an, p.bn, p.kind, p.cat, p.vis, p.ends_at, p.roster,
      CASE WHEN p.show_name THEN u.nick END AS by,
      (p.ends_at IS NOT NULL AND p.ends_at <= now()) AS closed,
      (SELECT COUNT(*) FILTER (WHERE side='a') FROM votes v WHERE v.poll_id=p.id)::int AS va,
      (SELECT COUNT(*) FILTER (WHERE side='b') FROM votes v WHERE v.poll_id=p.id)::int AS vb,
      (SELECT COUNT(*) FROM poll_voted pv WHERE pv.poll_id=p.id)::int AS nvoted
    FROM polls p LEFT JOIN users u ON u.id=p.owner_id WHERE p.id=$1`, [id])).rows[0];
  if (!p) return null;
  const group = Array.isArray(p.roster) && p.roster.length;
  const settled = p.closed || (group && p.nvoted >= p.roster.length);
  if (settled) { const v = verdictOf(p, p.va, p.vb, !!group); if (v.kind === "win") p.verdict = v; }
  return p;
}
async function previewSvg(p) {
  const F = "Bricolage Grotesque";
  const qs = p.q.length > 60 ? 50 : 60;
  const ql = wrapText(p.q, qs, 1080, 2);
  const top = 118, qy = top + 70;
  const tag = p.verdict ? "The verdict is in" : p.cat === "debate" && p.an && p.bn ? `${p.an} vs ${p.bn}` : p.vis === "private" ? "Private group poll" : "Can’t decide? Vote A or B";
  const by = qy + (ql.length - 1) * (qs + 8) + 36, bh = 630 - by - 66, bw = 530;
  let imgs = {};
  if (p.kind === "image") for (const r of (await q(`SELECT side, mime, data FROM poll_images WHERE poll_id=$1`, [p.id])).rows) imgs[r.side] = `data:${r.mime};base64,${r.data.toString("base64")}`;
  const side = (k, x) => {
    const fill = k === "a" ? "#4B2BE8" : "#FFB01F", ink = k === "a" ? "#FFFFFF" : "#2A1A00";
    const label = (k === "a" ? p.a : p.b) || (k === "a" ? "Option A" : "Option B");
    const who = p.cat === "debate" ? (k === "a" ? p.an : p.bn) : "";
    const ll = wrapText(label, 38, bw - 60, 2);
    const img = imgs[k] ? `<clipPath id="c${k}"><rect x="${x}" y="${by}" width="${bw}" height="${bh}" rx="28"/></clipPath><image href="${imgs[k]}" x="${x}" y="${by}" width="${bw}" height="${bh}" preserveAspectRatio="xMidYMid slice" clip-path="url(#c${k})"/><rect x="${x}" y="${by + bh - 96}" width="${bw}" height="96" fill="#000" opacity=".45" clip-path="url(#c${k})"/>` : "";
    const tcol = imgs[k] ? "#FFFFFF" : ink;
    const won = p.verdict && p.verdict.side === k, lost = p.verdict && !won;
    const badge = won ? `<rect x="${x + bw - 190}" y="${by + 22}" width="168" height="52" rx="26" fill="#FFFFFF"/><text x="${x + bw - 106}" y="${by + 58}" text-anchor="middle" font-family="${F}" font-weight="800" font-size="28" fill="#1B1630">${p.verdict.pct}% WIN</text>` : "";
    const dim = lost ? `<rect x="${x}" y="${by}" width="${bw}" height="${bh}" rx="28" fill="#1B1630" opacity=".55"/>` : "";
    return `<rect x="${x}" y="${by}" width="${bw}" height="${bh}" rx="28" fill="${fill}"/>${img}
      <text x="${x + 28}" y="${by + 78}" font-family="${F}" font-weight="800" font-size="84" fill="${imgs[k] ? "#FFFFFF" : ink}" opacity="${imgs[k] ? 0.95 : 0.35}">${k.toUpperCase()}</text>
      ${who ? `<text x="${x + 30}" y="${by + bh - 30 - ll.length * 44}" font-family="${F}" font-weight="700" font-size="26" fill="${tcol}" opacity=".85">${xml(who)}’s side</text>` : ""}
      ${ll.map((l, i) => `<text x="${x + 30}" y="${by + bh - 30 - (ll.length - 1 - i) * 44}" font-family="${F}" font-weight="700" font-size="38" fill="${tcol}">${xml(l)}</text>`).join("")}${dim}${badge}`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#1B1630"/>
    <g transform="translate(60 42) rotate(-8 22 22)"><rect width="22" height="44" rx="6" fill="#4B2BE8"/><rect x="22" width="22" height="44" rx="6" fill="#FFB01F"/><rect x="18" width="8" height="44" fill="#FFB01F"/></g>
    <text x="120" y="76" font-family="${F}" font-weight="800" font-size="34" fill="#FFFFFF">Get Opinion</text>
    <text x="1140" y="76" text-anchor="end" font-family="${F}" font-weight="600" font-size="26" fill="#B9B2CF">${xml(tag)}</text>
    ${ql.map((l, i) => `<text x="60" y="${qy + i * (qs + 8)}" font-family="${F}" font-weight="800" font-size="${qs}" fill="#FFFFFF">${xml(l)}</text>`).join("")}
    ${side("a", 60)}${side("b", 610)}
    <text x="600" y="606" text-anchor="middle" font-family="${F}" font-weight="600" font-size="24" fill="#FFB01F">${p.verdict ? xml(`${p.verdict.headline}. ${p.verdict.line}${p.verdict.note ? " " + p.verdict.note : ""}`).slice(0, 100) : "Tap to vote · anonymous · takes 2 seconds"}</text>
  </svg>`;
}
app.get("/og/:file", async (req, res) => {
  const id = clean(req.params.file, 60).replace(/\.png$/, "");
  const p = await previewPoll(id);
  if (!p || !Resvg) return res.redirect(302, "/icon-512.png");
  try {
    const png = new Resvg(await previewSvg(p), { font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: "Bricolage Grotesque" }, fitTo: { mode: "width", value: 1200 } }).render().asPng();
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=3600, s-maxage=86400");
    res.send(png);
  } catch (e) { console.error("og_render", e.message); res.redirect(302, "/icon-512.png"); }
});
app.get("/p/:id", async (req, res) => {
  const id = clean(req.params.id, 40);
  const ref = clean(req.query.r, 12).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const target = `/${ref ? "?r=" + ref : ""}#poll-${encodeURIComponent(id)}`;
  const p = await previewPoll(id);
  if (!p) return res.redirect(302, "/");
  const o = origin(req);
  const title = p.verdict ? `${p.verdict.headline}: ${p.q}` : p.q;
  const desc = p.verdict ? `${p.verdict.line} See the result on Get Opinion.` : p.cat === "debate" && p.an && p.bn ? `${p.an} vs ${p.bn}: ${p.a || "A"} or ${p.b || "B"}? Pick a side, anonymously.` : `${p.a || "Photo A"} or ${p.b || "Photo B"}? Vote anonymously on Get Opinion. Takes 2 seconds.`;
  res.set("Cache-Control", "public, max-age=300, s-maxage=3600");
  res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${xml(title)} · Get Opinion</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${xml(desc)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Get Opinion">
<meta property="og:title" content="${xml(title)}"><meta property="og:description" content="${xml(desc)}">
<meta property="og:url" content="${xml(o + "/p/" + id)}">
<meta property="og:image" content="${xml(o + "/og/" + id + ".png" + (p.verdict ? "?s=1" : ""))}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${xml(title)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${xml(title)}"><meta name="twitter:image" content="${xml(o + "/og/" + id + ".png" + (p.verdict ? "?s=1" : ""))}">
<meta http-equiv="refresh" content="0; url=${xml(target)}">
<script>location.replace(${JSON.stringify(target)});</script>
</head><body style="font-family:system-ui;background:#14111C;color:#fff;padding:40px"><p>Opening the poll… <a style="color:#FFB01F" href="${xml(target)}">Tap here</a> if nothing happens.</p></body></html>`);
});

app.get("/img/:id/:side", async (req, res) => {
  const r = await q(`SELECT mime, data FROM poll_images WHERE poll_id=$1 AND side=$2`, [req.params.id, req.params.side]);
  if (!r.rowCount) return res.status(404).end();
  res.set("Content-Type", r.rows[0].mime);
  res.set("Cache-Control", "public, max-age=86400");
  if (r.rows[0].mime === "image/svg+xml") res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
  res.send(r.rows[0].data);
});

function decodeImage(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  if (buf.length < 500 || buf.length > 400 * 1024) return null;
  return { mime: m[1], buf, b64: m[2] };
}

async function aiScreen(images, question) {
  if (!ANTHROPIC_KEY) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MOD_MODEL, max_tokens: 150,
        messages: [{ role: "user", content: [
          ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.mime, data: im.b64 } })),
          { type: "text", text: `You are a content safety screener for an anonymous A/B voting app. Look at the two images and the question: "${question.replace(/"/g, "'")}". Block if any image contains nudity or sexual content, graphic violence, hate symbols, a person who appears to be a minor in a revealing or dating context, ID cards or private documents, or a covert or non-consensual photo of a stranger. Ordinary selfies, outfits, haircuts, rooms, designs and products are fine. Reply only with JSON: {"allow": true or false, "reason": "short plain reason"}` }
        ] }]
      })
    });
    if (!r.ok) { console.error("moderation_failed", r.status); return null; }
    const j = await r.json();
    const text = (j.content || []).map((c) => c.text || "").join("");
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return typeof parsed.allow === "boolean" ? parsed : null;
  } catch (e) { console.error("moderation_error", e.message); return null; }
}

app.post("/api/polls", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Log in to post a poll." });
  if (limited("post:" + req.user.id, 20, 3600e3)) return res.status(429).json({ error: "You’re posting a lot. Try again later." });
  const b = req.body || {};
  const cat = CATS.includes(b.cat) ? b.cat : "random";
  const kind = b.kind === "image" ? "image" : "text";
  const vis = b.vis === "private" ? "private" : "public";
  const DURATIONS = [0, 6, 24, 72, 168];
  const hours = DURATIONS.includes(+b.hours) ? +b.hours : 0;
  const showName = b.showName === true;
  const review = kind === "image" && b.skinFlag === true;
  const hideResults = hours > 0 && b.hideResults === true;
  let roster = null;
  if (vis === "private" && Array.isArray(b.roster)) {
    const seen = new Set(); roster = [];
    for (const n of b.roster) { const c = clean(n, 20); const k = c.toLowerCase(); if (c.length >= 1 && !seen.has(k)) { seen.add(k); roster.push(c); } }
    if (roster.length > 50) return res.status(400).json({ error: "A group can have up to 50 people." });
    if (roster.length === 1) return res.status(400).json({ error: "Add at least 2 people to the group, or leave it empty." });
    if (!roster.length) roster = null;
    else if (screenText(...roster)) return res.status(400).json({ error: "One of the names breaks our community rules." });
  }
  const question = clean(b.q, 120), A = clean(b.a, kind === "image" ? 40 : 60), B = clean(b.b, kind === "image" ? 40 : 60);
  const an = cat === "debate" ? clean(b.an, 18) : null, bn = cat === "debate" ? clean(b.bn, 18) : null;
  if (question.length < 6) return res.status(400).json({ error: "Write a question of at least a few words." });
  if (kind === "text" && (!A || !B)) return res.status(400).json({ error: "Fill in both options." });
  if (cat === "debate" && (!an || !bn)) return res.status(400).json({ error: "Add a name for each side of the debate." });
  const bad = screenText(question, A, B, an, bn); if (bad) return res.status(400).json({ error: bad });
  let imgs = null;
  if (kind === "image") {
    if (!b.consent) return res.status(400).json({ error: "Confirm you have permission to post these photos." });
    imgs = [decodeImage(b.ai), decodeImage(b.bi)];
    if (!imgs[0] || !imgs[1]) return res.status(400).json({ error: "Both photos need to be JPG, PNG or WebP under 400 KB." });
    const verdict = await aiScreen(imgs, question);
    if (verdict && !verdict.allow) return res.status(400).json({ error: "These photos can’t be posted: " + clean(verdict.reason, 140) });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const u = await client.query(`UPDATE users SET credits=credits-$1 WHERE id=$2 AND credits>=$1 RETURNING credits`, [kind === "image" ? PHOTO_COST : POST_COST, req.user.id]);
    if (!u.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ error: `You need ${kind === "image" ? PHOTO_COST : POST_COST} credits for a ${kind === "image" ? "photo" : "text"} poll. Vote on a few more polls first.` }); }
    const id = newId("p");
    await client.query(`INSERT INTO polls (id,owner_id,cat,q,a,b,an,bn,kind,vis,ends_at,show_name,roster,review,hide_results) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $11::int > 0 THEN now() + make_interval(hours => $11::int) END, $12, $13, $14, $15)`,
      [id, req.user.id, cat, question, A, B, an, bn, kind, vis, hours, showName, roster ? JSON.stringify(roster) : null, review, hideResults]);
    if (imgs) for (const [i, side] of [[0, "a"], [1, "b"]])
      await client.query(`INSERT INTO poll_images (poll_id,side,mime,data) VALUES ($1,$2,$3,$4)`, [id, side, imgs[i].mime, imgs[i].buf]);
    await client.query("COMMIT");
    req.user.credits = u.rows[0].credits;
    const poll = (await loadPolls(`p.id=$2`, [id], req))[0];
    res.json({ poll, me: meOf(req.user) });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  finally { client.release(); }
});

app.post("/api/polls/:id/extend", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Log in first." });
  const hours = [24, 72].includes(+req.body?.hours) ? +req.body.hours : 24;
  const p = (await q(`SELECT owner_id, ends_at, extended, roster, (SELECT COUNT(*) FROM votes v WHERE v.poll_id=polls.id)::int AS n FROM polls WHERE id=$1`, [clean(req.params.id, 40)])).rows[0];
  if (!p || p.owner_id !== req.user.id) return res.status(404).json({ error: "Poll not found." });
  if (!p.ends_at) return res.status(400).json({ error: "This poll has no timer to extend." });
  if (p.extended >= EXTEND_MAX) return res.status(400).json({ error: `A poll can be extended ${EXTEND_MAX} times.` });
  if (p.n >= EXTEND_BELOW) return res.status(400).json({ error: `This poll already has ${p.n} votes, enough for a solid verdict.` });
  await q(`UPDATE polls SET ends_at = GREATEST(ends_at, now()) + make_interval(hours => $1::int), extended = extended + 1, notified_at = NULL, warned_at = NULL WHERE id=$2`, [hours, clean(req.params.id, 40)]);
  const poll = (await loadPolls(`p.id=$2`, [clean(req.params.id, 40)], req))[0];
  res.json({ poll });
});

app.delete("/api/polls/:id", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Log in first." });
  const r = await q(`DELETE FROM polls WHERE id=$1 AND owner_id=$2`, [req.params.id, req.user.id]);
  if (!r.rowCount) return res.status(404).json({ error: "Poll not found." });
  res.json({ ok: true });
});

app.post("/api/vote", async (req, res) => {
  const id = clean(req.body?.id, 40), side = req.body?.side;
  if (side !== "a" && side !== "b") return res.status(400).json({ error: "Pick A or B." });
  if (limited("vote:" + req.voter, 120, 60e3)) return res.status(429).json({ error: "Slow down a little." });
  const p = (await q(`SELECT owner_id, vis, roster, q, (ends_at IS NOT NULL AND ends_at <= now()) AS closed FROM polls WHERE id=$1`, [id])).rows[0];
  if (!p) return res.status(404).json({ error: "This poll isn’t available." });
  if (p.closed) return res.status(400).json({ error: "Voting has closed on this poll. The results are out!" });
  if (req.user && p.owner_id === req.user.id) return res.status(400).json({ error: "You can’t vote on your own poll." });
  let ins;
  const roster = Array.isArray(p.roster) && p.roster.length ? p.roster : null;
  if (roster) {
    const member = roster.find((n) => n.toLowerCase() === clean(req.body?.member, 20).toLowerCase());
    if (!member) return res.status(400).json({ error: "Pick your name from the group to vote." });
    if ((await q(`SELECT 1 FROM votes WHERE poll_id=$1 AND voter=$2`, [id, req.voter])).rowCount) return res.status(400).json({ error: "You’ve already voted on this poll." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const claim = await client.query(`INSERT INTO poll_voted (poll_id,name) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, member]);
      if (!claim.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ error: `${member} has already voted. Pick your own name.` }); }
      // stored with the poll's own time, so the order of votes can’t be matched to names
      ins = await client.query(`INSERT INTO votes (poll_id,voter,side,created_at) SELECT $1,$2,$3,created_at FROM polls WHERE id=$1 ON CONFLICT DO NOTHING`, [id, req.voter, side]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
    finally { client.release(); }
    const done = (await q(`SELECT COUNT(*)::int AS n FROM poll_voted WHERE poll_id=$1`, [id])).rows[0].n >= roster.length;
    if (done) {
      try {
        const c = (await q(`SELECT COUNT(*) FILTER (WHERE side='a')::int AS a, COUNT(*) FILTER (WHERE side='b')::int AS b FROM votes WHERE poll_id=$1`, [id])).rows[0];
        const po = (await q(`SELECT a, b, an, bn, cat FROM polls WHERE id=$1`, [id])).rows[0];
        const v = verdictOf(po, c.a, c.b, true);
        await notify({ users: [p.owner_id], watchPoll: id }, { title: `${v.emoji} Everyone’s voted! ${v.headline}`.slice(0, 90), body: `${p.q} ${v.line}`.slice(0, 180), url: `/#poll-${id}`, tag: "result-" + id });
      } catch (e) { console.error("group_done", e.message); }
    }
  } else {
    const ip = String(req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0] || req.ip || "").trim();
    const fp = hash("guard:" + ip + "|" + (req.headers["user-agent"] || "")).slice(0, 24);
    const g0 = (await q(`INSERT INTO vote_guard (poll_id,fp,n) VALUES ($1,$2,1) ON CONFLICT (poll_id,fp,day) DO UPDATE SET n=vote_guard.n+1 RETURNING n`, [id, fp])).rows[0].n;
    if (g0 > GUARD_PER_POLL && !(await q(`SELECT 1 FROM votes WHERE poll_id=$1 AND voter=$2`, [id, req.voter])).rowCount)
      return res.status(429).json({ error: "Lots of votes on this poll have come from this device and network already, so this one wasn’t counted." });
    // group labels only on public polls; private polls stay label-free so small groups can't be singled out
    const g = p.vis === "public" && GENDERS[req.body?.g] ? req.body.g : null;
    const age = p.vis === "public" && AGES[req.body?.age] ? req.body.age : null;
    ins = await q(`INSERT INTO votes (poll_id,voter,side,g,age) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [id, req.voter, side, g, age]);
  }
  if (ins.rowCount && p.owner_id && p.owner_id !== "seed") {
    try {
      const n = (await q(`SELECT COUNT(*)::int AS n FROM votes WHERE poll_id=$1`, [id])).rows[0].n;
      if (MILESTONES.includes(n)) {
        const pq = (await q(`SELECT q FROM polls WHERE id=$1`, [id])).rows[0].q;
        await notify({ users: [p.owner_id] }, { title: n === 1 ? "Your first vote is in! 🎉" : `${n} people have voted`, body: pq, url: `/#poll-${id}`, tag: "votes-" + id });
      }
    } catch (e) { console.error("milestone", e.message); }
  }
  let credits = req.user?.credits || 0;
  if (ins.rowCount && req.user) {
    const u = (await q(`UPDATE users SET credits=credits+1, votes_cast=votes_cast+1 WHERE id=$1 RETURNING credits, votes_cast`, [req.user.id])).rows[0];
    await q(`INSERT INTO user_week_votes (user_id, week, n) VALUES ($1, date_trunc('week', now())::date, 1)
      ON CONFLICT (user_id, week) DO UPDATE SET n = user_week_votes.n + 1`, [req.user.id]);
    credits = u.credits; req.user.votes_cast = u.votes_cast;
    if (u.votes_cast >= REF_ACTIVATE_VOTES) {
      try {
        // claim the pending referral once; pay only under the monthly cap
        const r = (await q(`UPDATE referrals SET rewarded_at=now() WHERE referee_id=$1 AND rewarded_at IS NULL RETURNING referrer_id`, [req.user.id])).rows[0];
        if (r) {
          const n = (await q(`SELECT COUNT(*)::int AS n FROM referrals WHERE referrer_id=$1 AND paid AND rewarded_at >= date_trunc('month', now())`, [r.referrer_id])).rows[0].n;
          if (n < REF_MONTHLY_CAP) {
            await q(`UPDATE referrals SET paid=true WHERE referee_id=$1`, [req.user.id]);
            await q(`UPDATE users SET credits=credits+$1 WHERE id=$2`, [REF_REWARD, r.referrer_id]);
            await notify({ users: [r.referrer_id] }, { title: `${req.user.nick} joined from your link 🎉`, body: `+${REF_REWARD} credits are yours. Keep sharing!`, url: "/#me", tag: "ref-" + req.user.id });
          }
        }
      } catch (e) { console.error("referral", e.message); }
    }
  }
  const poll = (await loadPolls(`p.id=$2`, [id], req))[0];
  res.json({ poll, counted: !!ins.rowCount, me: req.user ? { ...meOf(req.user), credits } : meOf(null) });
});

/* ---------- Feedback and complaints ---------- */
const FEEDBACK_KINDS = { feedback: "Feedback", complaint: "Complaint", bug: "Something’s broken", data: "My data / privacy" };
app.post("/api/feedback", async (req, res) => {
  const kind = FEEDBACK_KINDS[req.body?.kind] ? req.body.kind : "feedback";
  const message = String(req.body?.message || "").trim().slice(0, 2000);
  const replyTo = clean(req.body?.email, 254).toLowerCase() || req.user?.email || "";
  const pollId = clean(req.body?.pollId, 40) || null;
  if (message.length < 5) return res.status(400).json({ error: "Tell us a little more (at least a few words)." });
  if (replyTo && !isEmail(replyTo)) return res.status(400).json({ error: "That email address doesn’t look right." });
  if (limited("fb:" + req.voter, 5, 3600e3)) return res.status(429).json({ error: "You’ve sent a few already. Try again in an hour." });
  const id = newId("f");
  await q(`INSERT INTO feedback (id,kind,message,reply_to,poll_id,user_id) VALUES ($1,$2,$3,$4,$5,$6)`, [id, kind, message, replyTo || null, pollId, req.user?.id || null]);
  if (feedbackTo()) {
    const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    sendMail({ to: feedbackTo(), replyTo: replyTo || undefined, subject: `[Get Opinion] ${FEEDBACK_KINDS[kind]}${req.user ? " from " + req.user.nick : ""}`,
      text: `${message}\n\nReply to: ${replyTo || "not given"}${pollId ? "\nPoll: /#poll-" + pollId : ""}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px"><p><b>${FEEDBACK_KINDS[kind]}</b>${req.user ? " from " + esc(req.user.nick) : ""}</p><p style="white-space:pre-wrap">${esc(message)}</p><p style="color:#666">Reply to: ${esc(replyTo || "not given")}${pollId ? "<br>Poll: /#poll-" + esc(pollId) : ""}</p></div>` })
      .catch((e) => console.error("feedback_mail", e.message));
  }
  res.json({ ok: true });
});

/* ---------- Admin ---------- */
function adminOnly(req, res, next) { if (!isAdmin(req.user)) return res.status(403).json({ error: "Admins only." }); next(); }
app.get("/api/admin/overview", adminOnly, async (req, res) => {
  const one = async (sql) => (await q(sql)).rows[0];
  const stats = await one(`SELECT
    (SELECT COUNT(*) FROM users)::int AS users,
    (SELECT COUNT(*) FROM users WHERE created_at > now()-interval '1 day')::int AS users_1d,
    (SELECT COUNT(*) FROM users WHERE created_at > now()-interval '7 days')::int AS users_7d,
    (SELECT COUNT(*) FROM polls WHERE NOT seed)::int AS polls,
    (SELECT COUNT(*) FROM polls WHERE NOT seed AND created_at > now()-interval '1 day')::int AS polls_1d,
    (SELECT COUNT(*) FROM polls WHERE NOT seed AND created_at > now()-interval '7 days')::int AS polls_7d,
    (SELECT COUNT(*) FROM votes)::int AS votes,
    (SELECT COUNT(*) FROM votes WHERE created_at > now()-interval '1 day')::int AS votes_1d,
    (SELECT COUNT(*) FROM votes WHERE created_at > now()-interval '7 days')::int AS votes_7d,
    (SELECT COUNT(DISTINCT voter) FROM votes WHERE created_at > now()-interval '1 day')::int AS voters_1d,
    (SELECT COUNT(DISTINCT voter) FROM votes WHERE created_at > now()-interval '7 days')::int AS voters_7d,
    (SELECT COUNT(*) FROM referrals WHERE paid)::int AS referrals,
    (SELECT COUNT(*) FROM push_subs)::int AS push,
    (SELECT COUNT(*) FROM users WHERE blocked)::int AS blocked,
    (SELECT COUNT(*) FROM polls WHERE NOT seed AND vis='private')::int AS private_polls,
    (SELECT COUNT(*) FROM polls WHERE NOT seed AND kind='image')::int AS photo_polls`);
  const avg = await one(`SELECT ROUND(AVG(n),1) AS first_day_votes FROM (
    SELECT p.id, COUNT(v.voter) AS n FROM polls p LEFT JOIN votes v ON v.poll_id=p.id AND v.created_at < p.created_at + interval '1 day'
    WHERE NOT p.seed AND p.vis='public' AND p.created_at > now()-interval '30 days' GROUP BY p.id) x`);
  const cats = (await q(`SELECT cat, COUNT(*)::int AS n FROM polls WHERE NOT seed AND created_at > now()-interval '30 days' GROUP BY cat ORDER BY n DESC`)).rows;
  const reported = (await q(`SELECT p.id, p.q, p.a, p.b, p.kind, p.vis, p.created_at, u.nick AS owner, u.blocked AS owner_blocked, p.owner_id,
      COUNT(f.reporter)::int AS reports, array_remove(array_agg(DISTINCT f.reason), NULL) AS reasons, MAX(f.created_at) AS last_report
    , p.review FROM polls p LEFT JOIN flags f ON f.poll_id=p.id LEFT JOIN users u ON u.id=p.owner_id
    WHERE NOT p.cleared AND (p.review OR f.poll_id IS NOT NULL) GROUP BY p.id, u.nick, u.blocked ORDER BY reports DESC, last_report DESC NULLS LAST LIMIT 50`)).rows;
  const feedback = (await q(`SELECT f.id, f.kind, f.message, f.reply_to, f.poll_id, f.created_at, u.nick FROM feedback f LEFT JOIN users u ON u.id=f.user_id
    WHERE NOT f.done ORDER BY f.created_at DESC LIMIT 50`)).rows;
  const recent = (await q(`SELECT p.id, p.q, p.cat, p.vis, p.kind, p.created_at, u.nick AS owner, u.blocked AS owner_blocked, p.owner_id, (SELECT COUNT(*) FROM votes v WHERE v.poll_id=p.id)::int AS votes
    FROM polls p LEFT JOIN users u ON u.id=p.owner_id WHERE NOT p.seed ORDER BY p.created_at DESC LIMIT 30`)).rows;
  res.json({ stats: { ...stats, first_day_votes: avg.first_day_votes }, cats, reported, feedback, recent, flagHide: FLAG_HIDE });
});
app.post("/api/admin/poll", adminOnly, async (req, res) => {
  const id = clean(req.body?.id, 40), action = req.body?.action;
  if (action === "delete") await q(`DELETE FROM polls WHERE id=$1`, [id]);
  else if (action === "restore") { await q(`DELETE FROM flags WHERE poll_id=$1`, [id]); await q(`UPDATE polls SET cleared=true WHERE id=$1`, [id]); }
  else return res.status(400).json({ error: "Unknown action." });
  res.json({ ok: true });
});
app.post("/api/admin/user", adminOnly, async (req, res) => {
  const owner = (await q(`SELECT owner_id FROM polls WHERE id=$1`, [clean(req.body?.pollId, 40)])).rows[0]?.owner_id;
  if (!owner || owner === "seed") return res.status(404).json({ error: "No account found for that poll." });
  if (owner === req.user.id) return res.status(400).json({ error: "You can’t block yourself." });
  const block = req.body?.block !== false;
  await q(`UPDATE users SET blocked=$1 WHERE id=$2`, [block, owner]);
  if (block) { await q(`DELETE FROM sessions WHERE user_id=$1`, [owner]); if (req.body?.removePolls) await q(`DELETE FROM polls WHERE owner_id=$1`, [owner]); }
  res.json({ ok: true });
});
app.post("/api/admin/feedback", adminOnly, async (req, res) => {
  await q(`UPDATE feedback SET done=true WHERE id=$1`, [clean(req.body?.id, 40)]);
  res.json({ ok: true });
});

app.post("/api/flag", async (req, res) => {
  const id = clean(req.body?.id, 40), reason = clean(req.body?.reason, 60);
  await q(`INSERT INTO flags (poll_id,reporter,reason) SELECT $1,$2,$3 WHERE EXISTS (SELECT 1 FROM polls WHERE id=$1) ON CONFLICT DO NOTHING`, [id, req.voter, reason]);
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  if (err && (err.type === "entity.parse.failed" || err.type === "entity.too.large")) return res.status(err.type === "entity.too.large" ? 413 : 400).json({ error: err.type === "entity.too.large" ? "That’s too big to upload. Try smaller photos." : "That request didn’t look right. Refresh and try again." });
  console.error(err); res.status(500).json({ error: "Something went wrong on our side. Try again." });
});

module.exports = app;

// Local testing: `npm start` serves the page and API together
if (require.main === module) {
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.listen(PORT, () => console.log(`Get Opinion running on http://localhost:${PORT}${DEV_CODES ? " (test mode: login codes shown on screen)" : ""}`));
}
