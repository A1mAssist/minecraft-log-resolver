import path from "node:path";

const datedLogPattern = /(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})-\d+\.log(?:\.gz)?$/i;
const chatLogPattern = /^!CHAT(?<month>\d{2})(?<day>\d{2})_(?<hour>\d{2})_(?<minute>\d{2})/i;

export function inferFileBaseDate(file) {
  const name = path.basename(file.path);
  const dated = name.match(datedLogPattern);
  if (dated?.groups) {
    return {
      year: Number(dated.groups.year),
      month: Number(dated.groups.month),
      day: Number(dated.groups.day),
      source: "filename",
    };
  }

  const chat = name.match(chatLogPattern);
  const modified = new Date(file.modifiedMs);
  if (chat?.groups) {
    return {
      year: modified.getFullYear(),
      month: Number(chat.groups.month),
      day: Number(chat.groups.day),
      source: "chat_filename",
    };
  }

  return {
    year: modified.getFullYear(),
    month: modified.getMonth() + 1,
    day: modified.getDate(),
    source: "mtime",
  };
}

export function parseTimeOfDay(timeText) {
  if (!timeText) return null;
  const match = timeText.match(/^(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})$/);
  if (!match?.groups) return null;
  return Number(match.groups.hour) * 3600 + Number(match.groups.minute) * 60 + Number(match.groups.second);
}

export function createTimestampResolver(file) {
  const base = inferFileBaseDate(file);
  const baseMs = new Date(base.year, base.month - 1, base.day).getTime();
  let lastSecond = null;
  let dayOffset = 0;

  return {
    base,
    resolve(timeText) {
      const second = parseTimeOfDay(timeText);
      if (second === null) return null;

      if (lastSecond !== null && second < lastSecond && lastSecond - second > 6 * 3600) {
        dayOffset += 1;
      }
      lastSecond = second;

      return baseMs + dayOffset * 24 * 3600 * 1000 + second * 1000;
    },
  };
}

export function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}
