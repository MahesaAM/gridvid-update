import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { X, Monitor, LogOut } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import AccountManager from './components/AccountManager';
import Generator from './components/Generator';
import Login from './components/Login';

import UpdateNotification from './components/UpdateNotification';

function cn(...inputs) {
    return twMerge(clsx(inputs));
}

const supabaseUrl = 'https://wdvedlmnapxxfvpyfwqa.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndkdmVkbG1uYXB4eGZ2cHlmd3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ4MjE5NzUsImV4cCI6MjA2MDM5Nzk3NX0.yLIbYKF1PfzEo3gMO0H8SgXN8AAPRYgDTJewg8nb7GA';
const supabase = createClient(supabaseUrl, supabaseKey);

export default function App() {
    const [activeTab, setActiveTab] = useState('generator'); // 'generator' | 'accounts'
    const [generatorMode, setGeneratorMode] = useState('text'); // 'text' | 'image'
    const [status, setStatus] = useState('stopped');
    const [isHeadless, setIsHeadless] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isAuthChecking, setIsAuthChecking] = useState(true);
    const [appVersion, setAppVersion] = useState('v1.0.0');
    const [expirationDate, setExpirationDate] = useState(null);
    const [checkingUpdate, setCheckingUpdate] = useState(false);

    const [showHeadlessControl, setShowHeadlessControl] = useState(false);

    useEffect(() => {
        const pressedKeys = new Set();

        const handleKeyDown = (e) => {
            // Robust check for input focus
            const active = document.activeElement;
            if (active && (
                active.tagName === 'INPUT' ||
                active.tagName === 'TEXTAREA' ||
                active.isContentEditable
            )) {
                return;
            }

            pressedKeys.add(e.code);

            // Check for Ctrl + Shift + M + H + S
            // We use e.ctrlKey and e.shiftKey for modifiers as they are reliable
            // We check pressedKeys/e.code for the letters to handle simultaneous press
            const isM = pressedKeys.has('KeyM');
            const isH = pressedKeys.has('KeyH');
            const isS = pressedKeys.has('KeyS');

            // Note used preventDefault on the final key to avoid blocking normal typing of single letters
            if (e.ctrlKey && e.shiftKey && isM && isH && isS) {
                if (!e.repeat) { // Prevent toggling repeatedly while holding
                    console.log('Shortcut triggered: Ctrl+Shift+M+H+S');
                    setShowHeadlessControl(prev => !prev);
                }
                e.preventDefault();
            }
        };

        const handleKeyUp = (e) => {
            pressedKeys.delete(e.code);
        };

        // Safety clear on focus loss
        const handleBlur = () => pressedKeys.clear();

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', handleBlur);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', handleBlur);
        };
    }, []);

    useEffect(() => {
        const validateSession = async () => {
            const storedUser = localStorage.getItem('gridvidUser');
            if (storedUser) {
                try {
                    const session = JSON.parse(storedUser);
                    // Check against database
                    const { data, error } = await supabase
                        .from('users_veo')
                        .select('*')
                        .eq('username', session.username)
                        .single();

                    if (error || !data) {
                        console.warn('Session invalid: User not found or DB error', error);
                        localStorage.removeItem('gridvidUser');
                        setIsAuthenticated(false);
                    } else {
                        // Check expiration
                        // Assuming 'expired' is a date string or timestamp. 
                        // If data.expired exists, check it.
                        if (data.expired) {
                            const expiredDate = new Date(data.expired);
                            const now = new Date();
                            if (now > expiredDate) {
                                console.warn('Session expired');
                                alert('Your subscription has expired.');
                                localStorage.removeItem('gridvidUser');
                                setIsAuthenticated(false);
                            } else {
                                setIsAuthenticated(true);
                                setExpirationDate(expiredDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }));
                            }
                        } else {
                            // No expiry date set, assume valid or handle as needed. 
                            // Login.jsx allows login even if expired is set (just stores it). 
                            // But request says "check whether it is not yet expired".
                            // We assume if no date, it's lifetime or valid.
                            setIsAuthenticated(true);
                            setExpirationDate('Lifetime');
                        }
                    }
                } catch (e) {
                    console.error('Session validation error:', e);
                    // If parse error or other crash, logout
                    localStorage.removeItem('gridvidUser');
                    setIsAuthenticated(false);
                }
            }
            setIsAuthChecking(false);
        };

        validateSession();

        if (window.api) {
            window.api.receive('automation-status', (s) => setStatus(s));

            // Get version
            window.api.invoke('get-app-version').then(ver => {
                if (ver) setAppVersion(`v${ver}`);
            });
        }
    }, []);

    const handleExit = () => {
        if (window.api) window.api.send('close');
    };

    const handleLogout = () => {
        localStorage.removeItem('gridvidUser');
        setIsAuthenticated(false);
        setActiveTab('generator');
    };

    if (isAuthChecking) {
        return (
            <div className="h-screen w-screen bg-black flex items-center justify-center">
                <div
                    className="w-20 h-20"
                    style={{
                        backgroundImage: `url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><circle fill="%23FFFFFF" stroke="%23FFFFFF" stroke-width="15" r="15" cx="40" cy="65"><animate attributeName="cy" calcMode="spline" dur="2" values="65;135;65;" keySplines=".5 0 .5 1;.5 0 .5 1" repeatCount="indefinite" begin="-.4"></animate></circle><circle fill="%23FFFFFF" stroke="%23FFFFFF" stroke-width="15" r="15" cx="100" cy="65"><animate attributeName="cy" calcMode="spline" dur="2" values="65;135;65;" keySplines=".5 0 .5 1;.5 0 .5 1" repeatCount="indefinite" begin="-.2"></animate></circle><circle fill="%23FFFFFF" stroke="%23FFFFFF" stroke-width="15" r="15" cx="160" cy="65"><animate attributeName="cy" calcMode="spline" dur="2" values="65;135;65;" keySplines=".5 0 .5 1;.5 0 .5 1" repeatCount="indefinite" begin="0"></animate></circle></svg>')`,
                        backgroundSize: 'contain',
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'center',
                    }}
                ></div>
            </div>
        );
    }

    return (
        <div className="h-screen w-screen bg-slate-950 text-slate-200 font-sans flex flex-col overflow-hidden relative selection:bg-blue-500/30 selection:text-white">
            {/* Background Gradients */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-900/20 via-slate-950 to-slate-950 pointer-events-none" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-blue-950/20 via-slate-950 to-slate-950 pointer-events-none" />

            {/* Header (Custom Title Bar) */}
            <div className="flex justify-between items-center px-6 py-2 z-50 bg-slate-950/80 backdrop-blur-md select-none" style={{ WebkitAppRegion: 'drag' }}>
                {/* Drag Region handles moving */}

                {/* Left Tabs - No Drag for interactive elements */}
                <div className="flex gap-2" style={{ WebkitAppRegion: 'no-drag' }}>
                    {isAuthenticated && (
                        <>
                            <button
                                onClick={() => { setActiveTab('generator'); setGeneratorMode('text'); }}
                                className={cn(
                                    "px-4 py-1.5 rounded-full font-bold text-xs transition-all border",
                                    activeTab === 'generator' && generatorMode === 'text'
                                        ? "bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-500/20"
                                        : "bg-slate-900/50 text-slate-500 border-white/5 hover:text-slate-300 hover:border-white/10"
                                )}
                            >
                                Text to Video
                            </button>
                            <button
                                onClick={() => { setActiveTab('generator'); setGeneratorMode('image'); }}
                                className={cn(
                                    "px-4 py-1.5 rounded-full font-bold text-xs transition-all border",
                                    activeTab === 'generator' && generatorMode === 'image'
                                        ? "bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-500/20"
                                        : "bg-slate-900/50 text-slate-500 border-white/5 hover:text-slate-300 hover:border-white/10"
                                )}
                            >
                                Image to Video
                            </button>
                            <button
                                onClick={() => setActiveTab('accounts')}
                                className={cn(
                                    "px-4 py-1.5 rounded-full font-bold text-xs transition-all border",
                                    activeTab === 'accounts'
                                        ? "bg-slate-800 text-white border-slate-700 shadow-md"
                                        : "bg-transparent text-slate-500 border-transparent hover:text-slate-300 hover:bg-slate-900/50"
                                )}
                            >
                                Manage Account
                            </button>
                        </>
                    )}
                </div>

                {/* Right Info & Window Controls */}
                <div className="flex items-center gap-4" style={{ WebkitAppRegion: 'no-drag' }}>
                    <div className="flex items-center gap-4">
                        {isAuthenticated && (
                            <>
                                <label className={cn("flex items-center gap-2 cursor-pointer group transition-opacity duration-300", showHeadlessControl ? "opacity-100" : "opacity-0 pointer-events-none hidden")}>
                                    <span className={cn("text-[10px] font-medium transition-colors", isHeadless ? "text-blue-400" : "text-slate-500")}>
                                        Headless
                                    </span>
                                    <div className="relative w-8 h-4 bg-slate-900 rounded-full border border-slate-700 group-hover:border-slate-600 transition-colors">
                                        <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={isHeadless}
                                            onChange={(e) => setIsHeadless(e.target.checked)}
                                        />
                                        <div className={cn(
                                            "absolute top-0.5 left-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform shadow-sm",
                                            isHeadless ? "translate-x-4 bg-blue-500" : "bg-slate-500"
                                        )} />
                                    </div>
                                </label>
                                <div className="h-4 w-px bg-white/10 mx-2 hidden" />
                            </>
                        )}
                        <div className="flex items-center gap-2 bg-slate-900/50 px-3 py-1 rounded-full border border-white/5">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)] animate-pulse"></div>
                            <span className="text-[10px] text-slate-400 font-mono">GRIDVID</span>
                            <span className="text-[9px] text-slate-600 font-mono ml-1">{appVersion}</span>
                            <button
                                onClick={() => {
                                    setCheckingUpdate(true);
                                    window.api.send('check-for-update');
                                }}
                                className={cn(
                                    "ml-2 text-slate-500 transition-colors p-1 rounded-full hover:bg-white/10",
                                    checkingUpdate ? "text-blue-400 animate-spin" : "hover:text-white"
                                )}
                                title="Check for Updates"
                                disabled={checkingUpdate}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                            </button>
                            {isAuthenticated && expirationDate && (
                                <span className="text-[9px] text-slate-500 font-mono ml-2 border-l border-white/10 pl-2">
                                    EXPIRED: {expirationDate}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Window Controls */}
                    <div className="flex items-center gap-2 ml-4">
                        {isAuthenticated && (
                            <button
                                onClick={handleLogout}
                                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors mr-2"
                                title="Logout"
                            >
                                <LogOut size={16} />
                            </button>
                        )}
                        <button
                            onClick={() => window.api?.send('minimize')}
                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                        >
                            <div className="w-3 h-0.5 bg-current rounded-full"></div>
                        </button>
                        <button
                            onClick={() => window.api?.send('maximize')}
                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                        >
                            <div className="w-2.5 h-2.5 border-[1.5px] border-current rounded-[2px]" />
                        </button>
                        <button
                            onClick={handleExit}
                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Content Box */}
            <div className="flex-1 mx-4 mb-4 bg-slate-950/50 rounded-2xl border border-white/5 relative z-0 shadow-2xl overflow-hidden flex flex-col backdrop-blur-sm">
                {/* Content Render */}
                <div className="flex-1 overflow-auto p-2">

                    {!isAuthenticated ? (
                        <div className="h-full flex items-center justify-center">
                            <Login onLoginSuccess={(session) => {
                                setIsAuthenticated(true);
                                if (session && session.expired) {
                                    const d = new Date(session.expired);
                                    setExpirationDate(d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }));
                                } else {
                                    setExpirationDate('Lifetime');
                                }
                            }} />
                        </div>
                    ) : (
                        <>
                            <div style={{ display: activeTab === 'generator' ? 'block' : 'none', height: '100%' }}>
                                <Generator mode={generatorMode} isHeadless={isHeadless} />
                            </div>
                            <div style={{ display: activeTab === 'accounts' ? 'block' : 'none', height: '100%' }}>
                                <AccountManager />
                            </div>
                        </>
                    )}
                </div>
            </div>

            <UpdateNotification
                isManualCheck={checkingUpdate}
                onCheckComplete={() => setCheckingUpdate(false)}
            />
        </div >
    );
}
