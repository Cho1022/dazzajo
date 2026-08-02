package com.buildgraph.loadtest;

import io.gatling.javaapi.core.PopulationBuilder;
import io.gatling.javaapi.core.ScenarioBuilder;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import static io.gatling.javaapi.core.CoreDsl.csv;
import static io.gatling.javaapi.core.CoreDsl.during;
import static io.gatling.javaapi.core.CoreDsl.nothingFor;
import static io.gatling.javaapi.core.CoreDsl.rampUsers;
import static io.gatling.javaapi.core.CoreDsl.scenario;

final class SupportChatBaselineSupport {
    private SupportChatBaselineSupport() {
    }

    static List<PopulationBuilder> populations(boolean sendMessages) {
        List<PopulationBuilder> populations = new ArrayList<>();
        Duration offset = Duration.ZERO;
        for (int stage : LoadProfile.VU_STAGES) {
            ScenarioBuilder actors = scenario((sendMessages ? "Message" : "Connection") + " baseline " + stage + " VU")
                    .feed(csv("baseline-" + stage + ".csv").queue())
                    .exec(SupportChatFlows.connectAndSubscribe("access_token"));

            if (sendMessages) {
                actors = actors.during(LoadProfile.ACTOR_LIFETIME).on(
                        SupportChatFlows.sendMessage("gatling-baseline-message")
                                .pace(LoadProfile.MESSAGE_PACE)
                );
            } else {
                actors = actors.pause(LoadProfile.ACTOR_LIFETIME);
            }

            actors = actors.exec(SupportChatFlows.disconnect());
            populations.add(actors.injectOpen(
                    nothingFor(offset),
                    rampUsers(stage).during(LoadProfile.RAMP_UP)
            ));
            offset = offset.plus(LoadProfile.STAGE_SLOT);
        }
        return populations;
    }
}
