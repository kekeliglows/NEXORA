/**
 * NEXORA — GESTION DES STOCKS — js/core/stocks.js — Étape 6
 */
import { supabase } from "../config/supabase.js";

let currentUser = null, organizationId = null;
let products = [], movements = [];

const INCOMING = ["purchase","adjustment_in","return_in"];
const OUTGOING = ["sale","adjustment_out","return_out"];

const el = {
  tableBody:            document.getElementById("stocksTableBody"),
  totalProducts:        document.getElementById("totalProducts"),
  lowStockProducts:     document.getElementById("lowStockProducts"),
  emptyStockProducts:   document.getElementById("emptyStockProducts"),
  searchInput:          document.getElementById("searchInput"),
  stockFilter:          document.getElementById("stockFilter"),
  addMovementButton:    document.getElementById("addMovementButton"),
  feedback:             document.getElementById("feedback"),
  modal:                document.getElementById("movementModal"),
  closeModalButton:     document.getElementById("closeModalButton"),
  cancelMovementButton: document.getElementById("cancelMovementButton"),
  form:                 document.getElementById("movementForm"),
  saveMovementButton:   document.getElementById("saveMovementButton"),
  movementProduct:      document.getElementById("movementProduct"),
  movementType:         document.getElementById("movementType"),
  movementQuantity:     document.getElementById("movementQuantity"),
  movementReason:       document.getElementById("movementReason"),
  userName:             document.getElementById("userName"),
  userAvatar:           document.getElementById("userAvatar"),
  companyName:          document.getElementById("companyName"),
  logoutButton:         document.getElementById("logoutButton"),
};

/* -- INIT -- */
async function init() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!session?.user) { window.location.href = "../connexion.html"; return; }
    currentUser = session.user;
    renderUser();
    await loadOrganization();
    await loadProducts();
    populateProductSelect();
    setupEvents();
  } catch (err) {
    console.error("Init stocks :", err);
    showFeedback("Impossible de charger les stocks.", "error");
  }
}

/* -- USER -- */
function renderUser() {
  const meta = currentUser.user_metadata ?? {};
  const name = meta.full_name || meta.name || currentUser.email || "Utilisateur";
  if (el.userName)   el.userName.textContent   = name;
  if (el.userAvatar) el.userAvatar.textContent = String(name).trim().split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join("");
}

/* -- ORGANISATION -- */
async function loadOrganization() {
  const { data, error } = await supabase
    .from("organization_members").select("organization_id")
    .eq("user_id", currentUser.id).limit(1).maybeSingle();
  if (error) throw error;
  if (!data?.organization_id) throw new Error("Aucune organisation trouvée.");
  organizationId = data.organization_id;
  const { data: org } = await supabase.from("organizations").select("name").eq("id", organizationId).maybeSingle();
  if (el.companyName && org?.name) el.companyName.textContent = org.name;
}

/* -- CHARGEMENT PRODUITS (vue stock_levels avec fallback) -- */
async function loadProducts() {
  const { data, error } = await supabase
    .from("stock_levels")
    .select("product_id,product_name,sku,category,stock_min,is_active,current_stock,stock_status")
    .eq("organization_id", organizationId).eq("is_active", true)
    .order("product_name", { ascending: true });

  if (!error) {
    products = (data ?? []).map(r => ({
      id: r.product_id, name: r.product_name, sku: r.sku, category: r.category,
      stock_min: Number(r.stock_min)||0, is_active: r.is_active,
      current_stock: Number(r.current_stock)||0, stock_status: r.stock_status ?? "normal",
    }));
    renderTable(); return;
  }

  console.warn("Fallback stocks :", error.message);
  const { data: pd, error: pe } = await supabase
    .from("products").select("id,name,sku,category,stock_min,is_active")
    .eq("organization_id", organizationId).eq("is_active", true).order("name", { ascending: true });
  if (pe) throw pe;
  const raw = pd ?? [];
  if (!raw.length) { products = []; renderTable(); return; }
  const { data: mv } = await supabase
    .from("stock_movements").select("product_id,movement_type,quantity")
    .eq("organization_id", organizationId).in("product_id", raw.map(p=>p.id));
  movements = mv ?? [];
  const sm = new Map();
  for (const m of movements) {
    const prev = sm.get(m.product_id)??0, qty = Number(m.quantity)||0;
    if (INCOMING.includes(m.movement_type)) sm.set(m.product_id, prev+qty);
    if (OUTGOING.includes(m.movement_type)) sm.set(m.product_id, prev-qty);
  }
  products = raw.map(p => {
    const s = sm.get(p.id)??0, min = Number(p.stock_min)||0;
    return { ...p, current_stock: s, stock_status: s<=0?"empty":s<=min?"low":"normal" };
  });
  renderTable();
}

/* -- STATS -- */
function updateStats() {
  let low = 0, empty = 0;
  for (const p of products) {
    if (p.stock_status === "empty") empty++;
    else if (p.stock_status === "low") low++;
  }
  if (el.totalProducts)      el.totalProducts.textContent      = products.length;
  if (el.lowStockProducts)   el.lowStockProducts.textContent   = low;
  if (el.emptyStockProducts) el.emptyStockProducts.textContent = empty;
}

/* -- RENDU TABLEAU -- */
function renderTable() {
  updateStats();
  const search = (el.searchInput?.value ?? "").trim().toLowerCase();
  const filter = el.stockFilter?.value ?? "all";

  const filtered = products.filter(p =>
    (p.name.toLowerCase().includes(search) || (p.sku??"").toLowerCase().includes(search) || (p.category??"").toLowerCase().includes(search)) &&
    (filter === "all" || p.stock_status === filter)
  );

  if (!filtered.length) {
    el.tableBody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p class="empty-title">Aucun produit trouvé</p><p class="empty-desc">Modifiez les filtres ou ajoutez des produits.</p></div></td></tr>`;
    return;
  }

  el.tableBody.innerHTML = filtered.map(p => {
    const stock = Number(p.current_stock)||0, min = Number(p.stock_min)||0;
    const sc = p.stock_status==="empty"?"stock-empty":p.stock_status==="low"?"stock-low":"stock-normal";
    const badge = p.stock_status==="empty"
      ? `<span class="badge badge-empty">Épuisé</span>`
      : p.stock_status==="low"
        ? `<span class="badge badge-low">Stock faible</span>`
        : `<span class="badge badge-normal">Normal</span>`;
    return `<tr>
      <td><span class="product-name">${escapeHtml(p.name)}</span>${p.sku?`<span class="product-sku">${escapeHtml(p.sku)}</span>`:""}</td>
      <td>${escapeHtml(p.category||"—")}</td>
      <td><span class="${sc}">${formatNumber(stock)}</span></td>
      <td>${formatNumber(min)}</td>
      <td>${badge}</td>
      <td><button type="button" class="action-btn movement-btn" data-product-id="${p.id}">+ Mouvement</button></td>
    </tr>`;
  }).join("");
}

/* -- SELECT PRODUITS (modal) -- */
function populateProductSelect() {
  if (!el.movementProduct) return;
  el.movementProduct.innerHTML = `<option value="">Sélectionner un produit</option>`;
  for (const p of products) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.sku ? `${p.name} — ${p.sku}` : p.name;
    el.movementProduct.appendChild(opt);
  }
}

/* -- MODAL -- */
function openModal(productId = null) {
  el.form?.reset();
  if (el.movementType) el.movementType.value = "purchase";
  if (productId && el.movementProduct) el.movementProduct.value = productId;
  el.modal?.classList.add("open");
  el.modal?.setAttribute("aria-hidden","false");
  setTimeout(() => { (productId ? el.movementQuantity : el.movementProduct)?.focus(); }, 80);
}

function closeModal() {
  el.modal?.classList.remove("open");
  el.modal?.setAttribute("aria-hidden","true");
  el.form?.reset();
}

/* -- SAUVEGARDE MOUVEMENT -- */
async function saveMovement(event) {
  event.preventDefault();

  const productId = el.movementProduct?.value;
  const type      = el.movementType?.value;
  const quantity  = Number(el.movementQuantity?.value);
  const reason    = el.movementReason?.value.trim() || null;

  if (!productId) { showFeedback("Sélectionnez un produit.", "error"); return; }
  if (!type)      { showFeedback("Sélectionnez un type de mouvement.", "error"); return; }
  if (!quantity || quantity <= 0) { showFeedback("La quantité doit être supérieure à zéro.", "error"); return; }

  // Vérification stock suffisant pour les sorties
  if (OUTGOING.includes(type)) {
    const p = products.find(x => x.id === productId);
    if (p && quantity > p.current_stock) {
      showFeedback(`Stock insuffisant. Stock actuel : ${formatNumber(p.current_stock)}.`, "error");
      return;
    }
  }

  setSaving(true);
  try {
    const { error } = await supabase.from("stock_movements").insert({
      organization_id: organizationId,
      product_id:      productId,
      movement_type:   type,
      quantity:        quantity,
      reason:          reason,
      reference_type:  "manual",
      created_by:      currentUser.id,
    });
    if (error) throw error;
    showFeedback("Mouvement enregistré avec succès.", "success");
    closeModal();
    await loadProducts();
    populateProductSelect();
  } catch (err) {
    console.error("Mouvement stock :", err);
    showFeedback(err.message || "Impossible d'enregistrer le mouvement.", "error");
  } finally {
    setSaving(false);
  }
}

/* -- LOGOUT -- */
async function logout() {
  if (el.logoutButton) { el.logoutButton.disabled = true; el.logoutButton.textContent = "Déconnexion..."; }
  await supabase.auth.signOut();
  window.location.href = "../connexion.html";
}

/* -- ÉVÉNEMENTS -- */
function setupEvents() {
  el.addMovementButton?.addEventListener("click",  () => openModal());
  el.closeModalButton?.addEventListener("click",   closeModal);
  el.cancelMovementButton?.addEventListener("click", closeModal);
  el.form?.addEventListener("submit",              saveMovement);
  el.searchInput?.addEventListener("input",        renderTable);
  el.stockFilter?.addEventListener("change",       renderTable);
  el.logoutButton?.addEventListener("click",       logout);

  el.tableBody?.addEventListener("click", event => {
    const btn = event.target.closest(".movement-btn");
    if (btn) openModal(btn.dataset.productId);
  });

  el.modal?.addEventListener("click", event => { if (event.target === el.modal) closeModal(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && el.modal?.classList.contains("open")) closeModal(); });
}

/* -- UI -- */
function setSaving(v) {
  if (!el.saveMovementButton) return;
  el.saveMovementButton.disabled = v;
  el.saveMovementButton.textContent = v ? "Enregistrement..." : "Enregistrer";
}

function showFeedback(message, type) {
  if (!el.feedback) return;
  el.feedback.textContent = message;
  el.feedback.className = `feedback ${type}`;
  clearTimeout(showFeedback._t);
  showFeedback._t = setTimeout(() => { el.feedback.className = "feedback"; el.feedback.textContent = ""; }, 5000);
}

function formatNumber(v) { return new Intl.NumberFormat("fr-FR", { minimumFractionDigits:0, maximumFractionDigits:3 }).format(Number(v)||0); }
function escapeHtml(v)   { return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }

init();
