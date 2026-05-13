// ============================================
// LeadChat — k6 Load Test: Matching Flow
// Simulates 100 VUs hitting API endpoints
// Run: k6 run infra/loadtest/matching.js
// Pass: 0% error rate, p99 < 3s
// ============================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const matchLatency = new Trend('match_latency', true);

export const options = {
  stages: [
    { duration: '10s', target: 50 },    // Ramp up
    { duration: '30s', target: 100 },   // Hold at 100 VUs
    { duration: '10s', target: 0 },     // Ramp down
  ],
  thresholds: {
    'http_req_duration': ['p(95)<200', 'p(99)<3000'],   // p95 < 200ms, p99 < 3s
    'errors': ['rate<0.01'],                             // <1% error rate
    'http_req_failed': ['rate<0.01'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:4002/api';

export default function () {
  // 1. Health Check
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, {
    'health: status 200': (r) => r.status === 200,
    'health: body has success': (r) => JSON.parse(r.body).success === true,
  }) || errorRate.add(1);

  sleep(0.1);

  // 2. Create Order (simulates billing load)
  const userId = `k6-user-${__VU}-${__ITER}`;
  const orderRes = http.post(
    `${BASE_URL}/billing/create-order`,
    JSON.stringify({ productId: 'premium_subscription' }),
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Test-User-Id': userId,
      },
    }
  );

  const orderOk = check(orderRes, {
    'order: status 200': (r) => r.status === 200,
    'order: has orderId': (r) => {
      try { return JSON.parse(r.body).data.orderId !== undefined; }
      catch { return false; }
    },
  });
  if (!orderOk) errorRate.add(1);

  sleep(0.2);

  // 3. Credits Balance (simulates reads under load)
  const balanceRes = http.get(`${BASE_URL}/credits/balance`, {
    headers: { 'X-Test-User-Id': userId },
  });

  check(balanceRes, {
    'balance: status 200': (r) => r.status === 200,
  }) || errorRate.add(1);

  sleep(0.1);

  // 4. Deals List (simulates authenticated reads)
  const dealsRes = http.get(`${BASE_URL}/deals`, {
    headers: { 'X-Test-User-Id': userId },
  });

  check(dealsRes, {
    'deals: status 200': (r) => r.status === 200,
  }) || errorRate.add(1);

  // Track overall latency
  matchLatency.add(healthRes.timings.duration + orderRes.timings.duration);

  sleep(0.5);
}

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration.values['p(95)'];
  const p99 = data.metrics.http_req_duration.values['p(99)'];
  const errRate = data.metrics.errors ? data.metrics.errors.values.rate : 0;
  const totalReqs = data.metrics.http_reqs.values.count;

  console.log('\n');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║       🚀 LeadChat Load Test Results       ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Total Requests:  ${String(totalReqs).padEnd(22)}║`);
  console.log(`║  p95 Latency:     ${String(p95.toFixed(1) + 'ms').padEnd(22)}║`);
  console.log(`║  p99 Latency:     ${String(p99.toFixed(1) + 'ms').padEnd(22)}║`);
  console.log(`║  Error Rate:      ${String((errRate * 100).toFixed(2) + '%').padEnd(22)}║`);
  console.log(`║  Pass:            ${(p95 < 200 && errRate < 0.01 ? '✅ YES' : '❌ NO').padEnd(22)}║`);
  console.log('╚══════════════════════════════════════════╝');

  return {};
}
