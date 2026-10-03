
/* ==========================================
   PROJET : NEXORA
   Fichier : js/core/membres.js
   Module : Gestion des membres et invitations
   ========================================== */

import { supabase } from "../config/supabase.js";
import { initializeOrganization } from "../auth/organization.js";

// ==========================================
// 1. ÉLÉMENTS HTML
// ==========================================

const elements = {
  inviteForm: document.getElementById("inviteForm"),
  inviteEmail: document.getElementById("inviteEmail"),
  inviteRole: document.getElementById("inviteRole"),
  inviteButton: document.getElementById("inviteButton"),
  inviteFeedback: document.getElementById("inviteFeedback"),

  membersTableBody: document.getElementById("membersTableBody"),
  memberCount: document.getElementById("memberCount"),

  errorMessage: document.getElementById("errorMessage"),
  infoMessage: document.getElementById("infoMessage"),

  companyName: document.getElementById("companyName"),
  organizationName: document.getElementById("organizationName"),
  userName: document.getElementById("userName"),
  userAvatar: document.getElementById("userAvatar"),

  logoutButton: document.getElementById("logoutButton")
};

// ==========================================
// 2. ÉTAT DE L'APPLICATION
// ==========================================

const state = {
  currentUser: null,
  organizationId: null,
  members: [],
  invitations: [],
  isLoading: false,
  isInviting: false
};

// ==========================================
// 3. OUTILS
// ==========================================

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[character];
  });
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

function getRoleLabel(role) {
  const roles = {
    owner: "Propriétaire",
    admin: "Administrateur",
    employee: "Employé"
  };

  return roles[role] || "Membre";
}

function getInitials(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) return "N";

  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

function displayFeedback(element, message, type = "info") {
  if (!element) return;

  element.textContent = message;
  element.className = `feedback show ${type}`;
  element.setAttribute("role", type === "error" ? "alert" : "status");
}

function hideFeedback(element) {
  if (!element) return;

  element.textContent = "";
  element.className = "feedback";
}

function showError(message) {
  displayFeedback(elements.errorMessage, message, "error");
}

function showInfo(message) {
  displayFeedback(elements.infoMessage, message, "info");
}

function hideMessages() {
  hideFeedback(elements.errorMessage);
  hideFeedback(elements.infoMessage);
  hideFeedback(elements.inviteFeedback);
}

// ==========================================
// 4. IDENTITÉ DE L'UTILISATEUR
// ==========================================

function renderUser() {
  if (!state.currentUser) return;

  const metadata = state.currentUser.user_metadata || {};

  const name =
    metadata.full_name ||
    metadata.name ||
    state.currentUser.email ||
    "Utilisateur";

  if (elements.userName) {
    elements.userName.textContent = name;
  }

  if (elements.userAvatar) {
    elements.userAvatar.textContent = getInitials(name);
  }
}

// ==========================================
// 5. AFFICHAGE DE L'ORGANISATION
// ==========================================

async function loadOrganization() {
  const { data, error } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", state.currentUser.id)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      "Impossible de récupérer votre organisation : " + error.message
    );
  }

  if (!data) {
    throw new Error(
      "Aucune organisation associée à votre compte."
    );
  }

  state.organizationId = data.organization_id;

  const { data: organization, error: organizationError } =
    await supabase
      .from("organizations")
      .select("id, name")
      .eq("id", state.organizationId)
      .maybeSingle();

  if (organizationError) {
    throw new Error(
      "Impossible de charger les informations de l'entreprise : " +
      organizationError.message
    );
  }

  if (!organization) {
    throw new Error("Votre organisation est introuvable.");
  }

  const name = organization.name || "Mon entreprise";

  if (elements.companyName) {
    elements.companyName.textContent = name;
  }

  if (elements.organizationName) {
    elements.organizationName.textContent = name;
  }

  // Seuls les propriétaires et administrateurs
  // peuvent envoyer des invitations.
  const canInvite = ["owner", "admin"].includes(data.role);

  if (elements.inviteForm) {
    elements.inviteForm.hidden = !canInvite;
  }

  if (!canInvite) {
    showInfo(
      "Vous pouvez consulter les membres, mais vous ne pouvez pas inviter de nouveaux utilisateurs."
    );
  }
}

// ==========================================
// 6. AFFICHAGE DES MEMBRES
// ==========================================

function renderMembers() {
  if (!elements.membersTableBody) return;

  if (elements.memberCount) {
    elements.memberCount.textContent = String(state.members.length);
  }

  if (state.members.length === 0) {
    elements.membersTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center">
          Aucun membre trouvé.
        </td>
      </tr>
    `;
    return;
  }

  elements.membersTableBody.innerHTML = state.members.map((member) => {
    const isCurrentUser = member.user_id === state.currentUser?.id;

    const identifier = member.user_id
      ? member.user_id.slice(0, 8) + "…"
      : "—";

    return `
      <tr>
        <td>
          <div class="member-identity">
            <span class="member-avatar">
              ${escapeHTML(identifier.slice(0, 1).toUpperCase())}
            </span>
            <div>
              <strong>${escapeHTML(
                isCurrentUser ? "Vous" : "Membre " + identifier
              )}</strong>
              <small>${escapeHTML(identifier)}</small>
            </div>
          </div>
        </td>
        <td>
          <span class="badge">
            ${escapeHTML(getRoleLabel(member.role))}
          </span>
        </td>
        <td>
          ${escapeHTML(formatDate(member.created_at))}
        </td>
        <td>
          <span class="badge badge-success">Actif</span>
        </td>
      </tr>
    `;
  }).join("");
}

// ==========================================
// 7. CHARGEMENT DES MEMBRES
// ==========================================

async function loadMembers() {
  if (!state.organizationId) return;

  const { data, error } = await supabase
    .from("organization_members")
    .select("id, user_id, role, created_at")
    .eq("organization_id", state.organizationId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(
      "Impossible de charger les membres : " + error.message
    );
  }

  state.members = data || [];
  renderMembers();
}

// ==========================================
// 8. AFFICHAGE DES INVITATIONS
// ==========================================

function renderInvitations() {
  const existingTable = elements.membersTableBody;

  if (!existingTable) return;

  // Les invitations sont affichées dans un tableau
  // distinct, si celui-ci existe dans la page HTML.
  const invitationsBody = document.getElementById(
    "invitationsTableBody"
  );

  if (!invitationsBody) return;

  const pending = state.invitations.filter(
    (invitation) => invitation.status === "pending"
  );

  if (pending.length === 0) {
    invitationsBody.innerHTML = `
      <tr>
        <td colspan="4" class="text-center">
          Aucune invitation en attente.
        </td>
      </tr>
    `;
    return;
  }

  invitationsBody.innerHTML = pending.map((invitation) => {
    const expired =
      invitation.expires_at &&
      new Date(invitation.expires_at).getTime() < Date.now();

    const status = expired ? "Expirée" : "En attente";
    const statusClass = expired ? "badge-warning" : "badge-info";

    return `
      <tr>
        <td>${escapeHTML(invitation.email)}</td>
        <td>${escapeHTML(getRoleLabel(invitation.role))}</td>
        <td>${escapeHTML(formatDate(invitation.created_at))}</td>
        <td>
          <span class="badge ${statusClass}">
            ${status}
          </span>
        </td>
      </tr>
    `;
  }).join("");
}

// ==========================================
// 9. CHARGEMENT DES INVITATIONS
// ==========================================

async function loadInvitations() {
  if (!state.organizationId) return;

  const { data, error } = await supabase
    .from("organization_invitations")
    .select("id, email, role, status, created_at, expires_at")
    .eq("organization_id", state.organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    // Ne pas masquer une erreur de sécurité ou de
    // configuration de la table.
    throw new Error(
      "Impossible de charger les invitations : " + error.message
    );
  }

  state.invitations = data || [];
  renderInvitations();
}

// ==========================================
// 10. ACTUALISATION DES DONNÉES
// ==========================================

async function refreshData() {
  if (state.isLoading) return;

  state.isLoading = true;

  try {
    await Promise.all([
      loadMembers(),
      loadInvitations()
    ]);
  } finally {
    state.isLoading = false;
  }
}

// ==========================================
// 11. ENVOI D'UNE INVITATION
// ==========================================

function setInviteLoading(loading) {
  if (!elements.inviteButton) return;

  elements.inviteButton.disabled = loading;

  if (loading) {
    if (!elements.inviteButton.dataset.originalText) {
      elements.inviteButton.dataset.originalText =
        elements.inviteButton.textContent.trim();
    }

    elements.inviteButton.textContent = "Envoi en cours…";
  } else {
    elements.inviteButton.textContent =
      elements.inviteButton.dataset.originalText ||
      "Envoyer l'invitation";
  }
}

async function inviteMember(event) {
  event.preventDefault();

  if (state.isInviting) return;

  hideFeedback(elements.inviteFeedback);

  const email = normalizeEmail(elements.inviteEmail?.value);
  const role = elements.inviteRole?.value;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    displayFeedback(
      elements.inviteFeedback,
      "Veuillez saisir une adresse e-mail valide.",
      "error"
    );
    return;
  }

  if (!["admin", "employee"].includes(role)) {
    displayFeedback(
      elements.inviteFeedback,
      "Le rôle sélectionné est invalide.",
      "error"
    );
    return;
  }

  if (!state.organizationId) {
    displayFeedback(
      elements.inviteFeedback,
      "Votre organisation n'est pas disponible.",
      "error"
    );
    return;
  }

  state.isInviting = true;
  setInviteLoading(true);

  try {
    const { data, error } = await supabase.functions.invoke(
      "invite-member",
      {
        body: {
          organizationId: state.organizationId,
          email,
          role
        }
      }
    );

    if (error) {
      let message = error.message || "Échec de l'envoi de l'invitation.";

      // Les fonctions Edge peuvent retourner un corps JSON
      // contenant un message d'erreur plus précis.
      if (error.context && typeof error.context.json === "function") {
        try {
          const details = await error.context.json();
          if (details?.error) {
            message = details.error;
          }
        } catch {
          // Conserver le message initial.
        }
      }

      throw new Error(message);
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    displayFeedback(
      elements.inviteFeedback,
      "L'invitation a été traitée. Vérifiez son statut dans la liste.",
      "success"
    );

    elements.inviteForm.reset();

    await loadInvitations();
  } catch (error) {
    console.error("NEXORA - Invitation :", error);

    displayFeedback(
      elements.inviteFeedback,
      error.message || "Une erreur est survenue pendant l'invitation.",
      "error"
    );
  } finally {
    state.isInviting = false;
    setInviteLoading(false);
  }
}

// ==========================================
// 12. DÉCONNEXION
// ==========================================

async function logout() {
  if (elements.logoutButton) {
    elements.logoutButton.disabled = true;
  }

  try {
    const { error } = await supabase.auth.signOut();

    if (error) throw error;

    window.location.replace("../connexion.html");
  } catch (error) {
    console.error("NEXORA - Déconnexion :", error);

    showError(
      "Impossible de vous déconnecter : " +
      (error.message || "erreur inconnue.")
    );

    if (elements.logoutButton) {
      elements.logoutButton.disabled = false;
    }
  }
}

// ==========================================
// 13. INITIALISATION
// ==========================================

async function initializePage() {
  hideMessages();

  try {
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError) throw sessionError;

    if (!sessionData.session) {
      window.location.replace("../connexion.html");
      return;
    }

    const { data: userData, error: userError } =
      await supabase.auth.getUser();

    if (userError) throw userError;

    if (!userData.user) {
      window.location.replace("../connexion.html");
      return;
    }

    state.currentUser = userData.user;
    renderUser();

    // Vérifier ou initialiser l'organisation.
    await initializeOrganization();

    await loadOrganization();
    await refreshData();

  } catch (error) {
    console.error("NEXORA - Initialisation :", error);

    showError(
      error.message ||
      "Impossible de charger la page de gestion des membres."
    );
  }
}

// ==========================================
// 14. ÉVÉNEMENTS
// ==========================================

elements.inviteForm?.addEventListener("submit", inviteMember);

elements.logoutButton?.addEventListener("click", logout);

// Actualiser les données après une modification
// de la session d'authentification.
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    window.location.replace("../connexion.html");
  }
});

// ==========================================
// 15. DÉMARRAGE
// ==========================================

initializePage();