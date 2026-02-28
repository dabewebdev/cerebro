// Cerebro Journal — Phase 1
// Local-only, IndexedDB storage. No external network calls.

// --- Supabase setup (uses Vercel env vars during build) ---
// For static sites on Vercel, env vars are not automatically injected into plain JS.
// So we need to hardcode them OR use a small /config endpoint.
// Easiest for now: paste them directly here (publishable key only).

const SUPABASE_URL = "https://juhrigftrfukxyboiigb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_z6YA5Mo66F3vEu7CekvYNw_Dou6pGeR";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Auth UI
const elEmail = document.getElementById("email");
const btnSignIn = document.getElementById("btnSignIn");
const btnSignOut = document.getElementById("btnSignOut");
const authStatus = document.getElementById("authStatus");

async function refreshAuthUI() {
  const { data } = await supabase.auth.getSession();
  const session = data.session;

  if (session?.user) {
    authStatus.textContent = `Signed in`;
    btnSignOut.style.display = "";
    btnSignIn.style.display = "none";
    elEmail.style.display = "none";
  } else {
    authStatus.textContent = `Not signed in`;
    btnSignOut.style.display = "none";
    btnSignIn.style.display = "";
    elEmail.style.display = "";
  }
}

btnSignIn?.addEventListener("click", async () => {
  const email = elEmail.value.trim();
  if (!email) return alert("Enter your email first.");

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // IMPORTANT: set this to your deployed Vercel URL
      emailRedirectTo: "https://cerebro-nine-pearl.vercel.app"
    }
  });

  if (error) return alert(error.message);
  alert("Check your email for the login link.");
});

btnSignOut?.addEventListener("click", async () => {
  await supabase.auth.signOut();
  await refreshAuthUI();
});

supabase.auth.onAuthStateChange(() => {
  refreshAuthUI();
});

refreshAuthUI();



const DB_NAME = "cerebro_journal_db";
const DB_VERSION = 1;
const STORE = "events";

function $(id) { return document.getElementById(id); }

function toIsoMinuteLocal(date = new Date()) {
  // datetime-local expects "YYYY-MM-DDTHH:MM"
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function safeNumber(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function downloadFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- IndexedDB ----------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("by_dt", "dt", { unique: false });
        os.createIndex("by_type", "type", { unique: false });
        os.createIndex("by_intensity", "intensity", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(event) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(event);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Geolocation (optional) ----------
function getCoarseLocation() {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Coarse rounding ~ 1km+ depending on latitude
        const lat = Math.round(pos.coords.latitude * 100) / 100;
        const lon = Math.round(pos.coords.longitude * 100) / 100;
        resolve({ lat, lon, accuracy_m: Math.round(pos.coords.accuracy) });
      },
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 60_000 }
    );
  });
}

// ---------- Filtering + rendering ----------
function withinDateRange(dtStr, fromStr, toStr) {
  if (!fromStr && !toStr) return true;
  const t = new Date(dtStr).getTime();
  if (fromStr) {
    const f = new Date(fromStr + "T00:00").getTime();
    if (t < f) return false;
  }
  if (toStr) {
    const to = new Date(toStr + "T23:59:59").getTime();
    if (t > to) return false;
  }
  return true;
}

function matchesQuery(ev, q) {
  if (!q) return true;
  const hay = [
    ev.type,
    ev.emotion || "",
    ev.state || "",
    ev.notes || "",
  ].join(" ").toLowerCase();
  return hay.includes(q.toLowerCase());
}

function renderList(events) {
  const list = $("list");
  list.innerHTML = "";

  if (events.length === 0) {
    list.innerHTML = `<div class="tiny">No matching events.</div>`;
    return;
  }

  for (const ev of events) {
    const div = document.createElement("div");
    div.className = "item";

    const dt = new Date(ev.dt);
    const dtPretty = dt.toLocaleString();

    div.innerHTML = `
      <div class="top">
        <div>
          <span class="badge">${escapeHtml(ev.type)}</span>
          <span class="badge">Intensity ${ev.intensity}</span>
        </div>
        <button class="secondary" data-del="${ev.id}">Delete</button>
      </div>
      <div class="meta">
        <span>${dtPretty}</span>
        ${ev.emotion ? `<span>Emotion: ${escapeHtml(ev.emotion)}</span>` : ""}
        ${ev.sleep !== null ? `<span>Sleep: ${ev.sleep}/10</span>` : ""}
        ${ev.stress !== null ? `<span>Stress: ${ev.stress}/10</span>` : ""}
        ${ev.loc ? `<span>Loc: ${ev.loc.lat}, ${ev.loc.lon} (±${ev.loc.accuracy_m}m)</span>` : ""}
      </div>
      ${ev.state ? `<div class="meta">State: ${escapeHtml(ev.state)}</div>` : ""}
      ${ev.notes ? `<div class="notes">${escapeHtml(ev.notes)}</div>` : ""}
    `;

    list.appendChild(div);
  }

  // Delete handlers
  list.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      await dbDelete(id);
      await refreshUI();
    });
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function computeInsights(allEvents) {
  const total = allEvents.length;

  // last 7 days count
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const last7 = allEvents.filter(e => new Date(e.dt).getTime() >= sevenDaysAgo).length;

  // average intensity
  const avg = total === 0 ? 0 : (
    allEvents.reduce((sum, e) => sum + Number(e.intensity || 0), 0) / total
  );
  const avgRounded = Math.round(avg * 10) / 10;

  // by type counts
  const byType = {};
  for (const e of allEvents) byType[e.type] = (byType[e.type] || 0) + 1;

  // recent 5
  const recent = [...allEvents]
    .sort((a, b) => new Date(b.dt) - new Date(a.dt))
    .slice(0, 5);

  return { total, last7, avgRounded, byType, recent };
}

function renderInsights(allEvents) {
  const { total, last7, avgRounded, byType, recent } = computeInsights(allEvents);
  $("mTotal").textContent = String(total);
  $("m7").textContent = String(last7);
  $("mAvg").textContent = String(avgRounded);

  const bt = $("byType");
  bt.innerHTML = "";
  Object.entries(byType)
    .sort((a,b) => b[1] - a[1])
    .forEach(([k,v]) => {
      const row = document.createElement("div");
      row.className = "rowkv";
      row.innerHTML = `<span>${escapeHtml(k)}</span><strong>${v}</strong>`;
      bt.appendChild(row);
    });
  if (Object.keys(byType).length === 0) bt.innerHTML = `<div class="tiny">No data yet.</div>`;

  const r = $("recent");
  r.innerHTML = "";
  for (const e of recent) {
    const row = document.createElement("div");
    row.className = "rowkv";
    row.innerHTML = `<span>${escapeHtml(e.type)} • ${new Date(e.dt).toLocaleString()}</span><strong>${e.intensity}</strong>`;
    r.appendChild(row);
  }
  if (recent.length === 0) r.innerHTML = `<div class="tiny">No data yet.</div>`;
}

function applyFilters(allEvents) {
  const q = $("q").value.trim();
  const type = $("typeFilter").value;
  const minI = safeNumber($("minIntensity").value);
  const from = $("from").value;
  const to = $("to").value;

  return allEvents
    .filter(e => matchesQuery(e, q))
    .filter(e => !type || e.type === type)
    .filter(e => (minI === null ? true : Number(e.intensity) >= minI))
    .filter(e => withinDateRange(e.dt, from, to))
    .sort((a,b) => new Date(b.dt) - new Date(a.dt));
}

async function refreshUI() {
  const all = await dbGetAll();
  renderInsights(all);
  renderList(applyFilters(all));
}

// ---------- Export ----------
function toCsv(events) {
  const headers = [
    "id","dt","type","intensity","emotion","sleep","stress","state","notes","lat","lon","accuracy_m"
  ];
  const rows = [headers.join(",")];

  for (const e of events) {
    const lat = e.loc?.lat ?? "";
    const lon = e.loc?.lon ?? "";
    const acc = e.loc?.accuracy_m ?? "";
    const row = [
      e.id,
      e.dt,
      csvEscape(e.type),
      e.intensity,
      csvEscape(e.emotion ?? ""),
      e.sleep ?? "",
      e.stress ?? "",
      csvEscape(e.state ?? ""),
      csvEscape(e.notes ?? ""),
      lat,
      lon,
      acc
    ];
    rows.push(row.join(","));
  }
  return rows.join("\n");
}

function csvEscape(s) {
  const str = String(s);
  if (/[,"\n]/.test(str)) return `"${str.replaceAll('"', '""')}"`;
  return str;
}

// ---------- Main ----------
document.addEventListener("DOMContentLoaded", async () => {
  $("dt").value = toIsoMinuteLocal(new Date());

  $("eventForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const locEnabled = $("locEnabled").checked;
    const loc = locEnabled ? await getCoarseLocation() : null;

    const ev = {
      id: crypto.randomUUID(),
      dt: new Date($("dt").value).toISOString(),
      type: $("type").value,
      intensity: Number($("intensity").value),
      emotion: $("emotion").value || null,
      sleep: safeNumber($("sleep").value),
      stress: safeNumber($("stress").value),
      state: $("state").value.trim() || null,
      notes: $("notes").value.trim() || null,
      loc
    };

    await dbPut(ev);

    // reset minimal
    $("notes").value = "";
    $("state").value = "";
    $("emotion").value = "";
    $("sleep").value = "";
    $("stress").value = "";
    $("type").value = "";
    $("intensity").value = "5";
    $("dt").value = toIsoMinuteLocal(new Date());

    await refreshUI();
  });

  $("clearForm").addEventListener("click", () => {
    $("eventForm").reset();
    $("dt").value = toIsoMinuteLocal(new Date());
    $("intensity").value = "5";
  });

  ["q","typeFilter","minIntensity","from","to"].forEach(id => {
    $(id).addEventListener("input", refreshUI);
    $(id).addEventListener("change", refreshUI);
  });

  $("refresh").addEventListener("click", refreshUI);

  $("exportJson").addEventListener("click", async () => {
    const all = await dbGetAll();
    downloadFile(
      `cerebro-journal-${new Date().toISOString().slice(0,10)}.json`,
      JSON.stringify(all, null, 2),
      "application/json"
    );
  });

  $("exportCsv").addEventListener("click", async () => {
    const all = await dbGetAll();
    downloadFile(
      `cerebro-journal-${new Date().toISOString().slice(0,10)}.csv`,
      toCsv(all),
      "text/csv"
    );
  });

  await refreshUI();
});