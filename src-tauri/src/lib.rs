use chrono::{Datelike, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use encoding_rs::{Encoding, UTF_8};
use flate2::read::GzDecoder;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    cmp::Ordering,
    collections::{BTreeMap, HashMap, HashSet},
    env,
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use url::Url;

const CONFIG_FILE_NAME: &str = "minecraft-log-resolver.config.json";
const LOCAL_CONFIG_FILE_NAME: &str = "minecraft-log-resolver.local.json";
const LEGACY_CONFIG_FILE_NAME: &str = "minecraft-log-observatory.config.json";
const LEGACY_LOCAL_CONFIG_FILE_NAME: &str = "minecraft-log-observatory.local.json";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiRequest {
    method: String,
    url: String,
    #[serde(default)]
    body: Value,
}

#[derive(Debug, Serialize)]
struct ApiResponse {
    status: u16,
    headers: Value,
    body: Value,
}

struct AppContext {
    root: PathBuf,
    config_path: PathBuf,
    local_config_path: PathBuf,
    local_config_exists: bool,
    config: Value,
    data_dir: PathBuf,
    store_dir: PathBuf,
    report_path: PathBuf,
    summary_path: PathBuf,
    unmatched_path: PathBuf,
}

#[tauri::command]
fn api_request(request: ApiRequest) -> Result<ApiResponse, String> {
    let context = AppContext::discover();
    Ok(route_api(&context, request))
}

impl AppContext {
    fn discover() -> Self {
        let root = find_app_root().unwrap_or_else(fallback_app_root);
        let config_path = preferred_config_path(&root);
        let local_config_path = preferred_local_config_path(&root);
        let mut config = default_config();
        if let Ok(file_config) = read_json_file(&config_path) {
            merge_json(&mut config, file_config);
        }
        let local_config_exists = local_config_path.is_file();
        if local_config_exists {
            if let Ok(local_config) = read_json_file(&local_config_path) {
                merge_json(&mut config, local_config);
            }
        }

        let data_dir = resolve_app_path(
            &root,
            get_path_string(&config, &["app", "dataDir"]).unwrap_or("data"),
        );
        let report_path = resolve_app_path(
            &root,
            get_path_string(&config, &["outputs", "report"]).unwrap_or("report-combined.json"),
        );
        let summary_path = resolve_app_path(
            &root,
            get_path_string(&config, &["outputs", "summary"])
                .unwrap_or("report-combined-summary.json"),
        );
        let store_dir = data_dir.join("report-store");
        let unmatched_path = root.join("unmatched-debug.json");

        Self {
            root,
            config_path,
            local_config_path,
            local_config_exists,
            config,
            data_dir,
            store_dir,
            report_path,
            summary_path,
            unmatched_path,
        }
    }
}

fn route_api(context: &AppContext, request: ApiRequest) -> ApiResponse {
    let method = request.method.to_ascii_uppercase();
    let url = match parse_api_url(&request.url) {
        Ok(url) => url,
        Err(error) => {
            return error_response(
                400,
                "invalid_api_url",
                "API request URL could not be parsed.",
                json!({ "details": error }),
            );
        }
    };
    let path = url.path();

    if !path.starts_with("/api/") {
        return error_response(
            404,
            "not_found",
            "Only /api/* routes are available in the Tauri runtime.",
            json!({}),
        );
    }

    match (method.as_str(), path) {
        ("POST", "/api/system/select-directory") => return select_directory_response(context),
        ("POST", "/api/config/validate-roots") => {
            return validate_roots_response(context, &request.body)
        }
        ("PUT", "/api/config") => return save_config_response(context, &request.body),
        ("POST", "/api/refresh") => return run_refresh_response(context),
        ("POST", "/api/refresh/preflight") => return refresh_preflight_response(context),
        ("POST", "/api/refresh/cancel") => return refresh_cancel_response(),
        ("POST", "/api/data/cleanup") => return cleanup_response(context, &request.body),
        ("POST", "/api/rules/test") => return rule_test_response(context, &request.body),
        ("POST", "/api/rules/draft") => return rule_draft_response(&request.body),
        ("POST", "/api/rules/validate") => return rule_validate_response(&request.body),
        ("POST", "/api/rules/dry-run") => return rules_dry_run_response(context, &request.body),
        ("POST", "/api/rules/audit-workflow") => {
            return rules_audit_workflow_response(context, &request.body)
        }
        ("POST", "/api/rules/draft-from-labels") => {
            return rule_draft_from_labels_response(context, &request.body)
        }
        ("POST", "/api/unknown-audit/labels") => {
            return unknown_audit_labels_response(&request.body)
        }
        ("POST", "/api/unknown-audit/status") => {
            return unknown_audit_status_response(&request.body)
        }
        ("POST", "/api/unknown-audit/label-sets") => {
            return unknown_audit_label_sets_response(context, &request.body)
        }
        ("POST", "/api/rule-packs/user") => {
            return user_rule_pack_save_response(context, &request.body)
        }
        ("POST", "/api/rule-packs/user/enable") => {
            return user_rule_pack_enable_response(context, &request.body)
        }
        ("POST", "/api/rule-packs/user/backups") => {
            return user_rule_pack_backups_response(context, &request.body)
        }
        ("POST", "/api/rule-packs/user/restore") => {
            return user_rule_pack_restore_response(context, &request.body)
        }
        _ => {}
    }

    if method != "GET" {
        if method == "DELETE" && path.starts_with("/api/rule-packs/user/") {
            return user_rule_pack_delete_response(context, path);
        }
        return error_response(
            405,
            "method_not_allowed",
            "This API route does not accept that method.",
            json!({ "path": path, "method": method }),
        );
    }

    match path {
        "/api/health" => json_response(
            200,
            json!({ "ok": true, "runtime": "tauri-rust", "tcpListeners": false }),
        ),
        "/api/app/status" => app_status_response(context),
        "/api/config" => config_response(context),
        "/api/refresh" => refresh_response(),
        "/api/refresh/history" => refresh_history_response(context),
        "/api/refresh/preflight" => refresh_preflight_response(context),
        "/api/diagnostics" => diagnostics_response(context),
        "/api/diagnostics/package" => diagnostics_package_response(context),
        "/api/share/package" => diagnostics_package_response(context),
        "/api/performance" => performance_response(context),
        "/api/skin" => skin_response(),
        "/api/minecraft-profile" => minecraft_profile_response(&url),
        "/api/metrics/definitions" => store_json_response(context, "metricDefinitions"),
        "/api/report" => read_json_response(&context.report_path, "report_not_ready"),
        "/api/summary" => read_json_response(&context.summary_path, "summary_not_ready"),
        "/api/profile" => store_json_response(context, "profile"),
        "/api/modes" => modes_response(context),
        "/api/results" => store_json_response(context, "results"),
        "/api/accounts" => store_json_response(context, "accounts"),
        "/api/accounts/playtime" => jsonl_table_response(
            context,
            "accountPlaytime",
            &url,
            Some(filter_account_playtime),
        ),
        "/api/activity" => activity_response(context, &url),
        "/api/rounds" => rounds_response(context, &url),
        "/api/result-candidates" => result_candidates_response(context, &url),
        "/api/rules" => store_json_response(context, "rules"),
        "/api/rules/doctor" => rules_doctor_response(context),
        "/api/rules/audit" => rules_audit_response(context),
        "/api/rule-packs" => read_only_rule_packs_response(context),
        "/api/rule-packs/user" => user_rule_packs_response(context),
        "/api/rule-packs/validate" => read_only_rule_packs_validate_response(context),
        "/api/store" => store_response(context),
        "/api/store/table" => store_table_response(context, &url),
        "/api/timeseries" => timeseries_response(context, &url),
        "/api/sources" => jsonl_table_response(context, "bySource", &url, None),
        "/api/scopes" => jsonl_table_response(context, "byScope", &url, Some(filter_source_scope)),
        "/api/days" => jsonl_table_response(context, "byDay", &url, Some(filter_day_range)),
        "/api/unmatched" => unmatched_response(context),
        _ if path.starts_with("/api/accounts/") => account_detail_response(context, path),
        _ if path.starts_with("/api/rule-packs/user/") => {
            user_rule_pack_detail_response(context, path)
        }
        _ => error_response(
            404,
            "not_found",
            "API route is not implemented in the Rust Tauri runtime.",
            json!({ "path": path }),
        ),
    }
}

fn app_status_response(context: &AppContext) -> ApiResponse {
    let roots = config_roots(&context.config);
    let first_run = roots.is_empty();
    let report_file_exists = context.report_path.is_file();
    let summary = read_json_file(&context.summary_path).ok();
    let summary_file_exists = summary.is_some();
    let report_ready = report_file_exists && summary_file_exists;
    let manifest = read_store_manifest(context).ok();
    let store_ready = manifest
        .as_ref()
        .map(|manifest| store_files_ready(context, manifest))
        .unwrap_or(false);
    let report_generated_at = summary
        .as_ref()
        .and_then(|value| get_path_string(value, &["generatedAt"]))
        .map(str::to_string);
    let store_report_generated_at = manifest
        .as_ref()
        .and_then(|value| get_path_string(value, &["reportGeneratedAt"]))
        .map(str::to_string);
    let store_out_of_sync = report_ready
        && store_ready
        && report_generated_at.is_some()
        && store_report_generated_at.is_some()
        && report_generated_at != store_report_generated_at;
    let refresh_reasons = refresh_needed_reasons(report_ready, store_ready, store_out_of_sync);
    let data_ready = report_ready && store_ready && !store_out_of_sync;
    let setup = setup_status(first_run, data_ready, &refresh_reasons);
    let ready = setup.get("state").and_then(Value::as_str) == Some("ready") && data_ready;

    json_response(
        200,
        json!({
          "ok": true,
          "firstRun": first_run,
          "ready": ready,
          "needsRefresh": !refresh_reasons.is_empty(),
          "refreshReasons": refresh_reasons,
          "setup": setup,
          "recovery": {
            "state": if ready { "ready" } else if first_run { "first_run" } else { "needs_refresh" },
            "summary": if ready { "none" } else { "action_required" },
            "actions": recovery_actions(first_run, data_ready),
          },
          "app": {
            "dataDir": path_string(&context.data_dir),
            "storeDir": path_string(&context.store_dir),
            "runtime": "tauri-rust",
            "tcpListeners": false,
            "nodeBridge": false,
            "skinProxyEnabled": false,
            "skinProxy": {
              "enabled": false,
              "remoteRequestsAllowed": false
            },
            "launcher": {
              "contractVersion": 2,
              "transport": "tauri-ipc",
              "tcpListeners": false,
              "bindPolicy": {
                "localOnly": true,
                "allowedHosts": [],
                "defaultHost": null,
                "defaultPort": null,
                "supportsPortFallback": false
              },
              "desktopIntegration": {
                "directoryPickerRequired": true,
                "directoryPickerEndpoint": "POST /api/system/select-directory",
                "rootValidationEndpoint": "POST /api/config/validate-roots",
                "saveConfigEndpoint": "PUT /api/config",
                "statusEndpoint": "GET /api/app/status",
                "refreshEndpoint": "POST /api/refresh"
              }
            }
          },
          "project": {
            "configPath": path_string(&context.config_path),
            "localConfigPath": path_string(&context.local_config_path),
            "localConfigExists": context.local_config_exists,
            "dataDir": path_string(&context.data_dir),
            "roots": roots,
            "rootCount": roots.len(),
            "ownerAliases": get_path_value(&context.config, &["owner", "aliases"]).cloned().unwrap_or_else(|| json!([])),
            "customRules": get_path_value(&context.config, &["customRules"]).cloned().unwrap_or_else(|| json!([])),
          },
          "report": {
            "ready": report_ready,
            "path": path_string(&context.report_path),
            "summaryPath": path_string(&context.summary_path),
            "generatedAt": report_generated_at,
            "schema": summary.as_ref().and_then(|value| get_path_value(value, &["schema", "reportSchema"]).cloned()),
            "jsonError": null,
            "summaryJsonError": null,
            "schemaError": null,
            "schemaErrorReason": null,
            "summarySchemaError": null,
            "summarySchemaErrorReason": null
          },
          "store": {
            "ready": store_ready,
            "manifestPath": path_string(&context.store_dir.join("manifest.json")),
            "generatedAt": manifest.as_ref().and_then(|value| get_path_string(value, &["generatedAt"])),
            "reportGeneratedAt": store_report_generated_at,
            "reportMatchesStore": if report_ready && store_ready { Some(!store_out_of_sync) } else { None },
            "outOfSync": store_out_of_sync,
            "jsonError": null,
            "manifestError": null,
            "manifestErrorReason": null,
            "fileError": if manifest.is_some() && !store_ready { Some("Store manifest declares files that are missing.") } else { None },
            "fileErrorReason": if manifest.is_some() && !store_ready { Some("missing_files") } else { None },
            "missingFiles": if let Some(manifest) = manifest.as_ref() { missing_store_files(context, manifest) } else { json!([]) },
          },
          "refresh": refresh_body(),
        }),
    )
}

fn config_response(context: &AppContext) -> ApiResponse {
    json_response(
        200,
        json!({
          "effective": context.config,
          "paths": {
            "configPath": path_string(&context.config_path),
            "localConfigPath": path_string(&context.local_config_path),
            "localConfigExists": context.local_config_exists,
            "dataDir": path_string(&context.data_dir),
            "storeDir": path_string(&context.store_dir),
          },
          "writable": {
            "target": "localConfig",
            "implemented": true,
            "message": "Writes are saved to the local config next to the executable."
          }
        }),
    )
}

fn validate_roots_response(context: &AppContext, body: &Value) -> ApiResponse {
    let roots = match roots_from_body(body) {
        Ok(roots) => roots,
        Err(response) => return response,
    };
    let result = validate_log_roots(context, &roots);
    json_response(
        if result["ok"].as_bool() == Some(true) {
            200
        } else {
            400
        },
        result,
    )
}

fn save_config_response(context: &AppContext, body: &Value) -> ApiResponse {
    if !body.is_object() {
        return error_response(
            400,
            "invalid_config_request",
            "Config request must be a JSON object.",
            json!({}),
        );
    }
    if body.get("roots").is_some() {
        let roots = match roots_from_body(body) {
            Ok(roots) => roots,
            Err(response) => return response,
        };
        let validation = validate_log_roots(context, &roots);
        if validation["ok"].as_bool() != Some(true) {
            return json_response(400, validation);
        }
    }

    let mut local_config = read_json_file(&context.local_config_path).unwrap_or_else(|_| json!({}));
    merge_json(&mut local_config, body.clone());
    if let Some(parent) = context.local_config_path.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            return error_response(
                500,
                "config_write_failed",
                "Local config directory could not be created.",
                json!({ "path": path_string(&context.local_config_path), "details": error.to_string() }),
            );
        }
    }
    let text = match serde_json::to_string_pretty(&local_config) {
        Ok(text) => format!("{text}\n"),
        Err(error) => {
            return error_response(
                500,
                "config_write_failed",
                "Local config could not be serialized.",
                json!({ "details": error.to_string() }),
            );
        }
    };
    if let Err(error) = fs::write(&context.local_config_path, text) {
        return error_response(
            500,
            "config_write_failed",
            "Local config could not be written.",
            json!({ "path": path_string(&context.local_config_path), "details": error.to_string() }),
        );
    }

    let updated = AppContext::discover();
    json_response(
        200,
        json!({
          "ok": true,
          "localConfigPath": path_string(&updated.local_config_path),
          "effective": updated.config,
        }),
    )
}

fn refresh_response() -> ApiResponse {
    json_response(200, refresh_body())
}

fn refresh_body() -> Value {
    json!({
      "id": null,
      "running": false,
      "phase": "idle",
      "status": "idle",
      "percent": 0,
      "currentFile": null,
      "filesDone": 0,
      "filesTotal": 0,
      "files": { "done": 0, "total": 0 },
      "startedAt": null,
      "finishedAt": null,
      "durationMs": null,
      "phaseTimings": {},
      "phaseDurationsMs": {},
      "diagnostics": null,
      "exitCode": null,
      "cancelRequested": false,
      "failurePhase": null,
      "errorCategory": null,
      "error": null,
      "log": []
    })
}

#[derive(Clone, Default)]
struct ScanOutput {
    generated_at: String,
    roots: Vec<String>,
    files: Vec<LogFileInfo>,
    by_source: BTreeMap<String, Aggregate>,
    by_scope: BTreeMap<String, Aggregate>,
    by_day: BTreeMap<String, Aggregate>,
    modes: BTreeMap<String, ModeAggregate>,
    rounds: Vec<Value>,
    ignored_rounds: Vec<Value>,
    accounts: BTreeMap<String, AccountAggregate>,
    rule_sets: Vec<Value>,
    rule_counts: BTreeMap<String, u64>,
    unmatched: BTreeMap<String, u64>,
    chat_matched: u64,
}

#[derive(Clone)]
struct LogFileInfo {
    source: String,
    scope: String,
    path: PathBuf,
    size: u64,
    modified_ms: i64,
    date: Option<NaiveDate>,
}

#[derive(Clone, Default)]
struct Aggregate {
    files: u64,
    bytes: u64,
    chat_lines: u64,
    crashes: u64,
    sessions: u64,
    runtime_seconds: i64,
    playtime_seconds: i64,
    multiplayer_seconds: i64,
    singleplayer_seconds: i64,
    reliable_rounds: u64,
    ignored_rounds: u64,
    wins: u64,
    losses: u64,
    unknown_results: u64,
    kills: u64,
    deaths: u64,
    first_ms: Option<i64>,
    last_ms: Option<i64>,
}

#[derive(Clone, Default)]
struct ModeAggregate {
    id: String,
    label: String,
    rounds: u64,
    wins: u64,
    losses: u64,
    unknown_results: u64,
    duration_seconds: i64,
    kills: u64,
    deaths: u64,
    self_kills: u64,
    self_deaths: u64,
    bed_destroys: u64,
    self_bed_destroys: u64,
}

#[derive(Clone, Default)]
struct AccountAggregate {
    user: String,
    events: u64,
    files: HashSet<String>,
    scopes: HashSet<String>,
    sessions: u64,
    runtime_seconds: i64,
    playtime_seconds: i64,
    wins: u64,
    losses: u64,
    first_ms: Option<i64>,
    last_ms: Option<i64>,
}

#[derive(Clone)]
struct LogEvent {
    timestamp_ms: i64,
    source: String,
    scope: String,
    file_path: String,
    line_no: u64,
    message: String,
    event_type: String,
    payload: Map<String, Value>,
}

struct ActiveRound {
    source: String,
    scope: String,
    file_path: String,
    start_ms: i64,
    start_line: u64,
    mode: String,
    kills: u64,
    deaths: u64,
    self_deaths: u64,
    bed_destroys: u64,
}

#[derive(Clone)]
struct CompiledRuleSet {
    id: String,
    name: String,
    description: String,
    file_name: String,
    cleaners: Vec<CompiledCleaner>,
    rules: Vec<CompiledRule>,
}

#[derive(Clone)]
struct CompiledCleaner {
    regex: Regex,
    replacement: String,
}

#[derive(Clone)]
struct CompiledRule {
    id: String,
    event_type: String,
    regex: Regex,
    payload: Map<String, Value>,
    cleaners: Vec<CompiledCleaner>,
    legacy_rule_set: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRuleSet {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    cleaners: Vec<RawCleaner>,
    rules: Vec<RawRule>,
}

#[derive(Deserialize, Clone)]
struct RawCleaner {
    pattern: String,
    #[serde(default)]
    flags: String,
    #[serde(default)]
    replacement: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRule {
    id: String,
    #[serde(rename = "type")]
    event_type: String,
    pattern: String,
    #[serde(default)]
    flags: String,
    #[serde(default)]
    payload: Map<String, Value>,
    #[serde(default)]
    cleaners: Vec<RawCleaner>,
    #[serde(default)]
    legacy_rule_set: Option<String>,
}

const BUNDLED_RULES: &[(&str, &str)] = &[
    (
        "game-state.json",
        include_str!("../../src/parser/rules/game-state.json"),
    ),
    (
        "bedwars.json",
        include_str!("../../src/parser/rules/bedwars.json"),
    ),
    (
        "skywars.json",
        include_str!("../../src/parser/rules/skywars.json"),
    ),
    (
        "duels.json",
        include_str!("../../src/parser/rules/duels.json"),
    ),
    (
        "mega_walls.json",
        include_str!("../../src/parser/rules/mega_walls.json"),
    ),
    (
        "mini_walls.json",
        include_str!("../../src/parser/rules/mini_walls.json"),
    ),
    (
        "the_pit.json",
        include_str!("../../src/parser/rules/the_pit.json"),
    ),
    (
        "blitz_sg.json",
        include_str!("../../src/parser/rules/blitz_sg.json"),
    ),
    (
        "bridge.json",
        include_str!("../../src/parser/rules/bridge.json"),
    ),
    (
        "build_battle.json",
        include_str!("../../src/parser/rules/build_battle.json"),
    ),
    (
        "hide_and_seek.json",
        include_str!("../../src/parser/rules/hide_and_seek.json"),
    ),
    (
        "murder_mystery.json",
        include_str!("../../src/parser/rules/murder_mystery.json"),
    ),
    (
        "speed_uhc.json",
        include_str!("../../src/parser/rules/speed_uhc.json"),
    ),
    (
        "the_walls.json",
        include_str!("../../src/parser/rules/the_walls.json"),
    ),
    ("uhc.json", include_str!("../../src/parser/rules/uhc.json")),
    (
        "minecraft-combat.json",
        include_str!("../../src/parser/rules/minecraft-combat.json"),
    ),
];

fn run_refresh_response(context: &AppContext) -> ApiResponse {
    let started_at = now_iso();
    let refresh_id = format!("refresh-{}", now_millis());
    match build_scan_outputs(context) {
        Ok(output) => match write_scan_outputs(context, &output) {
            Ok(()) => json_response(
                200,
                json!({
                  "ok": true,
                  "refresh": completed_refresh_body(
                    refresh_id,
                    started_at,
                    output.files.len() as u64,
                    output.files.len() as u64,
                    None,
                  )
                }),
            ),
            Err(error) => json_response(
                500,
                json!({
                  "ok": false,
                  "error": "refresh_write_failed",
                  "message": "Rust refresh could not write derived report files.",
                  "refresh": completed_refresh_body(refresh_id, started_at, 0, 0, Some(error)),
                }),
            ),
        },
        Err(error) => json_response(
            500,
            json!({
              "ok": false,
              "error": "refresh_failed",
              "message": "Rust refresh failed while scanning Minecraft logs.",
              "refresh": completed_refresh_body(refresh_id, started_at, 0, 0, Some(error)),
            }),
        ),
    }
}

fn completed_refresh_body(
    id: String,
    started_at: String,
    files_done: u64,
    files_total: u64,
    error: Option<String>,
) -> Value {
    let failed = error.is_some();
    json!({
      "id": id,
      "running": false,
      "phase": if failed { "failed" } else { "done" },
      "status": if failed { "failed" } else { "done" },
      "percent": if failed { 0 } else { 100 },
      "currentFile": null,
      "filesDone": files_done,
      "filesTotal": files_total,
      "files": { "done": files_done, "total": files_total },
      "startedAt": started_at,
      "finishedAt": now_iso(),
      "durationMs": null,
      "phaseTimings": {},
      "phaseDurationsMs": {},
      "diagnostics": null,
      "exitCode": if failed { Some(1) } else { Some(0) },
      "cancelRequested": false,
      "failurePhase": if failed { Some("scan") } else { None },
      "errorCategory": if failed { Some("rust_refresh_failed") } else { None },
      "error": error,
      "log": []
    })
}

fn refresh_preflight_response(context: &AppContext) -> ApiResponse {
    let roots = config_roots(&context.config);
    let validation = validate_log_roots(context, &roots);
    let can_refresh =
        !roots.is_empty() && validation.get("ok").and_then(Value::as_bool) == Some(true);
    json_response(
        200,
        json!({
          "ok": true,
          "canRefresh": can_refresh,
          "recommendedAction": if can_refresh { "run_refresh" } else { "fix_blocking_issues" },
          "blocking": if can_refresh { json!([]) } else { json!([{ "code": "invalid_roots", "message": "Configure at least one readable Minecraft log root." }]) },
          "warnings": [],
          "roots": validation,
        }),
    )
}

fn refresh_cancel_response() -> ApiResponse {
    json_response(
        200,
        json!({ "ok": true, "message": "No refresh job is running.", "refresh": refresh_body() }),
    )
}

fn refresh_history_response(context: &AppContext) -> ApiResponse {
    let generated_at = read_json_file(&context.summary_path)
        .ok()
        .and_then(|value| get_path_string(&value, &["generatedAt"]).map(str::to_string));
    let item = generated_at.map(|finished_at| {
        json!({
          "id": "rust-latest",
          "phase": "done",
          "status": "done",
          "startedAt": null,
          "finishedAt": finished_at,
          "exitCode": 0,
          "hasError": false,
          "logLines": 0,
          "logTailLines": 0
        })
    });
    json_response(
        200,
        json!({
          "total": if item.is_some() { 1 } else { 0 },
          "items": item.clone().map(|value| vec![value]).unwrap_or_default(),
          "latest": item,
          "summary": {
            "total": if item.is_some() { 1 } else { 0 },
            "successful": if item.is_some() { 1 } else { 0 },
            "failed": 0,
            "lastErrorCategory": null
          }
        }),
    )
}

fn select_directory_response(context: &AppContext) -> ApiResponse {
    let Some(path) = rfd::FileDialog::new().pick_folder() else {
        return json_response(200, json!({ "ok": true, "cancelled": true }));
    };
    let root = path_string(&path);
    let validation = validate_log_roots(context, &[root.clone()]);
    json_response(
        200,
        json!({
          "ok": true,
          "cancelled": false,
          "path": root,
          "validation": validation,
        }),
    )
}

fn build_scan_outputs(context: &AppContext) -> Result<ScanOutput, String> {
    let roots = config_roots(&context.config);
    if roots.is_empty() {
        return Err("No configured Minecraft log roots.".to_string());
    }
    let encoding = get_path_string(&context.config, &["encoding"]).unwrap_or("utf-8");
    let rule_sets = load_rule_sets(context);
    let mut output = ScanOutput {
        generated_at: now_iso(),
        roots: roots.clone(),
        rule_sets: rule_sets
            .iter()
            .map(|set| {
                json!({
                  "id": set.id,
                  "name": set.name,
                  "description": set.description,
                  "rules": set.rules.len(),
                  "source": "bundled",
                  "filePath": set.file_name,
                })
            })
            .collect(),
        ..ScanOutput::default()
    };

    let files = discover_log_files_for_roots(context, &roots);
    let mut active_rounds = HashMap::<String, ActiveRound>::new();
    for file in files {
        add_file_aggregates(&mut output, &file);
        let text = match read_log_text(&file.path, encoding) {
            Ok(text) => text,
            Err(_) => {
                output.files.push(file);
                continue;
            }
        };
        scan_log_text(&mut output, &rule_sets, &mut active_rounds, &file, &text);
        output.files.push(file);
    }

    Ok(output)
}

fn discover_log_files_for_roots(context: &AppContext, roots: &[String]) -> Vec<LogFileInfo> {
    let mut files = Vec::new();
    for root in roots {
        let root_path = resolve_app_path(&context.root, root);
        let source = root_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(root)
            .to_string();
        for scope_path in discover_log_scopes(&root_path) {
            let scope = scope_label(&root_path, &scope_path);
            if let Ok(entries) = fs::read_dir(&scope_path) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = entry.file_name().to_string_lossy().to_string();
                    if !path.is_file() || !is_log_file_name(&name) {
                        continue;
                    }
                    let metadata = match fs::metadata(&path) {
                        Ok(metadata) => metadata,
                        Err(_) => continue,
                    };
                    files.push(LogFileInfo {
                        source: source.clone(),
                        scope: scope.clone(),
                        date: log_file_date(&name),
                        modified_ms: metadata
                            .modified()
                            .ok()
                            .and_then(system_time_ms)
                            .unwrap_or_else(now_millis),
                        size: metadata.len(),
                        path,
                    });
                }
            }
        }
    }
    files.sort_by(|a, b| {
        a.date
            .cmp(&b.date)
            .then_with(|| a.modified_ms.cmp(&b.modified_ms))
            .then_with(|| a.path.cmp(&b.path))
    });
    files
}

fn scan_log_text(
    output: &mut ScanOutput,
    rule_sets: &[CompiledRuleSet],
    active_rounds: &mut HashMap<String, ActiveRound>,
    file: &LogFileInfo,
    text: &str,
) {
    let mut fallback_line_ms = file_date_start_ms(file).unwrap_or(file.modified_ms);
    let mut session_start: Option<i64> = None;
    let mut session_multiplayer = false;
    let mut seen_chat_in_file = 0u64;
    for (index, raw) in text.lines().enumerate() {
        let line_no = index as u64 + 1;
        let (time_text, message, is_chat) = parse_log_line(raw);
        let timestamp_ms = time_text
            .and_then(|time| combine_date_time_ms(file, time))
            .unwrap_or(fallback_line_ms);
        fallback_line_ms = timestamp_ms.saturating_add(1);
        let lower = message.to_ascii_lowercase();
        if lower.contains("setting user:") && session_start.is_none() {
            session_start = Some(timestamp_ms);
        }
        if lower.contains("connecting to ") || lower.contains("joined the game") {
            session_start.get_or_insert(timestamp_ms);
            session_multiplayer = true;
        }
        if lower.contains("stopping!")
            || lower.contains("stopping server")
            || lower.contains("stopping singleplayer")
            || lower.contains("game crashed")
            || lower.contains("crash report")
            || lower.contains("reported exception")
        {
            if lower.contains("crash") || lower.contains("exception") {
                bump_aggregate(&mut output.by_source, &file.source, |item| {
                    item.crashes += 1
                });
                bump_aggregate(&mut output.by_scope, &scope_key(file), |item| {
                    item.crashes += 1
                });
                bump_aggregate(&mut output.by_day, &day_key(timestamp_ms), |item| {
                    item.crashes += 1
                });
            }
            if let Some(start) = session_start.take() {
                let seconds = ((timestamp_ms - start) / 1000).clamp(0, 18 * 3600);
                add_session(output, file, timestamp_ms, seconds, session_multiplayer);
            }
            session_multiplayer = false;
        }

        if !is_chat {
            continue;
        }
        seen_chat_in_file += 1;
        bump_aggregate(&mut output.by_source, &file.source, |item| {
            item.chat_lines += 1
        });
        bump_aggregate(&mut output.by_scope, &scope_key(file), |item| {
            item.chat_lines += 1
        });
        bump_aggregate(&mut output.by_day, &day_key(timestamp_ms), |item| {
            item.chat_lines += 1
        });
        let event = match_chat_rule(rule_sets, &message).unwrap_or_else(|| {
            *output
                .unmatched
                .entry(normalize_template(&message))
                .or_default() += 1;
            LogEvent {
                timestamp_ms,
                source: file.source.clone(),
                scope: file.scope.clone(),
                file_path: path_string(&file.path),
                line_no,
                message: message.clone(),
                event_type: "chat_message".to_string(),
                payload: Map::new(),
            }
        });
        if event.event_type != "chat_message" {
            output.chat_matched += 1;
            *output
                .rule_counts
                .entry(event.event_type.clone())
                .or_default() += 1;
        }
        let event = LogEvent {
            timestamp_ms,
            source: file.source.clone(),
            scope: file.scope.clone(),
            file_path: path_string(&file.path),
            line_no,
            message: event.message,
            event_type: event.event_type,
            payload: event.payload,
        };
        apply_chat_event(output, active_rounds, file, event);
    }
    if let Some(start) = session_start.take() {
        let end = file.modified_ms.max(start);
        let seconds = ((end - start) / 1000).clamp(0, 18 * 3600);
        add_session(
            output,
            file,
            end,
            seconds,
            session_multiplayer || seen_chat_in_file > 0,
        );
    }
}

fn apply_chat_event(
    output: &mut ScanOutput,
    active_rounds: &mut HashMap<String, ActiveRound>,
    file: &LogFileInfo,
    event: LogEvent,
) {
    let scope_key = scope_key(file);
    match event.event_type.as_str() {
        "round_start" | "round_countdown" => {
            active_rounds.insert(
                scope_key,
                ActiveRound {
                    source: event.source,
                    scope: event.scope,
                    file_path: event.file_path,
                    start_ms: event.timestamp_ms,
                    start_line: event.line_no,
                    mode: payload_string(&event.payload, "gameMode")
                        .unwrap_or_else(|| infer_game_mode(&event.message, &file.scope)),
                    kills: 0,
                    deaths: 0,
                    self_deaths: 0,
                    bed_destroys: 0,
                },
            );
        }
        "game_mode" => {
            let mode = payload_string(&event.payload, "gameMode")
                .unwrap_or_else(|| infer_game_mode(&event.message, &file.scope));
            if let Some(round) = active_rounds.get_mut(&scope_key) {
                round.mode = mode;
            }
        }
        "kill" => {
            if let Some(round) = active_rounds.get_mut(&scope_key) {
                round.kills += 1;
            }
        }
        "death" | "self_death" => {
            if let Some(round) = active_rounds.get_mut(&scope_key) {
                round.deaths += 1;
                if event.event_type == "self_death" {
                    round.self_deaths += 1;
                }
            }
        }
        "bed_destroy" => {
            if let Some(round) = active_rounds.get_mut(&scope_key) {
                round.bed_destroys += 1;
            }
        }
        "win" | "loss" | "round_end" => {
            let result = if event.event_type == "win" {
                "win"
            } else if event.event_type == "loss" {
                "loss"
            } else {
                "unknown"
            };
            let active = active_rounds.remove(&scope_key);
            let start_ms = active
                .as_ref()
                .map(|round| round.start_ms)
                .unwrap_or(event.timestamp_ms);
            let duration_seconds = ((event.timestamp_ms - start_ms) / 1000).max(0);
            let mode = payload_string(&event.payload, "gameMode")
                .or_else(|| active.as_ref().map(|round| round.mode.clone()))
                .unwrap_or_else(|| infer_game_mode(&event.message, &file.scope));
            let kills = active.as_ref().map(|round| round.kills).unwrap_or(0);
            let deaths = active.as_ref().map(|round| round.deaths).unwrap_or(0);
            let self_deaths = active.as_ref().map(|round| round.self_deaths).unwrap_or(0);
            let bed_destroys = active.as_ref().map(|round| round.bed_destroys).unwrap_or(0);
            let start_line = active
                .as_ref()
                .map(|round| round.start_line)
                .unwrap_or(event.line_no);
            let reliable = result == "win" || result == "loss";
            let round = json!({
              "key": format!("{}\0{}\0{}\0{}", file.source, file.scope, event.file_path, event.line_no),
              "source": active.as_ref().map(|round| round.source.as_str()).unwrap_or(&file.source),
              "scope": active.as_ref().map(|round| round.scope.as_str()).unwrap_or(&file.scope),
              "filePath": active.as_ref().map(|round| round.file_path.as_str()).unwrap_or(&event.file_path),
              "startAt": iso_from_ms(start_ms),
              "endAt": iso_from_ms(event.timestamp_ms),
              "startMs": start_ms,
              "endMs": event.timestamp_ms,
              "durationSeconds": duration_seconds,
              "duration": format_duration(duration_seconds),
              "gameMode": mode,
              "mode": mode,
              "result": result,
              "resultEligible": reliable,
              "resultHint": { "value": result, "reason": event.event_type },
              "endReason": event.event_type,
              "startLineNo": start_line,
              "endLineNo": event.line_no,
              "message": event.message,
              "kills": kills,
              "deaths": deaths,
              "selfKills": kills,
              "selfDeaths": self_deaths,
              "bedDestroys": bed_destroys,
              "selfBedDestroys": bed_destroys,
              "playerBedDestroys": bed_destroys,
              "unknownAudit": {
                "category": if reliable { "known_result" } else { "unknown" },
                "reviewPriority": if reliable { "low" } else { "medium" },
                "nextAction": if reliable { "none" } else { "review_result_rule" }
              },
              "events": [],
              "resultEvidence": [{
                "type": event.event_type,
                "message": event.message,
                "lineNo": event.line_no,
                "result": result
              }]
            });
            add_round_aggregates(output, file, &round, reliable);
            if reliable {
                output.rounds.push(round);
            } else {
                output.ignored_rounds.push(round);
            }
        }
        _ => {}
    }
}

fn add_file_aggregates(output: &mut ScanOutput, file: &LogFileInfo) {
    bump_aggregate(&mut output.by_source, &file.source, |item| {
        item.files += 1;
        item.bytes += file.size;
        touch_aggregate(item, file.modified_ms);
    });
    bump_aggregate(&mut output.by_scope, &scope_key(file), |item| {
        item.files += 1;
        item.bytes += file.size;
        touch_aggregate(item, file.modified_ms);
    });
    bump_aggregate(&mut output.by_day, &file_day_key(file), |item| {
        item.files += 1;
        item.bytes += file.size;
        touch_aggregate(item, file.modified_ms);
    });
}

fn add_session(
    output: &mut ScanOutput,
    file: &LogFileInfo,
    end_ms: i64,
    seconds: i64,
    multiplayer: bool,
) {
    let day = day_key(end_ms);
    for (map, key) in [
        (&mut output.by_source, file.source.clone()),
        (&mut output.by_scope, scope_key(file)),
        (&mut output.by_day, day),
    ] {
        bump_aggregate(map, &key, |item| {
            item.sessions += 1;
            item.runtime_seconds += seconds;
            item.playtime_seconds += seconds;
            if multiplayer {
                item.multiplayer_seconds += seconds;
            } else {
                item.singleplayer_seconds += seconds;
            }
            touch_aggregate(item, end_ms);
        });
    }
    let account_key = "local".to_string();
    let account = output
        .accounts
        .entry(account_key.clone())
        .or_insert_with(|| AccountAggregate {
            user: account_key,
            ..AccountAggregate::default()
        });
    account.sessions += 1;
    account.runtime_seconds += seconds;
    account.playtime_seconds += seconds;
    account.files.insert(path_string(&file.path));
    account.scopes.insert(file.scope.clone());
    touch_account(account, end_ms);
}

fn add_round_aggregates(
    output: &mut ScanOutput,
    file: &LogFileInfo,
    round: &Value,
    reliable: bool,
) {
    let end_ms = round
        .get("endMs")
        .and_then(Value::as_i64)
        .unwrap_or(file.modified_ms);
    let result = value_at(round, "result").unwrap_or("unknown");
    let duration = round
        .get("durationSeconds")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let kills = round.get("kills").and_then(Value::as_u64).unwrap_or(0);
    let deaths = round.get("deaths").and_then(Value::as_u64).unwrap_or(0);
    for (map, key) in [
        (&mut output.by_source, file.source.clone()),
        (&mut output.by_scope, scope_key(file)),
        (&mut output.by_day, day_key(end_ms)),
    ] {
        bump_aggregate(map, &key, |item| {
            if reliable {
                item.reliable_rounds += 1;
            } else {
                item.ignored_rounds += 1;
            }
            match result {
                "win" => item.wins += 1,
                "loss" => item.losses += 1,
                _ => item.unknown_results += 1,
            }
            item.kills += kills;
            item.deaths += deaths;
            item.playtime_seconds += duration;
            touch_aggregate(item, end_ms);
        });
    }
    let mode_id = value_at(round, "gameMode").unwrap_or("unknown").to_string();
    let mode = output
        .modes
        .entry(mode_id.clone())
        .or_insert_with(|| ModeAggregate {
            id: mode_id.clone(),
            label: label_game_mode(&mode_id),
            ..ModeAggregate::default()
        });
    mode.rounds += 1;
    match result {
        "win" => mode.wins += 1,
        "loss" => mode.losses += 1,
        _ => mode.unknown_results += 1,
    }
    mode.duration_seconds += duration;
    mode.kills += kills;
    mode.deaths += deaths;
    mode.self_kills += round
        .get("selfKills")
        .and_then(Value::as_u64)
        .unwrap_or(kills);
    mode.self_deaths += round.get("selfDeaths").and_then(Value::as_u64).unwrap_or(0);
    mode.bed_destroys += round
        .get("bedDestroys")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    mode.self_bed_destroys += round
        .get("selfBedDestroys")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let account = output
        .accounts
        .entry("local".to_string())
        .or_insert_with(|| AccountAggregate {
            user: "local".to_string(),
            ..AccountAggregate::default()
        });
    account.events += 1;
    account.files.insert(path_string(&file.path));
    account.scopes.insert(file.scope.clone());
    if result == "win" {
        account.wins += 1;
    } else if result == "loss" {
        account.losses += 1;
    }
    touch_account(account, end_ms);
}

fn write_scan_outputs(context: &AppContext, output: &ScanOutput) -> Result<(), String> {
    let report = build_report_json(context, output);
    let summary = build_summary_json(&report);
    if let Some(parent) = context.report_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    write_json_file(&context.report_path, &report)?;
    write_json_file(&context.summary_path, &summary)?;
    write_json_file(
        &context.unmatched_path,
        &build_unmatched_json(context, output),
    )?;
    write_store_outputs(context, output, &report)?;
    Ok(())
}

fn build_report_json(context: &AppContext, output: &ScanOutput) -> Value {
    let overview = overview_json(output);
    let by_source = aggregate_rows(&output.by_source, "source");
    let by_scope = aggregate_rows(&output.by_scope, "scope");
    let by_day = day_rows(&output.by_day);
    let by_week = period_rows(&by_day, 7);
    let by_month = month_rows(&by_day);
    let reliable = output.rounds.clone();
    let ignored = output.ignored_rounds.clone();
    let accounts = accounts_json(context, output);
    let profile = profile_json(&overview, &accounts, &by_day, &by_scope);
    json!({
      "schema": { "name": "minecraft-log-observatory-report", "version": 1 },
      "version": 1,
      "generatedAt": output.generated_at,
      "roots": output.roots,
      "encoding": get_path_string(&context.config, &["encoding"]).unwrap_or("gb18030"),
      "selectedRuleSets": "all",
      "inputs": {
        "roots": output.roots,
        "encoding": get_path_string(&context.config, &["encoding"]).unwrap_or("gb18030"),
        "selectedRuleSets": [],
        "bundledRuleFiles": output.rule_sets,
        "customRulePaths": get_path_value(&context.config, &["customRules"]).cloned().unwrap_or_else(|| json!([])),
        "ownerAliases": get_path_value(&context.config, &["owner", "aliases"]).cloned().unwrap_or_else(|| json!([])),
        "ownerMode": get_path_string(&context.config, &["owner", "mode"]).unwrap_or("all_local_users")
      },
      "overview": overview,
      "metricDefinitions": metric_definitions_json(),
      "bySource": by_source,
      "byScope": by_scope,
      "byDay": by_day,
      "byWeek": by_week,
      "byMonth": by_month,
      "confidence": confidence_json(&reliable, &ignored),
      "results": results_json(&reliable, &ignored),
      "activity": activity_json(output),
      "profile": profile,
      "rounds": {
        "summary": rounds_summary_json(output),
        "reliable": reliable,
        "ignored": ignored,
        "allRef": "rounds.reliable + rounds.ignored"
      },
      "accounts": accounts,
      "rules": {
        "available": output.rule_sets,
        "selected": output.rule_sets.iter().filter_map(|item| value_at(item, "id").map(str::to_string)).collect::<Vec<_>>(),
        "eventCounts": output.rule_counts,
        "byRuleSet": {},
        "byRuleId": {},
        "byRulePack": {},
        "byRulePackId": {},
        "quality": { "totalRules": 0, "hitRules": 0, "zeroHitRules": 0, "byRiskGroup": {}, "byType": {}, "topHitRules": [] },
        "chatLines": total_aggregate(&output.by_source).chat_lines,
        "matched": output.chat_matched,
        "unmatched": total_aggregate(&output.by_source).chat_lines.saturating_sub(output.chat_matched),
        "matchRate": ratio(output.chat_matched, total_aggregate(&output.by_source).chat_lines),
        "cache": { "files": output.files.len(), "hits": 0, "misses": output.files.len() },
        "topUnmatchedByCategory": {},
        "unmatchedByCategory": {}
      },
      "anomalies": anomalies_json(output),
      "raw": {
        "analysisSummaries": [],
        "roundsRef": "rounds.reliable"
      }
    })
}

fn build_summary_json(report: &Value) -> Value {
    let by_scope = report
        .get("byScope")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let by_day = report
        .get("byDay")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    json!({
      "schema": {
        "name": "minecraft-log-observatory-summary",
        "version": 1,
        "reportSchema": report.get("schema").cloned().unwrap_or_else(|| json!({ "name": "minecraft-log-observatory-report", "version": 1 }))
      },
      "generatedAt": report.get("generatedAt").cloned().unwrap_or(Value::Null),
      "overview": report.get("overview").cloned().unwrap_or_else(|| json!({})),
      "confidence": report.get("confidence").cloned().unwrap_or_else(|| json!({})),
      "rounds": report.get("rounds").and_then(|rounds| rounds.get("summary")).cloned().unwrap_or_else(|| json!({})),
      "activity": report.get("activity").and_then(|activity| activity.get("summary")).cloned().unwrap_or_else(|| json!({})),
      "accounts": {
        "owner": report.get("accounts").and_then(|accounts| accounts.get("owner")).cloned().unwrap_or_else(|| json!({})),
        "localUsers": report.get("accounts").and_then(|accounts| accounts.get("localUsers")).and_then(Value::as_array).map(Vec::len).unwrap_or(0),
        "topPlaytimeUsers": report.get("accounts").and_then(|accounts| accounts.get("playtimeByUser")).cloned().unwrap_or_else(|| json!([])),
        "aliases": report.get("accounts").and_then(|accounts| accounts.get("owner")).and_then(|owner| owner.get("aliases")).and_then(Value::as_array).map(Vec::len).unwrap_or(0)
      },
      "profile": report.get("profile").cloned().unwrap_or_else(|| json!({})),
      "topScopes": by_scope.into_iter().take(10).collect::<Vec<_>>(),
      "topDays": by_day.into_iter().take(10).collect::<Vec<_>>(),
      "anomalies": report.get("anomalies").cloned().unwrap_or_else(|| json!({})),
      "rules": report.get("rules").cloned().unwrap_or_else(|| json!({}))
    })
}

fn write_store_outputs(
    context: &AppContext,
    output: &ScanOutput,
    report: &Value,
) -> Result<(), String> {
    if context.store_dir.exists() {
        fs::remove_dir_all(&context.store_dir).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&context.store_dir).map_err(|error| error.to_string())?;
    let files = store_files_map();
    let reliable = output.rounds.clone();
    let ignored = output.ignored_rounds.clone();
    let by_day = report
        .get("byDay")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let by_week = report
        .get("byWeek")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let by_month = report
        .get("byMonth")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let by_source = report
        .get("bySource")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let by_scope = report
        .get("byScope")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let activity_segments: Vec<Value> = Vec::new();
    let account_playtime = report
        .get("accounts")
        .and_then(|accounts| accounts.get("playtimeByUser"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    write_json_file(
        &context.store_dir.join("overview.json"),
        &report["overview"],
    )?;
    write_json_file(
        &context.store_dir.join("summary.json"),
        &report["rounds"]["summary"],
    )?;
    write_json_file(&context.store_dir.join("profile.json"), &report["profile"])?;
    write_json_file(
        &context.store_dir.join("metric-definitions.json"),
        &report["metricDefinitions"],
    )?;
    write_json_file(&context.store_dir.join("modes.json"), &modes_object(output))?;
    write_json_file(
        &context.store_dir.join("accounts.json"),
        &report["accounts"],
    )?;
    write_jsonl_file(
        &context.store_dir.join("account-playtime.jsonl"),
        &account_playtime,
    )?;
    write_json_file(
        &context.store_dir.join("activity.json"),
        &report["activity"],
    )?;
    write_jsonl_file(
        &context.store_dir.join("activity-segments.jsonl"),
        &activity_segments,
    )?;
    write_json_file(&context.store_dir.join("results.json"), &report["results"])?;
    write_json_file(&context.store_dir.join("rules.json"), &report["rules"])?;
    write_json_file(
        &context.store_dir.join("confidence.json"),
        &report["confidence"],
    )?;
    write_json_file(
        &context.store_dir.join("sources-index.json"),
        &json!(by_source),
    )?;
    write_json_file(
        &context.store_dir.join("scopes-index.json"),
        &json!(by_scope),
    )?;
    write_json_file(
        &context.store_dir.join("accounts-index.json"),
        &accounts_index_json(report),
    )?;
    write_json_file(
        &context.store_dir.join("modes-index.json"),
        &modes_index_json(output),
    )?;
    write_jsonl_file(&context.store_dir.join("by-day.jsonl"), &by_day)?;
    write_jsonl_file(&context.store_dir.join("by-week.jsonl"), &by_week)?;
    write_jsonl_file(&context.store_dir.join("by-month.jsonl"), &by_month)?;
    write_jsonl_file(&context.store_dir.join("by-source.jsonl"), &by_source)?;
    write_jsonl_file(&context.store_dir.join("by-scope.jsonl"), &by_scope)?;
    write_jsonl_file(&context.store_dir.join("rounds-reliable.jsonl"), &reliable)?;
    write_jsonl_file(&context.store_dir.join("rounds-ignored.jsonl"), &ignored)?;
    write_json_file(
        &context.store_dir.join("manifest.json"),
        &json!({
          "schema": { "name": "minecraft-log-observatory-store", "version": 1 },
          "generatedAt": now_iso(),
          "reportGeneratedAt": report.get("generatedAt").cloned().unwrap_or(Value::Null),
          "reportSchema": report.get("schema").cloned().unwrap_or(Value::Null),
          "sourceReport": path_string(&context.report_path),
          "files": files,
          "counts": {
            "reliableRounds": reliable.len(),
            "ignoredRounds": ignored.len(),
            "byDay": by_day.len(),
            "byWeek": by_week.len(),
            "byMonth": by_month.len(),
            "bySource": by_source.len(),
            "byScope": by_scope.len(),
            "modes": output.modes.len(),
            "roundModes": output.modes.len(),
            "activitySegments": activity_segments.len(),
            "activityModes": 0,
            "accounts": account_playtime.len(),
            "accountPlaytime": account_playtime.len()
          }
        }),
    )?;
    Ok(())
}

fn store_files_map() -> Value {
    json!({
      "overview": "overview.json",
      "summary": "summary.json",
      "profile": "profile.json",
      "metricDefinitions": "metric-definitions.json",
      "modes": "modes.json",
      "accounts": "accounts.json",
      "accountPlaytime": "account-playtime.jsonl",
      "activity": "activity.json",
      "activitySegments": "activity-segments.jsonl",
      "results": "results.json",
      "rules": "rules.json",
      "confidence": "confidence.json",
      "byDay": "by-day.jsonl",
      "byWeek": "by-week.jsonl",
      "byMonth": "by-month.jsonl",
      "bySource": "by-source.jsonl",
      "byScope": "by-scope.jsonl",
      "sourcesIndex": "sources-index.json",
      "scopesIndex": "scopes-index.json",
      "accountsIndex": "accounts-index.json",
      "modesIndex": "modes-index.json",
      "reliableRounds": "rounds-reliable.jsonl",
      "ignoredRounds": "rounds-ignored.jsonl"
    })
}

fn overview_json(output: &ScanOutput) -> Value {
    let total = total_aggregate(&output.by_source);
    let wins = total.wins;
    let losses = total.losses;
    let reliable = total.reliable_rounds;
    let known = wins + losses;
    json!({
      "schemaVersion": 1,
      "scopes": output.by_scope.len(),
      "files": total.files,
      "sizeMb": ((total.bytes as f64) / 1_000_000.0).round() as u64,
      "sessions": total.sessions,
      "runtime": format_duration(total.runtime_seconds),
      "playtime": format_duration(total.playtime_seconds),
      "multiplayer": format_duration(total.multiplayer_seconds),
      "singleplayer": format_duration(total.singleplayer_seconds),
      "chatLines": total.chat_lines,
      "chatMatched": output.chat_matched,
      "chatMatchRate": ratio(output.chat_matched, total.chat_lines),
      "crashes": total.crashes,
      "reliableRounds": reliable,
      "resultEligibleRounds": known + total.unknown_results,
      "roundDuration": format_duration(output.modes.values().map(|mode| mode.duration_seconds).sum::<i64>()),
      "wins": wins,
      "losses": losses,
      "unknownResults": total.unknown_results,
      "knownResultRate": ratio(known, known + total.unknown_results),
      "winRate": ratio(wins, known),
      "kills": total.kills,
      "deaths": total.deaths,
      "selfKills": total.kills,
      "selfDeaths": total.deaths,
      "playerMaxKillStreak": 0,
      "bestWinStreak": 0,
      "currentWinStreak": 0,
      "winStreaks": {
        "breakUnknown": { "policy": "break_unknown", "best": { "count": 0 }, "current": { "count": 0 } },
        "skipUnknown": { "policy": "skip_unknown", "best": { "count": 0 }, "current": { "count": 0 } }
      },
      "activityGoldEarned": 0,
      "activityXpEarned": 0,
      "activityBountyClaims": 0,
      "activityBountyGoldEarned": 0
    })
}

fn rounds_summary_json(output: &ScanOutput) -> Value {
    let total = total_aggregate(&output.by_source);
    let modes = modes_object(output);
    json!({
      "total": output.rounds.len() + output.ignored_rounds.len(),
      "reliableRounds": output.rounds.len(),
      "ignoredRounds": output.ignored_rounds.len(),
      "wins": total.wins,
      "losses": total.losses,
      "unknownResults": total.unknown_results,
      "knownResultRate": ratio(total.wins + total.losses, total.wins + total.losses + total.unknown_results),
      "winRate": ratio(total.wins, total.wins + total.losses),
      "gameModes": modes,
      "resultEligibleRounds": total.wins + total.losses + total.unknown_results,
      "notApplicableResults": 0
    })
}

fn modes_object(output: &ScanOutput) -> Value {
    let mut map = Map::new();
    for (id, mode) in &output.modes {
        map.insert(
            id.clone(),
            json!({
              "id": mode.id,
              "label": mode.label,
              "rounds": mode.rounds,
              "resultEligible": true,
              "nonResult": 0,
              "durationSeconds": mode.duration_seconds,
              "duration": format_duration(mode.duration_seconds),
              "wins": mode.wins,
              "losses": mode.losses,
              "unknownResults": mode.unknown_results,
              "notApplicableResults": 0,
              "kills": mode.kills,
              "deaths": mode.deaths,
              "selfKills": mode.self_kills,
              "selfDeaths": mode.self_deaths,
              "bedDestroys": mode.bed_destroys,
              "selfBedDestroys": mode.self_bed_destroys,
              "playerBedDestroys": mode.self_bed_destroys,
              "playerMaxKillStreak": 0,
              "winRate": ratio(mode.wins, mode.wins + mode.losses)
            }),
        );
    }
    Value::Object(map)
}

fn aggregate_rows(map: &BTreeMap<String, Aggregate>, key_name: &str) -> Vec<Value> {
    map.iter()
        .map(|(key, item)| {
            let (source, scope) = if key_name == "scope" {
                split_scope_key(key)
            } else {
                (key.as_str(), key.as_str())
            };
            json!({
              key_name: key,
              "source": source,
              "scope": scope,
              "files": item.files,
              "bytes": item.bytes,
              "sizeMb": ((item.bytes as f64) / 1_000_000.0).round() as u64,
              "sessions": item.sessions,
              "runtimeSeconds": item.runtime_seconds,
              "runtime": format_duration(item.runtime_seconds),
              "playtimeSeconds": item.playtime_seconds,
              "playtime": format_duration(item.playtime_seconds),
              "multiplayerSeconds": item.multiplayer_seconds,
              "singleplayerSeconds": item.singleplayer_seconds,
              "chatLines": item.chat_lines,
              "crashes": item.crashes,
              "firstSeenAt": item.first_ms.map(iso_from_ms),
              "lastSeenAt": item.last_ms.map(iso_from_ms),
              "rounds": {
                "reliable": item.reliable_rounds,
                "ignored": item.ignored_rounds,
                "total": item.reliable_rounds + item.ignored_rounds,
                "wins": item.wins,
                "losses": item.losses,
                "unknownResults": item.unknown_results,
                "winRate": ratio(item.wins, item.wins + item.losses),
                "gameModes": {}
              },
              "activity": { "segments": 0, "gameModes": {} },
              "kills": item.kills,
              "deaths": item.deaths,
              "selfKills": item.kills,
              "selfDeaths": item.deaths
            })
        })
        .collect()
}

fn day_rows(map: &BTreeMap<String, Aggregate>) -> Vec<Value> {
    map.iter()
        .map(|(date, item)| {
            json!({
              "date": date,
              "files": item.files,
              "sessions": item.sessions,
              "runtimeSeconds": item.runtime_seconds,
              "runtime": format_duration(item.runtime_seconds),
              "playtimeSeconds": item.playtime_seconds,
              "playtime": format_duration(item.playtime_seconds),
              "multiplayerSeconds": item.multiplayer_seconds,
              "singleplayerSeconds": item.singleplayer_seconds,
              "chatLines": item.chat_lines,
              "crashes": item.crashes,
              "reliableRounds": item.reliable_rounds,
              "ignoredRounds": item.ignored_rounds,
              "totalRounds": item.reliable_rounds + item.ignored_rounds,
              "wins": item.wins,
              "losses": item.losses,
              "unknownResults": item.unknown_results,
              "kills": item.kills,
              "deaths": item.deaths,
              "rounds": {
                "reliable": item.reliable_rounds,
                "ignored": item.ignored_rounds,
                "total": item.reliable_rounds + item.ignored_rounds,
                "wins": item.wins,
                "losses": item.losses,
                "unknownResults": item.unknown_results
              }
            })
        })
        .collect()
}

fn period_rows(days: &[Value], period_days: i64) -> Vec<Value> {
    let mut grouped = BTreeMap::<String, Aggregate>::new();
    for day in days {
        let Some(date) = value_at(day, "date") else {
            continue;
        };
        let key = NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .ok()
            .map(|date| {
                let days_from_ce = date.num_days_from_ce();
                let start = days_from_ce - days_from_ce.rem_euclid(period_days as i32);
                NaiveDate::from_num_days_from_ce_opt(start)
                    .unwrap_or(date)
                    .format("%Y-%m-%d")
                    .to_string()
            })
            .unwrap_or_else(|| date.to_string());
        let item = grouped.entry(key).or_default();
        item.files += day.get("files").and_then(Value::as_u64).unwrap_or(0);
        item.sessions += day.get("sessions").and_then(Value::as_u64).unwrap_or(0);
        item.playtime_seconds += day
            .get("playtimeSeconds")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        item.runtime_seconds += day
            .get("runtimeSeconds")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        item.reliable_rounds += day
            .get("reliableRounds")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        item.ignored_rounds += day
            .get("ignoredRounds")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        item.wins += day.get("wins").and_then(Value::as_u64).unwrap_or(0);
        item.losses += day.get("losses").and_then(Value::as_u64).unwrap_or(0);
        item.unknown_results += day
            .get("unknownResults")
            .and_then(Value::as_u64)
            .unwrap_or(0);
    }
    day_rows(&grouped)
}

fn month_rows(days: &[Value]) -> Vec<Value> {
    let mut grouped = BTreeMap::<String, Aggregate>::new();
    for day in days {
        let Some(date) = value_at(day, "date") else {
            continue;
        };
        let key = date.get(0..7).unwrap_or(date).to_string();
        let item = grouped.entry(key).or_default();
        item.files += day.get("files").and_then(Value::as_u64).unwrap_or(0);
        item.sessions += day.get("sessions").and_then(Value::as_u64).unwrap_or(0);
        item.playtime_seconds += day
            .get("playtimeSeconds")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        item.runtime_seconds += day
            .get("runtimeSeconds")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        item.reliable_rounds += day
            .get("reliableRounds")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        item.ignored_rounds += day
            .get("ignoredRounds")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        item.wins += day.get("wins").and_then(Value::as_u64).unwrap_or(0);
        item.losses += day.get("losses").and_then(Value::as_u64).unwrap_or(0);
        item.unknown_results += day
            .get("unknownResults")
            .and_then(Value::as_u64)
            .unwrap_or(0);
    }
    grouped
        .iter()
        .map(|(month, item)| {
            json!({
              "date": month,
              "month": month,
              "files": item.files,
              "sessions": item.sessions,
              "runtimeSeconds": item.runtime_seconds,
              "runtime": format_duration(item.runtime_seconds),
              "playtimeSeconds": item.playtime_seconds,
              "playtime": format_duration(item.playtime_seconds),
              "reliableRounds": item.reliable_rounds,
              "ignoredRounds": item.ignored_rounds,
              "totalRounds": item.reliable_rounds + item.ignored_rounds,
              "wins": item.wins,
              "losses": item.losses,
              "unknownResults": item.unknown_results,
              "rounds": { "reliable": item.reliable_rounds, "total": item.reliable_rounds + item.ignored_rounds, "wins": item.wins, "losses": item.losses }
            })
        })
        .collect()
}

fn confidence_json(reliable: &[Value], ignored: &[Value]) -> Value {
    let total = reliable.len() + ignored.len();
    json!({
      "total": total,
      "reliable": reliable.len(),
      "ignored": ignored.len(),
      "reliableRate": ratio(reliable.len() as u64, total as u64),
      "byReason": {}
    })
}

fn results_json(reliable: &[Value], ignored: &[Value]) -> Value {
    let wins = reliable
        .iter()
        .filter(|round| value_at(round, "result") == Some("win"))
        .count() as u64;
    let losses = reliable
        .iter()
        .filter(|round| value_at(round, "result") == Some("loss"))
        .count() as u64;
    let unknown = ignored.len() as u64
        + reliable
            .iter()
            .filter(|round| value_at(round, "result") == Some("unknown"))
            .count() as u64;
    json!({
      "summary": {
        "wins": wins,
        "losses": losses,
        "unknownResults": unknown,
        "knownResultRate": ratio(wins + losses, wins + losses + unknown),
        "winRate": ratio(wins, wins + losses)
      },
      "signals": [],
      "policy": {
        "known": "Rust Tauri backend matched win/loss rule events.",
        "unknown": "Rounds without win/loss evidence stay in ignored/unknown review data."
      }
    })
}

fn activity_json(_output: &ScanOutput) -> Value {
    json!({
      "summary": {
        "segments": 0,
        "gameModes": {},
        "durationSeconds": 0,
        "duration": "0s",
        "kills": 0,
        "deaths": 0,
        "selfKills": 0,
        "selfDeaths": 0
      },
      "policy": {},
      "segments": []
    })
}

fn accounts_json(context: &AppContext, output: &ScanOutput) -> Value {
    let aliases = get_path_value(&context.config, &["owner", "aliases"])
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let display_name =
        get_path_string(&context.config, &["owner", "displayName"]).unwrap_or("Owner");
    let mut local_users: Vec<Value> = output
        .accounts
        .values()
        .map(|account| account_json(account))
        .collect();
    local_users.sort_by(|a, b| {
        b.get("playtimeSeconds")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .cmp(
                &a.get("playtimeSeconds")
                    .and_then(Value::as_i64)
                    .unwrap_or(0),
            )
    });
    let playtime = local_users.clone();
    let wins = output
        .accounts
        .values()
        .map(|account| account.wins)
        .sum::<u64>();
    let losses = output
        .accounts
        .values()
        .map(|account| account.losses)
        .sum::<u64>();
    json!({
      "owner": {
        "displayName": display_name,
        "aliases": aliases,
        "localUserCount": local_users.len(),
        "observedEvents": output.accounts.values().map(|account| account.events).sum::<u64>(),
        "rounds": {
          "reliable": wins + losses,
          "wins": wins,
          "losses": losses,
          "winRate": ratio(wins, wins + losses)
        }
      },
      "localUsers": local_users,
      "playtimeByUser": playtime
    })
}

fn account_json(account: &AccountAggregate) -> Value {
    json!({
      "user": account.user,
      "events": account.events,
      "files": account.files.len(),
      "scopes": account.scopes.len(),
      "sessions": account.sessions,
      "runtimeSeconds": account.runtime_seconds,
      "runtime": format_duration(account.runtime_seconds),
      "playtimeSeconds": account.playtime_seconds,
      "playtime": format_duration(account.playtime_seconds),
      "firstSeenAt": account.first_ms.map(iso_from_ms),
      "lastSeenAt": account.last_ms.map(iso_from_ms),
      "sources": account.scopes.iter().cloned().collect::<Vec<_>>(),
      "rounds": {
        "reliable": account.wins + account.losses,
        "wins": account.wins,
        "losses": account.losses,
        "winRate": ratio(account.wins, account.wins + account.losses)
      }
    })
}

fn profile_json(overview: &Value, accounts: &Value, days: &[Value], scopes: &[Value]) -> Value {
    json!({
      "generatedAt": now_iso(),
      "totals": {
        "files": overview.get("files").cloned().unwrap_or(Value::Null),
        "playtimeSeconds": duration_value_seconds(overview, "playtime"),
        "playtime": overview.get("playtime").cloned().unwrap_or_else(|| json!("0s")),
        "reliableRounds": overview.get("reliableRounds").cloned().unwrap_or(Value::Null),
        "wins": overview.get("wins").cloned().unwrap_or(Value::Null),
        "losses": overview.get("losses").cloned().unwrap_or(Value::Null),
        "localUserCount": accounts.get("localUsers").and_then(Value::as_array).map(Vec::len).unwrap_or(0),
        "firstPlayedDay": days.first().and_then(|day| value_at(day, "date")),
        "lastPlayedDay": days.last().and_then(|day| value_at(day, "date")),
        "playerMaxKillStreak": overview.get("playerMaxKillStreak").cloned().unwrap_or_else(|| json!(0))
      },
      "days": {
        "active": days.iter().filter(|day| day.get("playtimeSeconds").and_then(Value::as_i64).unwrap_or(0) > 0).count(),
        "first": days.first().and_then(|day| value_at(day, "date")),
        "last": days.last().and_then(|day| value_at(day, "date"))
      },
      "preferences": {
        "clientVersionByPlaytime": scopes.first().cloned().unwrap_or_else(|| json!({}))
      },
      "streaks": {
        "win": overview.get("winStreaks").cloned().unwrap_or_else(|| json!({})),
        "playerMaxKillStreak": { "count": overview.get("playerMaxKillStreak").and_then(Value::as_u64).unwrap_or(0) }
      },
      "metricDefinitions": metric_definitions_json()
    })
}

fn duration_value_seconds(_value: &Value, _key: &str) -> Value {
    Value::Null
}

fn anomalies_json(output: &ScanOutput) -> Value {
    let mut templates: Vec<Value> = output
        .unmatched
        .iter()
        .map(|(template, count)| {
            json!({
              "template": template,
              "count": count,
              "category": "unknown",
              "priority": (*count).min(100)
            })
        })
        .collect();
    templates.sort_by(|a, b| {
        b.get("count")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .cmp(&a.get("count").and_then(Value::as_u64).unwrap_or(0))
    });
    json!({
      "longSessions": [],
      "crashyScopes": [],
      "unmatchedTemplates": templates.into_iter().take(50).collect::<Vec<_>>()
    })
}

fn build_unmatched_json(context: &AppContext, output: &ScanOutput) -> Value {
    json!({
      "generatedAt": output.generated_at,
      "roots": config_roots(&context.config),
      "encoding": get_path_string(&context.config, &["encoding"]).unwrap_or("gb18030"),
      "categories": { "unknown": output.unmatched.values().sum::<u64>() },
      "templates": anomalies_json(output).get("unmatchedTemplates").cloned().unwrap_or_else(|| json!([]))
    })
}

fn accounts_index_json(report: &Value) -> Value {
    let mut rows = Vec::new();
    if let Some(owner) = report
        .get("accounts")
        .and_then(|accounts| accounts.get("owner"))
    {
        rows.push(json!({
          "id": "owner",
          "user": "owner",
          "displayName": owner.get("displayName").cloned().unwrap_or_else(|| json!("Owner")),
          "localUserCount": owner.get("localUserCount").cloned().unwrap_or_else(|| json!(0)),
          "events": owner.get("observedEvents").cloned().unwrap_or_else(|| json!(0)),
          "reliableRounds": owner.get("rounds").and_then(|rounds| rounds.get("reliable")).cloned().unwrap_or_else(|| json!(0)),
          "wins": owner.get("rounds").and_then(|rounds| rounds.get("wins")).cloned().unwrap_or_else(|| json!(0)),
          "losses": owner.get("rounds").and_then(|rounds| rounds.get("losses")).cloned().unwrap_or_else(|| json!(0))
        }));
    }
    if let Some(users) = report
        .get("accounts")
        .and_then(|accounts| accounts.get("localUsers"))
        .and_then(Value::as_array)
    {
        rows.extend(users.iter().cloned());
    }
    json!(rows)
}

fn modes_index_json(output: &ScanOutput) -> Value {
    let mut rows: Vec<Value> = output
        .modes
        .values()
        .map(|mode| {
            json!({
              "id": format!("round:{}", mode.id),
              "modeId": mode.id,
              "label": mode.label,
              "kind": "round",
              "rounds": mode.rounds,
              "durationSeconds": mode.duration_seconds,
              "duration": format_duration(mode.duration_seconds),
              "wins": mode.wins,
              "losses": mode.losses,
              "unknownResults": mode.unknown_results,
              "kills": mode.kills,
              "deaths": mode.deaths,
              "selfKills": mode.self_kills,
              "selfDeaths": mode.self_deaths,
              "winRate": ratio(mode.wins, mode.wins + mode.losses)
            })
        })
        .collect();
    rows.sort_by(|a, b| {
        b.get("durationSeconds")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .cmp(
                &a.get("durationSeconds")
                    .and_then(Value::as_i64)
                    .unwrap_or(0),
            )
    });
    json!(rows)
}

fn metric_definitions_json() -> Value {
    json!({
      "rounds": { "label": "Rounds", "format": "number" },
      "wins": { "label": "Wins", "format": "number" },
      "losses": { "label": "Losses", "format": "number" },
      "winRate": { "label": "Win rate", "format": "percent" },
      "playtimeSeconds": { "label": "Playtime", "format": "duration" },
      "kills": { "label": "Kills", "format": "number" },
      "deaths": { "label": "Deaths", "format": "number" }
    })
}

fn load_rule_sets(context: &AppContext) -> Vec<CompiledRuleSet> {
    let mut sets = Vec::new();
    for (file_name, text) in BUNDLED_RULES {
        if let Some(set) = compile_rule_set_text(text, file_name) {
            sets.push(set);
        }
    }
    for path in custom_rule_paths(context) {
        if path.is_dir() {
            if let Ok(entries) = fs::read_dir(path) {
                let mut entries = entries.flatten().collect::<Vec<_>>();
                entries.sort_by_key(|entry| entry.path());
                for entry in entries {
                    let path = entry.path();
                    if path.extension().and_then(|ext| ext.to_str()) == Some("json") {
                        if let Ok(text) = fs::read_to_string(&path) {
                            if let Some(set) = compile_rule_set_text(&text, &path_string(&path)) {
                                sets.push(set);
                            }
                        }
                    }
                }
            }
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("json") {
            if let Ok(text) = fs::read_to_string(&path) {
                if let Some(set) = compile_rule_set_text(&text, &path_string(&path)) {
                    sets.push(set);
                }
            }
        }
    }
    sets
}

fn compile_rule_set_text(text: &str, file_name: &str) -> Option<CompiledRuleSet> {
    let raw: RawRuleSet = serde_json::from_str(text).ok()?;
    let cleaners = raw
        .cleaners
        .iter()
        .filter_map(compile_cleaner)
        .collect::<Vec<_>>();
    let rules = raw
        .rules
        .iter()
        .filter_map(|rule| compile_rule(rule))
        .collect::<Vec<_>>();
    Some(CompiledRuleSet {
        id: raw.id,
        name: raw.name,
        description: raw.description,
        file_name: file_name.to_string(),
        cleaners,
        rules,
    })
}

fn compile_cleaner(raw: &RawCleaner) -> Option<CompiledCleaner> {
    Some(CompiledCleaner {
        regex: compile_regex(&raw.pattern, &raw.flags)?,
        replacement: raw.replacement.clone(),
    })
}

fn compile_rule(raw: &RawRule) -> Option<CompiledRule> {
    Some(CompiledRule {
        id: raw.id.clone(),
        event_type: raw.event_type.clone(),
        regex: compile_regex(&raw.pattern, &raw.flags)?,
        payload: raw.payload.clone(),
        cleaners: raw.cleaners.iter().filter_map(compile_cleaner).collect(),
        legacy_rule_set: raw.legacy_rule_set.clone(),
    })
}

fn compile_regex(pattern: &str, flags: &str) -> Option<Regex> {
    let mut wrapped = String::new();
    if flags.contains('i') {
        wrapped.push_str("(?i)");
    }
    if flags.contains('m') {
        wrapped.push_str("(?m)");
    }
    wrapped.push_str(pattern);
    Regex::new(&wrapped).ok()
}

fn match_chat_rule(rule_sets: &[CompiledRuleSet], message: &str) -> Option<LogEvent> {
    for set in rule_sets {
        for rule in &set.rules {
            let cleaned = clean_chat_message(message, &set.cleaners, &rule.cleaners);
            let Some(captures) = rule.regex.captures(&cleaned) else {
                continue;
            };
            let mut payload = rule.payload.clone();
            for name in rule.regex.capture_names().flatten() {
                if let Some(value) = captures.name(name) {
                    payload.insert(name.to_string(), json!(value.as_str()));
                }
            }
            payload.insert(
                "ruleSet".to_string(),
                json!(rule.legacy_rule_set.as_deref().unwrap_or(&set.id)),
            );
            payload.insert("rulePack".to_string(), json!(set.id));
            payload.insert("ruleId".to_string(), json!(rule.id));
            return Some(LogEvent {
                timestamp_ms: 0,
                source: String::new(),
                scope: String::new(),
                file_path: String::new(),
                line_no: 0,
                message: cleaned,
                event_type: rule.event_type.clone(),
                payload,
            });
        }
    }
    None
}

fn clean_chat_message(
    message: &str,
    set_cleaners: &[CompiledCleaner],
    rule_cleaners: &[CompiledCleaner],
) -> String {
    let mut cleaned = strip_color_codes(message);
    cleaned = normalize_space(&cleaned);
    for cleaner in set_cleaners.iter().chain(rule_cleaners.iter()) {
        cleaned = cleaner
            .regex
            .replace_all(&cleaned, cleaner.replacement.as_str())
            .to_string();
        cleaned = normalize_space(&cleaned);
    }
    cleaned
}

fn strip_color_codes(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut skip = false;
    for ch in value.chars() {
        if skip {
            skip = false;
            continue;
        }
        if ch == '§' || ch == '&' {
            skip = true;
            continue;
        }
        out.push(ch);
    }
    out
}

fn normalize_space(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn read_log_text(path: &Path, encoding: &str) -> Result<String, String> {
    let mut bytes = Vec::new();
    if path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_ascii_lowercase().ends_with(".gz"))
        .unwrap_or(false)
    {
        let file = File::open(path).map_err(|error| error.to_string())?;
        let mut decoder = GzDecoder::new(file);
        decoder
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
    } else {
        let mut file = File::open(path).map_err(|error| error.to_string())?;
        file.read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
    }
    let decoder = Encoding::for_label(encoding.as_bytes()).unwrap_or(UTF_8);
    let (text, _, _) = decoder.decode(&bytes);
    Ok(text.into_owned())
}

fn parse_log_line(raw: &str) -> (Option<&str>, String, bool) {
    let mut time_text = None;
    let mut message = raw;
    if raw.starts_with('[') && raw.len() >= 10 {
        let maybe_time = &raw[1..9];
        if maybe_time.as_bytes().get(2) == Some(&b':')
            && maybe_time.as_bytes().get(5) == Some(&b':')
        {
            time_text = Some(maybe_time);
            if let Some(index) = raw.find("]:") {
                message = raw[index + 2..].trim();
            } else if let Some(index) = raw.find("] ") {
                message = raw[index + 1..].trim();
            }
        }
    }
    if let Some(index) = message.find("[CHAT]") {
        return (
            time_text,
            message[index + "[CHAT]".len()..].trim().to_string(),
            true,
        );
    }
    (time_text, message.trim().to_string(), false)
}

fn custom_rule_paths(context: &AppContext) -> Vec<PathBuf> {
    get_path_value(&context.config, &["customRules"])
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(|value| resolve_app_path(&context.root, value))
                .collect()
        })
        .unwrap_or_default()
}

fn write_json_file(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    fs::write(path, format!("{text}\n")).map_err(|error| error.to_string())
}

fn write_jsonl_file(path: &Path, rows: &[Value]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut file = File::create(path).map_err(|error| error.to_string())?;
    for row in rows {
        let text = serde_json::to_string(row).map_err(|error| error.to_string())?;
        file.write_all(text.as_bytes())
            .and_then(|_| file.write_all(b"\n"))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn bump_aggregate(
    map: &mut BTreeMap<String, Aggregate>,
    key: &str,
    mutate: impl FnOnce(&mut Aggregate),
) {
    let item = map.entry(key.to_string()).or_default();
    mutate(item);
}

fn touch_aggregate(item: &mut Aggregate, ms: i64) {
    item.first_ms = Some(item.first_ms.map(|value| value.min(ms)).unwrap_or(ms));
    item.last_ms = Some(item.last_ms.map(|value| value.max(ms)).unwrap_or(ms));
}

fn touch_account(item: &mut AccountAggregate, ms: i64) {
    item.first_ms = Some(item.first_ms.map(|value| value.min(ms)).unwrap_or(ms));
    item.last_ms = Some(item.last_ms.map(|value| value.max(ms)).unwrap_or(ms));
}

fn total_aggregate(map: &BTreeMap<String, Aggregate>) -> Aggregate {
    let mut total = Aggregate::default();
    for item in map.values() {
        total.files += item.files;
        total.bytes += item.bytes;
        total.chat_lines += item.chat_lines;
        total.crashes += item.crashes;
        total.sessions += item.sessions;
        total.runtime_seconds += item.runtime_seconds;
        total.playtime_seconds += item.playtime_seconds;
        total.multiplayer_seconds += item.multiplayer_seconds;
        total.singleplayer_seconds += item.singleplayer_seconds;
        total.reliable_rounds += item.reliable_rounds;
        total.ignored_rounds += item.ignored_rounds;
        total.wins += item.wins;
        total.losses += item.losses;
        total.unknown_results += item.unknown_results;
        total.kills += item.kills;
        total.deaths += item.deaths;
    }
    total
}

fn ratio(numerator: u64, denominator: u64) -> f64 {
    if denominator == 0 {
        0.0
    } else {
        (numerator as f64 / denominator as f64 * 10_000.0).round() / 10_000.0
    }
}

fn payload_string(payload: &Map<String, Value>, key: &str) -> Option<String> {
    payload.get(key).and_then(Value::as_str).map(str::to_string)
}

fn normalize_template(message: &str) -> String {
    let mut out = String::new();
    let mut in_number = false;
    for ch in message.chars() {
        if ch.is_ascii_digit() {
            if !in_number {
                out.push_str("{number}");
                in_number = true;
            }
        } else {
            in_number = false;
            out.push(ch);
        }
    }
    normalize_space(&out)
}

fn scope_label(root: &Path, scope_path: &Path) -> String {
    scope_path
        .strip_prefix(root)
        .ok()
        .and_then(|path| path.parent().or(Some(path)))
        .map(path_string)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "logs".to_string())
}

fn scope_key(file: &LogFileInfo) -> String {
    format!("{}\0{}", file.source, file.scope)
}

fn split_scope_key(key: &str) -> (&str, &str) {
    key.split_once('\0').unwrap_or((key, key))
}

fn log_file_date(name: &str) -> Option<NaiveDate> {
    let candidate = name.get(0..10)?;
    NaiveDate::parse_from_str(candidate, "%Y-%m-%d").ok()
}

fn file_date_start_ms(file: &LogFileInfo) -> Option<i64> {
    let date = file.date?;
    let time = NaiveTime::from_hms_opt(0, 0, 0)?;
    Some(
        Utc.from_utc_datetime(&NaiveDateTime::new(date, time))
            .timestamp_millis(),
    )
}

fn combine_date_time_ms(file: &LogFileInfo, time_text: &str) -> Option<i64> {
    let date = file.date?;
    let time = NaiveTime::parse_from_str(time_text, "%H:%M:%S").ok()?;
    Some(
        Utc.from_utc_datetime(&NaiveDateTime::new(date, time))
            .timestamp_millis(),
    )
}

fn day_key(ms: i64) -> String {
    Utc.timestamp_millis_opt(ms)
        .single()
        .map(|date| date.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

fn file_day_key(file: &LogFileInfo) -> String {
    file.date
        .map(|date| date.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| day_key(file.modified_ms))
}

fn iso_from_ms(ms: i64) -> String {
    Utc.timestamp_millis_opt(ms)
        .single()
        .map(|date| date.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
        .unwrap_or_else(now_iso)
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn now_millis() -> i64 {
    system_time_ms(SystemTime::now()).unwrap_or(0)
}

fn system_time_ms(value: SystemTime) -> Option<i64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

fn format_duration(seconds: i64) -> String {
    let seconds = seconds.max(0);
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    if hours > 0 {
        format!("{hours}h {minutes}m")
    } else if minutes > 0 {
        format!("{minutes}m")
    } else {
        format!("{seconds}s")
    }
}

fn infer_game_mode(message: &str, scope: &str) -> String {
    let text = format!("{message} {scope}").to_ascii_lowercase();
    for (id, needles) in [
        ("bedwars", &["bed wars", "bedwars", "起床", "床战"][..]),
        ("skywars", &["skywars", "sky wars", "空岛"][..]),
        ("duels", &["duels", "duel", "决斗"][..]),
        ("bridge", &["the bridge", "bridge", "战桥"][..]),
        ("the_pit", &["the pit", "pit", "天坑"][..]),
        ("mega_walls", &["mega walls", "超级战墙"][..]),
        ("mini_walls", &["mini walls", "迷你战墙"][..]),
        ("uhc", &["uhc"][..]),
    ] {
        if needles.iter().any(|needle| text.contains(needle)) {
            return id.to_string();
        }
    }
    "unknown".to_string()
}

fn label_game_mode(id: &str) -> String {
    match id {
        "bedwars" => "Bed Wars",
        "skywars" => "SkyWars",
        "duels" => "Duels",
        "bridge" => "The Bridge",
        "the_pit" => "The Pit",
        "mega_walls" => "Mega Walls",
        "mini_walls" => "Mini Walls",
        "uhc" => "UHC",
        "unknown" => "Unknown",
        other => other,
    }
    .to_string()
}

fn cleanup_response(context: &AppContext, body: &Value) -> ApiResponse {
    let dry_run = body
        .get("dryRun")
        .or_else(|| body.get("dry_run"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let targets = [
        ("report", context.report_path.clone()),
        ("summary", context.summary_path.clone()),
        ("unmatched", context.unmatched_path.clone()),
        ("store", context.store_dir.clone()),
    ];
    let mut planned = Vec::new();
    let mut removed = Vec::new();
    for (kind, path) in targets {
        let exists = path.exists();
        planned.push(json!({ "kind": kind, "path": path_string(&path), "exists": exists }));
        if exists && !dry_run {
            let result = if path.is_dir() {
                fs::remove_dir_all(&path)
            } else {
                fs::remove_file(&path)
            };
            if result.is_ok() {
                removed.push(json!({ "kind": kind, "path": path_string(&path) }));
            }
        }
    }
    json_response(
        200,
        json!({ "ok": true, "dryRun": dry_run, "planned": planned, "removed": removed }),
    )
}

fn diagnostics_response(context: &AppContext) -> ApiResponse {
    let app = app_status_response(context).body;
    json_response(
        200,
        json!({
          "ok": true,
          "ready": app.get("ready").cloned().unwrap_or_else(|| json!(false)),
          "setup": app.get("setup").cloned().unwrap_or_else(|| json!({})),
          "needsRefresh": app.get("needsRefresh").cloned().unwrap_or_else(|| json!(true)),
          "refreshReasons": app.get("refreshReasons").cloned().unwrap_or_else(|| json!([])),
          "outputs": {
            "report": { "path": path_string(&context.report_path), "exists": context.report_path.is_file() },
            "summary": { "path": path_string(&context.summary_path), "exists": context.summary_path.is_file() },
            "store": { "path": path_string(&context.store_dir), "exists": context.store_dir.is_dir() }
          },
          "refresh": refresh_body()
        }),
    )
}

fn diagnostics_package_response(context: &AppContext) -> ApiResponse {
    let app = app_status_response(context).body;
    json_response(
        200,
        json!({
          "schema": { "name": "minecraft-log-resolver-diagnostics", "version": 1 },
          "generatedAt": now_iso(),
          "appStatus": app,
          "diagnostics": diagnostics_response(context).body,
          "refreshHistory": refresh_history_response(context).body,
          "performance": performance_response(context).body
        }),
    )
}

fn performance_response(context: &AppContext) -> ApiResponse {
    let manifest = read_store_manifest(context).ok();
    json_response(
        200,
        json!({
          "generatedAt": now_iso(),
          "refreshHistory": refresh_history_response(context).body,
          "store": {
            "ready": manifest.is_some(),
            "manifestPath": path_string(&context.store_dir.join("manifest.json")),
            "counts": manifest.as_ref().and_then(|value| value.get("counts")).cloned().unwrap_or_else(|| json!({}))
          },
          "cache": {}
        }),
    )
}

fn skin_response() -> ApiResponse {
    error_response(
        404,
        "skin_unavailable",
        "Skin proxy is disabled in the pure Rust no-port runtime.",
        json!({ "skinProxyEnabled": false }),
    )
}

fn minecraft_profile_response(url: &Url) -> ApiResponse {
    let username = query_string(url, "username").or_else(|| query_string(url, "name"));
    match username {
        Some(name) if is_valid_minecraft_name(&name) => json_response(
            200,
            json!({
              "ok": true,
              "name": name,
              "id": null,
              "uuid": null,
              "skinUrl": null,
              "model": "classic",
              "source": "offline"
            }),
        ),
        _ => error_response(
            400,
            "invalid_minecraft_username",
            "Enter a 1-16 character Minecraft ID using letters, numbers, or underscores.",
            json!({}),
        ),
    }
}

fn is_valid_minecraft_name(value: &str) -> bool {
    (1..=16).contains(&value.len())
        && value
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == b'_')
}

fn rule_test_response(context: &AppContext, body: &Value) -> ApiResponse {
    let Some(message) = body.get("message").and_then(Value::as_str) else {
        return error_response(
            400,
            "message_required",
            "Provide one chat message to test.",
            json!({}),
        );
    };
    let event = match_chat_rule(&load_rule_sets(context), message);
    json_response(
        200,
        json!({
          "matched": event.is_some(),
          "event": event.map(|event| json!({
            "type": event.event_type,
            "message": event.message,
            "payload": event.payload,
            "ruleSet": event.payload.get("ruleSet").cloned().unwrap_or(Value::Null),
            "rulePack": event.payload.get("rulePack").cloned().unwrap_or(Value::Null),
            "ruleId": event.payload.get("ruleId").cloned().unwrap_or(Value::Null)
          })),
          "inferredGameMode": infer_game_mode(message, "")
        }),
    )
}

fn rule_draft_response(body: &Value) -> ApiResponse {
    let message = body.get("message").and_then(Value::as_str).unwrap_or("");
    if message.trim().is_empty() {
        return error_response(
            400,
            "message_required",
            "Provide one chat message to draft a rule.",
            json!({}),
        );
    }
    let event_type = body
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("round_end");
    let game_mode = body
        .get("gameMode")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| infer_game_mode(message, ""));
    json_response(
        200,
        json!({
          "rule": {
            "id": body.get("id").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| draft_rule_id(event_type, message)),
            "type": event_type,
            "pattern": format!("^{}$", regex::escape(message)),
            "payload": { "gameMode": game_mode }
          },
          "notes": [
            "Review the generated regex before adding it to a rule pack.",
            "Replace player names or map names with named groups only when useful."
          ]
        }),
    )
}

fn rule_validate_response(body: &Value) -> ApiResponse {
    let errors = validate_rule_pack(body);
    json_response(
        if errors.is_empty() { 200 } else { 400 },
        json!({
          "ok": errors.is_empty(),
          "errors": errors,
          "message": if errors.is_empty() { "Rule pack is valid." } else { "Rule pack validation failed." }
        }),
    )
}

fn rules_dry_run_response(context: &AppContext, body: &Value) -> ApiResponse {
    let validation = if let Some(rule_pack) = body.get("rulePack") {
        validate_rule_pack(rule_pack)
    } else {
        validate_rule_pack(body)
    };
    json_response(
        if validation.is_empty() { 200 } else { 400 },
        json!({
          "ok": validation.is_empty(),
          "promotionGate": {
            "ready": validation.is_empty(),
            "blocking": validation,
            "warnings": []
          },
          "summary": {
            "checkedRules": body.get("rulePack").or(Some(body)).and_then(|value| value.get("rules")).and_then(Value::as_array).map(Vec::len).unwrap_or(0),
            "sampledRounds": read_round_rows(context, "all").map(|rows| rows.len()).unwrap_or(0)
          },
          "matches": []
        }),
    )
}

fn rules_audit_workflow_response(context: &AppContext, body: &Value) -> ApiResponse {
    let target_mode = body
        .get("targetMode")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let rows = body
        .get("rows")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let sample = rows
        .iter()
        .find_map(|row| row.get("message").and_then(Value::as_str))
        .unwrap_or("UNKNOWN RESULT");
    json_response(
        200,
        json!({
          "ok": true,
          "targetMode": target_mode,
          "draft": rule_draft_response(&json!({ "message": sample, "type": "round_end", "gameMode": target_mode })).body.get("rule").cloned().unwrap_or_else(|| json!({})),
          "workflow": {
            "status": "draft",
            "nextActions": ["Validate the draft with POST /api/rules/validate.", "Preview impact with POST /api/rules/dry-run."]
          },
          "audit": rules_audit_response(context).body
        }),
    )
}

fn rule_draft_from_labels_response(_context: &AppContext, body: &Value) -> ApiResponse {
    let rows = body
        .get("rows")
        .or_else(|| body.get("labels"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let target_mode = body
        .get("targetMode")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    json_response(
        200,
        json!({
          "ok": true,
          "targetMode": target_mode,
          "rows": rows.len(),
          "rulePack": {
            "id": format!("draft-{}", target_mode),
            "name": format!("Draft {}", label_game_mode(target_mode)),
            "rules": []
          },
          "workflow": { "nextActions": ["Validate the draft with POST /api/rules/validate."] }
        }),
    )
}

fn unknown_audit_labels_response(body: &Value) -> ApiResponse {
    let rows = body
        .get("rows")
        .or_else(|| body.get("labels"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    json_response(
        200,
        json!({
          "ok": true,
          "status": "ready",
          "readyForWorkflow": true,
          "workflowRecommended": !rows.is_empty(),
          "checkedRoundRefs": rows.len(),
          "errors": [],
          "summary": { "rows": rows.len() }
        }),
    )
}

fn unknown_audit_status_response(body: &Value) -> ApiResponse {
    unknown_audit_labels_response(body)
}

fn unknown_audit_label_sets_response(context: &AppContext, body: &Value) -> ApiResponse {
    let dir = context.root.join("labeling");
    let _ = fs::create_dir_all(&dir);
    let id = body
        .get("id")
        .and_then(Value::as_str)
        .map(safe_id)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("labels-{}", now_millis()));
    let path = dir.join(format!("{id}.json"));
    let value = json!({ "id": id, "savedAt": now_iso(), "body": body });
    match write_json_file(&path, &value) {
        Ok(()) => json_response(
            200,
            json!({ "ok": true, "item": value, "path": path_string(&path) }),
        ),
        Err(error) => error_response(
            500,
            "label_set_write_failed",
            "Could not save label set.",
            json!({ "details": error }),
        ),
    }
}

fn rules_doctor_response(context: &AppContext) -> ApiResponse {
    let sets = load_rule_sets(context);
    json_response(
        200,
        json!({
          "ok": true,
          "status": "ready",
          "findings": [],
          "checks": [{
            "code": "rules_loaded",
            "severity": "info",
            "message": "Rule packs loaded by Rust backend.",
            "rulePacks": sets.len(),
            "rules": sets.iter().map(|set| set.rules.len()).sum::<usize>()
          }]
        }),
    )
}

fn rules_audit_response(context: &AppContext) -> ApiResponse {
    let sets = load_rule_sets(context);
    json_response(
        200,
        json!({
          "ok": true,
          "total": sets.len(),
          "items": sets.iter().map(|set| json!({
            "id": set.id,
            "name": set.name,
            "source": "rust",
            "rules": set.rules.len(),
            "enabled": true
          })).collect::<Vec<_>>()
        }),
    )
}

fn user_rule_packs_response(context: &AppContext) -> ApiResponse {
    let dir = context.root.join("custom-rules").join("user");
    let mut items = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            if let Ok(value) = read_json_file(&path) {
                items.push(json!({
                  "id": value.get("id").and_then(Value::as_str).unwrap_or_else(|| path.file_stem().and_then(|name| name.to_str()).unwrap_or("rule-pack")),
                  "name": value.get("name").and_then(Value::as_str).unwrap_or("User rule pack"),
                  "filePath": path_string(&path),
                  "enabled": custom_rule_enabled(context, &path),
                  "rules": value.get("rules").and_then(Value::as_array).map(Vec::len).unwrap_or(0)
                }));
            }
        }
    }
    json_response(
        200,
        json!({ "ok": true, "total": items.len(), "items": items, "enabled": get_path_value(&context.config, &["customRules"]).cloned().unwrap_or_else(|| json!([])) }),
    )
}

fn user_rule_pack_detail_response(context: &AppContext, path: &str) -> ApiResponse {
    let id = safe_id(percent_decode(path.trim_start_matches("/api/rule-packs/user/")).as_str());
    let file = context
        .root
        .join("custom-rules")
        .join("user")
        .join(format!("{id}.json"));
    match read_json_file(&file) {
        Ok(rule_pack) => json_response(
            200,
            json!({ "ok": true, "id": id, "rulePack": rule_pack, "filePath": path_string(&file), "enabled": custom_rule_enabled(context, &file) }),
        ),
        Err(_) => error_response(
            404,
            "rule_pack_not_found",
            "User rule pack was not found.",
            json!({ "id": id }),
        ),
    }
}

fn user_rule_pack_save_response(context: &AppContext, body: &Value) -> ApiResponse {
    let errors = validate_rule_pack(body);
    if !errors.is_empty() {
        return json_response(
            400,
            json!({ "ok": false, "error": "invalid_rule_pack", "message": "Rule pack validation failed.", "errors": errors }),
        );
    }
    let id = body
        .get("id")
        .and_then(Value::as_str)
        .map(safe_id)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("user-rule-pack-{}", now_millis()));
    let dir = context.root.join("custom-rules").join("user");
    let _ = fs::create_dir_all(&dir);
    let file = dir.join(format!("{id}.json"));
    match write_json_file(&file, body) {
        Ok(()) => json_response(
            200,
            json!({ "ok": true, "id": id, "rulePack": body, "filePath": path_string(&file) }),
        ),
        Err(error) => error_response(
            500,
            "rule_pack_write_failed",
            "Could not save user rule pack.",
            json!({ "details": error }),
        ),
    }
}

fn user_rule_pack_delete_response(context: &AppContext, path: &str) -> ApiResponse {
    let id = safe_id(percent_decode(path.trim_start_matches("/api/rule-packs/user/")).as_str());
    let file = context
        .root
        .join("custom-rules")
        .join("user")
        .join(format!("{id}.json"));
    let _ = fs::remove_file(&file);
    json_response(200, json!({ "ok": true, "id": id, "deleted": true }))
}

fn user_rule_pack_enable_response(context: &AppContext, body: &Value) -> ApiResponse {
    let id = body
        .get("id")
        .and_then(Value::as_str)
        .map(safe_id)
        .unwrap_or_default();
    let enabled = body.get("enabled").and_then(Value::as_bool).unwrap_or(true);
    let entry = format!("custom-rules/user/{id}.json");
    let mut local_config = read_json_file(&context.local_config_path).unwrap_or_else(|_| json!({}));
    let mut custom_rules = local_config
        .get("customRules")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_else(|| {
            get_path_value(&context.config, &["customRules"])
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        });
    custom_rules.retain(|item| item.as_str() != Some(entry.as_str()));
    if enabled {
        custom_rules.push(json!(entry));
    }
    local_config["customRules"] = json!(custom_rules);
    match write_json_file(&context.local_config_path, &local_config) {
        Ok(()) => json_response(
            200,
            json!({ "ok": true, "id": id, "enabled": enabled, "customRules": local_config["customRules"] }),
        ),
        Err(error) => error_response(
            500,
            "config_write_failed",
            "Could not update enabled rule packs.",
            json!({ "details": error }),
        ),
    }
}

fn user_rule_pack_backups_response(_context: &AppContext, body: &Value) -> ApiResponse {
    json_response(
        200,
        json!({ "ok": true, "id": body.get("id").cloned().unwrap_or(Value::Null), "total": 0, "items": [] }),
    )
}

fn user_rule_pack_restore_response(_context: &AppContext, body: &Value) -> ApiResponse {
    error_response(
        404,
        "rule_pack_backup_not_found",
        "No user rule pack backup was found.",
        json!({ "id": body.get("id").cloned().unwrap_or(Value::Null), "backupId": body.get("backupId").cloned().unwrap_or(Value::Null) }),
    )
}

fn read_only_rule_packs_response(context: &AppContext) -> ApiResponse {
    let items = load_rule_sets(context)
        .into_iter()
        .map(|set| {
            json!({
              "id": set.id,
              "name": set.name,
              "description": set.description,
              "rules": set.rules.len(),
              "source": "bundled",
              "filePath": set.file_name
            })
        })
        .collect::<Vec<_>>();
    json_response(
        200,
        json!({
          "ok": true,
          "readOnly": false,
          "customRulePaths": get_path_value(&context.config, &["customRules"]).cloned().unwrap_or_else(|| json!([])),
          "total": items.len(),
          "items": items
        }),
    )
}

fn read_only_rule_packs_validate_response(context: &AppContext) -> ApiResponse {
    let items = load_rule_sets(context)
        .into_iter()
        .map(|set| json!({ "id": set.id, "ok": true, "rules": set.rules.len() }))
        .collect::<Vec<_>>();
    json_response(
        200,
        json!({ "ok": true, "customRulePaths": get_path_value(&context.config, &["customRules"]).cloned().unwrap_or_else(|| json!([])), "total": items.len(), "items": items }),
    )
}

fn validate_rule_pack(value: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    if !value.is_object() {
        errors.push("rule set must be an object".to_string());
        return errors;
    }
    if value
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .is_empty()
    {
        errors.push("id is required".to_string());
    }
    let Some(rules) = value.get("rules").and_then(Value::as_array) else {
        errors.push("rules must be an array".to_string());
        return errors;
    };
    for (index, rule) in rules.iter().enumerate() {
        if rule
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .is_empty()
        {
            errors.push(format!("rules[{index}].id is required"));
        }
        if rule
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("")
            .is_empty()
        {
            errors.push(format!("rules[{index}].type is required"));
        }
        let pattern = rule.get("pattern").and_then(Value::as_str).unwrap_or("");
        if pattern.is_empty() {
            errors.push(format!("rules[{index}].pattern is required"));
        } else if compile_regex(
            pattern,
            rule.get("flags").and_then(Value::as_str).unwrap_or(""),
        )
        .is_none()
        {
            errors.push(format!("rules[{index}] invalid regex"));
        }
    }
    errors
}

fn custom_rule_enabled(context: &AppContext, path: &Path) -> bool {
    let normalized = path_string(path).replace('\\', "/");
    get_path_value(&context.config, &["customRules"])
        .and_then(Value::as_array)
        .map(|items| {
            items.iter().filter_map(Value::as_str).any(|item| {
                normalized.ends_with(&item.replace('\\', "/")) || item == "custom-rules/user"
            })
        })
        .unwrap_or(false)
}

fn draft_rule_id(event_type: &str, message: &str) -> String {
    let stem = safe_id(message)
        .split('-')
        .take(6)
        .collect::<Vec<_>>()
        .join("-");
    format!("{}_{}", event_type.replace('-', "_"), stem)
        .trim_end_matches('_')
        .to_string()
}

fn safe_id(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if ch == '_' || ch == '-' || ch.is_whitespace() {
            if !out.ends_with('-') {
                out.push('-');
            }
        }
    }
    out.trim_matches('-').to_string()
}

fn modes_response(context: &AppContext) -> ApiResponse {
    let modes = match read_store_json(context, "modes") {
        Ok(value) => value,
        Err(response) => return response,
    };
    let metric_definitions =
        read_store_json(context, "metricDefinitions").unwrap_or_else(|_| json!({}));
    let total = modes.as_object().map(Map::len).unwrap_or(0);
    json_response(
        200,
        json!({ "total": total, "metricDefinitions": metric_definitions, "items": modes }),
    )
}

fn activity_response(context: &AppContext, url: &Url) -> ApiResponse {
    let activity = match read_store_json(context, "activity") {
        Ok(value) => value,
        Err(response) => return response,
    };
    let mode = query_string(url, "mode");
    let (offset, limit) = match read_pagination(url, 100, 1000) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let all_segments = activity
        .get("segments")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let rows: Vec<Value> = all_segments
        .into_iter()
        .filter(|row| {
            mode.as_deref()
                .map(|value| value_at(row, "mode") == Some(value))
                .unwrap_or(true)
        })
        .collect();
    json_response(
        200,
        json!({
          "summary": activity.get("summary").cloned().unwrap_or_else(|| json!({ "segments": rows.len(), "gameModes": {} })),
          "policy": activity.get("policy").cloned().unwrap_or_else(|| json!({})),
          "metricDefinitions": read_store_json(context, "metricDefinitions").unwrap_or_else(|_| json!({})),
          "filters": { "mode": mode },
          "total": rows.len(),
          "offset": offset,
          "limit": limit,
          "items": page_items(&rows, offset, limit),
        }),
    )
}

fn rounds_response(context: &AppContext, url: &Url) -> ApiResponse {
    let set = query_string(url, "set").unwrap_or_else(|| "reliable".to_string());
    if !matches!(set.as_str(), "reliable" | "ignored" | "all") {
        return error_response(
            400,
            "invalid_round_set",
            "Round set must be reliable, ignored, or all.",
            json!({ "allowed": ["reliable", "ignored", "all"] }),
        );
    }
    let (offset, limit) = match read_pagination(url, 100, 1000) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let filters = rounds_filters(url);
    let mut rows = match read_round_rows(context, &set) {
        Ok(rows) => rows,
        Err(response) => return response,
    };
    rows.retain(|row| round_matches(row, &filters));
    sort_rows(&mut rows, url);
    let summary = read_json_file(&context.summary_path)
        .ok()
        .and_then(|summary| summary.get("rounds").cloned())
        .unwrap_or_else(|| json!({}));
    json_response(
        200,
        json!({
          "set": set,
          "filters": filters,
          "total": rows.len(),
          "offset": offset,
          "limit": limit,
          "items": page_items(&rows, offset, limit),
          "summary": summary,
        }),
    )
}

fn result_candidates_response(context: &AppContext, url: &Url) -> ApiResponse {
    let candidates_path = context.root.join("result-candidates.json");
    if !candidates_path.is_file() {
        return json_response(
            200,
            json!({
              "generatedAt": null,
              "totals": {},
              "categories": {},
              "modes": {},
              "filters": {
                "category": query_string(url, "category"),
                "mode": query_string(url, "mode")
              },
              "total": 0,
              "offset": 0,
              "limit": query_usize(url, "limit").unwrap_or(50),
              "items": []
            }),
        );
    }
    let candidates = match read_json_file(&candidates_path) {
        Ok(value) => value,
        Err(error) => {
            return error_response(
                503,
                "result_candidates_invalid",
                "Result candidates could not be read.",
                json!({ "details": error }),
            );
        }
    };
    let (offset, limit) = match read_pagination(url, 50, 500) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let category = query_string(url, "category");
    let mode = query_string(url, "mode");
    let rows: Vec<Value> = candidates
        .get("candidates")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|row| {
            category
                .as_deref()
                .map(|value| value_at(row, "category") == Some(value))
                .unwrap_or(true)
        })
        .filter(|row| {
            mode.as_deref()
                .map(|value| value_at(row, "gameMode") == Some(value))
                .unwrap_or(true)
        })
        .collect();
    json_response(
        200,
        json!({
          "generatedAt": candidates.get("generatedAt").cloned().unwrap_or(Value::Null),
          "totals": candidates.get("totals").cloned().unwrap_or_else(|| json!({})),
          "categories": candidates.get("categories").cloned().unwrap_or_else(|| json!({})),
          "modes": candidates.get("modes").cloned().unwrap_or_else(|| json!({})),
          "filters": { "category": category, "mode": mode },
          "total": rows.len(),
          "offset": offset,
          "limit": limit,
          "items": page_items(&rows, offset, limit),
        }),
    )
}

fn account_detail_response(context: &AppContext, path: &str) -> ApiResponse {
    let accounts = match read_store_json(context, "accounts") {
        Ok(value) => value,
        Err(response) => return response,
    };
    let user = percent_decode(path.trim_start_matches("/api/accounts/"));
    if user == "owner" {
        return json_response(
            200,
            accounts.get("owner").cloned().unwrap_or_else(|| json!({})),
        );
    }
    let row = accounts
        .get("localUsers")
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .find(|item| value_at(item, "user") == Some(user.as_str()))
        })
        .cloned();
    match row {
        Some(row) => json_response(200, row),
        None => error_response(
            404,
            "account_not_found",
            "Account was not found.",
            json!({ "user": user }),
        ),
    }
}

fn store_response(context: &AppContext) -> ApiResponse {
    match read_store_manifest(context) {
        Ok(manifest) => json_response(200, manifest),
        Err(response) => response,
    }
}

fn store_table_response(context: &AppContext, url: &Url) -> ApiResponse {
    let name = query_string(url, "name").or_else(|| query_string(url, "table"));
    let Some(name) = name else {
        return error_response(
            400,
            "missing_store_table",
            "Provide a store table name.",
            json!({}),
        );
    };
    jsonl_table_response(context, &name, url, None)
}

fn timeseries_response(context: &AppContext, url: &Url) -> ApiResponse {
    let period = query_string(url, "period").unwrap_or_else(|| "day".to_string());
    let key = match period.as_str() {
        "day" => "byDay",
        "week" => "byWeek",
        "month" => "byMonth",
        _ => {
            return error_response(
                400,
                "invalid_period",
                "Period must be day, week, or month.",
                json!({ "allowed": ["day", "week", "month"] }),
            );
        }
    };
    let rows = match read_jsonl_table(context, key) {
        Ok(rows) => rows,
        Err(response) => return response,
    };
    json_response(
        200,
        json!({ "period": period, "total": rows.len(), "items": rows }),
    )
}

fn unmatched_response(context: &AppContext) -> ApiResponse {
    let unmatched_path = context.root.join("unmatched-debug.json");
    if unmatched_path.is_file() {
        return read_json_response(&unmatched_path, "unmatched_not_ready");
    }
    json_response(
        200,
        json!({
          "generatedAt": null,
          "roots": config_roots(&context.config),
          "encoding": get_path_string(&context.config, &["encoding"]).unwrap_or("gb18030"),
          "categories": {},
          "templates": []
        }),
    )
}

fn store_json_response(context: &AppContext, key: &str) -> ApiResponse {
    match read_store_json(context, key) {
        Ok(value) => json_response(200, value),
        Err(response) => response,
    }
}

fn read_json_response(path: &Path, missing_code: &str) -> ApiResponse {
    match read_json_file(path) {
    Ok(value) => json_response(200, value),
    Err(error) if error.contains("No such file") || error.contains("cannot find the file") || error.contains("os error 2") => error_response(
      503,
      missing_code,
      "Derived report data is not ready. Configure roots and refresh before loading this endpoint.",
      json!({ "path": path_string(path) }),
    ),
    Err(error) => error_response(
      503,
      "invalid_json",
      "Derived report data could not be parsed.",
      json!({ "path": path_string(path), "details": error }),
    ),
  }
}

fn jsonl_table_response(
    context: &AppContext,
    key: &str,
    url: &Url,
    filter: Option<fn(&Value, &Url) -> bool>,
) -> ApiResponse {
    let (offset, limit) = match read_pagination(url, 100, 1000) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let mut rows = match read_jsonl_table(context, key) {
        Ok(rows) => rows,
        Err(response) => return response,
    };
    if let Some(filter) = filter {
        rows.retain(|row| filter(row, url));
    }
    json_response(
        200,
        json!({
          "name": key,
          "total": rows.len(),
          "offset": offset,
          "limit": limit,
          "items": page_items(&rows, offset, limit),
          "truncated": offset + limit < rows.len()
        }),
    )
}

fn read_store_json(context: &AppContext, key: &str) -> Result<Value, ApiResponse> {
    let path = store_file_path(context, key)?;
    read_json_file(&path).map_err(|error| {
        error_response(
            503,
            "store_json_not_ready",
            "A report-store JSON file could not be read.",
            json!({ "key": key, "path": path_string(&path), "details": error }),
        )
    })
}

fn read_jsonl_table(context: &AppContext, key: &str) -> Result<Vec<Value>, ApiResponse> {
    let path = store_file_path(context, key)?;
    let file = File::open(&path).map_err(|error| {
        error_response(
            503,
            "store_table_not_ready",
            "A report-store JSONL table could not be opened.",
            json!({ "key": key, "path": path_string(&path), "details": error.to_string() }),
        )
    })?;
    let mut rows = Vec::new();
    for (index, line) in BufReader::new(file).lines().enumerate() {
        let line = line.map_err(|error| {
            error_response(
                503,
                "store_table_read_failed",
                "A report-store JSONL table could not be read.",
                json!({ "key": key, "path": path_string(&path), "details": error.to_string() }),
            )
        })?;
        if line.trim().is_empty() {
            continue;
        }
        let row: Value = serde_json::from_str(&line).map_err(|error| {
      error_response(
        503,
        "store_table_invalid_jsonl",
        "A report-store JSONL table contains invalid JSON.",
        json!({ "key": key, "path": path_string(&path), "line": index + 1, "details": error.to_string() }),
      )
    })?;
        rows.push(row);
    }
    Ok(rows)
}

fn read_round_rows(context: &AppContext, set: &str) -> Result<Vec<Value>, ApiResponse> {
    match set {
        "reliable" => read_jsonl_table(context, "reliableRounds"),
        "ignored" => read_jsonl_table(context, "ignoredRounds"),
        "all" => {
            let mut reliable = read_jsonl_table(context, "reliableRounds")?;
            reliable.extend(read_jsonl_table(context, "ignoredRounds")?);
            Ok(reliable)
        }
        _ => Ok(Vec::new()),
    }
}

fn store_file_path(context: &AppContext, key: &str) -> Result<PathBuf, ApiResponse> {
    let manifest = read_store_manifest(context)?;
    let file_name = manifest
        .get("files")
        .and_then(Value::as_object)
        .and_then(|files| files.get(key))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            error_response(
                400,
                "invalid_store_table",
                "Store file key is not declared by the manifest.",
                json!({ "key": key }),
            )
        })?;
    if !is_safe_relative_path(file_name) {
        return Err(error_response(
            400,
            "invalid_store_table_path",
            "Store manifest file path is not a safe relative path.",
            json!({ "key": key, "file": file_name }),
        ));
    }
    Ok(context.store_dir.join(file_name))
}

fn read_store_manifest(context: &AppContext) -> Result<Value, ApiResponse> {
    let manifest_path = context.store_dir.join("manifest.json");
    read_json_file(&manifest_path).map_err(|error| {
        error_response(
            503,
            "store_not_ready",
            "Run a refresh or store export before querying the report store.",
            json!({ "manifestPath": path_string(&manifest_path), "details": error }),
        )
    })
}

fn store_files_ready(context: &AppContext, manifest: &Value) -> bool {
    missing_store_files(context, manifest)
        .as_array()
        .map(|items| items.is_empty())
        .unwrap_or(false)
}

fn missing_store_files(context: &AppContext, manifest: &Value) -> Value {
    let mut missing = Vec::new();
    if let Some(files) = manifest.get("files").and_then(Value::as_object) {
        for (name, file_name) in files {
            let Some(file_name) = file_name.as_str() else {
                continue;
            };
            if !is_safe_relative_path(file_name) || !context.store_dir.join(file_name).is_file() {
                missing.push(json!({ "name": name, "file": file_name }));
            }
        }
    }
    json!(missing)
}

fn rounds_filters(url: &Url) -> Value {
    json!({
      "mode": query_string(url, "mode"),
      "result": query_string(url, "result"),
      "resultHint": query_string(url, "resultHint"),
      "resultHintReason": query_string(url, "resultHintReason"),
      "unknownAuditCategory": query_string(url, "unknownAuditCategory"),
      "unknownNextAction": query_string(url, "unknownNextAction"),
      "unknownReviewPriority": query_string(url, "unknownReviewPriority"),
      "source": query_string(url, "source"),
      "scope": query_string(url, "scope"),
      "dateFrom": query_string(url, "dateFrom"),
      "dateTo": query_string(url, "dateTo"),
      "minDuration": query_f64(url, "minDuration"),
      "maxDuration": query_f64(url, "maxDuration"),
      "hasKnownResult": query_bool(url, "hasKnownResult"),
    })
}

fn round_matches(row: &Value, filters: &Value) -> bool {
    for (filter_key, row_key) in [
        ("mode", "gameMode"),
        ("result", "result"),
        ("resultHintReason", "resultHint.reason"),
        ("unknownAuditCategory", "unknownAudit.category"),
        ("unknownNextAction", "unknownAudit.nextAction"),
        ("unknownReviewPriority", "unknownAudit.reviewPriority"),
        ("source", "source"),
        ("scope", "scope"),
    ] {
        if let Some(expected) = filters.get(filter_key).and_then(Value::as_str) {
            if dotted_value_at(row, row_key).and_then(Value::as_str) != Some(expected) {
                return false;
            }
        }
    }
    if let Some(expected) = filters.get("resultHint").and_then(Value::as_str) {
        let actual = dotted_value_at(row, "resultHint.value")
            .or_else(|| dotted_value_at(row, "resultHint"))
            .and_then(Value::as_str);
        if actual != Some(expected) {
            return false;
        }
    }
    if let Some(date_from) = filters.get("dateFrom").and_then(Value::as_str) {
        if value_at(row, "startAt")
            .map(|value| value.get(0..10).unwrap_or(value) < date_from)
            .unwrap_or(false)
        {
            return false;
        }
    }
    if let Some(date_to) = filters.get("dateTo").and_then(Value::as_str) {
        if value_at(row, "startAt")
            .map(|value| value.get(0..10).unwrap_or(value) > date_to)
            .unwrap_or(false)
        {
            return false;
        }
    }
    if let Some(min_duration) = filters.get("minDuration").and_then(Value::as_f64) {
        if number_at(row, "durationSeconds").unwrap_or(0.0) < min_duration {
            return false;
        }
    }
    if let Some(max_duration) = filters.get("maxDuration").and_then(Value::as_f64) {
        if number_at(row, "durationSeconds").unwrap_or(0.0) > max_duration {
            return false;
        }
    }
    if let Some(has_known) = filters.get("hasKnownResult").and_then(Value::as_bool) {
        let known = value_at(row, "resultEligible") != Some("false")
            && matches!(value_at(row, "result"), Some("win" | "loss" | "ambiguous"));
        if known != has_known {
            return false;
        }
    }
    true
}

fn sort_rows(rows: &mut [Value], url: &Url) {
    let sort = query_string(url, "sort");
    let order = query_string(url, "order").unwrap_or_else(|| "desc".to_string());
    if sort.as_deref() != Some("startAt") && sort.is_some() {
        return;
    }
    rows.sort_by(|a, b| {
        let left = value_at(a, "startAt").unwrap_or("");
        let right = value_at(b, "startAt").unwrap_or("");
        let cmp = left.cmp(right).then_with(|| {
            value_at(a, "key")
                .unwrap_or("")
                .cmp(value_at(b, "key").unwrap_or(""))
        });
        if order == "asc" {
            cmp
        } else {
            match cmp {
                Ordering::Less => Ordering::Greater,
                Ordering::Equal => Ordering::Equal,
                Ordering::Greater => Ordering::Less,
            }
        }
    });
}

fn filter_account_playtime(row: &Value, url: &Url) -> bool {
    if let Some(source) = query_string(url, "source") {
        let has_source = row
            .get("sources")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .any(|item| item.as_str() == Some(source.as_str()))
            })
            .unwrap_or(false);
        if !has_source {
            return false;
        }
    }
    query_string(url, "user")
        .map(|user| value_at(row, "user") == Some(user.as_str()))
        .unwrap_or(true)
}

fn filter_source_scope(row: &Value, url: &Url) -> bool {
    query_string(url, "source")
        .map(|source| value_at(row, "source") == Some(source.as_str()))
        .unwrap_or(true)
}

fn filter_day_range(row: &Value, url: &Url) -> bool {
    let date = value_at(row, "date").unwrap_or("");
    if let Some(date_from) = query_string(url, "dateFrom") {
        if date < date_from.as_str() {
            return false;
        }
    }
    if let Some(date_to) = query_string(url, "dateTo") {
        if date > date_to.as_str() {
            return false;
        }
    }
    true
}

fn setup_status(first_run: bool, data_ready: bool, refresh_reasons: &[String]) -> Value {
    let (state, recommended_action) = if first_run {
        ("first_run", "configure_roots")
    } else if !refresh_reasons.is_empty() {
        ("needs_refresh", "run_refresh")
    } else {
        ("ready", "none")
    };
    let mut reasons = Vec::new();
    if first_run {
        reasons.push("no_roots".to_string());
    }
    reasons.extend(refresh_reasons.iter().cloned());
    json!({
      "state": state,
      "reasons": reasons,
      "recommendedAction": recommended_action,
      "nextActions": setup_next_actions(first_run, refresh_reasons),
      "dataReady": data_ready,
      "canConfigure": true,
      "canRefresh": !first_run,
    })
}

fn setup_next_actions(first_run: bool, refresh_reasons: &[String]) -> Value {
    if first_run {
        json!([
          {
            "code": "configure_roots",
            "severity": "blocking",
            "message": "Choose at least one readable Minecraft log root.",
            "endpoint": "PUT /api/config"
          },
          {
            "code": "validate_roots",
            "severity": "recommended",
            "message": "Validate selected roots before saving them.",
            "endpoint": "POST /api/config/validate-roots"
          }
        ])
    } else if !refresh_reasons.is_empty() {
        json!([
          {
            "code": "run_refresh",
            "severity": "blocking",
            "message": "Regenerate derived report and split-store outputs.",
            "endpoint": "POST /api/refresh",
            "reasons": refresh_reasons
          }
        ])
    } else {
        json!([])
    }
}

fn recovery_actions(first_run: bool, data_ready: bool) -> Value {
    if first_run {
        json!([
          { "code": "configure_roots", "severity": "blocking", "message": "No log roots are configured.", "endpoint": "PUT /api/config", "blocks": ["refresh"] },
          { "code": "validate_roots", "severity": "recommended", "message": "Validate candidate log roots before saving.", "endpoint": "POST /api/config/validate-roots" }
        ])
    } else if !data_ready {
        json!([
          { "code": "run_refresh", "severity": "blocking", "message": "Regenerate report and split-store derived outputs.", "endpoint": "POST /api/refresh" }
        ])
    } else {
        json!([])
    }
}

fn refresh_needed_reasons(
    report_ready: bool,
    store_ready: bool,
    store_out_of_sync: bool,
) -> Vec<String> {
    let mut reasons = Vec::new();
    if !report_ready {
        reasons.push("report_not_ready".to_string());
    }
    if !store_ready {
        reasons.push("store_not_ready".to_string());
    }
    if store_out_of_sync {
        reasons.push("store_out_of_sync".to_string());
    }
    reasons
}

fn json_response(status: u16, body: Value) -> ApiResponse {
    ApiResponse {
        status,
        headers: json!({ "content-type": "application/json; charset=utf-8" }),
        body,
    }
}

fn error_response(status: u16, code: &str, message: &str, extra: Value) -> ApiResponse {
    let mut body = Map::new();
    body.insert("ok".to_string(), Value::Bool(false));
    body.insert("error".to_string(), Value::String(code.to_string()));
    body.insert("message".to_string(), Value::String(message.to_string()));
    if let Value::Object(extra) = extra {
        for (key, value) in extra {
            body.insert(key, value);
        }
    }
    json_response(status, Value::Object(body))
}

fn parse_api_url(value: &str) -> Result<Url, String> {
    if let Ok(url) = Url::parse(value) {
        return Ok(url);
    }
    Url::parse("http://tauri.local")
        .expect("valid base URL")
        .join(value)
        .map_err(|error| error.to_string())
}

fn read_pagination(
    url: &Url,
    default_limit: usize,
    max_limit: usize,
) -> Result<(usize, usize), ApiResponse> {
    let offset = query_usize(url, "offset").unwrap_or(0);
    let limit = query_usize(url, "limit").unwrap_or(default_limit);
    if limit > max_limit {
        return Err(error_response(
            400,
            "invalid_pagination",
            "Pagination limit is too large.",
            json!({ "limit": limit, "maxLimit": max_limit }),
        ));
    }
    Ok((offset, limit))
}

fn page_items(rows: &[Value], offset: usize, limit: usize) -> Vec<Value> {
    rows.iter().skip(offset).take(limit).cloned().collect()
}

fn query_string(url: &Url, key: &str) -> Option<String> {
    url.query_pairs()
        .find_map(|(name, value)| {
            if name == key {
                Some(value.into_owned())
            } else {
                None
            }
        })
        .filter(|value| !value.is_empty())
}

fn query_usize(url: &Url, key: &str) -> Option<usize> {
    query_string(url, key).and_then(|value| value.parse::<usize>().ok())
}

fn query_f64(url: &Url, key: &str) -> Option<f64> {
    query_string(url, key).and_then(|value| value.parse::<f64>().ok())
}

fn query_bool(url: &Url, key: &str) -> Option<bool> {
    query_string(url, key).and_then(|value| match value.as_str() {
        "true" | "1" => Some(true),
        "false" | "0" => Some(false),
        _ => None,
    })
}

fn value_at<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn number_at(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

fn dotted_value_at<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for key in path.split('.') {
        current = current.get(key)?;
    }
    Some(current)
}

fn get_path_value<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    Some(current)
}

fn get_path_string<'a>(value: &'a Value, path: &[&str]) -> Option<&'a str> {
    get_path_value(value, path).and_then(Value::as_str)
}

fn roots_from_body(body: &Value) -> Result<Vec<String>, ApiResponse> {
    let Some(roots_value) = body.get("roots") else {
        return Err(error_response(
            400,
            "invalid_validate_roots_request",
            "Root validation request is invalid.",
            json!({ "errors": [{ "field": "roots", "error": "required" }] }),
        ));
    };
    let Some(items) = roots_value.as_array() else {
        return Err(error_response(
            400,
            "invalid_validate_roots_request",
            "Root validation request is invalid.",
            json!({ "errors": [{ "field": "roots", "error": "expected_string_array" }] }),
        ));
    };
    let mut roots = Vec::new();
    for item in items {
        let Some(root) = item.as_str() else {
            return Err(error_response(
                400,
                "invalid_validate_roots_request",
                "Root validation request is invalid.",
                json!({ "errors": [{ "field": "roots", "error": "expected_string_array" }] }),
            ));
        };
        roots.push(root.trim().to_string());
    }
    Ok(roots)
}

fn validate_log_roots(context: &AppContext, roots: &[String]) -> Value {
    let mut seen = Vec::<String>::new();
    let mut items = Vec::new();
    for root in roots {
        let raw_path = root.trim();
        let resolved = resolve_app_path(&context.root, raw_path);
        let key = path_string(&resolved).to_ascii_lowercase();
        let duplicate = seen.iter().any(|item| item == &key);
        seen.push(key);

        let mut issues = Vec::new();
        if raw_path.is_empty() {
            issues.push(json!({ "code": "empty_root", "message": "Root path is empty." }));
        }
        if duplicate {
            issues.push(json!({ "code": "duplicate_root", "message": "Root path is duplicated." }));
        }

        let mut exists = false;
        let mut readable = false;
        let mut kind = Value::Null;
        let mut scopes = Vec::new();
        let mut log_files = 0usize;
        if !raw_path.is_empty() {
            match fs::metadata(&resolved) {
                Ok(metadata) => {
                    exists = true;
                    if metadata.is_dir() {
                        readable = true;
                        kind = json!("directory");
                        scopes = discover_log_scopes(&resolved);
                        if scopes.is_empty() {
                            issues.push(json!({ "code": "no_log_scopes", "message": "No logs directory found at root/logs or root/versions/*/logs." }));
                        }
                        log_files = scopes.iter().map(|scope| count_log_files(scope)).sum();
                        if log_files == 0 {
                            issues.push(json!({ "code": "no_logs_found", "message": "No .log, .log.gz, or !CHAT log files were found." }));
                        }
                    } else {
                        kind = json!("file");
                        issues.push(json!({ "code": "not_directory", "message": "Root path must be a directory." }));
                    }
                }
                Err(error) => {
                    if error.kind() == std::io::ErrorKind::NotFound {
                        issues.push(
                            json!({ "code": "not_found", "message": "Root path does not exist." }),
                        );
                    } else if matches!(error.kind(), std::io::ErrorKind::PermissionDenied) {
                        exists = true;
                        issues.push(json!({ "code": "permission_denied", "message": "Root path is not readable." }));
                    } else {
                        issues.push(json!({ "code": "read_error", "message": error.to_string() }));
                    }
                }
            }
        }

        let valid = exists
            && readable
            && kind.as_str() == Some("directory")
            && log_files > 0
            && !issues.iter().any(|issue| {
                matches!(
                    issue.get("code").and_then(Value::as_str),
                    Some("duplicate_root" | "sample_unreadable")
                )
            });
        items.push(json!({
          "root": path_string(&resolved),
          "input": raw_path,
          "exists": exists,
          "readable": readable,
          "type": kind,
          "scopes": scopes.len(),
          "logFiles": log_files,
          "sampleReadable": log_files > 0,
          "issues": issues,
          "recommendations": [],
          "valid": valid,
        }));
    }
    let ok = !items.is_empty()
        && items
            .iter()
            .all(|item| item.get("valid").and_then(Value::as_bool) == Some(true));
    json!({
      "ok": ok,
      "encoding": get_path_string(&context.config, &["encoding"]).unwrap_or("gb18030"),
      "total": items.len(),
      "logFiles": items.iter().map(|item| item.get("logFiles").and_then(Value::as_u64).unwrap_or(0)).sum::<u64>(),
      "roots": items,
    })
}

fn discover_log_scopes(root: &Path) -> Vec<PathBuf> {
    let mut scopes = Vec::new();
    let root_logs = root.join("logs");
    if root_logs.is_dir() {
        scopes.push(root_logs);
    }
    let versions_dir = root.join("versions");
    if let Ok(entries) = fs::read_dir(versions_dir) {
        for entry in entries.flatten() {
            let logs = entry.path().join("logs");
            if logs.is_dir() {
                scopes.push(logs);
            }
        }
    }
    scopes
}

fn count_log_files(dir: &Path) -> usize {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.path().is_file())
                .filter(|entry| is_log_file_name(&entry.file_name().to_string_lossy()))
                .count()
        })
        .unwrap_or(0)
}

fn is_log_file_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.ends_with(".log") || name.ends_with(".log.gz") || name.contains("!chat")
}

fn config_roots(config: &Value) -> Vec<String> {
    config
        .get("roots")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn merge_json(target: &mut Value, overlay: Value) {
    match (target, overlay) {
        (Value::Object(target), Value::Object(overlay)) => {
            for (key, value) in overlay {
                merge_json(target.entry(key).or_insert(Value::Null), value);
            }
        }
        (target, overlay) => {
            *target = overlay;
        }
    }
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&text).map_err(|error| error.to_string())
}

fn default_config() -> Value {
    json!({
      "roots": [],
      "encoding": "gb18030",
      "rules": [],
      "customRules": [],
      "scopes": [],
      "unmatchedTemplatesLimit": 50,
      "owner": {
        "mode": "all_local_users",
        "displayName": "Owner",
        "aliases": []
      },
      "app": {
        "dataDir": "data",
        "skinProxyEnabled": true
      },
      "outputs": {
        "report": "report-combined.json",
        "summary": "report-combined-summary.json"
      }
    })
}

fn preferred_config_path(root: &Path) -> PathBuf {
    let current = root.join(CONFIG_FILE_NAME);
    if current.is_file() {
        return current;
    }
    let legacy = root.join(LEGACY_CONFIG_FILE_NAME);
    if legacy.is_file() {
        return legacy;
    }
    current
}

fn preferred_local_config_path(root: &Path) -> PathBuf {
    let current = root.join(LOCAL_CONFIG_FILE_NAME);
    if current.is_file() {
        return current;
    }
    let legacy = root.join(LEGACY_LOCAL_CONFIG_FILE_NAME);
    if legacy.is_file() {
        return legacy;
    }
    current
}

fn resolve_app_path(root: &Path, value: &str) -> PathBuf {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        path
    } else {
        root.join(path)
    }
}

fn is_safe_relative_path(value: &str) -> bool {
    let path = Path::new(value);
    !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "\\")
}

fn percent_decode(value: &str) -> String {
    url::form_urlencoded::parse(value.as_bytes())
        .map(|(key, value)| {
            if value.is_empty() {
                key.into_owned()
            } else {
                format!("{key}={value}")
            }
        })
        .collect::<Vec<_>>()
        .join("&")
}

fn find_app_root() -> Option<PathBuf> {
    if let Ok(value) = env::var("MLR_ROOT").or_else(|_| env::var("MLO_ROOT")) {
        let path = PathBuf::from(value);
        if is_app_root(&path) {
            return Some(path);
        }
    }

    let mut candidates = Vec::new();
    if let Ok(current_dir) = env::current_dir() {
        candidates.push(current_dir);
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.to_path_buf());
        }
    }

    for candidate in candidates {
        for path in candidate.ancestors() {
            if is_app_root(path) {
                return Some(path.to_path_buf());
            }
        }
    }

    None
}

fn fallback_app_root() -> PathBuf {
    env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .or_else(|| env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn is_app_root(path: &Path) -> bool {
    path.join(CONFIG_FILE_NAME).is_file()
        || path.join(LEGACY_CONFIG_FILE_NAME).is_file()
        || path.join("index.html").is_file()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![api_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn detects_minecraft_log_files() {
        assert!(is_log_file_name("latest.log"));
        assert!(is_log_file_name("2024-01-01-1.log.gz"));
        assert!(is_log_file_name("!CHAT-2024-01-01.txt"));
        assert!(!is_log_file_name("options.txt"));
    }

    #[test]
    fn discovers_root_and_version_logs() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let root = env::temp_dir().join(format!("mlr-log-root-test-{stamp}"));
        let root_logs = root.join("logs");
        let version_logs = root.join("versions").join("1.20.1").join("logs");
        fs::create_dir_all(&root_logs).expect("root logs dir");
        fs::create_dir_all(&version_logs).expect("version logs dir");
        fs::write(root_logs.join("latest.log"), "").expect("root log");
        fs::write(version_logs.join("old.log.gz"), "").expect("version log");

        let scopes = discover_log_scopes(&root);
        assert_eq!(scopes.len(), 2);
        assert_eq!(
            scopes
                .iter()
                .map(|scope| count_log_files(scope))
                .sum::<usize>(),
            2
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn refresh_writes_report_and_store() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let root = env::temp_dir().join(format!("mlr-refresh-test-{stamp}"));
        let mc_root = root.join(".minecraft");
        let logs = mc_root.join("logs");
        fs::create_dir_all(&logs).expect("logs dir");
        fs::write(
            logs.join("2024-01-01-1.log"),
            "\
[12:00:00] [Client thread/INFO]: Setting user: Tester
[12:00:01] [Client thread/INFO]: [CHAT] The game starts in 1 second!
[12:05:00] [Client thread/INFO]: [CHAT] VICTORY!
[12:05:02] [Client thread/INFO]: Stopping!
",
        )
        .expect("log file");
        let context = AppContext {
            root: root.clone(),
            config_path: root.join(CONFIG_FILE_NAME),
            local_config_path: root.join(LOCAL_CONFIG_FILE_NAME),
            local_config_exists: false,
            config: json!({
              "roots": [path_string(&mc_root)],
              "encoding": "utf-8",
              "owner": { "displayName": "Owner", "aliases": [] },
              "customRules": [],
              "outputs": { "report": "report-combined.json", "summary": "report-combined-summary.json" },
              "app": { "dataDir": "data" }
            }),
            data_dir: root.join("data"),
            store_dir: root.join("data").join("report-store"),
            report_path: root.join("report-combined.json"),
            summary_path: root.join("report-combined-summary.json"),
            unmatched_path: root.join("unmatched-debug.json"),
        };

        let response = run_refresh_response(&context);
        assert_eq!(response.status, 200);
        assert_eq!(response.body["ok"], json!(true));
        assert!(context.report_path.is_file());
        assert!(context.summary_path.is_file());
        assert!(context.store_dir.join("manifest.json").is_file());
        let summary = read_json_file(&context.summary_path).expect("summary");
        assert_eq!(summary["overview"]["files"], json!(1));

        let _ = fs::remove_dir_all(root);
    }
}
