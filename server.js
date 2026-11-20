/*
 * Parley server. No dependencies: runs on Node 18 or newer.
 *   node server.js            (PORT and DATA_DIR are optional environment variables)
 *
 * Provides accounts, sessions, one-to-one messages and live delivery (Server-Sent Events),
 * and serves the app files that sit next to it.
 *
 * Messages are NOT end-to-end encrypted. The server can read them. Use HTTPS in front of it
 * (hosting platforms do this) so they are protected in transit.
 */
"use strict";
var http = require("http");
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var util = require("util");

var PORT = parseInt(process.env.PORT || "3000", 10);
var DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
var DATA_FILE = path.join(DATA_DIR, "parley-data.json");
var PUBLIC_DIR = __dirname;
var PUBLIC_FILES = /^\/(index\.html|styles\.css|app\.js|sw\.js|manifest\.webmanifest|icon-192\.png|icon-512\.png|icon-maskable-512\.png)$/;
var SESSION_MS = 30 * 24 * 3600 * 1000;
var HUES = [12, 38, 160, 190, 220, 265, 300, 340];
var scrypt = util.promisify(crypto.scrypt);

/* ---------- storage: one JSON file, written atomically ---------- */
var db = { users: {}, handles: {}, sessions: {}, messages: {} };
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
try {
  var raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  db.users = raw.users || {}; db.handles = raw.handles || {}; db.sessions = raw.sessions || {}; db.messages = raw.messages || {};
} catch (e) { /* first run */ }
var saveTimer = null, saving = false, dirty = false;
function save() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(function () {
    saveTimer = null;
    if (saving) { save(); return; }
    saving = true; dirty = false;
    var tmp = DATA_FILE + ".tmp";
    fs.writeFile(tmp, JSON.stringify(db), function (err) {
      if (err) { saving = false; console.error("save failed", err.message); return; }
      fs.rename(tmp, DATA_FILE, function (err2) { saving = false; if (err2) console.error("save failed", err2.message); if (dirty) save(); });
    });
  }, 150);
}
function flushSync() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db)); } catch (e) {} }
process.on("SIGTERM", function () { flushSync(); process.exit(0); });
process.on("SIGINT", function () { flushSync(); process.exit(0); });

/* ---------- helpers ---------- */
function sha(s) { return crypto.createHash("sha256").update(s).digest("hex"); }
function rid(n) { return crypto.randomBytes(n).toString("hex"); }
function hashHue(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
function send(res, code, obj, extra) {
  var body = JSON.stringify(obj);
  var h = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
  res.writeHead(code, h); res.end(body);
}
function fail(res, code, msg) { send(res, code, { error: msg }); }
function readJson(req, res) {
  return new Promise(function (resolve) {
    var size = 0, chunks = [];
    req.on("data", function (c) {
      size += c.length;
      if (size > 16 * 1024) { fail(res, 413, "Request too large."); req.destroy(); resolve(null); return; }
      chunks.push(c);
    });
    req.on("end", function () {
      if (!chunks.length) return resolve({});
      try { var o = JSON.parse(Buffer.concat(chunks).toString("utf8")); resolve(o && typeof o === "object" ? o : {}); }
      catch (e) { fail(res, 400, "Invalid request."); resolve(null); }
    });
    req.on("error", function () { resolve(null); });
  });
}
function clientIp(req) {
  var f = req.headers["x-forwarded-for"];
  return (f ? String(f).split(",")[0].trim() : req.socket.remoteAddress) || "?";
}

/* ---------- passwords and sessions ---------- */
async function hashPassword(pw, saltHex) {
  var buf = await scrypt(pw, Buffer.from(saltHex, "hex"), 64);
  return buf.toString("hex");
}
function equalHex(a, b) {
  var x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function newSession(uid) {
  var token = rid(32);
  db.sessions[sha(token)] = { uid: uid, ts: Date.now() };
  save();
  return token;
}
function authOf(req) {
  var h = req.headers["authorization"] || "";
  var m = /^Bearer ([a-f0-9]{64})$/.exec(h);
  if (!m) return null;
  var key = sha(m[1]), s = db.sessions[key];
  if (!s) return null;
  if (Date.now() - s.ts > SESSION_MS) { delete db.sessions[key]; save(); return null; }
  var u = db.users[s.uid];
  return u ? { user: u, key: key } : null;
}

var attempts = {}; /* login throttling: ip+username -> {n, until} */
function throttled(key) { var a = attempts[key]; return a && a.until > Date.now(); }
function noteFail(key) {
  var a = attempts[key] || { n: 0, until: 0 };
  a.n++; if (a.n >= 5) { a.until = Date.now() + 60000; a.n = 0; }
  attempts[key] = a;
}
setInterval(function () { var t = Date.now(); Object.keys(attempts).forEach(function (k) { if (attempts[k].until < t && attempts[k].n === 0) delete attempts[k]; }); }, 300000).unref();

/* ---------- views of users ---------- */
function ownView(u) {
  return { uid: u.uid, username: u.username, displayName: u.displayName, bio: u.bio, hue: u.hue,
    discoverable: u.discoverable !== false, showLastSeen: u.showLastSeen !== false, readReceipts: u.readReceipts !== false,
    blocked: u.blocked || [], lastSeen: u.lastSeen, created: u.created };
}
function publicView(u) {
  var show = u.showLastSeen !== false;
  var o = { uid: u.uid, username: u.username, displayName: u.displayName, bio: u.bio, hue: u.hue, showLastSeen: show };
  if (show) o.lastSeen = u.lastSeen;
  return o;
}
function touch(u) {
  if (Date.now() - (u.lastSeen || 0) > 60000) { u.lastSeen = Date.now(); save(); }
}

/* ---------- live events (SSE) ---------- */
var streams = {}; /* uid -> Set of res */
function emit(uid, type, data) {
  var set = streams[uid]; if (!set) return;
  var line = "event: " + type + "\ndata: " + JSON.stringify(data) + "\n\n";
  set.forEach(function (r) { try { r.write(line); } catch (e) {} });
}
setInterval(function () {
  Object.keys(streams).forEach(function (uid) { streams[uid].forEach(function (r) { try { r.write(": ping\n\n"); } catch (e) {} }); });
}, 25000).unref();

/* ---------- API ---------- */
async function api(req, res, url) {
  var p = url.pathname, m = req.method;

  if (p === "/api/register" && m === "POST") {
    var b = await readJson(req, res); if (!b) return;
    var uname = String(b.username || "").trim(), pw = String(b.password || ""), dn = String(b.displayName || "").trim().slice(0, 30);
    if (!/^[A-Za-z0-9_]{3,20}$/.test(uname)) return fail(res, 400, "Usernames are 3 to 20 letters, numbers or underscores.");
    if (pw.length < 8 || pw.length > 200) return fail(res, 400, "Use a password of 8 to 200 characters.");
    var lower = uname.toLowerCase();
    if (db.handles[lower]) return fail(res, 409, "That username is taken. Try another.");
    var uid = "u_" + rid(12), salt = rid(16);
    db.handles[lower] = uid; /* claim before the slow hash so two requests cannot both win */
    try {
      var hash = await hashPassword(pw, salt);
      db.users[uid] = { uid: uid, username: uname, usernameLower: lower, displayName: dn || uname, bio: "", hue: HUES[hashHue(lower) % HUES.length],
        discoverable: true, showLastSeen: true, readReceipts: true, blocked: [], lastSeen: Date.now(), created: Date.now(), salt: salt, hash: hash };
    } catch (e) { delete db.handles[lower]; return fail(res, 500, "Could not create the account."); }
    var token = newSession(uid); save();
    return send(res, 201, { token: token, me: ownView(db.users[uid]) });
  }

  if (p === "/api/login" && m === "POST") {
    var b2 = await readJson(req, res); if (!b2) return;
    var ln = String(b2.username || "").trim().toLowerCase(), lp = String(b2.password || "");
    var tkey = clientIp(req) + ":" + ln;
    if (throttled(tkey)) return fail(res, 429, "Too many attempts. Wait a minute and try again.");
    var id = db.handles[ln], u = id && db.users[id];
    var ok = false;
    if (u && lp.length <= 200) { try { ok = equalHex(await hashPassword(lp, u.salt), u.hash); } catch (e) { ok = false; } }
    else { try { await hashPassword(lp.slice(0, 200), "00".repeat(16)); } catch (e) {} } /* keep timing similar */
    if (!ok) { noteFail(tkey); return fail(res, 401, "Username or password is wrong."); }
    delete attempts[tkey]; u.lastSeen = Date.now();
    return send(res, 200, { token: newSession(u.uid), me: ownView(u) });
  }

  var auth = authOf(req);
  if (!auth) return fail(res, 401, "Please log in.");
  var me = auth.user; touch(me);

  if (p === "/api/logout" && m === "POST") { delete db.sessions[auth.key]; save(); return send(res, 200, { ok: true }); }
  if (p === "/api/me" && m === "GET") return send(res, 200, { me: ownView(me) });

  if (p === "/api/me" && m === "PATCH") {
    var b3 = await readJson(req, res); if (!b3) return;
    if (typeof b3.displayName === "string") me.displayName = b3.displayName.trim().slice(0, 30) || me.username;
    if (typeof b3.bio === "string") me.bio = b3.bio.trim().slice(0, 120);
    if (typeof b3.hue === "number" && HUES.indexOf(b3.hue) >= 0) me.hue = b3.hue;
    ["discoverable", "showLastSeen", "readReceipts"].forEach(function (k) { if (typeof b3[k] === "boolean") me[k] = b3[k]; });
    if (Array.isArray(b3.blocked)) {
      me.blocked = b3.blocked.filter(function (x) { return typeof x === "string" && db.users[x] && x !== me.uid; }).slice(0, 500);
    }
    save();
    return send(res, 200, { me: ownView(me) });
  }

  var um = /^\/api\/users\/(u_[a-f0-9]{24})$/.exec(p);
  if (um && m === "GET") {
    var tu = db.users[um[1]]; if (!tu) return fail(res, 404, "Not found.");
    return send(res, 200, { user: publicView(tu) });
  }

  if (p === "/api/search" && m === "GET") {
    var q = String(url.searchParams.get("q") || "").trim().replace(/^@/, "").toLowerCase();
    if (q.length < 2 || !/^[a-z0-9_]+$/.test(q)) return send(res, 200, { users: [] });
    var out = [], exact = db.handles[q];
    if (exact && db.users[exact]) out.push(publicView(db.users[exact]));
    Object.keys(db.handles).sort().forEach(function (h) {
      if (out.length >= 10 || h.indexOf(q) !== 0 || h === q) return;
      var cu = db.users[db.handles[h]]; if (cu && cu.discoverable !== false) out.push(publicView(cu));
    });
    return send(res, 200, { users: out });
  }

  if (p === "/api/messages" && m === "GET") {
    var list = [];
    Object.keys(db.messages).forEach(function (k) { var mm = db.messages[k]; if (mm.participants.indexOf(me.uid) >= 0) list.push(mm); });
    list.sort(function (a, b) { return a.ts - b.ts; });
    return send(res, 200, { messages: list.slice(-2000) });
  }

  if (p === "/api/messages" && m === "POST") {
    var b4 = await readJson(req, res); if (!b4) return;
    var to = String(b4.to || ""), text = String(b4.text || "").trim().slice(0, 2000);
    var target = db.users[to];
    if (!target) return fail(res, 404, "That user does not exist.");
    if (!text) return fail(res, 400, "Write a message first.");
    if (to !== me.uid && (target.blocked || []).indexOf(me.uid) >= 0) return fail(res, 403, "You can't message this user.");
    if (to !== me.uid && (me.blocked || []).indexOf(to) >= 0) return fail(res, 403, "Unblock this user to message them.");
    var parts = to === me.uid ? [me.uid] : [me.uid, to];
    var msg = { id: "m" + rid(10), chat: [me.uid, to].sort().join("~"), participants: parts, from: me.uid, to: to, text: text, ts: Date.now() };
    db.messages[msg.id] = msg; save();
    parts.forEach(function (uid) { emit(uid, "msg", msg); });
    return send(res, 201, { message: msg });
  }

  var dm = /^\/api\/messages\/(m[a-f0-9]{20})$/.exec(p);
  if (dm && m === "DELETE") {
    var tm = db.messages[dm[1]];
    if (!tm || tm.from !== me.uid) return fail(res, 404, "Not found.");
    delete db.messages[tm.id]; save();
    tm.participants.forEach(function (uid) { emit(uid, "del", { id: tm.id }); });
    return send(res, 200, { ok: true });
  }

  if (p === "/api/read" && m === "POST") {
    var b5 = await readJson(req, res); if (!b5) return;
    var other = String(b5.with || "");
    if (me.readReceipts === false || other === me.uid) return send(res, 200, { ok: true, updated: 0 });
    var n = 0, now = Date.now();
    Object.keys(db.messages).forEach(function (k) {
      var mm = db.messages[k];
      if (mm.from === other && mm.to === me.uid && !mm.readAt) { mm.readAt = now; n++; mm.participants.forEach(function (uid) { emit(uid, "msg", mm); }); }
    });
    if (n) save();
    return send(res, 200, { ok: true, updated: n });
  }

  if (p === "/api/events" && m === "GET") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 3000\n\n");
    var set = streams[me.uid] || (streams[me.uid] = new Set());
    set.add(res);
    req.on("close", function () { set.delete(res); if (!set.size) delete streams[me.uid]; });
    return;
  }

  return fail(res, 404, "Not found.");
}

/* ---------- static files ---------- */
var TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" };
function serveStatic(req, res, url) {
  var rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  if (!PUBLIC_FILES.test(rel)) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
  var full = path.normalize(path.join(PUBLIC_DIR, rel));
  if (full.indexOf(PUBLIC_DIR + path.sep) !== 0) { res.writeHead(403); return res.end("Forbidden"); }
  fs.stat(full, function (err, st) {
    if (err || !st.isFile()) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
    var ext = path.extname(full).toLowerCase();
    var h = { "Content-Type": TYPES[ext] || "application/octet-stream", "Content-Length": st.size };
    h["Cache-Control"] = /\.(png)$/.test(ext) ? "public, max-age=86400" : "no-cache";
    res.writeHead(200, h);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(full).pipe(res);
  });
}

var CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

var server = http.createServer(function (req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", CSP);
  if (req.headers["x-forwarded-proto"] === "https") res.setHeader("Strict-Transport-Security", "max-age=31536000");
  var url;
  try { url = new URL(req.url, "http://localhost"); } catch (e) { res.writeHead(400); return res.end(); }
  if (url.pathname === "/healthz") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("ok"); }
  if (url.pathname.indexOf("/api/") === 0) {
    api(req, res, url).catch(function (e) { console.error(e); if (!res.headersSent) fail(res, 500, "Something went wrong."); });
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
  serveStatic(req, res, url);
});
server.keepAliveTimeout = 65000;
server.listen(PORT, function () { console.log("Parley listening on port " + PORT + ", data in " + DATA_DIR); });
