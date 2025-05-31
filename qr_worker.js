// qr_worker.js
const { parentPort, workerData } = require("worker_threads");
const Jimp = require("jimp"); // Assuming Jimp is needed if services use it directly

// We need to instantiate services within the worker
// Relative paths will be from the perspective of where 'node server.js' is run
const QRCodeService = require("./services/QRCodeService");
const PatternMatcherService = require("./services/PatternMatcherService");

// Get initial data from the main thread
const { uploadsDir, templatesDir, patternFile, qrSearchOptions } = workerData;

const qrCodeService = new QRCodeService(uploadsDir); // Not really used for file saving by worker
const patternMatcherService = new PatternMatcherService(templatesDir);

let isPatternLoaded = false;

async function initializeWorker() {
  isPatternLoaded = await patternMatcherService.loadPattern(patternFile);
  if (!isPatternLoaded) {
    console.error(
      `[Worker ${process.pid}] CRITICAL: Failed to load pattern '${patternFile}'. Worker will not function correctly.`
    );
    parentPort.postMessage({
      type: "error",
      message: "Worker pattern load failed",
    });
  } else {
    console.log(
      `[Worker ${process.pid}] Pattern '${patternFile}' loaded successfully.`
    );
    parentPort.postMessage({ type: "ready" }); // Signal main thread that worker is ready
  }
}

parentPort.on("message", async (task) => {
  if (!isPatternLoaded) {
    parentPort.postMessage({
      type: "result",
      url: task.url,
      match: null,
      error: "Pattern not loaded in worker",
    });
    return;
  }

  if (task.type === "processURL") {
    const { url } = task;
    const qrJimpImage = await qrCodeService.generateQRCodeToJimp(
      url,
      qrSearchOptions
    );
    let match = null;

    if (qrJimpImage) {
      match = patternMatcherService.findPatternInQr(qrJimpImage);
    }
    parentPort.postMessage({ type: "result", url: url, match: match });
  } else if (task.type === "shutdown") {
    console.log(`[Worker ${process.pid}] shutting down.`);
    process.exit(0);
  }
});

initializeWorker();
