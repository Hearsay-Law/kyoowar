// services/URLPermutator.js
class URLPermutator {
  constructor() {
    this.charSets = {
      alphanumeric:
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      alpha: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
      lowercaseAlpha: "abcdefghijklmnopqrstuvwxyz",
      uppercaseAlpha: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      numeric: "0123456789",
      hex: "0123456789abcdefABCDEF",
      custom: "", // Can be set by user
    };
  }

  /**
   * Generates random strings of a given length from a character set.
   * @param {number} length - The desired length of the string.
   * @param {string} charSet - The characters to choose from.
   * @returns {string} A random string.
   */
  _generateRandomString(length, charSet) {
    let result = "";
    const charactersLength = charSet.length;
    for (let i = 0; i < length; i++) {
      result += charSet.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

  /**
   * Generates URL variations based on a template and parameters.
   * @param {string} urlTemplate - e.g., "http://example.com/{VAR}/details"
   * @param {string} placeholder - The string to replace, e.g., "{VAR}"
   * @param {string} selectedCharSetType - Key from this.charSets (e.g., 'alphanumeric')
   * @param {string} customCharSet - User-defined characters if selectedCharSetType is 'custom'.
   * @param {number} minLength - Minimum length of the variable part.
   * @param {number} maxLength - Maximum length of the variable part.
   * @param {number} count - Number of unique variations to generate.
   * @returns {string[]} An array of generated URLs.
   */
  generateVariations(
    urlTemplate,
    placeholder,
    selectedCharSetType,
    customCharSet,
    minLength,
    maxLength,
    count
  ) {
    const urls = new Set();
    let charSetToUse =
      this.charSets[selectedCharSetType] || this.charSets.alphanumeric;
    if (selectedCharSetType === "custom" && customCharSet) {
      charSetToUse = customCharSet;
    }

    if (!charSetToUse || charSetToUse.length === 0) {
      console.warn(
        "URLPermutator: Character set is empty. Using default alphanumeric."
      );
      charSetToUse = this.charSets.alphanumeric;
    }

    minLength = Math.max(1, minLength); // Ensure minLength is at least 1
    maxLength = Math.max(minLength, maxLength); // Ensure maxLength is not less than minLength

    let attempts = 0; // To prevent infinite loops if count is too high for the search space
    const maxAttempts = count * (maxLength - minLength + 1) * 10; // Heuristic for max attempts

    while (urls.size < count && attempts < maxAttempts) {
      const currentLength =
        minLength + Math.floor(Math.random() * (maxLength - minLength + 1));
      const variablePart = this._generateRandomString(
        currentLength,
        charSetToUse
      );
      const newUrl = urlTemplate.replace(placeholder, variablePart);
      urls.add(newUrl);
      attempts++;
    }
    return Array.from(urls);
  }
}

module.exports = URLPermutator;
