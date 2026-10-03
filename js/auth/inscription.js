
/*
====================================================
 PROJET : NEXORA
 FICHIER : js/auth/inscription.js
 DESCRIPTION : Inscription avec Supabase Auth
====================================================
*/

import { supabase } from "../config/supabase.js";

// ================================================
// 1. RÉCUPÉRATION DES ÉLÉMENTS
// ================================================

const form = document.getElementById("registerForm");
const fullName = document.getElementById("fullName");
const companyName = document.getElementById("companyName");
const email = document.getElementById("email");
const password = document.getElementById("password");
const confirmPassword = document.getElementById("confirmPassword");
const acceptTerms = document.getElementById("acceptTerms");
const submitButton = document.getElementById("registerSubmit");
const feedback = document.getElementById("registerFeedback");

// ================================================
// 2. ANNÉE DU PIED DE PAGE
// ================================================

document.querySelectorAll(".current-year").forEach((element) => {
  element.textContent = new Date().getFullYear();
});

// ================================================
// 3. AFFICHER OU MASQUER LES MOTS DE PASSE
// ================================================

document.querySelectorAll("[data-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.toggle);
    const show = input.type === "password";

    input.type = show ? "text" : "password";
    button.textContent = show ? "Masquer" : "Afficher";
    button.setAttribute(
      "aria-label",
      show ? "Masquer le mot de passe" : "Afficher le mot de passe"
    );
  });
});

// ================================================
// 4. AFFICHAGE DES ERREURS
// ================================================

function setError(field, message) {
  const errorElement = document.getElementById(field.id + "Error");

  if (!errorElement) return;

  errorElement.textContent = message;
  errorElement.classList.toggle("visible", Boolean(message));
  field.classList.toggle("invalid", Boolean(message));
  field.setAttribute("aria-invalid", message ? "true" : "false");
}

function clearError(field) {
  setError(field, "");
}

// ================================================
// 5. VALIDATION DES CHAMPS
// ================================================

function validateFullName() {
  const value = fullName.value.trim();

  if (value.length < 2 || value.length > 100) {
    setError(fullName, "Saisissez un nom complet valide.");
    return false;
  }

  clearError(fullName);
  return true;
}

function validateCompanyName() {
  const value = companyName.value.trim();

  if (value.length < 2 || value.length > 120) {
    setError(companyName, "Saisissez un nom d'entreprise valide.");
    return false;
  }

  clearError(companyName);
  return true;
}

function validateEmail() {
  const value = email.value.trim();
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (value.length > 254 || !pattern.test(value)) {
    setError(email, "Saisissez une adresse e-mail valide.");
    return false;
  }

  clearError(email);
  return true;
}

function validatePassword() {
  const value = password.value;

  if (value.length < 8 || value.length > 128) {
    setError(password, "Le mot de passe doit contenir entre 8 et 128 caractères.");
    return false;
  }

  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    setError(password, "Ajoutez au moins une lettre et un chiffre.");
    return false;
  }

  clearError(password);
  return true;
}

function validateConfirmPassword() {
  if (!confirmPassword.value) {
    setError(confirmPassword, "Confirmez votre mot de passe.");
    return false;
  }

  if (confirmPassword.value !== password.value) {
    setError(confirmPassword, "Les mots de passe ne correspondent pas.");
    return false;
  }

  clearError(confirmPassword);
  return true;
}

function validateTerms() {
  const error = document.getElementById("termsError");

  if (!acceptTerms.checked) {
    error.textContent = "Veuillez accepter les conditions d'utilisation.";
    error.classList.add("visible");
    return false;
  }

  error.textContent = "";
  error.classList.remove("visible");
  return true;
}

// ================================================
// 6. INDICATEUR DE ROBUSTESSE DU MOT DE PASSE
// ================================================

function updatePasswordStrength() {
  const container = document.getElementById("passwordStrength");
  const label = document.getElementById("strengthLabel");
  const bars = container.querySelectorAll(".register-strength-bar");
  const value = password.value;

  if (!value) {
    container.classList.remove("visible");
    bars.forEach((bar) => {
      bar.style.background = "#e4e7ec";
    });
    label.textContent = "";
    return;
  }

  container.classList.add("visible");

  let score = 0;

  if (value.length >= 8) score++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
  if (/\d/.test(value)) score++;
  if (/[^A-Za-z0-9]/.test(value)) score++;

  const labels = ["Faible", "Moyen", "Bon", "Fort"];
  const colors = ["#dc2626", "#d97706", "#15803d", "#15803d"];

  bars.forEach((bar, index) => {
    bar.style.background =
      index < score ? colors[Math.max(score - 1, 0)] : "#e4e7ec";
  });

  label.textContent = labels[Math.max(score - 1, 0)];
}

// ================================================
// 7. VALIDATION GLOBALE
// ================================================

function validateForm() {
  const results = [
    validateFullName(),
    validateCompanyName(),
    validateEmail(),
    validatePassword(),
    validateConfirmPassword(),
    validateTerms()
  ];

  return results.every(Boolean);
}

function updateSubmitButton() {
  const valid =
    fullName.value.trim().length >= 2 &&
    fullName.value.trim().length <= 100 &&
    companyName.value.trim().length >= 2 &&
    companyName.value.trim().length <= 120 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) &&
    password.value.length >= 8 &&
    password.value.length <= 128 &&
    /[A-Za-z]/.test(password.value) &&
    /\d/.test(password.value) &&
    confirmPassword.value === password.value &&
    confirmPassword.value.length > 0 &&
    acceptTerms.checked;

  submitButton.disabled = !valid;
}

// ================================================
// 8. ÉCOUTE DES CHANGEMENTS
// ================================================

fullName.addEventListener("input", () => {
  if (fullName.classList.contains("invalid")) validateFullName();
  updateSubmitButton();
});

companyName.addEventListener("input", () => {
  if (companyName.classList.contains("invalid")) validateCompanyName();
  updateSubmitButton();
});

email.addEventListener("input", () => {
  if (email.classList.contains("invalid")) validateEmail();
  updateSubmitButton();
});

password.addEventListener("input", () => {
  updatePasswordStrength();

  if (password.classList.contains("invalid")) validatePassword();

  if (confirmPassword.value) validateConfirmPassword();

  updateSubmitButton();
});

confirmPassword.addEventListener("input", () => {
  if (confirmPassword.classList.contains("invalid")) {
    validateConfirmPassword();
  }

  updateSubmitButton();
});

acceptTerms.addEventListener("change", () => {
  validateTerms();
  updateSubmitButton();
});

// ================================================
// 9. MESSAGES DE RETOUR
// ================================================

function showFeedback(message, type = "info") {
  feedback.textContent = message;
  feedback.className = "register-feedback visible " + type;
}

function clearFeedback() {
  feedback.textContent = "";
  feedback.className = "register-feedback";
}

// ================================================
// 10. CRÉATION DU COMPTE SUPABASE
// ================================================

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFeedback();

  if (!validateForm()) {
    const firstInvalid = form.querySelector(".register-input.invalid");
    if (firstInvalid) firstInvalid.focus();
    return;
  }

  // Empêcher les soumissions multiples.
  submitButton.disabled = true;
  submitButton.textContent = "Création du compte...";

  try {
    const { data, error } = await supabase.auth.signUp({
      email: email.value.trim(),
      password: password.value,
      options: {
        data: {
          full_name: fullName.value.trim(),
          company_name: companyName.value.trim()
        },
        emailRedirectTo: new URL(
          "connexion.html",
          window.location.href
        ).href
      }
    });

    if (error) {
      throw error;
    }

    // Supabase peut renvoyer un utilisateur sans session
    // lorsque la confirmation de l'adresse est activée.
    if (data.user && data.session) {
      showFeedback(
        "Votre compte a été créé. Vous êtes connecté. " +
        "La création de votre espace entreprise sera disponible à l'étape suivante.",
        "info"
      );
    } else {
      showFeedback(
        "Votre demande d'inscription a été envoyée. " +
        "Si la confirmation par e-mail est activée, consultez votre boîte " +
        "de réception pour confirmer votre adresse avant de vous connecter.",
        "info"
      );
    }

    form.reset();
    document.getElementById("passwordStrength").classList.remove("visible");
    document.querySelectorAll(".register-strength-bar").forEach((bar) => {
      bar.style.background = "#e4e7ec";
    });
    document.getElementById("strengthLabel").textContent = "";

    document.querySelectorAll(".register-input").forEach((field) => {
      clearError(field);
    });

  } catch (error) {
    console.error("Erreur d'inscription :", error);

    showFeedback(
      error.message || "Une erreur est survenue lors de l'inscription.",
      "error"
    );
  } finally {
    submitButton.textContent = "Créer mon compte";
    updateSubmitButton();
  }
});

// ================================================
// 11. INITIALISATION
// ================================================

updateSubmitButton();