use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use encoding_rs::Encoding;
use futures_util::StreamExt;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

const MAX_BYTES: usize = 10 * 1024 * 1024;
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 FlowRead/0.1";

#[derive(Default)]
struct AiState {
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(Serialize)]
struct FetchResponse {
    status: u16,
    url: String,
    headers: HashMap<String, String>,
    body: String,
}

#[derive(serde::Deserialize)]
struct AiRequest {
    id: String,
    url: String,
    headers: HashMap<String, String>,
    body: String,
    #[serde(default)]
    proxy: Option<String>,
}

fn http_client(proxy: Option<&str>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent(USER_AGENT);
    if let Some(proxy) = proxy.map(str::trim).filter(|value| !value.is_empty()) {
        let proxy = reqwest::Proxy::all(proxy).map_err(|error| format!("代理地址无效：{error}"))?;
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|error| format!("HTTP 客户端初始化失败：{error}"))
}

fn charset_from_content_type(content_type: &str) -> Option<String> {
    let lower = content_type.to_ascii_lowercase();
    let index = lower.find("charset=")?;
    let rest = &content_type[index + 8..];
    let value = rest
        .trim()
        .trim_matches(|c: char| c == '"' || c == '\'')
        .split(|c: char| c == ';' || c == '"' || c == '\'' || c.is_whitespace())
        .next()
        .unwrap_or("")
        .trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn charset_from_meta(bytes: &[u8]) -> Option<String> {
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(2048)]).to_string();
    let lower = head.to_ascii_lowercase();
    let index = lower.find("charset=")?;
    let rest = &head[index + 8..];
    let value = rest
        .trim()
        .trim_matches(|c: char| c == '"' || c == '\'')
        .split(|c: char| c == ';' || c == '"' || c == '\'' || c == '>' || c.is_whitespace())
        .next()
        .unwrap_or("")
        .trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn decode_body(bytes: &[u8], content_type: &str) -> String {
    let label = charset_from_content_type(content_type).or_else(|| charset_from_meta(bytes));
    let encoding = label
        .as_deref()
        .and_then(|label| Encoding::for_label(label.as_bytes()))
        .unwrap_or(encoding_rs::UTF_8);
    let (text, _, _) = encoding.decode(bytes);
    text.into_owned()
}

#[tauri::command]
async fn fetch_text(
    url: String,
    headers: Option<HashMap<String, String>>,
    proxy: Option<String>,
) -> Result<FetchResponse, String> {
    let client = http_client(proxy.as_deref())?;
    let mut request = client
        .get(&url)
        .header(
            "accept",
            "application/rss+xml, application/atom+xml, application/feed+json, application/json;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5",
        )
        .header("accept-language", "zh-CN,zh;q=0.9,en;q=0.8");
    if let Some(headers) = headers {
        for (key, value) in headers {
            request = request.header(key.as_str(), value.as_str());
        }
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("无法访问该地址：{error}"))?;
    let status = response.status().as_u16();
    let final_url = response.url().to_string();
    let mut header_map = HashMap::new();
    for (key, value) in response.headers() {
        header_map.insert(
            key.as_str().to_ascii_lowercase(),
            value.to_str().unwrap_or("").to_string(),
        );
    }

    if status == 304 {
        return Ok(FetchResponse {
            status,
            url: final_url,
            headers: header_map,
            body: String::new(),
        });
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取响应失败：{error}"))?;
    if bytes.len() > MAX_BYTES {
        return Err("内容过大，已拒绝下载".into());
    }
    let content_type = header_map
        .get("content-type")
        .cloned()
        .unwrap_or_default();
    let body = decode_body(&bytes, &content_type);
    Ok(FetchResponse {
        status,
        url: final_url,
        headers: header_map,
        body,
    })
}

async fn stream_ai(
    request: &AiRequest,
    cancel: Arc<AtomicBool>,
    on_event: &Channel<String>,
) -> Result<(), String> {
    let client = http_client(request.proxy.as_deref())?;
    let mut builder = client.post(&request.url);
    for (key, value) in &request.headers {
        builder = builder.header(key.as_str(), value.as_str());
    }

    let response = builder
        .body(request.body.clone())
        .send()
        .await
        .map_err(|error| format!("无法连接 AI 服务：{error}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        let message: String = text.chars().take(300).collect();
        return Err(format!("AI 服务返回 {}：{}", status.as_u16(), message));
    }

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        let bytes = chunk.map_err(|error| format!("读取 AI 响应失败：{error}"))?;
        if on_event.send(String::from_utf8_lossy(&bytes).to_string()).is_err() {
            break;
        }
    }
    Ok(())
}

#[tauri::command]
async fn ai_stream(
    state: State<'_, AiState>,
    request: AiRequest,
    on_event: Channel<String>,
) -> Result<(), String> {
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .cancels
        .lock()
        .map_err(|_| "AI 状态锁不可用".to_string())?
        .insert(request.id.clone(), cancel.clone());

    let result = stream_ai(&request, cancel, &on_event).await;
    if let Ok(mut cancels) = state.cancels.lock() {
        cancels.remove(&request.id);
    }
    result
}

#[tauri::command]
fn ai_cancel(state: State<'_, AiState>, id: String) {
    if let Ok(cancels) = state.cancels.lock() {
        if let Some(flag) = cancels.get(&id) {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

#[tauri::command]
async fn ai_models(
    url: String,
    headers: HashMap<String, String>,
    proxy: Option<String>,
) -> Result<String, String> {
    let client = http_client(proxy.as_deref())?;
    let mut builder = client.get(&url);
    for (key, value) in &headers {
        builder = builder.header(key.as_str(), value.as_str());
    }
    let response = builder
        .send()
        .await
        .map_err(|error| format!("无法获取模型列表：{error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取模型列表失败：{error}"))?;
    if !status.is_success() {
        let message: String = text.chars().take(300).collect();
        return Err(format!("AI 服务返回 {}：{}", status.as_u16(), message));
    }
    Ok(text)
}

#[tauri::command]
async fn ai_complete(
    url: String,
    headers: HashMap<String, String>,
    body: String,
    proxy: Option<String>,
) -> Result<String, String> {
    let client = http_client(proxy.as_deref())?;
    let mut builder = client.post(&url);
    for (key, value) in &headers {
        builder = builder.header(key.as_str(), value.as_str());
    }
    let response = builder
        .body(body)
        .send()
        .await
        .map_err(|error| format!("无法连接 AI 服务：{error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取 AI 响应失败：{error}"))?;
    if !status.is_success() {
        let message: String = text.chars().take(300).collect();
        return Err(format!("AI 服务返回 {}：{}", status.as_u16(), message));
    }
    Ok(text)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AiState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            fetch_text,
            ai_stream,
            ai_cancel,
            ai_models,
            ai_complete
        ])
        .run(tauri::generate_context!())
        .expect("error while running FlowRead");
}
