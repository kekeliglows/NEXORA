/**
 * NEXORA — GESTION DES FOURNISSEURS — js/core/fournisseurs.js — Étape 7
 * Table : public.suppliers
 */
import { supabase } from "../config/supabase.js";

let currentUser = null, organizationId = null;
let suppliers = [], editingId = null;

const el = {
  tableBody:        document.getElementById("suppliersTableBody"),
  searchInput:      document.getElementById("searchInput"),
  statusFilter:     document.getElementById("statusFilter"),
  categoryFilter:   document.getElementById("categoryFilter"),
  addButton:        document.getElementById("addSupplierButton"),
  totalCount:       document.getElementById("totalSuppliers"),
  activeCount:      document.getElementById("activeSuppliers"),
  feedback:         document.getElementById("feedback"),
  modal:            document.getElementById("supplierModal"),
  modalTitle:       document.getElementById("modalTitle"),
  closeModal:       document.getElementById("closeModalButton"),
  cancelButton:     document.getElementById("cancelButton"),
  form:             document.getElementById("supplierForm"),
  saveButton:       document.getElementById("saveButton"),
  supplierId:       document.getElementById("supplierId"),
  supplierName:     document.getElementById("supplierName"),
  supplierEmail:    document.getElementById("supplierEmail"),
  supplierPhone:    document.getElementById("supplierPhone"),
  supplierAddress:  document.getElementById("supplierAddress"),
  supplierCity:     document.getElementById("supplierCity"),
  supplierCountry:  document.getElementById("supplierCountry"),
  supplierCategory: document.getElementById("supplierCategory"),
  supplierTax:      document.getElementById("supplierTax"),
  supplierNotes:    document.getElementById("supplierNotes"),
  userName:         document.getElementById("userName"),
  userAvatar:       document.getElementById("userAvatar"),
  companyName:      document.getElementById("companyName"),
  logoutButton:     document.getElementById("logoutButton"),
};

async function init() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!session?.user) { window.location.href = "../connexion.html"; return; }
    currentUser = session.user;
    renderUser();
    await loadOrganization();
    await loadSuppliers();
    setupEvents();
  } catch (err) {
    console.error("Init fournisseurs :", err);
    showFeedback("Impossible de charger les fournisseurs.", "error");
  }
}

function renderUser() {
  const meta = currentUser.user_metadata ?? {};
  const name = meta.full_name || meta.name || currentUser.email || "Utilisateur";
  if (el.userName)   el.userName.textContent   = name;
  if (el.userAvatar) el.userAvatar.textContent = String(name).trim().split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join("");
}

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

async function loadSuppliers() {
  const { data, error } = await supabase
    .from("suppliers")
    .select("id,name,email,phone,address,city,country,category,tax_number,notes,is_active,created_at")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });
  if (error) throw error;
  suppliers = data ?? [];
  updateStats();
  populateCategoryFilter();
  renderTable();
}

function updateStats() {
  const active = suppliers.filter(s => s.is_active).length;
  const cats   = new Set(suppliers.map(s => s.category).filter(Boolean)).size;
  if (el.totalCount)  el.totalCount.textContent  = suppliers.length;
  if (el.activeCount) el.activeCount.textContent = active;
  const catsEl = document.getElementById("totalFCategories");
  if (catsEl) catsEl.textContent = cats;
}

function populateCategoryFilter() {
  if (!el.categoryFilter) return;
  const current = el.categoryFilter.value;
  const cats = [...new Set(suppliers.map(s => s.category).filter(Boolean))].sort();
  el.categoryFilter.innerHTML = `<option value="all">Toutes catégories</option>` +
    cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  if (current && cats.includes(current)) el.categoryFilter.value = current;
}

function renderTable() {
  const search   = (el.searchInput?.value ?? "").trim().toLowerCase();
  const status   = el.statusFilter?.value   ?? "all";
  const category = el.categoryFilter?.value ?? "all";

  const filtered = suppliers.filter(s =>
    (s.name.toLowerCase().includes(search) || (s.email??"").toLowerCase().includes(search) ||
     (s.phone??"").toLowerCase().includes(search) || (s.city??"").toLowerCase().includes(search)) &&
    (status   === "all" || (status   === "active" && s.is_active) || (status   === "inactive" && !s.is_active)) &&
    (category === "all" || s.category === category)
  );

  if (!filtered.length) {
    el.tableBody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><p class="empty-title">Aucun fournisseur trouvé</p><p class="empty-desc">Ajoutez votre premier fournisseur ou modifiez les filtres.</p></div></td></tr>`;
    return;
  }

  el.tableBody.innerHTML = filtered.map(s => `
    <tr>
      <td><span class="item-name">${esc(s.name)}</span>${s.category?`<span class="item-meta">${esc(s.category)}</span>`:""}</td>
      <td>${s.email?`<a href="mailto:${esc(s.email)}" class="link">${esc(s.email)}</a>`:"—"}</td>
      <td>${esc(s.phone||"—")}</td>
      <td>${esc([s.city,s.country].filter(Boolean).join(", ")||"—")}</td>
      <td><span class="badge ${s.is_active?"badge-active":"badge-inactive"}">${s.is_active?"Actif":"Inactif"}</span></td>
      <td>${formatDate(s.created_at)}</td>
      <td><div class="actions">
        <button type="button" class="action-btn" data-action="edit"   data-id="${s.id}" title="Modifier">✎</button>
        <button type="button" class="action-btn" data-action="toggle" data-id="${s.id}" title="${s.is_active?"Désactiver":"Activer"}">${s.is_active?"✕":"✓"}</button>
      </div></td>
    </tr>`).join("");
}

function openModal() { el.modal?.classList.add("open"); el.modal?.setAttribute("aria-hidden","false"); setTimeout(()=>el.supplierName?.focus(),60); }
function closeModalFn() { el.modal?.classList.remove("open"); el.modal?.setAttribute("aria-hidden","true"); editingId=null; }

function openCreate() {
  editingId=null; el.modalTitle.textContent="Ajouter un fournisseur"; el.saveButton.textContent="Enregistrer";
  el.form.reset(); el.supplierId.value=""; openModal();
}

function openEdit(s) {
  editingId=s.id; el.modalTitle.textContent="Modifier le fournisseur"; el.saveButton.textContent="Enregistrer les modifications";
  el.supplierId.value=s.id; el.supplierName.value=s.name??""; el.supplierEmail.value=s.email??"";
  el.supplierPhone.value=s.phone??""; el.supplierAddress.value=s.address??""; el.supplierCity.value=s.city??"";
  el.supplierCountry.value=s.country??""; el.supplierCategory.value=s.category??"";
  el.supplierTax.value=s.tax_number??""; el.supplierNotes.value=s.notes??""; openModal();
}

async function save(event) {
  event.preventDefault();
  const name = el.supplierName.value.trim();
  if (!name) { showFeedback("Le nom est obligatoire.", "error"); return; }
  setSaving(true);
  try {
    const payload = {
      name,
      email:      el.supplierEmail.value.trim()    || null,
      phone:      el.supplierPhone.value.trim()    || null,
      address:    el.supplierAddress.value.trim()  || null,
      city:       el.supplierCity.value.trim()     || null,
      country:    el.supplierCountry.value.trim()  || null,
      category:   el.supplierCategory.value.trim() || null,
      tax_number: el.supplierTax.value.trim()      || null,
      notes:      el.supplierNotes.value.trim()    || null,
    };
    if (editingId) {
      const { error } = await supabase.from("suppliers").update(payload).eq("id",editingId).eq("organization_id",organizationId);
      if (error) throw error;
      showFeedback("Fournisseur modifié.", "success");
    } else {
      const { error } = await supabase.from("suppliers").insert({...payload, organization_id:organizationId, created_by:currentUser.id});
      if (error) throw error;
      showFeedback("Fournisseur ajouté.", "success");
    }
    closeModalFn();
    await loadSuppliers();
  } catch (err) {
    console.error("Sauvegarde fournisseur :", err);
    showFeedback(err.message || "Impossible d'enregistrer.", "error");
  } finally {
    setSaving(false);
  }
}

async function toggle(id) {
  const s = suppliers.find(x=>x.id===id);
  if (!s) return;
  if (!window.confirm(`${s.is_active?"Désactiver":"Activer"} « ${s.name} » ?`)) return;
  try {
    const { error } = await supabase.from("suppliers").update({is_active:!s.is_active}).eq("id",id).eq("organization_id",organizationId);
    if (error) throw error;
    showFeedback(s.is_active?"Fournisseur désactivé.":"Fournisseur activé.", "success");
    await loadSuppliers();
  } catch (err) {
    showFeedback("Impossible de modifier le statut.", "error");
  }
}

async function logout() {
  if (el.logoutButton) el.logoutButton.disabled=true;
  await supabase.auth.signOut();
  window.location.href="../connexion.html";
}

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
    const s = suppliers.find(x=>x.id===btn.dataset.id);
    if (!s) return;
    if (btn.dataset.action==="edit")   openEdit(s);
    if (btn.dataset.action==="toggle") toggle(s.id);
  });
  el.modal?.addEventListener("click", e=>{ if(e.target===el.modal) closeModalFn(); });
  document.addEventListener("keydown", e=>{ if(e.key==="Escape"&&el.modal?.classList.contains("open")) closeModalFn(); });
}

function setSaving(v) {
  if (!el.saveButton) return;
  el.saveButton.disabled=v;
  el.saveButton.textContent=v?"Enregistrement...":(editingId?"Enregistrer les modifications":"Enregistrer");
}

function showFeedback(msg, type) {
  if (!el.feedback) return;
  el.feedback.textContent=msg; el.feedback.className=`feedback ${type}`;
  clearTimeout(showFeedback._t);
  showFeedback._t=setTimeout(()=>{el.feedback.className="feedback";el.feedback.textContent="";},5000);
}

function formatDate(v) {
  if (!v) return "—";
  return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(v));
}

function esc(v) {
  return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

init();
