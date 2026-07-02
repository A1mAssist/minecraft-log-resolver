use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    cmp::Ordering,
    env,
    fs::{self, File},
    io::{BufRead, BufReader},
    path::{Component, Path, PathBuf},
};
use url::Url;

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
}

#[tauri::command]
fn api_request(request: ApiRequest) -> Result<ApiResponse, String> {
    let _ = &request.body;
    let context = match AppContext::discover() {
        Ok(context) => context,
        Err(error) => {
            return Ok(error_response(
                500,
                "app_root_not_found",
                "The Tauri runtime could not locate the application root.",
                json!({ "details": error }),
            ));
        }
    };
    Ok(route_api(&context, request))
}

impl AppContext {
    fn discover() -> Result<Self, String> {
        let root = find_app_root()?;
        let config_path = root.join("minecraft-log-observatory.config.json");
        let local_config_path = root.join("minecraft-log-observatory.local.json");
        let mut config = read_json_file(&config_path).unwrap_or_else(|_| json!({}));
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

        Ok(Self {
            root,
            config_path,
            local_config_path,
            local_config_exists,
            config,
            data_dir,
            store_dir,
            report_path,
            summary_path,
        })
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

    if method != "GET" {
        return not_implemented_response(path);
    }

    match path {
        "/api/health" => json_response(
            200,
            json!({ "ok": true, "runtime": "tauri-rust", "tcpListeners": false }),
        ),
        "/api/app/status" => app_status_response(context),
        "/api/config" => config_response(context),
        "/api/refresh" => refresh_response(),
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
        "/api/rules/doctor" => read_only_rules_doctor_response(),
        "/api/rules/audit" => read_only_rules_audit_response(),
        "/api/rule-packs" => read_only_rule_packs_response(context),
        "/api/rule-packs/user" => read_only_user_rule_packs_response(),
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
            read_only_user_rule_pack_detail_response(path)
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
            "implemented": false,
            "message": "Writing config is not implemented in the pure Rust Tauri backend yet."
          }
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

fn read_only_rule_packs_response(context: &AppContext) -> ApiResponse {
    let available = read_store_json(context, "rules")
        .ok()
        .and_then(|rules| rules.get("available").cloned())
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default();
    json_response(
        200,
        json!({
          "ok": true,
          "readOnly": true,
          "customRulePaths": get_path_value(&context.config, &["customRules"]).cloned().unwrap_or_else(|| json!([])),
          "total": available.len(),
          "items": available,
          "message": "Rule pack editing is not implemented in the pure Rust Tauri backend yet."
        }),
    )
}

fn read_only_user_rule_packs_response() -> ApiResponse {
    json_response(
        200,
        json!({
          "ok": true,
          "readOnly": true,
          "total": 0,
          "items": [],
          "enabled": [],
          "message": "User rule pack editing is not implemented in the pure Rust Tauri backend yet."
        }),
    )
}

fn read_only_user_rule_pack_detail_response(path: &str) -> ApiResponse {
    let id = percent_decode(path.trim_start_matches("/api/rule-packs/user/"));
    error_response(
        404,
        "rule_pack_not_found",
        "User rule pack was not found in the read-only Rust backend.",
        json!({ "id": id }),
    )
}

fn read_only_rule_packs_validate_response(context: &AppContext) -> ApiResponse {
    json_response(
        200,
        json!({
          "ok": true,
          "readOnly": true,
          "customRulePaths": get_path_value(&context.config, &["customRules"]).cloned().unwrap_or_else(|| json!([])),
          "total": 0,
          "items": []
        }),
    )
}

fn read_only_rules_doctor_response() -> ApiResponse {
    json_response(
        200,
        json!({
          "ok": true,
          "readOnly": true,
          "status": "read_only",
          "findings": [],
          "checks": [],
          "message": "Rule diagnostics are not implemented in the pure Rust Tauri backend yet."
        }),
    )
}

fn read_only_rules_audit_response() -> ApiResponse {
    json_response(
        200,
        json!({
          "ok": true,
          "readOnly": true,
          "total": 0,
          "items": [],
          "message": "Rule audit history is not implemented in the pure Rust Tauri backend yet."
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

fn not_implemented_response(path: &str) -> ApiResponse {
    error_response(
    501,
    "not_implemented_in_rust_backend",
    "This action still belongs to the legacy JavaScript backend and has not been ported to the pure Rust Tauri runtime yet.",
    json!({
      "path": path,
      "runtime": "tauri-rust",
      "readOnly": true
    }),
  )
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

fn find_app_root() -> Result<PathBuf, String> {
    if let Ok(value) = env::var("MLO_ROOT") {
        let path = PathBuf::from(value);
        if is_app_root(&path) {
            return Ok(path);
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
                return Ok(path.to_path_buf());
            }
        }
    }

    Err(
        "Could not locate an app root containing minecraft-log-observatory.config.json."
            .to_string(),
    )
}

fn is_app_root(path: &Path) -> bool {
    path.join("minecraft-log-observatory.config.json").is_file()
        && path.join("index.html").is_file()
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
