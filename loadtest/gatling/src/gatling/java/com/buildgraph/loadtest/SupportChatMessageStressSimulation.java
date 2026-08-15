package com.buildgraph.loadtest;

import io.gatling.javaapi.core.PopulationBuilder;
import io.gatling.javaapi.core.ScenarioBuilder;
import io.gatling.javaapi.core.Simulation;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import static io.gatling.javaapi.core.CoreDsl.csv;
import static io.gatling.javaapi.core.CoreDsl.nothingFor;
import static io.gatling.javaapi.core.CoreDsl.rampUsers;
import static io.gatling.javaapi.core.CoreDsl.scenario;

public final class SupportChatMessageStressSimulation extends Simulation {

    private static final List<Integer> VU_STAGES =
            List.of(100, 200, 300);

    private static final Duration RAMP_UP =
            Duration.ofSeconds(30);

    private static final Duration STAGE_HOLD =
            Duration.ofSeconds(90);

    private static final Duration RAMP_DOWN =
            RAMP_UP;

    private static final Duration RECOVERY =
            Duration.ofSeconds(30);

    private static final Duration ACTOR_LIFETIME =
            RAMP_UP.plus(STAGE_HOLD);

    private static final Duration STAGE_SLOT =
            RAMP_UP
                    .plus(STAGE_HOLD)
                    .plus(RAMP_DOWN)
                    .plus(RECOVERY);

    private static final Duration MESSAGE_PACE =
            Duration.ofMillis(500);

    public SupportChatMessageStressSimulation() {
        setUp(populations())
                .protocols(SupportChatSimulationSupport.protocol());
    }

    private static List<PopulationBuilder> populations() {
        List<PopulationBuilder> populations = new ArrayList<>();
        Duration offset = Duration.ZERO;

        for (int stage : VU_STAGES) {
            ScenarioBuilder actors =
                    scenario("Message stress " + stage + " VU")
                            .feed(
                                    csv("baseline-" + stage + ".csv")
                                            .queue()
                            )
                            .exec(
                                    SupportChatFlows.connectAndSubscribe(
                                            "access_token"
                                    )
                            )
                            .during(ACTOR_LIFETIME).on(
                                    SupportChatFlows
                                            .sendMessage(
                                                    "gatling-stress-message"
                                            )
                                            .pace(MESSAGE_PACE)
                            )
                            .exec(SupportChatFlows.disconnect());

            populations.add(
                    actors.injectOpen(
                            nothingFor(offset),
                            rampUsers(stage).during(RAMP_UP)
                    )
            );

            offset = offset.plus(STAGE_SLOT);
        }

        return populations;
    }

    @Override
    public void before() {
        RunMetrics.reset();
    }

    @Override
    public void after() {
        RunMetrics.writeSummary(
                "support-chat-message-stress-500ms",
                false
        );
    }
}