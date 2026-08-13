package com.buildgraph.loadtest;

import java.time.Duration;
import java.util.List;

final class LoadProfile {
    static final List<Integer> VU_STAGES = List.of(20, 50, 100, 150, 200, 300);
    static final Duration RAMP_UP = Duration.ofSeconds(15);
    static final Duration STAGE_HOLD = Duration.ofSeconds(45);
    static final Duration RAMP_DOWN = RAMP_UP;
    static final Duration RECOVERY = Duration.ofSeconds(15);
    static final Duration ACTOR_LIFETIME = RAMP_UP.plus(STAGE_HOLD);
    static final Duration STAGE_SLOT = RAMP_UP.plus(STAGE_HOLD).plus(RAMP_DOWN).plus(RECOVERY);
    static final Duration MESSAGE_PACE = Duration.ofSeconds(1);

    private LoadProfile() {
    }
}
