/**
 * NEXORA — GESTION DES PRODUITS — js/core/produits.js — Étape 6
 */
import { supabase } from "../config/supabase.js";

let currentUser = null, organizationId = null;
let products = [], editingProductId = null;

const el = {
  tableBody:            document.getElementById("productsTableBody"),
  searchInput:          document.getElementById("searchInput"),
  statusFilter:         document.getElementById("statusFilter"),
  addProductButton:     document.getElementById("addProductButton"),
  feedback:             document.getElementById("feedback"),
  modal:                document.getElementById("productModal"),
  modalTitle:           document.getElementById("modalTitle"),
  closeModalButton:     document.getElementById("closeModalButton"),
  cancelProductButton:  document.getElementById("cancelProductButton"),
  form:                 document.getElementById("productForm"),
  saveProductButton:    document.getElementById("saveProductButton"),
  productId:            document.getElementById("productId"),
  productName:          document.getElementById("productName"),
  productSku:           document.getElementById("productSku"),
  productCategory:      document.getElementById("productCategory"),
  productSalePrice:     document.getElementById("productSalePrice"),
  productPurchasePrice: document.getElementById("productPurchasePrice"),
  productStockMin:      document.getElementById("productStockMin"),
  productDescription:   document.getElementById("productDescription"),
  productInitialStock:  document.getElementById("productInitialStock"),
  initialStockGroup:    document.getElementById("initialStockGroup"),
};

async function init() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!session?.user) { window.location.href = "../connexion.html"; return; }
    currentUser = session.user;
    await loadOrganization();
    await loadProducts();
    setupEvents();
  } catch (err) {
    console.error("Init produits :", err);
    showFeedback("Impossible de charger les produits.", "error");
  }
}

async function loadOrganization() {
  const { data, error } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", currentUser.id)
    .limit(1).maybeSingle();
  if (error) throw error;
  if (!data?.organization_id) throw new Error("Aucune organisation trouvée.");
  organizationId = data.organization_id;
}

async function loadProducts() {
  const { data, error } = await supabase
    .from("stock_levels")
    .select("product_id,product_name,sku,category,sale_price,purchase_price,stock_min,is_active,current_stock,stock_status")
    .eq("organization_id", organizationId)
    .order("product_name", { ascending: true });

  if (!error) {
    products = (data ?? []).map(r => ({
      id: r.product_id, name: r.product_name, sku: r.sku,
      category: r.category, description: null,
      sale_price: Number(r.sale_price) || 0,
      purchase_price: Number(r.purchase_price) || 0,
      stock_min: Number(r.stock_min) || 0,
      is_active: r.is_active,
      current_stock: Number(r.current_stock) || 0,
      stock_status: r.stock_status ?? "normal",
    }));
    renderProducts(); return;
  }

  console.warn("Fallback produits :", error.message);
  const { data: pd, error: pe } = await supabase
    .from("products")
    .select("id,name,sku,category,description,unit_price,sale_price,purchase_price,stock_min,is_active")
    .eq("organization_id", organizationId).order("name", { ascending: true });
  if (pe) throw pe;
  const raw = pd ?? [];
  if (!raw.length) { products = []; renderProducts(); return; }
  const { data: mv } = await supabase
    .from("stock_movements")
    .select("product_id,movement_type,quantity")
    .eq("organization_id", organizationId)
    .in("product_id", raw.map(p => p.id));
  const sm = new Map();
  for (const m of mv ?? []) {
    const prev = sm.get(m.product_id) ?? 0, qty = Number(m.quantity) || 0;
    if (["purchase","adjustment_in","return_in"].includes(m.movement_type)) sm.set(m.product_id, prev + qty);
    if (["sale","adjustment_out","return_out"].includes(m.movement_type))   sm.set(m.product_id, prev - qty);
  }
  products = raw.map(p => {
    const sp = Number(p.sale_price ?? p.unit_price) || 0;
    const s  = sm.get(p.id) ?? 0, min = Number(p.stock_min) || 0;
    return { ...p, sale_price: sp, current_stock: s, stock_status: s <= 0 ? "empty" : s <= min ? "low" : "normal" };
  });
  renderProducts();
}

function renderProducts() {
  const search = (el.searchInput?.value ?? "").trim().toLowerCase();
  const status = el.statusFilter?.value ?? "all";
  const filtered = products.filter(p =>
    (p.name.toLowerCase().includes(search) || (p.sku ?? "").toLowerCase().includes(search) || (p.category ?? "").toLowerCase().includes(search)) &&
    (status === "all" || (status === "active" && p.is_active) || (status === "inactive" && !p.is_active))
  );
  if (!filtered.length) {
    el.tableBody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><p class="empty-title">Aucun produit trouvé</p><p class="empty-desc">Ajoutez votre premier produit ou modifiez les filtres.</p></div></td></tr>`;
    return;
  }
  el.tableBody.innerHTML = filtered.map(p => {
    const stock = Number(p.current_stock) || 0, min = Number(p.stock_min) || 0;
    const sc = p.stock_status === "empty" ? "stock-empty" : p.stock_status === "low" ? "stock-low" : "stock-normal";
    return `<tr>
      <td><span class="product-name">${escapeHtml(p.name)}</span>${p.sku ? `<span class="product-sku">${escapeHtml(p.sku)}</span>` : ""}</td>
      <td>${escapeHtml(p.category || "—")}</td>
      <td>${formatMoney(p.sale_price)}</td>
      <td>${formatMoney(p.purchase_price)}</td>
      <td><span class="${sc}">${formatNumber(stock)}</span></td>
      <td>${formatNumber(min)}</td>
      <td><span class="badge ${p.is_active ? "badge-active" : "badge-inactive"}">${p.is_active ? "Actif" : "Inactif"}</span></td>
      <td><div class="actions">
        <button type="button" class="action-btn" data-action="edit"   data-id="${p.id}" title="Modifier">✎</button>
        <button type="button" class="action-btn" data-action="toggle" data-id="${p.id}" title="${p.is_active ? "Désactiver" : "Activer"}">${p.is_active ? "✕" : "✓"}</button>
      </div></td>
    </tr>`;
  }).join("");
}

function openModal() { el.modal.classList.add("open"); el.modal.setAttribute("aria-hidden","false"); setTimeout(() => el.productName?.focus(), 60); }
function closeModal() { el.modal.classList.remove("open"); el.modal.setAttribute("aria-hidden","true"); editingProductId = null; }

function openCreateModal() {
  editingProductId = null;
  el.modalTitle.textContent = "Ajouter un produit";
  el.saveProductButton.textContent = "Enregistrer";
  el.form.reset();
  el.productId.value = ""; el.productSalePrice.value = "0"; el.productPurchasePrice.value = "0"; el.productStockMin.value = "0";
  // Stock initial : visible seulement à la création
  if (el.productInitialStock) el.productInitialStock.value = "0";
  if (el.initialStockGroup)   el.initialStockGroup.style.display = "";
  openModal();
}

function openEditModal(p) {
  editingProductId = p.id;
  el.modalTitle.textContent = "Modifier le produit";
  el.saveProductButton.textContent = "Enregistrer les modifications";
  // Masquer le champ stock initial en édition (utiliser le module Stocks)
  if (el.initialStockGroup) el.initialStockGroup.style.display = "none";
  el.productId.value = p.id; el.productName.value = p.name ?? ""; el.productSku.value = p.sku ?? "";
  el.productCategory.value = p.category ?? ""; el.productSalePrice.value = p.sale_price ?? 0;
  el.productPurchasePrice.value = p.purchase_price ?? 0; el.productStockMin.value = p.stock_min ?? 0;
  el.productDescription.value = p.description ?? "";
  openModal();
}

function setSaving(v) {
  el.saveProductButton.disabled = v;
  el.saveProductButton.textContent = v ? "Enregistrement..." : (editingProductId ? "Enregistrer les modifications" : "Enregistrer");
}

async function saveProduct(event) {
  event.preventDefault();
  const name = el.productName.value.trim();
  const sku = el.productSku.value.trim() || null;
  const category = el.productCategory.value.trim() || null;
  const description = el.productDescription.value.trim() || null;
  const salePrice = Number(el.productSalePrice.value);
  const purchasePrice = Number(el.productPurchasePrice.value);
  const stockMin = Number(el.productStockMin.value);

  if (!name) { showFeedback("Le nom du produit est obligatoire.", "error"); return; }
  if (!Number.isFinite(salePrice) || salePrice < 0 || !Number.isFinite(purchasePrice) || purchasePrice < 0 || !Number.isFinite(stockMin) || stockMin < 0) {
    showFeedback("Vérifiez les valeurs numériques.", "error"); return;
  }

  setSaving(true);
  try {
    const payload = { name, sku, category, description, unit_price: salePrice, sale_price: salePrice, purchase_price: purchasePrice, stock_min: stockMin };

    if (editingProductId) {
      const { error } = await supabase.from("products").update(payload).eq("id", editingProductId).eq("organization_id", organizationId);
      if (error) throw error;
      showFeedback("Produit modifié avec succès.", "success");
    } else {
      const { data: newProduct, error } = await supabase
        .from("products")
        .insert({ ...payload, organization_id: organizationId, created_by: currentUser.id })
        .select("id")
        .single();

      if (error) {
        if (error.code === "23505") throw new Error("Cette référence SKU existe déjà dans votre organisation.");
        throw error;
      }

      // Créer un mouvement de stock initial si quantité > 0
      const initialStock = Number(el.productInitialStock?.value) || 0;
      if (initialStock > 0 && newProduct?.id) {
        const { error: mvError } = await supabase.from("stock_movements").insert({
          organization_id: organizationId,
          product_id:      newProduct.id,
          movement_type:   "adjustment_in",
          quantity:        initialStock,
          reason:          "Stock initial à la création du produit",
          reference_type:  "manual",
          created_by:      currentUser.id,
        });
        if (mvError) {
          console.warn("Mouvement stock initial non créé :", mvError.message);
        }
      }

      showFeedback("Produit ajouté avec succès.", "success");
    }

    closeModal();
    await loadProducts();
  } catch (err) {
    console.error("Sauvegarde produit :", err);
    showFeedback(err.message || "Impossible d'enregistrer le produit.", "error");
  } finally {
    setSaving(false);
  }
}

async function toggleProduct(productId) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  if (!window.confirm(`Voulez-vous vraiment ${p.is_active ? "désactiver" : "activer"} « ${p.name} » ?`)) return;
  try {
    const { error } = await supabase.from("products").update({ is_active: !p.is_active }).eq("id", p.id).eq("organization_id", organizationId);
    if (error) throw error;
    showFeedback(p.is_active ? "Produit désactivé." : "Produit activé.", "success");
    await loadProducts();
  } catch (err) {
    console.error("Toggle produit :", err);
    showFeedback("Impossible de modifier le statut.", "error");
  }
}

function setupEvents() {
  el.addProductButton?.addEventListener("click", openCreateModal);
  el.closeModalButton?.addEventListener("click", closeModal);
  el.cancelProductButton?.addEventListener("click", closeModal);
  el.form?.addEventListener("submit", saveProduct);
  el.searchInput?.addEventListener("input", renderProducts);
  el.statusFilter?.addEventListener("change", renderProducts);

  el.tableBody?.addEventListener("click", event => {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    const p = products.find(x => x.id === btn.dataset.id);
    if (!p) return;
    if (btn.dataset.action === "edit")   openEditModal(p);
    if (btn.dataset.action === "toggle") toggleProduct(p.id);
  });

  el.modal?.addEventListener("click", event => { if (event.target === el.modal) closeModal(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && el.modal?.classList.contains("open")) closeModal(); });
}

function showFeedback(message, type) {
  if (!el.feedback) return;
  el.feedback.textContent = message;
  el.feedback.className = `feedback ${type}`;
  clearTimeout(showFeedback._t);
  showFeedback._t = setTimeout(() => { el.feedback.className = "feedback"; el.feedback.textContent = ""; }, 4500);
}

function formatMoney(value) { return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value) || 0); }
function formatNumber(value) { return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 3 }).format(Number(value) || 0); }
function escapeHtml(v) { return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }

init();
