const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');

async function getAuthToken() {
    console.log("Launching browser for login...");
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    let authToken = null;

    // Listen for requests to capture the Authorization header
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        const headers = request.headers();
        if (headers['authorization']) {
            console.log(`\n[DEBUG] Auth header found on ${request.url()}: ${headers['authorization'].substring(0, 30)}...`);
            if (headers['authorization'].startsWith('Bearer ')) {
                // We found a bearer token!
                // Relaxed filter for debugging
                if (!authToken) {
                    authToken = headers['authorization'];
                    console.log("\n>>> TOKEN FOUND! <<<");
                    console.log(authToken.substring(0, 20) + "...");
                }
            }
        }
        request.continue();
    });

    console.log("Navigating to https://opal.google ...");
    await page.goto('https://opal.google', { waitUntil: 'networkidle2' });

    // Login logic
    try {
        const email = "kadesimo@diigimon.com";
        const password = "Genshin123";

        console.log("Waiting for Sign In button...");

        // 1. Trigger Sign In and Helper to catch Popup
        const newPagePromise = new Promise(x => browser.once('targetcreated', target => x(target.page())));

        // Logic to find and click the sign in button (similar to before, but condensed)
        const performClick = async () => {
            // check if we are on landing page and need to click "Sign in"
            try {
                // fast check for email field in main frame - if found early, no need to click
                const emailSelector = 'input[type="email"]';
                if (await page.$(emailSelector)) return null; // Already on login page

                console.log("Email field not found. Looking for Sign In button...");

                // Check iframe
                const frameElement = await page.$('#opal-app');
                let frame = null;
                if (frameElement) {
                    console.log("Found #opal-app iframe. Switching to frame...");
                    frame = await frameElement.contentFrame();
                }

                const searchAndClick = async (scope, scopeName) => {
                    const loginButton = await scope.$('a[href*="accounts.google.com"]');
                    if (loginButton) {
                        console.log(`Found Sign In button (href) in ${scopeName}. Clicking...`);
                        await loginButton.click();
                        return true;
                    }
                    const buttons = await scope.$$('button, a');
                    console.log(`[DEBUG] Scanning ${buttons.length} buttons/links in ${scopeName}...`);
                    for (const btn of buttons) {
                        const t = await scope.evaluate(el => (el.textContent || el.innerText || "").trim().toLowerCase(), btn);
                        // console.log(`[DEBUG] Button text: "${t}"`); // Uncomment if needed, but might be spammy
                        if (t === "sign in" || t === "log in") {
                            console.log(`Found Sign In button ("${t}") in ${scopeName}. Clicking...`);
                            try {
                                await btn.click();
                            } catch (e) {
                                console.log("Standard click failed, trying evaluate click...", e.message);
                                await scope.evaluate(el => el.click(), btn);
                            }
                            return true;
                        }
                    }
                    return false;
                };

                let clicked = await searchAndClick(page, "main page");
                if (!clicked && frame) clicked = await searchAndClick(frame, "iframe");

                return clicked;
            } catch (e) {
                console.log("Error finding sign in button:", e);
            }
        };

        const clicked = await performClick();
        let loginPage = page;

        if (clicked) {
            console.log("Sign in clicked. Waiting for popup or navigation...");

            await new Promise(r => setTimeout(r, 1000));
            await page.screenshot({ path: 'debug_click_signin.png' });

            // Wait for a new target (popup) with a timeout
            try {
                const newTarget = await browser.waitForTarget(target => target.opener() === page.target(), { timeout: 10000 });
                if (newTarget) {
                    console.log(">>> POPUP DETECTED (via waitForTarget)! Switching context to popup <<<");
                    loginPage = await newTarget.page();
                    if (!loginPage) {
                        // Sometimes the page is not immediately available
                        await new Promise(r => setTimeout(r, 1000));
                        loginPage = await newTarget.page();
                    }
                }
            } catch (e) {
                console.log("No new target detected within timeout. Assuming same-page or already processed.");
            }

            if (loginPage && loginPage !== page) {
                // Ensure the popup loads
                await loginPage.waitForNetworkIdle({ timeout: 10000 }).catch(() => { });

                // Attach request interception to popup as well
                await loginPage.setRequestInterception(true);
                loginPage.on('request', (request) => {
                    const headers = request.headers();
                    if (headers['authorization']) {
                        console.log(`\n[DEBUG] Auth header found on ${request.url()}: ${headers['authorization'].substring(0, 30)}...`);
                        if (headers['authorization'].startsWith('Bearer ')) {
                            if (!authToken) {
                                authToken = headers['authorization'];
                                console.log("\n>>> TOKEN FOUND (in popup)! <<<");
                                console.log(authToken.substring(0, 20) + "...");
                            }
                        }
                    }
                    request.continue();
                });
            } else {
                console.log("Working on Main Page context (no popup/new target found).");
            }
        }

        // 2. Email
        const emailSelector = 'input[type="email"]';
        console.log(`Waiting for email field on ${loginPage === page ? "main page" : "popup"}...`);
        await loginPage.waitForSelector(emailSelector, { visible: true, timeout: 10000 });

        console.log("Auto-filling email...");
        await loginPage.type(emailSelector, email, { delay: 50 });
        await new Promise(r => setTimeout(r, 500));

        console.log("Clicking Next...");
        const nextButtonSelector = '#identifierNext button';
        const nextBtn = await loginPage.$(nextButtonSelector);
        if (nextBtn) await nextBtn.click();
        else await loginPage.keyboard.press('Enter');

        // 3. Password
        console.log("Waiting for password field...");
        const passwordSelector = 'input[type="password"]';
        await loginPage.waitForSelector(passwordSelector, { visible: true, timeout: 10000 });
        await new Promise(r => setTimeout(r, 1500));

        console.log("Auto-filling password...");
        await loginPage.type(passwordSelector, password, { delay: 50 });
        await new Promise(r => setTimeout(r, 500));

        console.log("Clicking Next (Password)...");
        const passwordNextSelector = '#passwordNext button';
        const pwNextBtn = await loginPage.$(passwordNextSelector);
        if (pwNextBtn) await pwNextBtn.click();
        else await loginPage.keyboard.press('Enter');

        console.log("Password submitted. Waiting for completion or consent screen...");

        // Check for "Continue" button (Consent screen)
        console.log("Checking for consent screen (polling)...");
        try {
            // Poll for up to 30 seconds for ANY consent buttons (there might be multiple screens)
            const startTime = Date.now();
            let clickedConsent = false;

            while (Date.now() - startTime < 30000) {
                // Check if popup is already closed
                if (loginPage.isClosed()) {
                    console.log("Popup closed detected (loop check).");
                    break;
                }

                const continueBtn = await loginPage.evaluateHandle(() => {
                    // Include input[type="submit"] which is what "Saya mengerti" uses
                    const buttons = Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"], input[type="submit"]'));

                    return buttons.find(b => {
                        const t = (b.innerText || b.value || "").toLowerCase(); // Check value for input inputs
                        // Ignore "Cancel" or "Batal"
                        if (t.includes("cancel") || t.includes("batal")) return false;

                        return t.includes("continue") ||
                            t.includes("lanjutkan") ||
                            t.includes("allow") ||
                            t.includes("izinkan") ||
                            t.includes("saya mengerti") ||
                            t.includes("i understand") ||
                            t === "next" || t === "berikutnya";
                    });
                });

                if (continueBtn && continueBtn.asElement()) {
                    console.log("Found Consent/Continue button. Clicking...");
                    try {
                        await continueBtn.asElement().click();
                        clickedConsent = true;
                        // Wait for the click to produce a change (new page or popup close)
                        console.log("Clicked. Waiting for navigation/update...");
                        await new Promise(r => setTimeout(r, 3000));
                        continue; // Check again in case there is another screen
                    } catch (e) {
                        console.log("Error clicking consent button (might have closed):", e.message);
                    }
                }

                // If we didn't find a button, wait a bit
                await new Promise(r => setTimeout(r, 1000));
            }

            if (!clickedConsent) {
                console.log("No consent button found within timeout.");
            }

        } catch (e) {
            console.log("Error checking for consent button:", e);
        }

        if (loginPage !== page) {
            console.log("Popup interactions done. Waiting for popup to close...");
            // Poll for popup closure
            const popupTargetId = loginPage.target()._targetId;
            // Note: _targetId is internal, but we can check isClosed()

            let attempts = 0;
            while (!loginPage.isClosed() && attempts < 30) {
                await new Promise(r => setTimeout(r, 1000));
                attempts++;
            }

            if (loginPage.isClosed()) {
                console.log("Popup closed successfully.");
            } else {
                console.log("Popup did not close automatically. It might need manual closure or more interaction.");
                console.log("Taking screenshot of STUCK popup...");
                try {
                    await loginPage.screenshot({ path: 'debug_stuck_popup.png' });
                } catch (e) {
                    console.log("Failed to take popup screenshot:", e);
                }
            }

            // Wait for main page to possibly update itself
            await new Promise(r => setTimeout(r, 5000));

            console.log("Reloading main page to force token fetch...");
            await page.reload({ waitUntil: 'networkidle2' });

            // Wait a bit
            await new Promise(r => setTimeout(r, 5000));

            console.log("Taking debug screenshot...");
            await page.screenshot({ path: 'debug_after_login.png' });

            console.log("Considering iframe context...");
            // Check if iframe exists and look inside
            const frameElement = await page.$('#opal-app');
            let frame = page;
            if (frameElement) {
                console.log("Found #opal-app iframe. Switching to frame for post-login checks...");
                frame = await frameElement.contentFrame();
            }

            console.log("Checking LocalStorage (in frame)...");
            const localStorageData = await frame.evaluate(() => JSON.stringify(localStorage));
            console.log("LocalStorage:", localStorageData.substring(0, 200) + "...");

            console.log("Checking SessionStorage (in frame)...");
            const sessionStorageData = await frame.evaluate(() => JSON.stringify(sessionStorage));
            console.log("SessionStorage:", sessionStorageData.substring(0, 200) + "...");

            // Log all buttons
            console.log("Scanning frame for buttons...");
            const buttons = await frame.$$eval('button, a', els => els.map(el => {
                return {
                    tag: el.tagName,
                    text: (el.textContent || "").trim(),
                    id: el.id,
                    class: el.className
                };
            }));
            console.log("Buttons found:", JSON.stringify(buttons, null, 2));

        } else {
            await loginPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => { });
        }

    } catch (e) {
        console.log("Auto-login error:", e.message);
        try {
            if (browser.isConnected()) {
                const pages = await browser.pages();
                const lastPage = pages[pages.length - 1]; // Likely the popup
                if (lastPage) {
                    console.log("Taking error screenshot of last page...");
                    await lastPage.screenshot({ path: 'debug_error.png' });
                }
            }
        } catch (err) { console.log("Failed to take error screenshot", err); }
    }

    console.log("Waiting for token capture...");

    // Wait until we have the token
    const maxWaitTime = 60000; // 60 seconds
    const startTime = Date.now();

    while (!authToken) {
        if (Date.now() - startTime > maxWaitTime) {
            console.log("Timeout waiting for token.");
            break;
        }
        await new Promise(r => setTimeout(r, 1000));

        if (browser.isConnected() === false) {
            console.log("Browser closed by user.");
            break;
        }
    }

    if (authToken) {
        console.log("Successfully retrieved auth token.");
    } else {
        console.log("Failed to retrieve token.");
    }

    await browser.close();
    return authToken;
}

if (require.main === module) {
    getAuthToken().then(token => {
        if (token) {
            console.log("Full Token:", token);
        }
    });
}

module.exports = { getAuthToken };
