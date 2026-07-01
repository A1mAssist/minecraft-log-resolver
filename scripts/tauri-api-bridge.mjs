import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { createReportApiContext, handleReportApiRequest } from "../src/api/reportApi.mjs";

const context = await createReportApiContext();
const lines = createInterface({
  input: stdin,
  crlfDelay: Infinity,
});

for await (const line of lines) {
  if (!line.trim()) continue;
  let message = null;
  try {
    message = JSON.parse(line);
    const response = await handleReportApiRequest(context, {
      method: message.method,
      url: message.url,
      body: message.body ?? {},
    });
    write({
      id: message.id,
      ok: true,
      response: {
        status: response.status,
        headers: response.headers ?? {},
        body: response.body ?? null,
      },
    });
  } catch (error) {
    write({
      id: message?.id ?? null,
      ok: false,
      error: {
        status: error.status ?? 500,
        code: error.code ?? "tauri_bridge_request_failed",
        message: error.message,
      },
    });
  }
}

function write(value) {
  stdout.write(`${JSON.stringify(value)}\n`);
}
