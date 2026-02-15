/* app.js — shared */

function qs(sel){ return document.querySelector(sel); }
function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }

function setActiveNav(){
  const path = location.pathname.split("/").pop() || "Laka.html";
  qsa(".nav a").forEach(a => {
    const href = a.getAttribute("href");
    a.classList.toggle("active", href === path);
  });
}

function fmtDistance(mi){
  if (mi < 0.1) return "<0.1 mi";
  return `${mi.toFixed(1)} mi`;
}

/* --- Location sidebar --- */
async function initLocationBox(){
  const statusEl = qs("#locStatus");
  const btn = qs("#btnUseLocation");
  if (!btn || !statusEl) return;

  btn.addEventListener("click", () => {
    if (!navigator.geolocation){
      statusEl.textContent = "Geolocation not supported in this browser.";
      return;
    }
    statusEl.textContent = "Requesting location…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        localStorage.setItem("laka_user_loc", JSON.stringify({ latitude, longitude, t: Date.now() }));
        statusEl.textContent = `Location saved ✓ (${latitude.toFixed(3)}, ${longitude.toFixed(3)})`;
        window.dispatchEvent(new Event("laka:location"));
      },
      (err) => {
        statusEl.textContent = `Location blocked: ${err.message}`;
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  });

  const saved = localStorage.getItem("laka_user_loc");
  if (saved){
    try{
      const loc = JSON.parse(saved);
      statusEl.textContent = `Location saved ✓ (${loc.latitude.toFixed(3)}, ${loc.longitude.toFixed(3)})`;
    } catch {}
  }
}

/* --- Home Map (SF only) using Leaflet + localStorage posts --- */
let lakaMap, lakaLayer, userMarker;

function loadPosts(){
  try { return JSON.parse(localStorage.getItem("laka_posts") || "[]"); }
  catch { return []; }
}
function savePosts(posts){
  localStorage.setItem("laka_posts", JSON.stringify(posts));
}

function withinSFBounds(lat, lng){
  // Rough SF bounding box (keeps it SF-only for now)
  return lat >= 37.70 && lat <= 37.83 && lng >= -122.53 && lng <= -122.35;
}

function addPostToMap(post){
  if (!lakaMap || !lakaLayer) return;
  const m = L.marker([post.lat, post.lng]).addTo(lakaLayer);
  m.bindPopup(`<b>${post.title}</b><br/>${post.type} • ${post.when || "today"}<br/>${post.note || ""}`);
}

function renderPostsList(filterType){
  const ul = qs("#postsList");
  if (!ul) return;

  const posts = loadPosts()
    .filter(p => !filterType || filterType === "all" ? true : p.type === filterType)
    .slice().reverse();

  ul.innerHTML = "";
  if (posts.length === 0){
    ul.innerHTML = `<li class="item"><div class="title">No posts yet</div><div class="meta">Add one from the panel.</div></li>`;
    return;
  }

  for (const p of posts){
    const li = document.createElement("li");
    li.className = "item";
    li.innerHTML = `
      <div class="title">${escapeHtml(p.title)}</div>
      <div class="meta">${escapeHtml(p.type)} • ${escapeHtml(p.when || "today")} • (${p.lat.toFixed(3)}, ${p.lng.toFixed(3)})</div>
      ${p.note ? `<div class="meta">${escapeHtml(p.note)}</div>` : ""}
      <div class="tag">#${escapeHtml(p.type.toLowerCase())}</div>
    `;
    li.addEventListener("click", () => {
      if (lakaMap){
        lakaMap.setView([p.lat, p.lng], 14, { animate: true });
      }
    });
    ul.appendChild(li);
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

async function initHomeMap(){
  const mapEl = qs("#map");
  if (!mapEl) return; // only on home

  // SF center
  const SF = [37.7749, -122.4194];

  lakaMap = L.map("map", { zoomControl: true }).setView(SF, 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(lakaMap);

  lakaLayer = L.layerGroup().addTo(lakaMap);

  // initial pins
  const posts = loadPosts();
  posts.forEach(addPostToMap);

  // show user marker if location saved
  const saved = localStorage.getItem("laka_user_loc");
  if (saved){
    try{
      const loc = JSON.parse(saved);
      userMarker = L.circleMarker([loc.latitude, loc.longitude], {
        radius: 7, weight: 2, color: "#1b4a36", fillColor: "#3c8a66", fillOpacity: 0.4
      }).addTo(lakaMap).bindPopup("You are here");
    } catch {}
  }

  // Filters
  let activeType = "all";
  qsa("[data-filter]").forEach(btn => {
    btn.addEventListener("click", () => {
      activeType = btn.dataset.filter;
      qsa("[data-filter]").forEach(b => b.classList.remove("primary"));
      btn.classList.add("primary");
      // re-render markers
      lakaLayer.clearLayers();
      loadPosts().filter(p => activeType === "all" ? true : p.type === activeType).forEach(addPostToMap);
      renderPostsList(activeType);
    });
  });

  renderPostsList(activeType);

  // Add Post: click map to choose location OR use current map center
  const latInput = qs("#postLat");
  const lngInput = qs("#postLng");
  if (latInput && lngInput){
    lakaMap.on("click", (e) => {
      latInput.value = e.latlng.lat.toFixed(6);
      lngInput.value = e.latlng.lng.toFixed(6);
    });
  }

  const form = qs("#postForm");
  const msg = qs("#postMsg");
  if (form){
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (msg) msg.textContent = "";

      const title = qs("#postTitle").value.trim();
      const type = qs("#postType").value;
      const when = qs("#postWhen").value.trim();
      const note = qs("#postNote").value.trim();

      let lat = parseFloat(qs("#postLat").value);
      let lng = parseFloat(qs("#postLng").value);

      if (!title){
        if (msg) msg.textContent = "Title required.";
        return;
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lng)){
        // fallback to map center
        const c = lakaMap.getCenter();
        lat = c.lat; lng = c.lng;
      }
      if (!withinSFBounds(lat, lng)){
        if (msg) msg.textContent = "Keep pins inside San Francisco for now.";
        return;
      }

      const post = { id: crypto.randomUUID(), title, type, when, note, lat, lng, createdAt: Date.now() };
      const posts = loadPosts();
      posts.push(post);
      savePosts(posts);

      addPostToMap(post);
      renderPostsList(activeType);

      form.reset();
      if (msg) msg.textContent = "Posted ✓ (pin added to map)";
    });
  }

  // Update user marker when location saved
  window.addEventListener("laka:location", () => {
    const saved2 = localStorage.getItem("laka_user_loc");
    if (!saved2) return;
    try{
      const loc = JSON.parse(saved2);
      if (userMarker) lakaMap.removeLayer(userMarker);
      userMarker = L.circleMarker([loc.latitude, loc.longitude], {
        radius: 7, weight: 2, color: "#1b4a36", fillColor: "#3c8a66", fillOpacity: 0.4
      }).addTo(lakaMap).bindPopup("You are here");
      lakaMap.setView([loc.latitude, loc.longitude], 13, { animate: true });
    } catch {}
  });
}

/* boot */
document.addEventListener("DOMContentLoaded", () => {
  setActiveNav();
  initLocationBox();
  initHomeMap();
});
