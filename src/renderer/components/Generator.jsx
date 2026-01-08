import React, { useState, useRef, useEffect, memo } from 'react';
import { Type, Image as ImageIcon, Play, Upload, FolderOpen, Save, Layers, Clock, Monitor, ChevronRight, Volume2, VolumeX, AlertCircle, CheckCircle2, X } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
    return twMerge(clsx(inputs));
}

// --- ISOLATED TIMER COMPONENT ---
// This component handles its own updates (60fps) so the parent list doesn't re-render.
const DurationTimer = memo(({ start, end }) => {
    const [duration, setDuration] = useState('0.00');
    const requestRef = useRef();

    useEffect(() => {
        if (!start) return;

        // If finished, just set static value
        if (end) {
            const d = Math.max(0, end - start);
            setDuration((d / 1000).toFixed(2));
            return;
        }

        // If running, animate
        const animate = () => {
            const d = Math.max(0, Date.now() - start);
            setDuration((d / 1000).toFixed(2));
            requestRef.current = requestAnimationFrame(animate);
        };
        requestRef.current = requestAnimationFrame(animate);

        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, [start, end]);

    return (
        <div className="font-mono text-[9px] text-slate-500 font-medium bg-slate-950/30 px-1.5 py-0.5 rounded border border-white/5 whitespace-nowrap">
            {duration}s
        </div>
    );
});

// --- TOGGLE COMPONENT ---
function Toggle({ label, options, value, onChange }) {
    return (
        <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1">{label}</label>
            <div className="flex bg-slate-950/50 rounded-lg p-0.5 border border-white/5">
                {options.map((opt) => (
                    <button
                        key={opt.value}
                        onClick={() => onChange(opt.value)}
                        className={cn(
                            "flex-1 py-1.5 rounded-md text-[10px] font-medium transition-all flex items-center justify-center gap-1.5",
                            value === opt.value
                                ? "bg-slate-800 text-slate-200 shadow-sm border border-slate-700"
                                : "text-slate-500 hover:text-slate-300 hover:bg-slate-900/50"
                        )}
                    >
                        {opt.icon}
                        <span>{opt.label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

// --- THUMBNAIL GENERATION UTILS ---
const generateThumbnail = async (path) => {
    return new Promise((resolve) => {
        const img = new Image();
        // Use file protocol
        img.src = `file://${path.replace(/\\/g, '/')}`;
        img.onload = () => {
            const size = 64; // Thumbnail size (sufficient for w-10 h-10 which is 40px)
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // Calculate scale to fill (object-cover)
            // We want the smaller dimension to match 'size', then crop the rest
            const scale = Math.max(size / img.width, size / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            const x = (size - w) / 2;
            const y = (size - h) / 2;

            canvas.width = size;
            canvas.height = size;

            ctx.drawImage(img, x, y, w, h);

            // Compress to JPEG 50% quality
            resolve(canvas.toDataURL('image/jpeg', 0.5));
        };
        img.onerror = () => {
            console.warn('Failed to load image for thumbnail:', path);
            resolve(null);
        };
    });
};

// Queue to process thumbnails one by one to avoid OOM with 4K images
const thumbnailQueue = {
    queue: [],
    processing: false,
    add(path, callback) {
        // Check if already cached? (Could add caching later if needed)
        this.queue.push({ path, callback });
        this.run();
    },
    async run() {
        if (this.processing) return;
        if (this.queue.length === 0) return;

        this.processing = true;

        while (this.queue.length > 0) {
            const { path, callback } = this.queue.shift();
            try {
                // Yield to UI thread before heavy lifting
                await new Promise(r => setTimeout(r, 10));
                const thumb = await generateThumbnail(path);
                callback(thumb);
            } catch (e) {
                console.error('Thumbnail generation error:', e);
                callback(null);
            }
        }

        this.processing = false;
    }
};

// --- LIST ITEMS (MEMOIZED) ---
const ImageListItem = memo(({ img, index, timer, onRemove, onPromptChange }) => {
    const [thumbnail, setThumbnail] = useState(null);

    useEffect(() => {
        let active = true;
        // Reset thumbnail when path changes (important for reordering/recycling)
        setThumbnail(null);

        thumbnailQueue.add(img.path, (res) => {
            if (active) setThumbnail(res);
        });

        return () => { active = false; };
    }, [img.path]);

    return (
        <div className={cn(
            "flex items-center gap-3 p-2 rounded-lg border transition-all text-xs group",
            img.status === 'success' ? "bg-emerald-950/10 border-emerald-900/30 hover:border-emerald-500/30" :
                img.status === 'error' ? "bg-red-950/10 border-red-900/30 hover:border-red-500/30" :
                    img.status === 'processing' ? "bg-indigo-950/10 border-indigo-900/30" :
                        img.status === 'pending' ? "bg-blue-950/10 border-blue-900/30 animate-pulse" :
                            "bg-slate-900/20 border-white/5 hover:bg-slate-900/40 hover:border-white/10"
        )}>
            {/* Status Indicator / Index */}
            <div className="w-5 flex justify-center shrink-0">
                {img.status === 'success' ? <CheckCircle2 size={14} className="text-emerald-500/80" /> :
                    img.status === 'error' ? <AlertCircle size={14} className="text-red-500/80" /> :
                        <span className="text-[10px] font-mono text-slate-600 font-bold">{index + 1}</span>}
            </div>

            {/* Thumbnail */}
            <div className="w-10 h-10 rounded bg-slate-900 flex items-center justify-center shrink-0 overflow-hidden border border-white/5 relative">
                {thumbnail ? (
                    <img
                        src={thumbnail}
                        alt={img.name}
                        className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                    />
                ) : (
                    <div className="animate-pulse bg-slate-800 w-full h-full" />
                )}

                <div className="absolute inset-0 hidden items-center justify-center bg-slate-900 text-slate-600">
                    <ImageIcon size={14} />
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 flex flex-col gap-1">
                <div className="text-slate-300 break-words font-medium leading-tight">{img.name}</div>

                {/* Custom Prompt Input */}
                {onPromptChange && (
                    <input
                        type="text"
                        placeholder="Custom prompt..."
                        className="w-full bg-slate-950/30 border border-white/5 rounded px-2 py-0.5 text-[10px] text-slate-400 focus:border-blue-500/50 focus:text-slate-200 focus:outline-none transition-colors"
                        value={img.customPrompt || ''}
                        onChange={(e) => onPromptChange(index, e.target.value)}
                    />
                )}

                {/* Status Text for Processing */}
                {img.status === 'processing' && (
                    <span className="text-indigo-400 text-[9px] font-bold animate-pulse">
                        Resizing & Enhancing...
                    </span>
                )}
                {img.status === 'waiting' && (
                    <span className="text-amber-500 text-[9px] font-bold animate-pulse">
                        Waiting for Token...
                    </span>
                )}
            </div>

            {/* Timer & Delete */}
            <div className="flex flex-col items-end gap-1.5 pl-2 border-l border-white/5">
                {(timer?.start || img.status === 'success') && (
                    <DurationTimer start={timer?.start} end={timer?.end} />
                )}
                {onRemove && (
                    <button
                        onClick={() => onRemove(index)}
                        className="text-slate-600 hover:text-red-400 transition-colors p-0.5"
                    >
                        <X size={12} />
                    </button>
                )}
            </div>
        </div>
    );
});

const TextListItem = memo(({ text, index, status, timer }) => {
    return (
        <div className={cn(
            "flex items-center gap-3 p-2 rounded-lg border transition-all text-xs",
            status === 'success' ? "bg-emerald-950/10 border-emerald-900/30" :
                status === 'error' ? "bg-red-950/10 border-red-900/30" :
                    status === 'processing' ? "bg-indigo-950/10 border-indigo-900/30" :
                        status === 'pending' ? "bg-blue-950/10 border-blue-900/30 animate-pulse" :
                            "bg-slate-900/20 border-white/5"
        )}>
            <div className="w-5 flex justify-center shrink-0">
                {status === 'success' ? <CheckCircle2 size={14} className="text-emerald-500/80" /> :
                    status === 'error' ? <AlertCircle size={14} className="text-red-500/80" /> :
                        <span className="text-[10px] font-mono text-slate-600 font-bold">{index + 1}</span>}
            </div>

            <div className="flex-1 min-w-0">
                <div className="text-slate-300 break-words whitespace-pre-wrap font-medium leading-relaxed opacity-90" title={text}>
                    {text}
                </div>
                {status === 'processing' && (
                    <div className="mt-1 text-indigo-400 text-[9px] font-bold animate-pulse">
                        Resizing & Enhancing...
                    </div>
                )}
                {status === 'waiting' && (
                    <div className="mt-1 text-amber-500 text-[9px] font-bold animate-pulse">
                        Waiting for Token...
                    </div>
                )}
            </div>

            <div className="pl-2 border-l border-white/5">
                {(timer?.start || status === 'success') && (
                    <DurationTimer start={timer?.start} end={timer?.end} />
                )}
            </div>
        </div>
    );
});


// --- LOGS PANEL COMPONENT (ISOLATED) ---
const LogsPanel = memo(() => {
    const [logs, setLogs] = useState([]);
    const logsEndRef = useRef(null);

    useEffect(() => {
        if (window.api) {
            const handleLog = (msg) => {
                setLogs(prev => [...prev.slice(-99), { message: msg, time: new Date().toLocaleTimeString() }]);
            };
            window.api.receive('log-update', handleLog);

            // Cleanup not trivial with current 'receive' implementation usually adding listeners
            // but for this app structure it's fine as LogsPanel is always mounted when in Generator tab
        }
    }, []);

    // Auto-scroll logs
    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    return (
        <div className="bg-slate-950 border-t border-white/10 h-[140px] flex flex-col shrink-0">
            <div className="px-3 py-1.5 flex items-center gap-2 border-b border-white/5 bg-slate-900/20">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">System Logs</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 font-mono text-[9px] space-y-0.5 custom-scrollbar">
                {logs.length === 0 && <div className="text-slate-700 italic px-2">Waiting for activity...</div>}
                {logs.map((log, i) => (
                    <div key={i} className="text-slate-400 border-l-2 border-transparent hover:border-white/10 pl-2 py-0.5 hover:bg-white/5 transition-colors">
                        <span className="text-slate-600 mr-2">[{log.time}]</span>
                        <span className={cn(
                            log.message.includes('Error') ? "text-amber-400" :
                                log.message.includes('Success') ? "text-emerald-400" : "text-slate-300"
                        )}>{log.message}</span>
                    </div>
                ))}
                <div ref={logsEndRef} />
            </div>
        </div>
    );
});

export default function Generator({ mode, isHeadless }) {
    const [prompts, setPrompts] = useState('');
    const [images, setImages] = useState([]);
    const [itemStatuses, setItemStatuses] = useState({}); // { [index]: 'pending' | 'success' | 'error' | 'processing' }
    const [itemTimers, setItemTimers] = useState({}); // { [index]: { start: number, end: number | null } }

    // Removed 'now' state to prevent global re-renders

    const [duration, setDuration] = useState('5s');
    const [aspectRatio, setAspectRatio] = useState('16:9');
    const [muteAudio, setMuteAudio] = useState(false);
    const [concurrency, setConcurrency] = useState(1);
    const [isRunning, setIsRunning] = useState(false);
    const [activeAccount, setActiveAccount] = useState({ email: '-', quota: '-' });
    const [savePath, setSavePath] = useState(localStorage.getItem('lastSavePath') || '');
    const [promptFile, setPromptFile] = useState('');
    const [imagePromptType, setImagePromptType] = useState('general');
    const [generalPrompt, setGeneralPrompt] = useState('');

    const fileInputRef = useRef(null);
    const promptFileInputRef = useRef(null);

    // Listen to status
    useEffect(() => {
        if (window.api) {
            window.api.receive('automation-status', (status) => {
                setIsRunning(status === 'running');
            });
            window.api.receive('account-update', (data) => {
                setActiveAccount(data);
            });

            window.api.receive('item-status', ({ index, status }) => {
                // Update generic status map
                setItemStatuses(prev => ({ ...prev, [index]: status }));

                // Update images state if needed
                setImages(prev => {
                    // Optimization: Only update if changed
                    if (!prev[index] || prev[index].status === status) return prev;
                    const newImages = [...prev];
                    newImages[index] = { ...newImages[index], status };
                    return newImages;
                });

                // Update timers
                setItemTimers(prev => {
                    const currentTimer = prev[index] || {};
                    let updates = {};

                    if (status === 'pending') {
                        // Start timer
                        updates = { start: Date.now(), end: null };
                    } else if (status === 'success' || status === 'error' || status === 'waiting' || status === 'processing') {
                        // End timer
                        updates = { ...currentTimer, end: Date.now() };
                    }
                    // For 'processing', we don't change the timer, it keeps running.
                    return { ...prev, [index]: { ...currentTimer, ...updates } };
                });
            });
        }
    }, []);

    const handleStart = () => {
        if (!savePath) { alert('Please select a save location.'); return; }

        setImages(prev => prev.map(img => ({ ...img, status: undefined })));
        setItemStatuses({});
        setItemTimers({});

        let finalPrompts = [];
        if (mode === 'text') {
            finalPrompts = prompts.split('\n').filter(p => p.trim());
            if (finalPrompts.length === 0 && !promptFile) { alert('Please enter prompts.'); return; }
        } else {
            if (images.length === 0) { alert('Please select images.'); return; }
            if (imagePromptType === 'general') {
                finalPrompts = [generalPrompt || ''];
            } else {
                finalPrompts = images.map(img => img.customPrompt || '');
            }
        }

        const config = {
            mode,
            prompts: finalPrompts,
            imagePaths: mode === 'image' ? images.map(i => i.path) : [],
            duration,
            aspectRatio,
            savePath,
            headless: isHeadless,
            concurrency,
            muteAudio
        };

        if (window.api) window.api.send('start-automation', config);
    };

    const handleImageUpload = (e) => {
        if (e.target.files) {
            const newImages = Array.from(e.target.files).map(f => {
                const realPath = window.api && window.api.getFilePath ? window.api.getFilePath(f) : f.path;
                return { path: realPath, name: f.name, customPrompt: '' };
            });
            setImages(prev => [...prev, ...newImages]);
        }
    };

    const handlePromptChange = (index, val) => {
        setImages(prev => {
            const next = [...prev];
            next[index].customPrompt = val;
            return next;
        });
    };

    return (
        <div className="flex h-full select-none">
            {/* LEFT SIDEBAR - CONTROLS */}
            <div className="w-[280px] bg-slate-950/40 border-r border-white/5 flex flex-col shrink-0 relative z-10">
                <div className="p-4 flex-1 overflow-y-auto space-y-5 custom-scrollbar">

                    {/* File / Folder Inputs */}
                    {mode === 'text' ? (
                        <div className="space-y-1.5">
                            <div className="flex justify-between items-baseline">
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1">Prompt File</label>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => promptFileInputRef.current.click()}
                                    className="flex-1 bg-slate-900/50 border border-slate-700/50 hover:bg-slate-800 hover:border-slate-500 text-slate-400 hover:text-white rounded-lg py-2 text-[10px] font-semibold transition-all flex items-center justify-center gap-2 group"
                                >
                                    <FolderOpen size={12} className="group-hover:text-blue-400 transition-colors" />
                                    <span>Browse .txt</span>
                                </button>
                                <input type="file" ref={promptFileInputRef} className="hidden" accept=".txt" onChange={e => {
                                    if (e.target.files[0]) {
                                        if (e.target.files[0].path) setPromptFile(e.target.files[0].path);
                                        const reader = new FileReader();
                                        reader.onload = (ev) => setPrompts(ev.target.result);
                                        reader.readAsText(e.target.files[0]);
                                    }
                                    e.target.value = '';
                                }} />
                            </div>
                            {promptFile && <div className="text-[9px] text-slate-600 px-1 truncate">{promptFile}</div>}
                        </div>
                    ) : (
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1">Image Source</label>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => fileInputRef.current.click()}
                                    className="flex-1 bg-slate-900/50 border border-slate-700/50 hover:bg-slate-800 hover:border-slate-500 text-slate-400 hover:text-white rounded-lg py-2.5 text-[10px] font-semibold transition-all flex items-center justify-center gap-2 group"
                                >
                                    <Upload size={12} className="group-hover:text-blue-400 transition-colors" />
                                    <span>Select Images</span>
                                </button>
                                <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/*" onChange={handleImageUpload} />
                            </div>
                            <div className="text-[9px] text-slate-600 px-1">{images.length} images queued</div>
                        </div>
                    )}

                    {/* Prompts Input */}
                    <div className="space-y-1.5 flex-1 flex flex-col min-h-[120px]">
                        <div className="flex justify-between items-center px-1">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                {mode === 'text' ? 'Prompts' : 'Instructions'}
                            </label>
                            {mode === 'image' && (
                                <div className="flex gap-2">
                                    <button onClick={() => setImagePromptType('general')} className={cn("text-[9px] font-bold transition-colors", imagePromptType === 'general' ? "text-blue-400" : "text-slate-600")}>General</button>
                                    <div className="w-px h-3 bg-white/10"></div>
                                    <button onClick={() => setImagePromptType('custom')} className={cn("text-[9px] font-bold transition-colors", imagePromptType === 'custom' ? "text-blue-400" : "text-slate-600")}>Custom</button>
                                </div>
                            )}
                        </div>

                        {(mode === 'text' || imagePromptType === 'general') ? (
                            <textarea
                                value={mode === 'text' ? prompts : generalPrompt}
                                onChange={e => mode === 'text' ? setPrompts(e.target.value) : setGeneralPrompt(e.target.value)}
                                placeholder={mode === 'text' ? "Enter prompts, one per line..." : "General prompt for all images..."}
                                className="flex-1 w-full bg-slate-950/30 border border-slate-800/60 rounded-lg p-3 text-[11px] text-slate-300 focus:outline-none focus:border-blue-500/40 focus:bg-slate-900/50 resize-none font-medium leading-relaxed placeholder-slate-700 transition-all shadow-inner"
                            />
                        ) : (
                            <div className="flex-1 bg-slate-950/20 border border-slate-800/30 rounded-lg flex items-center justify-center text-slate-600 text-[10px] italic p-4 text-center">
                                Entering prompts per-image in the list →
                            </div>
                        )}
                    </div>

                    <div className="h-px bg-white/5 my-2" />

                    {/* Settings Group */}
                    <div className="space-y-4">
                        {mode !== 'image' && (
                            <>

                                <Toggle
                                    label="Aspect Ratio"
                                    value={aspectRatio}
                                    onChange={setAspectRatio}
                                    options={[
                                        { value: '16:9', label: '16:9', icon: <Monitor size={12} /> },
                                        { value: '9:16', label: '9:16', icon: <Monitor size={12} className="rotate-90" /> },
                                    ]}
                                />
                            </>
                        )}

                        <Toggle
                            label="Audio Output"
                            value={muteAudio}
                            onChange={setMuteAudio}
                            options={[
                                { value: false, label: 'On', icon: <Volume2 size={12} /> },
                                { value: true, label: 'Mute', icon: <VolumeX size={12} /> },
                            ]}
                        />

                        <div className="space-y-2 pt-1">
                            <div className="flex justify-between items-baseline px-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Concurrency</label>
                                <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded", concurrency === 1 ? "bg-slate-800 text-slate-400" : "bg-blue-500/20 text-blue-400")}>{concurrency} Workers</span>
                            </div>
                            <input
                                type="range"
                                min="1"
                                max="5"
                                step="1"
                                value={concurrency}
                                onChange={(e) => setConcurrency(parseInt(e.target.value))}
                                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                            />
                        </div>
                    </div>
                </div>

                {/* Bottom Actions */}
                <div className="p-4 border-t border-white/5 bg-slate-950/50 space-y-3">
                    <div className="flex gap-2">
                        <div className="flex-1 bg-slate-950/30 border border-slate-800 rounded-md px-2 py-1.5 flex items-center gap-2 overflow-hidden">
                            <Save size={12} className="text-slate-600 shrink-0" />
                            <div className="flex-1 text-[9px] text-slate-500 truncate font-mono" title={savePath}>{savePath || "Not selected"}</div>
                        </div>
                        <button
                            onClick={async () => {
                                if (window.api && window.api.invoke) {
                                    const path = await window.api.invoke('open-directory-dialog');
                                    if (path) {
                                        setSavePath(path);
                                        localStorage.setItem('lastSavePath', path);
                                    }
                                }
                            }}
                            className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold px-3 rounded-md transition-colors"
                        >
                            Change
                        </button>
                    </div>

                    {isRunning ? (
                        <button
                            onClick={() => window.api && window.api.send('stop-automation')}
                            className="w-full py-2.5 rounded-lg font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/50"
                        >
                            <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                            <span>STOP GENERATION</span>
                        </button>
                    ) : (
                        <button
                            onClick={handleStart}
                            className="w-full py-2.5 rounded-lg font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20 hover:shadow-blue-500/40 border border-blue-500/50"
                        >
                            <Play size={12} fill="currentColor" />
                            <span>START QUEUE</span>
                        </button>
                    )}
                </div>
            </div>

            {/* RIGHT CONTENT - LIST */}
            <div className="flex-1 bg-slate-900/10 flex flex-col min-w-0">

                {/* Status Bar */}
                <div className="h-14 border-b border-white/5 flex items-center px-6 gap-6 bg-slate-950/20">
                    <div className="flex flex-col">
                        <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Total</span>
                        <span className="text-lg font-bold text-slate-200 leading-none">
                            {mode === 'image' ? images.length : prompts.split('\n').filter(p => p.trim()).length}
                        </span>
                    </div>
                    <div className="h-6 w-px bg-white/5"></div>
                    <div className="flex flex-col">
                        <span className="text-[9px] uppercase tracking-wider text-emerald-500/80 font-bold">Done</span>
                        <span className="text-lg font-bold text-emerald-400 leading-none">
                            {Object.values(itemStatuses).filter(s => s === 'success').length}
                        </span>
                    </div>
                    <div className="h-6 w-px bg-white/5"></div>
                    <div className="flex flex-col">
                        <span className="text-[9px] uppercase tracking-wider text-red-500/80 font-bold">Error</span>
                        <span className="text-lg font-bold text-red-400 leading-none">
                            {Object.values(itemStatuses).filter(s => s === 'error').length}
                        </span>
                    </div>

                    <div className="ml-auto flex items-center gap-3 bg-slate-950/40 rounded-full pl-1 pr-4 py-1 border border-white/5">
                        <div className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[10px] font-bold border border-indigo-500/30">
                            {activeAccount.email[0]?.toUpperCase() || '-'}
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] font-bold text-slate-300">{activeAccount.email}</span>
                            <span className="text-[8px] text-slate-500 font-mono">
                                {activeAccount.index ? `Cycle #${activeAccount.index}` : 'Ready'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Main List */}
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                    <div className="space-y-2 max-w-4xl mx-auto">
                        {(mode === 'image' && images.length > 0) ? (
                            images.map((img, idx) => (
                                <ImageListItem
                                    key={idx}
                                    index={idx}
                                    img={img}
                                    timer={itemTimers[idx]}
                                    onRemove={(i) => setImages(prev => prev.filter((_, x) => x !== i))}
                                    onPromptChange={imagePromptType === 'custom' ? handlePromptChange : null}
                                />
                            ))
                        ) : (mode === 'text' && prompts.split('\n').filter(p => p.trim()).length > 0) ? (
                            prompts.split('\n').filter(p => p.trim()).map((p, idx) => (
                                <TextListItem
                                    key={idx}
                                    index={idx}
                                    text={p}
                                    status={itemStatuses[idx]}
                                    timer={itemTimers[idx]}
                                />
                            ))
                        ) : (
                            <div className="h-64 flex flex-col items-center justify-center text-slate-700 gap-3 opacity-50">
                                <Layers size={48} strokeWidth={1} />
                                <div className="text-xs font-medium">Queue is empty</div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Logs Drawer (ISOLATED) */}
                <LogsPanel />

            </div>
        </div>
    );
}
