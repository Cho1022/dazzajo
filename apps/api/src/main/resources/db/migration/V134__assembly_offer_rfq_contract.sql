ALTER TABLE assembly_offers
    ADD COLUMN warranty_days INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN proposal_message VARCHAR(500);

ALTER TABLE assembly_offers
    ADD CONSTRAINT chk_assembly_offers_warranty_days
    CHECK (warranty_days BETWEEN 0 AND 365);
