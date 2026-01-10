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
 * TokenPool: Manages a collection of valid tokens.
 * Thread-safe-ish (JS single threaded event loop makes array push/pop safe).
 */
class TokenPool {
    constructor() {
        this.tokens = []; // { email, token }
        this.waitingResolvers = [];
    }

    addToken(email, token) {
        console.log(`[TokenPool] Adding token for ${email}`);
        this.tokens.push({ email, token });
        this.notify();
    }

    // Returns a Promise that resolves with a token when available
    async acquire() {
        if (this.tokens.length > 0) {
            return this.tokens.shift();
        }

        // Wait for token
        return new Promise(resolve => {
            this.waitingResolvers.push(resolve);
        });
    }

    notify() {
        while (this.tokens.length > 0 && this.waitingResolvers.length > 0) {
            const resolver = this.waitingResolvers.shift();
            const tokenData = this.tokens.shift();
            resolver(tokenData);
        }
    }

    hasTokens() {
        return this.tokens.length > 0;
    }
}

const STATE_FILE = path.join(app.getPath('userData'), 'generator_state.json');

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Failed to load state:', e);
    }
    return { lastAccountIndex: 0 };
}

function saveState(state) {
    try {
        const current = loadState();
        fs.writeFileSync(STATE_FILE, JSON.stringify({ ...current, ...state }, null, 2));
    } catch (e) {
        console.error('Failed to save state:', e);
    }
}

/**
 * TokenHarvester (Producer)
 * Logs into accounts sequentially and pushes tokens to the pool.
 */
async function runTokenHarvest(accounts, tokenPool, logCallback, muteAudio, headless) {
    logCallback({ key: 'auth', message: 'Starting Token Harvester...' });

    // Load last used index
    let state = loadState();
    let startIndex = state.lastAccountIndex || 0;

    // Validate index (if accounts list changed/shortened)
    if (startIndex >= accounts.length) {
        startIndex = 0;
        saveState({ lastAccountIndex: 0 });
        logCallback({ key: 'auth', message: 'Account list changed, resetting rotation index to 0.' });
    }

    logCallback({ key: 'auth', message: `Resuming account rotation from index ${startIndex} (${accounts[startIndex].email})` });

    // Loop through all accounts, starting from startIndex, wrapping around
    for (let i = 0; i < accounts.length; i++) {
        if (isStopped) break;

        const currentIndex = (startIndex + i) % accounts.length;
        const account = accounts[currentIndex];

        logCallback({ key: 'auth', message: `[${account.email}] Harvesting token...` });

        // Update state to next index immediately so if we stop/crash, we start from next one
        const nextIndex = (currentIndex + 1) % accounts.length;
        saveState({ lastAccountIndex: nextIndex });

        // TODO: Check if we already have a valid token in memory? 
        // For now, let's assume we need to check login state or refresh.
        // Optimization: If we just got a token for this email recently, skip.

        let browser = null;
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
                userDataDir: path.join(app.getPath('userData'), 'profiles', sanitize(account.email)),
                args: launchArgs,
                ignoreDefaultArgs: ['--enable-automation']
            });

            const page = await browser.newPage();

            // Log callback wrapper for Auth logs
            const authLogger = (msg) => logCallback({ key: 'auth', message: `[${account.email}] ${msg}` });

            const authToken = await getAuthTokenFromPage(page, authLogger, account.email, account.password);

            if (authToken) {
                logCallback({ key: 'auth', message: `[${account.email}] ✅ Token Aquired.` });
                tokenPool.addToken(account.email, authToken);
            } else {
                logCallback({ key: 'auth', message: `[${account.email}] ❌ Failed to get token.` });
            }

        } catch (e) {
            logCallback({ key: 'auth', message: `[${account.email}] Error: ${e.message}` });
        } finally {
            if (browser) {
                try { await browser.close(); } catch (e) { }
            }
        }
    }
    logCallback({ key: 'auth', message: 'Token Harvest Loop Finished.' });
}

/**
 * GeneratorWorker (Consumer)
 * Consumes tokens to generate videos.
 */
async function runGeneratorWorker(workerId, queue, tokenPool, logCallback, statusCallback, savePath, duration, aspectRatio, muteAudio) {
    logCallback({ key: 'gen', message: `[Worker ${workerId}] Started.` });

    while (queue.length > 0 && !isStopped) {
        // 1. Acquire Token (Wait if needed)
        // If queue is empty, break (handled by while)
        // If stopped, break

        // We peek to see if we should even wait. 
        if (queue.length === 0) break;

        logCallback({ key: 'gen', message: `[Worker ${workerId}] Waiting for available token...` });
        const { email, token } = await tokenPool.acquire();

        // 2. We have a token! Grab work.
        if (queue.length === 0) {
            tokenPool.addToken(email, token); // Return unused token
            break;
        }

        const currentItem = queue.shift();

        const label = currentItem.imagePath ? `Image ${path.basename(currentItem.imagePath)}` : `"${currentItem.text.substring(0, 15)}..."`;
        logCallback({ key: 'gen', message: `[Worker ${workerId}] Processing with ${email}: ${label}` });
        statusCallback(currentItem.index, 'pending');

        try {
            // Log wrapper for Gen logs
            const genLogger = (msg) => logCallback({ key: 'gen', message: `[${email}] ${msg}` });

            const { downloadUrl, blobId } = await generateVideoAPI(
                token,
                currentItem.text,
                aspectRatio,
                genLogger,
                currentItem.imagePath,
                duration
            );

            if (isStopped) throw new Error("Stopped by user");

            const dlDir = savePath || path.join(process.env.USERPROFILE || process.env.HOME || __dirname, 'Downloads');

            await downloadVideoFile(
                downloadUrl,
                token,
                dlDir,
                blobId,
                genLogger,
                muteAudio,
                currentItem.imagePath,
                () => statusCallback(currentItem.index, 'processing')
            );

            statusCallback(currentItem.index, 'success');

            // Success! Return valid token to pool for reuse.
            tokenPool.addToken(email, token);

        } catch (err) {
            const errMsg = err.message || "";
            if (errMsg === "Stopped by user") {
                statusCallback(currentItem.index, 'pending');
                tokenPool.addToken(email, token);
                return;
            }

            // Check for fatal token errors (Auth or Quota)
            // 429 is usually Too Many Requests (Quota)
            const isTokenDead = errMsg.includes("401") ||
                errMsg.includes("403") ||
                errMsg.includes("Auth") ||
                errMsg.includes("limit") ||
                errMsg.includes("quota") ||
                errMsg.toLowerCase().includes("exceeded");

            if (isTokenDead) {
                logCallback({ key: 'gen', message: `[${email}] 🛑 Account exhausted / Quota Limit. Discarding.` });
                statusCallback(currentItem.index, 'waiting');
                queue.unshift(currentItem); // Retry with another account
            } else {
                logCallback({ key: 'gen', message: `[${email}] ⚠️ Error: ${errMsg}. Retrying...` });
                tokenPool.addToken(email, token); // Return token (transient error likely)
                statusCallback(currentItem.index, 'waiting');
                queue.unshift(currentItem); // Retry same item
            }
        }
    }
    logCallback({ key: 'gen', message: `[Worker ${workerId}] Finished.` });
}


async function runGenerate(params, logCallback, statusCallback, accountCallback) {
    isStopped = false;
    const { prompts, images, duration, aspectRatio, savePath, accounts, concurrency = 1, muteAudio } = params;
    const mode = params.mode ? params.mode.toLowerCase() : 'text';
    const headless = params.headless !== undefined ? params.headless : true;

    // Adapting logCallback to handle old string inputs if any legacy calls remain
    const safeLog = (data) => {
        if (typeof data === 'string') {
            logCallback({ key: 'system', message: data });
        } else {
            logCallback(data);
        }
    };

    safeLog('Starting automation (Producer-Consumer Mode)...');

    if (!accounts || accounts.length === 0) {
        safeLog('No accounts available. Please add accounts first.');
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
        }
    } else {
        queue = prompts.map((p, i) => ({ text: p, index: i }));
    }

    // 2. Initialize Components
    const tokenPool = new TokenPool();

    // 3. Start Harvester (Producer) - runs in background
    // We DON'T await this yet, it runs totally parallel filling the pool.
    const harvesterPromise = runTokenHarvest(accounts, tokenPool, safeLog, muteAudio, headless);

    // 4. Start Workers (Consumers)
    const activeWorkers = [];
    const actualConcurrency = Math.max(1, concurrency); // User defined, no hard cap

    safeLog(`Spawning ${actualConcurrency} generator workers...`);

    for (let i = 0; i < actualConcurrency; i++) {
        activeWorkers.push(runGeneratorWorker(i + 1, queue, tokenPool, safeLog, statusCallback, savePath, duration, aspectRatio, muteAudio));
    }

    // 5. Wait for Workers
    // We wait for workers to finish the queue. 
    // Harvester might still be running if we have way more accounts than needed for the queue?
    // Or if queue finishes fast.

    await Promise.all(activeWorkers);

    // 6. Cleanup
    // If workers are done, we can stop harvester?
    isStopped = true; // Signal harvester to stop if not done
    await harvesterPromise; // Clean await

    safeLog('✅ Automation Generation Complete.');
}

module.exports = { runGenerate, stopGenerate };
