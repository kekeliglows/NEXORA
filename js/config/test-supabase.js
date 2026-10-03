
import { supabase } from "./supabase.js";

const { data, error } = await supabase.auth.getSession();

if (error) {
  console.error("Erreur Supabase :", error.message);
} else {
  console.log("Connexion au client Supabase réussie.");
  console.log("Session :", data.session);
}