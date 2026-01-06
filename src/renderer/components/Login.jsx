import React, { useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Eye, EyeOff, Loader, Lock, User } from 'lucide-react';
import logo from '../assets/logo3.png';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
    return twMerge(clsx(inputs));
}

const supabaseUrl = 'https://wdvedlmnapxxfvpyfwqa.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndkdmVkbG1uYXB4eGZ2cHlmd3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ4MjE5NzUsImV4cCI6MjA2MDM5Nzk3NX0.yLIbYKF1PfzEo3gMO0H8SgXN8AAPRYgDTJewg8nb7GA';
const supabase = createClient(supabaseUrl, supabaseKey);

export default function Login({ onLoginSuccess }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        if (!username || !password) {
            setError('Please enter username and password.');
            setLoading(false);
            return;
        }

        try {
            console.log('Login attempt:', { username });

            // Get device serial using exposed API
            // Fallback if API not available (e.g. browser dev mode)
            let biosSerial = 'BROWSER_DEV_ID';
            if (window.api && window.api.getBiosSerial) {
                biosSerial = await window.api.getBiosSerial();
            } else {
                console.warn('window.api.getBiosSerial not available, using mock ID');
            }

            const { data, error: dbError } = await supabase
                .from('users_veo')
                .select('*')
                .eq('username', username)
                .eq('password', password) // Note: In a real app, passwords should be hashed. Matching user snippet logic.
                .single();

            if (dbError || !data) {
                console.error('Login error:', dbError || 'No user found');
                setError('Invalid username or password.');
                setLoading(false);
                return;
            }

            // Check device ID
            if (data.deviceId && data.deviceId !== biosSerial) {
                setError('This account is already registered to another device.');
                setLoading(false);
                return;
            }

            // Check expiration
            if (data.expired) {
                console.log(`Checking expiration: ${data.expired}`); // Log for debugging
                const expiredDate = new Date(data.expired);
                const now = new Date();
                if (now > expiredDate) {
                    setError('Your subscription has expired.');
                    setLoading(false);
                    return;
                }
            }

            // Update deviceId if empty
            if (!data.deviceId) {
                await supabase
                    .from('users_veo')
                    .update({ deviceId: biosSerial })
                    .eq('username', username);
            }

            // Save user info
            const userSession = {
                username: data.username,
                expired: data.expired
            };
            localStorage.setItem('gridvidUser', JSON.stringify(userSession));

            // Notify parent
            onLoginSuccess(userSession);

        } catch (err) {
            console.error('Login error:', err);
            setError('Login failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-[400px] w-full max-w-sm mx-auto p-6">
            <div className="flex flex-col items-center mb-8 gap-3">
                <div className="w-80 h-auto flex items-center justify-center">
                    <img src={logo} alt="GridVid Logo" className="w-full h-full object-contain" />
                </div>
            </div>

            <form onSubmit={handleLogin} className="w-full space-y-4">
                <div className="space-y-1">
                    <div className="relative group">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors" size={18} />
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Username"
                            className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-3 pl-10 pr-4 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/10 transition-all"
                        />
                    </div>
                </div>

                <div className="space-y-1">
                    <div className="relative group">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors" size={18} />
                        <input
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Password"
                            className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-3 pl-10 pr-12 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/10 transition-all"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                        >
                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 px-3 py-2 rounded-lg">
                        {error}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={loading}
                    className={cn(
                        "w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 transition-all shadow-lg shadow-blue-900/20",
                        "disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    )}
                >
                    {loading ? (
                        <>
                            <Loader className="animate-spin" size={18} />
                            <span>Signing in...</span>
                        </>
                    ) : (
                        "Sign In"
                    )}
                </button>
            </form>
        </div>
    );
}
