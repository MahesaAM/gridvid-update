import React, { useState, useEffect } from 'react';

const UpdateNotification = () => {
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [updateInfo, setUpdateInfo] = useState(null);
    const [downloading, setDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [downloaded, setDownloaded] = useState(false);

    useEffect(() => {
        if (!window.api) return;

        // Listen for update-available
        window.api.receive('update-available', (info) => {
            console.log('Update available:', info);
            setUpdateAvailable(true);
            setUpdateInfo(info);
            // Auto-updater usually starts downloading automatically unless configured otherwise
            setDownloading(true);
        });

        // Listen for download progress
        window.api.receive('download-progress', (progressObj) => {
            // progressObj usually has { percent, transferred, total, bytesPerSecond, delta, ... }
            if (progressObj && progressObj.percent) {
                setDownloadProgress(progressObj.percent);
            }
        });

        // Listen for update-downloaded
        window.api.receive('update-downloaded', (info) => {
            console.log('Update downloaded:', info);
            setDownloading(false);
            setDownloaded(true);
        });

        // Listen for errors (optional, to hide modal or show error)
        window.api.receive('update-error', (err) => {
            console.error('Update error:', err);
            // Optionally hide or show error
        });
    }, []);

    const handleInstall = () => {
        window.api.send('install-update');
    };

    const handleLater = () => {
        setUpdateAvailable(false);
    };

    if (!updateAvailable) return null;

    return (
        <div className="fixed inset-0 flex items-center justify-center bg-black/80 z-50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-6 shadow-2xl max-w-md w-full ring-1 ring-white/10">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <h2 className="text-xl font-bold text-white mb-1">Update Available!</h2>
                        <p className="text-slate-400 text-sm">
                            A new version of GridVid is ready.
                        </p>
                    </div>
                    <div className="bg-indigo-500/10 text-indigo-400 px-3 py-1 rounded-full text-xs font-bold font-mono">
                        v{updateInfo?.version}
                    </div>
                </div>

                <div className="bg-slate-950/50 rounded-lg p-4 mb-6 ring-1 ring-white/5 space-y-3">
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-500">Current Version</span>
                        <span className="font-mono text-slate-300">v{updateInfo?.currentVersion || '...'}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-500">New Version</span>
                        <span className="font-mono text-green-400 font-bold">v{updateInfo?.version}</span>
                    </div>
                </div>

                {downloading && !downloaded && (
                    <div className="mb-6 space-y-2">
                        <div className="flex justify-between text-xs text-slate-400">
                            <span>Downloading...</span>
                            <span>{Math.round(downloadProgress)}%</span>
                        </div>
                        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-indigo-500 transition-all duration-300 ease-out"
                                style={{ width: `${downloadProgress}%` }}
                            />
                        </div>
                    </div>
                )}

                <div className="flex gap-3">
                    <button
                        onClick={handleLater}
                        className="flex-1 px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors text-sm"
                    >
                        Later
                    </button>
                    {downloaded ? (
                        <button
                            onClick={handleInstall}
                            className="flex-1 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors shadow-lg shadow-indigo-500/20 text-sm flex items-center justify-center gap-2"
                        >
                            <span>Restart & Install</span>
                        </button>
                    ) : (
                        <button
                            disabled
                            className="flex-1 px-4 py-2.5 rounded-lg bg-slate-800/50 text-slate-500 font-medium cursor-wait flex items-center justify-center gap-2 text-sm border border-white/5"
                        >
                            <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Processing...
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default UpdateNotification;
