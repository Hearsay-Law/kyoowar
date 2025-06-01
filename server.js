// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs").promises; // Keep using fs.promises
const os = require("os");
const { Worker } = require("worker_threads");
const Jimp = require("jimp");
const inquirer = require("inquirer");

const config = require("./config");
const QRCodeService = require("./services/QRCodeService");
const PatternMatcherService = require("./services/PatternMatcherService");

// --- Configuration & Constants ---
const RUN_MATCHER_TEST_ONCE = true;
const UPLOADS_DIR = path.join(__dirname, "uploads");
const TEMPLATES_DIR = path.join(__dirname, "templates");
const STATUS_UPDATE_INTERVAL_MS = 250;

const PURE_BLACK_INT = Jimp.rgbaToInt(0, 0, 0, 255);
const PURE_WHITE_INT = Jimp.rgbaToInt(255, 255, 255, 255);

// --- Express App & Server Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOADS_DIR));

// --- Service Initialization ---
const qrCodeService = new QRCodeService(UPLOADS_DIR);
const mainThreadPatternMatcher = new PatternMatcherService(TEMPLATES_DIR); // TEMPLATES_DIR is still needed for base path

// --- Global State ---
let selectedPatternFile = null; // <--- NEW: To store the user-selected pattern file

// Search State
let isSearching = false;
let searchedCount = 0;
let foundMatches = [];
let testRunCompleted = !RUN_MATCHER_TEST_ONCE;
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
    assignTaskToWorker(worker);
  } else if (message.type === "ready") {
    console.log(
      `Worker ${worker.threadId} (PID: ${worker.pid || "N/A"}) reported ready.`
    );
    workersSuccessfullyInitialized++;
    idleWorkers.push(worker);
    assignTaskToWorker(worker);
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
  const poolIndex = workerPool.indexOf(worker);
  if (poolIndex > -1) workerPool.splice(poolIndex, 1);
  const idleIndex = idleWorkers.indexOf(worker);
  if (idleIndex > -1) idleWorkers.splice(idleIndex, 1);
  if (isSearching && code !== 0) {
    console.log("Attempting to replace unexpectedly exited worker.");
    createAndAddWorker(); // Will now use the globally selectedPatternFile
  }
}

// --- Worker Management ---
function createAndAddWorker() {
  if (workerPool.length >= desiredWorkers) return null;
  if (!selectedPatternFile) {
    // <--- NEW: Guard against no pattern selected
    console.error("Cannot create worker: No pattern file has been selected.");
    return null;
  }

  const worker = new Worker(path.join(__dirname, "qr_worker.js"), {
    workerData: {
      uploadsDir: UPLOADS_DIR,
      templatesDir: TEMPLATES_DIR,
      patternFile: selectedPatternFile, // <--- MODIFIED: Use selected pattern
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
  if (!worker || typeof worker.postMessage !== "function") return;

  if (taskQueue.length > 0 && isSearching) {
    const task = taskQueue.shift();
    worker.postMessage(task);
    const idleIndex = idleWorkers.indexOf(worker);
    if (idleIndex > -1) idleWorkers.splice(idleIndex, 1);
  } else {
    if (!idleWorkers.includes(worker) && workerPool.includes(worker)) {
      idleWorkers.push(worker);
    }
  }
}

function terminateAndReplaceWorker(workerToReplace) {
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
}

// --- Search Logic & Scheduling ---
async function handleMatchFound(url, matchLocation, isTest = false) {
  const displayQr = await qrCodeService.generateQRCodeToFile(
    url,
    config.qrDisplayOptions,
    isTest ? "testmatch" : "match"
  );

  if (displayQr) {
    const matchData = {
      id: `match_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      url: url,
      qrImageUrl: displayQr.urlPath,
      pattern: matchLocation.pattern, // This comes from the worker, which gets the pattern name
      location: { x: matchLocation.x, y: matchLocation.y },
      timestamp: new Date().toLocaleTimeString(),
      isTestMatch: isTest,
    };
    foundMatches.unshift(matchData);
    io.emit("patternFound", matchData);
    console.log(
      `${isTest ? "[SELF-TEST] " : ""}MATCH FOUND: URL: ${url}, Pattern: ${
        matchData.pattern // This should reflect the selectedPatternFile base name
      } at (${matchData.location.x},${matchData.location.y})`
    );
  }
}

async function runMainThreadSelfTest() {
  if (!selectedPatternFile) {
    // <--- NEW: Check if pattern is selected
    console.error("[SELF-TEST] No pattern file selected. Skipping self-test.");
    testRunCompleted = true;
    return;
  }
  if (
    !mainThreadPatternMatcher.patternMatrix ||
    !mainThreadPatternMatcher.patternImage
  ) {
    console.error(
      `[SELF-TEST] Pattern '${selectedPatternFile}' not properly loaded in mainThreadPatternMatcher. Skipping self-test.`
    );
    testRunCompleted = true;
    return;
  }

  console.log(
    `[SELF-TEST - Scan ${searchedCount + 1}] Simulating QR with pattern: ${
      mainThreadPatternMatcher.patternFileName // This should be the selectedPatternFile
    }`
  );
  const testUrl = "self_test_mock_pattern_main_thread";

  const mockQrWidth = mainThreadPatternMatcher.patternWidth + 5;
  const mockQrHeight = mainThreadPatternMatcher.patternHeight + 5;
  const qrJimpImage = new Jimp(mockQrWidth, mockQrHeight, PURE_WHITE_INT);
  const testPatternX = 2,
    testPatternY = 2;

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

  if (RUN_MATCHER_TEST_ONCE && !testRunCompleted) {
    await runMainThreadSelfTest();
    io.emit("searchStatus", {
      searchedCount,
      isSearching,
      foundCount: foundMatches.length,
    });
  }

  const maxQueueSize = desiredWorkers * 3;
  while (isSearching && taskQueue.length < maxQueueSize) {
    taskQueue.push({ type: "processURL", url: generateRandomUrl() });
  }

  while (idleWorkers.length > 0 && taskQueue.length > 0 && isSearching) {
    const worker = idleWorkers.shift();
    const task = taskQueue.shift();
    if (worker) worker.postMessage(task);
  }

  if (isSearching) {
    setTimeout(mainSearchScheduler, config.delayBetweenBatchesMs);
  }
}

// --- HTTP Route Handlers ---
app.get("/", async (req, res) => {
  try {
    if (!selectedPatternFile) {
      // <--- NEW: Check if pattern selected
      res
        .status(500)
        .send(
          "Server error: No pattern file has been selected at startup. Please restart the server."
        );
      return;
    }
    // Ensure pattern info is available for the template (e.g., pattern filename)
    // Main `main()` function now loads the selected pattern. This check ensures it's loaded.
    if (!mainThreadPatternMatcher.patternMatrix) {
      console.log(
        `[Route /] Main thread pattern '${selectedPatternFile}' not yet loaded for display, attempting now...`
      );
      // Attempt to load it again if it wasn't. This is a fallback.
      // The main() function should have already loaded it.
      const loaded = await mainThreadPatternMatcher.loadPattern(
        selectedPatternFile
      );
      if (!loaded) {
        console.error(
          `[Route /] Failed to load pattern '${selectedPatternFile}' on demand.`
        );
        res
          .status(500)
          .send(
            `Server error: Could not load selected pattern file '${selectedPatternFile}'.`
          );
        return;
      }
    }

    res.render("index", {
      initialSearchStatus: {
        searchedCount,
        isSearching,
        foundCount: foundMatches.length,
      },
      initialMatches: foundMatches,
      patternFile:
        mainThreadPatternMatcher.patternFileName || selectedPatternFile, // <--- MODIFIED
    });
  } catch (routeError) {
    console.error("[Route /] Error in root route handler:", routeError);
    res.status(500).send("Server error. Please check server logs.");
  }
});

// --- Socket.IO Event Handlers ---
async function ensureMainPatternLoadedForTest(socket) {
  if (!selectedPatternFile) {
    // <--- NEW: Check if pattern selected
    const errorMsg =
      "Cannot start search: No pattern file was selected at server startup.";
    console.error(errorMsg);
    socket.emit("searchError", errorMsg);
    return false;
  }
  if (!mainThreadPatternMatcher.patternMatrix) {
    console.log(
      `[Socket StartSearch] Main thread pattern '${selectedPatternFile}' not loaded, attempting for self-test...`
    );
    const mainPatternLoaded = await mainThreadPatternMatcher.loadPattern(
      selectedPatternFile // <--- MODIFIED
    );
    if (!mainPatternLoaded) {
      const errorMsg = `Main thread failed to load pattern '${selectedPatternFile}' for self-test. Cannot start search.`;
      console.error(errorMsg);
      socket.emit("searchError", errorMsg);
      return false;
    }
  }
  return true;
}

function initializeSearchStateForStart() {
  isSearching = true;
  testRunCompleted = !RUN_MATCHER_TEST_ONCE;
  searchedCount = 0;
  workersSuccessfullyInitialized = 0;
  idleWorkers.length = 0;
  taskQueue.length = 0;
}

async function resetAndInitializeWorkerPool() {
  console.log(`Starting search... Terminating any existing workers.`);
  while (workerPool.length > 0) {
    const oldWorker = workerPool.pop();
    if (oldWorker) {
      await oldWorker
        .terminate()
        .catch((e) => console.error(`Error terminating old worker: ${e}`));
    }
  }

  console.log(`Creating up to ${desiredWorkers} new workers.`);
  if (!selectedPatternFile) {
    // <--- NEW: Check before creating workers
    console.error("Cannot initialize worker pool: No pattern selected.");
    return; // Prevent worker creation if no pattern
  }
  for (let i = 0; i < desiredWorkers; i++) {
    createAndAddWorker(); // Will use the globally selectedPatternFile
  }
}

function startStatusUpdater() {
  if (statusUpdateInterval) clearInterval(statusUpdateInterval);
  statusUpdateInterval = setInterval(() => {
    if (isSearching) {
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
  [...workerPool].forEach((worker) => {
    if (worker && typeof worker.postMessage === "function") {
      worker.postMessage({ type: "shutdown" });
    }
  });
  idleWorkers.length = 0;
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  socket.emit("initialData", {
    isSearching,
    searchedCount,
    foundMatches,
    patternFile:
      mainThreadPatternMatcher.patternFileName || selectedPatternFile, // <--- MODIFIED
  });

  socket.on("startSearch", async () => {
    if (isSearching) {
      console.log("Search start request ignored, already running.");
      socket.emit("searchError", "Search is already in progress.");
      return;
    }
    if (!selectedPatternFile) {
      // <--- NEW: Critical check
      socket.emit(
        "searchError",
        "Cannot start search: No pattern file was selected at server startup."
      );
      return;
    }
    if (
      RUN_MATCHER_TEST_ONCE &&
      !(await ensureMainPatternLoadedForTest(socket))
    ) {
      return;
    }

    initializeSearchStateForStart();
    await resetAndInitializeWorkerPool();

    io.emit("searchStatus", {
      searchedCount,
      isSearching,
      foundCount: foundMatches.length,
    });
    mainSearchScheduler();
    startStatusUpdater();
  });

  socket.on("stopSearch", () => {
    if (!isSearching) {
      console.log("Search stop request ignored, not currently running.");
      return;
    }
    isSearching = false;
    console.log(
      "Search stopping... Clearing task queue and signaling workers."
    );
    taskQueue.length = 0;
    shutdownActiveWorkers();
    stopStatusUpdater();
    io.emit("searchStatus", {
      searchedCount,
      isSearching,
      foundCount: foundMatches.length,
    });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// --- Application Startup ---
async function selectPatternFile() {
  try {
    const files = await fs.readdir(TEMPLATES_DIR);
    const imageFiles = files.filter((file) =>
      /\.(png|jpe?g|gif|bmp)$/i.test(file)
    );

    if (imageFiles.length === 0) {
      console.error(
        `No image files found in the templates directory: ${TEMPLATES_DIR}`
      );
      console.error(
        "Please add at least one pattern image (e.g., .png, .jpg) to the templates folder."
      );
      return null;
    }

    // Determine the correct way to call prompt
    const promptFn =
      inquirer.prompt || (inquirer.default && inquirer.default.prompt);

    if (typeof promptFn !== "function") {
      console.error(
        "Failed to find the inquirer.prompt function. Please check your inquirer version and import statement."
      );
      throw new TypeError("inquirer.prompt is not a function or accessible");
    }

    const answers = await promptFn([
      // <--- Use promptFn
      {
        type: "list",
        name: "pattern",
        message: "Select a pattern file to search for:",
        choices: imageFiles,
      },
    ]);
    return answers.pattern;
  } catch (err) {
    console.error("Error during pattern selection:", err);
    return null;
  }
}

async function main() {
  // --- NEW: Select pattern file at startup ---
  selectedPatternFile = await selectPatternFile();
  if (!selectedPatternFile) {
    console.error("No pattern file selected or an error occurred. Exiting.");
    process.exit(1); // Exit if no pattern is chosen
  }
  console.log(`Using pattern file: ${selectedPatternFile}`);
  // --- End NEW ---

  try {
    await fs.rm(UPLOADS_DIR, { recursive: true, force: true });
    console.log("Cleaned uploads directory.");
  } catch (e) {
    if (e.code !== "ENOENT") {
      console.error("Could not clean uploads directory:", e);
    }
  }
  await qrCodeService.ensureUploadsDirExists();

  // Load pattern for main thread (used for self-test and displaying pattern info)
  const initialPatternLoaded = await mainThreadPatternMatcher.loadPattern(
    selectedPatternFile // <--- MODIFIED: Use selected pattern
  );
  if (initialPatternLoaded) {
    console.log(
      `[Startup] Initial pattern '${selectedPatternFile}' loaded for self-test/info.`
    );
  } else {
    // This is more critical now if the selected file fails to load
    console.error(
      `[Startup] CRITICAL: Selected pattern '${selectedPatternFile}' could not be loaded. Exiting.`
    );
    process.exit(1); // Exit if the chosen pattern can't be loaded
  }

  server.listen(config.port, () => {
    console.log(`QR Pattern Finder running at http://localhost:${config.port}`);
    if (RUN_MATCHER_TEST_ONCE) {
      console.log(
        `Matcher self-test (RUN_MATCHER_TEST_ONCE) is ENABLED for the first search after 'Start Searching' using pattern '${selectedPatternFile}'.`
      );
    }
  });
}

main().catch((err) => {
  console.error("Critical startup error:", err);
  process.exit(1);
});
