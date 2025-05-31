// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs").promises;
const os = require("os");
const { Worker } = require("worker_threads");
const Jimp = require("jimp"); // For main thread's test block & PURE_COLOR constants

const config = require("./config");
const QRCodeService = require("./services/QRCodeService");
const PatternMatcherService = require("./services/PatternMatcherService");

// --- Configuration & Constants ---
const RUN_MATCHER_TEST_ONCE = true; // Master switch for the self-test
const UPLOADS_DIR = path.join(__dirname, "uploads");
const TEMPLATES_DIR = path.join(__dirname, "templates");
const STATUS_UPDATE_INTERVAL_MS = 250; // For throttling UI updates

// Jimp constants for self-test image generation
const PURE_BLACK_INT = Jimp.rgbaToInt(0, 0, 0, 255);
const PURE_WHITE_INT = Jimp.rgbaToInt(255, 255, 255, 255);

// --- Express App & Server Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOADS_DIR)); // Serve generated QR codes

// --- Service Initialization ---
const qrCodeService = new QRCodeService(UPLOADS_DIR);
const mainThreadPatternMatcher = new PatternMatcherService(TEMPLATES_DIR);

// --- Global State ---
// Search State
let isSearching = false;
let searchedCount = 0;
let foundMatches = [];
let testRunCompleted = !RUN_MATCHER_TEST_ONCE; // Initialized based on whether test should run
let statusUpdateInterval = null;

// Worker Pool State
const numCPUs = os.cpus().length;
const desiredWorkers = Math.max(1, numCPUs > 1 ? numCPUs - 1 : 1);
const workerPool = [];
const idleWorkers = [];
const taskQueue = [];
let workersSuccessfullyInitialized = 0;

// --- Utility Functions ---
function generateRandomUrl() {
  let randomString = "";
  for (let i = 0; i < config.randomStringLength; i++) {
    randomString += config.randomStringCharset.charAt(
      Math.floor(Math.random() * config.randomStringCharset.length)
    );
  }
  if (config.urlTemplate.includes(config.randomStringPlaceholder)) {
    return config.urlTemplate.replace(
      config.randomStringPlaceholder,
      randomString
    );
  }
  console.warn(
    "[URL Generation] Placeholder missing in urlTemplate. Appending random string."
  );
  return config.urlTemplate + randomString;
}

// --- Worker Event Handlers ---
function handleWorkerMessage(message, worker) {
  if (message.type === "result") {
    searchedCount++;
    if (message.match) {
      handleMatchFound(message.url, message.match);
    }
    assignTaskToWorker(worker); // Assign new task or add to idle
  } else if (message.type === "ready") {
    console.log(
      `Worker ${worker.threadId} (PID: ${worker.pid || "N/A"}) reported ready.`
    );
    workersSuccessfullyInitialized++;
    idleWorkers.push(worker);
    assignTaskToWorker(worker); // Attempt to assign task immediately
    if (workersSuccessfullyInitialized === desiredWorkers && isSearching) {
      console.log("All desired workers initialized and ready for tasks.");
    }
  } else if (message.type === "error") {
    console.error(
      `Error from Worker ${worker.threadId} (PID: ${worker.pid || "N/A"}): ${
        message.message
      }. Terminating.`
    );
    terminateAndReplaceWorker(worker);
  }
}

function handleWorkerError(err, worker) {
  console.error(
    `Worker ${worker.threadId} (PID: ${worker.pid || "N/A"}) critical error:`,
    err,
    ". Terminating."
  );
  terminateAndReplaceWorker(worker);
}

function handleWorkerExit(code, worker) {
  console.log(
    `Worker ${worker.threadId} (PID: ${
      worker.pid || "N/A"
    }) exited with code ${code}.`
  );

  // Remove from active pools
  const poolIndex = workerPool.indexOf(worker);
  if (poolIndex > -1) workerPool.splice(poolIndex, 1);
  const idleIndex = idleWorkers.indexOf(worker);
  if (idleIndex > -1) idleWorkers.splice(idleIndex, 1);

  // If search is active and worker exited unexpectedly, try to replace it
  if (isSearching && code !== 0) {
    console.log("Attempting to replace unexpectedly exited worker.");
    createAndAddWorker();
  }
}

// --- Worker Management ---
function createAndAddWorker() {
  if (workerPool.length >= desiredWorkers) return null;

  const worker = new Worker(path.join(__dirname, "qr_worker.js"), {
    workerData: {
      uploadsDir: UPLOADS_DIR,
      templatesDir: TEMPLATES_DIR,
      patternFile: config.patternFile,
      qrSearchOptions: config.qrSearchOptions,
    },
  });
  workerPool.push(worker);

  worker.on("message", (message) => handleWorkerMessage(message, worker));
  worker.on("error", (err) => handleWorkerError(err, worker));
  worker.on("exit", (code) => handleWorkerExit(code, worker));

  return worker;
}

function assignTaskToWorker(worker) {
  if (!worker || typeof worker.postMessage !== "function") return; // Worker might have been terminated

  if (taskQueue.length > 0 && isSearching) {
    const task = taskQueue.shift();
    worker.postMessage(task);
    // Worker is now busy, remove from idle if it was there
    const idleIndex = idleWorkers.indexOf(worker);
    if (idleIndex > -1) idleWorkers.splice(idleIndex, 1);
  } else {
    // No tasks or not searching, ensure worker is in idle list if valid and not already there
    if (!idleWorkers.includes(worker) && workerPool.includes(worker)) {
      idleWorkers.push(worker);
    }
  }
}

function terminateAndReplaceWorker(workerToReplace) {
  // Remove from pools immediately to prevent re-assignment
  const poolIndex = workerPool.indexOf(workerToReplace);
  if (poolIndex > -1) workerPool.splice(poolIndex, 1);

  const idleIndex = idleWorkers.indexOf(workerToReplace);
  if (idleIndex > -1) idleWorkers.splice(idleIndex, 1);

  console.log(`Terminating worker ${workerToReplace.threadId}...`);
  workerToReplace
    .terminate()
    .catch((err) =>
      console.error(
        `Error terminating worker ${workerToReplace.threadId}:`,
        err
      )
    );
  // The 'exit' handler will manage replacement if necessary.
}

// --- Search Logic & Scheduling ---
async function handleMatchFound(url, matchLocation, isTest = false) {
  const displayQr = await qrCodeService.generateQRCodeToFile(
    url,
    config.qrDisplayOptions,
    isTest ? "testmatch" : "match" // Filename prefix for test matches
  );

  if (displayQr) {
    const matchData = {
      id: `match_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      url: url,
      qrImageUrl: displayQr.urlPath, // URL path for client to access image
      pattern: matchLocation.pattern,
      location: { x: matchLocation.x, y: matchLocation.y },
      timestamp: new Date().toLocaleTimeString(),
      isTestMatch: isTest,
    };
    foundMatches.unshift(matchData); // Add to beginning for newest first
    io.emit("patternFound", matchData);
    console.log(
      `${isTest ? "[SELF-TEST] " : ""}MATCH FOUND: URL: ${url}, Pattern: ${
        matchData.pattern
      } at (${matchData.location.x},${matchData.location.y})`
    );
  }
}

async function runMainThreadSelfTest() {
  if (
    !mainThreadPatternMatcher.patternMatrix ||
    !mainThreadPatternMatcher.patternImage
  ) {
    console.error(
      "[SELF-TEST] Pattern not properly loaded in mainThreadPatternMatcher. Skipping self-test."
    );
    testRunCompleted = true; // Mark as completed to prevent retries
    return;
  }

  console.log(
    `[SELF-TEST - Scan ${searchedCount + 1}] Simulating QR with pattern: ${
      mainThreadPatternMatcher.patternFileName
    }`
  );
  const testUrl = "self_test_mock_pattern_main_thread";

  // Create a mock QR image with the pattern embedded
  const mockQrWidth = mainThreadPatternMatcher.patternWidth + 5;
  const mockQrHeight = mainThreadPatternMatcher.patternHeight + 5;
  const qrJimpImage = new Jimp(mockQrWidth, mockQrHeight, PURE_WHITE_INT);
  const testPatternX = 2,
    testPatternY = 2; // Arbitrary placement

  qrJimpImage.blit(
    mainThreadPatternMatcher.patternImage,
    testPatternX,
    testPatternY
  );

  try {
    await qrJimpImage.writeAsync(
      path.join(UPLOADS_DIR, "mock_qr_main_thread_test.png")
    );
  } catch (e) {
    console.warn("[SELF-TEST] Could not save mock QR image:", e);
  }

  const matchLocation = mainThreadPatternMatcher.findPatternInQr(
    qrJimpImage,
    true
  );

  if (matchLocation) {
    await handleMatchFound(testUrl, matchLocation, true);
  } else {
    console.log(
      "[SELF-TEST] No match found in its own mock QR. Check pattern/logic."
    );
  }
  searchedCount++;
  testRunCompleted = true;
}

async function mainSearchScheduler() {
  if (!isSearching) return;

  // Run self-test once if enabled and not yet completed
  if (RUN_MATCHER_TEST_ONCE && !testRunCompleted) {
    await runMainThreadSelfTest();
    // Emit status after self-test as it modifies searchedCount
    io.emit("searchStatus", {
      searchedCount,
      isSearching,
      foundCount: foundMatches.length,
    });
  }

  // Fill task queue up to a certain capacity
  const maxQueueSize = desiredWorkers * 3; // Heuristic: keep queue reasonably full
  while (isSearching && taskQueue.length < maxQueueSize) {
    taskQueue.push({ type: "processURL", url: generateRandomUrl() });
  }

  // Assign tasks from queue to idle workers
  while (idleWorkers.length > 0 && taskQueue.length > 0 && isSearching) {
    const worker = idleWorkers.shift(); // Take from front
    const task = taskQueue.shift(); // Take from front
    if (worker) worker.postMessage(task); // Worker might have been terminated
  }

  if (isSearching) {
    setTimeout(mainSearchScheduler, config.delayBetweenBatchesMs);
  }
}

// --- HTTP Route Handlers ---
app.get("/", async (req, res) => {
  try {
    // Ensure pattern info is available for the template (e.g., pattern filename)
    // Main `main()` function attempts initial load; this is a fallback.
    if (!mainThreadPatternMatcher.patternMatrix) {
      console.log(
        "[Route /] Main thread pattern not yet loaded for display, attempting now..."
      );
      await mainThreadPatternMatcher.loadPattern(config.patternFile);
    }

    res.render("index", {
      initialSearchStatus: {
        searchedCount,
        isSearching,
        foundCount: foundMatches.length,
      },
      initialMatches: foundMatches,
      patternFile:
        mainThreadPatternMatcher.patternFileName || config.patternFile,
    });
  } catch (routeError) {
    console.error("[Route /] Error in root route handler:", routeError);
    res.status(500).send("Server error. Please check server logs.");
  }
});

// --- Socket.IO Event Handlers ---
async function ensureMainPatternLoadedForTest(socket) {
  if (!mainThreadPatternMatcher.patternMatrix) {
    console.log(
      "[Socket StartSearch] Main thread pattern not loaded, attempting for self-test..."
    );
    const mainPatternLoaded = await mainThreadPatternMatcher.loadPattern(
      config.patternFile
    );
    if (!mainPatternLoaded) {
      const errorMsg = `Main thread failed to load pattern '${config.patternFile}' for self-test. Cannot start search.`;
      console.error(errorMsg);
      socket.emit("searchError", errorMsg);
      return false;
    }
  }
  return true;
}

function initializeSearchStateForStart() {
  isSearching = true;
  testRunCompleted = !RUN_MATCHER_TEST_ONCE; // Reset test completion flag
  searchedCount = 0;
  // foundMatches are intentionally not cleared to persist across search sessions
  workersSuccessfullyInitialized = 0;

  // Clear queues and worker lists
  idleWorkers.length = 0;
  taskQueue.length = 0;
}

async function resetAndInitializeWorkerPool() {
  console.log(`Starting search... Terminating any existing workers.`);
  while (workerPool.length > 0) {
    const oldWorker = workerPool.pop();
    if (oldWorker) {
      // Check if worker exists (could be null if pool was modified)
      await oldWorker
        .terminate()
        .catch((e) => console.error(`Error terminating old worker: ${e}`));
    }
  }
  // workerPool is now empty

  console.log(`Creating up to ${desiredWorkers} new workers.`);
  for (let i = 0; i < desiredWorkers; i++) {
    createAndAddWorker();
  }
}

function startStatusUpdater() {
  if (statusUpdateInterval) clearInterval(statusUpdateInterval);
  statusUpdateInterval = setInterval(() => {
    if (isSearching) {
      // Only emit if actively searching
      io.emit("searchStatus", {
        searchedCount,
        isSearching,
        foundCount: foundMatches.length,
      });
    }
  }, STATUS_UPDATE_INTERVAL_MS);
}

function stopStatusUpdater() {
  if (statusUpdateInterval) {
    clearInterval(statusUpdateInterval);
    statusUpdateInterval = null;
  }
}

function shutdownActiveWorkers() {
  console.log("Signaling workers to shut down...");
  // Iterate over a copy of workerPool as workers might be removed during iteration by their exit handlers
  [...workerPool].forEach((worker) => {
    if (worker && typeof worker.postMessage === "function") {
      worker.postMessage({ type: "shutdown" });
    }
  });
  // Workers will be removed from workerPool and idleWorkers by their 'exit' handlers.
  // Explicitly clearing idleWorkers here is also fine as a safeguard.
  idleWorkers.length = 0;
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  socket.emit("initialData", {
    isSearching,
    searchedCount,
    foundMatches,
    patternFile: mainThreadPatternMatcher.patternFileName || config.patternFile,
  });

  socket.on("startSearch", async () => {
    if (isSearching) {
      console.log("Search start request ignored, already running.");
      socket.emit("searchError", "Search is already in progress.");
      return;
    }
    if (
      RUN_MATCHER_TEST_ONCE &&
      !(await ensureMainPatternLoadedForTest(socket))
    ) {
      return; // Error already emitted by ensureMainPatternLoadedForTest
    }

    initializeSearchStateForStart();
    await resetAndInitializeWorkerPool(); // Terminates old, creates new

    io.emit("searchStatus", {
      searchedCount,
      isSearching,
      foundCount: foundMatches.length,
    }); // Initial status
    mainSearchScheduler(); // Start the search loop
    startStatusUpdater(); // Start periodic status updates
  });

  socket.on("stopSearch", () => {
    if (!isSearching) {
      console.log("Search stop request ignored, not currently running.");
      return;
    }

    isSearching = false; // Primary flag to stop schedulers and worker task assignments
    console.log(
      "Search stopping... Clearing task queue and signaling workers."
    );

    taskQueue.length = 0; // Clear pending tasks
    shutdownActiveWorkers(); // Ask workers to shut down gracefully
    stopStatusUpdater();

    // Emit final status
    io.emit("searchStatus", {
      searchedCount,
      isSearching, // Will be false
      foundCount: foundMatches.length,
    });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// --- Application Startup ---
async function main() {
  try {
    // Clean and ensure uploads directory exists
    await fs.rm(UPLOADS_DIR, { recursive: true, force: true });
    console.log("Cleaned uploads directory.");
  } catch (e) {
    if (e.code !== "ENOENT") {
      // Ignore error if directory doesn't exist
      console.error("Could not clean uploads directory:", e);
    }
  }
  await qrCodeService.ensureUploadsDirExists();

  // Load pattern for main thread (used for self-test and displaying pattern info)
  const initialPatternLoaded = await mainThreadPatternMatcher.loadPattern(
    config.patternFile
  );
  if (initialPatternLoaded) {
    console.log(
      `[Startup] Initial pattern '${config.patternFile}' loaded for self-test/info.`
    );
  } else {
    console.warn(
      `[Startup] Initial pattern '${config.patternFile}' could not be loaded. Self-test might fail or be skipped.`
    );
  }

  server.listen(config.port, () => {
    console.log(`QR Pattern Finder running at http://localhost:${config.port}`);
    if (RUN_MATCHER_TEST_ONCE) {
      console.log(
        "Matcher self-test (RUN_MATCHER_TEST_ONCE) is ENABLED for the first search after 'Start Searching'."
      );
    }
  });
}

main().catch((err) => {
  console.error("Critical startup error:", err);
  process.exit(1); // Exit if main setup fails
});
