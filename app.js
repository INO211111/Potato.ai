/* ════════════════════════════════════════
   Potato.ai — app.js
   ════════════════════════════════════════ */

const API_URL        = "https://openrouter.ai/api/v1/chat/completions";
const API_KEY        = "s4";
const MODEL_TRINITY  = "arcee-ai/trinity-mini:free";
const MODEL_NEMOTRON = "nvidia/nemotron-nano-12b-v2-vl:free";
const MODEL_STEP     = "stepfun/step-3.5-flash:free";
const MODEL_GLM      = "z-ai/glm-4.5-air:free";
const LARGE_CODE_LINES = 80;

const PLAN_CONFIG = {
  free: {
    maxProjects:    5,
    maxCredits:     25,
    refillMs:       60 * 60 * 1000, // 1 hour
    refillAmount:   2.5,
    startCredits:   10,
    models:         ["trinity", "nemotron", "glm"], // glm is free
    canRedeemCodes: false,
  },
  beta: {
    maxProjects:    25,
    maxCredits:     50,
    refillMs:       30 * 60 * 1000, // 30 min
    refillAmount:   2.5,
    startCredits:   10,
    models:         ["trinity","step","nemotron","glm"],
    canRedeemCodes: true,
  },
};

const CREDIT_RANGES = {
  trinity:  [0.025, 0.275],
  step:     [0.10,  0.75],
  nemotron: [0.05,  0.40],
  glm:      [0.025, 0.275],
};

const VALID_CODES = {
  "release-free": 5,
  "free":         5,
  "pack":         5,
  "promo10":      25,
};

let currentAbortController = null;
let discordClickTimes = [];

/* ── PLAN ── */
let userPlan = localStorage.getItem("potato_plan") || "free";
function getPlan() { return PLAN_CONFIG[userPlan] || PLAN_CONFIG.free; }

function upgradeToBeta() {
  if (userPlan === "beta") {
    showToast("🥔 You already have Beta Plan activated!");
    return;
  }
  localStorage.setItem("potato_plan", "beta");
  userPlan = "beta";
  showToast("🎉 Beta Plan activated! Reloading…");
  setTimeout(() => location.reload(), 1400);
}

function downgradeToFree() {
  if (userPlan === "free") { showToast("You're already on Free Plan."); return; }
  localStorage.setItem("potato_plan", "free");
  userPlan = "free";
  showToast("Switched to Free Plan. Reloading…");
  setTimeout(() => location.reload(), 1400);
}

/* ── STATE ── */
let credits         = loadCredits();
let messages        = [];
let isLoading       = false;
let currentModel    = "trinity";
let pendingImage    = null;
let projects        = loadProjects();
let activeProjectId = null;
let modelDropOpen   = false;
let taggedSection   = null;

const SYSTEM_PROMPT = `You are Potato.ai, a Roblox Studio scripting assistant. You ONLY help with Roblox game development using Luau and Lua. This is your ONLY purpose.

CRITICAL RULES — follow every single one, no exceptions:
- You are NOT a general assistant. NEVER say "I can help with anything" or generic phrases like "Feel free to ask me anything".
- NEVER use emojis like 😊 🌟 ✨ in responses.
- If someone says hi/hello, respond ONLY with something like: "Hey! What are we building today?" or "Hi! Got a Roblox script in mind?" — short, dev-focused, no fluff.
- NEVER ask "how can I assist you today?" — always steer toward Roblox scripting specifically.
- Write complete working Luau code every time. Use task.wait(), task.spawn(), game:GetService(). Never use wait()/spawn()/delay().
- ALWAYS write the FULL complete script. NEVER truncate, cut short, or add comments like "-- rest of code here" or "-- continues below". If the script is long, write every single line.
- NEVER stop mid-function or mid-script. Always close every function with "end" and finish the entire script.
- First line of every script: comment with type+location e.g. -- LocalScript | StarterPlayerScripts
- ALWAYS wrap ALL code in triple-backtick lua fences. Even 1-line snippets.
- LocalScripts=client (input,UI,camera). Scripts=server (logic,data). ModuleScripts=shared code.
- End every code response with one short relevant follow-up like "Want me to add a cooldown?" or "Need the server side too?".`;

/* ════ INIT ════ */
document.addEventListener("DOMContentLoaded", () => {
  updateCreditsDisplay();
  renderSidebar();
  renderArchives();
  animateFloatingCards();
  updateModelUI();
  startRefillTimer();

  document.addEventListener("click", e => {
    if (!document.getElementById("model-selector").contains(e.target)) closeModelDropdown();
    const mt = document.getElementById("mention-tooltip"), btn = document.getElementById("mention-btn");
    if (mt && btn && !mt.contains(e.target) && !btn.contains(e.target)) mt.classList.remove("show");
  });
});

/* ════ CREDITS ════ */
function loadCredits() {
  const s = localStorage.getItem("potato_credits");
  return s !== null ? parseFloat(s) : 10.0;
}
function saveCredits() { localStorage.setItem("potato_credits", credits.toFixed(2)); }

function deductCredit() {
  const [mn, mx] = CREDIT_RANGES[currentModel] || [0.025, 0.275];
  const cost = +(Math.random()*(mx-mn)+mn).toFixed(3);
  credits = Math.max(0, +(credits-cost).toFixed(3));
  saveCredits(); updateCreditsDisplay(); return cost;
}

function updateCreditsDisplay() {
  const val = credits.toFixed(2);
  document.getElementById("credits-display").textContent   = val;
  document.getElementById("credits-display-2").textContent = val;
  const cp = document.getElementById("cp-total"); if (cp) cp.textContent = val;
  // Update plan label in popup
  const planLbl = document.getElementById("cp-plan-label");
  if (planLbl) planLbl.textContent = userPlan === "beta" ? "Beta (Free 🎉)" : "Free";
  if (credits <= 1) {
    document.getElementById("credit-warning").style.display = "block";
    document.getElementById("cw-num").textContent = val;
  } else {
    document.getElementById("credit-warning").style.display = "none";
  }
}

function startRefillTimer() {
  const KEY = "potato_last_refill";
  let last = parseInt(localStorage.getItem(KEY) || "0", 10);
  if (!last) { last = Date.now(); localStorage.setItem(KEY, last); }

  function tick() {
    const plan = getPlan();
    const now = Date.now(), elapsed = now - last;
    const remaining = Math.max(0, plan.refillMs - elapsed);
    const pct = Math.min(1, elapsed / plan.refillMs);

    if (elapsed >= plan.refillMs) {
      credits = Math.min(plan.maxCredits, +(credits + plan.refillAmount).toFixed(2));
      last = Date.now(); localStorage.setItem(KEY, last);
      saveCredits(); updateCreditsDisplay();
    }
    const fill = document.getElementById("cp-refill-fill");
    const lbl  = document.getElementById("cp-refill-label");
    if (fill) fill.style.width = (pct*100).toFixed(1)+"%";
    if (lbl) {
      const mins = Math.floor(remaining/60000);
      const secs = Math.floor((remaining%60000)/1000);
      lbl.textContent = `Refills in ${mins}m ${secs}s`;
    }
  }
  tick(); setInterval(tick, 1000);
}

function showCreditsPopup() { document.getElementById("credits-popup").classList.add("show"); }
function hideCreditsPopup() { document.getElementById("credits-popup").classList.remove("show"); }

/* ════ REDEEM CODES ════ */
function getUsedCodes() {
  try { return JSON.parse(localStorage.getItem("potato_used_codes") || "[]"); } catch { return []; }
}
function markCodeUsed(code) {
  const used = getUsedCodes();
  used.push(code.toLowerCase());
  localStorage.setItem("potato_used_codes", JSON.stringify(used));
}

function redeemCode(raw) {
  if (userPlan !== "beta") return { ok: false, msg: "Redeem codes require Beta Plan." };
  const code = raw.trim().toLowerCase();
  if (!code) return { ok: false, msg: "Enter a code first." };
  const used = getUsedCodes();
  if (used.includes(code)) return { ok: false, msg: "Code already used." };
  const reward = VALID_CODES[code];
  if (reward === undefined) return { ok: false, msg: "Invalid code." };
  markCodeUsed(code);
  credits = Math.min(getPlan().maxCredits, +(credits + reward).toFixed(2));
  saveCredits(); updateCreditsDisplay();
  return { ok: true, msg: `+${reward} credits added! 🎉` };
}

/* ════ NO-CREDITS POPUP ════ */
function showNoCreditsPopup() {
  document.getElementById("nc-badge").textContent = credits.toFixed(2) + " credits remaining";
  document.getElementById("no-credits-overlay").classList.add("open");
}
function closeNoCredits(e) {
  if (e.target === document.getElementById("no-credits-overlay")) {
    document.getElementById("no-credits-overlay").classList.remove("open");
  }
}
function closeNoCreditsForce() {
  document.getElementById("no-credits-overlay").classList.remove("open");
}

/* ════ REDEEM MODAL ════ */
function openRedeemModal() {
  document.getElementById("redeem-overlay").classList.add("open");
  document.getElementById("redeem-input").value = "";
  document.getElementById("redeem-error").style.display = "none";
  document.querySelectorAll(".rbox").forEach(b => { b.value = ""; b.classList.remove("filled"); });
  setTimeout(() => {
    const first = document.querySelector(".rbox");
    if (first) first.focus();
  }, 80);
}
function closeRedeemModal() { document.getElementById("redeem-overlay").classList.remove("open"); }
function closeRedeemOutside(e) { if (e.target === document.getElementById("redeem-overlay")) closeRedeemModal(); }
function handleRedeemKey(e) { if (e.key === "Enter") submitRedeemCode(); if (e.key === "Escape") closeRedeemModal(); }

function submitRedeemCode() {
  // Try box inputs first
  const boxes    = document.querySelectorAll(".rbox");
  const boxValue = [...boxes].map(b => b.value).join("").trim();
  const textVal  = document.getElementById("redeem-input").value.trim();
  const code     = boxValue.length >= 4 ? boxValue : textVal;

  const res = redeemCode(code);
  const err = document.getElementById("redeem-error");
  if (res.ok) {
    closeRedeemModal();
    showToast(res.msg);
    // Clear boxes
    boxes.forEach(b => { b.value = ""; b.classList.remove("filled"); });
  } else {
    err.textContent = res.msg; err.style.display = "block";
  }
}

/* ════ STORE ════ */
function openStore() {
  document.getElementById("store-overlay").classList.add("open");
  document.getElementById("store-redeem-msg") && (document.getElementById("store-redeem-msg").textContent = "");

  const upgradeBtn = document.getElementById("sp-beta-upgrade-btn");
  const betaBadge  = document.getElementById("sp-beta-current");
  const freeBadge  = document.getElementById("sp-free-current");

  if (userPlan === "beta") {
    if (upgradeBtn) upgradeBtn.style.display = "none";
    if (betaBadge)  betaBadge.style.display  = "inline-block";
    if (freeBadge)  freeBadge.style.display  = "none";
  } else {
    if (upgradeBtn) upgradeBtn.style.display = "block";
    if (betaBadge)  betaBadge.style.display  = "none";
    if (freeBadge)  freeBadge.style.display  = "inline-block";
  }
}
function closeStore() { document.getElementById("store-overlay").classList.remove("open"); }
function closeStoreOutside(e) { if (e.target === document.getElementById("store-overlay")) closeStore(); }

function updateCodeCardStates() {
  const used = getUsedCodes();
  const map = { "Release-Free": "release-free", "FREE": "free", "pack": "pack" };
  document.querySelectorAll(".cc-btn").forEach(btn => {
    const card = btn.closest(".code-card");
    const name = card.querySelector(".cc-name").textContent;
    const key  = map[name];
    if (key && used.includes(key)) {
      btn.disabled = true; btn.textContent = "Used ✓";
    }
  });
}

function quickRedeem(code) {
  const res = redeemCode(code);
  const msgEl = document.getElementById("store-redeem-msg");
  if (res.ok) {
    msgEl.textContent = res.msg; msgEl.className = "store-redeem-msg ok";
    updateCodeCardStates();
  } else {
    msgEl.textContent = res.msg; msgEl.className = "store-redeem-msg err";
  }
}

function storeRedeemCode() {
  const val = document.getElementById("store-redeem-input").value;
  const res = redeemCode(val);
  const msgEl = document.getElementById("store-redeem-msg");
  msgEl.textContent = res.msg;
  msgEl.className = "store-redeem-msg " + (res.ok ? "ok" : "err");
  if (res.ok) { document.getElementById("store-redeem-input").value = ""; updateCodeCardStates(); }
}

/* ════ USER MENU ════ */
function toggleUserMenu() {
  const menu     = document.getElementById("user-menu");
  const backdrop = document.getElementById("user-menu-backdrop");
  const isOpen   = menu.classList.contains("open");
  if (isOpen) {
    menu.classList.remove("open"); backdrop.classList.remove("open");
  } else {
    const planLbl = document.getElementById("um-plan-label");
    if (planLbl) planLbl.textContent = userPlan === "beta" ? "Beta Plan 🥔" : "Free Plan";
    // Show downgrade button only on beta
    const downBtn = document.getElementById("um-downgrade-btn");
    if (downBtn) downBtn.style.display = userPlan === "beta" ? "flex" : "none";
    menu.classList.add("open"); backdrop.classList.add("open");
  }
}
function closeUserMenu() {
  document.getElementById("user-menu").classList.remove("open");
  document.getElementById("user-menu-backdrop").classList.remove("open");
}

/* ════ API KEY MODAL ════ */
function openApiKeyModal() {
  const stored = localStorage.getItem("potato_custom_apikey") || "";
  const input  = document.getElementById("apikey-input");
  input.value  = stored;
  input.type   = "password";
  const status = document.getElementById("ak-status");
  status.textContent = stored ? "✓ Custom key active — your credits won't be charged" : "";
  status.className   = stored ? "ak-status ok" : "ak-status";
  document.getElementById("apikey-overlay").classList.add("open");
  setTimeout(() => input.focus(), 80);
}
function closeApiKeyModal() { document.getElementById("apikey-overlay").classList.remove("open"); }
function closeApiKeyOutside(e) { if (e.target === document.getElementById("apikey-overlay")) closeApiKeyModal(); }
function handleApiKeyKeydown(e) { if (e.key === "Enter") saveApiKey(); if (e.key === "Escape") closeApiKeyModal(); }

function toggleApiKeyVis() {
  const input = document.getElementById("apikey-input");
  input.type  = input.type === "password" ? "text" : "password";
}

function saveApiKey() {
  const val    = document.getElementById("apikey-input").value.trim();
  const status = document.getElementById("ak-status");
  if (!val) { clearApiKey(); return; }
  if (!val.startsWith("sk-or-")) {
    status.textContent = "⚠️ Must be an OpenRouter key starting with sk-or-";
    status.className   = "ak-status err"; return;
  }
  localStorage.setItem("potato_custom_apikey", val);
  status.textContent = "✓ Key saved! AI will use your OpenRouter key.";
  status.className   = "ak-status ok";
  showToast("🔑 Custom API key saved");
}

function clearApiKey() {
  localStorage.removeItem("potato_custom_apikey");
  document.getElementById("apikey-input").value = "";
  const status = document.getElementById("ak-status");
  status.textContent = "Default key restored — credits apply normally.";
  status.className   = "ak-status ok";
  showToast("Default API key restored");
}

function getActiveApiKey() {
  return localStorage.getItem("potato_custom_apikey") || API_KEY;
}

/* ════ REDEEM BOX INPUTS ════ */
function rboxInput(e, idx) {
  const boxes = document.querySelectorAll(".rbox");
  const val   = e.target.value;
  if (val) {
    e.target.classList.add("filled");
    if (idx < boxes.length - 1) boxes[idx + 1].focus();
  } else {
    e.target.classList.remove("filled");
  }
}
function rboxKey(e, idx) {
  const boxes = document.querySelectorAll(".rbox");
  if (e.key === "Backspace" && !boxes[idx].value && idx > 0) {
    boxes[idx - 1].focus(); boxes[idx - 1].value = "";
    boxes[idx - 1].classList.remove("filled");
  }
  if (e.key === "Enter") submitRedeemCode();
  // Handle paste into first box
  if (e.key === "v" && (e.ctrlKey || e.metaKey)) return;
}

// Handle paste on boxes — fill all slots
document.addEventListener("paste", e => {
  const focused = document.querySelector(".rbox:focus");
  if (!focused) return;
  const text = (e.clipboardData || window.clipboardData).getData("text").replace(/[^a-zA-Z0-9]/g,"");
  if (!text) return;
  e.preventDefault();
  const boxes = document.querySelectorAll(".rbox");
  [...text.slice(0, 8)].forEach((ch, i) => {
    if (boxes[i]) { boxes[i].value = ch.toUpperCase(); boxes[i].classList.add("filled"); }
  });
  const next = boxes[Math.min(text.length, 7)]; if (next) next.focus();
});


function handleDiscordClick() {
  const now = Date.now();
  discordClickTimes = discordClickTimes.filter(t => now - t < 10000);
  discordClickTimes.push(now);
  if (discordClickTimes.length >= 8) {
    discordClickTimes = [];
    credits = 0.5; saveCredits(); updateCreditsDisplay();
    showToast("🧪 Test mode: credits → 0.50");
    return;
  }
  window.open("https://discord.gg/k7dRVsyCGg", "_blank");
}

/* ════ GLM ════ */
function showGlmLocked() {
  // GLM is free on all plans now — just select it
  currentModel = "glm"; updateModelUI(); closeModelDropdown(); saveCurrentMessages();
  showToast("GLM-4.5 Air active ✦");
}

/* ════ PROJECTS ════ */
function loadProjects() {
  try { return JSON.parse(localStorage.getItem("potato_projects") || "[]"); } catch { return []; }
}
function saveProjects() { localStorage.setItem("potato_projects", JSON.stringify(projects)); }

function renderSidebar() {
  const list = document.getElementById("sidebar-projects-list");
  list.innerHTML = "";
  [...projects].reverse().forEach(p => {
    const item = document.createElement("div");
    item.className = "sidebar-item" + (p.id === activeProjectId ? " active" : "");
    const icon = document.createElement("div"); icon.style.flexShrink = "0";
    icon.innerHTML = `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>`;
    const name = document.createElement("span"); name.className = "sidebar-item-name"; name.textContent = p.name;
    const arc  = document.createElement("button"); arc.className = "sidebar-item-archive"; arc.title = "Archive";
    arc.innerHTML = `<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`;
    arc.onclick = e => { e.stopPropagation(); archiveProject(p.id); };
    const del  = document.createElement("button"); del.className = "sidebar-item-delete"; del.title = "Delete"; del.textContent = "✕";
    del.onclick = e => { e.stopPropagation(); deleteProject(p.id); };
    item.appendChild(icon); item.appendChild(name); item.appendChild(arc); item.appendChild(del);
    item.onclick = () => openProject(p.id);
    list.appendChild(item);
  });
}

function deleteProject(id) {
  projects = projects.filter(p => p.id !== id); saveProjects();
  if (activeProjectId === id) showHome(); else renderSidebar();
}

/* ════ MODAL (create project) ════ */
function openModal() {
  const max = getPlan().maxProjects;
  if (projects.length >= max) { showToast(`Max ${max} projects on your plan — upgrade to Beta for 25!`); return; }
  document.getElementById("modal-overlay").classList.add("open");
  setTimeout(() => document.getElementById("modal-name-input").focus(), 80);
}
function closeModal() { document.getElementById("modal-overlay").classList.remove("open"); document.getElementById("modal-name-input").value = ""; }
function closeModalOutside(e) { if (e.target === document.getElementById("modal-overlay")) closeModal(); }
function handleModalKey(e) { if (e.key === "Enter") submitProject(); if (e.key === "Escape") closeModal(); }
function submitProject() {
  const max = getPlan().maxProjects;
  if (projects.length >= max) { showToast(`Max ${max} projects`); closeModal(); return; }
  const name = document.getElementById("modal-name-input").value.trim() || "My Project";
  const p = { id:"p_"+Date.now(), name, messages:[], model:"trinity", createdAt:Date.now() };
  projects.push(p); saveProjects(); closeModal(); openProject(p.id);
}

/* ════ PROJECT ════ */
function openProject(id) {
  const p = projects.find(x => x.id === id); if (!p) return;
  activeProjectId = id; messages = [...(p.messages||[])]; currentModel = p.model||"trinity";
  document.getElementById("home-view").style.display     = "none";
  document.getElementById("chat-view").style.display     = "flex";
  document.getElementById("project-title").style.display = "block";
  document.getElementById("project-title").textContent   = p.name;
  document.getElementById("chat-project-name").textContent = p.name;
  const area = document.getElementById("messages-area");
  area.innerHTML = ""; appendGreeting();
  messages.forEach(m => {
    if (m.role === "user") { if (m.image) appendUserMessageWithImage(m.content,m.image); else appendMessage("user",m.content); }
    else if (m.role === "assistant") appendMessage("ai",m.content);
  });
  updateModelUI(); renderSidebar();
}

function saveCurrentMessages() {
  if (!activeProjectId) return;
  const p = projects.find(x => x.id === activeProjectId); if (!p) return;
  p.messages = messages.map(m=>({...m})); p.model = currentModel; saveProjects();
}

/* ════ HOME ════ */
function showHome() {
  document.getElementById("home-view").style.display     = "flex";
  document.getElementById("chat-view").style.display     = "none";
  document.getElementById("project-title").style.display = "none";
  messages = []; activeProjectId = null; pendingImage = null; taggedSection = null;
  renderSidebar();
}

function startFromHome() {
  const val = document.getElementById("home-input").value.trim();
  if (!val) { document.getElementById("home-input").focus(); return; }
  const max = getPlan().maxProjects;
  if (projects.length >= max) { showToast(`Max ${max} projects on your plan`); return; }
  const p = { id:"p_"+Date.now(), name:val.slice(0,36), messages:[], model:"trinity", createdAt:Date.now() };
  projects.push(p); saveProjects(); openProject(p.id);
  setTimeout(()=>sendInitialMessage(val),50);
}
function handleHomeKey(e) { if (e.key==="Enter") startFromHome(); }

/* ════ CHAT INPUT ════ */
function handleChatKey(e) {
  if (e.key==="Enter"&&!e.shiftKey) { e.preventDefault(); sendMessage(); }
  if (e.key==="@") setTimeout(()=>openTagPanel(),10);
}
function autoResize(el) { el.style.height="auto"; el.style.height=Math.min(el.scrollHeight,140)+"px"; }

/* ════ TAG PANEL ════ */
function openTagPanel() {
  const panel    = document.getElementById("tag-panel");
  const listEl   = document.getElementById("tag-panel-list");
  const backdrop = document.getElementById("tag-panel-backdrop");
  listEl.innerHTML = "";
  const snippets = [];

  messages.forEach((m, idx) => {
    if (m.role !== "assistant") return;
    const re = /```(?:lua|luau)?\n?([\s\S]*?)```/gi; let match;
    while ((match = re.exec(m.content)) !== null) {
      const code      = match[1].trim();
      const lines     = code.split("\n");
      const firstLine = lines[0] || "";

      // Parse placement from first comment e.g. "-- LocalScript | StarterPlayerScripts"
      const commentMatch = firstLine.match(/^--\s*(.+)/);
      const commentText  = commentMatch ? commentMatch[1].trim() : "";

      // Split on | to get type and location
      const parts    = commentText.split("|").map(s => s.trim());
      const typeTag  = parts[0] || "Script";        // e.g. "LocalScript", "Script", "ModuleScript"
      const location = parts[1] || "";              // e.g. "StarterPlayerScripts", "ServerScriptService"

      // Build a short description from the next few non-empty comment lines or variable names
      let description = "";
      for (let i = 1; i < Math.min(lines.length, 6); i++) {
        const l = lines[i].trim();
        if (l.startsWith("--")) {
          const d = l.replace(/^--\s*/, "").trim();
          if (d && d.length > 2) { description = d; break; }
        }
      }
      // Fallback: find first meaningful local variable name
      if (!description) {
        const varMatch = code.match(/local\s+(\w+)\s*=/);
        if (varMatch) description = varMatch[1];
      }
      if (!description) description = `Code block ${snippets.length + 1}`;

      // Build display label: location takes priority over generic type name
      const displayType = location || typeTag;
      snippets.push({ label: commentText || `Code block ${snippets.length+1}`, typeTag, location, description, code, msgIdx: idx, displayType });
    }
  });

  if (!snippets.length) {
    listEl.innerHTML = `<div style="padding:12px;font-size:11px;color:var(--text3)">No code blocks yet. Ask the AI to write a script first!</div>`;
  } else {
    snippets.forEach((s, i) => {
      const item = document.createElement("div"); item.className = "tag-item";
      item.innerHTML = `
        <div class="tag-item-icon">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        </div>
        <div class="tag-item-info">
          <div class="tag-item-name">${escapeHtml(s.displayType)}</div>
          <div class="tag-item-path">${escapeHtml(s.description)}</div>
        </div>`;
      item.onclick = () => selectTaggedSection(s);
      listEl.appendChild(item);
    });
  }
  panel.classList.add("open"); backdrop.classList.add("open");
  document.getElementById("mention-tooltip").classList.remove("show");
}

function closeTagPanel() {
  document.getElementById("tag-panel").classList.remove("open");
  document.getElementById("tag-panel-backdrop").classList.remove("open");
}

function selectTaggedSection(s) {
  taggedSection = s;
  document.getElementById("tagged-section-bar").style.display = "block";
  // Show placement location + description in chip
  const chipLabel = s.location
    ? `${s.location} · ${s.description}`
    : `${s.typeTag} · ${s.description}`;
  document.getElementById("tagged-chip-label").textContent = chipLabel.slice(0, 45);
  closeTagPanel();
  const ta = document.getElementById("chat-textarea");
  ta.focus();
  ta.placeholder = `Describe what to fix/add in "${s.displayType}"…`;
}
function clearTaggedSection() {
  taggedSection = null;
  document.getElementById("tagged-section-bar").style.display = "none";
  document.getElementById("chat-textarea").placeholder = "Describe a script or game mechanic to build…";
}

/* ════ @ MENTION ════ */
function showMentionTooltip() { document.getElementById("mention-tooltip").classList.add("show"); }
function hideMentionTooltip() {
  setTimeout(()=>{ const tt=document.getElementById("mention-tooltip"); if(!tt.matches(":hover"))tt.classList.remove("show"); },120);
}
function insertMention() {
  const ta=document.getElementById("chat-textarea"),pos=ta.selectionStart,val=ta.value;
  if(val[pos-1]!=="@"){ ta.value=val.slice(0,pos)+"@"+val.slice(pos); ta.setSelectionRange(pos+1,pos+1); }
  ta.focus(); document.getElementById("mention-tooltip").classList.remove("show");
}

/* ════ IMAGE ════ */
function triggerFileInput() { document.getElementById("file-input").click(); }
function handleFileSelect(e) { const f=e.target.files[0]; if(f)processImageFile(f); e.target.value=""; }
function handlePaste(e) {
  const items=e.clipboardData?.items; if(!items)return;
  for(const item of items){ if(item.type.startsWith("image/")){ e.preventDefault(); processImageFile(item.getAsFile()); break; } }
}
function processImageFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const d = ev.target.result;
    pendingImage = { base64: d.split(",")[1], dataUrl: d, mimeType: file.type || "image/png" };
    document.getElementById("img-preview-thumb").src = d;
    document.getElementById("image-preview-bar").style.display = "flex";
    document.getElementById("img-upload-btn").style.display = "flex";
    document.getElementById("img-upload-btn").classList.add("has-image");
    if (currentModel !== "nemotron") {
      showToast("📸 Image attached — Nemotron will describe it then send to " + ({"trinity":"Trinity Mini","step":"Step Flash","glm":"GLM Air"}[currentModel]||"AI"));
    }
  };
  reader.readAsDataURL(file);
}
function removeImage() {
  pendingImage=null; document.getElementById("image-preview-bar").style.display="none";
  document.getElementById("img-preview-thumb").src=""; document.getElementById("img-upload-btn").classList.remove("has-image");
}

/* ════ MODEL ════ */
function toggleModelDropdown() { modelDropOpen?closeModelDropdown():openModelDropdown(); }
function openModelDropdown()   { modelDropOpen=true; document.getElementById("model-btn").classList.add("open"); document.getElementById("model-dropdown").classList.add("open"); }
function closeModelDropdown()  { modelDropOpen=false; document.getElementById("model-btn").classList.remove("open"); document.getElementById("model-dropdown").classList.remove("open"); }

function selectModel(id) {
  if (id === "glm") { showGlmLocked(); return; }

  // Step requires beta
  if (id === "step" && userPlan !== "beta") {
    closeModelDropdown();
    showToast("🔒 Step 3.5 Flash requires Beta Plan — get it free!");
    setTimeout(() => openStore(), 800);
    return;
  }

  // Nemotron allowed on all plans
  currentModel = id; updateModelUI(); closeModelDropdown(); saveCurrentMessages();
  const labels = { trinity:"Trinity Mini", nemotron:"Nemotron Nano VL", step:"Step 3.5 Flash", glm:"GLM-4.5 Air" };
  const extra  = id === "nemotron" ? " · Images supported" : "";
  showToast(labels[id] + " active" + extra);
  if (id !== "nemotron") removeImage();
}

function updateModelUI() {
  const labels = { trinity:"Trinity Mini", nemotron:"Nemotron Nano VL", step:"Step 3.5 Flash", glm:"GLM-4.5 Air" };
  document.getElementById("model-label").textContent = labels[currentModel] || "Trinity Mini";
  const dot = document.getElementById("model-dot-ind");
  dot.className = "model-dot-ind";
  if (currentModel === "nemotron") dot.classList.add("nvidia");
  if (currentModel === "step")     dot.classList.add("step");
  if (currentModel === "glm")      dot.classList.add("glm");

  ["trinity","step","nemotron","glm"].forEach(id => {
    const chk = document.getElementById("check-"+id);
    const opt = document.getElementById("opt-"+id);
    if (chk) chk.style.display = currentModel === id ? "block" : "none";
    if (opt) opt.classList.toggle("active", currentModel === id);
  });

  const isBeta = userPlan === "beta";

  // GLM: FREE on all plans — no lock ever
  const glmOpt        = document.getElementById("opt-glm");
  const glmLockBadge  = document.getElementById("glm-lock-badge");
  const glmHint       = document.getElementById("glm-locked-hint");
  if (glmOpt) {
    glmOpt.classList.remove("model-option--locked");
    if (glmLockBadge) glmLockBadge.style.display = "none";
    if (glmHint)      glmHint.style.display       = "none";
  }

  // Step: beta only — locked on free
  const stepOpt = document.getElementById("opt-step");
  if (stepOpt) stepOpt.classList.toggle("model-option--locked", !isBeta);

  // Nemotron: available on BOTH plans (free users can use it for image reading)
  const nemOpt = document.getElementById("opt-nemotron");
  if (nemOpt) nemOpt.classList.remove("model-option--locked");

  // Image btn always visible
  const imgBtn = document.getElementById("img-upload-btn");
  if (imgBtn) imgBtn.style.display = "flex";
}

/* ════ MESSAGES ════ */
function appendGreeting() {
  const area=document.getElementById("messages-area");
  const wrap=document.createElement("div"); wrap.className="msg ai";
  const ava=document.createElement("div"); ava.className="msg-avatar"; ava.textContent="🥔";
  const bub=document.createElement("div"); bub.className="msg-bubble";
  bub.textContent="Hello! How can I help you with Roblox Luau scripting today? Whether you need a script for a game mechanic, UI interaction, or performance optimization, just describe what you're working on and I'll provide a complete, well-commented solution.";
  wrap.appendChild(ava); wrap.appendChild(bub); area.appendChild(wrap);
}

function appendMessage(role,content) {
  const area=document.getElementById("messages-area");
  const wrap=document.createElement("div"); wrap.className=`msg ${role}`;
  const ava=document.createElement("div"); ava.className="msg-avatar"; ava.textContent=role==="user"?"U":"🥔";
  const bub=document.createElement("div"); bub.className="msg-bubble";
  bub.innerHTML=role==="ai"?formatAIMessage(content):escapeHtml(content).replace(/\n/g,"<br>");
  wrap.appendChild(ava); wrap.appendChild(bub);
  area.appendChild(wrap); area.scrollTop=area.scrollHeight;
}

function appendUserMessageWithImage(text,dataUrl) {
  const area=document.getElementById("messages-area");
  const wrap=document.createElement("div"); wrap.className="msg user";
  const ava=document.createElement("div"); ava.className="msg-avatar"; ava.textContent="U";
  const bub=document.createElement("div"); bub.className="msg-bubble";
  if(dataUrl){const img=document.createElement("img");img.src=dataUrl;img.className="msg-image";bub.appendChild(img);}
  if(text){const sp=document.createElement("span");sp.innerHTML=escapeHtml(text).replace(/\n/g,"<br>");bub.appendChild(sp);}
  wrap.appendChild(ava); wrap.appendChild(bub); area.appendChild(wrap); area.scrollTop=area.scrollHeight;
}

function countLines(s){return(s.match(/\n/g)||[]).length+1;}

function formatAIMessage(text) {
  const parts=text.split(/(```(?:lua|luau|plaintext)?\n?[\s\S]*?```)/gi); let html="";
  for(const part of parts){
    if(part.startsWith("```")){
      const raw=part.replace(/^```(?:lua|luau|plaintext)?\n?/i,"").replace(/```$/,"");
      const id="cb_"+Math.random().toString(36).slice(2,8);
      const isLarge=countLines(raw)>=LARGE_CODE_LINES; const enc=encodeURIComponent(raw);
      if(isLarge){
        const dlId="dl_"+id;
        html+=`<div class="code-wrap"><div class="code-header"><span class="code-lang">Lua · ${countLines(raw)} lines</span><div style="display:flex;gap:6px">
          <button class="copy-btn" id="${id}" onclick="copyCode('${id}')"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy</button>
          <button class="copy-btn dl-btn" id="${dlId}" onclick="downloadCode('${dlId}','${enc}')"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download .lua</button>
        </div></div><pre class="code-block code-block--large" id="code_${id}">${highlightLuau(raw)}</pre></div>`;
      } else {
        html+=`<div class="code-wrap"><div class="code-header"><span class="code-lang">Lua</span>
          <button class="copy-btn" id="${id}" onclick="copyCode('${id}')"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy</button>
        </div><pre class="code-block" id="code_${id}">${highlightLuau(raw)}</pre></div>`;
      }
    } else {
      const trimmed=part.trim(); if(!trimmed)continue;
      const safe=escapeHtml(part).replace(/\n/g,"<br>").replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/`([^`]+)`/g,`<code style="font-family:'DM Mono',monospace;font-size:11px;background:#0d0e0c;padding:1px 5px;border-radius:4px;color:var(--accent)">$1</code>`);
      html+=`<span>${safe}</span>`;
    }
  }
  return html;
}

function downloadCode(btnId,encoded) {
  const btn=document.getElementById(btnId); const code=decodeURIComponent(encoded);
  const blob=new Blob([code],{type:"text/plain"}); const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  const n=(code.split("\n")[0]||"").replace(/^--\s*/,"").replace(/[^a-zA-Z0-9_]/g,"_").slice(0,30)||"script";
  a.href=url; a.download=n+".lua"; a.click(); URL.revokeObjectURL(url);
  if(btn){const o=btn.innerHTML;btn.innerHTML=`<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Downloaded!`;setTimeout(()=>{btn.innerHTML=o;},2000);}
}

function copyCode(btnId) {
  const pre=document.getElementById("code_"+btnId),btn=document.getElementById(btnId);if(!pre)return;
  navigator.clipboard.writeText(pre.innerText).then(()=>{
    btn.classList.add("copied");
    btn.innerHTML=`<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
    setTimeout(()=>{btn.classList.remove("copied");btn.innerHTML=`<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy`;},2000);
  });
}

function escapeHtml(t){return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function highlightLuau(raw) {
  // Work on raw code (not HTML-escaped) so string/keyword detection is reliable.
  // We'll escape each token individually.
  const strPlaceholders = [];
  const cmPlaceholders  = [];

  let c = raw;

  // 1. Pull out string literals first (double and single quoted)
  c = c.replace(/"(?:[^"\\]|\\.)*"/g, m => {
    strPlaceholders.push(m); return `\x00STR${strPlaceholders.length-1}\x00`;
  });
  c = c.replace(/'(?:[^'\\]|\\.)*'/g, m => {
    strPlaceholders.push(m); return `\x00STR${strPlaceholders.length-1}\x00`;
  });

  // 2. Pull out comments
  c = c.replace(/--[^\n]*/g, m => {
    cmPlaceholders.push(m); return `\x00CM${cmPlaceholders.length-1}\x00`;
  });

  // 3. Escape remaining HTML chars (safe — no strings/comments left)
  c = c.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  // 4. Keywords
  c = c.replace(/\b(local|function|end|if|then|else|elseif|for|do|while|repeat|until|return|break|and|or|not|true|false|nil|in|self)\b/g,
    '<span class="kw">$1</span>');

  // 5. Numbers
  c = c.replace(/\b(\d+\.?\d*)\b/g, '<span class="num">$1</span>');

  // 6. Restore comments (HTML-escaped inside span)
  c = c.replace(/\x00CM(\d+)\x00/g, (_, i) => {
    const txt = cmPlaceholders[+i].replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    return `<span class="cm">${txt}</span>`;
  });

  // 7. Restore strings (HTML-escaped inside span)
  c = c.replace(/\x00STR(\d+)\x00/g, (_, i) => {
    const txt = strPlaceholders[+i].replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    return `<span class="str">${txt}</span>`;
  });

  return c;
}

/* ════ PLANNING PANEL ════ */
const PLAN_POOLS = {
  default: [
    { icon:"plan",  text:"Planning approach" },
    { icon:"read",  text:"Reading script context" },
    { icon:"think", text:"Structuring the solution" },
    { icon:"write", text:"Writing Luau code" },
    { icon:"check", text:"Validating script logic" },
  ],
  ui: [
    { icon:"plan",  text:"Planning UI layout" },
    { icon:"read",  text:"Reading StarterGui structure" },
    { icon:"write", text:"Building ScreenGui hierarchy" },
    { icon:"write", text:"Writing LocalScript for UI" },
    { icon:"check", text:"Verifying TweenService calls" },
  ],
  data: [
    { icon:"plan",  text:"Planning DataStore schema" },
    { icon:"read",  text:"Reading player data flow" },
    { icon:"write", text:"Writing DataStoreService calls" },
    { icon:"check", text:"Adding pcall error handling" },
  ],
  combat: [
    { icon:"plan",  text:"Planning combat system" },
    { icon:"read",  text:"Reading Humanoid properties" },
    { icon:"write", text:"Writing damage + hitbox logic" },
    { icon:"write", text:"Setting up RemoteEvents" },
    { icon:"check", text:"Checking server/client split" },
  ],
  sprint: [
    { icon:"plan",  text:"Planning sprint mechanic" },
    { icon:"read",  text:"Reading UserInputService docs" },
    { icon:"write", text:"Building stamina system" },
    { icon:"write", text:"Writing LocalScript + UI bar" },
    { icon:"check", text:"Testing input edge cases" },
  ],
};

function pickPlanSteps(prompt) {
  const p = prompt.toLowerCase();
  if (/gui|ui|frame|button|label|hud|screen/.test(p))  return PLAN_POOLS.ui;
  if (/datastore|data|save|load|coins|cash/.test(p))    return PLAN_POOLS.data;
  if (/damage|combat|kill|attack|sword|weapon/.test(p)) return PLAN_POOLS.combat;
  if (/sprint|run|stamina|speed/.test(p))               return PLAN_POOLS.sprint;
  return PLAN_POOLS.default;
}

function getLastUserPrompt() {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content || "";
  }
  return "";
}

let planningInterval = null;

function planIcon(type) {
  const icons = {
    plan:  `<svg class="plan-icon" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`,
    read:  `<svg class="plan-icon" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    think: `<svg class="plan-icon" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>`,
    write: `<svg class="plan-icon" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    check: `<svg class="plan-icon" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`,
  };
  return `<span class="plan-icon-wrap">${icons[type] || icons.check}</span>`;
}

function showTyping() {
  const area   = document.getElementById("messages-area");
  const prompt = getLastUserPrompt();
  const steps  = pickPlanSteps(prompt);

  const wrap = document.createElement("div");
  wrap.className = "msg ai"; wrap.id = "typing-msg";

  const ava = document.createElement("div");
  ava.className = "msg-avatar"; ava.textContent = "🥔";

  const bub = document.createElement("div");
  bub.className = "msg-bubble planning-bubble";

  const planList = document.createElement("div");
  planList.className = "plan-list";

  bub.appendChild(planList);
  wrap.appendChild(ava); wrap.appendChild(bub);
  area.appendChild(wrap);
  area.scrollTop = area.scrollHeight;

  let idx = 0;
  const addStep = () => {
    if (idx >= steps.length) return;
    const s    = steps[idx++];
    const item = document.createElement("div");
    item.className = "plan-item plan-item--active";
    item.innerHTML = `${planIcon(s.icon)}<span class="plan-text">${escapeHtml(s.text)}</span>`;
    planList.appendChild(item);
    const all = planList.querySelectorAll(".plan-item");
    if (all.length > 1) {
      all[all.length - 2].classList.remove("plan-item--active");
      all[all.length - 2].classList.add("plan-item--done");
    }
    area.scrollTop = area.scrollHeight;
  };

  addStep();
  planningInterval = setInterval(() => { if (idx < steps.length) addStep(); }, 900);
}

function removeTyping() {
  if (planningInterval) { clearInterval(planningInterval); planningInterval = null; }
  const t = document.getElementById("typing-msg");
  if (t) t.remove();
}

/* ════ CANCEL ════ */
function cancelAI() {
  if(currentAbortController){currentAbortController.abort();currentAbortController=null;}
  removeTyping(); isLoading=false;
  document.getElementById("send-btn").style.display="flex";
  document.getElementById("cancel-btn").style.display="none";
  document.getElementById("send-btn").disabled=false;
  // Restore last user message text to textarea
  const lastUser = [...messages].reverse().find(m => m.role === "user");
  if (lastUser && lastUser.content && lastUser.content !== "(image attached)") {
    const ta = document.getElementById("chat-textarea");
    ta.value = lastUser.content.replace(/^\[Focus on this section:.*?\n```lua[\s\S]*?```\n\n/,"");
    autoResize(ta);
    // Remove the message we just put back since it was never sent successfully
    messages.pop();
  }
  showToast("Cancelled — no credits charged");
}

/* ════ ARCHIVES ════ */
const MAX_ARCHIVES    = 8;
const ARCHIVE_TTL_MS  = 7 * 24 * 60 * 60 * 1000; // 7 days

function loadArchives() {
  try { return JSON.parse(localStorage.getItem("potato_archives") || "[]"); } catch { return []; }
}
function saveArchives(arr) { localStorage.setItem("potato_archives", JSON.stringify(arr)); }

function pruneExpiredArchives() {
  const now = Date.now();
  const arr = loadArchives().filter(a => now - a.archivedAt < ARCHIVE_TTL_MS);
  saveArchives(arr); return arr;
}

function archiveProject(id) {
  const archives = pruneExpiredArchives();
  if (archives.length >= MAX_ARCHIVES) {
    showToast(`Max ${MAX_ARCHIVES} archives — delete one first`); return;
  }
  const p = projects.find(x => x.id === id); if (!p) return;
  const archived = { ...p, archivedAt: Date.now(), expiresAt: Date.now() + ARCHIVE_TTL_MS };
  archives.push(archived);
  saveArchives(archives);
  deleteProject(id); // removes from projects + sidebar
  renderArchives();
  showToast(`"${p.name}" archived · auto-deletes in 7 days`);
}

function restoreArchive(id) {
  const archives = pruneExpiredArchives();
  const idx = archives.findIndex(a => a.id === id); if (idx === -1) return;
  const p = { ...archives[idx] };
  delete p.archivedAt; delete p.expiresAt;
  const max = getPlan().maxProjects;
  if (projects.length >= max) { showToast(`Max ${max} projects — delete one first`); return; }
  projects.push(p); saveProjects();
  archives.splice(idx, 1); saveArchives(archives);
  renderArchives(); renderSidebar();
  showToast(`"${p.name}" restored!`);
}

function deleteArchive(id) {
  const archives = pruneExpiredArchives().filter(a => a.id !== id);
  saveArchives(archives); renderArchives();
}

function renderArchives() {
  const archives = pruneExpiredArchives();
  const list  = document.getElementById("sidebar-archives-list");
  const count = document.getElementById("archive-count");
  if (!list) return;
  if (count) count.textContent = `${archives.length}/${MAX_ARCHIVES}`;
  list.innerHTML = "";
  if (archives.length === 0) {
    list.innerHTML = `<div style="font-size:10px;color:var(--text3);padding:4px 8px">No archives yet</div>`;
    return;
  }
  archives.forEach(a => {
    const daysLeft = Math.max(0, Math.ceil((a.expiresAt - Date.now()) / 86400000));
    const item = document.createElement("div");
    item.className = "sidebar-item archive-item";
    item.innerHTML = `
      <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink:0;opacity:.5"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
      <span class="sidebar-item-name" style="flex:1">${escapeHtml(a.name)}</span>
      <span class="archive-days">${daysLeft}d</span>
      <button class="archive-restore-btn" title="Restore" onclick="event.stopPropagation();restoreArchive('${a.id}')">↑</button>
      <button class="sidebar-item-delete" title="Delete" onclick="event.stopPropagation();deleteArchive('${a.id}')">✕</button>
    `;
    item.onclick = () => showToast(`Click ↑ to restore "${a.name}"`);
    list.appendChild(item);
  });
}

/* ════ API ════ */
async function sendInitialMessage(prompt) {
  if(credits<=0){showNoCreditsPopup();return;}
  messages.push({role:"user",content:prompt}); appendMessage("user",prompt); await callAI();
}

async function sendMessage() {
  if(isLoading)return;
  const ta=document.getElementById("chat-textarea"); let text=ta.value.trim();
  if(!text&&!pendingImage)return;
  if(credits<=0){showNoCreditsPopup();return;}
  ta.value=""; ta.style.height="auto";
  if(taggedSection){
    text=`[Focus on this section: "${taggedSection.label}"]\n\`\`\`lua\n${taggedSection.code.slice(0,800)}\n\`\`\`\n\n${text}`;
    clearTaggedSection();
  }
  const img=pendingImage?{...pendingImage}:null; removeImage();
  const msgRecord={role:"user",content:text||(img?"(image attached)":"")};
  if(img)msgRecord.image=img.dataUrl; messages.push(msgRecord);
  if(img)appendUserMessageWithImage(text,img.dataUrl);
  else   appendMessage("user",text.replace(/^\[Focus on this section:.*?\n```lua[\s\S]*?```\n\n/,""));
  await callAI();
}

async function callAI() {
  isLoading=true; currentAbortController=new AbortController();
  document.getElementById("send-btn").style.display="none";
  document.getElementById("cancel-btn").style.display="flex";
  showTyping();

  // Check if last user message has an image and current model isn't nemotron
  // If so: first call Nemotron to describe the image, then inject that into the real model call
  const lastMsg = messages[messages.length - 1];
  const hasImage = lastMsg?.image;
  const needsTwoStep = hasImage && currentModel !== "nemotron";

  let imageDescription = null;

  if (needsTwoStep) {
    // Step 1: Ask Nemotron to describe the image
    try {
      const visionPayload = {
        model: MODEL_NEMOTRON,
        max_tokens: 400,
        messages: [
          { role: "user", content: [
            { type: "image_url", image_url: { url: lastMsg.image } },
            { type: "text", text: "Describe what you see in this image in detail. Focus on any code, UI, game elements, or Roblox Studio content that would be relevant for a Luau/Lua developer." }
          ]}
        ]
      };
      const vRes = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type":"application/json", "Authorization":`Bearer ${getActiveApiKey()}`, "HTTP-Referer":"https://potato-ai.netlify.app", "X-Title":"Potato.ai" },
        body: JSON.stringify(visionPayload),
        signal: currentAbortController.signal
      });
      if (vRes.ok) {
        const vData = await vRes.json();
        imageDescription = vData.choices?.[0]?.message?.content || null;
      }
    } catch(e) {
      // If vision step fails, continue without it
    }
  }

  const apiMessages=[
    {role:"user",content:SYSTEM_PROMPT},
    {role:"assistant",content:"Ready to help — tell me what to build."}
  ];

  messages.slice(-14).forEach((m, i) => {
    if (m.role === "user") {
      const isLast = i === messages.slice(-14).length - 1;
      if (m.image) {
        if (currentModel === "nemotron") {
          // Nemotron can handle image directly
          apiMessages.push({role:"user",content:[
            {type:"image_url",image_url:{url:m.image}},
            {type:"text",text:m.content||"What's in this image? Help me with scripting related to it."}
          ]});
        } else if (isLast && imageDescription) {
          // Two-step: inject Nemotron's description as context
          apiMessages.push({role:"user",content:`[Image attached — Nemotron's vision description: "${imageDescription}"]\n\n${m.content||"Help me based on the image above."}`});
        } else {
          apiMessages.push({role:"user",content:m.content});
        }
      } else {
        apiMessages.push({role:"user",content:m.content});
      }
    } else if(m.role==="assistant") {
      apiMessages.push({role:"assistant",content:m.content});
    }
  });

  const modelMap={trinity:MODEL_TRINITY,nemotron:MODEL_NEMOTRON,step:MODEL_STEP,glm:MODEL_GLM};
  const model=modelMap[currentModel]||MODEL_TRINITY;
  const payload={model,max_tokens:8192,messages:apiMessages};
  if(currentModel==="nemotron"||currentModel==="step"||currentModel==="glm")payload.reasoning={enabled:true};

  const done=()=>{
    isLoading=false; currentAbortController=null;
    document.getElementById("send-btn").style.display="flex";
    document.getElementById("cancel-btn").style.display="none";
    document.getElementById("send-btn").disabled=false;
  };

  try {
    const res=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${getActiveApiKey()}`,"HTTP-Referer":"https://potato-ai.netlify.app","X-Title":"Potato.ai"},body:JSON.stringify(payload),signal:currentAbortController.signal});
    if(!res.ok){
      const err=await res.json().catch(()=>({}));
      const detail = err?.error?.message || err?.message || JSON.stringify(err);
      console.error("API error:", res.status, detail, err);
      removeTyping();
      appendMessage("ai",`⚠️ API error ${res.status}: ${detail}`);
      done();return;
    }
    const data=await res.json(); removeTyping();
    if(data.choices?.[0]){
      const reply=data.choices[0].message?.content||"";
      if(!reply.trim()){appendMessage("ai","⚠️ Empty response — no credits charged.");done();return;}
      messages.push({role:"assistant",content:reply}); appendMessage("ai",reply);
      // Show continue button if response contains code (might be incomplete)
      const hasCode = reply.includes("```");
      const fenceCount = (reply.match(/```/g)||[]).length;
      const looksIncomplete = fenceCount % 2 !== 0; // unclosed fence = definitely cut off
      if (hasCode) appendContinueButton(looksIncomplete);
      const cost=deductCredit(); saveCurrentMessages(); showToast(`−${cost.toFixed(3)} credits`);
    } else if(data.error){appendMessage("ai",`⚠️ ${data.error.message||"Unknown error."}`);}
    else {appendMessage("ai","⚠️ Unexpected response. Please try again.");}
  } catch(err) {
    removeTyping();
    if(err.name==="AbortError"){done();return;}
    appendMessage("ai",`⚠️ Request failed: ${err.message}`);
  }
  done();
}

/* ════ CONTINUE BUTTON ════ */
function appendContinueButton(looksIncomplete = false) {
  const existing = document.getElementById("continue-wrap");
  if (existing) existing.remove();

  const area = document.getElementById("messages-area");
  const wrap = document.createElement("div");
  wrap.className = "msg ai"; wrap.id = "continue-wrap";

  const ava = document.createElement("div"); ava.className = "msg-avatar"; ava.textContent = "🥔";

  const bub = document.createElement("div");
  bub.className = "msg-bubble continue-bubble";
  bub.innerHTML = looksIncomplete
    ? `<span class="continue-warning">⚠️ Code looks incomplete</span>
       <div class="continue-btns">
         <button class="continue-btn" onclick="continueGeneration()">▶ continueGeneration</button>
         <button class="continue-done-btn" onclick="dismissContinue()">✓ Already Done</button>
       </div>`
    : `<span class="continue-hint">Want the rest?</span>
       <div class="continue-btns">
         <button class="continue-btn" onclick="continueGeneration()">▶ continueGeneration</button>
         <button class="continue-done-btn" onclick="dismissContinue()">✓ Already Done</button>
       </div>`;

  wrap.appendChild(ava); wrap.appendChild(bub);
  area.appendChild(wrap); area.scrollTop = area.scrollHeight;
}

function dismissContinue() {
  const w = document.getElementById("continue-wrap");
  if (w) w.remove();
}

async function continueGeneration() {
  const continueWrap = document.getElementById("continue-wrap");
  if (continueWrap) continueWrap.remove();
  messages.push({ role:"user", content:"Continue — finish the script exactly from where it was cut off. Do NOT repeat any code already written. Start from the next line and complete the full script." });
  await callAI();
}
function showToast(msg){const t=document.getElementById("toast");t.textContent=msg;t.className="toast show";setTimeout(()=>{t.className="toast";},2500);}

/* ════ FLOAT CARDS ════ */
function animateFloatingCards(){
  const rots=[-3,2,3,2,-2,1];
  document.querySelectorAll(".fp").forEach((fp,i)=>{
    let t=i*1.4;const r=rots[i]||0;
    (function loop(){t+=0.012;fp.style.transform=`translateY(${Math.sin(t)*7}px) rotate(${r}deg)`;requestAnimationFrame(loop);})();
  });
}
