import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Upload, Trash2, Plus, GripVertical, User, FileSpreadsheet, Loader } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
    return twMerge(clsx(inputs));
}

export default function AccountManager() {
    const [accounts, setAccounts] = useState([]);
    const [isAdding, setIsAdding] = useState(false);

    const [profileSize, setProfileSize] = useState('Calculating...');
    const [isCleaningProfiles, setIsCleaningProfiles] = useState(false);
    const excelInputRef = useRef(null);

    useEffect(() => {
        if (window.api) {
            window.api.send('get-accounts');
            // Get profile storage size
            window.api.invoke('get-profiles-size').then(size => {
                setProfileSize(size);
            });

            window.api.receive('accounts-data', (data) => {
                if (Array.isArray(data)) {
                    setAccounts(data);
                }
            });
        }
    }, []);

    const saveAccounts = (newAccounts) => {
        setAccounts(newAccounts);
        if (window.api) {
            window.api.send('save-accounts', newAccounts);
        }
    };

    const handleImportExcel = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const bstr = evt.target.result;
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsName = wb.SheetNames[0];
                const ws = wb.Sheets[wsName];
                const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

                // Assume format: [Email, Password] or just Email
                // Header row might exist, try to detect
                const newAccounts = [];
                data.forEach((row, index) => {
                    if (row.length === 0) return;
                    // Simple heuristic: check if first column looks like email
                    const email = row[0]?.toString().trim();
                    const password = row[1]?.toString().trim() || '';

                    if (email && email.includes('@')) {
                        // Check dupes
                        if (!accounts.some(a => a.email === email)) {
                            newAccounts.push({ email, password, status: 'Idle' });
                        }
                    }
                });

                if (newAccounts.length > 0) {
                    saveAccounts([...accounts, ...newAccounts]);
                    alert(`Imported ${newAccounts.length} accounts.`);
                } else {
                    alert('No valid or new accounts found.');
                }

            } catch (err) {
                console.error(err);
                alert('Failed to parse Excel file.');
            }
        };
        reader.readAsBinaryString(file);
        e.target.value = null; // Reset
    };

    const handleDelete = (index) => { // Modified to accept index
        const newAccounts = accounts.filter((_, i) => i !== index);
        saveAccounts(newAccounts);
    };

    const handleManualSubmit = (email, password) => {
        if (!email) return;
        if (accounts.some(a => a.email === email)) {
            alert('Account already exists');
            return;
        }
        saveAccounts([...accounts, { email, password, status: 'Idle', isValid: true }]);
        setIsAdding(false);
    };

    const handleAddAccount = () => {
        setIsAdding(true);
    };

    const handleClearAccounts = async () => {
        if (!confirm('Are you sure you want to clear ALL accounts from the list? This cannot be undone.')) return;

        if (window.api) {
            const result = await window.api.invoke('clear-accounts');
            if (result.success) {
                setAccounts([]); // UI update
                alert('Account list cleared.');
            } else {
                alert('Error clearing accounts: ' + result.error);
            }
        }
    };

    const handleDeleteProfiles = async () => {
        if (!confirm('Are you sure you want to DELETE ALL PROFILE FOLDERS? This will sign out all sessions. This cannot be undone.')) return;

        setIsCleaningProfiles(true);
        if (window.api) {
            try {
                const result = await window.api.invoke('delete-all-profiles');
                if (result.success) {
                    setProfileSize('0 B');
                    alert('All profiles deleted successfully.');
                } else {
                    alert('Failed to delete profiles: ' + result.error);
                }
            } catch (error) {
                alert('An error occurred: ' + error.message);
            } finally {
                setIsCleaningProfiles(false);
            }
        } else {
            setIsCleaningProfiles(false);
        }
    };

    return (
        <>
            <div className="flex flex-col h-full bg-slate-950/20">
                {/* Toolbar */}
                <div className="p-4 border-b border-white/5 flex items-center justify-between bg-slate-900/10 backdrop-blur-sm">
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-4">
                            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                                <User className="text-blue-500" size={16} />
                                Accounts
                                <span className="bg-slate-800 text-slate-400 text-[10px] px-2 py-0.5 rounded-full border border-slate-700">
                                    {accounts.length}
                                </span>
                            </h2>
                            <span className="text-xs text-slate-500 border-l border-slate-800 pl-4">
                                Storage: {profileSize}
                            </span>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={handleDeleteProfiles}
                            disabled={isCleaningProfiles}
                            className="flex items-center gap-2 px-3 py-1.5 bg-red-900/30 text-red-400 hover:bg-red-900/50 hover:text-red-300 border border-red-500/30 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Delete all profile folders"
                        >
                            {isCleaningProfiles ? <Loader size={14} className="animate-spin" /> : <Trash2 size={14} />}
                            {isCleaningProfiles ? 'Cleaning...' : 'Clean Profiles'}
                        </button>
                        <button
                            onClick={handleClearAccounts}
                            className="flex items-center gap-2 px-3 py-1.5 bg-orange-900/30 text-orange-400 hover:bg-orange-900/50 hover:text-orange-300 border border-orange-500/30 rounded-lg text-xs font-semibold transition-all"
                            title="Remove all accounts from list"
                        >
                            <Trash2 size={14} /> Clear List
                        </button>
                        <div className="w-px h-full bg-slate-800 mx-1" /> {/* Separator */}

                        <button
                            onClick={() => excelInputRef.current?.click()}
                            className="flex items-center gap-2 px-3 py-1.5 bg-emerald-900/30 text-emerald-400 hover:bg-emerald-900/50 hover:text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-semibold transition-all"
                        >
                            <FileSpreadsheet size={14} /> Import Excel
                        </button>
                        {/* Folder import removed/hidden for now if not needed, or keep generic import */}
                        <button
                            onClick={handleAddAccount}
                            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white hover:bg-blue-500 border border-blue-500 shadow-lg shadow-blue-500/20 rounded-lg text-xs font-semibold transition-all"
                        >
                            <Plus size={14} /> Add Manual
                        </button>
                        <input
                            type="file"
                            ref={excelInputRef}
                            onChange={handleImportExcel}
                            accept=".xlsx, .xls"
                            className="hidden"
                        />
                    </div>
                </div>

                {/* Table Area */}
                <div className="flex-1 overflow-auto p-4 custom-scrollbar">
                    <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl overflow-hidden shadow-xl">
                        <table className="w-full text-left text-xs">
                            <thead className="bg-slate-950/80 text-slate-400 uppercase font-bold tracking-wider border-b border-slate-800">
                                <tr>
                                    <th className="p-3 pl-4">Email / Username</th>
                                    <th className="p-3">Password</th>
                                    <th className="p-3">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {accounts.length === 0 ? (
                                    <tr>
                                        <td colSpan="3" className="p-8 text-center text-slate-500 italic">
                                            No accounts found. Import or add one to get started.
                                        </td>
                                    </tr>
                                ) : (
                                    accounts.map((acc, idx) => (
                                        <tr key={idx} className="hover:bg-slate-800/30 transition-colors group">
                                            <td className="p-3 pl-4 text-slate-300 font-medium">
                                                {acc.email}
                                            </td>
                                            <td className="p-3 text-slate-500 font-mono">
                                                ••••••••
                                            </td>
                                            <td className="p-3">
                                                <button
                                                    onClick={() => handleDelete(idx)}
                                                    className="p-1.5 rounded-md hover:bg-red-500/20 text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                                                    title="Remove Account"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {isAdding && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl p-6">
                        <h3 className="text-lg font-bold text-white mb-4">Add Account</h3>
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                const formData = new FormData(e.target);
                                handleManualSubmit(formData.get('email'), formData.get('password'));
                            }}
                            className="space-y-4"
                        >
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-slate-400 ml-1">Email</label>
                                <input
                                    name="email"
                                    type="email"
                                    required
                                    placeholder="name@example.com"
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-blue-500/50"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-slate-400 ml-1">Password</label>
                                <input
                                    name="password"
                                    type="text"
                                    placeholder="Optional"
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-blue-500/50"
                                />
                            </div>
                            <div className="flex gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsAdding(false)}
                                    className="flex-1 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors text-sm font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors text-sm font-bold shadow-lg shadow-blue-500/20"
                                >
                                    Add Account
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
}

