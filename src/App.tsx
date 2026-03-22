import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Folder,
  FileText,
  ChevronRight,
  ChevronDown,
  Terminal,
  Database,
  Plus,
  X,
  HardDrive,
  Monitor,
  Clock,
  Star,
  Search,
  ArrowUpDown,
  Trash2,
  ExternalLink,
  Play,
  Image as ImageIcon,
  Copy,
  Clipboard,
  Type,
  ShieldAlert,
  Link2,
  Archive,
  AlertCircle,
  AlertTriangle
} from "lucide-react";
import React from "react";

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full w-full bg-[#1e1e1e] flex flex-col items-center justify-center p-10 text-center text-[#D2B48C]">
          <AlertTriangle size={48} className="text-[#FF6961] mb-4" />
          <h1 className="text-xl font-bold mb-2 uppercase tracking-widest">CRITICAL_RENDER_ERROR</h1>
          <pre className="text-[10px] font-mono bg-black/40 p-5 rounded-xl border border-[#FF6961]/20 max-w-2xl mb-8 overflow-auto">
            {String(this.state.error?.stack || this.state.error)}
          </pre>
          <button
            onClick={() => { localStorage.clear(); window.location.reload(); }}
            className="px-8 py-3 bg-[#77DD77] text-[#1e1e1e] rounded-lg font-bold uppercase tracking-[0.2em] hover:scale-105 transition-all shadow-2xl"
          >
            Reset Application State
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// --- Types ---

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
}

type SortField = "name" | "size" | "date" | "type";

interface PaneState {
  id: string;
  path: string;
  flex: number;
  type: "explorer" | "preview";
  searchQuery: string;
  isSearching?: boolean;
  searchResults?: FileEntry[];
  sortField: SortField;
  sortAsc: boolean;
  showThumbnails: boolean;
  lastScrollPath?: string;
  lastScrollBlock?: ScrollLogicalPosition;
}

interface TabState {
  id: string;
  name: string;
  panes: PaneState[];
  selectedFilePaths: string[];
  lastSelectedFilePath: string | null; // For range selection
}

interface ContextMenuState {
  x: number;
  y: number;
  visible: boolean;
  type: "favorite" | "tree-item" | "pane";
  target: any;
  paneId?: string;
  path?: string;
}

interface ClipboardState {
  entries: FileEntry[];
  action: "copy" | "cut";
}

interface SystemInfo {
  os: string;
  sep: string;
}

interface ModalState {
  visible: boolean;
  type: "alert" | "confirm" | "prompt";
  title: string;
  message: string;
  onConfirm?: (value?: string) => void;
  defaultValue?: string;
}

// --- Utils ---

const getFileIcon = (entry: FileEntry, isActive: boolean, size: number = 16, customColor?: string, showThumbnails?: boolean, showMargin: boolean = true) => {
  const marginClass = showMargin ? "mr-3" : "";
  if (entry.path.endsWith(":\\")) {
    return <HardDrive size={size} className={`${marginClass} ${isActive ? 'text-accent-green' : 'text-accent-yellow'}`} />;
  }
  const ext = entry.name.split(".").pop()?.toLowerCase() || "";

  if (showThumbnails && !entry.is_dir) {
    const isImage = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico"].includes(ext);
    const isVideo = ["mp4", "webm", "ogg", "mov", "avi"].includes(ext);
    if (isImage || isVideo) {
      const src = convertFileSrc(entry.path);
      return (
        <div className={`${marginClass} w-4 h-4 rounded overflow-hidden shrink-0 bg-background-main/50 border border-white/5 flex items-center justify-center`}>
          {isImage ? (
            <img src={src} loading="lazy" className="w-full h-full object-cover" />
          ) : (
            <video src={src} preload="none" muted playsInline className="w-full h-full object-cover" />
          )}
        </div>
      );
    }
  }

  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
    return <Archive size={size} className={`${marginClass} text-[#ffb3b3]`} />;
  }

  if (entry.is_dir) {
    if (isActive) return <Folder size={size} className={`${marginClass} text-accent-green`} />;
    if (customColor) return <Folder size={size} className={marginClass} style={{ color: customColor }} />;
    return <Folder size={size} className={`${marginClass} text-muted`} />;
  }

  if (ext === "pdf") {
    return <FileText size={size} className={`${marginClass} text-[#ff9999]`} />;
  }

  if (["txt", "md", "js", "ts", "py", "rs", "json", "html", "css"].includes(ext)) {
    return <FileText size={size} className={`${marginClass} text-[#f8f8f8]`} />;
  }

  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) {
    return <ImageIcon size={size} className={`${marginClass} text-[#add8e6]`} />;
  }

  if (["mp4", "webm", "ogg", "mov", "avi"].includes(ext)) {
    return <Play size={size} className={`${marginClass} text-[#ffffd0]`} />;
  }

  return <FileText size={size} className={`${marginClass} ${isActive ? 'text-accent-green' : 'text-primary'}`} />;
};

const sanitizeTabs = (tabs: TabState[]): TabState[] => {
  return tabs.map(tab => {
    // Robustly handle selected paths: never allow virtual "root" in selectable file paths
    const selectedFilePaths = (tab.selectedFilePaths || []).filter(p => p && p !== "root");

    // Also clear lastSelectedFilePath if it points to root
    const lastSelectedFilePath = tab.lastSelectedFilePath === "root" ? null : tab.lastSelectedFilePath;

    return {
      ...tab,
      selectedFilePaths,
      lastSelectedFilePath,
      panes: (tab.panes || []).map(pane => {
        const sanitizedPane = {
          ...pane,
          lastScrollPath: "",
          lastScrollBlock: undefined
        };
        if (pane.path === "root") {
          return {
            ...sanitizedPane,
            searchQuery: "",
            searchResults: []
          };
        }
        return {
          ...sanitizedPane,
          searchResults: Array.isArray(pane.searchResults) ? pane.searchResults : []
        };
      })
    };
  });
};

let SEP = "\\"; // Default for initialization, updated on mount

const getParentPaths = (path: string): string[] => {
  if (!path || path === "root") return [];
  const parents: string[] = [];
  let current = path;
  while (current.includes(SEP)) {
    const lastSlash = current.lastIndexOf(SEP);
    if (lastSlash === -1) break;
    current = current.substring(0, lastSlash);
    if (current.endsWith(":") && SEP === "\\") current += "\\";
    parents.push(current);
    if (current.endsWith(SEP)) break;
  }
  return parents.reverse();
};

const formatSizeFixed = (bytes: number) => {
  if (bytes === 0) return "---";
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const formatDate = (timestamp: number) => {
  if (timestamp === 0) return "---";
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatFileName = (name: string, isDir: boolean) => {
  if (isDir || !name.includes(".")) return name;
  const parts = name.split(".");
  if (parts.length <= 1) return name;
  const ext = parts.pop();
  const base = parts.join(".");
  return `${ext}_.${base}`;
};

// --- Components ---

const Modal = ({ state, onClose }: { state: ModalState; onClose: () => void }) => {
  const [value, setValue] = useState(state.defaultValue || "");

  if (!state.visible) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-background-pane border border-background-main shadow-2xl rounded-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-1 border-b border-background-main bg-background-main/30 flex justify-between items-center px-4">
          <div className="flex items-center gap-2 py-2">
            {state.type === 'alert' ? <AlertCircle size={14} className="text-accent-yellow" /> : state.type === 'confirm' ? <AlertTriangle size={14} className="text-accent-red" /> : <Type size={14} className="text-accent-green" />}
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]">{state.title}</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-accent-red hover:text-white rounded-lg transition-colors">
            <X size={14} />
          </button>
        </div>
        <div className="p-6">
          <p className="text-xs text-muted leading-relaxed mb-6">{state.message}</p>
          {state.type === 'prompt' && (
            <input
              id="modal-prompt-input"
              name="prompt-value"
              autoFocus
              className="w-full bg-background-main border border-muted/10 rounded-lg p-3 text-xs outline-none focus:border-accent-green/50 transition-colors mb-6 font-mono"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  state.onConfirm?.(value);
                  onClose();
                }
              }}
            />
          )}
          <div className="flex justify-end gap-3">
            {(state.type === 'confirm' || state.type === 'prompt') && (
              <button
                onClick={onClose}
                className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-muted hover:text-primary transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={() => {
                state.onConfirm?.(state.type === 'prompt' ? value : undefined);
                onClose();
              }}
              className={`px-6 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all ${state.type === 'confirm' ? 'bg-accent-red text-white hover:bg-accent-red/80' : 'bg-accent-green text-background-main hover:bg-accent-green/80'}`}
            >
              {state.type === 'confirm' ? 'Confirm' : 'OK'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ContextMenu = ({ state, children }: { state: ContextMenuState; children: React.ReactNode }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });

  useEffect(() => {
    if (menuRef.current && state.visible) {
      const menuRect = menuRef.current.getBoundingClientRect();
      const winW = window.innerWidth;
      const winH = window.innerHeight;

      let x = state.x;
      let y = state.y;

      // Adjust X if it goes off screen
      if (x + menuRect.width > winW) {
        x = winW - menuRect.width - 10;
      }

      // Adjust Y if it goes off screen
      if (y + menuRect.height > winH) {
        y = winH - menuRect.height - 10;
      }

      // Ensure it doesn't go off the top/left either
      x = Math.max(10, x);
      y = Math.max(10, y);

      setPos({ x, y });
    }
  }, [state.x, state.y, state.visible]);

  if (!state.visible) return null;

  return (
    <div
      ref={menuRef}
      className="fixed bg-background-pane border border-background-main shadow-2xl rounded p-1 z-[100] min-w-[160px] animate-in fade-in zoom-in-95 duration-75 overflow-hidden"
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
};

// FIX 2: Visual drop target highlight
/**
 * Recursive Tree Component
 * Handles rendering of the directory hierarchy, drag-and-drop orchestration,
 * and contextual navigation.
 */
const TreeItem = ({ entry, depth, parentPath = "root", onSelect, onPathChange, activePath, selectedFilePaths, metadataMode, onDragStart, onContextMenu, onDrop, searchQuery, sortField, sortAsc, refreshCounter, onError, dropTargetPath, onDragEnterPath, onDragLeavePath, folderColors, expandedPaths, onToggleExpand, isFocused, paneId, showThumbnails, lastScrollPath, lastScrollBlock, onScrollComplete }: any) => {
  const isExpanded = Array.isArray(expandedPaths) ? expandedPaths.includes(entry.path) : false;
  const [children, setChildren] = useState<FileEntry[]>([]);
  const lastRefresh = useRef(refreshCounter);
  const isActive = Array.isArray(selectedFilePaths) && selectedFilePaths.includes(entry.path);
  const isCurrentFolder = entry.is_dir && entry.path === activePath;
  const isMatch = searchQuery && entry.name.toLowerCase().includes(searchQuery.toLowerCase());
  const isDropTarget = dropTargetPath === entry.path && entry.is_dir;

  const sortedChildren = useMemo(() => {
    if (children.length === 0) return [];
    return [...children].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "size": comparison = a.size - b.size; break;
        case "date": comparison = a.modified - b.modified; break;
        case "type":
          const typeA = a.is_dir ? "dir" : (a.name.split(".").pop() || "");
          const typeB = b.is_dir ? "dir" : (b.name.split(".").pop() || "");
          comparison = typeA.localeCompare(typeB);
          break;
        default: comparison = a.name.localeCompare(b.name); break;
      }
      return sortAsc ? comparison : -comparison;
    });
  }, [children, sortField, sortAsc]);

  const autoExpandedFor = useRef<string>("");

  useEffect(() => {
    // Auto-expand if the activePath involves this node
    if (activePath.startsWith(entry.path) && entry.is_dir && activePath !== autoExpandedFor.current) {
      autoExpandedFor.current = activePath;
      const expand = async () => {
        try {
          // Even if isExpanded is already true (shared state), 
          // we might need to load children for THIS instance if they are missing.
          if (children.length === 0) {
            const result: FileEntry[] = await invoke("read_directory", { path: entry.path });
            setChildren(result);
          }
          if (!isExpanded) {
            onToggleExpand(paneId, entry.path, true);
          }
        } catch (error) {
          console.error("Failed to auto-expand:", error);
        }
      };
      expand();
    }
  }, [activePath, entry.path, entry.is_dir, isExpanded, onToggleExpand, children.length]);

  useEffect(() => {
    if (isExpanded && refreshCounter !== lastRefresh.current) {
      lastRefresh.current = refreshCounter;
      const refresh = async () => {
        try {
          const result: FileEntry[] = await invoke("read_directory", { path: entry.path });
          setChildren(result);
        } catch (error) {
          console.error("Failed to refresh children:", error);
        }
      };
      refresh();
    }
  }, [refreshCounter, isExpanded, entry.path]);

  const loadAndExpand = async () => {
    if (!isExpanded && children.length === 0) {
      try {
        const result: FileEntry[] = await invoke("read_directory", { path: entry.path });
        setChildren(result);
      } catch (error) {
        console.error("Failed to load children:", error);
      }
    }
    onToggleExpand(paneId, entry.path, true);
  };

  const toggleExpand = async (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (!isExpanded && children.length === 0) {
      try {
        const result: FileEntry[] = await invoke("read_directory", { path: entry.path });
        setChildren(result);
      } catch (error) {
        console.error("Failed to load children:", error);
      }
    }

    // If we are CLOSING and this folder (or its child) is part of selection,
    // move selection to parent so auto-expand doesn't fight us.
    if (isExpanded) {
      onPathChange(parentPath === "root" ? "root" : parentPath);
    } else {
      onPathChange(entry.path);
    }

    onToggleExpand(paneId, entry.path, !isExpanded);
  };

  const itemRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (lastScrollPath === entry.path) {
      if (scrollRef.current) {
        setTimeout(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollIntoView({ behavior: 'smooth', block: lastScrollBlock || 'start', inline: 'start' });
          }
        }, 200);
      }
      if (onScrollComplete) onScrollComplete(paneId);
    }
  }, [lastScrollPath, lastScrollBlock, paneId, entry.path, onScrollComplete]);

  // Expose methods on DOM node for keyboard navigation
  // __selectOnly  -> select without toggling expansion (used by Up/Down)
  // __expandEntry -> expand without toggling back (used by Right)
  useEffect(() => {
    if (itemRef.current) {
      (itemRef.current as any).__selectOnly = () => onSelect(entry);
      (itemRef.current as any).__expandEntry = loadAndExpand;
    }
  }, [entry, onSelect, loadAndExpand]);

  return (
    <div className="relative min-w-max">
      {/* Scroll anchor placed 48px left of the icons start */}
      <div
        ref={scrollRef}
        className="absolute pointer-events-none"
        style={{ left: `${depth * 48}px`, top: 0, width: 1, height: 1 }}
      />
      {depth > 0 && (
        <div
          className="absolute left-0 border-l border-muted/20 top-0 bottom-0"
          style={{ left: `${(depth - 1) * 48 + 24}px` }}
        />
      )}
      <div
        ref={itemRef}
        draggable={!entry.path.endsWith(":\\")}
        style={{ paddingLeft: `${depth * 48}px` } as React.CSSProperties}
        // Hierarchy attributes for keyboard navigation
        data-path={entry.path}
        data-depth={String(depth)}
        data-parent={parentPath}
        onDragStart={(e) => {
          console.log("Drag start:", entry.name, entry.path);

          // Determine what to drag:
          // If the entry being dragged is part of the selection, drag the whole selection.
          // Otherwise, clear selection and drag only this item.
          if (isActive && selectedFilePaths.length > 1) {
            // This is a bit tricky because we only have paths in selectedFilePaths.
            // For now, we'll pass a special type to indicate a multi-drag based on current selection.
            e.dataTransfer.setData("application/velocidir-multi", JSON.stringify(selectedFilePaths));
          }

          e.dataTransfer.setData("application/velocidir-item", JSON.stringify(entry));
          e.dataTransfer.setData("text/plain", entry.path);
          e.dataTransfer.effectAllowed = "copyMove";
        }}
        onContextMenu={(e) => onContextMenu(e, entry)}
        className={`flex items-center py-1.5 pr-4 hover:bg-background-main cursor-pointer rounded text-sm group transition-all relative select-none
            ${isCurrentFolder ? 'bg-accent-green/10 border-l-2 border-accent-green text-accent-green font-semibold' : ''}
            ${isActive && !isCurrentFolder ? 'bg-background-main/50 text-accent-green' : ''}
            ${isMatch ? 'bg-accent-yellow/10' : ''}
            ${isDropTarget ? 'ring-1 ring-inset ring-accent-green/60 bg-accent-green/10' : ''}
          `}
        onClick={(e) => {
          if (entry.is_dir && !e.ctrlKey && !e.shiftKey) {
            toggleExpand({ stopPropagation: () => { } } as React.MouseEvent);
          } else {
            onSelect(entry, e.ctrlKey, e.shiftKey);
          }
        }}
        onDoubleClick={() => {
          invoke("open_item", { path: entry.path }).catch(err => {
            if (onError) onError("Open Failed", `Could not open ${entry.name}: ${err}`);
          });
        }}
        // Reliable drop zone - track enter/leave for visual feedback
        onDragEnter={(e) => {
          if (entry.is_dir) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            if (onDragEnterPath) onDragEnterPath(entry.path);
          }
        }}
        onDragLeave={(e) => {
          if (entry.is_dir) {
            e.stopPropagation();
            // Only clear if leaving this element entirely (not moving to a child)
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              if (onDragLeavePath) onDragLeavePath(entry.path);
            }
          }
        }}
        onDragOver={(e) => {
          if (entry.is_dir) {
            e.preventDefault();
            e.stopPropagation();
            // shift = move, default = copy
            e.dataTransfer.dropEffect = e.shiftKey ? "move" : "copy";
          }
        }}
        onDrop={(e) => {
          if (entry.is_dir) {
            e.preventDefault();
            e.stopPropagation();
            if (onDragLeavePath) onDragLeavePath(entry.path);
            try {
              const multiData = e.dataTransfer.getData("application/velocidir-multi");
              if (multiData) {
                const paths: string[] = JSON.parse(multiData);
                for (const path of paths) {
                  if (path === entry.path || entry.path.startsWith(path + "\\")) continue;
                  // Construct a minimal FileEntry
                  const f: FileEntry = { path, name: path.split('\\').pop() || '', is_dir: false, size: 0, modified: 0 };
                  if (onDrop) onDrop(f, entry.path, e.shiftKey);
                }
                return;
              }
              const fileData = JSON.parse(e.dataTransfer.getData("application/velocidir-item"));
              if (fileData.path === entry.path || entry.path.startsWith(fileData.path + "\\")) return;
              if (onDrop) onDrop(fileData, entry.path, e.shiftKey);
            } catch (err) {
              console.error("Drop parse error:", err);
            }
          }
        }}
      >
        {depth > 0 && (
          <div
            className="absolute border-t border-muted/20 w-12 top-1/2"
            style={{ left: `${(depth - 1) * 48 + 24}px` }}
          />
        )}
        <div className="flex items-center ml-6 flex-1 min-w-[300px] whitespace-nowrap">
          {entry.is_dir && (
            <span className="mr-2 text-muted transition-transform duration-200" style={{ transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
              <ChevronDown size={14} />
            </span>
          )}
          {getFileIcon(entry, isActive, 16, folderColors?.[entry.path], showThumbnails)}
          <span className={`text-xs flex-1 pr-4 ${isActive ? 'text-accent-green' : 'group-hover:text-accent-green'} ${isMatch ? 'text-accent-yellow font-bold underline decoration-accent-yellow/30' : ''}`}>
            {formatFileName(entry.name, entry.is_dir)}
          </span>
          <span className="text-[10px] text-muted ml-4 opacity-40 group-hover:opacity-100 transition-opacity font-mono w-24 text-right">
            {metadataMode === "size" ? formatSizeFixed(entry.size) : formatDate(entry.modified)}
          </span>
        </div>
      </div>
      {isExpanded && sortedChildren.length > 0 && (
        <div className="animate-in fade-in slide-in-from-top-1 duration-200">
          {sortedChildren.map((child: FileEntry) => (
            <TreeItem
              key={child.path}
              entry={child}
              depth={depth + 1}
              parentPath={entry.path}  // FIX 1: pass down parent path
              onSelect={onSelect}
              onPathChange={onPathChange}
              activePath={activePath}
              selectedFilePaths={selectedFilePaths}
              metadataMode={metadataMode}
              onDragStart={onDragStart}
              onContextMenu={onContextMenu}
              searchQuery={searchQuery}
              sortField={sortField}
              sortAsc={sortAsc}
              refreshCounter={refreshCounter}
              onError={onError}
              onDrop={onDrop}
              dropTargetPath={dropTargetPath}
              onDragEnterPath={onDragEnterPath}
              onDragLeavePath={onDragLeavePath}
              folderColors={folderColors}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              isFocused={isFocused}
              paneId={paneId}
              showThumbnails={showThumbnails}
              lastScrollPath={lastScrollPath}
              lastScrollBlock={lastScrollBlock}
              onScrollComplete={onScrollComplete}
            />
          ))}
        </div>
      )}
    </div>
  );
};

function ExplorerPane({ pane, onSelect, onPathChange, onClose, onAdd, onDrop, onContextMenu, onSearch, onSort, onToggleThumbnails, refreshCounter, onError, onFocus, isFocused, selectedFilePaths, folderColors, expandedPaths, onToggleExpand, onScrollComplete, systemInfo, onDeepSearch }: any) {
  const [drives, setDrives] = useState<FileEntry[]>([]);
  const [isThisPCOpen, setIsThisPCOpen] = useState(true);
  const [metadataMode, setMetadataMode] = useState<"size" | "date">("size");
  const [showSortOptions, setShowSortOptions] = useState(false);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [editPathValue, setEditPathValue] = useState("");
  // Track which path is currently being dragged over for visual feedback
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);

  useEffect(() => {
    const loadDrives = async () => {
      try {
        const result: FileEntry[] = await invoke("get_available_drives");
        setDrives(result);
      } catch (error) {
        console.error("Failed to load drives:", error);
      }
    };
    loadDrives();
  }, []);

  const openTerminalHere = async () => {
    if (pane.path && pane.path !== "root") {
      try {
        await invoke("open_terminal", { path: pane.path });
      } catch (err) {
        console.error("Failed to open terminal:", err);
      }
    }
  };

  const breadcrumbs = pane.path === "root" ? [systemInfo.os === "windows" ? "This PC" : "Computer"] : [systemInfo.os === "windows" ? "This PC" : "Computer", ...pane.path.split(SEP).filter(Boolean)];

  // FIX 3: Pane background drop — only fires when NOT landing on a TreeItem (they stopPropagation)
  const handlePaneDrop = (e: React.DragEvent) => {
    console.log("Pane-level drop triggered on:", pane.path);
    e.preventDefault();
    setDropTargetPath(null);
    if (pane.path === "root") {
      console.warn("Cannot drop into root.");
      return;
    }
    try {
      const multiData = e.dataTransfer.getData("application/velocidir-multi");
      if (multiData) {
        const paths: string[] = JSON.parse(multiData);
        for (const path of paths) {
          if (path === pane.path || pane.path.startsWith(path + "\\")) continue;
          const f: FileEntry = { path, name: path.split('\\').pop() || '', is_dir: false, size: 0, modified: 0 };
          onDrop(f, pane.path, e.shiftKey);
        }
        return;
      }
      const fileData = JSON.parse(e.dataTransfer.getData("application/velocidir-item"));
      console.log("Parsed drop data:", fileData.path);
      if (fileData.path === pane.path || pane.path.startsWith(fileData.path + "\\")) {
        console.warn("Self-drop or nested drop detected in pane drop.");
        return;
      }
      onDrop(fileData, pane.path, e.shiftKey);
    } catch (err) {
      console.error("Pane drop parse error:", err);
    }
  };

  return (
    <div
      className={`flex flex-col h-full bg-background-pane overflow-hidden group/pane border-r border-background-main w-full transition-all duration-300 ${isFocused ? 'ring-1 ring-accent-green/30 ring-inset shadow-[0_0_20px_rgba(0,255,157,0.05)]' : ''}`}
      data-pane-id={pane.id}
      onClick={() => onFocus(pane.id)}
      onContextMenu={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('custom-scrollbar')) {
          onContextMenu(e, { type: "pane", paneId: pane.id, path: pane.path });
        }
      }}
    >
      <div className="flex flex-col bg-background-main shadow-sm z-10 shrink-0">
        <div className="flex justify-between items-center p-2 border-b border-background-pane">
          <div className={`flex items-center gap-2 overflow-hidden flex-1 group/search relative rounded min-h-[24px] transition-all duration-300 ${pane.isSearching ? 'search-border-animated bg-transparent' : 'bg-white/5 border border-transparent'}`}>
            <div className={`search-input-wrapper ${pane.isSearching ? 'search-active' : ''}`}>
              <Search size={12} className={`${pane.isSearching ? 'text-accent-green animate-pulse' : 'text-muted'} shrink-0`} />
              <input
                id={`search-${pane.id}`}
                name="search-query"
                type="text"
                placeholder="Filter current view..."
                value={pane.searchQuery}
                onChange={(e) => onSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && pane.searchQuery.trim()) {
                    onDeepSearch(pane.id, pane.path, pane.searchQuery);
                  }
                }}
                className="bg-transparent border-none outline-none text-[10px] font-mono text-muted focus:text-primary transition-colors w-full p-0 h-6 placeholder:opacity-30"
              />
            </div>
            {pane.isSearching && <div className="search-scanner-bar" />}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-accent-red hover:text-background-main rounded opacity-0 group-hover/pane:opacity-100 transition-opacity">
            <X size={12} />
          </button>
        </div>

        <div className="p-1.5 flex justify-between items-center text-[9px] bg-background-pane/10 relative">
          <div className="flex gap-3">
            <button
              onClick={() => setMetadataMode("size")}
              className={`flex items-center gap-1 transition-colors ${metadataMode === "size" ? 'text-accent-yellow' : 'text-muted'}`}
            >
              <Database size={10} /> SIZE
            </button>
            <button
              onClick={() => setMetadataMode("date")}
              className={`flex items-center gap-1 transition-colors ${metadataMode === "date" ? 'text-accent-yellow' : 'text-muted'}`}
            >
              <Clock size={10} /> DATE
            </button>
            <div className="relative">
              <button
                onClick={() => setShowSortOptions(!showSortOptions)}
                className={`flex items-center gap-1 transition-colors hover:text-accent-yellow ${showSortOptions ? 'text-accent-yellow' : 'text-muted'}`}
              >
                <ArrowUpDown size={10} /> {pane.sortField.toUpperCase()}
              </button>
              {showSortOptions && (
                <div className="absolute top-full left-0 mt-1 bg-background-pane border border-background-main shadow-2xl rounded p-1 z-50 min-w-[80px]">
                  {["name", "type", "size", "date"].map(f => (
                    <div
                      key={f}
                      className={`p-1 px-2 hover:bg-background-main rounded cursor-pointer uppercase font-bold tracking-tighter ${pane.sortField === f ? 'text-accent-yellow' : ''}`}
                      onClick={() => {
                        onSort(f as SortField);
                        setShowSortOptions(false);
                      }}
                    >
                      {f}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-1">
            <button
              onClick={openTerminalHere}
              className="p-0.5 hover:bg-accent-yellow hover:text-background-main rounded px-1.5 border border-muted/10 flex items-center gap-1 bg-background-pane"
              disabled={pane.path === "root"}
            >
              <Terminal size={10} /> <span className="uppercase text-[8px] font-bold">Terminal</span>
            </button>
            <button
              onClick={onToggleThumbnails}
              className={`p-0.5 hover:bg-accent-blue hover:text-white rounded px-1.5 border border-muted/10 flex items-center gap-1 bg-background-pane transition-all ${pane.showThumbnails ? 'text-accent-blue border-accent-blue/50' : 'text-muted'}`}
            >
              <ImageIcon size={10} /> <span className="uppercase text-[8px] font-bold">Preview</span>
            </button>
            <button
              onClick={onAdd}
              className="p-0.5 hover:bg-accent-green hover:text-background-main rounded px-1.5 border border-muted/10 bg-background-pane text-accent-green"
            >
              <Plus size={10} />
            </button>
          </div>
        </div>

        <div
          className="p-1.5 px-2 bg-white/10 flex items-center gap-1 overflow-x-auto whitespace-nowrap scrollbar-hide border-b border-background-pane min-h-[24px] cursor-text"
          onClick={() => {
            setIsEditingPath(true);
            setEditPathValue(pane.path);
          }}
        >
          {isEditingPath ? (
            <input
              id={`path-edit-${pane.id}`}
              name="path-value"
              autoFocus
              className="bg-transparent border-none outline-none text-[10px] font-mono text-primary w-full p-0 h-full"
              value={editPathValue}
              onChange={(e) => setEditPathValue(e.target.value)}
              onBlur={() => setIsEditingPath(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onPathChange(editPathValue);
                  setIsEditingPath(false);
                } else if (e.key === "Escape") {
                  setIsEditingPath(false);
                }
              }}
            />
          ) : (
            breadcrumbs.map((crumb, i) => (
              <div key={i} className="flex items-center text-[8px] font-mono text-muted uppercase tracking-tighter opacity-70">
                {i > 0 && <ChevronRight size={8} className="mx-0.5 opacity-20" />}
                <span className="hover:text-primary cursor-pointer transition-colors max-w-[200px] truncate">{crumb}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* FIX 3: Scroll container now has its own onDrop so empty-space drops are caught */}
      <div
        className="flex-1 overflow-auto custom-scrollbar p-1 outline-none"
        onMouseDown={(e) => {
          // Middle mouse button (button 1)
          if (e.button === 1) {
            e.preventDefault(); // Prevent default autoscroll icon
            const container = e.currentTarget;
            const startX = e.clientX;
            const startY = e.clientY;
            const startScrollLeft = container.scrollLeft;
            const startScrollTop = container.scrollTop;

            document.body.style.cursor = 'grabbing';
            const onMouseMove = (moveEvent: MouseEvent) => {
              const deltaX = moveEvent.clientX - startX;
              const deltaY = moveEvent.clientY - startY;
              container.scrollLeft = startScrollLeft - deltaX;
              container.scrollTop = startScrollTop - deltaY;
            };

            const onMouseUp = () => {
              document.body.style.cursor = '';
              window.removeEventListener("mousemove", onMouseMove);
              window.removeEventListener("mouseup", onMouseUp);
            };

            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDragLeave={(e) => {
          // Clear drop target when leaving the pane entirely
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDropTargetPath(null);
          }
        }}
        onDrop={handlePaneDrop}
      >
        {pane.searchResults && pane.searchResults.length > 0 && (
          <div className="mb-6 border-b border-muted/10 pb-4">
            <div className="flex items-center justify-between px-2 mb-2">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-accent-green">
                <Search size={12} /> Search Results ({pane.searchResults.length})
              </div>
              <button
                onClick={() => onSearch("")}
                className="text-[8px] uppercase font-bold text-muted hover:text-accent-red transition-colors"
              >
                Clear Results
              </button>
            </div>
            <div className="space-y-0.5">
              {pane.searchResults.map((result: FileEntry) => (
                <TreeItem
                  key={result.path}
                  entry={result}
                  depth={0}
                  parentPath="search"
                  onSelect={onSelect}
                  onPathChange={onPathChange}
                  activePath={pane.path}
                  selectedFilePaths={selectedFilePaths}
                  metadataMode={metadataMode}
                  onDragStart={() => { }}
                  onContextMenu={(e: any, target: any) => onContextMenu(e, { type: "tree-item", target })}
                  searchQuery=""
                  sortField={pane.sortField}
                  sortAsc={pane.sortAsc}
                  refreshCounter={refreshCounter}
                  onError={onError}
                  onDrop={onDrop}
                  dropTargetPath={null}
                  onDragEnterPath={() => { }}
                  onDragLeavePath={() => { }}
                  folderColors={folderColors}
                  expandedPaths={[]}
                  onToggleExpand={() => { }}
                  isFocused={isFocused}
                  paneId={pane.id}
                  showThumbnails={pane.showThumbnails}
                  onScrollComplete={() => { }}
                />
              ))}
            </div>
          </div>
        )}

        <div className="min-w-fit">
          <div
            className={`flex items-center py-1 px-2 hover:bg-background-main cursor-pointer rounded text-xs group mb-1 ${pane.path === "root" ? 'text-accent-green bg-background-main/30' : 'text-muted'}`}
            onClick={() => {
              setIsThisPCOpen(!isThisPCOpen);
              onPathChange("root");
            }}
          >
            <ChevronDown size={14} className={`mr-1 transition-transform ${isThisPCOpen ? '' : '-rotate-90'}`} />
            <Monitor size={14} className="mr-2" />
            <span className="font-bold uppercase tracking-widest text-[10px]">{systemInfo.os === "windows" ? "This PC" : "Computer"}</span>
          </div>
          {isThisPCOpen && (
            <div className="relative ml-2 border-l border-muted/10">
              {drives.map((drive) => (
                <TreeItem
                  key={drive.path}
                  entry={drive}
                  depth={0}
                  parentPath="root"
                  onSelect={onSelect}
                  onPathChange={onPathChange}
                  activePath={pane.path}
                  selectedFilePaths={selectedFilePaths}
                  metadataMode={metadataMode}
                  onDragStart={() => { }}
                  onContextMenu={(e: any, target: any) => onContextMenu(e, { type: "tree-item", target })}
                  searchQuery={pane.searchQuery}
                  sortField={pane.sortField}
                  sortAsc={pane.sortAsc}
                  refreshCounter={refreshCounter}
                  onError={onError}
                  onDrop={onDrop}
                  dropTargetPath={dropTargetPath}
                  onDragEnterPath={(p: string) => setDropTargetPath(p)}
                  onDragLeavePath={() => setDropTargetPath(null)}
                  folderColors={folderColors}
                  expandedPaths={expandedPaths}
                  onToggleExpand={onToggleExpand}
                  isFocused={isFocused}
                  paneId={pane.id}
                  showThumbnails={pane.showThumbnails}
                  lastScrollPath={pane.lastScrollPath}
                  lastScrollBlock={pane.lastScrollBlock}
                  onScrollComplete={onScrollComplete}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewPane({ selectedFilePaths = [], folderColors }: { selectedFilePaths?: string[], folderColors: Record<string, string> }) {
  const [preview, setPreview] = useState<string>("");
  const [mediaUrl, setMediaUrl] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);

  useEffect(() => {
    if (!Array.isArray(selectedFilePaths) || selectedFilePaths.length !== 1) {
      setSelectedFile(null);
      return;
    }

    // Fetch file info for the selected path
    const path = selectedFilePaths[0];
    if (!path || path === "root") {
      setSelectedFile(null);
      return;
    }
    console.log("PreviewPane: fetching info for", path);
    invoke("get_file_info", { path })
      .then((info: any) => {
        console.log("PreviewPane: info received", info.name);
        setSelectedFile(info);
      })
      .catch((err) => {
        console.error("PreviewPane: info fetch error", err);
        setSelectedFile(null);
      });
  }, [selectedFilePaths]);

  useEffect(() => {
    if (!selectedFile || selectedFile.is_dir) {
      setPreview("");
      setMediaUrl("");
      return;
    }

    const ext = selectedFile.name.split(".").pop()?.toLowerCase() || "";
    const isImage = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico"].includes(ext);
    const isVideo = ["mp4", "webm", "ogg", "mov", "avi"].includes(ext);

    if (isImage || isVideo) {
      const src = convertFileSrc(selectedFile.path);
      console.log("PreviewPane: mediaUrl set to", src);
      setMediaUrl(src);
      setPreview("");
    } else {
      setMediaUrl("");
      const getPreview = async () => {
        try {
          const content: string = await invoke("read_file_preview", { path: selectedFile.path });
          setPreview(content);
        } catch {
          setPreview("Preview buffer locked or empty.");
        }
      };
      getPreview();
    }
  }, [selectedFile]);

  if (!selectedFile) return (
    <div className="h-full bg-background-main flex flex-col items-center justify-center text-muted p-8 text-center w-full">
      <div className="relative">
        <Monitor size={64} className="mb-4 opacity-10" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-accent-green/20 blur-2xl animate-pulse" />
      </div>
      <span className="text-[10px] uppercase tracking-[0.5em] font-bold mt-4 opacity-30">System Observer</span>
      <p className="text-[8px] mt-4 opacity-20 uppercase tracking-widest leading-loose">
        {(Array.isArray(selectedFilePaths) && selectedFilePaths.length > 1) ? `Batch selection: ${selectedFilePaths.length} items` : 'Waiting for telemetry...'}
      </p>
    </div>
  );

  const ext = selectedFile.name.split(".").pop()?.toLowerCase() || "";
  const isImage = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico"].includes(ext);
  return (
    <div className="h-full bg-background-main flex flex-col overflow-hidden border-l border-background-pane shadow-[inset_10px_0_30px_rgba(0,0,0,0.3)] w-full">
      <div className="p-8 bg-background-pane/30 backdrop-blur-xl shrink-0">
        <div className="flex flex-col items-center text-center w-full">
          <div className="w-20 h-20 bg-background-pane rounded-2xl flex items-center justify-center shadow-2xl mb-6 border border-muted/10 relative group">
            <div className="absolute inset-0 bg-accent-green/5 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
            {getFileIcon(selectedFile, false, 36, folderColors?.[selectedFile.path], true, false)}
          </div>
          <h2 className="text-sm font-bold text-primary truncate w-full px-4" title={selectedFile.name}>{formatFileName(selectedFile.name, selectedFile.is_dir)}</h2>
          <p className="text-[9px] text-muted uppercase tracking-[0.2em] mt-2 opacity-40">{selectedFile.is_dir ? "DIRECTORY_NODE" : "FILE_STREAM"}</p>
        </div>
      </div>
      <div className="flex-1 p-6 overflow-auto custom-scrollbar flex flex-col items-center w-full">
        <div className="space-y-4 text-[9px] font-mono mb-8 bg-background-pane/40 p-5 rounded-xl border border-muted/5 shadow-inner w-full">
          <div className="flex justify-between items-center opacity-80">
            <span className="text-muted uppercase tracking-tighter">DATA SIZE</span>
            <span className="text-accent-yellow">{formatSizeFixed(selectedFile.size)}</span>
          </div>
          <div className="flex justify-between items-center opacity-80">
            <span className="text-muted uppercase tracking-tighter">MODIFIED</span>
            <span>{formatDate(selectedFile.modified)}</span>
          </div>
          <div className="flex flex-col gap-1.5 pt-3 border-t border-muted/5 opacity-80">
            <span className="text-muted uppercase tracking-tighter">RESOURCE PATH</span>
            <span className="truncate text-accent-green text-[8px]" title={selectedFile.path}>{selectedFile.path}</span>
          </div>
        </div>

        {mediaUrl ? (
          <div className="w-full h-full min-h-[300px] flex items-center justify-center bg-background-pane/20 rounded-xl border border-background-pane overflow-hidden relative group">
            {isImage ? (
              <img
                src={mediaUrl}
                alt={selectedFile.name}
                className="max-w-full max-h-full object-contain shadow-2xl transition-transform duration-500 group-hover:scale-[1.02]"
              />
            ) : (
              <video
                src={mediaUrl}
                controls
                preload="metadata"
                className="max-w-full max-h-full shadow-2xl"
              />
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-4 opacity-20 w-full">
              <div className="h-[1px] flex-1 bg-muted/20" />
              <div className="text-[8px] uppercase font-bold tracking-[0.5em]">BUFFER RAW</div>
              <div className="h-[1px] flex-1 bg-muted/20" />
            </div>
            <pre className="text-[10px] font-mono text-muted/70 bg-background-pane/40 p-5 rounded-xl border border-background-pane min-h-[50%] leading-relaxed selection:bg-accent-green selection:text-background-main shadow-inner select-text w-full">
              {preview || (selectedFile.is_dir ? "// Directory index selected." : "// Pulling stream...")}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

// --- Main App ---



export default function App() {
  console.log("App: component executing");
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  console.log("AppContent: rendering");
  const [favorites, setFavorites] = useState<FileEntry[]>(() => {
    try {
      const saved = localStorage.getItem("velocidir_favorites");
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error("Failed to parse favorites", e);
      return [];
    }
  });
  const [folderColors, setFolderColors] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem("velocidir_folder_colors");
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      console.error("Failed to parse folder colors", e);
      return {};
    }
  });
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const activeSearchIds = useRef<Record<string, number>>({});
  const [tabs, setTabs] = useState<TabState[]>(() => {
    console.log("App: initializing tabs from localStorage");
    try {
      const saved = localStorage.getItem("velocidir_tabs");
      const parsed = saved ? JSON.parse(saved) : null;
      if (parsed && Array.isArray(parsed) && parsed.length > 0) {
        console.log("App: loaded", parsed.length, "tabs");
        // Robust repair: ensure all fields exist on every tab and pane
        return parsed.map((t: any) => ({
          ...t,
          selectedFilePaths: Array.isArray(t.selectedFilePaths) ? t.selectedFilePaths : [],
          lastSelectedFilePath: t.lastSelectedFilePath || null,
          panes: (Array.isArray(t.panes) ? t.panes : []).map((p: any) => ({
            id: p.id || `p-${Date.now()}-${Math.random()}`,
            path: p.path || "root",
            flex: typeof p.flex === 'number' ? p.flex : 33,
            type: p.type || "explorer",
            searchQuery: p.searchQuery || "",
            sortField: p.sortField || "type",
            sortAsc: p.sortAsc !== undefined ? p.sortAsc : true,
            showThumbnails: !!p.showThumbnails
          }))
        }));
      }
    } catch (e) {
      console.error("App: failed to parse tabs", e);
    }
    return [
      {
        id: "tab1",
        name: "VelociDir 1",
        selectedFilePaths: [],
        lastSelectedFilePath: null,
        panes: [
          { id: "pane1", path: "root", flex: 37.5, type: "explorer", searchQuery: "", sortField: "type", sortAsc: true, showThumbnails: false },
          { id: "pane2", path: "root", flex: 37.5, type: "explorer", searchQuery: "", sortField: "type", sortAsc: true, showThumbnails: false },
          { id: "preview", path: "", flex: 25, type: "preview", searchQuery: "", sortField: "type", sortAsc: true, showThumbnails: false }
        ]
      }
    ];
  });
  const [activeTabId, setActiveTabId] = useState(() => {
    const saved = localStorage.getItem("velocidir_active_tab_id");
    return saved || "tab1";
  });
  const [expandedPaths, setExpandedPaths] = useState<Record<string, string[]>>(() => {
    try {
      const saved = localStorage.getItem("velocidir_expanded_paths_v2");
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      console.error("Failed to parse expanded paths", e);
      return {};
    }
  });
  const [systemInfo, setSystemInfo] = useState<SystemInfo>({ os: "windows", sep: "\\" });

  useEffect(() => {
    invoke("get_system_info").then((info: any) => {
      console.log("System Info received:", info);
      setSystemInfo(info);
      SEP = info.sep;
    }).catch(err => console.error("Failed to get system info", err));
  }, []);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");
  const [focusedPaneId, setFocusedPaneId] = useState<string>("pane1");
  const [resizing, setResizing] = useState<{ tabId: string; paneIdx: number; startX: number; startFlex: number; nextFlex: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ x: 0, y: 0, visible: false, type: "pane", target: null });
  const [modal, setModal] = useState<ModalState>({ visible: false, type: "alert", title: "", message: "" });
  const containerRef = useRef<HTMLDivElement>(null);

  const showAlert = (title: string, message: string) => setModal({ visible: true, type: "alert", title, message });
  const showConfirm = (title: string, message: string, onConfirm: () => void) => setModal({ visible: true, type: "confirm", title, message, onConfirm });
  const showPrompt = (title: string, message: string, defaultValue: string, onConfirm: (val?: string) => void) => setModal({ visible: true, type: "prompt", title, message, defaultValue, onConfirm });

  const activeTab = useMemo(() => {
    const found = tabs.find(t => t.id === activeTabId);
    if (found) return found;
    if (tabs.length > 0) return tabs[0];
    // This should theoretically not happen with the initializer above
    return {
      id: "fallback",
      name: "Fallback",
      selectedFilePaths: [],
      lastSelectedFilePath: null,
      panes: []
    } as TabState;
  }, [tabs, activeTabId]);

  const addTab = () => {
    const id = `tab-${Date.now()}`;
    setTabs([...tabs, {
      id,
      name: `VelociDir ${tabs.length + 1}`,
      selectedFilePaths: [],
      lastSelectedFilePath: null,
      panes: [
        { id: `p-${Date.now()}-1`, path: "root", flex: 37.5, type: "explorer", searchQuery: "", sortField: "type", sortAsc: true, showThumbnails: false },
        { id: `p-${Date.now()}-2`, path: "root", flex: 37.5, type: "explorer", searchQuery: "", sortField: "type", sortAsc: true, showThumbnails: false },
        { id: `p-${Date.now()}-p`, path: "", flex: 25, type: "preview", searchQuery: "", sortField: "type", sortAsc: true, showThumbnails: false }
      ]
    }]);
    setActiveTabId(id);
  };

  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) return;
    const newTabs = tabs.filter(t => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id) setActiveTabId(newTabs[0].id);
  };

  const addPane = (tabId: string) => {
    setTabs(tabs.map(t => {
      if (t.id === tabId) {
        const explorers = t.panes.filter(p => p.type === "explorer");
        const preview = t.panes.find(p => p.type === "preview");
        const currentFlex = explorers.reduce((s, p) => s + p.flex, 0);
        const newCount = explorers.length + 1;
        if (newCount === 0) return t; // Safety

        const newFlexPer = currentFlex / newCount;
        const newPanes = explorers.map(p => ({ ...p, flex: newFlexPer }));
        newPanes.push({ id: `p-${Date.now()}`, path: "root", flex: newFlexPer, type: "explorer", searchQuery: "", sortField: "type", sortAsc: true, showThumbnails: false });

        return { ...t, panes: preview ? [...newPanes, preview] : newPanes };
      }
      return t;
    }));
  };

  const closePane = (tabId: string, paneId: string) => {
    setTabs(tabs.map(t => {
      if (t.id === tabId) {
        const filtered = t.panes.filter(p => p.id !== paneId);

        // Safety: ensure we always have at least one explorer pane if there were any
        const hasExplorers = t.panes.some(p => p.type === "explorer");
        const remainingExplorers = filtered.some(p => p.type === "explorer");
        if (hasExplorers && !remainingExplorers) return t;

        if (filtered.length === 0) return t; // Keep at least one pane

        // If we closed the focused pane, move focus to the first available pane
        if (focusedPaneId === paneId && filtered.length > 0) {
          setFocusedPaneId(filtered[0].id);
        }

        const totalFlex = filtered.reduce((s, p) => s + p.flex, 0);
        if (totalFlex === 0) {
          // Fallback if flex somehow got corrupted or all were 0
          const fallbackFlex = 100 / filtered.length;
          return { ...t, panes: filtered.map(p => ({ ...p, flex: fallbackFlex })) };
        }

        const factor = 100 / totalFlex;
        return { ...t, panes: filtered.map(p => ({ ...p, flex: p.flex * factor })) };
      }
      return t;
    }));
  };

  const handleContextMenu = (e: React.MouseEvent, data: any) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, visible: true, ...data });
  };

  const addToFavorites = (folder: FileEntry) => {
    if (!folder.is_dir || favorites.find(f => f.path === folder.path)) return;
    setFavorites([...favorites, folder]);
    setContextMenu({ ...contextMenu, visible: false });
  };

  const removeFromFavorites = (path: string) => {
    setFavorites(favorites.filter(f => f.path !== path));
    setContextMenu({ ...contextMenu, visible: false });
  };

  const openInNewPane = (path: string) => {
    const newPaneId = `p-${Date.now()}`;
    setTabs(prevTabs => prevTabs.map(t => {
      if (t.id === activeTabId) {
        const explorers = t.panes.filter(p => p.type === "explorer");
        const preview = t.panes.find(p => p.type === "preview");
        const currentFlex = explorers.reduce((s, p) => s + p.flex, 0);
        const newCount = explorers.length + 1;
        const newFlexPer = currentFlex / newCount;
        const newPanes = explorers.map(p => ({ ...p, flex: newFlexPer }));
        newPanes.push({ id: newPaneId, path, flex: newFlexPer, type: "explorer", searchQuery: "", sortField: "type", sortAsc: true, showThumbnails: false, lastScrollPath: path, lastScrollBlock: 'start' });

        // Auto-expand parents + the target itself so folder and children are visible/scrollable
        setExpandedPaths(prev => ({
          ...prev,
          [newPaneId]: [...getParentPaths(path), path]
        }));

        return {
          ...t,
          panes: preview ? [...newPanes, preview] : newPanes,
          selectedFilePaths: [path],
          lastSelectedFilePath: path
        };
      }
      return t;
    }));
    setFocusedPaneId(newPaneId);
    setContextMenu(prev => ({ ...prev, visible: false }));
  };

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setContextMenu({ ...contextMenu, visible: false });
    } catch (err) {
      console.error("Failed to copy path:", err);
    }
  };

  const renameItem = async (entry: FileEntry) => {
    if (!entry.path || entry.path === "root") return;
    showPrompt("Rename Item", `Enter new name for ${entry.name}:`, entry.name, async (newName) => {
      if (newName && newName !== entry.name) {
        const lastSep = entry.path.lastIndexOf(SEP);
        // If there is no separator (e.g. root-level drive but it shouldn't be renamed anyway), 
        // we'll handle it gracefully.
        if (lastSep === -1) return;
        const dir = entry.path.substring(0, lastSep);
        const newPath = `${dir}${SEP}${newName}`;
        try {
          await invoke("rename_item", { oldPath: entry.path, newPath });
          setRefreshCounter(prev => prev + 1);
        } catch (err) {
          showAlert("Error", "Rename failed: " + err);
        }
      }
    });
    setContextMenu({ ...contextMenu, visible: false });
  };

  const pasteItem = async (targetDir: string) => {
    if (!clipboard || !targetDir || targetDir === "root") return;
    try {
      for (const entry of clipboard.entries) {
        const dest = targetDir.endsWith(SEP) ? `${targetDir}${entry.name}` : `${targetDir}${SEP}${entry.name}`;
        await invoke("transfer_file", { source: entry.path, destination: dest, isMove: clipboard.action === "cut" });
      }
      if (clipboard.action === "cut") setClipboard(null);
      setRefreshCounter(prev => prev + 1);
    } catch (err) {
      showAlert("Error", "Paste failed: " + err);
    }
    setContextMenu({ ...contextMenu, visible: false });
  };

  const deleteItem = async (entry: FileEntry) => {
    if (!entry.path || entry.path === "root") return;
    showConfirm("Delete Item", `Are you sure you want to move ${entry.name} to the Recycle Bin?`, async () => {
      try {
        await invoke("delete_item", { path: entry.path });
        setRefreshCounter(prev => prev + 1);
      } catch (err) {
        showAlert("Error", "Delete failed: " + err);
      }
    });
    setContextMenu({ ...contextMenu, visible: false });
  };

  const openItem = async (path: string) => {
    try {
      await invoke("open_item", { path });
    } catch (err) {
      showAlert("Security or Access Error", "Could not open item: " + err);
    }
    setContextMenu({ ...contextMenu, visible: false });
  };

  const runAsAdmin = async (path: string) => {
    try {
      await invoke("run_as_admin", { path });
    } catch (err) {
      showAlert("Privilege Error", "Admin execution failed: " + err);
    }
    setContextMenu({ ...contextMenu, visible: false });
  };

  const openTerminalAt = async (path: string) => {
    if (!path || path === "root") return;
    try {
      await invoke("open_terminal", { path });
    } catch (err) {
      showAlert("Terminal Error", "Could not open terminal: " + err);
    }
    setContextMenu({ ...contextMenu, visible: false });
  };

  const createNewItem = async (parentPath: string, is_dir: boolean) => {
    if (!parentPath || parentPath === "root") return;
    const typeLabel = is_dir ? "Folder" : "File";
    showPrompt(`New ${typeLabel}`, `Enter name for new ${typeLabel.toLowerCase()}:`, `New ${typeLabel}`, async (name) => {
      if (name) {
        const fullPath = parentPath.endsWith(SEP) ? `${parentPath}${name}` : `${parentPath}${SEP}${name}`;
        try {
          await invoke("create_item", { path: fullPath, isDir: is_dir });
          setRefreshCounter(prev => prev + 1);
        } catch (err) {
          showAlert("Error", `Failed to create ${typeLabel.toLowerCase()}: ` + err);
        }
      }
    });
    setContextMenu({ ...contextMenu, visible: false });
  };

  const handleDeepSearch = async (paneId: string, path: string, query: string) => {
    if (!path || path === "root" || !query.trim()) return;

    // Track unique search ID to allow cancellation/ignoring stale results
    const searchId = (activeSearchIds.current[paneId] || 0) + 1;
    activeSearchIds.current[paneId] = searchId;

    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, panes: t.panes.map(pp => pp.id === paneId ? { ...pp, isSearching: true, searchResults: [] } : pp) } : t));

    try {
      const results: FileEntry[] = await invoke("search_files", { path, query });

      // Only update state if this is still the active search
      if (activeSearchIds.current[paneId] === searchId) {
        setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, panes: t.panes.map(pp => pp.id === paneId ? { ...pp, searchResults: results, isSearching: false } : pp) } : t));
      }
    } catch (err) {
      console.error("Deep search failed:", err);
      if (activeSearchIds.current[paneId] === searchId) {
        setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, panes: t.panes.map(pp => pp.id === paneId ? { ...pp, isSearching: false } : pp) } : t));
        showAlert("Search Error", String(err));
      }
    }
  };

  // Autosave
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem("velocidir_favorites", JSON.stringify(favorites));
        localStorage.setItem("velocidir_folder_colors", JSON.stringify(folderColors));

        const sanitizedTabs = sanitizeTabs(tabs);
        localStorage.setItem("velocidir_tabs", JSON.stringify(sanitizedTabs));

        localStorage.setItem("velocidir_active_tab_id", activeTabId);
        localStorage.setItem("velocidir_expanded_paths_v2", JSON.stringify(expandedPaths));
        console.log("State autosaved to localStorage (sanitized)");
      } catch (e) {
        console.error("Autosave failed:", e);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [favorites, folderColors, tabs, activeTabId, expandedPaths]);

  const togglePathExpansion = (paneId: string, path: string, expanded: boolean) => {
    setTabs(prev => prev.map(t => ({
      ...t,
      panes: t.panes.map(p => p.id === paneId ? { ...p, lastScrollPath: path, lastScrollBlock: 'nearest' } : p)
    })));

    setExpandedPaths(prev => {
      const panePaths = prev[paneId] ? [...prev[paneId]] : [];
      const next = { ...prev };
      if (expanded) {
        if (!panePaths.includes(path)) panePaths.push(path);
        next[paneId] = panePaths;
      } else {
        // Recursive collapse: remove this path and all its descendants
        next[paneId] = panePaths.filter(p => p !== path && !p.startsWith(path + SEP));
      }
      return next;
    });
  };

  const handleScrollComplete = (paneId: string) => {
    setTabs(prev => prev.map(t => ({
      ...t,
      panes: t.panes.map(p => p.id === paneId ? { ...p, lastScrollPath: "" } : p)
    })));
  };

  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(prev => ({ ...prev, visible: false }));
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, []);

  // Hierarchy-aware keyboard navigation
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA" || modal.visible) return;

      const activePane = activeTab.panes.find((p: PaneState) => p.id === focusedPaneId);
      if (!activePane || activePane.type !== "explorer") return;

      const selected = activeTab.selectedFilePaths[0];

      // Ctrl+C
      if (e.ctrlKey && e.key.toLowerCase() === 'c' && selected) {
        const entries = activeTab.selectedFilePaths.map((p: string) => ({ path: p, name: p.split(SEP).pop() || '', is_dir: false, size: 0, modified: 0 }));
        setClipboard({ entries, action: "copy" });
        return;
      }
      // Ctrl+X
      if (e.ctrlKey && e.key.toLowerCase() === 'x' && selected) {
        const entries = activeTab.selectedFilePaths.map((p: string) => ({ path: p, name: p.split(SEP).pop() || '', is_dir: false, size: 0, modified: 0 }));
        setClipboard({ entries, action: "cut" });
        return;
      }
      // Ctrl+V
      if (e.ctrlKey && e.key.toLowerCase() === 'v' && clipboard) {
        pasteItem(activePane.path);
        return;
      }
      // Delete
      if (e.key === 'Delete' && selected) {
        // Bulk delete
        showConfirm("Delete Items", `Are you sure you want to delete ${activeTab.selectedFilePaths.length} items?`, async () => {
          for (const path of activeTab.selectedFilePaths) {
            try {
              await invoke("delete_item", { path });
            } catch (err) {
              console.error("Bulk delete failed for:", path, err);
            }
          }
          setRefreshCounter(prev => prev + 1);
        });
        return;
      }

      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();

      const paneEl = document.querySelector(`[data-pane-id="${focusedPaneId}"]`);
      if (!paneEl) return;

      const allItems = Array.from(paneEl.querySelectorAll('[data-path]')) as HTMLElement[];

      // If nothing is selected, pick the first visible item
      if (!selected) {
        if (allItems.length > 0) allItems[0].click();
        return;
      }

      const currentItem = allItems.find(el => el.getAttribute('data-path') === selected);
      if (!currentItem) return;

      const currentDepth = currentItem.getAttribute('data-depth') ?? '0';
      const currentParent = currentItem.getAttribute('data-parent') ?? 'root';

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // Navigate only among siblings (same depth + same parent)
        const siblings = allItems.filter(el =>
          el.getAttribute('data-depth') === currentDepth &&
          el.getAttribute('data-parent') === currentParent
        );
        const sibIdx = siblings.findIndex(el => el.getAttribute('data-path') === selected);
        const next = e.key === 'ArrowDown' ? siblings[sibIdx + 1] : siblings[sibIdx - 1];
        if (next) {
          // Use __selectOnly so landing on a directory doesn't expand it
          const selectFn = (next as any).__selectOnly;
          if (selectFn) selectFn();
          else next.click();
        }

      } else if (e.key === 'ArrowLeft') {
        // Go to parent item
        if (currentParent && currentParent !== 'root') {
          const parentItem = allItems.find(el => el.getAttribute('data-path') === currentParent);
          if (parentItem) {
            const selectFn = (parentItem as any).__selectOnly;
            if (selectFn) selectFn();
            else parentItem.click();
          }
        }

      } else if (e.key === 'ArrowRight') {
        // In this context, we don't easily know if it's a dir without the entry
        // but the item usually has an expander if it is.
        currentItem.click();

        // Wait for React to render children, then select first child
        setTimeout(() => {
          const updatedItems = Array.from(
            document.querySelectorAll(`[data-pane-id="${focusedPaneId}"] [data-path]`)
          ) as HTMLElement[];
          const firstChild = updatedItems.find(
            el => el.getAttribute('data-parent') === selected
          );
          if (firstChild) firstChild.click();
        }, 120);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, focusedPaneId, clipboard, modal.visible, refreshCounter]);

  // Resizing logic
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizing || !containerRef.current) return;
      const w = containerRef.current.offsetWidth;
      const df = ((e.clientX - resizing.startX) / w) * 100;
      setTabs(prev => prev.map(t => {
        if (t.id === resizing.tabId) {
          const ps = [...t.panes];
          const nf = Math.max(5, resizing.startFlex + df);
          const diff = nf - resizing.startFlex;
          const nxf = Math.max(5, resizing.nextFlex - diff);
          const fd = resizing.nextFlex - nxf;
          ps[resizing.paneIdx] = { ...ps[resizing.paneIdx], flex: resizing.startFlex + fd };
          ps[resizing.paneIdx + 1] = { ...ps[resizing.paneIdx + 1], flex: nxf };
          return { ...t, panes: ps };
        }
        return t;
      }));
    };
    const onMouseUp = () => setResizing(null);
    if (resizing) {
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [resizing]);

  try {
    return (
      <div className="flex h-full w-full bg-background-main text-primary select-none overflow-hidden antialiased">
        {/* Favorites Sidebar */}
        <div className="w-[180px] shrink-0 bg-background-pane flex flex-col border-r border-background-main z-40">
          <div className="p-4 flex items-center gap-2 border-b border-background-main bg-background-main/30">
            <Star size={14} className="text-accent-yellow" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Favorites</span>
          </div>
          <div
            className="flex-1 overflow-y-auto custom-scrollbar p-2 py-4 space-y-1"
            onDragEnter={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
            onDrop={(e) => {
              e.preventDefault();
              try {
                const fileData = JSON.parse(e.dataTransfer.getData("application/velocidir-item"));
                if (fileData.is_dir) addToFavorites(fileData);
              } catch (err) { }
            }}
          >
            {favorites.length === 0 && (
              <div className="p-4 text-[9px] text-muted opacity-30 text-center uppercase tracking-widest leading-loose">
                Right click or drag<br />folders here
              </div>
            )}
            {favorites.map(fav => (
              <div
                key={fav.path}
                draggable
                onDragStart={(e) => {
                  const data = JSON.stringify(fav);
                  e.dataTransfer.setData("application/velocidir-item", data);
                  e.dataTransfer.setData("text/plain", fav.path);
                  e.dataTransfer.effectAllowed = "copyMove";
                }}
                onContextMenu={(e) => handleContextMenu(e, { type: "favorite", target: fav })}
                onClick={() => openInNewPane(fav.path)}
                className="flex items-center gap-2 p-2 px-3 hover:bg-background-main rounded cursor-pointer group transition-colors select-none"
              >
                <Folder size={14} className="text-muted group-hover:text-accent-yellow transition-colors" style={folderColors[fav.path] ? { color: folderColors[fav.path] } : {}} />
                <span className="text-[10px] uppercase font-bold tracking-tighter truncate opacity-70 group-hover:opacity-100">{formatFileName(fav.name, fav.is_dir)}</span>
              </div>
            ))}
          </div>
          <div className="p-4 text-center opacity-10 scale-75 grayscale sepia">
            <img src="/velociDir.svg" alt="" className="w-12 h-12 mx-auto" />
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Global Tabs */}
          <div className="flex bg-background-pane/40 border-b border-background-main items-center p-1 gap-1 h-10 shrink-0">
            {tabs.map(tab => (
              <div
                key={tab.id}
                onClick={() => {
                  if (activeTabId === tab.id) {
                    setRenamingTabId(tab.id);
                    setRenamingName(tab.name);
                  } else {
                    setActiveTabId(tab.id);
                    setRenamingTabId(null);
                  }
                }}
                className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest cursor-pointer transition-all flex items-center gap-3 border-r border-background-main h-full ${activeTabId === tab.id ? 'bg-background-pane text-accent-green' : 'text-muted opacity-40 hover:opacity-80'}`}
              >
                {renamingTabId === tab.id ? (
                  <input
                    autoFocus
                    className="bg-background-main border-none outline-none text-accent-green w-24 p-0 h-full uppercase font-bold text-[10px] tracking-widest"
                    value={renamingName}
                    onChange={(e) => setRenamingName(e.target.value)}
                    onBlur={() => {
                      if (renamingName.trim()) {
                        setTabs(tabs.map(t => t.id === tab.id ? { ...t, name: renamingName.trim() } : t));
                      }
                      setRenamingTabId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (renamingName.trim()) {
                          setTabs(tabs.map(t => t.id === tab.id ? { ...t, name: renamingName.trim() } : t));
                        }
                        setRenamingTabId(null);
                      } else if (e.key === "Escape") {
                        setRenamingTabId(null);
                      }
                    }}
                  />
                ) : (
                  <span>{tab.name}</span>
                )}
                <X size={10} className="hover:text-accent-red" onClick={(e) => { e.stopPropagation(); closeTab(tab.id, e); }} />
              </div>
            ))}
            <button onClick={addTab} className="p-2 text-muted hover:text-accent-green transition-colors">
              <Plus size={14} />
            </button>
          </div>

          <div ref={containerRef} className="flex flex-1 overflow-hidden relative">
            {activeTab.panes.map((pane, idx) => (
              <div
                key={pane.id}
                className="flex h-full relative"
                style={{ flex: `${pane.flex} 0 0%`, minWidth: '0' }}
              >
                {pane.type === "explorer" ? (
                  <ExplorerPane
                    pane={pane}
                    selectedFilePaths={activeTab.selectedFilePaths}
                    onSelect={(f: FileEntry, ctrl: boolean, shift: boolean) => {
                      setTabs(tabs.map(t => {
                        if (t.id === activeTabId) {
                          let newSelection = [...t.selectedFilePaths];

                          if (shift && t.lastSelectedFilePath) {
                            const paneEl = document.querySelector(`[data-pane-id="${pane.id}"]`);
                            if (paneEl) {
                              const allPathsVisible = Array.from(paneEl.querySelectorAll('[data-path]')).map((el: Element) => el.getAttribute('data-path')!);
                              const startIdx = allPathsVisible.indexOf(t.lastSelectedFilePath);
                              const endIdx = allPathsVisible.indexOf(f.path);

                              if (startIdx !== -1 && endIdx !== -1) {
                                const rangePaths = allPathsVisible.slice(Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1);
                                newSelection = [...new Set([...newSelection, ...rangePaths])];
                              }
                            }
                          } else if (ctrl) {
                            if (newSelection.includes(f.path)) {
                              newSelection = newSelection.filter(p => p !== f.path);
                            } else {
                              newSelection.push(f.path);
                            }
                          } else {
                            newSelection = [f.path];
                          }

                          return {
                            ...t,
                            selectedFilePaths: newSelection,
                            lastSelectedFilePath: f.path
                          };
                        }
                        return t;
                      }));
                    }}
                    onPathChange={(p: string) => setTabs(tabs.map(t => t.id === activeTabId ? { ...t, panes: t.panes.map(pp => pp.id === pane.id ? { ...pp, path: p } : pp) } : t))}
                    onClose={() => closePane(activeTabId, pane.id)}
                    onAdd={() => addPane(activeTabId)}
                    onContextMenu={handleContextMenu}
                    onScrollComplete={handleScrollComplete}
                    onSearch={(query: string) => {
                      // Increment search ID to cancel any pending deep searches for this pane
                      const nextId = (activeSearchIds.current[pane.id] || 0) + 1;
                      activeSearchIds.current[pane.id] = nextId;

                      setTabs(prev => prev.map(t => t.id === activeTabId ? {
                        ...t,
                        panes: t.panes.map(pp => pp.id === pane.id ? {
                          ...pp,
                          searchQuery: query,
                          searchResults: (query.length < (pp.searchQuery?.length || 0) || !query) ? [] : pp.searchResults || []
                        } : pp)
                      } : t));
                    }}
                    onSort={(field: SortField) => setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, panes: t.panes.map(pp => pp.id === pane.id ? { ...pp, sortField: field, sortAsc: pp.sortField === field ? !pp.sortAsc : true } : pp) } : t))}
                    onToggleThumbnails={() => setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, panes: t.panes.map(pp => pp.id === pane.id ? { ...pp, showThumbnails: !pp.showThumbnails } : pp) } : t))}
                    refreshCounter={refreshCounter}
                    onError={showAlert}
                    onDeepSearch={handleDeepSearch}
                    onDrop={(f: FileEntry, p: string, isMove: boolean = false) => {
                      if (!p || p === "root") return;
                      if (f.path === p || p.startsWith(f.path + SEP)) return;
                      const destination = p.endsWith(SEP) ? `${p}${f.name}` : `${p}${SEP}${f.name}`;
                      invoke("transfer_file", { source: f.path, destination, isMove })
                        .then(() => setRefreshCounter(prev => prev + 1))
                        .catch(err => showAlert("Transfer Error", String(err)));
                    }}
                    onFocus={setFocusedPaneId}
                    isFocused={focusedPaneId === pane.id}
                    folderColors={folderColors}
                    expandedPaths={expandedPaths[pane.id] || []}
                    onToggleExpand={togglePathExpansion}
                    systemInfo={systemInfo}
                  />
                ) : (
                  <PreviewPane selectedFilePaths={activeTab.selectedFilePaths} folderColors={folderColors} />
                )}

                {idx < activeTab.panes.length - 1 && (
                  <div
                    onMouseDown={(e) => setResizing({ tabId: activeTabId, paneIdx: idx, startX: e.clientX, startFlex: activeTab.panes[idx].flex, nextFlex: activeTab.panes[idx + 1].flex })}
                    className="absolute right-[-6px] top-0 bottom-0 w-3 cursor-col-resize z-40 group"
                  >
                    <div className="h-full w-[2px] bg-transparent group-hover:bg-accent-yellow/50 transition-colors mx-auto" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>        <ContextMenu state={contextMenu}>
          {contextMenu.type === "tree-item" && contextMenu.target && (
            <>
              {contextMenu.target.is_dir && (
                <div className="flex gap-1.5 p-2 pb-3 border-b border-background-main mb-1">
                  {[
                    { name: 'Purple', color: '#B19CD9' },
                    { name: 'Blue', color: '#AEC6CF' },
                    { name: 'Red', color: '#FF6961' },
                    { name: 'Yellow', color: '#FDFD96' },
                    { name: 'Pink', color: '#FFB7CE' },
                    { name: 'Default', color: '' }
                  ].map(c => (
                    <button
                      key={c.name}
                      onClick={() => {
                        if (c.color) {
                          setFolderColors({ ...folderColors, [contextMenu.target.path]: c.color });
                        } else {
                          const newColors = { ...folderColors };
                          delete newColors[contextMenu.target.path];
                          setFolderColors(newColors);
                        }
                        setContextMenu({ ...contextMenu, visible: false });
                      }}
                      className="w-4 h-4 rounded-full border border-white/10 hover:scale-125 transition-transform"
                      title={c.name}
                      style={{ backgroundColor: c.color || '#A68A61' }}
                    />
                  ))}
                </div>
              )}
              {contextMenu.target.is_dir && (
                <>
                  <div
                    onClick={() => createNewItem(contextMenu.target.path, true)}
                    className="flex items-center gap-2 p-2 hover:bg-background-main rounded cursor-pointer text-[10px] font-bold uppercase tracking-tight text-accent-yellow"
                  >
                    <Plus size={12} /> New Folder
                  </div>
                  <div
                    onClick={() => createNewItem(contextMenu.target.path, false)}
                    className="flex items-center gap-2 p-2 hover:bg-background-main rounded cursor-pointer text-[10px] font-bold uppercase tracking-tight text-accent-yellow"
                  >
                    <Plus size={12} /> New File
                  </div>
                  <div className="h-[1px] bg-muted/10 mx-1 my-1" />
                </>
              )}
              <div
                onClick={() => openItem(contextMenu.target.path)}
                className="flex items-center gap-2 p-2 hover:bg-background-main rounded cursor-pointer text-[10px] font-bold uppercase tracking-tight text-accent-green"
              >
                <ExternalLink size={12} /> Open / Run
              </div>
              <div
                onClick={() => runAsAdmin(contextMenu.target.path)}
                className="flex items-center gap-2 p-2 hover:bg-background-main rounded cursor-pointer text-[10px] font-bold uppercase tracking-tight text-accent-red"
              >
                <ShieldAlert size={12} /> Run as Admin
              </div>
              <div className="h-[1px] bg-muted/10 mx-1 my-1" />
              <div
                onClick={() => { setClipboard({ entries: activeTab.selectedFilePaths.length > 0 ? activeTab.selectedFilePaths.map((p: string) => ({ path: p, name: p.split(SEP).pop() || '', is_dir: false, size: 0, modified: 0 })) : [contextMenu.target], action: "copy" }); setContextMenu({ ...contextMenu, visible: false }); }}
                className="flex items-center gap-2 p-2 hover:bg-background-main rounded cursor-pointer text-[10px] font-bold uppercase tracking-tight"
              >
                <Copy size={12} /> Copy
              </div>
              <div
                onClick={() => { setClipboard({ entries: activeTab.selectedFilePaths.length > 0 ? activeTab.selectedFilePaths.map((p: string) => ({ path: p, name: p.split(SEP).pop() || '', is_dir: false, size: 0, modified: 0 })) : [contextMenu.target], action: "cut" }); setContextMenu({ ...contextMenu, visible: false }); }}
                className="flex items-center gap-2 p-2 hover:bg-background-main rounded cursor-pointer text-[10px] font-bold uppercase tracking-tight opacity-70"
              >
                <Copy size={12} /> Cut
              </div>
              <div
                onClick={() => copyPath(contextMenu.target.path)}
                className="flex items-center gap-2 p-2 hover:bg-background-main rounded cursor-pointer text-[10px] font-bold uppercase tracking-tight opacity-70"
              >
                <Link2 size={12} /> Copy Path
              </div>
              <div
                onClick={() => renameItem(contextMenu.target)}
                className="flex items-center gap-2 p-2 hover:bg-background-main rounded cursor-pointer text-[10px] font-bold uppercase tracking-tight"
              >
                <Type size={12} /> Rename
              </div>
              <div
                onClick={() => deleteItem(contextMenu.target)}
                className="flex items-center gap-2 p-2 hover:bg-background-main rounded cursor-pointer text-[10px] font-bold uppercase tracking-tight text-accent-red"
              >
                <Trash2 size={12} /> Delete
              </div>
              {contextMenu.target.is_dir && (
                <div
                  onClick={() => addToFavorites(contextMenu.target)}
                  className="flex items-center gap-2 p-2 hover:bg-background-main rounded cursor-pointer text-[10px] font-bold uppercase tracking-tight text-accent-yellow"
                >
                  <Star size={12} /> Pin to Favorites
                </div>
              )}
            </>
          )}

          {contextMenu.type === "pane" && (
            <>
              <div
                onClick={() => contextMenu.path && createNewItem(contextMenu.path, true)}
                className={`flex items-center gap-2 p-2 hover:bg-background-main rounded cursor-pointer text-[10px] font-bold uppercase tracking-tight text-accent-yellow ${contextMenu.path === "root" ? 'opacity-20 pointer-events-none' : ''}`}
              >
                <Plus size={12} /> New Folder
              </div>
              <div
                onClick={() => contextMenu.path && createNewItem(contextMenu.path, false)}
                className={`flex items-center gap-2 p-2 hover:bg-background-main rounded cursor-pointer text-[10px] font-bold uppercase tracking-tight text-accent-yellow ${contextMenu.path === "root" ? 'opacity-20 pointer-events-none' : ''}`}
              >
                <Plus size={12} /> New File
              </div>
              <div className="h-[1px] bg-muted/10 mx-1 my-1" />
              <div
                onClick={() => contextMenu.path && pasteItem(contextMenu.path)}
                className={`flex items-center gap-2 p-2 hover:bg-background-main rounded cursor-pointer text-[10px] font-bold uppercase tracking-tight ${!clipboard || contextMenu.path === "root" ? 'opacity-20 pointer-events-none' : ''}`}
              >
                <Clipboard size={12} /> Paste {clipboard ? `(${clipboard.entries.length} items)` : ''}
              </div>
              <div className="h-[1px] bg-muted/10 mx-1 my-1" />
              <div
                onClick={() => contextMenu.path && openTerminalAt(contextMenu.path)}
                className={`flex items-center gap-2 p-2 hover:bg-background-main rounded cursor-pointer text-[10px] font-bold uppercase tracking-tight ${contextMenu.path === "root" ? 'opacity-20 pointer-events-none' : 'opacity-70'}`}
              >
                <Terminal size={12} /> Terminal Here
              </div>
            </>
          )}

          {contextMenu.type === "favorite" && contextMenu.target && (
            <>
              <div
                onClick={() => openInNewPane(contextMenu.target.path)}
                className="flex items-center gap-2 p-2 hover:bg-background-main rounded cursor-pointer text-[10px] font-bold uppercase tracking-tight"
              >
                <ExternalLink size={12} className="text-accent-green" /> Open in new pane
              </div>
              <div
                onClick={() => removeFromFavorites(contextMenu.target.path)}
                className="flex items-center gap-2 p-2 hover:bg-background-main rounded cursor-pointer text-[10px] font-bold uppercase tracking-tight text-accent-red"
              >
                <Trash2 size={12} /> Unpin
              </div>
            </>
          )}
        </ContextMenu>
        <Modal state={modal} onClose={() => setModal({ ...modal, visible: false })} />
      </div>
    );
  } catch (error) {
    console.error("AppContent: catch block caught", error);
    throw error; // Let ErrorBoundary handle it
  }
}
