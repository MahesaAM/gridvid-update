import React, { useState, useEffect } from 'react';

const UpdateNotification = () => {
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [updateInfo, setUpdateInfo] = useState(null);
    const [downloading, setDownloading] = useState(false);
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
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 shadow-2xl max-w-md w-full animate-in fade-in zoom-in duration-200">
                <h2 className="text-xl font-bold text-white mb-2">Update Available!</h2>
                <p className="text-slate-300 mb-4 text-sm">
                    A new version of GridVid is ready. Update now for the latest features and improvements.
                </p>

                {updateInfo && (
                    <div className="bg-slate-800 rounded-lg p-3 mb-6 flex justify-between items-center text-sm">
                        <div className="text-slate-400">
                            <span className="block text-xs uppercase tracking-wider mb-1">Current</span>
                            <span className="font-mono text-white">v{updateInfo.currentVersion || '...'}</span>
                        </div>
                        <div className="text-green-400 text-right">
                            <span className="block text-xs uppercase tracking-wider mb-1">New</span>
                            <span className="font-mono font-bold">v{updateInfo.version}</span>
                        </div>
                    </div>
                )}

                <div className="flex gap-3">
                    <button
                        onClick={handleLater}
                        className="flex-1 px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium transition-colors"
                    >
                        Later
                    </button>
                    {downloaded ? (
                        <button
                            onClick={handleInstall}
                            className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors shadow-lg shadow-indigo-500/20"
                        >
                            Restart & Install
                        </button>
                    ) : (
                        <button
                            disabled
                            className="flex-1 px-4 py-2 rounded-lg bg-slate-800 text-slate-400 font-medium cursor-wait flex items-center justify-center gap-2"
                        >
                            <svg className="animate-spin h-4 w-4 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Downloading...
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default UpdateNotification;
