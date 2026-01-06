import React, { useState, useRef, useEffect } from 'react';
import { Type, Image as ImageIcon, Play, Upload, FolderOpen, Save, Layers, Clock, Monitor, ChevronRight, Volume2, VolumeX } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
    return twMerge(clsx(inputs));
}

// Simple Toggle Component
function Toggle({ label, options, value, onChange }) {
    return (
        <div className="space-y-2">
            <label className="text-xs font-medium text-slate-400 block">{label}</label>
            <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-700/50">
                {options.map((opt) => (
                    <button
                        key={opt.value}
                        onClick={() => onChange(opt.value)}
                        className={cn(
                            "flex-1 py-2 rounded-md text-xs font-medium transition-all flex flex-col items-center gap-1",
                            value === opt.value
                                ? "bg-white bg-[linear-gradient(135deg,#e0e7ff_0%,#ffffff_50%,#e0e7ff_100%)] text-blue-950 shadow-sm font-bold"
                                : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
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

export default function Generator({ mode, logs, isHeadless }) {
    const [prompts, setPrompts] = useState('');
    const [images, setImages] = useState([]);
    const [itemStatuses, setItemStatuses] = useState({}); // { [index]: 'pending' | 'success' | 'error' }
    const [itemTimers, setItemTimers] = useState({}); // { [index]: { start: number, end: number | null } }
    const [now, setNow] = useState(Date.now());
    const [duration, setDuration] = useState('5s');
    const [aspectRatio, setAspectRatio] = useState('16:9'); // '16:9' | '9:16'
    const [muteAudio, setMuteAudio] = useState(false);
    const [concurrency, setConcurrency] = useState(1);
    const [isRunning, setIsRunning] = useState(false);
    const [activeAccount, setActiveAccount] = useState({ email: '-', quota: '-' });
    // isHeadless now comes from props

    // Initialize savePath from localStorage
    const [savePath, setSavePath] = useState(localStorage.getItem('lastSavePath') || '');
    const [promptFile, setPromptFile] = useState('');

    // Image mode specific
    const [imagePromptType, setImagePromptType] = useState('general'); // 'general' | 'custom'
    const [generalPrompt, setGeneralPrompt] = useState('');

    const fileInputRef = useRef(null);
    const promptFileInputRef = useRef(null);

    // Live timer update
    useEffect(() => {
        let interval;
        if (isRunning) {
            interval = setInterval(() => {
                setNow(Date.now());
            }, 30); // 30ms for smooth 1.29s look
        }
        return () => clearInterval(interval);
    }, [isRunning]);

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
                console.log('Received item-status:', index, status); // DEBUG
                // Update images state (for visual list)
                setImages(prev => {
                    const newImages = [...prev];
                    if (newImages[index]) {
                        console.log('Updating image status for index:', index, status); // DEBUG
                        newImages[index] = { ...newImages[index], status };
                    } else {
                        console.log('Image not found for index:', index); // DEBUG
                    }
                    return newImages;
                });
                // Update generic status map (for stats)
                setItemStatuses(prev => ({ ...prev, [index]: status }));

                // Update timers
                setItemTimers(prev => {
                    const currentTimer = prev[index] || {};
                    let updates = {};

                    if (status === 'pending') {
                        // Start timer if not already started (or restart if needed, usually just start)
                        updates = { start: Date.now(), end: null };
                    } else if (status === 'success' || status === 'error' || status === 'waiting') {
                        // End timer
                        updates = { ...currentTimer, end: Date.now() };
                    }

                    return { ...prev, [index]: { ...currentTimer, ...updates } };
                });
            });
        }
    }, []);

    const logsEndRef = useRef(null);
    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    const handleStart = () => {
        // Validation: Save Path must be selected
        if (!savePath) {
            alert('Please select a save location.');
            return;
        }

        // Reset statuses
        setImages(prev => prev.map(img => ({ ...img, status: undefined })));
        setItemStatuses({});
        setItemTimers({});

        // Collect prompts based on mode
        let finalPrompts = [];
        if (mode === 'text') {
            finalPrompts = prompts.split('\n').filter(p => p.trim());
            if (finalPrompts.length === 0 && !promptFile) { alert('Please enter prompts or select a file.'); return; }
        } else {
            // Image Mode
            if (images.length === 0) { alert('Please select images.'); return; }
            // If general prompt, apply to all. If custom, we assume UI handles per-image prompt (simplified here for now)
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
                // Try to get path via Electron API if available, else fallback to path property (older electron)
                const realPath = window.api && window.api.getFilePath ? window.api.getFilePath(f) : f.path;
                return {
                    path: realPath,
                    name: f.name,
                    customPrompt: ''
                };
            });
            setImages(prev => [...prev, ...newImages]);
        }
    };

    const handlePromptUpload = (e) => {
        if (e.target.files[0]) {
            const file = e.target.files[0];
            // If the file object has a path property (Electron), allow using it, otherwise fallback might differ or not be needed here.
            // But primarily we want to read the content.
            if (file.path) {
                setPromptFile(file.path);
            }

            const reader = new FileReader();
            reader.onload = (event) => {
                const text = event.target.result;
                setPrompts(text);
            };
            reader.readAsText(file);
        }
    };

    const getDurationDisplay = (index) => {
        const timer = itemTimers[index];
        if (!timer || !timer.start) return null;

        const endTime = timer.end || now;
        const durationMs = Math.max(0, endTime - timer.start);
        const durationSec = (durationMs / 1000).toFixed(2);

        return (
            <div className="font-mono text-[10px] text-slate-400 font-bold bg-slate-900/50 px-1.5 py-0.5 rounded border border-slate-800">
                {durationSec}s
            </div>
        );
    };

    return (
        <div className="flex h-full">
            {/* LEFT SIDEBAR - CONTROLS */}
            <div className="w-80 bg-slate-950/30 border-r border-white/5 p-6 flex flex-col gap-6 overflow-y-auto shrink-0">

                {/* File / Folder Inputs */}
                {mode === 'text' ? (
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-slate-400">Choose Prompt File (.txt)</label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => promptFileInputRef.current.click()}
                                className="flex-1 bg-slate-900 border border-slate-700 text-slate-300 rounded-md py-2 text-xs font-medium hover:border-slate-500 hover:text-white transition-colors"
                            >
                                Choose File
                            </button>
                            <input type="file" ref={promptFileInputRef} className="hidden" accept=".txt" onChange={handlePromptUpload} />
                        </div>
                        {promptFile && <div className="text-[10px] text-slate-500 truncate">{promptFile}</div>}
                    </div>
                ) : (
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-slate-400">Choose Images Folder</label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => fileInputRef.current.click()}
                                className="flex-1 bg-slate-900 border border-slate-700 text-slate-300 rounded-md py-2 text-xs font-medium hover:border-slate-500 hover:text-white transition-colors"
                            >
                                Choose File
                            </button>
                            <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/*" onChange={handleImageUpload} />
                        </div>
                        <div className="text-[10px] text-slate-500">{images.length} images selected</div>
                    </div>
                )}

                {/* Text Area for General Prompt (Image Mode) or Direct Prompt (Text Mode) */}
                {mode === 'text' ? (
                    <div className="space-y-2 flex-1 flex flex-col">
                        <label className="text-xs font-medium text-slate-400">
                            Direct Prompts
                            <span className="text-slate-600 ml-1">
                                (Total: {prompts.split('\n').filter(p => p.trim()).length})
                            </span>
                        </label>
                        <textarea
                            value={prompts}
                            onChange={e => setPrompts(e.target.value)}
                            placeholder="Enter prompts here, one per line..."
                            className="flex-1 w-full bg-slate-950/50 border border-slate-800 rounded-lg p-3 text-xs text-slate-300 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 resize-none font-mono placeholder-slate-700"
                        />
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="flex gap-4 mb-2">
                            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                                <input type="radio" checked={imagePromptType === 'general'} onChange={() => setImagePromptType('general')} className="accent-blue-500" />
                                General Prompt
                            </label>
                            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                                <input type="radio" checked={imagePromptType === 'custom'} onChange={() => setImagePromptType('custom')} className="accent-blue-500" />
                                Custom Prompt
                            </label>
                        </div>
                        <textarea
                            value={generalPrompt}
                            onChange={e => setGeneralPrompt(e.target.value)}
                            disabled={imagePromptType !== 'general'}
                            placeholder="General Prompt.."
                            className={cn(
                                "w-full h-24 bg-slate-950/50 border border-slate-800 rounded-lg p-3 text-xs text-slate-300 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 resize-none placeholder-slate-700",
                                imagePromptType !== 'general' && "opacity-50 cursor-not-allowed"
                            )}
                        />
                    </div>
                )}

                <hr className="border-white/10" />

                {/* Duration - Hide in Image Mode */
                    mode !== 'image' && (
                        <div className="space-y-2 hidden">
                            <label className="text-xs font-medium text-slate-400">Video Duration</label>
                            <div className="relative">
                                <select
                                    value={duration}
                                    onChange={e => setDuration(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-blue-500 appearance-none"
                                >
                                    <option value="5s">5 Seconds</option>
                                    <option value="6s">6 Seconds</option>
                                    <option value="7s">7 Seconds</option>
                                    <option value="8s">8 Seconds</option>
                                </select>
                                <ChevronRight className="absolute right-3 top-2.5 text-slate-500 rotate-90 pointer-events-none" size={14} />
                            </div>
                        </div>
                    )}

                {/* Aspect Ratio - Hide in Image Mode */}
                {mode !== 'image' && (
                    <Toggle
                        label="Aspect Ratio"
                        value={aspectRatio}
                        onChange={setAspectRatio}
                        options={[
                            { value: '16:9', label: 'Landscape', icon: <Monitor size={14} /> },
                            { value: '9:16', label: 'Portrait', icon: <Monitor size={14} className="rotate-90" /> },
                        ]}
                    />
                )}

                {/* Audio Toggle */}
                <Toggle
                    label="Audio"
                    value={muteAudio}
                    onChange={setMuteAudio}
                    options={[
                        { value: false, label: 'Unmuted', icon: <Volume2 size={14} /> },
                        { value: true, label: 'Muted', icon: <VolumeX size={14} /> },
                    ]}
                />

                {/* Concurrency */}
                <div className="space-y-4">
                    <div className="flex justify-between items-center text-xs text-slate-400">
                        <span className="font-semibold text-slate-300">Multi Generate</span>
                        <span className="text-blue-400 font-bold bg-blue-500/10 px-2 py-0.5 rounded">{concurrency} Process</span>
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
                    <div className="flex justify-between text-[10px] text-slate-600">
                        <span>1 (Safe)</span>
                        <span>5 (Max)</span>
                    </div>
                </div>

                <div className="mt-auto space-y-4">
                    {/* Save Path */}
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={savePath}
                            readOnly
                            placeholder="..."
                            className="flex-1 bg-slate-950/50 border border-slate-800 rounded-l-md px-3 py-2 text-xs text-slate-500 truncate"
                        />
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
                            className="bg-slate-800 hover:bg-slate-700 text-slate-300 border border-l-0 border-slate-800 text-xs font-bold px-3 py-2 rounded-r-md transition-colors"
                        >
                            Save to..
                        </button>
                    </div>

                    {/* Generate Button */}
                    {/* Generate / Stop Button */}
                    {isRunning ? (
                        <button
                            onClick={() => {
                                if (window.api) window.api.send('stop-automation');
                            }}
                            className="w-full py-3 rounded-lg font-bold text-sm shadow-xl transition-all flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white border border-red-500 shadow-[0_0_15px_rgba(220,38,38,0.3)] hover:shadow-[0_0_20px_rgba(220,38,38,0.5)]"
                        >
                            <span>Stop Generating</span>
                        </button>
                    ) : (
                        <button
                            onClick={handleStart}
                            className="w-full py-3 rounded-lg font-bold text-sm shadow-xl transition-all flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white border border-blue-500/50 shadow-[0_0_15px_rgba(37,99,235,0.3)] hover:shadow-[0_0_20px_rgba(37,99,235,0.5)]"
                        >
                            Run
                        </button>
                    )}
                </div>
            </div>

            {/* RIGHT CONTENT - PREVIEW / LIST */}
            <div className="flex-1 bg-slate-950/20 p-6 flex flex-col">
                {/* Stats Cards */}
                <div className="grid grid-cols-4 gap-4 mb-6">
                    <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-3 flex flex-col items-center justify-center gap-1">
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Progress</span>
                        <span className="text-xl font-bold text-white">
                            {(() => {
                                const total = mode === 'image' ? images.length : prompts.split('\n').filter(p => p.trim()).length;
                                const finished = Object.values(itemStatuses).filter(s => s === 'success' || s === 'error').length;
                                return `${finished} / ${total}`;
                            })()}
                        </span>
                    </div>
                    {/* Active Account Card */}
                    <div className="bg-blue-950/20 border border-blue-500/30 rounded-lg p-3 flex flex-col items-center justify-center gap-1 relative overflow-hidden group">
                        <div className="absolute inset-0 bg-blue-500/5" />
                        <span className="text-[10px] uppercase tracking-wider text-blue-400/80 font-bold relative">Account</span>
                        <div className="flex flex-col items-center relative z-10 w-full">
                            <span className="text-[10px] text-slate-300 truncate max-w-full px-1" title={activeAccount.email}>{activeAccount.email}</span>
                            {activeAccount.index && activeAccount.total && (
                                <span className="text-[9px] text-slate-500 mt-0.5">
                                    {activeAccount.index} / {activeAccount.total}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="bg-slate-900/50 border border-emerald-900/30 rounded-lg p-3 flex flex-col items-center justify-center gap-1 relative overflow-hidden">
                        <div className="absolute inset-0 bg-emerald-500/5" />
                        <span className="text-[10px] uppercase tracking-wider text-emerald-500/80 font-bold relative">Success</span>
                        <span className="text-xl font-bold text-emerald-400 relative">
                            {Object.values(itemStatuses).filter(s => s === 'success').length}
                        </span>
                    </div>
                    <div className="bg-slate-900/50 border border-red-900/30 rounded-lg p-3 flex flex-col items-center justify-center gap-1 relative overflow-hidden">
                        <div className="absolute inset-0 bg-red-500/5" />
                        <span className="text-[10px] uppercase tracking-wider text-red-500/80 font-bold relative">Failed</span>
                        <span className="text-xl font-bold text-red-400 relative">
                            {Object.values(itemStatuses).filter(s => s === 'error').length}
                        </span>
                    </div>
                </div>
                {(mode === 'image' && images.length > 0) || (mode === 'text' && prompts.split('\n').filter(p => p.trim()).length > 0) ? (
                    <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                        {mode === 'image' ? (
                            images.map((img, idx) => (
                                <div key={idx} className={cn(
                                    "flex items-center gap-4 p-3 rounded-lg border transition-all",
                                    img.status === 'success' ? "bg-emerald-950/30 border-emerald-500/50" :
                                        img.status === 'error' ? "bg-red-950/30 border-red-500/50" :
                                            img.status === 'pending' ? "bg-slate-900/50 border-blue-500/50 animate-pulse" :
                                                "bg-slate-900/50 border-slate-800 hover:border-slate-600"
                                )}>
                                    <div className="w-12 h-12 rounded bg-slate-800 flex items-center justify-center text-xs text-slate-500 shrink-0 overflow-hidden border border-slate-700 relative group">
                                        <img
                                            src={`file://${img.path.replace(/\\/g, '/')}`}
                                            alt={img.name}
                                            className="w-full h-full object-cover"
                                            onError={(e) => {
                                                e.target.style.display = 'none';
                                                e.target.nextSibling.style.display = 'flex';
                                            }}
                                        />
                                        <div className="absolute inset-0 hidden items-center justify-center bg-slate-800">
                                            <ImageIcon size={14} />
                                        </div>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs text-slate-300 truncate font-medium">{img.name}</div>
                                        {imagePromptType === 'custom' && (
                                            <input
                                                type="text"
                                                placeholder="Enter custom prompt for this image..."
                                                className="w-full mt-1 bg-slate-950/50 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-300 focus:border-blue-500 focus:outline-none"
                                                value={img.customPrompt}
                                                onChange={(e) => {
                                                    const newImages = [...images];
                                                    newImages[idx].customPrompt = e.target.value;
                                                    setImages(newImages);
                                                }}
                                            />
                                        )}
                                    </div>
                                    {getDurationDisplay(idx)}
                                    <button className="p-2 hover:bg-slate-800 rounded-md text-slate-500 hover:text-red-400 transition-colors" onClick={() => {
                                        setImages(images.filter((_, i) => i !== idx));
                                    }}>
                                        ×
                                    </button>
                                </div>
                            ))
                        ) : (
                            prompts.split('\n').filter(p => p.trim()).map((prompt, idx) => {
                                const status = itemStatuses[idx];
                                return (
                                    <div key={idx} className={cn(
                                        "flex items-center gap-4 p-3 rounded-lg border transition-all",
                                        status === 'success' ? "bg-emerald-950/30 border-emerald-500/50" :
                                            status === 'error' ? "bg-red-950/30 border-red-500/50" :
                                                status === 'pending' ? "bg-slate-900/50 border-blue-500/50 animate-pulse" :
                                                    "bg-slate-900/50 border-slate-800 hover:border-slate-600"
                                    )}>
                                        <div className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center text-xs text-slate-500 shrink-0 font-mono font-bold border border-slate-700">
                                            {idx + 1}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs text-slate-300 break-words whitespace-pre-wrap font-medium" title={prompt}>
                                                {prompt}
                                            </div>
                                        </div>
                                        {getDurationDisplay(idx)}
                                        {status === 'success' && <div className="p-2 text-emerald-500 text-xs font-bold">Done</div>}
                                        {status === 'error' && <div className="p-2 text-red-500 text-xs font-bold">Failed</div>}
                                        {status === 'waiting' && <div className="p-2 text-blue-400 text-xs font-bold animate-pulse">Waiting Token...</div>}
                                        {status === 'pending' && <div className="p-2 text-amber-500 text-xs font-bold">...</div>}
                                    </div>
                                );
                            })
                        )}
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-600 gap-4">
                        {/* Placeholder State */}
                        <div className="w-16 h-16 rounded-full bg-slate-900 flex items-center justify-center shadow-inner border border-slate-800">
                            <Layers size={32} className="opacity-20" />
                        </div>
                        <div className="text-sm">
                            {mode === 'text' ? 'Ready for prompts' : 'Select images to begin'}
                        </div>
                    </div>
                )}

                {/* Logs Overlay */}
                <div className="h-32 bg-slate-950/60 border-t border-white/5 p-2 overflow-y-auto font-mono text-[10px] text-slate-400">
                    {logs.length === 0 && <div className="text-slate-600 italic">Waiting for logs...</div>}
                    {logs.map((log, i) => (
                        <div key={i} className="border-b border-white/5 pb-0.5 mb-0.5 last:border-0">
                            <span className="text-slate-500">[{log.time}]</span> {log.message}
                        </div>
                    ))}
                    <div ref={logsEndRef} className="h-4" /> {/* Spacer with ref */}
                </div>
            </div>
        </div>
    );
}
