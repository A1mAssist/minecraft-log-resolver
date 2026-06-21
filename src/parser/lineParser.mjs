const standardLinePattern = /^\[(?<time>\d{2}:\d{2}:\d{2})\]\s+\[[^\]]+\](?:\s+\[[^\]]+\])?:\s*(?<message>.*)$/;

export function parseLine(filePath, lineNo, rawText) {
  const standard = rawText.match(standardLinePattern);
  const timeText = standard?.groups?.time ?? null;
  const message = standard?.groups?.message ?? rawText;
  const chatMarker = "[CHAT]";
  const chatIndex = message.indexOf(chatMarker);

  if (chatIndex >= 0) {
    return {
      filePath,
      lineNo,
      timeText,
      message: message.slice(chatIndex + chatMarker.length).trim(),
      isChat: true,
    };
  }

  return {
    filePath,
    lineNo,
    timeText,
    message,
    isChat: false,
  };
}
