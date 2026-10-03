
/*
====================================================
 PROJET : NEXORA
 FICHIER : js/core/dashboard.js
 DESCRIPTION : Protection et initialisation du
               tableau de bord
====================================================
*/

import { supabase } from "../config/supabase.js";
import { initializeOrganization } from "../auth/organization.js";

const companyNameElement = document.getElementById("companyName");
const userNameElement = document.getElementById("userName");
const userAvatarElement = document.getElementById("userAvatar");
const welcomeTitleElement = document.getElementById("welcomeTitle");
const feedbackElement = document.getElementById("dashboardFeedback");
const logoutButton = document.getElementById("logoutButton");

function showError(message) {
  if (!feedbackElement) return;

  feedbackElement.textContent = message;
  feedbackElement.classList.add("visible");
}

function getInitials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return "N";

  return parts
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join("");
}

function displayUser(user) {
  const metadata = user.user_metadata || {};

  const fullName =
    typeof metadata.full_name === "string"
      ? metadata.full_name.trim()
      : "";

  const name = fullName || user.email || "Utilisateur";

  userNameElement.textContent = name;
  userAvatarElement.textContent = getInitials(name);
  welcomeTitleElement.textContent = `Bienvenue, ${name}`;
}

async function loadDashboard() {
  try {
    // Vérifier l'utilisateur connecté.
    const { data, error } = await supabase.auth.getUser();

    if (error) {
      throw new Error("Impossible de vérifier votre session.");
    }

    const user = data.user;

    // Un visiteur non connecté retourne à la connexion.
    if (!user) {
      window.location.replace("../connexion.html");
      return;
    }

    displayUser(user);

    // Vérifier ou initialiser l'espace professionnel.
    const organizationId = await initializeOrganization();

    // Charger uniquement l'entreprise accessible à cet utilisateur.
    const { data: organization, error: organizationError } =
      await supabase
        .from("organizations")
        .select("id, name")
        .eq("id", organizationId)
        .maybeSingle();

    if (organizationError) {
      throw new Error(
        "Impossible de charger les informations de votre entreprise."
      );
    }

    if (!organization) {
      throw new Error(
        "Votre espace professionnel est introuvable ou inaccessible."
      );
    }

    companyNameElement.textContent = organization.name;

  } catch (error) {
    console.error("Erreur du tableau de bord :", error);

    showError(
      error instanceof Error
        ? error.message
        : "Une erreur inattendue est survenue."
    );
  }
}

async function logout() {
  logoutButton.disabled = true;
  logoutButton.textContent = "Déconnexion...";

  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      throw error;
    }

    window.location.replace("../connexion.html");
  } catch (error) {
    console.error("Erreur de déconnexion :", error);

    showError(
      "La déconnexion a échoué. Veuillez réessayer."
    );

    logoutButton.disabled = false;
    logoutButton.textContent = "↪ Déconnexion";
  }
}

logoutButton.addEventListener("click", logout);

// Initialiser le tableau de bord.
loadDashboard();