
/**
 * ============================================================
 * NEXORA — CONNEXION ET ACCEPTATION DES INVITATIONS
 * Fichier : js/auth/connexion.js
 * ============================================================
 *
 * Fonctionnalités :
 * - Connexion des utilisateurs.
 * - Détection des invitations reçues par e-mail.
 * - Acceptation des invitations après authentification.
 * - Redirection vers le tableau de bord.
 * - Gestion des erreurs et des sessions.
 * ============================================================
 */

import { supabase } from "../config/supabase.js";
import { initializeOrganization } from "./organization.js";

/* ============================================================
   1. ÉLÉMENTS HTML
   ============================================================ */

const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("loginSubmit");
const loginFeedback = document.getElementById("loginFeedback");

/* ============================================================
   2. ÉTAT
   ============================================================ */

let isSubmitting = false;

const params = new URLSearchParams(window.location.search);
const invitationId = params.get("invitation");

/* ============================================================
   3. AFFICHAGE DES MESSAGES
   ============================================================ */

function showFeedback(message, type = "error") {
  if (!loginFeedback) return;

  loginFeedback.textContent = message;
  loginFeedback.className = `feedback show ${type}`;
  loginFeedback.setAttribute(
    "role",
    type === "error" ? "alert" : "status"
  );
}

function clearFeedback() {
  if (!loginFeedback) return;

  loginFeedback.textContent = "";
  loginFeedback.className = "feedback";
}

/* ============================================================
   4. ÉTAT DU BOUTON
   ============================================================ */

function setSubmitting(value) {
  isSubmitting = value;

  if (!loginButton) return;

  loginButton.disabled = value;

  if (value) {
    loginButton.dataset.originalText =
      loginButton.textContent.trim();

    loginButton.textContent = invitationId
      ? "Acceptation en cours..."
      : "Connexion en cours...";
  } else {
    loginButton.textContent =
      loginButton.dataset.originalText || "Se connecter";
  }
}

/* ============================================================
   5. NETTOYAGE DE L'URL
   ============================================================ */

function cleanInvitationUrl() {
  const url = new URL(window.location.href);

  url.searchParams.delete("invitation");

  window.history.replaceState({}, document.title, url.toString());
}

/* ============================================================
   6. ACCEPTATION DE L'INVITATION
   ============================================================ */

async function acceptInvitation() {
  if (!invitationId) {
    return false;
  }

  showFeedback(
    "Vérification de votre invitation...",
    "info"
  );

  const { data, error } = await supabase.rpc(
    "accept_organization_invitation",
    {
      p_invitation_id: invitationId
    }
  );

  if (error) {
    console.error("Erreur d'acceptation :", error);

    throw new Error(
      error.message ||
      "Impossible d'accepter cette invitation."
    );
  }

  if (!data || data.success !== true) {
    throw new Error(
      "L'invitation n'a pas pu être acceptée."
    );
  }

  cleanInvitationUrl();

  showFeedback(
    "Invitation acceptée. Ouverture de votre espace...",
    "success"
  );

  return true;
}

/* ============================================================
   7. REDIRECTION APRÈS CONNEXION
   ============================================================ */

async function finishAuthentication() {
  if (invitationId) {
    await acceptInvitation();
  } else {
    await initializeOrganization();
  }

  window.location.replace("pages/dashboard.html");
}

/* ============================================================
   8. CONNEXION
   ============================================================ */

async function handleLogin(event) {
  event.preventDefault();

  if (isSubmitting) return;

  clearFeedback();

  const email = emailInput?.value.trim().toLowerCase() || "";
  const password = passwordInput?.value || "";

  if (!email || !password) {
    showFeedback(
      "Veuillez renseigner votre adresse e-mail et votre mot de passe."
    );
    return;
  }

  setSubmitting(true);

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      throw error;
    }

    if (!data.user) {
      throw new Error(
        "Impossible de récupérer votre compte."
      );
    }

    await finishAuthentication();
  } catch (error) {
    console.error("Connexion :", error);

    showFeedback(
      error.message ||
      "Une erreur est survenue pendant la connexion."
    );
  } finally {
    setSubmitting(false);
  }
}

/* ============================================================
   9. INITIALISATION DE LA SESSION
   ============================================================ */

async function initializeLoginPage() {
  if (invitationId) {
    showFeedback(
      "Connectez-vous avec l'adresse e-mail qui a reçu l'invitation pour rejoindre l'organisation.",
      "info"
    );
  }

  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      throw error;
    }

    const session = data.session;

    // Si un utilisateur est déjà connecté, traiter directement
    // son invitation ou initialiser son organisation.
    if (session?.user) {
      setSubmitting(true);

      try {
        await finishAuthentication();
      } catch (error) {
        console.error("Initialisation de session :", error);

        showFeedback(
          error.message ||
          "Impossible de finaliser votre connexion."
        );
      } finally {
        setSubmitting(false);
      }
    }
  } catch (error) {
    console.error("Initialisation :", error);

    showFeedback(
      "Impossible de vérifier votre session. Réessayez."
    );
  }
}

/* ============================================================
   10. ÉVÉNEMENTS
   ============================================================ */

if (loginForm) {
  loginForm.addEventListener("submit", handleLogin);
}

initializeLoginPage();