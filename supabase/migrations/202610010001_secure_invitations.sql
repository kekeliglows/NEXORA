
-- ============================================================
-- NEXORA
-- Migration : système sécurisé d'invitations
-- ============================================================

-- 1. TABLE DES INVITATIONS

CREATE TABLE IF NOT EXISTS public.organization_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE CASCADE,

    email TEXT NOT NULL,
    role TEXT NOT NULL
        CHECK (role IN ('admin', 'employee')),

    invited_by UUID NOT NULL
        REFERENCES auth.users(id)
        ON DELETE RESTRICT,

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
    accepted_at TIMESTAMPTZ,

    CONSTRAINT invitation_email_not_empty
        CHECK (length(trim(email)) > 0),

    CONSTRAINT invitation_expiration_valid
        CHECK (expires_at > created_at),

    CONSTRAINT invitation_acceptance_valid
        CHECK (
            (status = 'accepted' AND accepted_at IS NOT NULL)
            OR
            (status <> 'accepted' AND accepted_at IS NULL)
        )
);

-- 2. INDEX POUR LES RECHERCHES

CREATE INDEX IF NOT EXISTS
    idx_invitations_organization
ON public.organization_invitations (organization_id);

CREATE INDEX IF NOT EXISTS
    idx_invitations_email
ON public.organization_invitations (lower(email));

CREATE INDEX IF NOT EXISTS
    idx_invitations_expiration
ON public.organization_invitations (expires_at)
WHERE status = 'pending';

-- Une seule invitation en attente par adresse et organisation.
CREATE UNIQUE INDEX IF NOT EXISTS
    idx_unique_pending_invitation
ON public.organization_invitations (
    organization_id,
    lower(email)
)
WHERE status = 'pending';

-- 3. ACTIVER LA PROTECTION RLS

ALTER TABLE public.organization_invitations
ENABLE ROW LEVEL SECURITY;

-- Aucun accès direct depuis le navigateur.
REVOKE ALL
ON TABLE public.organization_invitations
FROM anon, authenticated;

-- 4. FONCTION D'ACCEPTATION

CREATE OR REPLACE FUNCTION public.accept_organization_invitation(
    p_invitation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_user_email TEXT;
    v_email_confirmed_at TIMESTAMPTZ;
    v_invitation public.organization_invitations%ROWTYPE;
    v_existing_membership UUID;
BEGIN
    -- Vérifier la session.
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentification requise.';
    END IF;

    -- Vérifier l'adresse et la confirmation du compte.
    SELECT
        lower(u.email),
        u.email_confirmed_at
    INTO
        v_user_email,
        v_email_confirmed_at
    FROM auth.users AS u
    WHERE u.id = v_user_id;

    IF v_user_email IS NULL THEN
        RAISE EXCEPTION 'Adresse e-mail introuvable.';
    END IF;

    IF v_email_confirmed_at IS NULL THEN
        RAISE EXCEPTION 'Vous devez confirmer votre adresse e-mail.';
    END IF;

    -- Verrouiller l'invitation pendant son traitement.
    SELECT *
    INTO v_invitation
    FROM public.organization_invitations AS i
    WHERE i.id = p_invitation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation introuvable.';
    END IF;

    -- Vérifier l'adresse du destinataire.
    IF lower(v_invitation.email) <> v_user_email THEN
        RAISE EXCEPTION
            'Cette invitation ne correspond pas à votre adresse e-mail.';
    END IF;

    -- Une invitation ne peut être acceptée qu'une fois.
    IF v_invitation.status <> 'pending' THEN
        RAISE EXCEPTION 'Cette invitation n''est plus valide.';
    END IF;

    -- Expiration.
    IF v_invitation.expires_at <= now() THEN
        UPDATE public.organization_invitations
        SET status = 'expired'
        WHERE id = v_invitation.id;

        RAISE EXCEPTION 'Cette invitation a expiré.';
    END IF;

    -- Vérifier que l'utilisateur n'est pas déjà membre.
    SELECT m.id
    INTO v_existing_membership
    FROM public.organization_members AS m
    WHERE m.organization_id = v_invitation.organization_id
      AND m.user_id = v_user_id
    LIMIT 1;

    IF v_existing_membership IS NOT NULL THEN
        RAISE EXCEPTION
            'Vous êtes déjà membre de cette organisation.';
    END IF;

    -- Accorder l'accès seulement après validation.
    INSERT INTO public.organization_members (
        organization_id,
        user_id,
        role
    )
    VALUES (
        v_invitation.organization_id,
        v_user_id,
        v_invitation.role
    );

    -- Marquer l'invitation comme acceptée.
    UPDATE public.organization_invitations
    SET
        status = 'accepted',
        accepted_at = now()
    WHERE id = v_invitation.id;

    RETURN jsonb_build_object(
        'success', true,
        'organization_id', v_invitation.organization_id,
        'role', v_invitation.role
    );
END;
$$;

-- 5. AUTORISER UNIQUEMENT LES UTILISATEURS CONNECTÉS

REVOKE ALL
ON FUNCTION public.accept_organization_invitation(UUID)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.accept_organization_invitation(UUID)
TO authenticated;