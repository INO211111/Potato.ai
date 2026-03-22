/* ════════════════════════════════════════
   Potato.ai — app.js
   ════════════════════════════════════════ */

const API_URL        = "https://openrouter.ai/api/v1/chat/completions";
const API_KEY        = "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";
const MODEL_TRINITY  = "arcee-ai/trinity-mini:free";
const MODEL_NEMOTRON = "nvidia/nemotron-nano-12b-v2-vl:free";
const MODEL_STEP     = "stepfun/step-3.5-flash:free";
const MODEL_GLM      = "z-ai/glm-4.5-air:free";
const LARGE_CODE_LINES = 80;

const PLAN_CONFIG = {
  free: {
    maxProjects:  5,
    maxCredits:   100,
    refillMs:     60 * 60 * 1000, // 1 hour
    refillAmount: 50,
    models:       ["trinity"],
    canRedeemCodes: false,
  },
  beta: {
    maxProjects:  25,
    maxCredits:   250,
    refillMs:     30 * 60 * 1000, // 30 min
    refillAmount: 50,
    models:       ["trinity","step","nemotron","glm"],
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
  "release-free": 25,
  "free":         25,
  "pack":         25,
};

let currentAbortController = null;
let discordClickTimes = [];

/* ── PLAN ── */
let userPlan = localStorage.getItem("potato_plan") || "free";
function getPlan() { return PLAN_CONFIG[userPlan] || PLAN_CONFIG.free; }

function upgradeToBeta() {
  localStorage.setItem("potato_plan", "beta");
  userPlan = "beta";
  showToast("🎉 Beta Plan activated! Reloading…");
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

const SYSTEM_PROMPT = `You are an expert Roblox Studio developer. Every question is about Roblox Studio with Luau/Lua. Never ask what platform. Never say "In Roblox Studio". Just answer directly.
- Write complete working Luau code every time. Use task.wait(), task.spawn(), game:GetService(). Never use wait()/spawn()/delay().
- First line of every script: comment with type+location e.g. -- LocalScript | StarterPlayerScripts
- ALWAYS wrap ALL code in triple-backtick lua fences. Even 1-line snippets.
- LocalScripts=client (input,UI,camera). Scripts=server (logic,data). ModuleScripts=shared code.
- End every response with one short follow-up question matching what was built.`;

/* ════ INIT ════ */
document.addEventListener("DOMContentLoaded", () => {
  updateCreditsDisplay();
  renderSidebar();
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
  return s !== null ? parseFloat(s) : 50.0;
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
  if (credits <= 2) {
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
  document.getElementById("store-redeem-msg").textContent = "";
  document.getElementById("store-redeem-msg").className = "store-redeem-msg";
  updateCodeCardStates();

  // Show/hide upgrade button based on plan
  const upgradeBtn = document.getElementById("sp-beta-upgrade-btn");
  const betaBadge  = document.getElementById("sp-beta-current");
  const freeBadge  = document.getElementById("sp-free-current");

  if (userPlan === "beta") {
    if (upgradeBtn) { upgradeBtn.style.display = "none"; }
    if (betaBadge)  { betaBadge.style.display = "inline-block"; }
    if (freeBadge)  { freeBadge.style.display = "none"; }
    // disable redeem if free plan
    document.querySelectorAll(".cc-btn,.store-redeem-apply").forEach(b => b.disabled = false);
  } else {
    if (upgradeBtn) { upgradeBtn.style.display = "block"; }
    if (betaBadge)  { betaBadge.style.display = "none"; }
    if (freeBadge)  { freeBadge.style.display = "inline-block"; }
    // lock redeem on free plan
    document.querySelectorAll(".cc-btn,.store-redeem-apply").forEach(b => {
      b.disabled = true;
      if (b.classList.contains("cc-btn")) b.textContent = "Beta only";
    });
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
    // Update plan label
    const planLbl = document.getElementById("um-plan-label");
    if (planLbl) planLbl.textContent = userPlan === "beta" ? "Beta Plan 🥔" : "Free Plan";
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
  showToast("Opening Discord…");
}

/* ════ GLM LOCKED ════ */
function showGlmLocked() {
  if (userPlan === "beta") {
    // Beta users can use it — just select it
    currentModel = "glm"; updateModelUI(); closeModelDropdown(); saveCurrentMessages();
    showToast("GLM-4.5 Air active ✦");
  } else {
    closeModelDropdown();
    showToast("🔒 GLM-4.5 Air requires Beta Plan — get it free in Store!");
    setTimeout(() => openStore(), 800);
  }
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
    const del  = document.createElement("button"); del.className = "sidebar-item-delete"; del.title = "Delete"; del.textContent = "✕";
    del.onclick = e => { e.stopPropagation(); deleteProject(p.id); };
    item.appendChild(icon); item.appendChild(name); item.appendChild(del);
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
  messages.forEach((m,idx) => {
    if (m.role !== "assistant") return;
    const re = /```(?:lua|luau)?\n?([\s\S]*?)```/gi; let match;
    while ((match = re.exec(m.content)) !== null) {
      const code = match[1].trim();
      const firstLine = code.split("\n")[0]||"";
      const typeMatch = firstLine.match(/--\s*(.+)/);
      const label = typeMatch ? typeMatch[1].trim() : `Code block ${snippets.length+1}`;
      const isLocal = /localscript/i.test(label), isMod = /module/i.test(label);
      const typeTag = isMod?"ModuleScript":isLocal?"LocalScript":"Script";
      snippets.push({label,typeTag,code,msgIdx:idx});
    }
  });
  if (!snippets.length) {
    listEl.innerHTML = `<div style="padding:12px;font-size:11px;color:var(--text3)">No code blocks yet. Ask the AI to write a script first!</div>`;
  } else {
    snippets.forEach(s => {
      const item = document.createElement("div"); item.className = "tag-item";
      item.innerHTML = `
        <div class="tag-item-icon"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></div>
        <div class="tag-item-info">
          <div class="tag-item-name">${escapeHtml(s.typeTag)}</div>
          <div class="tag-item-path">…${escapeHtml(s.label.slice(0,52))}</div>
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
  document.getElementById("tagged-chip-label").textContent = s.typeTag+" · "+s.label.slice(0,30);
  closeTagPanel();
  const ta = document.getElementById("chat-textarea");
  ta.focus(); ta.placeholder = `Describe what to fix/add in "${s.typeTag}"…`;
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
  if(currentModel!=="nemotron"){ showToast("Switch to Nemotron VL to send images"); return; }
  const r=new FileReader();
  r.onload=ev=>{ const d=ev.target.result; pendingImage={base64:d.split(",")[1],dataUrl:d,mimeType:file.type||"image/png"};
    document.getElementById("img-preview-thumb").src=d; document.getElementById("image-preview-bar").style.display="flex";
    document.getElementById("img-upload-btn").classList.add("has-image"); };
  r.readAsDataURL(file);
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

  // Check if model is allowed on current plan
  const allowed = getPlan().models;
  if (!allowed.includes(id)) {
    closeModelDropdown();
    showToast(`🔒 ${id === "step" ? "Step 3.5 Flash" : "Nemotron Nano VL"} requires Beta Plan — get it free!`);
    setTimeout(() => openStore(), 800);
    return;
  }

  currentModel = id; updateModelUI(); closeModelDropdown(); saveCurrentMessages();
  const labels = { trinity:"Trinity Mini", nemotron:"Nemotron Nano VL", step:"Step 3.5 Flash" };
  showToast(labels[id] + " active" + (id === "nemotron" ? " · Images supported" : ""));
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

  ["trinity","step","nemotron"].forEach(id => {
    const chk = document.getElementById("check-"+id), opt = document.getElementById("opt-"+id);
    if (chk) chk.style.display = currentModel === id ? "block" : "none";
    if (opt) opt.classList.toggle("active", currentModel === id);
  });

  // Show/hide lock overlays for free plan
  const allowed = getPlan().models;
  ["step","nemotron","glm"].forEach(id => {
    const opt = document.getElementById("opt-"+id);
    if (!opt) return;
    if (!allowed.includes(id)) {
      opt.classList.add("model-option--locked");
    } else {
      if (id !== "glm") opt.classList.remove("model-option--locked");
    }
  });

  const imgBtn = document.getElementById("img-upload-btn");
  if (imgBtn) imgBtn.style.display = currentModel === "nemotron" ? "flex" : "none";
  if (currentModel !== "nemotron") removeImage();
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
        </div></div><pre class="code-block code-block--large" id="code_${id}">${highlightLuau(escapeHtml(raw))}</pre></div>`;
      } else {
        html+=`<div class="code-wrap"><div class="code-header"><span class="code-lang">Lua</span>
          <button class="copy-btn" id="${id}" onclick="copyCode('${id}')"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy</button>
        </div><pre class="code-block" id="code_${id}">${highlightLuau(escapeHtml(raw))}</pre></div>`;
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
function highlightLuau(c){
  return c.replace(/\b(local|function|end|if|then|else|elseif|for|do|while|repeat|until|return|break|and|or|not|true|false|nil|in|self)\b/g,'<span class="kw">$1</span>')
    .replace(/"([^"]*)"/g,'<span class="str">"$1"</span>').replace(/'([^']*)'/g,`<span class="str">'$1'</span>`)
    .replace(/\b(\d+\.?\d*)\b/g,'<span class="num">$1</span>').replace(/(--[^\n]*)/g,'<span class="cm">$1</span>');
}

function showTyping() {
  const area=document.getElementById("messages-area");
  const wrap=document.createElement("div");wrap.className="msg ai";wrap.id="typing-msg";
  const ava=document.createElement("div");ava.className="msg-avatar";ava.textContent="🥔";
  const bub=document.createElement("div");bub.className="msg-bubble";bub.innerHTML='<div class="typing-indicator"><span></span><span></span><span></span></div>';
  wrap.appendChild(ava);wrap.appendChild(bub);area.appendChild(wrap);area.scrollTop=area.scrollHeight;
}
function removeTyping(){const t=document.getElementById("typing-msg");if(t)t.remove();}

/* ════ CANCEL ════ */
function cancelAI() {
  if(currentAbortController){currentAbortController.abort();currentAbortController=null;}
  removeTyping(); isLoading=false;
  document.getElementById("send-btn").style.display="flex";
  document.getElementById("cancel-btn").style.display="none";
  document.getElementById("send-btn").disabled=false;
  showToast("Cancelled — no credits charged");
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

  const apiMessages=[
    {role:"user",content:SYSTEM_PROMPT},
    {role:"assistant",content:"Ready to help — tell me what to build."}
  ];
  messages.slice(-14).forEach(m=>{
    if(m.role==="user"){
      if(m.image&&currentModel==="nemotron"){
        apiMessages.push({role:"user",content:[{type:"image_url",image_url:{url:m.image}},{type:"text",text:m.content||"What's in this image?"}]});
      } else apiMessages.push({role:"user",content:m.content});
    } else if(m.role==="assistant") apiMessages.push({role:"assistant",content:m.content});
  });

  const modelMap={trinity:MODEL_TRINITY,nemotron:MODEL_NEMOTRON,step:MODEL_STEP,glm:MODEL_GLM};
  const model=modelMap[currentModel]||MODEL_TRINITY;
  const payload={model,max_tokens:1800,messages:apiMessages};
  if(currentModel==="nemotron"||currentModel==="step"||currentModel==="glm")payload.reasoning={enabled:true};

  const done=()=>{
    isLoading=false; currentAbortController=null;
    document.getElementById("send-btn").style.display="flex";
    document.getElementById("cancel-btn").style.display="none";
    document.getElementById("send-btn").disabled=false;
  };

  try {
    const res=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${getActiveApiKey()}`,"HTTP-Referer":location.href,"X-Title":"Potato.ai"},body:JSON.stringify(payload),signal:currentAbortController.signal});
    if(!res.ok){const err=await res.json().catch(()=>({}));removeTyping();appendMessage("ai",`⚠️ API error ${res.status}: ${err?.error?.message||"Please try again."}`);done();return;}
    const data=await res.json(); removeTyping();
    if(data.choices?.[0]){
      const reply=data.choices[0].message?.content||"";
      if(!reply.trim()){appendMessage("ai","⚠️ Empty response — no credits charged.");done();return;}
      messages.push({role:"assistant",content:reply}); appendMessage("ai",reply);
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

/* ════ TOAST ════ */
function showToast(msg){const t=document.getElementById("toast");t.textContent=msg;t.className="toast show";setTimeout(()=>{t.className="toast";},2500);}

/* ════ FLOAT CARDS ════ */
function animateFloatingCards(){
  const rots=[-3,2,3,2,-2,1];
  document.querySelectorAll(".fp").forEach((fp,i)=>{
    let t=i*1.4;const r=rots[i]||0;
    (function loop(){t+=0.012;fp.style.transform=`translateY(${Math.sin(t)*7}px) rotate(${r}deg)`;requestAnimationFrame(loop);})();
  });
}
