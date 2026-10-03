
/*
====================================================
 PROJET : NEXORA
 FICHIER : js/config/supabase.js
 DESCRIPTION : Initialisation du client Supabase
====================================================
*/

import { createClient } from
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

import { SUPABASE_CONFIG } from "./supabase.config.js";

// Vérification de la configuration
const { URL, PUBLISHABLE_KEY } = SUPABASE_CONFIG;

if (!URL || !PUBLISHABLE_KEY) {
  throw new Error(
    "NEXORA : la configuration Supabase est incomplète."
  );
}

if (
  !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(URL) ||
  !PUBLISHABLE_KEY.startsWith("sb_publishable_")
) {
  throw new Error(
    "NEXORA : l'URL ou la clé publique Supabase est invalide."
  );
}

// Création du client Supabase
export const supabase = createClient(
  URL,
  PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "nexora-auth-token"
    },
    global: {
      headers: {
        "X-Client-Info": "nexora-web"
      }
    }
  }
);