const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// Sanitize email to use as folder name
function sanitize(email) {
    return email.replace(/[@.]/g, '_');
}

function safeRemoveAccount(email, logCallback = console.log) {
    try {
        const accountsFile = path.join(app.getPath('userData'), 'accounts.json');
        if (fs.existsSync(accountsFile)) {
            const raw = fs.readFileSync(accountsFile, 'utf8');
            let list = JSON.parse(raw);
            const initialLen = list.length;
            list = list.filter(a => a.email !== email);
            if (list.length < initialLen) {
                fs.writeFileSync(accountsFile, JSON.stringify(list, null, 2));
                logCallback(`Removed ${email} from saved accounts file.`);
            }
        }
    } catch (e) {
        logCallback(`⚠️ Failed to remove account from file: ${e.message}`);
    }
}

// Clear existing value and type text quickly
// Clear existing value and type text quickly
async function clearAndType(page, selector, text, timeout = 30000) {
    try {
        await page.waitForSelector(selector, { visible: true, timeout });
        const el = await page.$(selector);

        // Ensure element is enabled
        await page.waitForFunction(el => !el.disabled, {}, el);

        // 1. Focus
        await el.focus();

        // 2. Clear (Select all + Backspace is most reliable for React/Angular inputs)
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');

        // 3. Type
        // For password, type slower
        const isPassword = selector.includes('password') || selector.includes('Passwd');
        const delay = isPassword ? 100 : 20;

        await el.type(text, { delay });

        // 4. Verification (Optional but good for stability)
        // If it's a password field, we can't easily check value without evaluation, 
        // but for email we can.
        if (!isPassword) {
            const val = await page.evaluate(e => e.value, el);
            if (val !== text) {
                // Fallback: Force value via JS if typing failed (less human but works)
                // Only do this if normal typing failed
                console.log(`[clearAndType] Mismatch detected. JS forcing value...`);
                await page.evaluate((e, t) => { e.value = t; e.dispatchEvent(new Event('input', { bubbles: true })); }, el, text);
            }
        }
    } catch (e) {
        console.warn(`[clearAndType] Error interacting with ${selector}: ${e.message}`);
        throw e;
    }
}

// Simulate human-like mouse movement
async function humanMove(page, element) {
    const box = await element.boundingBox();
    if (!box) return;
    // Add some random offset from center
    const x = box.x + box.width / 2 + (Math.random() * 10 - 5);
    const y = box.y + box.height / 2 + (Math.random() * 10 - 5);
    // Speed optimization: Use 2 steps for "fast but smooth" movement to ensure events fire
    await page.mouse.move(x, y, { steps: 2 });
    return { x, y };
}

async function waitAndClick(page, selector, opts = {}) {
    const timeout = opts.timeout || 5000;
    await page.waitForSelector(selector, { visible: true, timeout });
    const el = await page.$(selector);
    // Human move
    // Human move
    await humanMove(page, el);
    // Speed optimization: Minimal delay but safe
    await page.evaluate(() => new Promise(r => setTimeout(r, 20 + Math.random() * 30)));
    await page.click(selector, { delay: 20 + Math.random() * 30 });
}

// Click element with human-like behavior (trusted event) instead of synthetic
async function clickFast(page, selector, timeout = 5000) {
    await page.waitForSelector(selector, { visible: true, timeout });
    const el = await page.$(selector);
    // Small delay and move
    await humanMove(page, el);
    // Speed optimization: Minimal delay but safe
    await page.evaluate(() => new Promise(r => setTimeout(r, 20 + Math.random() * 30)));
    await page.click(selector, { delay: 20 + Math.random() * 30 });
}

async function checkQuota(page, timeout = 5000) {
    try {
        const selector = 'ms-quota-count > div > span';
        await page.waitForSelector(selector, { timeout });
        const quotaText = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            return el ? el.textContent.trim() : null;
        }, selector);

        if (quotaText) {
            // Format is likely "X/Y" or just "X"
            const match = quotaText.match(/(\d+)/);
            if (match) {
                return parseInt(match[1]);
            }
        }
        return null;
    } catch (err) {
        // If element not found, assume quota is unknown or handling it elsewhere
        return null;
    }
}

async function handleSplash(page) {
    try {
        const splashSelector = 'mat-dialog-container';
        // Wait briefly for it, don't block long if it doesn't appear
        await page.waitForSelector(splashSelector, { timeout: 1000 });
        const btn = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.find(b => (b.textContent.includes('Try Gemini') || b.textContent.includes('Use Google AI Studio')));
        });
        if (btn.asElement()) {
            await btn.asElement().click();
            await page.waitForSelector(splashSelector, { hidden: true, timeout: 3000 });
        }
    } catch { }
}

async function handleTOS(page) {
    try {
        await page.waitForSelector('#mat-mdc-checkbox-0-input', { timeout: 3000 });
        await page.click('#mat-mdc-checkbox-0-input');
        if (await page.$('#mat-mdc-checkbox-1-input')) {
            await page.click('#mat-mdc-checkbox-1-input');
        }
        await waitAndClick(page, 'button[aria-label="Accept terms of service"]', { timeout: 5000 });
        await page.waitForSelector('#mat-mdc-checkbox-0-input', { hidden: true, timeout: 5000 });
    } catch { }
}

async function handleAutoSaveModal(page) {
    try {
        await page.waitForFunction(() => {
            const modalText = document.body.textContent || '';
            return modalText.includes('Auto-save is now enabled by default') &&
                modalText.includes('Got it');
        }, { timeout: 1000 });

        // Human-like click for "Got it"
        const gotItHandle = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.find(b => b.textContent.trim().toLowerCase().includes('got it'));
        });

        if (gotItHandle.asElement()) {
            try {
                // Try human move first
                await humanMove(page, gotItHandle.asElement());
                await gotItHandle.asElement().click({ delay: Math.random() * 50 + 30 });
                return true;
            } catch (e) {
                // Fallback to JS click
                await page.evaluate(el => el.click(), gotItHandle.asElement());
                return true;
            }
        } else {
            // Fallback CSS
            const cssButton = await page.$('button.ms-button-primary');
            if (cssButton) {
                const buttonText = await page.evaluate(el => el.textContent.trim(), cssButton);
                if (buttonText.toLowerCase().includes('got it')) {
                    try {
                        await humanMove(page, cssButton);
                        await cssButton.click({ delay: Math.random() * 50 + 30 });
                    } catch (e) {
                        await page.evaluate(el => el.click(), cssButton);
                    }
                    return true;
                }
            }
        }
    } catch (err) { }
    return false;
}

async function handleDriveAccess(page, email) {
    console.log('[handleDriveAccess] Starting user-provided logic...');
    // 1. Add retry mechanism for initial button
    let btn;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            // Try multiple selectors for the "Enable saving" button
            try {
                btn = await page.waitForSelector('button.enable-drive-button', {
                    visible: true,
                    timeout: 5000
                });
            } catch (err) {
                // Fallback to XPath selector for text content
                // Fallback to text matching
                const xpathBtn = await page.evaluateHandle(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    return buttons.find(b => {
                        const text = b.textContent.trim().toLowerCase();
                        return text.includes('enable saving') ||
                            (text.includes('save') && text.includes('auto') && text.includes('drive'));
                    });
                });
                if (xpathBtn.asElement()) {
                    btn = xpathBtn.asElement();
                } else {
                    throw new Error('Enable saving button not found');
                }
            }
            break;
        } catch (err) {
            if (attempt === 3) {
                console.warn(`⚠️ Drive button not found after ${attempt} attempts`);
                return;
            }
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // 2. Enhanced popup handling
    const popupPromise = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error('Popup timeout')), 15000);
        page.browser().on('targetcreated', async target => {
            const url = target.url();
            if (target.type() === 'page' && (url.includes('accounts.google.com') || url === 'about:blank')) {
                // Wait a bit if it's about:blank to see if it redirects
                if (url === 'about:blank') await new Promise(r => setTimeout(r, 1000));

                // Re-check url logic
                try {
                    const p = await target.page();
                    if (p && p.url().includes('accounts.google.com')) {
                        clearTimeout(timeoutId);
                        resolve(p);
                    }
                } catch (e) { }
            }
        });
    });

    // 3. Improved click handling
    try {
        console.log('[handleDriveAccess] Clicking Enable Saving...');
        await btn.click();
    } catch (err) {
        // Fallback click methods
        try {
            await page.evaluate(el => el.click(), btn);
        } catch {
            const box = await btn.boundingBox();
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        }
    }

    // 4. Handle confirmation dialog with retry
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const confirmBtn = await page.waitForSelector('button[matdialogclose], button.confirm-button', {
                visible: true,
                timeout: 3000
            });
            await confirmBtn.click();
            await page.waitForSelector('button[matdialogclose]', { hidden: true, timeout: 5000 });
            break;
        } catch (err) {
            if (attempt === 3) console.warn('⚠️ No confirmation dialog found (this is often normal)');
        }
    }

    // 5. Enhanced popup handling with timeout
    let popup;
    try {
        console.log('[handleDriveAccess] Waiting for popup...');
        popup = await popupPromise;
        console.log('[handleDriveAccess] Popup detected!');
    } catch (err) {
        console.error('⚠️ Failed to handle popup:', err.message);
        return;
    }

    // -------------------------------------------------------------
    // FAKE HEADLESS & DEBUG LOGIC (Injected into User's Code)
    // -------------------------------------------------------------
    try {
        await popup.waitForFunction(() => document.body && document.body.innerText.length > 0, { timeout: 15000 });

        // 1. Move to visible area (Requested Feature)
        await popup.evaluate(() => {
            window.moveTo(100, 100);
            window.resizeTo(600, 800);
            window.focus();
        });
        await new Promise(r => setTimeout(r, 1000)); // Settle

        // 2. Dump HTML for debug (Requested Feature)
        try {
            const html = await popup.content();
            const fs = require('fs');
            fs.writeFileSync('popup_debug.html', html);
        } catch (e) { }
    } catch (e) { console.log('Error in setup:', e); }
    // -------------------------------------------------------------

    // 6. Improved account selection
    try {
        console.log('[handleDriveAccess] Attempting account selection...');

        // Try user's UL/LI method first
        const ulHandle = await popup.$('ul');
        let clicked = false;

        if (ulHandle) {
            const liHandle = await ulHandle.$('li');
            if (liHandle) {
                console.log(`✔️ Found account list item. Clicking...`);
                try {
                    await liHandle.click();
                } catch {
                    try {
                        await popup.evaluate(el => el.click(), liHandle);
                    } catch {
                        const box = await liHandle.boundingBox();
                        await popup.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                    }
                }
                clicked = true;
                console.log(`✔️ First account selected successfully`);
            }
        }

        if (!clicked) {
            console.warn(`⚠️ Account list <ul> not found or empty. Checking fallback (Consent Screen)...`);
            // Fallback: Consent Screen (Allow/Continue) - Kept from previous fixes
            const consentBtn = await popup.evaluateHandle(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                return buttons.find(b => {
                    const t = b.textContent.trim().toLowerCase();
                    return ['allow', 'izinkan', 'continue', 'lanjutkan', 'trust'].some(k => t.includes(k)) || b.id === 'submit_approve_access';
                });
            });

            if (consentBtn.asElement()) {
                console.log('[Popup] Consent button FOUND. Clicking...');
                await popup.evaluate(el => el.click(), consentBtn.asElement());
                clicked = true;
            }
        }

        // Enhanced navigation waiting
        await Promise.race([
            popup.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }),
            popup.waitForNavigation({ waitUntil: 'load', timeout: 60000 }),
            new Promise(r => setTimeout(r, 5000))
        ]);

    } catch (err) {
        console.error('⚠️ Error during account selection:', err.message);
    } finally {
        if (popup && !popup.isClosed()) {
            try { await popup.close(); } catch { }
        }
    }

    // 9. Final verification
    try {
        // Wait for the "Enable saving" button to disappear using multiple selectors
        try {
            await page.waitForSelector('button.enable-drive-button', {
                hidden: true,
                timeout: 5000
            });
        } catch (err) {
            // Fallback: check if any button with "Enable saving" text is hidden
            await page.waitForFunction(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                return !buttons.some(btn => btn.textContent.includes('Enable saving') &&
                    btn.offsetParent !== null); // Check if visible
            }, { timeout: 5000 });
        }
        console.log('✔️ Drive access completed successfully');
    } catch (err) {
        console.warn('⚠️ Drive button still visible after process (might need manual check)');
    }
}

// Helper to get Opal iframe context
async function getOpalFrame(page, timeout = 30000) {
    const iframeSelector = 'iframe#opal-app';
    try {
        await page.waitForSelector(iframeSelector, { timeout });
        const elementHandle = await page.$(iframeSelector);
        const frame = await elementHandle.contentFrame();
        if (!frame) throw new Error('Opal iframe found but contentFrame is null');
        return frame;
    } catch (e) {
        throw new Error(`Failed to find Opal iframe: ${e.message}`);
    }
}

async function queryShadow(pageOrFrame, hostSelector, targetSelector) {
    return await pageOrFrame.evaluateHandle((hostSel, targetSel) => {
        const host = document.querySelector(hostSel);
        if (!host || !host.shadowRoot) return null;
        return host.shadowRoot.querySelector(targetSel);
    }, hostSelector, targetSelector);
}

async function waitForShadowSelector(pageOrFrame, hostSelector, targetSelector, timeout = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        const handle = await queryShadow(pageOrFrame, hostSelector, targetSelector);
        if (handle.asElement()) return handle;
        await new Promise(r => setTimeout(r, 200));
    }
    return null;
}

module.exports = {
    sanitize,
    safeRemoveAccount,
    clearAndType,
    waitAndClick,
    clickFast,
    checkQuota,
    handleSplash,
    handleTOS,
    handleAutoSaveModal,
    handleDriveAccess,
    humanMove,
    humanMove,
    getOpalFrame,
    queryShadow,
    waitForShadowSelector
};
