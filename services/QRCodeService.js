// services/QRCodeService.js
const qrcode = require("qrcode");
const Jimp = require("jimp");
const path = require("path");
const fs = require("fs").promises; // Use promises version of fs

class QRCodeService {
  constructor(uploadsDir) {
    this.uploadsDir = uploadsDir;
  }

  async ensureUploadsDirExists() {
    try {
      await fs.mkdir(this.uploadsDir, { recursive: true });
    } catch (error) {
      if (error.code !== "EEXIST") {
        // Ignore if directory already exists
        console.error("Failed to create uploads directory:", error);
        throw error;
      }
    }
  }

  /**
   * Generates a QR code from text and saves it as an image file.
   * @param {string} textToEncode - The text/URL to encode.
   * @param {object} options - qrcode library options.
   * @param {string} fileNamePrefix - Prefix for the filename.
   * @returns {Promise<object|null>} Object containing { filePath, urlPath, originalText, width, height } or null on error
   */
  async generateQRCodeToFile(
    textToEncode,
    options = {},
    fileNamePrefix = "qr"
  ) {
    await this.ensureUploadsDirExists(); // Make sure dir exists
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const fileName = `${fileNamePrefix}_${Date.now()}_${randomSuffix}.png`;
    const filePath = path.join(this.uploadsDir, fileName);

    try {
      await qrcode.toFile(filePath, textToEncode, options);
      const image = await Jimp.read(filePath);
      return {
        filePath: filePath,
        fileName: fileName,
        urlPath: `/uploads/${fileName}`,
        originalText: textToEncode,
        width: image.bitmap.width,
        height: image.bitmap.height,
      };
    } catch (err) {
      console.error(
        `Error generating QR code for text "${textToEncode}" to file:`,
        err
      );
      // Attempt to clean up failed file
      try {
        await fs.unlink(filePath);
      } catch (e) {
        /* ignore cleanup error */
      }
      return null;
    }
  }

  /**
   * Generates QR and returns Jimp image object directly (for searching)
   * @param {string} textToEncode
   * @param {object} options
   * @returns {Promise<Jimp|null>} Jimp image object or null on error
   */
  async generateQRCodeToJimp(textToEncode, options = {}) {
    try {
      // qrcode.toBuffer is efficient for this
      const buffer = await qrcode.toBuffer(textToEncode, {
        ...options,
        type: "png",
      });
      const image = await Jimp.read(buffer);
      return image;
    } catch (err) {
      // console.error(`Error generating QR code for text "${textToEncode}" to Jimp:`, err);
      return null; // Expected for some random data that's too long, etc.
    }
  }
}

module.exports = QRCodeService;
