import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { TextDecoder } from "node:util";

export async function* readLogLines(file, options = {}) {
  const input = createReadStream(file.path);
  const stream = file.kind === "gzip" ? input.pipe(createGunzip()) : input;
  const decoder = new TextDecoder(options.encoding ?? "utf-8", { fatal: false });

  let lineNo = 0;
  let carry = "";

  for await (const chunk of stream) {
    carry += decoder.decode(chunk, { stream: true });
    const lines = carry.split(/\r?\n/);
    carry = lines.pop() ?? "";

    for (const text of lines) {
      lineNo += 1;
      yield { lineNo, text };
    }
  }

  carry += decoder.decode();
  if (carry.length > 0) {
    lineNo += 1;
    yield { lineNo, text: carry };
  }
}
