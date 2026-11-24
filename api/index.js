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
const { SEEDS } = require("../lib/seeds");

const PORT = process.env.PORT || 3000;
const POST_COST = 3;
const SIGNUP_BONUS = 100;
const FLAG_HIDE = 3;
const SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const RESEND_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "Get Opinion <onboarding@resend.dev>";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const MOD_MODEL = process.env.MODERATION_MODEL || "claude-haiku-5-5";
const DEV_CODES = !RESEND_KEY; // without an email key, codes are shown on screen for testing

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
  `);
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
const CATS = ["design", "style", "dating", "everyday", "fun", "debate"];

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
    }
    req.voter = req.user ? "u:" + req.user.id : "a:" + req.anon;
    next();
  } catch (e) { next(e); }
});

const meOf = (u) => u ? { loggedIn: true, nick: u.nick, email: u.email, credits: u.credits } : { loggedIn: false, credits: 0 };

/* ---------- Auth: email one-time code ---------- */
async function sendCodeEmail(email, code) {
  if (DEV_CODES) { console.log(`[dev] login code for ${email}: ${code}`); return; }
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
  const isNew = !(await q(`SELECT 1 FROM users WHERE email=$1`, [email])).rowCount;
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
  let user = (await q(`SELECT * FROM users WHERE email=$1`, [email])).rows[0];
  let bonus = 0;
  if (!user) {
    if (nick.length < 2) return res.status(400).json({ error: "Pick a nickname of at least 2 characters.", needNick: true });
    if (screenText(nick)) return res.status(400).json({ error: "Pick a different nickname.", needNick: true });
    user = (await q(`INSERT INTO users (id,email,nick,credits) VALUES ($1,$2,$3,$4) RETURNING *`, [newId("u"), email, nick, SIGNUP_BONUS])).rows[0];
    bonus = SIGNUP_BONUS;
  }
  await q(`DELETE FROM otp_codes WHERE email=$1`, [email]);
  // carry anonymous votes over to the account (skip polls the account already voted on)
  await q(`UPDATE votes v SET voter=$1 WHERE voter=$2 AND NOT EXISTS (SELECT 1 FROM votes w WHERE w.poll_id=v.poll_id AND w.voter=$1)`, ["u:" + user.id, "a:" + req.anon]);
  const token = crypto.randomBytes(32).toString("base64url");
  await q(`INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '60 days')`, [hash(token), user.id]);
  setCookie(req, res, "go_session", token, 60 * 60 * 24 * 60);
  res.json({ ok: true, bonus, me: meOf(user) });
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
    SELECT p.*, EXTRACT(EPOCH FROM p.created_at)*1000 AS ts,
      COALESCE(SUM(CASE WHEN v.side='a' THEN 1 ELSE 0 END),0)::int AS va,
      COALESCE(SUM(CASE WHEN v.side='b' THEN 1 ELSE 0 END),0)::int AS vb,
      MAX(CASE WHEN v.voter=$1 THEN v.side END) AS pick,
      (SELECT COUNT(*) FROM flags f WHERE f.poll_id=p.id)::int AS flags,
      EXISTS (SELECT 1 FROM flags f WHERE f.poll_id=p.id AND f.reporter=$1) AS i_flagged
    FROM polls p LEFT JOIN votes v ON v.poll_id=p.id
    WHERE ${where} GROUP BY p.id ORDER BY p.created_at DESC LIMIT 300`, [req.voter, ...params]);
  const ownerId = req.user?.id;
  const out = [];
  for (const p of r.rows) {
    const mine = !!ownerId && p.owner_id === ownerId;
    const o = {
      id: p.id, cat: p.cat, q: p.q, a: p.a, b: p.b, an: p.an || undefined, bn: p.bn || undefined,
      kind: p.kind, vis: p.vis, seed: p.seed, ts: Math.round(+p.ts), mine,
      ca: p.base_a + p.va, cb: p.base_b + p.vb, pick: p.pick || null,
      hidden: p.flags >= FLAG_HIDE || p.i_flagged
    };
    if (p.kind === "image") { o.ai = `/img/${p.id}/a`; o.bi = `/img/${p.id}/b`; }
    if (mine && p.vis === "private") {
      o.voters = (await q(`SELECT alias AS n, side AS s FROM votes WHERE poll_id=$1 AND alias IS NOT NULL ORDER BY created_at`, [p.id])).rows;
    }
    out.push(o);
  }
  return out;
}

app.get("/api/state", async (req, res) => {
  const polls = await loadPolls(`(p.vis='public' OR p.owner_id=$2)`, [req.user?.id || "-"], req);
  res.json({ me: meOf(req.user), polls, devCodes: DEV_CODES });
});

app.get("/api/poll/:id", async (req, res) => {
  const polls = await loadPolls(`p.id=$2`, [req.params.id], req);
  if (!polls.length) return res.status(404).json({ error: "This poll isn’t available." });
  res.json({ poll: polls[0] });
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
  const cat = CATS.includes(b.cat) ? b.cat : "everyday";
  const kind = b.kind === "image" ? "image" : "text";
  const vis = b.vis === "private" ? "private" : "public";
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
    const u = await client.query(`UPDATE users SET credits=credits-$1 WHERE id=$2 AND credits>=$1 RETURNING credits`, [POST_COST, req.user.id]);
    if (!u.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ error: `You need ${POST_COST} credits. Vote on a few polls first.` }); }
    const id = newId("p");
    await client.query(`INSERT INTO polls (id,owner_id,cat,q,a,b,an,bn,kind,vis) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, req.user.id, cat, question, A, B, an, bn, kind, vis]);
    if (imgs) for (const [i, side] of [[0, "a"], [1, "b"]])
      await client.query(`INSERT INTO poll_images (poll_id,side,mime,data) VALUES ($1,$2,$3,$4)`, [id, side, imgs[i].mime, imgs[i].buf]);
    await client.query("COMMIT");
    req.user.credits = u.rows[0].credits;
    const poll = (await loadPolls(`p.id=$2`, [id], req))[0];
    res.json({ poll, me: meOf(req.user) });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  finally { client.release(); }
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
  const p = (await q(`SELECT owner_id, vis FROM polls WHERE id=$1`, [id])).rows[0];
  if (!p) return res.status(404).json({ error: "This poll isn’t available." });
  if (req.user && p.owner_id === req.user.id) return res.status(400).json({ error: "You can’t vote on your own poll." });
  let alias = null;
  if (p.vis === "private") {
    alias = clean(req.body?.alias, 24) || req.user?.nick || null;
    if (!alias || alias.length < 2) return res.status(400).json({ error: "Enter your name to vote on this private poll." });
    if (screenText(alias)) return res.status(400).json({ error: "Pick a different name." });
  }
  const ins = await q(`INSERT INTO votes (poll_id,voter,side,alias) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [id, req.voter, side, alias]);
  let credits = req.user?.credits || 0;
  if (ins.rowCount && req.user) credits = (await q(`UPDATE users SET credits=credits+1 WHERE id=$1 RETURNING credits`, [req.user.id])).rows[0].credits;
  const poll = (await loadPolls(`p.id=$2`, [id], req))[0];
  res.json({ poll, counted: !!ins.rowCount, me: req.user ? { ...meOf(req.user), credits } : meOf(null) });
});

app.post("/api/flag", async (req, res) => {
  const id = clean(req.body?.id, 40), reason = clean(req.body?.reason, 60);
  await q(`INSERT INTO flags (poll_id,reporter,reason) SELECT $1,$2,$3 WHERE EXISTS (SELECT 1 FROM polls WHERE id=$1) ON CONFLICT DO NOTHING`, [id, req.voter, reason]);
  res.json({ ok: true });
});

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: "Something went wrong on our side. Try again." }); });

module.exports = app;

// Local testing: `npm start` serves the page and API together
if (require.main === module) {
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.listen(PORT, () => console.log(`Get Opinion running on http://localhost:${PORT}${DEV_CODES ? " (test mode: login codes shown on screen)" : ""}`));
}
