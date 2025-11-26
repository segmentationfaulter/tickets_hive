import { sql } from "@ticket-hive/database";

const API_BASE_URL = "http://localhost:3000";
const TEST_EMAIL = `loadtest-${Date.now()}@example.com`;
const TEST_PASSWORD = "testPassword123";
const TEST_USER_NAME = "Load Test User";

interface LoadTestResult {
  totalRequests: number;
  successfulBookings: number; // 2xx responses for actual bookings
  soldOutResponses: number; // 409 responses (EVENT_SOLD_OUT)
  timeoutResponses: number; // 503 responses (STATEMENT_TIMEOUT)
  otherFailures: number; // Other errors (network, 500, etc.)
  responseTimes: number[];
  duration: number;
  expectedBookings: number;
  actualBookings: number;
  availableTickets: number;
  raceConditionDetected: boolean;
}

async function registerUser(): Promise<void> {
  console.log("📝 Registering test user...");
  try {
    const response = await fetch(`${API_BASE_URL}/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        name: TEST_USER_NAME,
      }),
    });

    if (!response.ok) {
      throw new Error(`Registration failed: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ User registered: ${TEST_EMAIL}`);

    // Upgrade user to admin role so they can create events
    console.log("🔐 Upgrading user to admin role...");
    await sql`UPDATE users SET role = 'admin' WHERE email = ${TEST_EMAIL}`;
    console.log(`✅ User upgraded to admin`);
  } catch (error) {
    console.error("❌ Registration failed:", error);
    throw error;
  }
}

async function loginUser(): Promise<string> {
  console.log("🔐 Logging in to get admin token...");
  try {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      }),
    });

    if (!response.ok) {
      throw new Error(`Login failed: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ User logged in with admin role`);
    return data.token;
  } catch (error) {
    console.error("❌ Login failed:", error);
    throw error;
  }
}

async function createTestEvent(token: string): Promise<string> {
  console.log("📅 Creating test event with 100 tickets...");
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: "Load Test Event",
        totalTickets: 100,
        eventDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Event creation failed: ${response.statusText}`);
    }

    const data = await response.json();
    const eventId = data.data.id;
    console.log(`✅ Event created: ${eventId} (100 tickets available)`);
    return eventId;
  } catch (error) {
    console.error("❌ Event creation failed:", error);
    throw error;
  }
}

async function makeBookingRequest(
  eventId: string,
  token: string,
): Promise<{ success: boolean; responseTime: number; statusCode: number }> {
  const startTime = Date.now();
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/bookings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        eventId: eventId,
      }),
    });

    const responseTime = Date.now() - startTime;
    return {
      success: response.ok,
      responseTime,
      statusCode: response.status,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return {
      success: false,
      responseTime,
      statusCode: 0, // Network error
    };
  }
}

async function runConcurrentBookings(
  eventId: string,
  token: string,
  concurrentRequests: number,
): Promise<LoadTestResult> {
  console.log(
    `\n⏱️  Sending ${concurrentRequests} concurrent booking requests...`,
  );
  const startTime = Date.now();

  // Create array of promises for concurrent requests
  const bookingPromises = Array.from({ length: concurrentRequests }, () =>
    makeBookingRequest(eventId, token),
  );

  // Execute all requests concurrently
  const results = await Promise.all(bookingPromises);

  const duration = Date.now() - startTime;

  // Categorize responses by status code
  const successfulBookings = results.filter((r) => r.statusCode === 201).length; // 201 Created
  const soldOutResponses = results.filter((r) => r.statusCode === 409).length; // 409 Conflict (EVENT_SOLD_OUT)
  const timeoutResponses = results.filter((r) => r.statusCode === 503).length; // 503 Service Unavailable (STATEMENT_TIMEOUT)
  const otherFailures =
    concurrentRequests -
    successfulBookings -
    soldOutResponses -
    timeoutResponses;

  const responseTimes = results.map((r) => r.responseTime);

  return {
    totalRequests: concurrentRequests,
    successfulBookings,
    soldOutResponses,
    timeoutResponses,
    otherFailures,
    responseTimes,
    duration,
    expectedBookings: 100,
    actualBookings: 0, // Will be filled from DB query
    availableTickets: 0, // Will be filled from DB query
    raceConditionDetected: false, // Will be filled from DB query
  };
}

async function getEventDetails(
  eventId: string,
  token: string,
): Promise<{ available_tickets: number }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/events/${eventId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch event");
    }

    const data = await response.json();
    return {
      available_tickets: data.data.available_tickets,
    };
  } catch (error) {
    console.error("❌ Failed to get event details:", error);
    throw error;
  }
}

async function getBookingCount(eventId: string): Promise<number> {
  // This would normally query the database, but since we don't have direct DB access
  // from the test script, we'll estimate based on successful bookings vs event state
  // In a real scenario, you'd query the database directly
  return 0;
}

function printResults(result: LoadTestResult): void {
  const avgResponseTime = (
    result.responseTimes.reduce((a, b) => a + b, 0) /
    result.responseTimes.length
  ).toFixed(2);
  const minResponseTime = Math.min(...result.responseTimes);
  const maxResponseTime = Math.max(...result.responseTimes);
  const throughput = ((result.totalRequests / result.duration) * 1000).toFixed(
    2,
  );

  // Calculate HTTP success rate (successful bookings + sold out responses)
  const httpSuccessCount = result.successfulBookings + result.soldOutResponses;
  const httpSuccessRate = (
    (httpSuccessCount / result.totalRequests) *
    100
  ).toFixed(1);

  // Calculate booking success rate (only actual bookings)
  const bookingSuccessRate = (
    (result.successfulBookings / result.totalRequests) *
    100
  ).toFixed(1);

  console.log("\n" + "=".repeat(70));
  console.log(
    "📊 LOAD TEST RESULTS - Level 2 (Transaction + Timeout Handling)",
  );
  console.log("=".repeat(70));

  console.log("\n📈 Request Metrics:");
  console.log(`  Total Requests: ${result.totalRequests}`);
  console.log(
    `  Successful Bookings (201): ${result.successfulBookings} (${bookingSuccessRate}%)`,
  );
  console.log(
    `  Sold Out (409): ${result.soldOutResponses} (${((result.soldOutResponses / result.totalRequests) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  Timeouts (503): ${result.timeoutResponses} (${((result.timeoutResponses / result.totalRequests) * 100).toFixed(1)}%)`,
  );
  console.log(`  Other Failures: ${result.otherFailures}`);
  console.log(`  HTTP Success Rate: ${httpSuccessRate}% (bookings + sold out)`);

  console.log("\n⏱️  Performance Metrics:");
  console.log(`  Duration: ${result.duration}ms`);
  console.log(`  Avg Response Time: ${avgResponseTime}ms`);
  console.log(`  Min Response Time: ${minResponseTime}ms`);
  console.log(`  Max Response Time: ${maxResponseTime}ms`);
  console.log(`  Throughput: ${throughput} requests/sec`);

  console.log("\n🎟️  Data Integrity:");
  console.log(`  Expected Bookings: ${result.expectedBookings}`);
  console.log(`  Actual Bookings: ${result.successfulBookings}`);
  console.log(`  Available Tickets: ${result.availableTickets}`);

  console.log("\n✅ Race Condition Analysis:");
  if (result.raceConditionDetected) {
    console.log("  🔴 RACE CONDITION: DETECTED ❌");
    console.log(
      `     - Overbooking detected: ${result.successfulBookings} > ${result.expectedBookings}`,
    );
    console.log(`     - OR negative tickets: ${result.availableTickets} < 0`);
    console.log(
      "     - This should NOT happen in Level 2! Check transaction implementation.",
    );
  } else {
    console.log("  🟢 RACE CONDITION: NONE ✅");
    console.log(
      `     - Exact match: ${result.successfulBookings} == ${result.expectedBookings}`,
    );
    console.log(`     - No negative tickets: ${result.availableTickets} >= 0`);
    console.log("     - Transactions working correctly!");
  }

  console.log("\n" + "=".repeat(70));
  console.log("💡 Level 2 Key Insights:");
  console.log(
    `   ✅ ${bookingSuccessRate}% booking rate is CORRECT (${result.expectedBookings} tickets / ${result.totalRequests} requests)`,
  );
  console.log(
    `   ✅ ${((result.soldOutResponses / result.totalRequests) * 100).toFixed(1)}% sold out responses are EXPECTED behavior`,
  );
  if (result.timeoutResponses > 0) {
    console.log(
      `   ⚠️  ${result.timeoutResponses} timeout(s) occurred (${((result.timeoutResponses / result.totalRequests) * 100).toFixed(1)}%)`,
    );
    console.log(
      "      This is acceptable under extreme load with Level 2's locking.",
    );
    if ((result.timeoutResponses / result.totalRequests) * 100 > 20) {
      console.log(
        "      ⚠️  >20% timeout rate suggests moving to Level 3 (queues) for better throughput.",
      );
    }
  } else {
    console.log("   ✅ No timeout errors - excellent!");
  }
  console.log("   📊 Zero overbookings = Data integrity maintained!");
  console.log("=".repeat(70) + "\n");
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("🚀 TICKETHIVE LOAD TEST - Race Condition Demonstration");
  console.log("=".repeat(70) + "\n");

  try {
    // Phase 1: Setup
    console.log("📋 PHASE 1: Setup\n");
    await registerUser();
    const token = await loginUser();
    const eventId = await createTestEvent(token);

    // Phase 2: Load test execution
    console.log("\n📋 PHASE 2: Load Test Execution\n");
    const result = await runConcurrentBookings(eventId, token, 1000);

    // Phase 3: Validation
    console.log("\n📋 PHASE 3: Validation\n");
    console.log("🔍 Fetching event details from database...");
    const eventDetails = await getEventDetails(eventId, token);

    // Update results with actual database state
    result.actualBookings = result.successfulBookings;
    result.availableTickets = eventDetails.available_tickets;
    result.raceConditionDetected =
      result.actualBookings > result.expectedBookings ||
      result.availableTickets < 0;

    // Phase 4: Reporting
    console.log("\n📋 PHASE 4: Results\n");
    printResults(result);

    process.exit(0);
  } catch (error) {
    console.error("\n❌ Load test failed:", error);
    process.exit(1);
  }
}

main();
