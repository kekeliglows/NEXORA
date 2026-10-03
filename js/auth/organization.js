
/*
====================================================
 PROJET : NEXORA
 FICHIER : js/auth/organization.js
 DESCRIPTION : Initialisation de l'espace entreprise
====================================================
*/

import { supabase } from "../config/supabase.js";

/**
 * Récupère l'espace de l'utilisateur connecté.
 * Si aucun espace n'existe, en crée un.
 *
 * @returns {Promise<string>} Identifiant de l'entreprise
 */
export async function initializeOrganization() {
  // 1. Vérifier la session et l'utilisateur.
  const { data: userData, error: userError } =
    await supabase.auth.getUser();

  if (userError) {
    throw new Error("Impossible de vérifier la session.");
  }

  const user = userData.user;

  if (!user) {
    throw new Error("Vous devez être connecté.");
  }

  // 2. Vérifier si l'utilisateur possède déjà un espace.
  const { data: membership, error: membershipError } =
    await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

  if (membershipError) {
    throw new Error(
      "Impossible de vérifier votre espace professionnel."
    );
  }

  if (membership) {
    return membership.organization_id;
  }

  // 3. Récupérer le nom initial de l'entreprise.
  const companyName =
    user.user_metadata?.company_name?.trim();

  if (!companyName || companyName.length < 2) {
    throw new Error(
      "Le nom de votre entreprise est manquant. Contactez l'assistance."
    );
  }

  // 4. Créer l'entreprise via la fonction SQL sécurisée.
  const { data: organizationId, error: creationError } =
    await supabase.rpc("create_organization", {
      p_name: companyName
    });

  if (creationError) {
    throw new Error(
      "La création de votre espace a échoué : " +
      creationError.message
    );
  }

  if (!organizationId) {
    throw new Error(
      "Supabase n'a pas renvoyé l'identifiant de votre entreprise."
    );
  }

  return organizationId;
}