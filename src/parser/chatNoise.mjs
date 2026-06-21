const colorCodePattern = /(?:\u00a7|&)[0-9a-fk-or]/gi;
const repeatedSpacePattern = /\s+/g;
const clientModNoisePrefixPattern = /^(?:\[(?:AquaVit|Noteless|FoodByte)\]|(?:AquaVit|Noteless|FoodByte)\b)/i;

export function isClientModNoiseMessage(message) {
  const cleaned = String(message ?? "")
    .replace(colorCodePattern, "")
    .replace(repeatedSpacePattern, " ")
    .trim();
  return clientModNoisePrefixPattern.test(cleaned);
}
