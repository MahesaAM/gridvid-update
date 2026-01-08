const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { app } = require('electron');
const { getChromiumPath } = require('./chromium-utils');
const { cleanString, sanitize } = require('./common-utils');
const { getAuthTokenFromPage, generateVideoAPI, downloadVideoFile } = require('./veo-api');

puppeteer.use(StealthPlugin());

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

let isStopped = false;

function stopGenerate() {
    isStopped = true;
    console.log('Stop signal received.');
}

/**
 * AccountPool manages the distribution of Google accounts to workers.
 * Features:
 * - Smart Rotation: Hand out the Least Recently Used (LRU) account to balance load.
 * - Locking: Marks accounts as 'busy' so multiple workers don't grab the same one.
 * - Status Tracking: Tracks 'ok', 'limited', 'error' states.
 */
class AccountPool {
    constructor(accounts) {
        this.accounts = accounts.map(a => ({
            ...a,
            busy: false,
            status: 'ok',
            lastUsed: 0,
            cooldownUntil: 0 // [NEW] Timestamp when account is ready again
        }));
    }

    /**
     * Get the best available account.
     * Criteria: Status is 'ok', not busy, AND cooldown has expired.
     * Sorts by lastUsed ASC so we get the one that has been idle the longest.
     */
    acquire() {
        const now = Date.now();
        // Filter: OK, Not Busy, Cooldown Passed
        const candidates = this.accounts.filter(a =>
            a.status === 'ok' &&
            !a.busy &&
            a.cooldownUntil <= now
        );

        if (candidates.length === 0) return null;

        // Sort by lastUsed ASC (smallest timestamp = oldest usage = least recently used)
        candidates.sort((a, b) => a.lastUsed - b.lastUsed);

        const selected = candidates[0];
        selected.busy = true;
        selected.lastUsed = now;
        return selected;
    }

    /**
     * Release an account back to the pool.
     * @param {string} email 
     * @param {string|null} newStatus 
     * @param {number} cooldownSeconds - How long to block this account (in seconds)
     */
    release(email, newStatus = null, cooldownSeconds = 0) {
        const acc = this.accounts.find(a => a.email === email);
        if (acc) {
            acc.busy = false; // Unlock
            if (newStatus) acc.status = newStatus;

            if (cooldownSeconds > 0) {
                acc.cooldownUntil = Date.now() + (cooldownSeconds * 1000);
            }
        }
    }

    /**
     * Check if there are ANY accounts that are theoretically usable (even if currently busy).
     * If false, it means all accounts are banned or limited.
     */
    hasViableAccounts() {
        return this.accounts.some(a => a.status === 'ok');
    }

    getStats() {
        const total = this.accounts.length;
        const now = Date.now();
        const ok = this.accounts.filter(a => a.status === 'ok').length;
        // Busy includes cooldowns effectively? No, busy is active processing.
        // Let's count cooldowns separately.
        const cooling = this.accounts.filter(a => a.status === 'ok' && !a.busy && a.cooldownUntil > now).length;
        const available = this.accounts.filter(a => a.status === 'ok' && !a.busy && a.cooldownUntil <= now).length;
        const busy = this.accounts.filter(a => a.busy).length;
        const limited = this.accounts.filter(a => a.status === 'limited').length;
        const error = this.accounts.filter(a => a.status === 'error').length;

        return { total, available, cooling, busy, limited, error };
    }

    getTotalCount() {
        return this.accounts.length;
    }

    getAvailableCount() {
        const now = Date.now();
        return this.accounts.filter(a => a.status === 'ok' && !a.busy && a.cooldownUntil <= now).length;
    }
}

async function runGenerate(params, logCallback, statusCallback, accountCallback) {
    isStopped = false;
    const { prompts, images, duration, aspectRatio, savePath, accounts, concurrency = 1, muteAudio } = params;
    const mode = params.mode ? params.mode.toLowerCase() : 'text';
    const headless = params.headless !== undefined ? params.headless : true;

    console.log('[Generator] Received params:', JSON.stringify(params, null, 2));
    logCallback('Starting automation...');
    logCallback(`Mode: ${mode.toUpperCase()}`);
    logCallback(`Concurrency Request: ${concurrency}`);
    logCallback(`Accounts Provided: ${accounts ? accounts.length : 0}`);

    if (!accounts || accounts.length === 0) {
        logCallback('No accounts available. Please add accounts first.');
        return;
    }

    ensureDir(savePath);

    // 1. Prepare Queue
    let queue = [];
    if (mode === 'image') {
        if (params.imagePaths && params.imagePaths.length > 0) {
            queue = params.imagePaths.map((imgPath, i) => ({
                text: prompts[i] || prompts[0] || "",
                imagePath: imgPath,
                index: i
            }));
        } else {
            logCallback("No images provided for image mode.");
            return;
        }
    } else {
        // Text/Veo Mode
        queue = prompts.map((p, i) => ({ text: p, index: i }));
    }
    logCallback(`Total items in queue: ${queue.length}`);
    const totalItems = queue.length;
    let completedCount = 0;

    // 2. Initialize Account Pool
    const pool = new AccountPool(accounts);

    // 3. Worker Function
    const worker = async (workerId) => {
        logCallback(`[Worker ${workerId}] Started.`);

        while (queue.length > 0 && !isStopped) {
            // A. Check viability
            if (!pool.hasViableAccounts()) {
                logCallback(`[Worker ${workerId}] All accounts exhausted/limited. Exiting.`);
                break;
            }

            // B. Acquire Account
            const currentAccount = pool.acquire();

            if (!currentAccount) {
                // No accounts available right now (all busy). Wait.
                const stats = pool.getStats();
                // Avoid spamming logs too much, maybe only log every 5th retry? 
                // For now, let's log once per wait cycle is fine if wait is 2s.
                logCallback(`[Worker ${workerId}] Waiting for account... (Avail=${stats.available}, Cooling=${stats.cooling}, Busy=${stats.busy})`);
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }

            // C. Use Account
            logCallback(`[Worker ${workerId}] Acquired account: ${currentAccount.email}`);

            // Find index for UI callback
            const accountInd = accounts.findIndex(a => a.email === currentAccount.email);
            if (accountCallback) accountCallback({
                email: currentAccount.email,
                index: accountInd + 1,
                total: accounts.length
            });

            let browser = null;
            let page = null;
            let authToken = null;
            let accountStatus = 'ok'; // default status to release with

            try {
                const launchArgs = [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-infobars',
                    '--window-size=1280,800',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                ];
                if (muteAudio) launchArgs.push('--mute-audio');

                browser = await puppeteer.launch({
                    headless: headless ? 'new' : false,
                    executablePath: getChromiumPath(),
                    userDataDir: path.join(app.getPath('userData'), 'profiles', sanitize(currentAccount.email)),
                    args: launchArgs,
                    ignoreDefaultArgs: ['--enable-automation']
                });

                page = await browser.newPage();

                // Mute Handling
                if (muteAudio) {
                    await page.evaluateOnNewDocument(() => {
                        window.addEventListener('load', () => {
                            const muteAll = () => document.querySelectorAll('audio, video').forEach(el => { el.muted = true; el.volume = 0; });
                            muteAll();
                            new MutationObserver(muteAll).observe(document.body, { childList: true, subtree: true });
                        });
                    });
                }

                authToken = await getAuthTokenFromPage(page, (msg) => logCallback(`[${currentAccount.email}] ${msg}`), currentAccount.email, currentAccount.password);

                if (!authToken) {
                    throw new Error("Failed to authenticate.");
                }

                // D. Process Items with this Account
                // We assume we can process at least one item.
                // We loop here to reuse the browser session for subsequent items if possible (Optimization),
                // BUT we should respect the "rotation" requirement.
                // However, "smart rotation" is usually for *load balancing*. 
                // Reusing the same browser for a few items is much faster than restarting every time.
                // Let's implement a "Batch Mode": Process X items then yield, or process until empty.
                // Given the user wants "speed", keeping the browser open is best.

                while (queue.length > 0 && !isStopped) {
                    if (queue.length === 0) break;

                    // Peek/Take item
                    // We need to be careful with concurrency here. JavaScript is single-threaded so `queue.shift()` is atomic safe.
                    const currentItem = queue.shift();

                    statusCallback(currentItem.index, 'pending');
                    const label = currentItem.imagePath ? `Image ${path.basename(currentItem.imagePath)}` : `"${currentItem.text.substring(0, 15)}... "`;
                    logCallback(`[${currentAccount.email}] Processing (${currentItem.index + 1}): ${label}`);

                    try {
                        const { downloadUrl, blobId } = await generateVideoAPI(
                            authToken,
                            currentItem.text,
                            aspectRatio,
                            (msg) => logCallback(`[${currentAccount.email}] ${msg}`),
                            currentItem.imagePath,
                            duration
                        );

                        if (isStopped) throw new Error("Stopped by user");

                        if (browser.isConnected()) {
                            const dlDir = savePath || path.join(process.env.USERPROFILE || process.env.HOME || __dirname, 'Downloads');
                            await downloadVideoFile(
                                downloadUrl,
                                authToken,
                                dlDir,
                                blobId,
                                (msg) => logCallback(`[${currentAccount.email}] ${msg}`),
                                muteAudio,
                                currentItem.imagePath,
                                () => statusCallback(currentItem.index, 'processing') // onProcessingStart
                            );
                            statusCallback(currentItem.index, 'success');
                            completedCount++;
                        } else {
                            throw new Error("Browser disconnected during download.");
                        }

                    } catch (err) {
                        const errMsg = err.message || "";
                        if (errMsg === "Stopped by user") {
                            statusCallback(currentItem.index, 'error');
                            throw err;
                        }

                        if (errMsg.includes("Sensitive Content")) {
                            logCallback(`[${currentAccount.email}] 🛑 Safety Reset. Skipping prompt...`);
                            statusCallback(currentItem.index, 'error');
                            continue;
                        }

                        // Handle Limits / Quota
                        if (errMsg.includes("429") || errMsg.includes("403") || errMsg.includes("limit") || errMsg.includes("quota") || errMsg.includes("Quota Exceeded")) {
                            logCallback(`[${currentAccount.email}] 🛑 Limit Reached. Waiting for token...`);
                            statusCallback(currentItem.index, 'waiting'); // Notify UI to pause timer/show waiting
                            queue.unshift(currentItem); // Requeue item logic
                            accountStatus = 'limited';
                            break; // Break inner loop to release account
                        }

                        // Timeout or other network errors
                        if (errMsg.includes("Timeout")) {
                            logCallback(`[${currentAccount.email}] ⚠️ Timeout. Retrying...`);
                            queue.unshift(currentItem);
                            break;
                        }

                        logCallback(`[${currentAccount.email}] ⚠️ Error: ${errMsg}`);
                        queue.unshift(currentItem); // Requeue transient error
                        break;
                    }
                }

            } catch (err) {
                if (err.message === "Stopped by user") {
                    logCallback(`[Worker ${workerId}] Stopped.`);
                } else {
                    const msg = err.message;
                    logCallback(`[Worker ${workerId}] Account Error: ${msg}`);

                    if (msg.includes("Account Blocked")) {
                        // Hard Block -> Disable Account
                        accountStatus = 'error';
                    } else if (msg.includes("Auth Timeout")) {
                        // Soft Timeout -> Keep Account OK, but it will be rotated to back of queue
                        logCallback(`[Worker ${workerId}] Soft Timeout. Account kept in rotation.`);
                        accountStatus = 'ok';
                    } else if (msg.includes("Failed to authenticate")) {
                        // Unknown auth failure -> assume soft error to be safe, or hard?
                        // Let's assume soft for now as network issues are common.
                        accountStatus = 'ok';
                    }
                }
            } finally {
                // cleanup
                if (browser) {
                    try {
                        logCallback(`[Worker ${workerId}] Closing browser for ${currentAccount.email}...`);
                        const closePromise = browser.close();
                        // Race against 5s timeout
                        const timeoutPromise = new Promise(resolve => setTimeout(() => resolve('timeout'), 5000));
                        const result = await Promise.race([closePromise, timeoutPromise]);

                        if (result === 'timeout') {
                            logCallback(`[Worker ${workerId}] Browser close timed out. Force killing process...`);
                            const process = browser.process();
                            if (process) process.kill('SIGKILL');
                        }
                    } catch (e) {
                        logCallback(`[Worker ${workerId}] Error closing browser: ${e.message}`);
                    }
                }
                // Release account
                if (currentAccount) {
                    let cooldown = 0;

                    // Logic to determine cooldown
                    // If no explicit status change (status is 'ok'), but we perhaps had a soft error?
                    // We can track if we successfully generated an item. 
                    // Actually, let's look at the Error message or local variables.
                    // Ideally we should have set a flag. But for now, let's say:
                    // If accountStatus is 'ok' but we crashed/errored out early, maybe add short cooldown?
                    // But if we just finished normally, cooldown = 0.

                    // If we are releasing with 'error' or 'limited', cooldown doesn't matter (it's dead).
                    // If we are releasing with 'ok', we check if it was a soft error.
                    // The 'worker' function local variables are tricky to pass here cleanly without refactor.
                    // Let's assume the catch block handles the decision.

                    // Hack: We can change accountStatus to 'cooldown' temporarily? No, status is perma-state.
                    // Let's rely on the error catch block to set a var.

                    // Re-reading catch block:
                    // Soft Timeout -> accountStatus = 'ok'
                    // Failed to auth -> accountStatus = 'ok'

                    // If we failed to auth, we DEFINITELY want a cooldown.
                    // Let's default to 0. 

                    // IMPROVEMENT: Check if queue item was NOT processed successfully?
                    // If we are breaking the loop and releasing, and we didn't finish cleanly...
                    // Let's use a heuristic: if browser is closed due to error, apply 60s cooldown.

                    // We can check if 'authToken' was ever obtained. 
                    if (!authToken && accountStatus === 'ok') {
                        cooldown = 60; // 60s cooldown if we failed to get token
                    }

                    pool.release(currentAccount.email, accountStatus, cooldown);

                    const cooldownMsg = cooldown > 0 ? ` (Cooldown: ${cooldown}s)` : "";
                    logCallback(`[Worker ${workerId}] Released account: ${currentAccount.email} (Status: ${accountStatus}${cooldownMsg})`);
                }
            }
        }
        logCallback(`[Worker ${workerId}] Finished.`);
    };

    // 4. Start Workers
    const activeWorkers = [];
    // We cap at the requested concurrency OR 5 (hard max) as per user request
    const actualConcurrency = Math.min(concurrency, 5);

    logCallback(`Spawning ${actualConcurrency} workers (Staggered start)...`);

    for (let i = 0; i < actualConcurrency; i++) {
        // Stagger: 4s delay to be safer
        if (i > 0) await new Promise(r => setTimeout(r, 4000));
        activeWorkers.push(worker(i + 1));
    }

    await Promise.all(activeWorkers);

    logCallback(`✅ All workers finished. Generated ${completedCount} / ${totalItems} items.`);
}

module.exports = { runGenerate, stopGenerate };
