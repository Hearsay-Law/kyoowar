// config.js
// Centralized configuration for the QR Pattern Finder application.

module.exports = {
  // --- QR Code Generation ---
  qrSearchOptions: {
    // Options for QR codes generated for pattern searching by workers.
    scale: 1, // Critical: 1 pixel per QR module for efficient searching.
    margin: 0, // No quiet zone; search focuses on the data area.
    errorCorrectionLevel: "H", // High EC level can lead to more varied data patterns.
  },
  qrDisplayOptions: {
    // Options for QR codes generated to display found matches in the UI.
    scale: 8, // Larger scale for better visibility.
    margin: 4, // Standard quiet zone for readability.
    errorCorrectionLevel: "H", // Consistent with search QRs, though not strictly necessary here.
  },

  // --- Pattern Matching ---
  patternFile: "C_4x7.png", // Filename of the pattern to search for (relative to TEMPLATES_DIR).

  // --- URL Generation for QR Content ---
  urlTemplate: "http://www.{RANDOM_STRING}.com", // Base template for URLs embedded in QRs.
  randomStringPlaceholder: "{RANDOM_STRING}", // The exact placeholder to be replaced.
  randomStringLength: 8, // Length of the generated random string.
  randomStringCharset: "abcdefghijklmnopqrstuvwxyz0123456789", // Allowed characters.

  // --- Server Configuration ---
  port: 3000, // Port on which the HTTP server will listen.

  // --- Search Process Control ---
  // Note: `searchBatchSize` is defined but not directly used by `server.js`'s main task creation loop.
  // It might be intended for worker-side batching or future use.
  searchBatchSize: 10, // Intended size of batches for processing or updates.
  delayBetweenBatchesMs: 100, // Pause (ms) in `mainSearchScheduler` before queueing more tasks.
  // Helps prevent busy-looping and allows I/O.
};
