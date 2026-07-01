use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
  env,
  io::{BufRead, BufReader, Write},
  path::{Path, PathBuf},
  process::{Child, ChildStdin, ChildStdout, Command, Stdio},
  sync::Mutex,
  thread,
};

struct BridgeState {
  process: Mutex<Option<BridgeProcess>>,
}

struct BridgeProcess {
  child: Child,
  stdin: ChildStdin,
  stdout: BufReader<ChildStdout>,
  next_id: u64,
}

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

#[tauri::command]
fn api_request(state: tauri::State<'_, BridgeState>, request: ApiRequest) -> Result<ApiResponse, String> {
  let mut guard = state.process.lock().map_err(|_| "API bridge lock failed.".to_string())?;
  if guard.is_none() {
    *guard = Some(start_bridge()?);
  }

  let bridge = guard.as_mut().ok_or_else(|| "API bridge was not started.".to_string())?;
  match bridge.request(&request) {
    Ok(response) => Ok(response),
    Err(first_error) => {
      *guard = Some(start_bridge()?);
      let bridge = guard.as_mut().ok_or_else(|| "API bridge restart failed.".to_string())?;
      bridge.request(&request).map_err(|second_error| {
        format!("API bridge request failed after restart: {second_error}; first error: {first_error}")
      })
    }
  }
}

impl BridgeProcess {
  fn request(&mut self, request: &ApiRequest) -> Result<ApiResponse, String> {
    self.next_id += 1;
    let id = self.next_id;
    let payload = json!({
      "id": id,
      "method": request.method,
      "url": request.url,
      "body": request.body,
    });
    writeln!(self.stdin, "{}", payload).map_err(|error| error.to_string())?;
    self.stdin.flush().map_err(|error| error.to_string())?;

    let mut line = String::new();
    loop {
      line.clear();
      let read = self.stdout.read_line(&mut line).map_err(|error| error.to_string())?;
      if read == 0 {
        return Err("API bridge closed stdout.".to_string());
      }
      let message: Value = serde_json::from_str(line.trim()).map_err(|error| error.to_string())?;
      if message.get("id").and_then(Value::as_u64) != Some(id) {
        continue;
      }
      if message.get("ok").and_then(Value::as_bool) == Some(true) {
        let response = message.get("response").cloned().unwrap_or_else(|| json!({}));
        return Ok(ApiResponse {
          status: response.get("status").and_then(Value::as_u64).unwrap_or(500) as u16,
          headers: response.get("headers").cloned().unwrap_or_else(|| json!({})),
          body: response.get("body").cloned().unwrap_or(Value::Null),
        });
      }
      let error = message.get("error").cloned().unwrap_or_else(|| json!({}));
      let status = error.get("status").and_then(Value::as_u64).unwrap_or(500) as u16;
      let code = error.get("code").and_then(Value::as_str).unwrap_or("tauri_bridge_request_failed");
      let message = error.get("message").and_then(Value::as_str).unwrap_or("API bridge request failed.");
      return Ok(ApiResponse {
        status,
        headers: json!({}),
        body: json!({
          "ok": false,
          "error": code,
          "message": message,
        }),
      });
    }
  }
}

impl Drop for BridgeProcess {
  fn drop(&mut self) {
    let _ = self.child.kill();
  }
}

fn start_bridge() -> Result<BridgeProcess, String> {
  let root = find_app_root()?;
  let node = find_node(&root);
  let bridge_script = root.join("scripts").join("tauri-api-bridge.mjs");
  if !bridge_script.is_file() {
    return Err(format!("Missing Tauri API bridge: {}", bridge_script.display()));
  }

  let mut child = Command::new(node)
    .arg(bridge_script)
    .current_dir(root)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|error| format!("Could not start API bridge: {error}"))?;

  if let Some(stderr) = child.stderr.take() {
    thread::spawn(move || {
      let reader = BufReader::new(stderr);
      for line in reader.lines().map_while(Result::ok) {
        eprintln!("[api-bridge] {line}");
      }
    });
  }

  let stdin = child.stdin.take().ok_or_else(|| "API bridge stdin unavailable.".to_string())?;
  let stdout = child.stdout.take().ok_or_else(|| "API bridge stdout unavailable.".to_string())?;
  Ok(BridgeProcess {
    child,
    stdin,
    stdout: BufReader::new(stdout),
    next_id: 0,
  })
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

  Err("Could not locate app root with scripts/tauri-api-bridge.mjs.".to_string())
}

fn is_app_root(path: &Path) -> bool {
  path.join("scripts").join("tauri-api-bridge.mjs").is_file()
    && path.join("src").join("api").join("reportApi.mjs").is_file()
}

fn find_node(root: &Path) -> PathBuf {
  let bundled = root.join("runtime").join("node").join("node.exe");
  if bundled.is_file() {
    return bundled;
  }
  PathBuf::from("node")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(BridgeState {
      process: Mutex::new(None),
    })
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
