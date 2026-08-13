package com.buildgraph.loadtest;

import io.gatling.javaapi.core.Simulation;

public final class SupportChatMessageBaselineSimulation extends Simulation {
    public SupportChatMessageBaselineSimulation() {
        setUp(SupportChatBaselineSupport.populations(true))
                .protocols(SupportChatSimulationSupport.protocol());
    }

    @Override
    public void before() {
        RunMetrics.reset();
    }

    @Override
    public void after() {
        RunMetrics.writeSummary("support-chat-message-baseline", false);
    }
}
