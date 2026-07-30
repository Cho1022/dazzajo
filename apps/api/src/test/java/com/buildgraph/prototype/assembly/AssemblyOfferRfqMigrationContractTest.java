package com.buildgraph.prototype.assembly;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class AssemblyOfferRfqMigrationContractTest {
    private static final Path MIGRATION = Path.of(
            "src/main/resources/db/migration/V134__assembly_offer_rfq_contract.sql"
    );

    @Test
    void migrationAddsWarrantyAndProposalMessageWithoutRewritingExistingOffers() throws Exception {
        String sql = Files.readString(MIGRATION).replaceAll("\\s+", " ").trim();

        assertThat(sql)
                .contains("ALTER TABLE assembly_offers")
                .contains("warranty_days INTEGER NOT NULL DEFAULT 0")
                .contains("proposal_message VARCHAR(500)")
                .contains("CONSTRAINT chk_assembly_offers_warranty_days")
                .contains("CHECK (warranty_days BETWEEN 0 AND 365)")
                .doesNotContain("UPDATE assembly_offers")
                .doesNotContain("confirmed_parts_price")
                .doesNotContain("delivery_fee")
                .doesNotContain("final_price")
                .doesNotContain("SET status");
    }
}
