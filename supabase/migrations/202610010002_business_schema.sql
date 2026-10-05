-- ============================================================
-- NEXORA
-- Migration : structure de la base métier (Étape 5)
-- Version   : 2 — alignée sur les tables existantes
-- ============================================================
--
-- Cette migration :
--   1. NE droppe RIEN (données conservées)
--   2. Ajoute les colonnes manquantes (ADD COLUMN IF NOT EXISTS)
--   3. Crée les fonctions utilitaires RLS
--   4. Active RLS + politiques sur toutes les tables
--   5. Crée les vues et fonctions métier
--
-- Tables concernées (déjà présentes dans Supabase) :
--   products, stock_movements, customers, suppliers,
--   sales, sale_items, purchases, purchase_items,
--   expenses
--
-- Table à créer (absente) :
--   payments
-- ============================================================


-- ============================================================
-- FONCTIONS UTILITAIRES RLS
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_member(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.organization_members AS m
        WHERE m.organization_id = p_org_id
          AND m.user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.is_owner_or_admin(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.organization_members AS m
        WHERE m.organization_id = p_org_id
          AND m.user_id = auth.uid()
          AND m.role IN ('owner', 'admin')
    );
$$;

-- Trigger updated_at générique
DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;

CREATE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


-- ============================================================
-- 1. PRODUCTS
-- Existant : id, organization_id, name, sku, description,
--            category, unit_price, purchase_price, stock_min,
--            is_active, created_by, created_at, updated_at
-- Manquant  : sale_price (alias de unit_price), updated_at ✅
-- Action    : ajouter sale_price comme colonne séparée
-- ============================================================

-- sale_price est le prix public (unit_price = ancien nom)
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS sale_price NUMERIC(15,4)
        NOT NULL DEFAULT 0
        CHECK (sale_price >= 0);

-- Copier unit_price → sale_price pour les lignes existantes
UPDATE public.products
SET sale_price = unit_price
WHERE sale_price = 0 AND unit_price > 0;

-- Contraintes manquantes
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'product_name_not_empty'
          AND conrelid = 'public.products'::regclass
    ) THEN
        ALTER TABLE public.products
            ADD CONSTRAINT product_name_not_empty
                CHECK (length(trim(name)) > 0);
    END IF;
END $$;

-- Index
CREATE INDEX IF NOT EXISTS idx_products_org
    ON public.products (organization_id);

CREATE INDEX IF NOT EXISTS idx_products_category
    ON public.products (organization_id, category);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku
    ON public.products (organization_id, lower(sku))
    WHERE sku IS NOT NULL AND is_active = TRUE;

-- Trigger updated_at (déjà géré côté app mais sécurisé ici)
DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_select" ON public.products;
DROP POLICY IF EXISTS "products_insert" ON public.products;
DROP POLICY IF EXISTS "products_update" ON public.products;
DROP POLICY IF EXISTS "products_delete" ON public.products;

CREATE POLICY "products_select" ON public.products
    FOR SELECT USING (public.is_member(organization_id));

CREATE POLICY "products_insert" ON public.products
    FOR INSERT WITH CHECK (public.is_member(organization_id));

CREATE POLICY "products_update" ON public.products
    FOR UPDATE
    USING (public.is_member(organization_id))
    WITH CHECK (public.is_member(organization_id));

CREATE POLICY "products_delete" ON public.products
    FOR DELETE USING (public.is_owner_or_admin(organization_id));


-- ============================================================
-- 2. STOCK_MOVEMENTS
-- Existant : id, organization_id, product_id, movement_type,
--            quantity, reference_type, reference_id, reason,
--            created_by, created_at
-- Manquant  : rien ✅  (structure déjà correcte)
-- ============================================================

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'stock_movement_quantity_positive'
          AND conrelid = 'public.stock_movements'::regclass
    ) THEN
        ALTER TABLE public.stock_movements
            ADD CONSTRAINT stock_movement_quantity_positive
                CHECK (quantity > 0);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'stock_movement_type_valid'
          AND conrelid = 'public.stock_movements'::regclass
    ) THEN
        ALTER TABLE public.stock_movements
            ADD CONSTRAINT stock_movement_type_valid
                CHECK (movement_type IN (
                    'purchase', 'sale',
                    'adjustment_in', 'adjustment_out',
                    'return_in', 'return_out'
                ));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stock_movements_product
    ON public.stock_movements (product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_org
    ON public.stock_movements (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_reference
    ON public.stock_movements (reference_id)
    WHERE reference_id IS NOT NULL;

-- RLS
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_movements_select" ON public.stock_movements;
DROP POLICY IF EXISTS "stock_movements_insert" ON public.stock_movements;

CREATE POLICY "stock_movements_select" ON public.stock_movements
    FOR SELECT USING (public.is_member(organization_id));

CREATE POLICY "stock_movements_insert" ON public.stock_movements
    FOR INSERT WITH CHECK (public.is_member(organization_id));


-- ============================================================
-- 3. CUSTOMERS
-- Existant : id, organization_id, name, email, phone,
--            address, city, notes, is_active,
--            created_by, created_at, updated_at
-- Manquant  : country, tax_number, category
-- ============================================================

ALTER TABLE public.customers
    ADD COLUMN IF NOT EXISTS country     TEXT,
    ADD COLUMN IF NOT EXISTS tax_number  TEXT,
    ADD COLUMN IF NOT EXISTS category    TEXT;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'customer_name_not_empty'
          AND conrelid = 'public.customers'::regclass
    ) THEN
        ALTER TABLE public.customers
            ADD CONSTRAINT customer_name_not_empty
                CHECK (length(trim(name)) > 0);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customers_org
    ON public.customers (organization_id);

CREATE INDEX IF NOT EXISTS idx_customers_name
    ON public.customers (organization_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_customers_email
    ON public.customers (organization_id, lower(email))
    WHERE email IS NOT NULL;

DROP TRIGGER IF EXISTS trg_customers_updated_at ON public.customers;
CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customers_select" ON public.customers;
DROP POLICY IF EXISTS "customers_insert" ON public.customers;
DROP POLICY IF EXISTS "customers_update" ON public.customers;
DROP POLICY IF EXISTS "customers_delete" ON public.customers;

CREATE POLICY "customers_select" ON public.customers
    FOR SELECT USING (public.is_member(organization_id));

CREATE POLICY "customers_insert" ON public.customers
    FOR INSERT WITH CHECK (public.is_member(organization_id));

CREATE POLICY "customers_update" ON public.customers
    FOR UPDATE
    USING (public.is_member(organization_id))
    WITH CHECK (public.is_member(organization_id));

CREATE POLICY "customers_delete" ON public.customers
    FOR DELETE USING (public.is_owner_or_admin(organization_id));


-- ============================================================
-- 4. SUPPLIERS
-- Existant : id, organization_id, name, email, phone,
--            address, city, notes, is_active,
--            created_by, created_at, updated_at
-- Manquant  : country, tax_number, category
-- ============================================================

ALTER TABLE public.suppliers
    ADD COLUMN IF NOT EXISTS country     TEXT,
    ADD COLUMN IF NOT EXISTS tax_number  TEXT,
    ADD COLUMN IF NOT EXISTS category    TEXT;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'supplier_name_not_empty'
          AND conrelid = 'public.suppliers'::regclass
    ) THEN
        ALTER TABLE public.suppliers
            ADD CONSTRAINT supplier_name_not_empty
                CHECK (length(trim(name)) > 0);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_suppliers_org
    ON public.suppliers (organization_id);

CREATE INDEX IF NOT EXISTS idx_suppliers_name
    ON public.suppliers (organization_id, lower(name));

DROP TRIGGER IF EXISTS trg_suppliers_updated_at ON public.suppliers;
CREATE TRIGGER trg_suppliers_updated_at
    BEFORE UPDATE ON public.suppliers
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suppliers_select" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers_insert" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers_update" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers_delete" ON public.suppliers;

CREATE POLICY "suppliers_select" ON public.suppliers
    FOR SELECT USING (public.is_member(organization_id));

CREATE POLICY "suppliers_insert" ON public.suppliers
    FOR INSERT WITH CHECK (public.is_member(organization_id));

CREATE POLICY "suppliers_update" ON public.suppliers
    FOR UPDATE
    USING (public.is_member(organization_id))
    WITH CHECK (public.is_member(organization_id));

CREATE POLICY "suppliers_delete" ON public.suppliers
    FOR DELETE USING (public.is_owner_or_admin(organization_id));


-- ============================================================
-- 5. SALES
-- Existant : id, organization_id, customer_id, reference,
--            status, payment_status, subtotal, discount,
--            tax, total, payment_method, notes,
--            created_by, created_at
-- Manquant  : sale_date, due_date, updated_at,
--             tax_amount (renommage de tax),
--             discount_amount (renommage de discount),
--             total_amount (renommage de total),
--             paid_amount
-- Stratégie : ajouter les nouvelles colonnes, garder les
--             anciennes pour compatibilité
-- ============================================================

ALTER TABLE public.sales
    ADD COLUMN IF NOT EXISTS sale_date       DATE
        NOT NULL DEFAULT CURRENT_DATE,
    ADD COLUMN IF NOT EXISTS due_date        DATE,
    ADD COLUMN IF NOT EXISTS tax_amount      NUMERIC(15,4)
        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(15,4)
        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_amount    NUMERIC(15,4)
        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS paid_amount     NUMERIC(15,4)
        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ
        NOT NULL DEFAULT now();

-- Initialiser depuis les colonnes existantes
UPDATE public.sales SET
    tax_amount      = COALESCE(tax, 0),
    discount_amount = COALESCE(discount, 0),
    total_amount    = COALESCE(total, 0),
    sale_date       = COALESCE(created_at::DATE, CURRENT_DATE)
WHERE total_amount = 0;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sale_reference_not_empty'
          AND conrelid = 'public.sales'::regclass
    ) THEN
        ALTER TABLE public.sales
            ADD CONSTRAINT sale_reference_not_empty
                CHECK (length(trim(reference)) > 0);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_reference
    ON public.sales (organization_id, reference);

CREATE INDEX IF NOT EXISTS idx_sales_org_date
    ON public.sales (organization_id, sale_date DESC);

CREATE INDEX IF NOT EXISTS idx_sales_customer
    ON public.sales (customer_id)
    WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_status
    ON public.sales (organization_id, status);

DROP TRIGGER IF EXISTS trg_sales_updated_at ON public.sales;
CREATE TRIGGER trg_sales_updated_at
    BEFORE UPDATE ON public.sales
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_select" ON public.sales;
DROP POLICY IF EXISTS "sales_insert" ON public.sales;
DROP POLICY IF EXISTS "sales_update" ON public.sales;
DROP POLICY IF EXISTS "sales_delete" ON public.sales;

CREATE POLICY "sales_select" ON public.sales
    FOR SELECT USING (public.is_member(organization_id));

CREATE POLICY "sales_insert" ON public.sales
    FOR INSERT WITH CHECK (public.is_member(organization_id));

CREATE POLICY "sales_update" ON public.sales
    FOR UPDATE
    USING (public.is_member(organization_id))
    WITH CHECK (public.is_member(organization_id));

CREATE POLICY "sales_delete" ON public.sales
    FOR DELETE USING (public.is_owner_or_admin(organization_id));


-- ============================================================
-- 6. SALE_ITEMS
-- Existant : id, sale_id, product_id, quantity,
--            unit_price, discount, total, created_at
-- Manquant  : organization_id, product_name, tax_rate,
--             discount_rate, line_total, sort_order
-- ============================================================

ALTER TABLE public.sale_items
    ADD COLUMN IF NOT EXISTS organization_id UUID
        REFERENCES public.organizations(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS product_name    TEXT
        NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS tax_rate        NUMERIC(5,4)
        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_rate   NUMERIC(5,4)
        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS line_total      NUMERIC(15,4)
        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sort_order      SMALLINT
        NOT NULL DEFAULT 0;

-- Remplir organization_id depuis la vente parente
UPDATE public.sale_items si
SET organization_id = s.organization_id
FROM public.sales s
WHERE si.sale_id = s.id
  AND si.organization_id IS NULL;

-- Remplir product_name depuis le catalogue
UPDATE public.sale_items si
SET product_name = p.name
FROM public.products p
WHERE si.product_id = p.id
  AND si.product_name = '';

-- Remplir line_total depuis total existant
UPDATE public.sale_items
SET line_total = COALESCE(total, 0)
WHERE line_total = 0;

-- Remplir discount_rate depuis discount (supposé être un %)
UPDATE public.sale_items
SET discount_rate = LEAST(COALESCE(discount, 0) / 100.0, 1)
WHERE discount_rate = 0 AND discount > 0;

CREATE INDEX IF NOT EXISTS idx_sale_items_sale
    ON public.sale_items (sale_id);

CREATE INDEX IF NOT EXISTS idx_sale_items_product
    ON public.sale_items (product_id)
    WHERE product_id IS NOT NULL;

-- RLS (basée sur organization_id maintenant présent)
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sale_items_select" ON public.sale_items;
DROP POLICY IF EXISTS "sale_items_insert" ON public.sale_items;
DROP POLICY IF EXISTS "sale_items_update" ON public.sale_items;
DROP POLICY IF EXISTS "sale_items_delete" ON public.sale_items;

CREATE POLICY "sale_items_select" ON public.sale_items
    FOR SELECT USING (
        organization_id IS NOT NULL
        AND public.is_member(organization_id)
    );

CREATE POLICY "sale_items_insert" ON public.sale_items
    FOR INSERT WITH CHECK (
        organization_id IS NOT NULL
        AND public.is_member(organization_id)
    );

CREATE POLICY "sale_items_update" ON public.sale_items
    FOR UPDATE
    USING (organization_id IS NOT NULL AND public.is_member(organization_id))
    WITH CHECK (organization_id IS NOT NULL AND public.is_member(organization_id));

CREATE POLICY "sale_items_delete" ON public.sale_items
    FOR DELETE USING (
        organization_id IS NOT NULL
        AND public.is_member(organization_id)
    );


-- ============================================================
-- 7. PURCHASES
-- Existant : id, organization_id, supplier_id, reference,
--            status, payment_status, subtotal, discount,
--            tax, total, payment_method, notes,
--            created_by, created_at
-- Manquant  : purchase_date, due_date, updated_at,
--             tax_amount, discount_amount, total_amount,
--             paid_amount
-- ============================================================

ALTER TABLE public.purchases
    ADD COLUMN IF NOT EXISTS purchase_date   DATE
        NOT NULL DEFAULT CURRENT_DATE,
    ADD COLUMN IF NOT EXISTS due_date        DATE,
    ADD COLUMN IF NOT EXISTS tax_amount      NUMERIC(15,4)
        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(15,4)
        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_amount    NUMERIC(15,4)
        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS paid_amount     NUMERIC(15,4)
        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ
        NOT NULL DEFAULT now();

UPDATE public.purchases SET
    tax_amount      = COALESCE(tax, 0),
    discount_amount = COALESCE(discount, 0),
    total_amount    = COALESCE(total, 0),
    purchase_date   = COALESCE(created_at::DATE, CURRENT_DATE)
WHERE total_amount = 0;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'purchase_reference_not_empty'
          AND conrelid = 'public.purchases'::regclass
    ) THEN
        ALTER TABLE public.purchases
            ADD CONSTRAINT purchase_reference_not_empty
                CHECK (length(trim(reference)) > 0);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_reference
    ON public.purchases (organization_id, reference);

CREATE INDEX IF NOT EXISTS idx_purchases_org_date
    ON public.purchases (organization_id, purchase_date DESC);

CREATE INDEX IF NOT EXISTS idx_purchases_supplier
    ON public.purchases (supplier_id)
    WHERE supplier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_status
    ON public.purchases (organization_id, status);

DROP TRIGGER IF EXISTS trg_purchases_updated_at ON public.purchases;
CREATE TRIGGER trg_purchases_updated_at
    BEFORE UPDATE ON public.purchases
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchases_select" ON public.purchases;
DROP POLICY IF EXISTS "purchases_insert" ON public.purchases;
DROP POLICY IF EXISTS "purchases_update" ON public.purchases;
DROP POLICY IF EXISTS "purchases_delete" ON public.purchases;

CREATE POLICY "purchases_select" ON public.purchases
    FOR SELECT USING (public.is_member(organization_id));

CREATE POLICY "purchases_insert" ON public.purchases
    FOR INSERT WITH CHECK (public.is_member(organization_id));

CREATE POLICY "purchases_update" ON public.purchases
    FOR UPDATE
    USING (public.is_member(organization_id))
    WITH CHECK (public.is_member(organization_id));

CREATE POLICY "purchases_delete" ON public.purchases
    FOR DELETE USING (public.is_owner_or_admin(organization_id));


-- ============================================================
-- 8. PURCHASE_ITEMS
-- Existant : id, purchase_id, product_id, quantity,
--            unit_price, discount, total, created_at
-- Manquant  : organization_id, product_name, tax_rate,
--             discount_rate, line_total, sort_order
-- ============================================================

ALTER TABLE public.purchase_items
    ADD COLUMN IF NOT EXISTS organization_id UUID
        REFERENCES public.organizations(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS product_name    TEXT
        NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS tax_rate        NUMERIC(5,4)
        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_rate   NUMERIC(5,4)
        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS line_total      NUMERIC(15,4)
        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sort_order      SMALLINT
        NOT NULL DEFAULT 0;

UPDATE public.purchase_items pi
SET organization_id = p.organization_id
FROM public.purchases p
WHERE pi.purchase_id = p.id
  AND pi.organization_id IS NULL;

UPDATE public.purchase_items pi
SET product_name = pr.name
FROM public.products pr
WHERE pi.product_id = pr.id
  AND pi.product_name = '';

UPDATE public.purchase_items
SET line_total = COALESCE(total, 0)
WHERE line_total = 0;

UPDATE public.purchase_items
SET discount_rate = LEAST(COALESCE(discount, 0) / 100.0, 1)
WHERE discount_rate = 0 AND discount > 0;

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase
    ON public.purchase_items (purchase_id);

CREATE INDEX IF NOT EXISTS idx_purchase_items_product
    ON public.purchase_items (product_id)
    WHERE product_id IS NOT NULL;

-- RLS
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_items_select" ON public.purchase_items;
DROP POLICY IF EXISTS "purchase_items_insert" ON public.purchase_items;
DROP POLICY IF EXISTS "purchase_items_update" ON public.purchase_items;
DROP POLICY IF EXISTS "purchase_items_delete" ON public.purchase_items;

CREATE POLICY "purchase_items_select" ON public.purchase_items
    FOR SELECT USING (
        organization_id IS NOT NULL
        AND public.is_member(organization_id)
    );

CREATE POLICY "purchase_items_insert" ON public.purchase_items
    FOR INSERT WITH CHECK (
        organization_id IS NOT NULL
        AND public.is_member(organization_id)
    );

CREATE POLICY "purchase_items_update" ON public.purchase_items
    FOR UPDATE
    USING (organization_id IS NOT NULL AND public.is_member(organization_id))
    WITH CHECK (organization_id IS NOT NULL AND public.is_member(organization_id));

CREATE POLICY "purchase_items_delete" ON public.purchase_items
    FOR DELETE USING (
        organization_id IS NOT NULL
        AND public.is_member(organization_id)
    );


-- ============================================================
-- 9. EXPENSES
-- Existant : id, organization_id, category, description,
--            amount, payment_method, expense_date,
--            created_by, created_at
-- Manquant  : label (description = ancien nom), status,
--             tax_amount, supplier_id, notes, receipt_url,
--             updated_at
-- ============================================================

ALTER TABLE public.expenses
    ADD COLUMN IF NOT EXISTS label        TEXT
        NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS status       TEXT
        NOT NULL DEFAULT 'paid'
        CHECK (status IN ('pending', 'paid', 'cancelled')),
    ADD COLUMN IF NOT EXISTS tax_amount   NUMERIC(15,4)
        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS supplier_id  UUID
        REFERENCES public.suppliers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS notes        TEXT,
    ADD COLUMN IF NOT EXISTS receipt_url  TEXT,
    ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ
        NOT NULL DEFAULT now();

-- Copier description → label pour les lignes existantes
UPDATE public.expenses
SET label = COALESCE(description, '')
WHERE label = '';

-- Contrainte sur payment_method
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'expense_payment_method_valid'
          AND conrelid = 'public.expenses'::regclass
    ) THEN
        ALTER TABLE public.expenses
            ADD CONSTRAINT expense_payment_method_valid
                CHECK (payment_method IN (
                    'cash', 'bank_transfer', 'card', 'check', 'other'
                ));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_expenses_org_date
    ON public.expenses (organization_id, expense_date DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_category
    ON public.expenses (organization_id, category);

CREATE INDEX IF NOT EXISTS idx_expenses_status
    ON public.expenses (organization_id, status);

DROP TRIGGER IF EXISTS trg_expenses_updated_at ON public.expenses;
CREATE TRIGGER trg_expenses_updated_at
    BEFORE UPDATE ON public.expenses
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expenses_select" ON public.expenses;
DROP POLICY IF EXISTS "expenses_insert" ON public.expenses;
DROP POLICY IF EXISTS "expenses_update" ON public.expenses;
DROP POLICY IF EXISTS "expenses_delete" ON public.expenses;

CREATE POLICY "expenses_select" ON public.expenses
    FOR SELECT USING (public.is_member(organization_id));

CREATE POLICY "expenses_insert" ON public.expenses
    FOR INSERT WITH CHECK (public.is_member(organization_id));

CREATE POLICY "expenses_update" ON public.expenses
    FOR UPDATE
    USING (public.is_member(organization_id))
    WITH CHECK (public.is_member(organization_id));

CREATE POLICY "expenses_delete" ON public.expenses
    FOR DELETE USING (public.is_owner_or_admin(organization_id));


-- ============================================================
-- 10. PAYMENTS (nouvelle table — absente de la base)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payments (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID          NOT NULL
                                  REFERENCES public.organizations(id)
                                  ON DELETE CASCADE,

    payment_type    TEXT          NOT NULL
                                  CHECK (payment_type IN (
                                      'sale_payment',
                                      'purchase_payment',
                                      'expense_payment'
                                  )),

    reference_id    UUID          NOT NULL,

    amount          NUMERIC(15,4) NOT NULL CHECK (amount > 0),

    payment_date    DATE          NOT NULL DEFAULT CURRENT_DATE,

    payment_method  TEXT          NOT NULL DEFAULT 'cash'
                                  CHECK (payment_method IN (
                                      'cash', 'bank_transfer',
                                      'card', 'check', 'other'
                                  )),

    notes           TEXT,

    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by      UUID          REFERENCES auth.users(id)
                                  ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_org_date
    ON public.payments (organization_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_payments_reference
    ON public.payments (reference_id);

CREATE INDEX IF NOT EXISTS idx_payments_type
    ON public.payments (organization_id, payment_type);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payments_select" ON public.payments
    FOR SELECT USING (public.is_member(organization_id));

CREATE POLICY "payments_insert" ON public.payments
    FOR INSERT WITH CHECK (public.is_member(organization_id));


-- ============================================================
-- VUE : stock_levels
-- Stock actuel par produit calculé depuis stock_movements.
-- ============================================================

CREATE OR REPLACE VIEW public.stock_levels AS
SELECT
    p.id                AS product_id,
    p.organization_id,
    p.name              AS product_name,
    p.sku,
    p.category,
    COALESCE(p.sale_price, p.unit_price, 0)  AS sale_price,
    COALESCE(p.purchase_price, 0)            AS purchase_price,
    p.stock_min,
    p.is_active,
    COALESCE(
        SUM(
            CASE
                WHEN sm.movement_type IN (
                    'purchase', 'adjustment_in', 'return_in'
                ) THEN sm.quantity
                WHEN sm.movement_type IN (
                    'sale', 'adjustment_out', 'return_out'
                ) THEN -sm.quantity
                ELSE 0
            END
        ),
        0
    ) AS current_stock,
    CASE
        WHEN COALESCE(SUM(
            CASE
                WHEN sm.movement_type IN ('purchase','adjustment_in','return_in')
                    THEN sm.quantity
                WHEN sm.movement_type IN ('sale','adjustment_out','return_out')
                    THEN -sm.quantity
                ELSE 0
            END
        ), 0) <= 0
            THEN 'empty'
        WHEN COALESCE(SUM(
            CASE
                WHEN sm.movement_type IN ('purchase','adjustment_in','return_in')
                    THEN sm.quantity
                WHEN sm.movement_type IN ('sale','adjustment_out','return_out')
                    THEN -sm.quantity
                ELSE 0
            END
        ), 0) <= p.stock_min
            THEN 'low'
        ELSE 'normal'
    END AS stock_status
FROM public.products AS p
LEFT JOIN public.stock_movements AS sm ON sm.product_id = p.id
GROUP BY
    p.id, p.organization_id, p.name, p.sku, p.category,
    p.sale_price, p.unit_price, p.purchase_price,
    p.stock_min, p.is_active;


-- ============================================================
-- VUE : sales_summary
-- ============================================================

CREATE OR REPLACE VIEW public.sales_summary AS
SELECT
    s.id,
    s.organization_id,
    s.reference,
    s.customer_id,
    c.name              AS customer_name,
    s.sale_date,
    s.due_date,
    s.status,
    COALESCE(s.total_amount, s.total, 0)        AS total_amount,
    COALESCE(s.paid_amount, 0)                  AS paid_amount,
    COALESCE(s.total_amount, s.total, 0)
        - COALESCE(s.paid_amount, 0)            AS remaining_amount,
    CASE
        WHEN s.status     = 'cancelled'                               THEN 'cancelled'
        WHEN COALESCE(s.paid_amount,0) >= COALESCE(s.total_amount, s.total, 0)
             AND COALESCE(s.total_amount, s.total, 0) > 0            THEN 'paid'
        WHEN s.due_date < CURRENT_DATE
             AND COALESCE(s.paid_amount,0)
                 < COALESCE(s.total_amount, s.total, 0)              THEN 'overdue'
        WHEN COALESCE(s.paid_amount, 0) > 0                          THEN 'partial'
        ELSE                                                               'unpaid'
    END                 AS payment_status_computed,
    s.created_at,
    s.created_by
FROM public.sales AS s
LEFT JOIN public.customers AS c ON c.id = s.customer_id;


-- ============================================================
-- VUE : purchases_summary
-- ============================================================

CREATE OR REPLACE VIEW public.purchases_summary AS
SELECT
    p.id,
    p.organization_id,
    p.reference,
    p.supplier_id,
    s.name              AS supplier_name,
    p.purchase_date,
    p.due_date,
    p.status,
    COALESCE(p.total_amount, p.total, 0)        AS total_amount,
    COALESCE(p.paid_amount, 0)                  AS paid_amount,
    COALESCE(p.total_amount, p.total, 0)
        - COALESCE(p.paid_amount, 0)            AS remaining_amount,
    CASE
        WHEN p.status     = 'cancelled'                               THEN 'cancelled'
        WHEN COALESCE(p.paid_amount,0) >= COALESCE(p.total_amount, p.total, 0)
             AND COALESCE(p.total_amount, p.total, 0) > 0            THEN 'paid'
        WHEN p.due_date < CURRENT_DATE
             AND COALESCE(p.paid_amount,0)
                 < COALESCE(p.total_amount, p.total, 0)              THEN 'overdue'
        WHEN COALESCE(p.paid_amount, 0) > 0                          THEN 'partial'
        ELSE                                                               'unpaid'
    END                 AS payment_status_computed,
    p.created_at,
    p.created_by
FROM public.purchases AS p
LEFT JOIN public.suppliers AS s ON s.id = p.supplier_id;


-- ============================================================
-- FONCTION : generate_reference
-- Génère un numéro séquentiel par org et par an.
-- Exemple : generate_reference(org_id, 'VTE', 'sales')
--        →  'VTE-2026-0001'
-- ============================================================

CREATE OR REPLACE FUNCTION public.generate_reference(
    p_org_id UUID,
    p_prefix TEXT,
    p_table  TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_year  TEXT   := to_char(now(), 'YYYY');
    v_count BIGINT;
    v_ref   TEXT;
BEGIN
    EXECUTE format(
        'SELECT COUNT(*) FROM public.%I
         WHERE organization_id = $1
           AND created_at >= $2
           AND created_at <  $3',
        p_table
    )
    INTO v_count
    USING
        p_org_id,
        (v_year || '-01-01')::TIMESTAMPTZ,
        ((v_year::INT + 1)::TEXT || '-01-01')::TIMESTAMPTZ;

    v_ref := p_prefix || '-' || v_year || '-'
             || lpad((v_count + 1)::TEXT, 4, '0');
    RETURN v_ref;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_reference(UUID, TEXT, TEXT)
    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.generate_reference(UUID, TEXT, TEXT)
    TO authenticated;
