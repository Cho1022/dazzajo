package com.buildgraph.prototype.assembly;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.buildgraph.prototype.common.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class AssemblyOfferPricePolicyTest {
    @Test
    void fullServiceUsesEstimatedPartsPriceAndAssemblyFee() {
        AssemblyOfferPricePolicy.PriceResult price =
                AssemblyOfferPricePolicy.calculate("FULL_SERVICE", 1_850_000L, 50_000L);

        assertThat(price.confirmedPartsPrice()).isEqualTo(1_850_000L);
        assertThat(price.assemblyFee()).isEqualTo(50_000L);
        assertThat(price.deliveryFee()).isZero();
        assertThat(price.finalPrice()).isEqualTo(1_900_000L);
    }

    @Test
    void assemblyOnlyIgnoresEstimatedPartsPrice() {
        AssemblyOfferPricePolicy.PriceResult price =
                AssemblyOfferPricePolicy.calculate("ASSEMBLY_ONLY", 1_850_000L, 50_000L);

        assertThat(price.confirmedPartsPrice()).isZero();
        assertThat(price.assemblyFee()).isEqualTo(50_000L);
        assertThat(price.deliveryFee()).isZero();
        assertThat(price.finalPrice()).isEqualTo(50_000L);
    }

    @Test
    void unsupportedServiceTypeUsesExistingValidationErrorStyle() {
        assertThatThrownBy(() -> AssemblyOfferPricePolicy.calculate("UNKNOWN", 1_850_000L, 50_000L))
                .isInstanceOf(ApiException.class)
                .satisfies(AssemblyOfferPricePolicyTest::assertValidationError);
    }

    @Test
    void negativeEstimatedPartsPriceUsesExistingValidationErrorStyle() {
        assertThatThrownBy(() -> AssemblyOfferPricePolicy.calculate("FULL_SERVICE", -1L, 50_000L))
                .isInstanceOf(ApiException.class)
                .satisfies(AssemblyOfferPricePolicyTest::assertValidationError);
    }

    @Test
    void negativeAssemblyFeeUsesExistingValidationErrorStyle() {
        assertThatThrownBy(() -> AssemblyOfferPricePolicy.calculate("FULL_SERVICE", 1_850_000L, -1L))
                .isInstanceOf(ApiException.class)
                .satisfies(AssemblyOfferPricePolicyTest::assertValidationError);
    }

    @Test
    void fullServiceOverflowUsesExistingValidationErrorStyle() {
        assertThatThrownBy(() -> AssemblyOfferPricePolicy.calculate("FULL_SERVICE", Long.MAX_VALUE, 1L))
                .isInstanceOf(ApiException.class)
                .satisfies(AssemblyOfferPricePolicyTest::assertValidationError);
    }

    @Test
    void fullServiceAllowsLargestNonOverflowingTotal() {
        AssemblyOfferPricePolicy.PriceResult price =
                AssemblyOfferPricePolicy.calculate("FULL_SERVICE", Long.MAX_VALUE - 1, 1L);

        assertThat(price.confirmedPartsPrice()).isEqualTo(Long.MAX_VALUE - 1);
        assertThat(price.assemblyFee()).isEqualTo(1L);
        assertThat(price.deliveryFee()).isZero();
        assertThat(price.finalPrice()).isEqualTo(Long.MAX_VALUE);
    }

    private static void assertValidationError(Throwable error) {
        ApiException apiException = (ApiException) error;
        assertThat(apiException.status()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(apiException.code()).isEqualTo("VALIDATION_ERROR");
    }
}
