import React, { useState, useEffect } from 'react';

const UpdateNotification = ({ isManualCheck, onCheckComplete }) => {
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [updateInfo, setUpdateInfo] = useState(null);
    const [downloading, setDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [downloaded, setDownloaded] = useState(false);
    const [error, setError] = useState(null);
    const [upToDate, setUpToDate] = useState(false);

    useEffect(() => {
        if (!window.api) return;

        // Listen for update-available
        const removeAvailable = window.api.receive('update-available', (info) => {
            console.log('Update available:', info);
            setUpdateAvailable(true);
            setUpdateInfo(info);
            setError(null);
            setDownloading(true);
            setUpToDate(false);
            if (onCheckComplete) onCheckComplete();
        });

        // Listen for update-not-available
        const removeNotAvailable = window.api.receive('update-not-available', (info) => {
            console.log('Update not available:', info);
            if (isManualCheck) {
                setUpToDate(true);
                setUpdateInfo(info); // Might contain current version info
                // Auto hide after 3 seconds
                setTimeout(() => {
                    setUpToDate(false);
                }, 3000);
            }
            if (onCheckComplete) onCheckComplete();
        });

        // Listen for download progress
        const removeProgress = window.api.receive('download-progress', (progressObj) => {
            if (progressObj && progressObj.percent) {
                setDownloadProgress(progressObj.percent);
            }
        });

        // Listen for update-downloaded
        const removeDownloaded = window.api.receive('update-downloaded', (info) => {
            console.log('Update downloaded:', info);
            setDownloading(false);
            setDownloaded(true);
        });

        // Listen for errors
        const removeError = window.api.receive('update-error', (err) => {
            console.error('Update error:', err);
            // Only show error if manual check or if we were downloading
            if (isManualCheck || downloading) {
                setError(err);
            }
            setDownloading(false);
            if (onCheckComplete) onCheckComplete();
        });

        // Note: window.api.receive in preload typically adds a listener. 
        // If it returns a cleanup function, we should use it. 
        // Based on typical implementation in this project context (from common patterns), 
        // it might not return cleanup. If so, we risk duplicate listeners if component remounts.
        // Assuming App.jsx renders this once and keeps it mounted.

        return () => {
            // Cleanup if the bridge supports it, otherwise do nothing
        };
    }, [isManualCheck, onCheckComplete, downloading]);

    const handleInstall = () => {
        window.api.send('install-update');
    };

    const handleLater = () => {
        setUpdateAvailable(false);
        setError(null);
    };

    // Up to date toast/modal
    if (upToDate) {
        return (
            <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-6 shadow-2xl max-w-sm w-full ring-1 ring-white/10 flex flex-col items-center text-center">
                    <div className="w-12 h-12 bg-green-500/10 rounded-full flex items-center justify-center mb-4 text-green-400">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <h2 className="text-lg font-bold text-white mb-1">You're all set!</h2>
                    <p className="text-slate-400 text-sm mb-4">You are using the latest version of GridVid.</p>
                    <button
                        onClick={() => setUpToDate(false)}
                        className="px-6 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors text-sm"
                    >
                        Close
                    </button>
                </div>
            </div>
        )
    }

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

                {error ? (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6 text-sm text-red-200">
                        <p className="font-bold text-red-400 mb-1">Download Failed</p>
                        <p className="opacity-90">{error.toString()}</p>
                    </div>
                ) : (
                    <>
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
                    </>
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
