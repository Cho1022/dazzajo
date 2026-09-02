package com.buildgraph.loadtest;

import io.gatling.javaapi.core.Simulation;

public final class SupportChatConnectionBaselineSimulation extends Simulation {
    public SupportChatConnectionBaselineSimulation() {
        setUp(SupportChatBaselineSupport.populations(false))
                .protocols(SupportChatSimulationSupport.protocol());
    }

    @Override
    public void before() {
        RunMetrics.reset();
    }

    @Override
    public void after() {
        RunMetrics.writeSummary("support-chat-connection-baseline", false);
    }
}
