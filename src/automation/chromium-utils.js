const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');

function findFileRecurring(dir, filename) {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir, { withFileTypes: true });

    for (const file of files) {
        const fullPath = path.join(dir, file.name);
        if (file.isDirectory()) {
            const found = findFileRecurring(fullPath, filename);
            if (found) return found;
        } else if (file.name === filename) {
            return fullPath;
        } else if (process.platform === 'darwin' && file.name === 'Google Chrome for Testing.app') {
            const macExec = path.join(fullPath, 'Contents', 'MacOS', 'Google Chrome for Testing');
            if (fs.existsSync(macExec)) return macExec;
        }
    }
    return null;
}

function getLocalChromePath() {
    try {
        let potentialDirs = [];

        // 1. Development: Check root of the project
        potentialDirs.push(process.cwd());

        // 2. Production: Check resources path (app.asar.unpacked location)
        // In electron-builder, unpacked files are in resources/app.asar.unpacked/
        if (process.resourcesPath) {
            potentialDirs.push(path.join(process.resourcesPath, 'app.asar.unpacked'));
            potentialDirs.push(process.resourcesPath); // sometimes direct
        }

        let execName = '';
        let folderName = '';

        if (process.platform === 'darwin') {
            folderName = 'browsers_mac';
            execName = 'Google Chrome for Testing';
        } else if (process.platform === 'win32') {
            folderName = 'puppeteer-chromium';
            execName = 'chrome.exe';
        } else {
            return null;
        }

        for (const baseDir of potentialDirs) {
            const targetDir = path.join(baseDir, folderName);
            const found = findFileRecurring(targetDir, execName);
            if (found) return found;
        }

        return null;
    } catch (e) {
        console.error('Error finding local chrome:', e);
        return null;
    }
}

function getChromiumPath(options = {}) {
    // Check custom paths if provided
    if (options.customPaths) {
        for (const p of options.customPaths) {
            if (fs.existsSync(p)) {
                return p;
            }
        }
    }

    // 1. Check local project-level Chrome (Priority 1 - User Request)
    const localPath = getLocalChromePath();
    if (localPath) {
        console.log(`[Chromium] Using local download: ${localPath}`);
        return localPath;
    }

    // 2. Check for System Google Chrome (Priority 2)
    const systemPath = getSystemChromePath();
    if (systemPath) {
        console.log(`[Chromium] Using System Google Chrome: ${systemPath}`);
        return systemPath;
    }

    // 3. Fallback to puppeteer's bundled chromium
    try {
        const execPath = puppeteer.executablePath();
        if (fs.existsSync(execPath)) {
            console.log(`[Chromium] Using Chrome for Testing at: ${execPath}`);
            return execPath;
        } else {
            // Last ditch: check for typical install locations if puppeteer fails
            console.error(`[Chromium] Chrome for Testing binary not found at: ${execPath}`);
            const errorMsg = `Chrome executable not found. Please install Chrome or run 'npx puppeteer browsers install chrome'.`;
            throw new Error(errorMsg);
        }
    } catch (e) {
        throw e;
    }
}

function getSystemChromePath() {
    const platform = process.platform;
    let possiblePaths = [];

    if (platform === 'darwin') {
        possiblePaths = [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            path.join(process.env.HOME || '', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        ];
    } else if (platform === 'win32') {
        const suffixes = [
            '\\Google\\Chrome\\Application\\chrome.exe',
            '\\Google\\Application\\chrome.exe'
        ];
        const prefixes = [
            process.env.LOCALAPPDATA,
            process.env.PROGRAMFILES,
            process.env['PROGRAMFILES(X86)']
        ].filter(p => !!p);

        for (const prefix of prefixes) {
            for (const suffix of suffixes) {
                possiblePaths.push(path.join(prefix, suffix));
            }
        }
    } else if (platform === 'linux') {
        possiblePaths = [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable'
        ];
    }

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }
    return null;
}

module.exports = { getChromiumPath };
