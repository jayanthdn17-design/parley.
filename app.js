(function () {
  var root = document.getElementById("app");
  var ICON = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.5-8.1a.3.3 0 000-.6L3.4 3.6a.3.3 0 00-.4.4l2.2 7 9.3 1-9.3 1-2.2 7a.3.3 0 00.4.4z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 01-11.6 7.1L4 20.5l1.4-4.7A8 8 0 1121 12z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3h0a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5h0a1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9v0a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
    chev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>'
  };
  var HUES = [12, 38, 160, 190, 220, 265, 300, 340];

  var S = {
    phase: "boot", token: null, live: null, uid: null, me: null, prefs: { blocked: [] },
    tab: "chats", main: null, msgs: [], loaded: false, profiles: {}, filter: "",
    seen: {}, armed: null, receiptsTried: {}, authTab: "login"
  };

  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) {} return null; }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function $(id) { return document.getElementById(id); }
  function hashHue(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function nameOf(p) { return p ? (p.displayName || p.username || "Unknown") : "Unknown"; }
  function av(p, sz) {
    var n = nameOf(p), h = p && typeof p.hue === "number" ? p.hue : hashHue(n);
    return '<span class="av" style="--h:' + h + ';--sz:' + (sz || 44) + 'px">' + esc(n.charAt(0).toUpperCase()) + '</span>';
  }
  function chatId(a, b) { return [a, b].sort().join("~"); }
  function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function fmtDay(ts) {
    var d = new Date(ts), t = new Date(), y = new Date(); y.setDate(t.getDate() - 1);
    if (d.toDateString() === t.toDateString()) return "Today";
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  }
  function fmtShort(ts) {
    var d = new Date(ts), t = new Date();
    if (d.toDateString() === t.toDateString()) return fmtTime(ts);
    var diff = (t - d) / 864e5;
    if (diff < 6) return d.toLocaleDateString([], { weekday: "short" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  function setView(v) { document.body.setAttribute("data-view", v); }
  function isBlocked(uid) { return S.prefs.blocked.indexOf(uid) >= 0; }

  /* ---------- server API ---------- */
  function api(method, url, body) {
    var h = { "Content-Type": "application/json" };
    if (S.token) h["Authorization"] = "Bearer " + S.token;
    return fetch(url, { method: method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok) return j;
        if (r.status === 401 && S.token && url.indexOf("/api/login") < 0) forceLogout();
        throw { msg: j.error || "Something went wrong.", status: r.status };
      });
    }, function () { throw { msg: "Can't reach the server. Check your connection.", status: 0 }; });
  }
  function forceLogout() { if (S.phase === "app") { logout(true); } }

  /* ---------- auth screens ---------- */
  function brand() { return '<div class="brand"><span class="mark">' + ICON.chat + '</span><h1>Parley</h1></div>'; }

  function renderUnavailable(msg) {
    setView("list");
    root.innerHTML = '<div class="auth gut"><div class="auth-card">' + brand() +
      '<h2>Can\'t reach Parley.</h2><p>' + esc(msg || "Check your internet connection and try again.") + '</p><button class="btn" data-act="retry" type="button">Try again</button></div></div>';
  }

  function renderAuth(tab, msg) {
    var reg = S.phase === "register";
    var h = '<div class="auth gut"><div class="auth-card">' + brand();
    if (reg) {
      h += '<div><h2>Create your account</h2><p>Choose a username. Other people find and message you by it, never by phone number.</p></div>' +
        '<form id="af" novalidate>' +
        '<label class="lab">Username<div class="pre"><span>@</span><input type="text" id="au" maxlength="20" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="yourname"></div></label>' +
        '<label class="lab">Display name (optional)<input type="text" id="ad" maxlength="30" autocomplete="nickname" placeholder="How your name appears"></label>' +
        '<label class="lab">Password<input type="password" id="ap" autocomplete="new-password" placeholder="At least 8 characters"></label>' +
        '<label class="lab">Confirm password<input type="password" id="ap2" autocomplete="new-password"></label>' +
        '<div class="hint err" id="am" role="alert">' + esc(msg || "") + '</div>' +
        '<button class="btn" id="ab" type="submit">Create account</button></form>' +
        '<p class="hint">3 to 20 characters: letters, numbers and underscores. Usernames cannot be changed later in this prototype.</p>' +
        '<button class="btn alt" data-act="authswitch" type="button">I already have an account</button>';
    } else {
      h += '<div><h2>Welcome back</h2><p>Log in with your username and password.</p></div>' +
        '<form id="af" novalidate>' +
        '<label class="lab">Username<div class="pre"><span>@</span><input type="text" id="au" maxlength="20" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="yourname" value="' + esc(ls("parley.lastuser") || "") + '"></div></label>' +
        '<label class="lab">Password<input type="password" id="ap" autocomplete="current-password" placeholder="Your password"></label>' +
        '<div class="hint err" id="am" role="alert">' + esc(msg || "") + '</div>' +
        '<button class="btn" id="ab" type="submit">Log in</button></form>' +
        '<button class="btn alt" data-act="authswitch" type="button">Create a new account</button>';
    }
    h += '<div class="note"><b>Prototype</b><p>Messages are sent to the Parley server and are not end-to-end encrypted, so the server operator can read them. Do not use it for anything sensitive.</p></div>';
    h += '</div></div>';
    root.innerHTML = h;
    setView("list");
    var f = $("af");
    f.addEventListener("submit", function (e) { e.preventDefault(); (reg ? doRegister : doLogin)(); });
    var first = $(reg || !$("au").value ? "au" : "ap"); if (first) first.focus();
  }

  function authBusy(on, msg) {
    var b = $("ab"), m = $("am"); if (b) b.disabled = on; if (m && msg !== undefined) m.textContent = msg;
  }

  function startSession(r) {
    S.token = r.token; ls("parley.token", r.token); ls("parley.lastuser", r.me.username);
    S.me = r.me; S.uid = r.me.uid; enterApp();
  }

  function doRegister() {
    var u = $("au").value.trim(), d = $("ad").value.trim(), p = $("ap").value, p2 = $("ap2").value;
    if (!/^[A-Za-z0-9_]{3,20}$/.test(u)) return authBusy(false, "Usernames are 3 to 20 letters, numbers or underscores.");
    if (p.length < 8) return authBusy(false, "Use a password of at least 8 characters.");
    if (p !== p2) return authBusy(false, "The two passwords do not match.");
    authBusy(true, "");
    api("POST", "/api/register", { username: u, displayName: d, password: p }).then(startSession)
      .catch(function (e) { authBusy(false, (e && e.msg) || "Could not create the account. Try again."); });
  }

  function doLogin() {
    var u = $("au").value.trim(), p = $("ap").value;
    if (!u) return authBusy(false, "Enter your username.");
    if (!p) return authBusy(false, "Enter your password.");
    authBusy(true, "");
    api("POST", "/api/login", { username: u, password: p }).then(startSession)
      .catch(function (e) { authBusy(false, (e && e.msg) || "Could not log in. Try again."); });
  }

  /* ---------- app ---------- */
  function enterApp() {
    S.phase = "app"; S.tab = "chats"; S.main = null; S.msgs = []; S.loaded = false; S.receiptsTried = {};
    S.prefs = { blocked: (S.me.blocked || []).slice() };
    S.profiles = {}; S.profiles[S.uid] = S.me;
    try { S.seen = JSON.parse(ls("parley.seen." + S.uid) || "{}") || {}; } catch (e) { S.seen = {}; }
    root.innerHTML = '<div class="shell"><section class="pane pane-list" id="lp" aria-label="Chats"></section><section class="pane pane-main" id="mp" aria-label="Conversation"></section></div>';
    setView("list");
    renderList(); renderMain();
    loadMessages(); startLive();
  }

  function loadMessages() {
    return api("GET", "/api/messages").then(function (r) { S.msgs = r.messages; S.loaded = true; onMessages(); }).catch(function () { S.loaded = true; });
  }
  function upsert(m) {
    var i = -1; for (var k = 0; k < S.msgs.length; k++) if (S.msgs[k].id === m.id) { i = k; break; }
    if (i >= 0) S.msgs[i] = m; else { S.msgs.push(m); S.msgs.sort(function (a, b) { return a.ts - b.ts; }); }
  }
  function handleEvent(block) {
    var type = "", data = "";
    block.split("\n").forEach(function (l) { if (l.indexOf("event:") === 0) type = l.slice(6).trim(); else if (l.indexOf("data:") === 0) data += l.slice(5).trim(); });
    if (!type || !data) return;
    var d; try { d = JSON.parse(data); } catch (e) { return; }
    if (type === "msg") { upsert(d); S.loaded = true; onMessages(); }
    else if (type === "del") { S.msgs = S.msgs.filter(function (m) { return m.id !== d.id; }); onMessages(); }
  }
  function stopLive() { if (S.live) { S.live.abort(); S.live = null; } }
  function startLive() {
    stopLive();
    var ctl = new AbortController(); S.live = ctl; var delay = 1000;
    (function loop() {
      if (ctl.signal.aborted) return;
      fetch("/api/events", { headers: { Authorization: "Bearer " + S.token }, signal: ctl.signal }).then(function (r) {
        if (r.status === 401) { forceLogout(); return; }
        if (!r.ok || !r.body) throw 0;
        delay = 1000; loadMessages();
        var rd = r.body.getReader(), dec = new TextDecoder(), buf = "";
        return (function pump() {
          return rd.read().then(function (x) {
            if (x.done) return;
            buf += dec.decode(x.value, { stream: true });
            var parts = buf.split("\n\n"); buf = parts.pop(); parts.forEach(handleEvent);
            return pump();
          });
        })();
      }).catch(function () {}).then(function () {
        if (ctl.signal.aborted) return;
        setTimeout(loop, delay); delay = Math.min(delay * 2, 15000);
      });
    })();
  }

  function logout(forced) {
    if (!forced && S.token) api("POST", "/api/logout").catch(function () {});
    stopLive();
    S.token = null; ls("parley.token", ""); S.phase = "login"; S.msgs = []; S.main = null; S.armed = null; S.uid = null; S.me = null; S.prefs = { blocked: [] }; S.profiles = {}; S.seen = {}; S.filter = "";
    renderAuth("login", forced ? "Please log in again." : "");
  }

  /* ---------- derived ---------- */
  function otherOf(m) { return m.participants.length === 1 ? S.uid : (m.participants[0] === S.uid ? m.participants[1] : m.participants[0]); }
  function convs() {
    var map = {};
    S.msgs.forEach(function (m) {
      if (!m.participants) return;
      var o = otherOf(m); if (!o || isBlocked(o)) return;
      var c = map[o] || (map[o] = { uid: o, last: null, unread: 0 });
      c.last = m;
      if (m.from !== S.uid && m.ts > (S.seen[o] || 0)) c.unread++;
    });
    var arr = Object.keys(map).map(function (k) { return map[k]; });
    arr.sort(function (a, b) { return b.last.ts - a.last.ts; });
    return arr;
  }
  function totalUnread() { return convs().reduce(function (n, c) { return n + c.unread; }, 0); }
  function markSeen(uid) {
    var latest = 0;
    S.msgs.forEach(function (m) { if (m.participants && otherOf(m) === uid && m.ts > latest) latest = m.ts; });
    if (latest && (S.seen[uid] || 0) < latest) { S.seen[uid] = latest; ls("parley.seen." + S.uid, JSON.stringify(S.seen)); }
  }
  function fetchProfile(uid, force) {
    if (!uid || (!force && S.profiles[uid])) return Promise.resolve(S.profiles[uid]);
    if (uid === S.uid) return Promise.resolve(S.me);
    return api("GET", "/api/users/" + encodeURIComponent(uid)).then(function (r) { S.profiles[uid] = r.user; return r.user; }).catch(function () { return S.profiles[uid]; });
  }
  function ensureProfiles() {
    var need = convs().map(function (c) { return c.uid; }).filter(function (u) { return !S.profiles[u]; });
    if (!need.length) return;
    Promise.all(need.map(function (u) { return fetchProfile(u); })).then(function () { renderList(); if (S.main && S.main.kind === "conv") renderConvHead(); });
  }

  function onMessages() {
    ensureProfiles();
    var viewing = S.main && S.main.kind === "conv" && (window.innerWidth >= 900 || document.body.getAttribute("data-view") === "main");
    if (viewing) { markSeen(S.main.uid); sendReceipts(); }
    renderList();
    if (S.main && S.main.kind === "conv") renderThread(false);
  }

  function sendReceipts() {
    if (!S.main || S.main.kind !== "conv" || S.main.uid === S.uid || !S.me || S.me.readReceipts === false) return;
    var u = S.main.uid, fresh = S.msgs.filter(function (m) { return m.from === u && !m.readAt && !S.receiptsTried[m.id]; });
    if (!fresh.length) return;
    fresh.forEach(function (m) { S.receiptsTried[m.id] = 1; });
    api("POST", "/api/read", { with: u }).catch(function () { fresh.forEach(function (m) { delete S.receiptsTried[m.id]; }); });
  }

  /* ---------- list pane ---------- */
  function renderList() {
    var lp = $("lp"); if (!lp) return;
    var h = "";
    if (S.tab === "chats") {
      h += '<header class="bar gut"><h1>Chats</h1><button class="iconbtn" data-act="new" aria-label="New chat">' + ICON.plus + '</button></header>';
      h += '<div class="search"><input type="text" id="flt" placeholder="Search your chats" aria-label="Search your chats" value="' + esc(S.filter) + '" autocomplete="off"></div>';
      var q = S.filter.trim().toLowerCase();
      var list = convs().filter(function (c) {
        if (!q) return true; var p = S.profiles[c.uid] || {};
        return (nameOf(p).toLowerCase().indexOf(q) >= 0) || ((p.username || "").toLowerCase().indexOf(q) >= 0);
      });
      h += '<div class="scroll" id="chatscroll">';
      if (!list.length) {
        h += S.msgs.length || q ? '<div class="empty"><h3>No matches</h3>Nothing in your chats matches that search.</div>' :
          (!S.loaded ? '<div class="empty">Loading your chats</div>' :
          '<div class="empty"><h3>No conversations yet</h3><p>Find someone by their username to start your first private chat.</p><button class="btn" data-act="new">Start a chat</button></div>');
      }
      list.forEach(function (c) {
        var p = S.profiles[c.uid] || { username: "…" }, self = c.uid === S.uid;
        var prev = (c.last.from === S.uid ? "You: " : "") + c.last.text;
        h += '<button class="chat" data-act="open" data-u="' + esc(c.uid) + '" aria-current="' + (S.main && S.main.kind === "conv" && S.main.uid === c.uid) + '">' + av(p, 48) +
          '<div class="mid"><div class="top"><b>' + esc(self ? "Saved messages" : nameOf(p)) + '</b><time>' + esc(fmtShort(c.last.ts)) + '</time></div>' +
          '<div class="bot"><span class="prev">' + esc(prev) + '</span>' + (c.unread ? '<span class="badge">' + c.unread + '</span>' : '') + '</div></div></button>';
      });
      h += '</div>';
    } else {
      var me = S.me || {};
      h += '<header class="bar gut"><h1>Settings</h1></header><div class="scroll">';
      h += '<div class="card">' + av(me, 56) + '<div class="who"><b>' + esc(nameOf(me)) + '</b><small>@' + esc(me.username) + '</small></div></div>';
      h += '<div class="menu">' +
        mi("profile", "Profile", "Name, bio and avatar color") +
        mi("privacy", "Privacy", "Who can find you and what others see") +
        mi("blocked", "Blocked users", S.prefs.blocked.length ? S.prefs.blocked.length + " blocked" : "No one blocked") +
        mi("security", "Security and storage", "How messages are stored today") +
        '<button class="mi danger" data-act="logout"><span class="t">Log out</span></button></div></div>';
    }
    var unread = totalUnread();
    h += '<nav class="tabs" role="tablist" aria-label="Sections">' +
      '<button class="tab" role="tab" data-act="tab" data-t="chats" aria-selected="' + (S.tab === "chats") + '">' + ICON.chat + 'Chats' + (unread ? '<span class="badge">' + unread + '</span>' : '') + '</button>' +
      '<button class="tab" role="tab" data-act="tab" data-t="settings" aria-selected="' + (S.tab === "settings") + '">' + ICON.gear + 'Settings</button></nav>';
    var keepFocus = document.activeElement && document.activeElement.id === "flt";
    var pos = keepFocus ? document.activeElement.selectionStart : 0;
    lp.innerHTML = h;
    if (keepFocus) { var f = $("flt"); f.focus(); try { f.setSelectionRange(pos, pos); } catch (e) {} }
  }
  function mi(k, t, s) { return '<button class="mi" data-act="sub" data-k="' + k + '"><span class="t">' + t + '<small>' + s + '</small></span><span class="chev">' + ICON.chev + '</span></button>'; }

  /* ---------- main pane ---------- */
  function backBtn() { return '<button class="iconbtn only-narrow" data-act="back" aria-label="Back">' + ICON.back + '</button>'; }

  function renderMain() {
    var mp = $("mp"); if (!mp) return;
    var m = S.main;
    if (!m) {
      mp.innerHTML = '<div class="ph">' + ICON.chat.replace("<svg", '<svg style="width:48px;height:48px"') + '<h3 style="color:var(--fg)">Select a conversation</h3><span>Pick a chat, or start a new one with a username.</span></div>';
      return;
    }
    if (m.kind === "conv") return renderConv();
    if (m.kind === "new") return renderNew();
    if (m.kind === "profile") return renderProfile();
    if (m.kind === "privacy") return renderPrivacy();
    if (m.kind === "blocked") return renderBlocked();
    if (m.kind === "security") return renderSecurity();
  }

  function renderConv() {
    var mp = $("mp");
    mp.innerHTML = '<header class="bar gut" id="chead"></header><div class="msgs" id="msgs" aria-live="polite"></div><div id="comp"></div>';
    renderConvHead(); renderThread(true); renderComposer();
    fetchProfile(S.main.uid, true).then(function () { renderConvHead(); renderList(); });
  }
  function renderConvHead() {
    var hd = $("chead"); if (!hd || !S.main || S.main.kind !== "conv") return;
    var u = S.main.uid, p = S.profiles[u] || { username: "…" }, self = u === S.uid, sub;
    if (self) sub = "Notes to yourself";
    else if (isBlocked(u)) sub = "Blocked";
    else if (p.showLastSeen !== false && p.lastSeen) sub = "Last seen " + (Date.now() - p.lastSeen < 300000 ? "just now" : fmtDay(p.lastSeen).toLowerCase() + " at " + fmtTime(p.lastSeen));
    else sub = "@" + (p.username || "");
    hd.innerHTML = backBtn() + av(p, 40) + '<div class="who"><b>' + esc(self ? "Saved messages" : nameOf(p)) + '</b><small>' + esc(sub) + '</small></div>' +
      (self ? '' : '<button class="btn alt sm" data-act="toggleblock">' + (isBlocked(u) ? "Unblock" : "Block") + '</button>');
  }
  function renderComposer() {
    var c = $("comp"); if (!c || !S.main) return;
    if (isBlocked(S.main.uid)) { c.innerHTML = '<div class="ro"><span>You blocked this user.</span><button class="btn alt sm" data-act="toggleblock">Unblock</button></div>'; return; }
    c.innerHTML = '<form class="composer" id="cf"><textarea id="mi" rows="1" maxlength="2000" placeholder="Message" aria-label="Message"></textarea><button class="send" type="submit" aria-label="Send">' + ICON.send + '</button></form>';
    var ta = $("mi");
    function grow() { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 140) + "px"; }
    ta.addEventListener("input", grow);
    ta.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey && window.innerWidth >= 900) { e.preventDefault(); $("cf").requestSubmit(); } });
    $("cf").addEventListener("submit", function (e) {
      e.preventDefault(); var t = ta.value.trim(); if (!t) return; ta.value = ""; grow(); sendMsg(t);
    });
  }
  function renderThread(force) {
    var box = $("msgs"); if (!box || !S.main || S.main.kind !== "conv") return;
    var u = S.main.uid, near = force || box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    var list = S.msgs.filter(function (m) { return m.participants && otherOf(m) === u; });
    if (!list.length) {
      box.innerHTML = '<div class="empty"><h3>' + (!S.loaded ? 'Loading' : 'Say hello') + '</h3>' + (!S.loaded ? '' : 'This is the start of your conversation with ' + esc(u === S.uid ? "yourself" : nameOf(S.profiles[u])) + '.') + '</div>';
      return;
    }
    var h = "", day = "", lastMine = -1;
    list.forEach(function (m, i) { if (m.from === S.uid) lastMine = i; });
    list.forEach(function (m, i) {
      var d = new Date(m.ts).toDateString();
      if (d !== day) { h += '<div class="day">' + esc(fmtDay(m.ts)) + '</div>'; day = d; }
      var mine = m.from === S.uid, status = "";
      if (mine && i === lastMine && u !== S.uid) status = m.readAt ? "Seen" : "Sent";
      h += '<div class="m' + (mine ? ' mine' : '') + '"><div class="bub">' + esc(m.text) + '</div><div class="mt"><span>' + esc(fmtTime(m.ts)) + '</span>' +
        (status ? '<span>' + status + '</span>' : '') +
        (mine ? '<button type="button" data-act="del" data-id="' + esc(m.id) + '" class="' + (S.armed === m.id ? 'armed' : '') + '">' + (S.armed === m.id ? 'Confirm delete' : 'Delete') + '</button>' : '') +
        '</div></div>';
    });
    box.innerHTML = h;
    if (near) box.scrollTop = box.scrollHeight;
  }

  function sendMsg(text) {
    var o = S.main.uid;
    api("POST", "/api/messages", { to: o, text: text.slice(0, 2000) }).then(function (r) {
      upsert(r.message); onMessages(); renderThread(true);
    }).catch(function (e) {
      var ta = $("mi"); if (ta && !ta.value) ta.value = text;
      var h = $("chead"); if (h) { var s = h.querySelector("small"); if (s) { s.textContent = (e && e.msg) || "Message not sent. Try again."; s.style.color = "var(--danger)"; } }
    });
  }

  /* ---------- sub pages ---------- */
  function subHead(t) { return '<header class="bar gut">' + backBtn() + '<h2>' + t + '</h2></header>'; }

  function renderNew() {
    $("mp").innerHTML = subHead("New chat") + '<div class="scroll"><div class="form"><label class="lab">Find by username<div class="pre"><span>@</span><input type="text" id="nq" maxlength="20" placeholder="username" autocomplete="off" autocapitalize="off" spellcheck="false"></div></label><div id="nr"></div></div></div>';
    var timer = null, seq = 0;
    $("nq").addEventListener("input", function () {
      clearTimeout(timer); var q = this.value.trim().replace(/^@/, "").toLowerCase(), my = ++seq;
      if (q.length < 2) { $("nr").innerHTML = '<p class="hint">Type at least 2 characters.</p>'; return; }
      timer = setTimeout(function () {
        api("GET", "/api/search?q=" + encodeURIComponent(q)).then(function (r) {
          if (my !== seq) return;
          var out = r.users || [];
          out.forEach(function (p) { if (!S.profiles[p.uid]) S.profiles[p.uid] = p; });
          var h = out.length ? "" : '<p class="hint">No one with that username.</p>';
          out.forEach(function (p) {
            h += '<button class="chat" style="padding-inline:0" data-act="open" data-u="' + esc(p.uid) + '">' + av(p, 44) + '<div class="mid"><div class="top"><b>' + esc(p.uid === S.uid ? "Saved messages (you)" : nameOf(p)) + '</b></div><div class="prev">@' + esc(p.username) + '</div></div></button>';
          });
          $("nr").innerHTML = h;
        }).catch(function (e) { if (my === seq) $("nr").innerHTML = '<p class="hint err">' + esc((e && e.msg) || "Search failed.") + '</p>'; });
      }, 250);
    });
    $("nq").focus();
  }

  function renderProfile() {
    var p = S.me, hue = typeof p.hue === "number" ? p.hue : hashHue(nameOf(p));
    var sw = HUES.map(function (x) { return '<button type="button" class="sw" data-act="hue" data-h="' + x + '" style="--h:' + x + '" aria-label="Avatar color ' + x + '" aria-pressed="' + (x === hue) + '"></button>'; }).join("");
    $("mp").innerHTML = subHead("Profile") + '<div class="scroll"><form class="form" id="pf">' +
      '<div style="display:flex;align-items:center;gap:14px"><span id="pav">' + av(p, 72) + '</span><div class="who"><b>@' + esc(p.username) + '</b><small>Your username can\'t be changed.</small></div></div>' +
      '<label class="lab">Display name<input type="text" id="pn" maxlength="30" value="' + esc(p.displayName) + '"></label>' +
      '<label class="lab">Bio<textarea id="pb" rows="3" maxlength="120" placeholder="A line about you">' + esc(p.bio || "") + '</textarea></label>' +
      '<div class="lab">Avatar color<div class="swatches" id="sws">' + sw + '</div></div>' +
      '<div class="hint" id="ph" role="status"></div><button class="btn" type="submit">Save profile</button></form></div>';
    var pick = hue;
    $("sws").addEventListener("click", function (e) {
      var b = e.target.closest("[data-h]"); if (!b) return; pick = +b.getAttribute("data-h");
      Array.prototype.forEach.call($("sws").children, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      $("pav").innerHTML = av({ displayName: $("pn").value || p.username, hue: pick }, 72);
    });
    $("pf").addEventListener("submit", function (e) {
      e.preventDefault();
      var patch = { displayName: $("pn").value.trim() || p.username, bio: $("pb").value.trim(), hue: pick };
      api("PATCH", "/api/me", patch).then(function (r) {
        S.me = r.me; S.profiles[S.uid] = S.me; $("ph").textContent = "Saved."; renderList();
      }).catch(function (e) { $("ph").textContent = (e && e.msg) || "Could not save."; });
    });
  }

  function toggleRow(key, title, sub) {
    var on = S.me[key] !== false;
    return '<div class="row-t"><div class="t">' + title + '<small>' + sub + '</small></div><button class="switch" role="switch" data-act="tog" data-k="' + key + '" aria-checked="' + on + '" aria-label="' + title + '"></button></div>';
  }
  function renderPrivacy() {
    $("mp").innerHTML = subHead("Privacy") + '<div class="scroll"><div class="form" style="gap:4px">' +
      toggleRow("discoverable", "Appear in username search", "When off, people must type your exact username to find you.") +
      toggleRow("showLastSeen", "Show last seen", "Lets people see when you were last active.") +
      toggleRow("readReceipts", "Send read receipts", "Lets senders see when you have read their messages.") +
      '<p class="hint" style="padding-top:14px">These switches change what the app shows others. For how messages are stored, see Security and storage.</p></div></div>';
  }

  function renderBlocked() {
    var list = S.prefs.blocked, h = subHead("Blocked users") + '<div class="scroll"><div class="form">';
    h += list.length ? "" : '<p class="hint">You have not blocked anyone. Blocked people disappear from your chats and cannot be messaged from here.</p>';
    list.forEach(function (u) {
      var p = S.profiles[u] || { username: "Unknown user" };
      h += '<div class="row-t">' + av(p, 40) + '<div class="t"><b>' + esc(nameOf(p)) + '</b><small>@' + esc(p.username) + '</small></div><button class="btn alt sm" data-act="unblock" data-u="' + esc(u) + '">Unblock</button></div>';
    });
    $("mp").innerHTML = h + '</div></div>';
    list.forEach(function (u) { if (!S.profiles[u]) fetchProfile(u).then(function () { if (S.main && S.main.kind === "blocked") renderBlocked(); }); });
  }

  function renderSecurity() {
    $("mp").innerHTML = subHead("Security and storage") + '<div class="scroll"><div class="form">' +
      '<div class="note"><b>Messages are not end-to-end encrypted</b><p>Messages are stored on the Parley server as plain text, so whoever runs the server can read them. Do not use this prototype for anything sensitive.</p></div>' +
      '<div class="note"><b>What the server does today</b><p><b>Passwords</b> are stored as salted scrypt hashes, never in plain text. <b>Sessions</b> use random tokens that you can end by logging out.</p>' +
      '<p><b>Conversations</b> are only sent to the two people in them. The server checks this on every request.</p>' +
      '<p><b>In transit,</b> messages are protected by HTTPS when the server is hosted with it. Check that the address starts with https.</p>' +
      '<p><b>Block, last seen and read receipts</b> are enforced by the server. Blocking stops new messages from reaching you.</p></div>' +
      '<div class="note"><b>Not built yet</b><p>End-to-end encryption, password reset, account deletion and two-step login. None of these exist in this prototype.</p></div></div></div>';
  }

  /* ---------- events ---------- */
  function openMain(m) {
    S.main = m; S.armed = null; setView("main"); renderMain(); renderList();
    if (m.kind === "conv") { markSeen(m.uid); sendReceipts(); renderList(); }
  }
  function savePrefs() {
    return api("PATCH", "/api/me", { blocked: S.prefs.blocked }).then(function (r) { S.me.blocked = r.me.blocked; }).catch(function () {});
  }

  root.addEventListener("input", function (e) {
    if (e.target.id === "flt") { S.filter = e.target.value; renderList(); }
  });
  root.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]"); if (!el) return;
    var a = el.getAttribute("data-act");
    if (a === "retry") { boot(); return; }
    if (a === "authswitch") { S.phase = S.phase === "register" ? "login" : "register"; renderAuth(); return; }
    if (a === "tab") { S.tab = el.getAttribute("data-t"); renderList(); }
    else if (a === "new") openMain({ kind: "new" });
    else if (a === "open") { S.tab = "chats"; openMain({ kind: "conv", uid: el.getAttribute("data-u") }); }
    else if (a === "sub") openMain({ kind: el.getAttribute("data-k") });
    else if (a === "back") { S.main = null; setView("list"); renderMain(); renderList(); }
    else if (a === "logout") logout();
    else if (a === "del") {
      var id = el.getAttribute("data-id");
      if (S.armed !== id) { S.armed = id; renderThread(false); return; }
      S.armed = null; api("DELETE", "/api/messages/" + encodeURIComponent(id)).catch(function () {});
    }
    else if (a === "toggleblock") {
      var u = S.main.uid, i = S.prefs.blocked.indexOf(u);
      if (i >= 0) S.prefs.blocked.splice(i, 1); else S.prefs.blocked.push(u);
      savePrefs(); renderConvHead(); renderComposer(); renderList();
      if (isBlocked(u)) { S.main = null; setView("list"); renderMain(); }
    }
    else if (a === "unblock") {
      var uu = el.getAttribute("data-u"), j = S.prefs.blocked.indexOf(uu); if (j >= 0) S.prefs.blocked.splice(j, 1);
      savePrefs(); renderBlocked(); renderList();
    }
    else if (a === "tog") {
      var k = el.getAttribute("data-k"), v = !(S.me[k] !== false);
      S.me[k] = v; el.setAttribute("aria-checked", String(v));
      var patch = {}; patch[k] = v;
      api("PATCH", "/api/me", patch).catch(function () { S.me[k] = !v; el.setAttribute("aria-checked", String(!v)); });
    }
  });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && S.phase === "app") loadMessages(); });

  /* ---------- boot ---------- */
  function boot() {
    var t = ls("parley.token");
    if (!t) { S.phase = ls("parley.lastuser") ? "login" : "register"; renderAuth(); return; }
    S.token = t;
    api("GET", "/api/me").then(function (r) {
      S.me = r.me; S.uid = r.me.uid; enterApp();
    }).catch(function (e) {
      if (e && e.status === 0) { S.token = null; renderUnavailable(e.msg); return; }
      S.token = null; ls("parley.token", ""); S.phase = "login"; renderAuth();
    });
  }
  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
  boot();
})();
