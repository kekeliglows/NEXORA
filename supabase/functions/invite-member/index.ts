import { createClient } from "npm:@supabase/supabase-js@2";

/* ============================================================
   1. CONFIGURATION
   ============================================================ */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "";

const ALLOWED_ROLES = ["admin", "employee"] as const;
type InviteRole = typeof ALLOWED_ROLES[number];

type InviteRequest = {
  organizationId: string;
  email: string;
  role: InviteRole;
};

/* ============================================================
   2. VALIDATION DE LA CONFIGURATION
   ============================================================ */

function getConfiguredOrigin(): string {
  try {
    const url = new URL(APP_URL);
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname))
    ) {
      return "";
    }
    return url.origin;
  } catch {
    return "";
  }
}

const CONFIGURED_ORIGIN = getConfiguredOrigin();

function isValidConfiguration(): boolean {
  try {
    const url = new URL(SUPABASE_URL);

    // ✅ Correction : ne pas exiger le préfixe "sb_".
    // Les clés anon peuvent être des JWT (eyJ...) ou sb_publishable_...
    return (
      url.protocol === "https:" &&
      url.hostname.endsWith(".supabase.co") &&
      SUPABASE_ANON_KEY.length > 20 &&
      SUPABASE_SERVICE_ROLE_KEY.length > 20 &&
      Boolean(CONFIGURED_ORIGIN)
    );
  } catch {
    return false;
  }
}

/* ============================================================
   3. CORS
   ============================================================ */

const ALLOWED_ORIGINS = new Set([
  CONFIGURED_ORIGIN,
  "http://127.0.0.1:5500",
  "http://localhost:5500",
].filter(Boolean));

const CORS_HEADERS = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

function withCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);

  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    headers.set(key, value);
  });

  // ✅ Correction : toujours renvoyer l'origine autorisée,
  // même sur les réponses d'erreur du préflight.
  if (origin && isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/* ============================================================
   4. RÉPONSES JSON
   ============================================================ */

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ success: false, error: message }, status);
}

/* ============================================================
   5. VALIDATION DES DONNÉES
   ============================================================ */

function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  if (value.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidRole(value: unknown): value is InviteRole {
  return typeof value === "string" &&
    ALLOWED_ROLES.includes(value as InviteRole);
}

/* ============================================================
   6. CLIENTS SUPABASE
   ============================================================ */

function createUserClient(accessToken: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

function createAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/* ============================================================
   7. VÉRIFICATION DES AUTORISATIONS
   ============================================================ */

async function checkInviterPermissions(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  userId: string,
  roleToInvite: InviteRole,
): Promise<{ allowed: boolean; error?: string; status?: number }> {
  const { data: membership, error } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Vérification du rôle :", error);
    return {
      allowed: false,
      error: "Impossible de vérifier vos autorisations.",
      status: 500,
    };
  }

  if (!membership) {
    return {
      allowed: false,
      error: "Vous ne faites pas partie de cette organisation.",
      status: 403,
    };
  }

  if (!["owner", "admin"].includes(membership.role)) {
    return {
      allowed: false,
      error: "Vous n'avez pas l'autorisation d'inviter des membres.",
      status: 403,
    };
  }

  if (roleToInvite === "admin" && membership.role !== "owner") {
    return {
      allowed: false,
      error: "Seul le propriétaire peut inviter un administrateur.",
      status: 403,
    };
  }

  return { allowed: true };
}

/* ============================================================
   8. RECHERCHE D'UN COMPTE EXISTANT
   ============================================================ */

async function findExistingUser(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<{ id: string | null; error: boolean }> {
  for (let page = 1; page <= 500; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) {
      console.error("Recherche de compte :", error);
      return { id: null, error: true };
    }

    const users = data.users ?? [];
    const existingUser = users.find(
      (user) => user.email && normalizeEmail(user.email) === email,
    );

    if (existingUser) return { id: existingUser.id, error: false };
    if (users.length < 200) return { id: null, error: false };
  }

  return { id: null, error: true };
}

/* ============================================================
   9. CRÉATION DE L'INVITATION
   ============================================================ */

async function createInvitation(
  admin: ReturnType<typeof createAdminClient>,
  input: InviteRequest,
  inviterId: string,
): Promise<Response> {
  const { organizationId, email, role } = input;

  const { data: inviter, error: inviterError } =
    await admin.auth.admin.getUserById(inviterId);

  if (inviterError || !inviter.user) {
    return errorResponse("Impossible de vérifier votre compte.", 401);
  }

  if (
    inviter.user.email &&
    normalizeEmail(inviter.user.email) === email
  ) {
    return errorResponse("Vous ne pouvez pas vous inviter vous-même.", 400);
  }

  const permission = await checkInviterPermissions(
    admin, organizationId, inviterId, role,
  );

  if (!permission.allowed) {
    return errorResponse(
      permission.error ?? "Accès refusé.",
      permission.status ?? 403,
    );
  }

  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .select("id, name")
    .eq("id", organizationId)
    .maybeSingle();

  if (organizationError) {
    console.error("Organisation :", organizationError);
    return errorResponse("Impossible de vérifier l'organisation.", 500);
  }

  if (!organization) {
    return errorResponse("Organisation introuvable.", 404);
  }

  const existingUser = await findExistingUser(admin, email);

  if (existingUser.error) {
    return errorResponse("Impossible de vérifier l'adresse e-mail.", 503);
  }

  if (existingUser.id) {
    const { data: existingMembership, error: memberError } = await admin
      .from("organization_members")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("user_id", existingUser.id)
      .maybeSingle();

    if (memberError) {
      console.error("Recherche du membre :", memberError);
      return errorResponse(
        "Impossible de vérifier les membres existants.", 500,
      );
    }

    if (existingMembership) {
      return errorResponse(
        "Cette personne est déjà membre de l'organisation.", 409,
      );
    }

    return errorResponse(
      "Cette adresse possède déjà un compte NEXORA. " +
        "L'invitation d'un compte existant nécessite une procédure dédiée.",
      409,
    );
  }

  const { data: pending, error: pendingError } = await admin
    .from("organization_invitations")
    .select("id, expires_at")
    .eq("organization_id", organizationId)
    .eq("email", email)
    .eq("status", "pending")
    .limit(1);

  if (pendingError) {
    console.error("Recherche d'invitation :", pendingError);
    return errorResponse(
      "Impossible de vérifier les invitations existantes.", 500,
    );
  }

  if (pending?.length) {
    const invitation = pending[0];

    if (new Date(invitation.expires_at).getTime() > Date.now()) {
      return errorResponse(
        "Une invitation est déjà en attente pour cette adresse.", 409,
      );
    }

    const { error: expireError } = await admin
      .from("organization_invitations")
      .update({ status: "expired" })
      .eq("id", invitation.id)
      .eq("status", "pending");

    if (expireError) {
      console.error("Expiration :", expireError);
      return errorResponse("Impossible de renouveler l'invitation.", 500);
    }
  }

  const { data: invitation, error: insertError } = await admin
    .from("organization_invitations")
    .insert({
      organization_id: organizationId,
      email,
      role,
      invited_by: inviterId,
      status: "pending",
    })
    .select("id, expires_at")
    .single();

  if (insertError || !invitation) {
    console.error("Création de l'invitation :", insertError);
    return errorResponse(
      "Impossible d'enregistrer l'invitation. Réessayez.", 500,
    );
  }

  const redirectUrl = new URL(
    "connexion.html",
    APP_URL.endsWith("/") ? APP_URL : `${APP_URL}/`,
  );
  redirectUrl.searchParams.set("invitation", invitation.id);

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    email,
    {
      redirectTo: redirectUrl.toString(),
      data: {
        invitation_id: invitation.id,
        organization_name: organization.name,
        invitation_role: role,
        invitation_source: "nexora",
      },
    },
  );

  if (inviteError) {
    console.error("Envoi de l'invitation :", inviteError);

    const { error: revokeError } = await admin
      .from("organization_invitations")
      .update({ status: "revoked" })
      .eq("id", invitation.id)
      .eq("status", "pending");

    if (revokeError) {
      console.error("Annulation de l'invitation :", revokeError);
    }

    return errorResponse(
      "L'envoi de l'invitation a échoué. " +
        "Vérifiez la configuration e-mail de Supabase avant de réessayer.",
      502,
    );
  }

  return jsonResponse(
    {
      success: true,
      message: "L'invitation a été envoyée.",
      invitation: {
        id: invitation.id,
        email,
        role,
        expiresAt: invitation.expires_at,
      },
    },
    201,
  );
}

/* ============================================================
   10. POINT D'ENTRÉE
   ============================================================ */

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");

  // ✅ Correction : répondre au préflight AVANT toute vérification.
  // Sinon le navigateur bloque la requête et affiche une erreur CORS.
  if (req.method === "OPTIONS") {
    return withCors(new Response("ok", { status: 200 }), origin);
  }

  if (!isAllowedOrigin(origin)) {
    return withCors(
      errorResponse("Origine non autorisée.", 403),
      null,
    );
  }

  if (req.method !== "POST") {
    return withCors(errorResponse("Méthode non autorisée.", 405), origin);
  }

  if (!isValidConfiguration()) {
    console.error("Configuration Supabase ou APP_URL invalide.", {
      hasUrl: Boolean(SUPABASE_URL),
      hasAnon: Boolean(SUPABASE_ANON_KEY),
      hasService: Boolean(SUPABASE_SERVICE_ROLE_KEY),
      hasAppUrl: Boolean(APP_URL),
      configuredOrigin: CONFIGURED_ORIGIN,
    });

    return withCors(
      errorResponse(
        "La fonction d'invitation n'est pas correctement configurée.",
        500,
      ),
      origin,
    );
  }

  const authorization = req.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return withCors(
      errorResponse("Vous devez être connecté pour inviter un membre.", 401),
      origin,
    );
  }

  const accessToken = authorization.slice(7).trim();

  if (!accessToken) {
    return withCors(
      errorResponse("Jeton d'accès manquant.", 401),
      origin,
    );
  }

  try {
    const userClient = createUserClient(accessToken);
    const { data: authData, error: authError } =
      await userClient.auth.getUser();

    if (authError || !authData.user) {
      return withCors(
        errorResponse("Votre session est invalide ou a expiré.", 401),
        origin,
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return withCors(
        errorResponse("Le corps de la requête doit être un JSON valide.", 400),
        origin,
      );
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return withCors(
        errorResponse("Les données de l'invitation sont invalides.", 400),
        origin,
      );
    }

    const input = body as Record<string, unknown>;

    const organizationId =
      typeof input.organizationId === "string"
        ? input.organizationId.trim()
        : "";
    const email =
      typeof input.email === "string"
        ? normalizeEmail(input.email)
        : "";
    const role = input.role;

    if (!isValidUUID(organizationId)) {
      return withCors(
        errorResponse("L'identifiant de l'organisation est invalide.", 400),
        origin,
      );
    }

    if (!isValidEmail(email)) {
      return withCors(
        errorResponse("Veuillez saisir une adresse e-mail valide.", 400),
        origin,
      );
    }

    if (!isValidRole(role)) {
      return withCors(
        errorResponse("Le rôle sélectionné est invalide.", 400),
        origin,
      );
    }

    const admin = createAdminClient();
    const response = await createInvitation(
      admin,
      { organizationId, email, role },
      authData.user.id,
    );

    return withCors(response, origin);
  } catch (error) {
    console.error("Erreur inattendue :", error);

    return withCors(
      errorResponse(
        "Une erreur inattendue est survenue lors de l'invitation.",
        500,
      ),
      origin,
    );
  }
});