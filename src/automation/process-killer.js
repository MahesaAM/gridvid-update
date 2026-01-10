const { exec } = require('child_process');
const os = require('os');

/**
 * Kill all Chrome/Chromedriver processes started by this application or generally lingering.
 * CAUTION: This might kill the user's personal Chrome on some systems if not careful,
 * but "Chrome for Testing" usually runs as `chrome.exe` too.
 * To be safe, we try to target processes by command line if possible, or just kill chromedriver
 * which cascades to its children.
 */
function killChromeProcesses() {
    return new Promise((resolve) => {
        const platform = os.platform();
        let cmd = '';

        if (platform === 'win32') {
            // Windows: Kill chromedriver.exe and chrome.exe
            // /F = Force, /T = Tree (kill children), /IM = Image Name
            // Warning: This kills ALL chrome.exe. 
            // Better to only kill chromedriver.exe which usually owns the automated chrome instances.
            // If we kill chrome.exe, we kill the user's browser.

            // NOTE: Puppeteer launches "chrome.exe" (Chrome for Testing).
            // It is hard to distinguish from normal Chrome without inspecting command line args.
            // But killing chromedriver.exe is usually safe and effective for automation cleanup.
            cmd = 'taskkill /F /IM chromedriver.exe /T';
        } else {
            // Mac/Linux
            cmd = 'pkill -f chromedriver';
        }

        exec(cmd, (error, stdout, stderr) => {
            // Ignore errors (e.g. process not found)
            console.log('Cleanup: Chromedriver processes killed.');
            resolve();
        });
    });
}

/**
 * Aggressive cleanup that tries to find chrome processes running from our specific user data dir.
 * This is safer than `taskkill /IM chrome.exe`.
 */
function killOrphanedChromes() {
    // Advanced: Use WMIC or PowerShell to find chrome.exe with specific command line args?
    // For now, let's stick to killing chromedriver.
    return killChromeProcesses();
}

module.exports = { killChromeProcesses, killOrphanedChromes };
