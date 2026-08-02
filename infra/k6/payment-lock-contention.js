import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

const scenario = (__ENV.SCENARIO || 'baseline').toLowerCase();
const baseUrl = __ENV.BASE_URL || 'http://host.docker.internal:8080';
const token = __ENV.ACCESS_TOKEN || '';
const hotRequestId = __ENV.HOT_REQUEST_ID || '';
const controlRequestId = __ENV.CONTROL_REQUEST_ID || '';
const hotAttemptId = __ENV.HOT_ATTEMPT_ID || '';
const fanOut = Number(__ENV.HOT_FAN_OUT || '10');
const controlRate = Number(__ENV.CONTROL_RATE || '10');
const duration = __ENV.DURATION || '10s';
const summaryPath = __ENV.SUMMARY_PATH || '/tmp/payment-lock-contention-summary.json';

const controlDuration = new Trend('control_duration', true);
const hotDuration = new Trend('hot_duration', true);
const control2xx = new Counter('control_2xx');
const control5xx = new Counter('control_5xx');
const controlOther = new Counter('control_other');
const hot2xx = new Counter('hot_2xx');
const hot409 = new Counter('hot_409');
const hot5xx = new Counter('hot_5xx');
const hotOther = new Counter('hot_other');
const expectedConflict = new Counter('expected_conflict_409');
const unexpected5xx = new Counter('unexpected_5xx');
const timeoutLikeResponse = new Counter('timeout_like_response');

const scenarios = {
  control: {
    executor: 'constant-arrival-rate',
    exec: 'controlRequest',
    rate: controlRate,
    timeUnit: '1s',
    duration,
    preAllocatedVUs: Math.max(10, controlRate),
    maxVUs: Math.max(50, controlRate * 5),
    tags: { workload: 'control' },
  },
};

if (scenario === 'controlled') {
  scenarios.hot = {
    executor: 'per-vu-iterations',
    exec: 'cancelHotRequest',
    vus: fanOut,
    iterations: 1,
    maxDuration: '15s',
    tags: { workload: 'hot', operation: 'cancel' },
  };
} else if (scenario === 'realistic') {
  scenarios.hot = {
    executor: 'shared-iterations',
    exec: 'racePaymentAndCancellation',
    vus: 1,
    iterations: 1,
    maxDuration: '15s',
    tags: { workload: 'hot', operation: 'payment_cancel_race' },
  };
} else if (scenario !== 'baseline') {
  throw new Error(`Unsupported SCENARIO=${scenario} (baseline|controlled|realistic)`);
}

export const options = {
  scenarios,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
};

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function params(endpoint, expectedStatuses = [200]) {
  return {
    headers: authHeaders(),
    tags: { endpoint },
    timeout: '12s',
    responseCallback: http.expectedStatuses(...expectedStatuses),
  };
}

function recordControl(response) {
  controlDuration.add(response.timings.duration);
  if (response.status >= 200 && response.status < 300) {
    control2xx.add(1);
  } else if (response.status >= 500) {
    control5xx.add(1);
    unexpected5xx.add(1);
  } else {
    controlOther.add(1);
  }
  recordTimeoutLike(response);
}

function recordHot(response) {
  hotDuration.add(response.timings.duration);
  if (response.status >= 200 && response.status < 300) {
    hot2xx.add(1);
  } else if (response.status === 409) {
    hot409.add(1);
    if (conflictCode(response) === 'CONFLICT_STATE') {
      expectedConflict.add(1);
    }
  } else if (response.status >= 500) {
    hot5xx.add(1);
    unexpected5xx.add(1);
  } else {
    hotOther.add(1);
  }
  recordTimeoutLike(response);
}

function conflictCode(response) {
  try {
    return response.json('code');
  } catch (_) {
    return null;
  }
}

function recordTimeoutLike(response) {
  const body = String(response.body || '');
  if (response.status === 0 || /Connection is not available|SQLTransientConnectionException|request timed out/i.test(body)) {
    timeoutLikeResponse.add(1);
  }
}

export function controlRequest() {
  const response = http.get(
    `${baseUrl}/api/assembly-requests/${controlRequestId}`,
    params('control_request'),
  );
  recordControl(response);
}

export function cancelHotRequest() {
  const response = http.post(
    `${baseUrl}/api/assembly-requests/${hotRequestId}/cancel`,
    JSON.stringify({ reason: 'payment lock contention experiment' }),
    params('hot_cancel', [200, 409]),
  );
  recordHot(response);
}

export function racePaymentAndCancellation() {
  const responses = http.batch([
    [
      'POST',
      `${baseUrl}/api/payments/attempts/${hotAttemptId}/complete`,
      null,
      params('hot_complete', [200, 409]),
    ],
    [
      'POST',
      `${baseUrl}/api/assembly-requests/${hotRequestId}/cancel`,
      JSON.stringify({ reason: 'realistic payment cancellation race' }),
      params('hot_cancel', [200, 409]),
    ],
  ]);
  for (const response of responses) {
    recordHot(response);
  }
}

export function handleSummary(data) {
  const control = data.metrics.control_duration && data.metrics.control_duration.values;
  const hot = data.metrics.hot_duration && data.metrics.hot_duration.values;
  const line = [
    `scenario=${scenario}`,
    `control.p50=${control ? control.med : 0}`,
    `control.p95=${control ? control['p(95)'] : 0}`,
    `control.p99=${control ? control['p(99)'] : 0}`,
    `hot.p95=${hot ? hot['p(95)'] : 0}`,
    `unexpected5xx=${counterValue(data, 'unexpected_5xx')}`,
    '',
  ].join(' ');
  return {
    [summaryPath]: JSON.stringify(data, null, 2),
    stdout: line,
  };
}

function counterValue(data, name) {
  const metric = data.metrics[name];
  return metric && metric.values ? metric.values.count || 0 : 0;
}
