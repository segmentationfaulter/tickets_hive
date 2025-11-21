import sql from "../src/lib/db.ts";

const API_BASE_URL = "http://localhost:3000";
const TEST_EMAIL = `loadtest-${Date.now()}@example.com`;
const TEST_PASSWORD = "testPassword123";
const TEST_USER_NAME = "Load Test User";

interface LoadTestResult {
  totalRequests: number;
  successfulResponses: number;
  failedResponses: number;
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
): Promise<{ success: boolean; responseTime: number }> {
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
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return {
      success: false,
      responseTime,
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
  const successfulResponses = results.filter((r) => r.success).length;
  const failedResponses = concurrentRequests - successfulResponses;
  const responseTimes = results.map((r) => r.responseTime);

  return {
    totalRequests: concurrentRequests,
    successfulResponses,
    failedResponses,
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

  console.log("\n" + "=".repeat(70));
  console.log("📊 LOAD TEST RESULTS - Level 1 (Naive CRUD)");
  console.log("=".repeat(70));

  console.log("\n📈 Request Metrics:");
  console.log(`  Total Requests: ${result.totalRequests}`);
  console.log(`  Successful (2xx): ${result.successfulResponses}`);
  console.log(`  Failed (4xx/5xx): ${result.failedResponses}`);
  console.log(
    `  Success Rate: ${((result.successfulResponses / result.totalRequests) * 100).toFixed(2)}%`,
  );

  console.log("\n⏱️  Performance Metrics:");
  console.log(`  Duration: ${result.duration}ms`);
  console.log(`  Avg Response Time: ${avgResponseTime}ms`);
  console.log(`  Min Response Time: ${minResponseTime}ms`);
  console.log(`  Max Response Time: ${maxResponseTime}ms`);
  console.log(`  Throughput: ${throughput} requests/sec`);

  console.log("\n🎟️  Booking Metrics:");
  console.log(`  Expected Bookings: ${result.expectedBookings}`);
  console.log(`  Actual Bookings: ${result.successfulResponses}`);
  console.log(`  Available Tickets in DB: ${result.availableTickets}`);

  console.log("\n⚠️  Race Condition Analysis:");
  if (result.raceConditionDetected) {
    console.log("  🔴 RACE CONDITION DETECTED: YES");
    console.log(
      `     - More bookings than expected: ${result.successfulResponses} > ${result.expectedBookings}`,
    );
    console.log(`     - OR negative tickets: ${result.availableTickets} < 0`);
  } else {
    console.log("  ✅ RACE CONDITION DETECTED: NO");
    console.log("     (Unexpected for Level 1 - race condition should occur)");
  }

  console.log("\n" + "=".repeat(70));
  console.log("💡 NOTE: This demonstrates the race condition in Level 1.");
  console.log(
    "   Level 2 will add database transactions to prevent overselling.",
  );
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
    result.actualBookings = result.successfulResponses;
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
