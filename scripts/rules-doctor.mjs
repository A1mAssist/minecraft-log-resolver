import { createReportApiContext } from "../src/api/reportApi.mjs";
import { buildRuleDoctor } from "../src/parser/ruleEcosystem.mjs";

const args = process.argv.slice(2);
const context = await createReportApiContext(readOption("--config") ?? undefined);
const result = await buildRuleDoctor(context);

if (args.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.table(result.issues.map((issue) => ({
    severity: issue.severity,
    code: issue.code,
    rulePack: issue.rulePackId,
    message: issue.message,
  })));
  console.log(JSON.stringify({ ok: result.ok, inventory: result.inventory }, null, 2));
}

if (!result.ok) process.exit(1);

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
