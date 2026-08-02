package com.buildgraph.loadtest;

import io.gatling.javaapi.core.ScenarioBuilder;
import io.gatling.javaapi.core.Simulation;

import static io.gatling.javaapi.core.CoreDsl.atOnceUsers;
import static io.gatling.javaapi.core.CoreDsl.csv;
import static io.gatling.javaapi.core.CoreDsl.global;
import static io.gatling.javaapi.core.CoreDsl.scenario;

public final class SupportChatSmokeSimulation extends Simulation {
    public SupportChatSmokeSimulation() {
        ScenarioBuilder user = scenario("Smoke USER")
                .feed(csv("smoke.csv").circular())
                .exec(session -> session.set("actor_id", "smoke-user"))
                .exec(SupportChatFlows.connectAndSubscribe("user_token"))
                .pause(1)
                .repeat(5).on(
                        SupportChatFlows.sendMessage("gatling-smoke-user").pause(1)
                )
                .exec(SupportChatFlows.receiveMessages(
                        "ADMIN to USER canonical",
                        "gatling-smoke-admin",
                        5
                ))
                .exec(SupportChatFlows.disconnect());

        ScenarioBuilder admin = scenario("Smoke ADMIN")
                .feed(csv("smoke.csv").circular())
                .exec(session -> session.set("actor_id", "smoke-admin"))
                .exec(SupportChatFlows.connectAndSubscribe("admin_token"))
                .exec(SupportChatFlows.receiveMessages(
                        "USER to ADMIN canonical",
                        "gatling-smoke-user",
                        5
                ))
                .pause(2)
                .repeat(5).on(
                        SupportChatFlows.sendMessage("gatling-smoke-admin").pause(1)
                )
                .exec(SupportChatFlows.disconnect());

        setUp(
                user.injectOpen(atOnceUsers(1)),
                admin.injectOpen(atOnceUsers(1))
        ).protocols(SupportChatSimulationSupport.protocol())
                .assertions(global().failedRequests().count().is(0L));
    }

    @Override
    public void before() {
        RunMetrics.reset();
    }

    @Override
    public void after() {
        RunMetrics.writeSummary("support-chat-smoke", true);
    }
}
