//! Mức sử dụng Claude Code: quét các file transcript JSONL cục bộ
//! (~/.claude/projects/**/*.jsonl) theo kiểu tăng dần và, nếu máy có token
//! OAuth cục bộ, hỏi thêm endpoint usage chính thức (5 giờ / 7 ngày).

use chrono::{DateTime, Local, TimeZone};
use memchr::memmem;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const BLOCK_SECS: i64 = 5 * 3600;
const SCAN_WINDOW_SECS: u64 = 8 * 24 * 3600;
const CACHE_VERSION: u32 = 1;

#[derive(Clone, Copy, Serialize, Deserialize)]
struct Rec {
    ts: i64,
    model: u16,
    input: u64,
    output: u64,
    cache_create: u64,
    cache_read: u64,
}

#[derive(Default, Serialize, Deserialize)]
struct FileState {
    size: u64,
    offset: u64,
    mtime: i64,
    records: Vec<Rec>,
}

#[derive(Default, Serialize, Deserialize)]
struct Cache {
    version: u32,
    files: HashMap<String, FileState>,
    models: Vec<String>,
    seen: HashSet<u64>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    pub input: u64,
    pub output: u64,
    pub cache_create: u64,
    pub cache_read: u64,
    pub messages: u64,
    pub cost: f64,
}

impl Bucket {
    fn add(&mut self, r: &Rec, cost: f64) {
        self.input += r.input;
        self.output += r.output;
        self.cache_create += r.cache_create;
        self.cache_read += r.cache_read;
        self.messages += 1;
        self.cost += cost;
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub start: i64,
    pub end: i64,
    pub active: bool,
    pub stats: Bucket,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayStat {
    pub date: String,
    pub tokens: u64,
    pub cost: f64,
    pub messages: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStat {
    pub model: String,
    pub tokens: u64,
    pub cost: f64,
    pub messages: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub scanned_files: usize,
    pub scanned_at: i64,
    pub today: Bucket,
    pub block: Option<Block>,
    pub week: Vec<DayStat>,
    pub models_today: Vec<ModelStat>,
    pub sessions_today: usize,
    pub data_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub utilization: f64,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Official {
    /// "ok" | "no_credentials" | "no_token" | "expired" | "error"
    pub status: String,
    pub plan: Option<String>,
    pub five_hour: Option<UsageWindow>,
    pub seven_day: Option<UsageWindow>,
    pub seven_day_opus: Option<UsageWindow>,
    pub seven_day_sonnet: Option<UsageWindow>,
}

impl Official {
    fn empty(status: &str, plan: Option<String>) -> Self {
        Self {
            status: status.into(),
            plan,
            five_hour: None,
            seven_day: None,
            seven_day_opus: None,
            seven_day_sonnet: None,
        }
    }
}

pub struct Scanner {
    pub claude_dir: PathBuf,
    cache_path: PathBuf,
    cache: Mutex<Cache>,
    official: Mutex<(i64, Option<Official>)>,
}

/// Thư mục dữ liệu Claude Code (tôn trọng CLAUDE_CONFIG_DIR).
pub fn claude_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("CLAUDE_CONFIG_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir);
        }
    }
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".claude")
}

/// Giá USD trên 1 triệu token: (input, output, ghi cache, đọc cache).
fn price(model: &str) -> (f64, f64, f64, f64) {
    let m = model.to_lowercase();
    if m.contains("fable-5-1") || m.contains("mythos-5-1") {
        (10.0, 50.0, 12.5, 0.25)
    } else if m.contains("fable") || m.contains("mythos") {
        (10.0, 50.0, 12.5, 1.0)
    } else if m.contains("opus-5-5") {
        (4.0, 20.0, 5.0, 0.20)
    } else if m.contains("opus-4-1") || m.contains("opus-4-2025") {
        (15.0, 75.0, 18.75, 1.5)
    } else if m.contains("opus") {
        (5.0, 25.0, 6.25, 0.5)
    } else if m.contains("sonnet-5") {
        (2.0, 10.0, 2.5, 0.2)
    } else if m.contains("sonnet") {
        (3.0, 15.0, 3.75, 0.3)
    } else if m.contains("haiku-5") {
        (0.10, 0.50, 0.125, 0.01)
    } else if m.contains("haiku-4") {
        (1.0, 5.0, 1.25, 0.1)
    } else if m.contains("haiku") {
        (0.8, 4.0, 1.0, 0.08)
    } else {
        (3.0, 15.0, 3.75, 0.3)
    }
}

fn cost_of(r: &Rec, model: &str) -> f64 {
    let (pi, po, pw, pr) = price(model);
    (r.input as f64 * pi + r.output as f64 * po + r.cache_create as f64 * pw + r.cache_read as f64 * pr)
        / 1_000_000.0
}

fn fnv(a: &str, b: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in a.bytes().chain(std::iter::once(b':')).chain(b.bytes()) {
        h ^= byte as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

#[derive(Deserialize)]
struct Entry {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    #[serde(rename = "requestId")]
    request_id: Option<String>,
    message: Option<Msg>,
}

#[derive(Deserialize)]
struct Msg {
    id: Option<String>,
    model: Option<String>,
    usage: Option<Usage>,
}

#[derive(Deserialize)]
struct Usage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
}

impl Scanner {
    pub fn new(claude_dir: PathBuf, data_dir: PathBuf) -> Self {
        Self {
            claude_dir,
            cache_path: data_dir.join("claude-usage-cache.json"),
            cache: Mutex::new(Cache::default()),
            official: Mutex::new((0, None)),
        }
    }

    /// Quét tăng dần các file JSONL rồi tổng hợp số liệu.
    pub fn refresh(&self) -> Summary {
        let mut guard = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        if guard.version == 0 {
            if let Some(c) = load_cache(&self.cache_path) {
                *guard = c;
            }
            guard.version = CACHE_VERSION;
        }
        let files = list_jsonl(&self.claude_dir.join("projects"));
        let present: HashSet<String> = files
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        let before = guard.files.len();
        guard.files.retain(|k, _| present.contains(k));
        let mut changed = guard.files.len() != before;
        {
            let Cache { files: states, models, seen, .. } = &mut *guard;
            for path in &files {
                let key = path.to_string_lossy().into_owned();
                let state = states.entry(key).or_default();
                if let Ok(true) = parse_tail(path, state, models, seen) {
                    changed = true;
                }
            }
        }
        if changed {
            save_cache(&self.cache_path, &guard);
        }
        summarize(&guard, self.claude_dir.to_string_lossy().into_owned())
    }

    fn cached_official(&self) -> Option<Official> {
        let guard = self.official.lock().ok()?;
        let now = chrono::Utc::now().timestamp();
        match &*guard {
            (ts, Some(value)) if now - *ts < 50 => Some(value.clone()),
            _ => None,
        }
    }

    fn store_official(&self, value: &Official) {
        if let Ok(mut guard) = self.official.lock() {
            *guard = (chrono::Utc::now().timestamp(), Some(value.clone()));
        }
    }

    /// Kết quả endpoint chính thức, cache tối đa 50 giây.
    pub async fn official_cached(&self) -> Official {
        if let Some(v) = self.cached_official() {
            return v;
        }
        let v = fetch_official(self.claude_dir.clone()).await;
        self.store_official(&v);
        v
    }
}

fn load_cache(path: &Path) -> Option<Cache> {
    let text = fs::read_to_string(path).ok()?;
    let cache: Cache = serde_json::from_str(&text).ok()?;
    if cache.version != CACHE_VERSION {
        return None;
    }
    Some(cache)
}

fn save_cache(path: &Path, cache: &Cache) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string(cache) {
        let tmp = path.with_extension("json.tmp");
        if fs::write(&tmp, text).is_ok() {
            let _ = fs::rename(&tmp, path);
        }
    }
}

fn list_jsonl(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let cutoff = SystemTime::now().checked_sub(Duration::from_secs(SCAN_WINDOW_SECS));
    walk(root, 0, &mut out, cutoff);
    out
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>, cutoff: Option<SystemTime>) {
    if depth > 4 {
        return;
    }
    let Ok(read_dir) = fs::read_dir(dir) else {
        return;
    };
    for entry in read_dir.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_dir() {
            walk(&path, depth + 1, out, cutoff);
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        if let (Some(c), Ok(m)) = (cutoff, meta.modified()) {
            if m < c {
                continue;
            }
        }
        out.push(path);
    }
}

/// Đọc phần mới ghi thêm của một file; trả về true nếu có dữ liệu mới.
fn parse_tail(
    path: &Path,
    state: &mut FileState,
    models: &mut Vec<String>,
    seen: &mut HashSet<u64>,
) -> std::io::Result<bool> {
    let meta = fs::metadata(path)?;
    let size = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    if size < state.offset {
        // File bị ghi lại từ đầu.
        state.records.clear();
        state.offset = 0;
    }
    if size == state.offset {
        state.size = size;
        state.mtime = mtime;
        return Ok(false);
    }
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(state.offset))?;
    let mut reader = BufReader::with_capacity(1 << 16, file);
    let mut line: Vec<u8> = Vec::new();
    let mut consumed = state.offset;
    loop {
        line.clear();
        let n = reader.read_until(b'\n', &mut line)?;
        if n == 0 {
            break;
        }
        if line.last() != Some(&b'\n') {
            // Dòng chưa ghi xong, để lần quét sau.
            break;
        }
        consumed += n as u64;
        if let Some(rec) = parse_line(&line, models, seen) {
            state.records.push(rec);
        }
    }
    state.offset = consumed;
    state.size = size;
    state.mtime = mtime;
    Ok(true)
}

fn parse_line(line: &[u8], models: &mut Vec<String>, seen: &mut HashSet<u64>) -> Option<Rec> {
    if memmem::find(line, br#""type":"assistant""#).is_none()
        || memmem::find(line, br#""usage""#).is_none()
    {
        return None;
    }
    let entry: Entry = serde_json::from_slice(line).ok()?;
    if entry.kind.as_deref() != Some("assistant") {
        return None;
    }
    let msg = entry.message?;
    let usage = msg.usage?;
    let model = msg.model.unwrap_or_default();
    if model.is_empty() || model == "<synthetic>" {
        return None;
    }
    let input = usage.input_tokens.unwrap_or(0);
    let output = usage.output_tokens.unwrap_or(0);
    let cache_create = usage.cache_creation_input_tokens.unwrap_or(0);
    let cache_read = usage.cache_read_input_tokens.unwrap_or(0);
    if input + output + cache_create + cache_read == 0 {
        return None;
    }
    if let Some(id) = msg.id.as_deref() {
        let key = fnv(id, entry.request_id.as_deref().unwrap_or(""));
        if !seen.insert(key) {
            return None;
        }
    }
    let ts = entry
        .timestamp
        .as_deref()
        .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
        .map(|d| d.timestamp())?;
    let idx = match models.iter().position(|m| m == &model) {
        Some(i) => i,
        None => {
            models.push(model);
            models.len() - 1
        }
    };
    Some(Rec { ts, model: idx as u16, input, output, cache_create, cache_read })
}

fn summarize(cache: &Cache, data_dir: String) -> Summary {
    let now = Local::now();
    let now_ts = now.timestamp();
    let today_start = now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .and_then(|d| Local.from_local_datetime(&d).single())
        .map(|d| d.timestamp())
        .unwrap_or(now_ts - now_ts.rem_euclid(86_400));
    let week_start = today_start - 6 * 86_400;

    let mut all: Vec<(Rec, usize)> = Vec::new();
    for (idx, state) in cache.files.values().enumerate() {
        for r in &state.records {
            all.push((*r, idx));
        }
    }
    all.sort_by_key(|(r, _)| r.ts);

    let model_name = |idx: u16| -> &str {
        cache
            .models
            .get(idx as usize)
            .map(|s| s.as_str())
            .unwrap_or("unknown")
    };

    let mut today = Bucket::default();
    let mut sessions: HashSet<usize> = HashSet::new();
    let mut per_model: HashMap<String, ModelStat> = HashMap::new();
    let mut week: Vec<DayStat> = (0..7)
        .map(|i| {
            let ts = week_start + i * 86_400;
            let date = Local
                .timestamp_opt(ts, 0)
                .single()
                .map(|d| d.format("%Y-%m-%d").to_string())
                .unwrap_or_default();
            DayStat { date, tokens: 0, cost: 0.0, messages: 0 }
        })
        .collect();

    for (r, file_idx) in &all {
        let name = model_name(r.model);
        let cost = cost_of(r, name);
        let tokens = r.input + r.output + r.cache_create + r.cache_read;
        if r.ts >= today_start {
            today.add(r, cost);
            sessions.insert(*file_idx);
            let entry = per_model.entry(name.to_string()).or_insert_with(|| ModelStat {
                model: name.to_string(),
                tokens: 0,
                cost: 0.0,
                messages: 0,
            });
            entry.tokens += tokens;
            entry.cost += cost;
            entry.messages += 1;
        }
        if r.ts >= week_start {
            let i = ((r.ts - week_start) / 86_400) as usize;
            if let Some(day) = week.get_mut(i) {
                day.tokens += tokens;
                day.cost += cost;
                day.messages += 1;
            }
        }
    }

    // Khối 5 giờ (cách tính của ccusage): bắt đầu ở đầu giờ của tin nhắn đầu tiên,
    // sang khối mới khi quá 5 giờ hoặc nghỉ hơn 5 giờ.
    let mut start = 0i64;
    let mut last_ts = 0i64;
    let mut stats = Bucket::default();
    let mut have = false;
    for (r, _) in &all {
        if !have || r.ts >= start + BLOCK_SECS || r.ts - last_ts > BLOCK_SECS {
            start = r.ts - r.ts.rem_euclid(3600);
            stats = Bucket::default();
            have = true;
        }
        stats.add(r, cost_of(r, model_name(r.model)));
        last_ts = r.ts;
    }
    let block = if have && now_ts < start + BLOCK_SECS && now_ts - last_ts <= BLOCK_SECS {
        Some(Block { start, end: start + BLOCK_SECS, active: true, stats })
    } else {
        None
    };

    let mut models_today: Vec<ModelStat> = per_model.into_values().collect();
    models_today.sort_by(|a, b| b.tokens.cmp(&a.tokens));

    Summary {
        scanned_files: cache.files.len(),
        scanned_at: now_ts,
        today,
        block,
        week,
        models_today,
        sessions_today: sessions.len(),
        data_dir,
    }
}

#[derive(Deserialize)]
struct CredFile {
    #[serde(rename = "claudeAiOauth")]
    oauth: Option<OauthCreds>,
}

#[derive(Deserialize)]
struct OauthCreds {
    #[serde(rename = "accessToken")]
    access_token: Option<String>,
    #[serde(rename = "expiresAt")]
    expires_at: Option<i64>,
    #[serde(rename = "subscriptionType")]
    subscription_type: Option<String>,
}

/// Hỏi endpoint usage chính thức bằng token OAuth cục bộ của Claude Code (nếu có).
pub async fn fetch_official(claude_dir: PathBuf) -> Official {
    let text = match fs::read_to_string(claude_dir.join(".credentials.json")) {
        Ok(t) => t,
        Err(_) => return Official::empty("no_credentials", None),
    };
    let creds: CredFile = match serde_json::from_str(&text) {
        Ok(c) => c,
        Err(_) => return Official::empty("no_credentials", None),
    };
    let Some(oauth) = creds.oauth else {
        return Official::empty("no_credentials", None);
    };
    let plan = oauth.subscription_type.clone();
    let token = oauth.access_token.unwrap_or_default();
    if token.trim().is_empty() {
        return Official::empty("no_token", plan);
    }
    let now_ms = chrono::Utc::now().timestamp_millis();
    if oauth.expires_at.map(|e| e > 0 && e < now_ms).unwrap_or(false) {
        return Official::empty("expired", plan);
    }
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
    {
        Ok(c) => c,
        Err(_) => return Official::empty("error", plan),
    };
    let response = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .bearer_auth(token.trim())
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("User-Agent", "WinWidgets/0.1")
        .send()
        .await;
    let response = match response {
        Ok(r) => r,
        Err(_) => return Official::empty("error", plan),
    };
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Official::empty("expired", plan);
    }
    if !status.is_success() {
        return Official::empty("error", plan);
    }
    let value: serde_json::Value = match response.json().await {
        Ok(v) => v,
        Err(_) => return Official::empty("error", plan),
    };
    let window = |key: &str| -> Option<UsageWindow> {
        let w = value.get(key)?;
        if w.is_null() {
            return None;
        }
        Some(UsageWindow {
            utilization: w.get("utilization").and_then(|u| u.as_f64()).unwrap_or(0.0),
            resets_at: w
                .get("resets_at")
                .and_then(|r| r.as_str())
                .map(|s| s.to_string()),
        })
    };
    Official {
        status: "ok".into(),
        plan,
        five_hour: window("five_hour"),
        seven_day: window("seven_day"),
        seven_day_opus: window("seven_day_opus"),
        seven_day_sonnet: window("seven_day_sonnet"),
    }
}
