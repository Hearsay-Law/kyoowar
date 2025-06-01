// services/PatternMatcherService.js
const Jimp = require("jimp");
const path = require("path");

// Pre-calculated integer values for pure black and pure white (opaque)
const PURE_BLACK_INT = Jimp.rgbaToInt(0, 0, 0, 255);
const PURE_WHITE_INT = Jimp.rgbaToInt(255, 255, 255, 255);

class PatternMatcherService {
  constructor(templatesDir) {
    this.templatesDir = templatesDir; // Base directory for pattern image files.
    this.patternImage = null; // Jimp image object of the loaded pattern.
    this.patternMatrix = null; // 2D array of integer colors for the pattern.
    this.patternWidth = 0;
    this.patternHeight = 0;
    this.patternFileName = ""; // Filename of the currently loaded pattern.
  }

  // Validates that the pattern image contains only pure black or pure white pixels.
  _validatePatternColors(imageObject) {
    let firstInvalidPixel = null;

    // Scan image, stopping at the first invalid pixel.
    imageObject.scan(
      0,
      0,
      imageObject.bitmap.width,
      imageObject.bitmap.height,
      function (x, y, idx) {
        if (firstInvalidPixel) return; // Already found an invalid pixel, stop scanning.

        const red = this.bitmap.data[idx + 0];
        const green = this.bitmap.data[idx + 1];
        const blue = this.bitmap.data[idx + 2];
        const alpha = this.bitmap.data[idx + 3];
        const currentColorInt = Jimp.rgbaToInt(red, green, blue, alpha);

        if (
          currentColorInt !== PURE_BLACK_INT &&
          currentColorInt !== PURE_WHITE_INT
        ) {
          firstInvalidPixel = {
            x,
            y,
            r: red,
            g: green,
            b: blue,
            a: alpha,
            int: currentColorInt,
          };
        }
      }
    );

    if (firstInvalidPixel) {
      console.error(
        `[PatternValidation] Error for pattern '${this.patternFileName}': Image contains non-monochrome pixels.`
      );
      console.error(
        `  First invalid pixel at (${firstInvalidPixel.x}, ${firstInvalidPixel.y}): ` +
          `R:${firstInvalidPixel.r} G:${firstInvalidPixel.g} B:${firstInvalidPixel.b} A:${firstInvalidPixel.a} ` +
          `(Hex: 0x${firstInvalidPixel.int.toString(16).padStart(8, "0")})`
      );
      console.error(
        `  Expected opaque pure black (0x${PURE_BLACK_INT.toString(16).padStart(
          8,
          "0"
        )}) or ` +
          `opaque pure white (0x${PURE_WHITE_INT.toString(16).padStart(
            8,
            "0"
          )}).`
      );
      return false;
    }
    return true;
  }

  // Loads a pattern image, validates its colors, and pre-processes it into a color matrix.
  async loadPattern(patternFileName) {
    this.patternFileName = patternFileName; // Store filename regardless of load success for context.
    const patternPath = path.join(this.templatesDir, patternFileName);

    try {
      const loadedImage = await Jimp.read(patternPath);

      if (!this._validatePatternColors(loadedImage)) {
        this.patternImage = null;
        this.patternMatrix = null;
        this.patternWidth = 0;
        this.patternHeight = 0;
        return false; // Validation failed.
      }

      // Validation passed, store image and pre-process.
      this.patternImage = loadedImage;
      this.patternWidth = this.patternImage.bitmap.width;
      this.patternHeight = this.patternImage.bitmap.height;

      this.patternMatrix = [];
      for (let y = 0; y < this.patternHeight; y++) {
        const row = [];
        for (let x = 0; x < this.patternWidth; x++) {
          row.push(this.patternImage.getPixelColor(x, y));
        }
        this.patternMatrix.push(row);
      }

      console.log(
        `[PatternService] Pattern '${patternFileName}' (${this.patternWidth}x${this.patternHeight}) loaded and validated.`
      );
      return true;
    } catch (err) {
      console.error(
        `[PatternService] Failed to load pattern '${patternFileName}' from '${patternPath}':`,
        err.message
      );
      this.patternImage = null;
      this.patternMatrix = null;
      this.patternWidth = 0;
      this.patternHeight = 0;
      return false;
    }
  }

  // Searches for the pre-loaded pattern within a given QR code Jimp image.
  // Returns match location {x, y, pattern} or null.
  findPatternInQr(qrJimpImage, logDetails = false) {
    if (
      !this.patternMatrix ||
      !this.patternImage ||
      !qrJimpImage ||
      !qrJimpImage.bitmap ||
      !qrJimpImage.bitmap.data
    ) {
      // Essential data missing for search.
      if (logDetails)
        console.log(
          "[MATCHER-DEBUG] Pre-flight check failed: Missing patternMatrix, patternImage, or valid qrJimpImage."
        );
      return null;
    }

    const qrBitmap = qrJimpImage.bitmap; // More direct access to bitmap properties

    // Basic dimension check: pattern cannot be larger than the QR image.
    if (
      this.patternWidth > qrBitmap.width ||
      this.patternHeight > qrBitmap.height
    ) {
      if (logDetails)
        console.log(
          "[MATCHER-DEBUG] Pattern dimensions exceed QR image dimensions."
        );
      return null;
    }

    // Iterate through possible top-left starting positions of the pattern in the QR image.
    for (let yQr = 0; yQr <= qrBitmap.height - this.patternHeight; yQr++) {
      for (let xQr = 0; xQr <= qrBitmap.width - this.patternWidth; xQr++) {
        let isMatch = true;
        // if (logDetails && yQr === 2 && xQr === 2) { // Your specific debug hook
        //   console.log(`[MATCHER-DEBUG] Checking for pattern at target QR pos (${xQr},${yQr})`);
        // }

        // Compare each pixel of the pattern against the corresponding QR image region.
        for (let yP = 0; yP < this.patternHeight; yP++) {
          for (let xP = 0; xP < this.patternWidth; xP++) {
            const qrPixelColor = qrJimpImage.getPixelColor(xQr + xP, yQr + yP); // Use Jimp's method for consistency
            const patternPixelColor = this.patternMatrix[yP][xP];

            // if (logDetails && yQr === 2 && xQr === 2) { // Your specific debug hook
            //   console.log(`  QR(${xQr + xP},${yQr + yP})[0x${qrPixelColor.toString(16).padStart(8, "0")}] vs Pat(${xP},${yP})[0x${patternPixelColor.toString(16).padStart(8, "0")}]`);
            // }

            if (qrPixelColor !== patternPixelColor) {
              isMatch = false;
              // if (logDetails && yQr === 2 && xQr === 2) { console.log("    -> Mismatch!"); }
              break; // Mismatch found in this row of the pattern.
            }
          }
          if (!isMatch) {
            break; // Mismatch found, no need to check further rows for this position.
          }
        }

        if (isMatch) {
          // Pattern found! Return its top-left coordinates and the pattern filename.
          return { x: xQr, y: yQr, pattern: this.patternFileName };
        }
      }
    }
    return null; // Pattern not found in the QR image.
  }
}

module.exports = PatternMatcherService;
