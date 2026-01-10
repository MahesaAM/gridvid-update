const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

const { getChromiumPath } = require('./chromium-utils');
const {
    sanitize, clearAndType, clickFast, waitAndClick,
    handleSplash, handleTOS, handleAutoSaveModal,
    handleDriveAccess, checkQuota, safeRemoveAccount,
    getOpalFrame, waitForShadowSelector
} = require('./common-utils');

puppeteer.use(StealthPlugin());


const BASE_SIGNIN_URL = 'https://accounts.google.com/v3/signin/identifier?authuser=0&continue=https%3A%2F%2Fmyaccount.google.com%2Fgeneral-light&ec=GAlAwAE&hl=in&service=accountsettings&flowName=GlifWebSignIn&flowEntry=AddSession';
const OPAL_URL = 'https://opal.google/?flow=drive:/1ZuZkom0kWc1wdmRZw_hy0xBd_8T1NB5J&shared&mode=app';

async function waitForVerification(page, timeout = 20000) {
    try {
        await Promise.race([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout }),
            page.waitForFunction(() => {
                return !document.location.href.includes('/signin/challenge') &&
                    !document.querySelector('div[data-challenge]');
            }, { timeout, polling: 200 }),
            new Promise(resolve => setTimeout(resolve, timeout)).then(() => { throw new Error('Verification timeout') })
        ]);
    } catch (err) {
        if (err.message === 'Verification timeout') throw err;
        throw err;
    }
}

async function waitForCaptcha(page, timeout = 30000) {
    try {
        await Promise.race([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout }),
            page.waitForFunction(() => {
                return !document.querySelector('iframe[src*="recaptcha"]') &&
                    !document.querySelector('div#recaptcha') &&
                    !document.location.href.includes('/signin/captcha');
            }, { timeout, polling: 200 }),
            new Promise(resolve => setTimeout(resolve, timeout)).then(() => { throw new Error('Captcha timeout') })
        ]);
    } catch (err) {
        if (err.message === 'Captcha timeout') throw err;
        throw err;
    }
}

async function handleOne(page, browser, { email, password }, logCallback = console.log) {
    // Navigate to Opal first as requested
    logCallback(`Navigating to Opal for login: ${email}`);
    await page.goto(OPAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2000); // Wait for load

    // Check if we are already logged in (Start button visible and NO sign-in modal)
    // Actually the user says: click Start -> Modal -> Sign In

    // 1. Click Start
    try {
        logCallback('Looking for Start button...');
        // Get iframe context
        const frame = await getOpalFrame(page);

        // Try multiple selectors or text
        // Try multiple selectors or text
        const startBtnSelectors = [
            'button#run',
            'button[aria-label="Start"]',
            'button[aria-label="Mulai"]',
            '//button[contains(., "Start")]',
            '//button[contains(., "Mulai")]',
            '//div[@role="button"][contains(., "Start")]',
            '//div[@role="button"][contains(., "Mulai")]'
        ];

        let startBtn = null;

        // 1. Try Shadow DOM first
        try {
            logCallback('Checking Shadow DOM for Start button...');
            const shadowBtn = await waitForShadowSelector(frame, 'bb-main', 'button#run', 3000);
            if (shadowBtn) {
                startBtn = shadowBtn;
                logCallback('Found Start button inside Shadow DOM!');
            }
        } catch (e) { }

        if (!startBtn) {
            for (const sel of startBtnSelectors) {
                try {
                    if (sel.startsWith('//')) {
                        const el = await frame.waitForSelector("xpath/" + sel, { visible: true, timeout: 3000 });
                        if (el) {
                            startBtn = el;
                            logCallback(`Found Start button with selector: ${sel}`);
                            break;
                        }
                    } else {
                        const el = await frame.waitForSelector(sel, { visible: true, timeout: 3000 });
                        if (el) {
                            startBtn = el;
                            logCallback(`Found Start button with selector: ${sel}`);
                            break;
                        }
                    }
                } catch (e) { }
            }
        }

        if (startBtn) {
            await startBtn.click();
            await sleep(1000);
        } else {
            throw new Error('Start button not found with any selector');
        }

    } catch (e) {
        logCallback(`Start button not found in iframe: ${e.message}`);
        // Take a debug screenshot if possible
        try {
            const debugPath = path.join(process.cwd(), 'debug-opal-start.png');
            await page.screenshot({ path: debugPath });
            logCallback(`Saved debug screenshot to ${debugPath}`);
        } catch (err) { }
    }

    // 2. Check for Sign in with Google modal/button
    try {
        const signInBtnSelector = 'button#sign-in-button';
        const signInBtn = await page.$(signInBtnSelector);

        if (signInBtn && await signInBtn.isVisible()) {
            logCallback('Clicking "Sign in with Google"...');
            await signInBtn.click();
            await sleep(2000);

            // This usually opens a popup or redirects. 
            // If popup, Puppeteer needs to target the new page. 
            // Often with these flows, it might redirect the current page.

            // Wait for navigation or check for google login
            // If it's a popup, we need to find the new target.
        }
    } catch (e) {
        logCallback(`Sign-in button check/click failed or not needed: ${e.message}`);
    }

    // Now ensuring we are on Google Login Page
    // If not, maybe we need to force it or we are already there?
    // If we are still on Opal, wait a bit.

    let currentUrl = page.url();
    if (!currentUrl.includes('accounts.google.com')) {
        // Maybe popup opened?
        const pages = await browser.pages();
        const loginPage = pages.find(p => p.url().includes('accounts.google.com'));
        if (loginPage) {
            logCallback('Switched to detected login popup page.');
            page = loginPage;
            // Bring to front
            await page.bringToFront();
        } else {
            // If still not there, maybe we are already logged in? 
            // Or maybe we should force navigation if the click failed?
            // But the user said "maka akan muncul popup login google"
        }
    }

    await clearAndType(page, 'input[type=email], #identifierId', email);
    await page.waitForSelector('#identifierNext', { visible: true, timeout: 5000 });

    await clickFast(page, '#identifierNext');
    // Removed waitForNavigation to allow error catching without timeouts


    // Race condition: Wait for Password Field (Success) OR Error Message (Failure)
    const passwordSelector = 'input[type=password], input[name=Passwd]';
    const errorSelector = 'div.o6cuMc, div[jsname="B34EJ"], div[aria-live="assertive"]';
    const iconErrorSelector = 'div.LXRPh, svg.stUf5b';

    let result = 'checking';
    try {
        await page.waitForSelector(passwordSelector, { visible: true, timeout: 6000 });
        result = 'password';
    } catch (e) {
        result = 'timeout';
    }

    if (result === 'password') {
        // Found password, proceed
    } else {
        // Error detected - verify it's a real error
        const errorText = await page.evaluate((sel1, sel2) => {
            const el1 = document.querySelector(sel1);
            // Check if el1 is actually visible and has meaningful text
            const text = el1 ? el1.textContent.trim() : '';

            const el2 = document.querySelector(sel2);
            const iconVisible = el2 && el2.getBoundingClientRect().width > 0;

            return { text, iconVisible };
        }, errorSelector, iconErrorSelector);

        console.log(`DEBUG: Email Validation Result: ${result}`);
        console.log(`DEBUG: Error Text: "${errorText.text}"`);
        console.log(`DEBUG: Icon Visible: ${errorText.iconVisible}`);

        // Strict check: It's only invalid if meaningful error text matches common Google error
        // OR if the specific error icon is definitely visible
        const isUnknownEmail = errorText.text.includes("Couldn't find your Google Account") ||
            errorText.text.includes("Enter a valid email") ||
            errorText.iconVisible;

        if (isUnknownEmail) {
            logCallback(`❌ Invalid Email detected: ${email}. Reason: ${result} - ${errorText.text}`);
            safeRemoveAccount(email, logCallback);
            await page.close();
            return { success: false, reason: 'Invalid Email' };
        } else {
            console.log('⚠️ Warning detected but text does not indicate invalid email. Proceeding cautiously...');
            // Maybe it was just a "loading" or "info" assertive message.
            // We should try to wait for password again or just proceed to check if password field eventually appears
            try {
                await page.waitForSelector(passwordSelector, { visible: true, timeout: 5000 });
                console.log('✔️ Password field found after false alarm.');
            } catch {
                // If still no password, then maybe it really failed?
                logCallback(`❌ Failed to find password field after warning. Assuming failure. Text: ${errorText.text}`);
                // Don't remove account yet if unsure, just fail this login
                await page.close();
                return { success: false, reason: 'Login flow failed (Ambiguous)' };
            }
        }
    }

    // --- CRITICAL FIX: TYPE PASSWORD ---
    // Previously the code detected the password field but forgot to type into it!
    if (result === 'password') {
        try {
            logCallback('Typing password...');
            // Small settle time for animation
            await new Promise(r => setTimeout(r, 1000));

            // Type password using robust utility
            await clearAndType(page, passwordSelector, password);
            await new Promise(r => setTimeout(r, 800)); // Wait for valid input state

            // Click Next with robust wait
            logCallback('Clicking "Next" after password...');
            const nextBtnSelectors = ['#passwordNext', 'button[jsname="LgbsSe"]', '#passwordNext button'];

            let clicked = false;
            for (const sel of nextBtnSelectors) {
                try {
                    const btn = await page.$(sel);
                    if (btn && await btn.boundingBox()) {
                        await clickFast(page, sel);
                        clicked = true;
                        break;
                    }
                } catch (e) { }
            }

            if (!clicked) {
                // Fallback: Press Enter
                logCallback('Next button not found/clickable, pressing Enter...');
                await page.keyboard.press('Enter');
            }

            // Wait for navigation or verification
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => {
                console.log('Observation: Navigation wait timeout after password (might be normal if SPA transition).');
            });

        } catch (e) {
            logCallback(`Error typing password: ${e.message}`);
            return { success: false, reason: 'Password entry failed' };
        }
    }
    // -----------------------------------



    // Helper sleep since not imported
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // Handle initial "Use another account" if text exists
    // User said: "click gunakan akun lain di popup nya"
    try {
        // Common selectors for "Use another account"
        const specificSel = 'div[role="link"][data-identifier]'; // sometimes used?
        const textBasedXPath = "//*[contains(text(), 'Use another account') or contains(text(), 'Gunakan akun lain')]";

        // Wait briefly to see if we are on the account chooser
        await page.waitForSelector(textBasedXPath, { timeout: 3000, visible: true }).then(async (el) => {
            if (el) {
                logCallback('Clicking "Use another account"...');
                await el.click();
                await sleep(1000);
            }
        }).catch(() => { });

        // Or check standard selector
        const useAnotherBtn = await page.$('div[role="button"]'); // vague, better rely on text or specific structure if known.
        // Actually the standard Google account chooser often has a list.
        // If we see an email that is NOT ours, we click "Use another account".

    } catch (e) { }

    await clearAndType(page, 'input[type=email], #identifierId', email);
    await page.waitForSelector('#identifierNext', { visible: true, timeout: 5000 });

    await clickFast(page, '#identifierNext');

    // ... rest of logic

    // NOTE: If we switched pages (popup), we must ensure we don't crash later.
    // However, since we return { success: true/false }, the caller just wants to know if login worked.
    // The browser object is passed in runLoginAll.


    // Captcha
    const isCaptchaPage = await page.$('iframe[src*="recaptcha"]') ||
        await page.$('div#recaptcha') ||
        page.url().includes('/signin/captcha');
    if (isCaptchaPage) {
        logCallback(`ℹ️ Captcha challenge detected for ${email}`);
        try {
            await waitForCaptcha(page);
            if (!page.url().startsWith('https://myaccount.google.com/general-light')) {
                await page.goto('https://myaccount.google.com/general-light', { waitUntil: 'domcontentloaded' });
            }
        } catch {
            await page.close();
            return { success: false, reason: 'Captcha timeout' };
        }
    }

    // Verification
    const isVerificationPage = await page.$('div[data-challenge="phone"]') ||
        await page.$('div#phoneNumberChallenged') ||
        page.url().includes('/signin/challenge/dp');
    if (isVerificationPage) {
        logCallback(`ℹ️ Device verification required for ${email}`);
        try {
            await waitForVerification(page);
            if (!page.url().startsWith('https://myaccount.google.com/general-light')) {
                await page.goto('https://myaccount.google.com/general-light', { waitUntil: 'domcontentloaded' });
            }
        } catch {
            const currentUrl = page.url();
            if (currentUrl.startsWith('https://accounts.google.com/v3/signin/challenge/pwd?') || currentUrl.includes('/signin/challenge/dp')) {
                logCallback('ℹ️ Verification needed, keeping page open.');
                return; // User intervention needed
            }
            await page.close();
            return { success: false, reason: 'Verification timeout' };
        }
    }

    // Speedbump
    if (page.url().includes('/speedbump/')) {
        await clickFast(page, 'input#confirm, input[jsname="M2UYVd"]');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
    }

    // Handle "Welcome to Chrome" / "Continue" profile confirmation
    // Often appears with buttons "No thanks", "Yes, I'm in", "Continue", "OK"
    try {
        await Promise.race([
            page.waitForSelector('button[jsname="NOT_REAL_SELECTOR_JUST_WAIT"]', { timeout: 2000 }), // dummy wait
            path.includes('signin/v2/challenge/pwd') ? new Promise(r => setTimeout(r, 100)) : null
        ]);

        // Common selectors for "No thanks" or "Continue" in login flow
        const continueSelectors = [
            'button[jsname="LgbsSe"]', // "Not now" often
            'button[jsname="Qfl Bv"]', // "No thanks"
            'div[role="button"][data-highlighted="true"]', // "Continue" sometimes
            '//button[contains(., "No thanks")]',
            '//button[contains(., "Lanjutkan")]', // ID language
            '//button[contains(., "Continue")]',
            '//span[contains(text(), "No thanks")]/ancestor::button',
            '//span[contains(text(), "Lain kali")]/ancestor::button',
        ];

        for (const sel of continueSelectors) {
            if (sel.startsWith('//')) {
                // XPath replacement
                const btn = await page.evaluateHandle((xpath) => {
                    const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    return result.singleNodeValue;
                }, sel);

                if (btn.asElement()) {
                    const isVisible = await btn.asElement().boundingBox();
                    if (isVisible) {
                        logCallback('ℹ️ Handling Profile/Sync confirmation...');
                        await btn.asElement().click();
                        await sleep(2000);
                        break;
                    }
                }
            } else {
                const btn = await page.$(sel);
                if (btn) {
                    const isVisible = await btn.boundingBox();
                    if (isVisible) {
                        logCallback('ℹ️ Handling Profile/Sync confirmation...');
                        await btn.click();
                        await sleep(2000);
                        break;
                    }
                }
            }
        }
    } catch (e) {
        // Ignore, just a check
    }

    // GDS landing
    if (page.url().startsWith('https://gds.google.com/web/landing')) {
        await waitAndClick(page, 'button[jsname="ZUkOIc"]', { timeout: 5000 }).catch(() => { });
        await waitAndClick(page, 'button[jsname="bySMBb"]', { timeout: 5000 }).catch(() => { });
        await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
    }

    // General Light -> Opal
    if (page.url().startsWith('https://myaccount.google.com/general-light')) {
        const OPAL_URL = 'https://opal.google/?flow=drive:/1ZuZkom0kWc1wdmRZw_hy0xBd_8T1NB5J&shared&mode=app';
        await page.goto(OPAL_URL, { waitUntil: 'domcontentloaded' });

        // Check for Opal specific elements to confirm we are mostly there
        try {
            await page.waitForSelector('button#run', { timeout: 15000 });
            logCallback('✔️ Opal interface loaded.');
        } catch (e) {
            logCallback(`⚠️ Warning: Opal 'Start' button not found immediately. Url is: ${page.url()}`);
        }

        // We assume success if we reached here
        return { success: true };
    }
}

async function runLoginAll(accounts, logCallback = console.log, options = {}) {
    const { userDataDir } = options;
    // We expect userDataDir to be the root for profiles, but let's stick to the structure
    // The user code used CUSTOM_ROOT or app.getPath('userData')
    // We'll accept profilesRoot as an option

    const profilesRoot = options.profilesRoot || path.join(process.cwd(), 'profiles');
    const chromiumPathVal = await getChromiumPath();

    const results = [];

    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        const profDir = path.resolve(profilesRoot, sanitize(acc.email));

        if (fs.existsSync(profDir)) {
            // For login, we clear it to force fresh login? User code did fs.rmdirSync
            try {
                fs.rmSync(profDir, { recursive: true, force: true });
            } catch (e) { }
        }
        fs.mkdirSync(profDir, { recursive: true });
        fs.writeFileSync(path.join(profDir, 'email.txt'), acc.email);

        logCallback(`Processing [${i + 1}/${accounts.length}] ${acc.email}`);

        let browser;
        try {
            browser = await puppeteer.launch({
                headless: false,
                executablePath: chromiumPathVal.path,
                userDataDir: profDir,
                args: [
                    `--user-data-dir=${profDir}`,
                    '--disable-notifications',
                    '--disable-infobars',
                    '--disable-blink-features=AutomationControlled',
                    '--excludeSwitches=enable-automation',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--lang=in-ID',
                    '--start-maximized'
                ],
                defaultViewport: null
            });

            const page = await browser.newPage();
            const result = await handleOne(page, browser, acc, logCallback);

            if (result && !result.success) {
                results.push({ email: acc.email, success: false, error: result.reason });
                // browser might be closed in handleOne
            } else {
                results.push({ email: acc.email, success: true, browser });
                // Keep open if requested
                if (!options.keepBrowserOpen) {
                    logCallback(`✔️ Login successful for ${acc.email}. Saving profile...`);
                    // Sleep to ensure profile data is written
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await browser.close();
                }
            }

        } catch (err) {
            logCallback(`Error: ${err.message}`);
            results.push({ email: acc.email, success: false, error: err.message });
            if (browser) await browser.close();
        }
    }
    return results;
}

module.exports = { runLoginAll, loginGoogleAccount: handleOne };
