/**
 * NEXORA — GESTION DES CLIENTS — js/core/clients.js — Étape 7
 * Table : public.customers
 */
import { supabase } from "../config/supabase.js";

let currentUser = null, organizationId = null;
let customers = [], editingId = null;

const el = {
  tableBody:       document.getElementById("customersTableBody"),
  searchInput:     document.getElementById("searchInput"),
  statusFilter:    document.getElementById("statusFilter"),
  categoryFilter:  document.getElementById("categoryFilter"),
  addButton:       document.getElementById("addCustomerButton"),
  totalCount:      document.getElementById("totalCustomers"),
  activeCount:     document.getElementById("activeCustomers"),
  feedback:        document.getElementById("feedback"),
  modal:           document.getElementById("customerModal"),
  modalTitle:      document.getElementById("modalTitle"),
  closeModal:      document.getElementById("closeModalButton"),
  cancelButton:    document.getElementById("cancelButton"),
  form:            document.getElementById("customerForm"),
  saveButton:      document.getElementById("saveButton"),
  // Champs
  customerId:      document.getElementById("customerId"),
  customerName:    document.getElementById("customerName"),
  customerEmail:   document.getElementById("customerEmail"),
  customerPhone:   document.getElementById("customerPhone"),
  customerAddress: document.getElementById("customerAddress"),
  customerCity:    document.getElementById("customerCity"),
  customerCountry: document.getElementById("customerCountry"),
  customerCategory:document.getElementById("customerCategory"),
  customerTax:     document.getElementById("customerTax"),
  customerNotes:   document.getElementById("customerNotes"),
  // Sidebar
  userName:        document.getElementById("userName"),
  userAvatar:      document.getElementById("userAvatar"),
  companyName:     document.getElementById("companyName"),
  logoutButton:    document.getElementById("logoutButton"),
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
    await loadCustomers();
    setupEvents();
  } catch (err) {
    console.error("Init clients :", err);
    showFeedback("Impossible de charger les clients.", "error");
  }
}

/* -- USER -- */
function renderUser() {
  const meta = currentUser.user_metadata ?? {};
  const name = meta.full_name || meta.name || currentUser.email || "Utilisateur";
  if (el.userName)   el.userName.textContent   = name;
  if (el.userAvatar) el.userAvatar.textContent = initials(name);
}

function initials(name) {
  return String(name).trim().split(/\s+/).filter(Boolean)
    .slice(0, 2).map(w => w[0].toUpperCase()).join("");
}

/* -- ORGANISATION -- */
async function loadOrganization() {
  const { data, error } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", currentUser.id)
    .limit(1).maybeSingle();
  if (error) throw error;
  if (!data?.organization_id) throw new Error("Aucune organisation trouvée.");
  organizationId = data.organization_id;
  const { data: org } = await supabase
    .from("organizations").select("name").eq("id", organizationId).maybeSingle();
  if (el.companyName && org?.name) el.companyName.textContent = org.name;
}

/* -- CHARGEMENT -- */
async function loadCustomers() {
  const { data, error } = await supabase
    .from("customers")
    .select("id,name,email,phone,address,city,country,category,tax_number,notes,is_active,created_at")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });
  if (error) throw error;
  customers = data ?? [];
  updateStats();
  populateCategoryFilter();
  renderTable();
}

/* -- STATS -- */
function updateStats() {
  const active = customers.filter(c => c.is_active).length;
  const cats   = new Set(customers.map(c => c.category).filter(Boolean)).size;
  if (el.totalCount)      el.totalCount.textContent  = customers.length;
  if (el.activeCount)     el.activeCount.textContent = active;
  const totalCatsEl = document.getElementById("totalCategories");
  if (totalCatsEl) totalCatsEl.textContent = cats;
}

/* -- FILTRE CATÉGORIES -- */
function populateCategoryFilter() {
  if (!el.categoryFilter) return;
  const current = el.categoryFilter.value;
  const cats = [...new Set(customers.map(c => c.category).filter(Boolean))].sort();
  el.categoryFilter.innerHTML = `<option value="all">Toutes catégories</option>` +
    cats.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join("");
  if (current && cats.includes(current)) el.categoryFilter.value = current;
}

/* -- RENDU -- */
function renderTable() {
  const search   = (el.searchInput?.value ?? "").trim().toLowerCase();
  const status   = el.statusFilter?.value ?? "all";
  const category = el.categoryFilter?.value ?? "all";

  const filtered = customers.filter(c => {
    const ms = c.name.toLowerCase().includes(search) ||
               (c.email   ?? "").toLowerCase().includes(search) ||
               (c.phone   ?? "").toLowerCase().includes(search) ||
               (c.city    ?? "").toLowerCase().includes(search);
    const mv = status   === "all" || (status   === "active" && c.is_active) || (status   === "inactive" && !c.is_active);
    const mc = category === "all" || c.category === category;
    return ms && mv && mc;
  });

  if (!filtered.length) {
    el.tableBody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><p class="empty-title">Aucun client trouvé</p><p class="empty-desc">Ajoutez votre premier client ou modifiez les filtres.</p></div></td></tr>`;
    return;
  }

  el.tableBody.innerHTML = filtered.map(c => `
    <tr>
      <td>
        <span class="item-name">${escHtml(c.name)}</span>
        ${c.category ? `<span class="item-meta">${escHtml(c.category)}</span>` : ""}
      </td>
      <td>${c.email ? `<a href="mailto:${escHtml(c.email)}" class="link">${escHtml(c.email)}</a>` : "—"}</td>
      <td>${escHtml(c.phone || "—")}</td>
      <td>${escHtml([c.city, c.country].filter(Boolean).join(", ") || "—")}</td>
      <td><span class="badge ${c.is_active ? "badge-active" : "badge-inactive"}">${c.is_active ? "Actif" : "Inactif"}</span></td>
      <td>${formatDate(c.created_at)}</td>
      <td>
        <div class="actions">
          <button type="button" class="action-btn" data-action="edit"   data-id="${c.id}" title="Modifier">✎</button>
          <button type="button" class="action-btn" data-action="toggle" data-id="${c.id}" title="${c.is_active ? "Désactiver" : "Activer"}">${c.is_active ? "✕" : "✓"}</button>
        </div>
      </td>
    </tr>`).join("");
}

/* -- MODAL -- */
function openModal() {
  el.modal?.classList.add("open");
  el.modal?.setAttribute("aria-hidden", "false");
  setTimeout(() => el.customerName?.focus(), 60);
}

function closeModalFn() {
  el.modal?.classList.remove("open");
  el.modal?.setAttribute("aria-hidden", "true");
  editingId = null;
}

function openCreate() {
  editingId = null;
  el.modalTitle.textContent = "Ajouter un client";
  el.saveButton.textContent = "Enregistrer";
  el.form.reset();
  el.customerId.value = "";
  openModal();
}

function openEdit(c) {
  editingId = c.id;
  el.modalTitle.textContent = "Modifier le client";
  el.saveButton.textContent = "Enregistrer les modifications";
  el.customerId.value     = c.id;
  el.customerName.value   = c.name         ?? "";
  el.customerEmail.value  = c.email        ?? "";
  el.customerPhone.value  = c.phone        ?? "";
  el.customerAddress.value= c.address      ?? "";
  el.customerCity.value   = c.city         ?? "";
  el.customerCountry.value= c.country      ?? "";
  el.customerCategory.value=c.category     ?? "";
  el.customerTax.value    = c.tax_number   ?? "";
  el.customerNotes.value  = c.notes        ?? "";
  openModal();
}

/* -- SAUVEGARDE -- */
async function save(event) {
  event.preventDefault();
  const name = el.customerName.value.trim();
  if (!name) { showFeedback("Le nom est obligatoire.", "error"); return; }

  setSaving(true);
  try {
    const payload = {
      name,
      email:      el.customerEmail.value.trim()   || null,
      phone:      el.customerPhone.value.trim()   || null,
      address:    el.customerAddress.value.trim() || null,
      city:       el.customerCity.value.trim()    || null,
      country:    el.customerCountry.value.trim() || null,
      category:   el.customerCategory.value.trim()|| null,
      tax_number: el.customerTax.value.trim()     || null,
      notes:      el.customerNotes.value.trim()   || null,
    };

    if (editingId) {
      const { error } = await supabase.from("customers").update(payload)
        .eq("id", editingId).eq("organization_id", organizationId);
      if (error) throw error;
      showFeedback("Client modifié avec succès.", "success");
    } else {
      const { error } = await supabase.from("customers")
        .insert({ ...payload, organization_id: organizationId, created_by: currentUser.id });
      if (error) throw error;
      showFeedback("Client ajouté avec succès.", "success");
    }

    closeModalFn();
    await loadCustomers();
  } catch (err) {
    console.error("Sauvegarde client :", err);
    showFeedback(err.message || "Impossible d'enregistrer.", "error");
  } finally {
    setSaving(false);
  }
}

/* -- TOGGLE -- */
async function toggle(id) {
  const c = customers.find(x => x.id === id);
  if (!c) return;
  if (!window.confirm(`${c.is_active ? "Désactiver" : "Activer"} « ${c.name} » ?`)) return;
  try {
    const { error } = await supabase.from("customers")
      .update({ is_active: !c.is_active }).eq("id", id).eq("organization_id", organizationId);
    if (error) throw error;
    showFeedback(c.is_active ? "Client désactivé." : "Client activé.", "success");
    await loadCustomers();
  } catch (err) {
    showFeedback("Impossible de modifier le statut.", "error");
  }
}

/* -- LOGOUT -- */
async function logout() {
  if (el.logoutButton) { el.logoutButton.disabled = true; }
  await supabase.auth.signOut();
  window.location.href = "../connexion.html";
}

/* -- ÉVÉNEMENTS -- */
function setupEvents() {
  el.addButton?.addEventListener("click", openCreate);
  el.closeModal?.addEventListener("click", closeModalFn);
  el.cancelButton?.addEventListener("click", closeModalFn);
  el.form?.addEventListener("submit", save);
  el.searchInput?.addEventListener("input", renderTable);
  el.statusFilter?.addEventListener("change", renderTable);
  el.categoryFilter?.addEventListener("change", renderTable);
  el.logoutButton?.addEventListener("click", logout);

  el.tableBody?.addEventListener("click", event => {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    const c = customers.find(x => x.id === btn.dataset.id);
    if (!c) return;
    if (btn.dataset.action === "edit")   openEdit(c);
    if (btn.dataset.action === "toggle") toggle(c.id);
  });

  el.modal?.addEventListener("click", e => { if (e.target === el.modal) closeModalFn(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && el.modal?.classList.contains("open")) closeModalFn(); });
}

/* -- UI -- */
function setSaving(v) {
  if (!el.saveButton) return;
  el.saveButton.disabled = v;
  el.saveButton.textContent = v ? "Enregistrement..." : (editingId ? "Enregistrer les modifications" : "Enregistrer");
}

function showFeedback(msg, type) {
  if (!el.feedback) return;
  el.feedback.textContent = msg;
  el.feedback.className = `feedback ${type}`;
  clearTimeout(showFeedback._t);
  showFeedback._t = setTimeout(() => { el.feedback.className = "feedback"; el.feedback.textContent = ""; }, 5000);
}

function formatDate(v) {
  if (!v) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day:"2-digit", month:"short", year:"numeric" }).format(new Date(v));
}

function escHtml(v) {
  return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

init();
