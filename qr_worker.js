// qr_worker.js
const { parentPort, workerData } = require("worker_threads");
const Jimp = require("jimp"); // Jimp might be used by services or for direct manipulation.

// Services are instantiated per worker.
const QRCodeService = require("./services/QRCodeService");
const PatternMatcherService = require("./services/PatternMatcherService");

// Unpack data passed from the main thread.
const { uploadsDir, templatesDir, patternFile, qrSearchOptions } = workerData;

// Initialize services with paths provided by the main thread.
const qrCodeService = new QRCodeService(uploadsDir); // Primarily for generating Jimp image, not file saving here.
const patternMatcherService = new PatternMatcherService(templatesDir);

let isPatternSuccessfullyLoaded = false;

async function initialize() {
  if (!patternFile) {
    // This case should ideally be prevented by the main thread, but good to have a guard.
    console.error(
      `[Worker ${process.pid}] CRITICAL: No patternFile provided in workerData. Cannot initialize.`
    );
    parentPort.postMessage({
      type: "error",
      message: "Worker started without a patternFile.",
    });
    return; // Do not proceed if no pattern file is specified.
  }

  isPatternSuccessfullyLoaded = await patternMatcherService.loadPattern(
    patternFile
  );

  if (!isPatternSuccessfullyLoaded) {
    console.error(
      `[Worker ${process.pid}] CRITICAL: Failed to load pattern '${patternFile}'. This worker will not process tasks effectively.`
    );
    // Notify main thread of the failure.
    parentPort.postMessage({
      type: "error",
      message: `Worker failed to load pattern: ${patternFile}`,
    });
  } else {
    console.log(
      `[Worker ${process.pid}] Pattern '${patternFile}' loaded. Ready for tasks.`
    );
    // Signal main thread that worker is initialized and ready.
    parentPort.postMessage({ type: "ready" });
  }
}

parentPort.on("message", async (task) => {
  if (task.type === "shutdown") {
    console.log(`[Worker ${process.pid}] Received shutdown signal. Exiting.`);
    process.exit(0); // Graceful exit.
  }

  if (!isPatternSuccessfullyLoaded) {
    // If pattern isn't loaded, report an error for the task but don't crash.
    // The main thread might decide to terminate this worker based on earlier init error.
    if (task.url) {
      // Only if it's a processURL task
      parentPort.postMessage({
        type: "result",
        url: task.url,
        match: null,
        error: `Pattern '${patternFile || "Unknown"}' not loaded in worker.`,
      });
    }
    return;
  }

  if (task.type === "processURL") {
    const { url } = task;
    let match = null;
    let error = null;

    try {
      // Generate QR code as a Jimp image.
      const qrJimpImage = await qrCodeService.generateQRCodeToJimp(
        url,
        qrSearchOptions
      );

      if (qrJimpImage) {
        // Attempt to find the pre-loaded pattern in the generated QR image.
        match = patternMatcherService.findPatternInQr(qrJimpImage);
      } else {
        error = "Failed to generate QR Jimp image.";
      }
    } catch (e) {
      console.error(`[Worker ${process.pid}] Error processing URL ${url}:`, e);
      error = e.message || "Unknown error during URL processing.";
    }

    // Send result (match or null) back to the main thread.
    parentPort.postMessage({
      type: "result",
      url: url,
      match: match,
      error: error,
    });
  }
});

// Initialize the worker (e.g., load the pattern).
initialize();
