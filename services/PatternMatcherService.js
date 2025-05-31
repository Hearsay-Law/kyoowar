// services/PatternMatcherService.js
const Jimp = require("jimp");
const path = require("path");

const PURE_BLACK_INT = Jimp.rgbaToInt(0, 0, 0, 255);
const PURE_WHITE_INT = Jimp.rgbaToInt(255, 255, 255, 255);

class PatternMatcherService {
  constructor(templatesDir) {
    this.templatesDir = templatesDir;
    this.patternMatrix = null; // Will hold 2D array of integer colors
    this.patternWidth = 0;
    this.patternHeight = 0;
    this.patternFileName = "";
  }

  _validatePatternColors(imageObject) {
    let invalidPixelFound = false;
    let firstInvalidColorData = null;

    imageObject.scan(
      0,
      0,
      imageObject.bitmap.width,
      imageObject.bitmap.height,
      function (x, y, idx) {
        const red = this.bitmap.data[idx + 0];
        const green = this.bitmap.data[idx + 1];
        const blue = this.bitmap.data[idx + 2];
        const alpha = this.bitmap.data[idx + 3];
        const currentColorInt = Jimp.rgbaToInt(red, green, blue, alpha);

        if (
          currentColorInt !== PURE_BLACK_INT &&
          currentColorInt !== PURE_WHITE_INT
        ) {
          if (!invalidPixelFound) {
            firstInvalidColorData = {
              x,
              y,
              r: red,
              g: green,
              b: blue,
              a: alpha,
              int: currentColorInt,
            };
          }
          invalidPixelFound = true;
        }
      }
    );

    if (invalidPixelFound) {
      console.error(
        `[PatternMatcherService] Validation Error for pattern '${this.patternFileName}':`
      );
      console.error(
        `  Image contains colors other than pure black or pure white.`
      );
      if (firstInvalidColorData) {
        console.error(
          `  First invalid pixel found at (${firstInvalidColorData.x}, ${firstInvalidColorData.y}) with color:`
        );
        console.error(
          `  R: ${firstInvalidColorData.r}, G: ${firstInvalidColorData.g}, B: ${
            firstInvalidColorData.b
          }, A: ${firstInvalidColorData.a} (Int: 0x${firstInvalidColorData.int
            .toString(16)
            .padStart(8, "0")})`
        );
      }
      console.error(
        `  Expected opaque pure black (0x${PURE_BLACK_INT.toString(16).padStart(
          8,
          "0"
        )}) or opaque pure white (0x${PURE_WHITE_INT.toString(16).padStart(
          8,
          "0"
        )}).`
      );
      return false;
    }
    return true;
  }

  async loadPattern(patternFileName) {
    let patternPath = "";
    let tempLoadedImage = null;

    try {
      this.patternFileName = patternFileName;
      patternPath = path.join(this.templatesDir, patternFileName);

      tempLoadedImage = await Jimp.read(patternPath);

      if (!this._validatePatternColors(tempLoadedImage)) {
        this.patternMatrix = null;
        this.patternImage = null; // Explicitly nullify if validation fails
        return false;
      }

      // If validation passes, assign to the class properties
      this.patternImage = tempLoadedImage; // <<<< ENSURE THIS IS HERE AND EXECUTED
      this.patternWidth = this.patternImage.bitmap.width;
      this.patternHeight = this.patternImage.bitmap.height;

      // Pre-process pattern into a matrix
      this.patternMatrix = [];
      for (let y = 0; y < this.patternHeight; y++) {
        const row = [];
        for (let x = 0; x < this.patternWidth; x++) {
          row.push(this.patternImage.getPixelColor(x, y)); // Can use this.patternImage now
        }
        this.patternMatrix.push(row);
      }

      console.log(
        `[PatternMatcherService] Pattern '${patternFileName}' loaded, validated, and pre-processed (${this.patternWidth}x${this.patternHeight}).`
      );
      return true;
    } catch (err) {
      console.error(
        `[PatternMatcherService] Error during loadPattern for '${patternFileName}'. Error:`,
        err
      );
      this.patternMatrix = null;
      return false;
    }
  }

  findPatternInQr(qrJimpImage, logDetails = false) {
    // Added logDetails for consistency
    if (
      !this.patternMatrix ||
      !qrJimpImage ||
      !qrJimpImage.bitmap ||
      !qrJimpImage.bitmap.data
    ) {
      return null;
    }

    const qrBitmapData = qrJimpImage.bitmap.data;
    const qrBitmapWidth = qrJimpImage.bitmap.width;
    const qrHeight = qrJimpImage.bitmap.height;

    if (this.patternWidth > qrBitmapWidth || this.patternHeight > qrHeight) {
      return null;
    }

    for (let yQr = 0; yQr <= qrHeight - this.patternHeight; yQr++) {
      for (let xQr = 0; xQr <= qrBitmapWidth - this.patternWidth; xQr++) {
        let isMatch = true;
        if (logDetails && yQr === 2 && xQr === 2) {
          // Example: log for test blit location
          console.log(
            `[MATCHER-DEBUG] Checking for pattern at target QR pos (${xQr},${yQr})`
          );
        }
        for (let yP = 0; yP < this.patternHeight; yP++) {
          for (let xP = 0; xP < this.patternWidth; xP++) {
            // Direct bitmap data access for QR image pixel
            const qrPixelDataIndex =
              ((yQr + yP) * qrBitmapWidth + (xQr + xP)) * 4;
            const r = qrBitmapData[qrPixelDataIndex + 0];
            const g = qrBitmapData[qrPixelDataIndex + 1];
            const b = qrBitmapData[qrPixelDataIndex + 2];
            const a = qrBitmapData[qrPixelDataIndex + 3];
            const qrPixelColor = Jimp.rgbaToInt(r, g, b, a);

            const patternPixelColor = this.patternMatrix[yP][xP]; // Access pre-processed matrix

            if (logDetails && yQr === 2 && xQr === 2) {
              console.log(
                `  QR(${xQr + xP},${yQr + yP})[0x${qrPixelColor
                  .toString(16)
                  .padStart(8, "0")}] vs Pat(${xP},${yP})[0x${patternPixelColor
                  .toString(16)
                  .padStart(8, "0")}]`
              );
            }

            if (qrPixelColor !== patternPixelColor) {
              isMatch = false;
              if (logDetails && yQr === 2 && xQr === 2) {
                console.log("    -> Mismatch!");
              }
              break;
            }
          }
          if (!isMatch) {
            break;
          }
        }

        if (isMatch) {
          return { x: xQr, y: yQr, pattern: this.patternFileName };
        }
      }
    }
    return null;
  }
}

module.exports = PatternMatcherService;
