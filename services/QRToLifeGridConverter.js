// services/QRToLifeGridConverter.js
const Jimp = require("jimp");

// Define what pixel color values constitute "live" (e.g., black) vs "dead" (e.g., white)
// For simplicity, let's assume QR codes generated are black on white.
// We'll treat dark pixels as live and light pixels as dead.
// A more sophisticated approach might analyze the dominant colors or average brightness.
const LIVE_CELL_THRESHOLD_UINT = Jimp.rgbaToInt(128, 128, 128, 255); // Anything darker than mid-gray

class QRToLifeGridConverter {
  constructor() {
    // Configuration could be added here if needed, e.g., custom thresholds.
  }

  /**
   * Converts a Jimp image (expected to be a QR code) into a 2D grid for Game of Life.
   * Black/dark pixels are treated as live (1), white/light pixels as dead (0).
   * The dimensions of the grid will match the pixel dimensions of the QR code image.
   *
   * @param {Jimp} qrJimpImage - The Jimp image object of the QR code.
   * @returns {Array<Array<number>>|null} A 2D array representing the GOL grid, or null if input is invalid.
   */
  convert(qrJimpImage) {
    if (!qrJimpImage || !qrJimpImage.bitmap || !qrJimpImage.bitmap.data) {
      console.error("[QRToLifeGridConverter] Invalid Jimp image provided.");
      return null;
    }

    const width = qrJimpImage.bitmap.width;
    const height = qrJimpImage.bitmap.height;
    const grid = [];

    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        const pixelColorInt = qrJimpImage.getPixelColor(x, y);
        // For QR codes, typically:
        // - Black (or dark color) modules are data / "on"
        // - White (or light color) background is "off"

        // A simple thresholding: if the pixel is darker than a certain value, it's "live" (1).
        // Jimp.intToRGBA can be used to get individual components if needed for more complex logic.
        // For now, we compare the integer value. Lower integer values are typically darker.
        // Note: Pure black is Jimp.rgbaToInt(0,0,0,255), Pure white is Jimp.rgbaToInt(255,255,255,255).
        // We need to decide if we treat only PURE_BLACK as live or a range of dark colors.
        // Using PURE_BLACK_INT might be too strict if QR generation has slight variations.
        // Let's use a threshold.
        const color = Jimp.intToRGBA(pixelColorInt);
        const brightness = (color.r + color.g + color.b) / 3; // Simple average brightness

        if (brightness < 128) {
          // If average component value is less than half (darker)
          row.push(1); // Live cell
        } else {
          row.push(0); // Dead cell
        }
      }
      grid.push(row);
    }
    return grid;
  }

  /**
   * A more direct conversion if QR codes are guaranteed to be pure black and white.
   *
   * @param {Jimp} qrJimpImage - The Jimp image object of the QR code (expected to be B&W).
   * @returns {Array<Array<number>>|null} A 2D array representing the GOL grid, or null if input is invalid.
   */
  convertMonochrome(qrJimpImage) {
    if (!qrJimpImage || !qrJimpImage.bitmap || !qrJimpImage.bitmap.data) {
      console.error(
        "[QRToLifeGridConverter] Invalid Jimp image provided for monochrome conversion."
      );
      return null;
    }

    const PURE_BLACK_INT = Jimp.rgbaToInt(0, 0, 0, 255);
    // Any other color (including pure white) will be treated as dead.

    const width = qrJimpImage.bitmap.width;
    const height = qrJimpImage.bitmap.height;
    const grid = [];

    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        const pixelColorInt = qrJimpImage.getPixelColor(x, y);
        if (pixelColorInt === PURE_BLACK_INT) {
          row.push(1); // Live cell
        } else {
          row.push(0); // Dead cell
        }
      }
      grid.push(row);
    }
    return grid;
  }
}

module.exports = QRToLifeGridConverter;
