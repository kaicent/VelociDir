use std::fs;
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;
use rayon::prelude::*;
use std::process::Command;
use serde::{Serialize, Deserialize};
use std::io::{Read, BufReader};

#[derive(Serialize, Deserialize)]
pub struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified: u64,
}

#[derive(Serialize, Deserialize)]
pub struct SystemInfo {
    os: String,
    sep: String,
}

/// Checks if a path is valid for file system operations.
/// Prevents directory traversal and handles virtual paths like 'root'.
fn is_valid_path(path: &str) -> bool {
    if path.is_empty() {
        return false;
    }
    if path == "root" {
        return false;
    }
    
    // Check for null bytes which can truncate paths in C APIs
    if path.contains('\0') {
        return false;
    }
    
    // Prevent directory traversal attacks using Path parsing
    let p = Path::new(path);
    for component in p.components() {
        if component == Component::ParentDir {
            return false;
        }
    }
    true
}

/// Reads the contents of a directory and returns a sorted list of files and folders.
#[tauri::command]
async fn read_directory(path: String) -> Result<Vec<FileEntry>, String> {
    println!("Backend: read_directory: path={}", path);
    if !is_valid_path(&path) {
        return Err("Invalid or virtual path".to_string());
    }
    let entries = fs::read_dir(&path).map_err(|e| {
        println!("Backend: read_directory error: {}", e);
        e.to_string()
    })?;
    let mut file_entries = Vec::new();

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                println!("Backend: read_directory: skipping unreadable entry: {}", e);
                continue;
            }
        };
        // Use symlink_metadata to avoid following broken symlinks/shortcuts
        let metadata = match entry.path().symlink_metadata() {
            Ok(m) => m,
            Err(e) => {
                println!("Backend: read_directory: skipping {:?}: {}", entry.file_name(), e);
                continue;
            }
        };
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path().to_string_lossy().to_string();

        file_entries.push(FileEntry {
            name,
            path,
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified: metadata.modified()
                .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs())
                .unwrap_or(0),
        });
    }

    println!("Backend: read_directory success, count={}", file_entries.len());
    Ok(file_entries)
}

/// Reads the first 10KB of a file to provide a quick preview without loading large assets into memory.
#[tauri::command]
async fn read_file_preview(path: String) -> Result<String, String> {
    println!("Backend: read_file_preview: path={}", path);
    if !is_valid_path(&path) {
        return Err("Invalid or virtual path".to_string());
    }
    
    let file = fs::File::open(&path).map_err(|e| {
        println!("Backend: read_file_preview open error: {}", e);
        e.to_string()
    })?;
    
    // Check file size first - if it's too big, we only read a portion
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if metadata.is_dir() {
        return Err("Cannot preview a directory".to_string());
    }

    let mut reader = BufReader::new(file);
    let mut buffer = Vec::with_capacity(10000);
    
    // Read up to 10KB
    reader.by_ref().take(10000).read_to_end(&mut buffer).map_err(|e| {
         println!("Backend: read_file_preview read error: {}", e);
         e.to_string()
    })?;

    // Attempt to convert to string lossily (to handle non-UTF8 files without crashing)
    let content = String::from_utf8_lossy(&buffer).to_string();
    
    println!("Backend: read_file_preview success, length={}", content.len());
    Ok(content)
}

fn copy_recursive(source: impl AsRef<Path>, destination: impl AsRef<Path>) -> Result<(), String> {
    fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_type = entry.file_type().map_err(|e| e.to_string())?;
        let dest_path = destination.as_ref().join(entry.file_name());
        if entry_type.is_dir() {
            copy_recursive(entry.path(), dest_path)?;
        } else {
            fs::copy(entry.path(), dest_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Transfers a file or directory from source to destination.
/// Handles cross-drive moves by performing a recursive copy followed by a deletion.
#[tauri::command]
async fn transfer_file(source: String, destination: String, is_move: bool) -> Result<(), String> {
    println!("Backend: transfer_file: source={}, destination={}, is_move={}", source, destination, is_move);
    if !is_valid_path(&source) || !is_valid_path(&destination) {
        return Err("Invalid or virtual path".to_string());
    }
    let src_path = Path::new(&source);
    let dest_path = Path::new(&destination);

    if !src_path.exists() {
        return Err(format!("Source path does not exist: {}", source));
    }

    // Ensure destination parent directory exists
    if let Some(parent) = dest_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create destination parent directory: {}", e))?;
        }
    }

    if is_move {
        // Try direct rename first
        if fs::rename(src_path, dest_path).is_err() {
            // If rename fails (likely cross-drive), try copy-then-delete
            if src_path.is_dir() {
                copy_recursive(src_path, dest_path).map_err(|e| format!("Failed to copy directory: {}", e))?;
                fs::remove_dir_all(src_path).map_err(|e| format!("Failed to remove source directory after copy: {}", e))?;
            } else {
                fs::copy(src_path, dest_path).map_err(|e| format!("Failed to copy file: {}", e))?;
                fs::remove_file(src_path).map_err(|e| format!("Failed to remove source file after copy: {}", e))?;
            }
        }
    } else {
        if src_path.is_dir() {
            copy_recursive(src_path, dest_path).map_err(|e| format!("Failed to copy directory: {}", e))?;
        } else {
            fs::copy(src_path, dest_path).map_err(|e| format!("Failed to copy file: {}", e)).map(|_| ())?;
        }
    }
    Ok(())
}

/// Opens a native terminal instance at the specified directory.
#[tauri::command]
async fn open_terminal(path: String) -> Result<(), String> {
    if !is_valid_path(&path) {
        return Err("Invalid or virtual path".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        // Use environment variables to pass the path safely to PowerShell
        // This avoids any command injection vulnerabilities from quotes or special chars
        Command::new("powershell")
            .env("VELOCIDIR_TARGET_PATH", &path)
            .arg("-NoExit")
            .arg("-Command")
            .arg("Set-Location -LiteralPath $env:VELOCIDIR_TARGET_PATH")
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-a")
            .arg("Terminal")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        // Try common linux terminals
        let terminals = ["gnome-terminal", "konsole", "xfce4-terminal", "xterm"];
        let mut spawned = false;
        for term in terminals {
            if Command::new(term)
                .arg("--working-directory")
                .arg(&path)
                .spawn()
                .is_ok() {
                spawned = true;
                break;
            }
        }
        if !spawned {
            return Err("No compatible terminal found".to_string());
        }
    }
    Ok(())
}

/// Retrieves a list of available storage drives on the system.
#[tauri::command]
async fn get_available_drives() -> Result<Vec<FileEntry>, String> {
    let mut drives = Vec::new();
    #[cfg(target_os = "windows")]
    {
        for letter in b'A'..=b'Z' {
            let drive = format!("{}:\\", letter as char);
            if Path::new(&drive).exists() {
                drives.push(FileEntry {
                    name: format!("Drive ({}:)", letter as char),
                    path: drive,
                    is_dir: true,
                    size: 0,
                    modified: 0,
                });
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        drives.push(FileEntry {
            name: "Root".to_string(),
            path: "/".to_string(),
            is_dir: true,
            size: 0,
            modified: 0,
        });
    }
    Ok(drives)
}

/// Returns basic system information like the OS and path separator.
#[tauri::command]
async fn get_system_info() -> Result<SystemInfo, String> {
    let os = std::env::consts::OS.to_string();
    let sep = std::path::MAIN_SEPARATOR.to_string();
    Ok(SystemInfo { os, sep })
}

/// Renames a file or directory on the disk.
#[tauri::command]
async fn rename_item(old_path: String, new_path: String) -> Result<(), String> {
    if !is_valid_path(&old_path) || !is_valid_path(&new_path) {
        return Err("Invalid or virtual path".to_string());
    }
    fs::rename(old_path, new_path).map_err(|e| e.to_string())
}

/// Opens a file or launches a directory using the system default application.
#[tauri::command]
async fn open_item(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !is_valid_path(&path) {
        return Err("Invalid or virtual path".to_string());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path.clone(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Executes a file with elevated (Administrator) privileges on Windows.
#[tauri::command]
async fn run_as_admin(path: String) -> Result<(), String> {
    if !is_valid_path(&path) {
        return Err("Invalid or virtual path".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        // Use environment variables to prevent command injection
        Command::new("powershell")
            .env("VELOCIDIR_TARGET_PATH", &path)
            .arg("-NoProfile")
            .arg("-Command")
            .arg("Start-Process -FilePath $env:VELOCIDIR_TARGET_PATH -Verb runAs")
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Moves an item to the system trash/recycle bin.
#[tauri::command]
async fn delete_item(path: String) -> Result<(), String> {
    if !is_valid_path(&path) {
        return Err("Invalid or virtual path".to_string());
    }
    trash::delete(path).map_err(|e| {
        println!("Backend: delete_item (trash) error: {}", e);
        e.to_string()
    })
}

#[tauri::command]
async fn create_item(path: String, is_dir: bool) -> Result<(), String> {
    if !is_valid_path(&path) {
        return Err("Invalid or virtual path".to_string());
    }
    let p = Path::new(&path);
    if p.exists() {
        return Err("Target path already exists".to_string());
    }
    if is_dir {
        fs::create_dir_all(p).map_err(|e| e.to_string())?;
    } else {
        // Ensure parent directory exists
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::File::create(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Retrieves metadata for a single file or directory.
#[tauri::command]
async fn get_file_info(path: String) -> Result<FileEntry, String> {
    println!("Backend: get_file_info: path={}", path);
    if !is_valid_path(&path) {
        return Err("Invalid or virtual path".to_string());
    }
    let p = Path::new(&path);
    if !p.exists() {
        println!("Backend: get_file_info: path exists=false");
        return Err("Item does not exist".to_string());
    }
    let metadata = fs::metadata(p).map_err(|e| e.to_string())?;
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    
    let info = FileEntry {
        name,
        path: path.clone(),
        is_dir: metadata.is_dir(),
        size: metadata.len(),
        modified: metadata.modified()
            .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs())
            .unwrap_or(0),
    };
    println!("Backend: get_file_info: success, name={}", info.name);
    Ok(info)
}

/// Recursively searches for files and folders matching the query.
/// Optimized with skip directories and parallelization.
fn search_optimized(base_path: &Path, query: &str) -> Vec<FileEntry> {
    let query_lower = query.to_lowercase();
    let skip_dirs = ["node_modules", ".git", "target", "dist", ".next", ".cache"];

    // Walk the directory and collect paths first (relatively fast compared to metadata/matching)
    let paths: Vec<PathBuf> = WalkDir::new(base_path)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !skip_dirs.iter().any(|&d| name == d)
        })
        .filter_map(|e| e.ok())
        .map(|e| e.path().to_path_buf())
        .collect();

    // Process matching and metadata in parallel
    paths.into_par_iter()
        .filter_map(|path| {
            let name = path.file_name()?.to_string_lossy().to_string();
            if name.to_lowercase().contains(&query_lower) {
                if let Ok(metadata) = fs::metadata(&path) {
                    return Some(FileEntry {
                        name,
                        path: path.to_string_lossy().to_string(),
                        is_dir: metadata.is_dir(),
                        size: metadata.len(),
                        modified: metadata.modified()
                            .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs())
                            .unwrap_or(0),
                    });
                }
            }
            None
        })
        .collect()
}

/// Command to initiate a recursive search from a base path.
#[tauri::command]
async fn search_files(path: String, query: String) -> Result<Vec<FileEntry>, String> {
    println!("Backend: search_files: path={}, query={}", path, query);
    if !is_valid_path(&path) {
        return Err("Invalid or virtual path".to_string());
    }
    
    let base_path = Path::new(&path);
    if !base_path.exists() {
        return Err("Path does not exist".to_string());
    }

    let results = search_optimized(base_path, &query);
    
    println!("Backend: search_files success, found={}", results.len());
    Ok(results)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_directory,
            read_file_preview,
            get_file_info,
            get_system_info,
            transfer_file,
            open_terminal,
            get_available_drives,
            rename_item,
            open_item,
            run_as_admin,
            delete_item,
            create_item,
            search_files
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                println!("Backend: Window close requested: {}", window.label());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
