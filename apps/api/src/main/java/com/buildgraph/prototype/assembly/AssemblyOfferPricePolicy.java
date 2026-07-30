package com.buildgraph.prototype.assembly;

import com.buildgraph.prototype.common.ApiException;
import org.springframework.http.HttpStatus;

final class AssemblyOfferPricePolicy {
    private AssemblyOfferPricePolicy() {}

    static PriceResult calculate(String serviceType, long estimatedPartsPrice, long assemblyFee) {
        if (estimatedPartsPrice < 0) {
            throw validation("예상 부품가는 0 이상이어야 합니다.");
        }
        if (assemblyFee < 0) {
            throw validation("조립비는 0 이상이어야 합니다.");
        }

        long confirmedPartsPrice;
        if ("FULL_SERVICE".equals(serviceType)) {
            confirmedPartsPrice = estimatedPartsPrice;
        } else if ("ASSEMBLY_ONLY".equals(serviceType)) {
            confirmedPartsPrice = 0;
        } else {
            throw validation("지원하지 않는 서비스 방식입니다.");
        }

        try {
            return new PriceResult(
                    confirmedPartsPrice,
                    assemblyFee,
                    0,
                    Math.addExact(confirmedPartsPrice, assemblyFee)
            );
        } catch (ArithmeticException exception) {
            throw validation("가격 합계가 허용 범위를 초과했습니다.");
        }
    }

    private static ApiException validation(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message);
    }

    record PriceResult(
            long confirmedPartsPrice,
            long assemblyFee,
            long deliveryFee,
            long finalPrice
    ) {}
}
