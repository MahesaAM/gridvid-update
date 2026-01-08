const fs = require('fs');
const path = require('path');
const { getOpalFrame } = require('./common-utils');

const { execFile } = require('child_process');

// robust-get-auth-token logic adapted from user's script
async function getAuthTokenFromPage(page, logCallback, accountEmail = "kadesimo@diigimon.com", accountPassword = "Genshin123") {
    logCallback("Starting robust token capture...");

    let authToken = null;

    // Disable cache to ensure we see the network requests
    try {
        await page.setCacheEnabled(false);
        const client = await page.target().createCDPSession();
        await client.send('Network.setCacheDisabled', { cacheDisabled: true });
    } catch (e) {
        logCallback(`Warning: Failed to disable cache: ${e.message}`);
    }

    await page.setRequestInterception(true);

    const requestHandler = (request) => {
        const headers = request.headers();
        const authHeader = Object.keys(headers).find(k => k.toLowerCase() === 'authorization');

        if (authHeader) {
            const tokenValue = headers[authHeader];
            if (tokenValue && tokenValue.startsWith('Bearer ')) {
                if (!authToken) {
                    authToken = tokenValue;
                    logCallback("\n>>> TOKEN FOUND! <<<");
                }
            }
        }
        request.continue();
    };

    page.on('request', requestHandler);

    logCallback("Reloading/Navigating to https://google.com ...");

    // Optimization: Promise that resolves as soon as token is found
    const tokenFoundPromise = new Promise(resolve => {
        const checkInterval = setInterval(() => {
            if (authToken) {
                clearInterval(checkInterval);
                resolve(authToken);
            }
        }, 100);
        // Timeout this promise after 25s
        setTimeout(() => { clearInterval(checkInterval); resolve(null); }, 25000);
    });

    try {
        // Race navigation against token finding
        const navigatePromise = page.goto('https://opal.google', { waitUntil: 'domcontentloaded' });
        await Promise.race([navigatePromise, tokenFoundPromise]);
    } catch (e) {
        logCallback(`Navigation error (or ignored): ${e.message}`);
    }

    // Immediate Probe
    if (!authToken) {
        logCallback("Initial nav done. Probing...");
        try {
            await page.evaluate(() => {
                fetch("https://appcatalyst.pa.googleapis.com/v1beta1/mobile_service:execute", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ dummy: true })
                }).catch(() => { });
            });
        } catch (e) { }
    }

    // Brief stabilization
    if (!authToken) await new Promise(r => setTimeout(r, 1500));

    if (authToken) return authToken;

    logCallback("Token not found immediately. checking for sign in...");

    try {
        // Find & Click Sign In
        // Find & Click Sign In
        const performClick = async () => {
            const clickStartTime = Date.now();
            while (Date.now() - clickStartTime < 10000) { // Retry for 10s
                try {
                    // Check if we are already on login page (email input exists)
                    const emailSelector = 'input[type="email"]';
                    if (await page.$(emailSelector)) {
                        logCallback("Already on login page (email input found).");
                        return true;
                    }

                    const frameElement = await page.$('#opal-app');
                    let frame = null;
                    if (frameElement) {
                        frame = await frameElement.contentFrame();
                    }

                    const searchAndClick = async (scope, scopeName) => {
                        // 1. Try generic Google Sign In href
                        const loginButton = await scope.$('a[href*="accounts.google.com"]');
                        if (loginButton) {
                            try {
                                if (await scope.evaluate(el => el.offsetParent !== null, loginButton)) {
                                    logCallback(`Found Sign In button (href) in ${scopeName}. Clicking...`);
                                    await loginButton.click();
                                    return true;
                                }
                            } catch (e) { }
                        }

                        // 2. Text Search on wider candidates
                        const buttons = await scope.$$('button, a, div[role="button"], span[role="button"]');
                        for (const btn of buttons) {
                            // Skip invisible
                            try {
                                const visible = await scope.evaluate(el => el.offsetParent !== null, btn);
                                if (!visible) continue;

                                const t = await scope.evaluate(el => (el.textContent || el.innerText || "").trim().toLowerCase(), btn);
                                if (t === "sign in" || t === "log in" || t === "login" || t === "masuk" || t === "sign-in") {
                                    logCallback(`Found Sign In button ("${t}") in ${scopeName}. Clicking...`);
                                    try { await btn.click(); } catch (e) { await scope.evaluate(el => el.click(), btn); }
                                    return true;
                                }
                            } catch (e) { }
                        }
                        return false;
                    };

                    let clicked = await searchAndClick(page, "main page");
                    if (!clicked && frame) clicked = await searchAndClick(frame, "iframe");

                    if (clicked) return true;

                    await new Promise(r => setTimeout(r, 1000));
                } catch (e) {
                    logCallback("Error finding sign in button: " + e.message);
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
            logCallback("Starting manual login check (timed out finding button)...");
            return false;
        };

        const clicked = await performClick();
        let loginPage = page;

        if (clicked) {
            logCallback("Sign in clicked. Waiting for popup or navigation...");
            await new Promise(r => setTimeout(r, 1000));
            try {
                const newTarget = await page.browser().waitForTarget(target => target.opener() === page.target(), { timeout: 10000 });
                if (newTarget) {
                    logCallback(">>> POPUP DETECTED! Switching context <<<");
                    loginPage = await newTarget.page();
                    if (!loginPage) {
                        await new Promise(r => setTimeout(r, 1000));
                        loginPage = await newTarget.page();
                    }
                }
            } catch (e) {
                logCallback("No new target/popup detected. Assuming same-page.");
            }

            if (loginPage && loginPage !== page) {
                // Removed waitForNetworkIdle to attach interceptor immediately to avoid missing early requests
                await loginPage.setRequestInterception(true);
                loginPage.on('request', requestHandler);
            }
        }

        // --- ACCOUNT SELECTION ---
        try {
            await new Promise(r => setTimeout(r, 1500));
            const chooseAccountHeader = await loginPage.evaluate(() => {
                const h1 = document.querySelector('h1, h2, div[role="heading"]');
                return h1 ? h1.innerText : "";
            });

            if (chooseAccountHeader.toLowerCase().includes("choose an account") || chooseAccountHeader.toLowerCase().includes("pilih akun")) {
                logCallback("Detected 'Choose an account' screen.");
                logCallback("User requested fresh login. Clicking 'Use another account'...");

                const otherAccountBtn = await loginPage.evaluateHandle(() => {
                    const items = Array.from(document.querySelectorAll('li, div[role="link"], span'));
                    return items.find(i => i.innerText.toLowerCase().includes("use another account") || i.innerText.toLowerCase().includes("gunakan akun lain"));
                });

                if (otherAccountBtn.asElement()) {
                    await otherAccountBtn.asElement().click();
                    await new Promise(r => setTimeout(r, 2000));
                } else {
                    logCallback("Could not find 'Use another account' button.");
                }
            }
        } catch (e) { }

        // --- CREDENTIALS ENTRY ---
        const emailSelector = 'input[type="email"]';
        try {
            await loginPage.waitForSelector(emailSelector, { visible: true, timeout: 5000 });
            logCallback(`Auto-filling email: ${accountEmail}`);
            await loginPage.type(emailSelector, accountEmail, { delay: 50 });
            await new Promise(r => setTimeout(r, 500));
            const nextButtonSelector = '#identifierNext button';
            const nextBtn = await loginPage.$(nextButtonSelector);
            if (nextBtn) await nextBtn.click();
            else await loginPage.keyboard.press('Enter');
        } catch (e) { }

        const passwordSelector = 'input[type="password"]';
        try {
            await loginPage.waitForSelector(passwordSelector, { visible: true, timeout: 8000 });
            await new Promise(r => setTimeout(r, 1000));
            logCallback("Auto-filling password...");
            await loginPage.type(passwordSelector, accountPassword, { delay: 50 });
            await new Promise(r => setTimeout(r, 500));
            const passwordNextSelector = '#passwordNext button';
            const pwNextBtn = await loginPage.$(passwordNextSelector);
            if (pwNextBtn) await pwNextBtn.click();
            else await loginPage.keyboard.press('Enter');
        } catch (e) { }

        // Consent Loop
        // --- ROBUST CONSENT / SPEEDBUMP HANDLER ---
        let consentClicks = 0;
        try {
            const startTime = Date.now();
            // Extended loop to 25s to catch slow loads or multiple screens
            while (Date.now() - startTime < 25000) {
                if (loginPage.isClosed()) break;

                // 1. Check for "Early Access" BLOCK / Hard Rejection
                try {
                    const pageText = await loginPage.evaluate(() => document.body.innerText.toLowerCase());
                    if (pageText.includes("early access") && (pageText.includes("doesn't have access") || pageText.includes("tidak memiliki akses"))) {
                        throw new Error("Account Blocked: Early Access Denied (Need Waiting List).");
                    }
                } catch (e) { if (e.message.includes("Account Blocked")) throw e; }

                // 2. Click Consent Buttons
                const btnClicked = await loginPage.evaluate(() => {
                    // Broader list of keywords
                    const keywords = [
                        "continue", "lanjutkan", "next", "berikutnya",
                        "i agree", "saya setuju", "accept", "allow", "izinkan",
                        "confirm", "konfirmasi", "i understand", "saya mengerti", "mengerti", "paham",
                        "yes, i'm in", "ya, saya ikut", "no, thanks", "jangan sekarang", "not now",
                        "got it", "oke"
                    ];

                    const candidates = Array.from(document.querySelectorAll('button, input[type="submit"], div[role="button"], span[role="button"]'));

                    for (const btn of candidates) {
                        // Ignore hidden elements
                        if (btn.offsetParent === null) continue;

                        const t = (btn.innerText || btn.value || "").toLowerCase().trim();
                        // Exact match or includes for longer sentences
                        if (keywords.some(k => t === k || (t.length < 30 && t.includes(k)))) {
                            btn.click();
                            return true;
                        }
                    }
                    return false;
                });

                if (btnClicked) {
                    consentClicks++;
                    logCallback(`Clicked consent/interstitial button. (Click #${consentClicks})`);
                    await new Promise(r => setTimeout(r, 2000)); // Wait for nav
                } else {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        } catch (e) {
            if (e.message.includes("Account Blocked")) throw e;
            // Otherwise ignore regex errors
        }

    } catch (e) {
        logCallback("Auto-login logic error: " + e.message);
    }

    // Fallback Probe
    if (!authToken) {
        logCallback("Attempting aggressive fallback...");
        try {
            if (page.url().includes("opal.google")) {
                // Relaxed wait condition to avoid timeout on slow network
                await page.goto('https://opal.google', { waitUntil: 'domcontentloaded', timeout: 45000 });
                await new Promise(r => setTimeout(r, 3000)); // Manual wait for scripts

                // Probe again
                if (!authToken) {
                    try {
                        await page.evaluate(() => {
                            fetch("https://appcatalyst.pa.googleapis.com/v1beta1/mobile_service:execute", {
                                method: "POST",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify({ dummy: true })
                            }).catch(() => { });
                        });
                        await new Promise(r => setTimeout(r, 3000));
                    } catch (e) { }
                }
            }
        } catch (e) { }
    }

    logCallback("Waiting for token capture...");
    const maxWaitTime = 60000;
    const startTime = Date.now();
    while (!authToken) {
        if (Date.now() - startTime > maxWaitTime) {
            // Check FOR BLOCKS before throwing timeout
            // Check FOR BLOCKS
            try {
                const pageText = await page.evaluate(() => document.body.innerText.toLowerCase());

                // 1. Phone Number Required (Hard Block)
                if (pageText.includes("enter a phone number") || pageText.includes("masukkan nomor telepon") || pageText.includes("provide a phone number")) {
                    throw new Error("Account Blocked: Phone verification required.");
                }

                // 2. "Verify it's you" (Soft Block -> Try Bypass)
                if (pageText.includes("verify it's you") || pageText.includes("verify it’s you") || pageText.includes("verifikasi diri anda")) {
                    logCallback("⚠️ 'Verify it's you' detected. Attempting 'Try another way'...");

                    const tryAnotherWayClicked = await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button, div[role="button"], span'));
                        const target = buttons.find(b => {
                            const t = b.innerText.toLowerCase();
                            return t.includes("try another way") || t.includes("coba cara lain") || t.includes("more options");
                        });
                        if (target) {
                            target.click();
                            return true;
                        }
                        return false;
                    });

                    if (tryAnotherWayClicked) {
                        logCallback("Clicked 'Try another way'. Waiting...");
                        await new Promise(r => setTimeout(r, 3000));
                        // Loop will continue and check again. 
                        // If it goes to email/tap yes, we might pass. 
                        // If it goes back to phone, the first check above will catch it next loop.
                        continue;
                    } else {
                        // No bypass button found
                        throw new Error("Account Blocked: Verification required (No bypass).");
                    }
                }

                if (pageText.includes("couldn't sign you in") || pageText.includes("tidak dapat login")) {
                    throw new Error("Account Blocked: Sign-in rejected.");
                }
            } catch (e) {
                if (e.message.includes("Account Blocked")) throw e;
            }
            throw new Error("Auth Timeout: Could not capture token in time.");
        }
        await new Promise(r => setTimeout(r, 1000));
        // Periodic probe
        if ((Date.now() - startTime) % 5000 < 1000 && !authToken) {
            try {
                await page.evaluate(() => {
                    fetch("https://appcatalyst.pa.googleapis.com/v1beta1/mobile_service:execute", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ dummy: true })
                    }).catch(() => { });
                });
            } catch (e) { }
        }
    }

    return authToken;
}

async function generateImagePrompt(authToken, imagePath, logCallback) {
    const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
    logCallback("Generating image prompt via Gemini 2.5 Flash...");

    try {
        const imageBuffer = fs.readFileSync(imagePath);
        const imageBase64 = imageBuffer.toString('base64');
        // Simple MIME type detection
        const ext = path.extname(imagePath).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

        const payload = {
            "contents": [{
                "parts": [
                    {
                        "text": "You are an expert in visual storytelling and prompt engineering for video generation. Your task is to refine user-provided animation instructions into a detailed, descriptive, and natural language prompt for a GenAI video generation API, taking into account the content and context of an uploaded image. The generated prompt should describe a brief video clip, less than 6 seconds long, with no audio. The output should be a clear, detailed visual description of the video clip.\n# Step by Step instructions\n1. Analyze the Upload Image to understand its content and context.\n2. Read the Define Animation instructions provided by the user.\n3. Begin to refine the Define Animation instructions into a detailed, descriptive, and natural language prompt for video generation, taking into account the visual elements of the Upload Image.\n4. Review the prompt you have written so far. Does it clearly describe a brief video clip (less than 6 seconds long) with no audio, based on the Upload Image and Define Animation instructions? If not, go back to step 3 and continue refining the prompt, ensuring it is a clear and detailed visual description of the video clip. If yes, proceed to the next step.\n5. Finalize the prompt, ensuring it is a comprehensive and precise natural language description of the visual content of the brief video clip.\n\n\nUpload Image:\n\"\"\"\n"
                    },
                    {
                        "inlineData": {
                            "mimeType": mimeType,
                            "data": imageBase64
                        }
                    }
                ]
            }]
        };

        // Note: The HAR likely used specific headers or keys. 
        // We will try using the same Auth Token as it acts as a user on opal.google.
        // If this fails, we might need to look for an API key in the HAR headers.
        const headers = {
            "content-type": "application/json",
            "origin": "https://opal.google",
            "referer": "https://opal.google/",
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
            "authorization": authToken,
            // Header often needed for Google APIs proxying
            "x-goog-user-project": "opal-app"
        };

        const response = await fetch(endpoint, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json();

        // Parse Gemini response
        if (data.candidates && data.candidates.length > 0 && data.candidates[0].content && data.candidates[0].content.parts.length > 0) {
            const generatedText = data.candidates[0].content.parts[0].text;
            logCallback("Gemini Prompt Generated: " + generatedText.substring(0, 100) + "...");
            return generatedText;
        } else {
            throw new Error("Unexpected Gemini response structure.");
        }

    } catch (error) {
        logCallback("Error generating image prompt: " + error.message);
        throw error;
    }
}

async function generateVideoAPI(authToken, prompt, aspectRatio, logCallback, imagePath = null, duration = null) {
    const endpoint = "https://appcatalyst.pa.googleapis.com/v1beta1/executeStep";
    const finalPrompt = prompt || "A realistic video";
    const finalRatio = aspectRatio || "16:9";
    const finalDuration = duration ? duration.replace('s', '') : "8";



    logCallback(`Generatng video via API...`);
    if (imagePath) logCallback(`Using image input: ${imagePath}`);
    logCallback(`Duration: ${finalDuration}s`);

    let generatedPrompt = finalPrompt;

    // STEP 1: If Image is present, use Gemini to generate the prompt
    if (imagePath && fs.existsSync(imagePath)) {
        try {
            // We append the user's prompt to the "Define Animation instructions" part of the system prompt if we wanted to be dynamic,
            // but the HAR hardcoded the system prompt.
            // For now, we'll let generateImagePrompt handle the image-to-text. 
            // The HAR "text" field ends with "Upload Image:\n\"\"\"\n". 
            // It seems the user's instruction in the HAR was implicit or part of the "text" block if there was any.
            // The logic below assumes we strictly follow the image-to-video flow.

            const geminiText = await generateImagePrompt(authToken, imagePath, logCallback);
            generatedPrompt = geminiText; // Use the generated text as the main prompt

            logCallback(`Using Gemini Text for Video Gen: ${generatedPrompt}`);

        } catch (e) {
            logCallback(`Gemini generation failed, falling back to original prompt: ${e.message}`);
        }
    }

    const augmentedPrompt = `${generatedPrompt} --aspect_ratio ${finalRatio} --duration ${finalDuration}`;
    logCallback(`Sent Prompt: ${augmentedPrompt}`);

    const promptBase64 = Buffer.from(augmentedPrompt).toString('base64');
    const aspectRatioBase64 = Buffer.from(finalRatio).toString('base64');
    const durationBase64 = Buffer.from(finalDuration).toString('base64');

    const executionInputs = {
        text_instruction: { chunks: [{ mimetype: "text/plain", data: promptBase64 }] },
        aspect_ratio_key: { chunks: [{ mimetype: "text/plain", data: aspectRatioBase64 }] },
        duration_key: { chunks: [{ mimetype: "text/plain", data: durationBase64 }] }
    };

    // NOTE: We are intentionally NOT adding 'image_prompt' here anymore based on the new flow 
    // where we convert Image -> Text (Gemini) -> Video (Veo). 
    // If the user wanted the image to be *visually* influenced directly by Veo (e.g. style transfer), 
    // that would be a different payload. But "Image-to-Video" often means "Animate this image".
    // Gemini 2.5 Flash is describing the image. 
    // Wait, if we just describe the image, Veo generates a NEW video matching the description. 
    // It doesn't animate the *original* pixels. 
    // IF the goal is to ANIMATE the image (like Runway/Pika), passing the description alone is NOT enough 
    // because Veo needs the source image pixels to keep consistency.
    // However, the HAR file analysis revealed the Gemini call. 
    // If the HAR *also* had an executeStep call with image_prompt, then we should do both.
    // Since I didn't see the executeStep in the HAR snippet (it was huge/truncated), I am relying on the "Image to Text" finding.
    // BUT, to be safe and powerful: if we have the image, we probably SHOULD send it if Veo supports it. 
    // The previous implementation sent it. The "Fixing Image-to-Video Payload" conversation suggested sending it.
    // Using Gemini description + Image bytes seems like the strongest combo for Veo if supported.
    // Let's keep the image bytes in the payload IF we have them, ALONG WITH the enhanced prompt.

    if (imagePath && fs.existsSync(imagePath)) {
        try {
            const imageBuffer = fs.readFileSync(imagePath);
            const imageBase64 = imageBuffer.toString('base64');
            const ext = path.extname(imagePath).toLowerCase();
            const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

            executionInputs.reference_image = {
                chunks: [{ mimetype: mimeType, data: imageBase64 }]
            };
            logCallback("Image encoded and added to payload (Native Image Support).");
        } catch (e) {
            logCallback(`Failed to read image file: ${e.message}`);
        }
    }

    // HAR comparison shows 'veo-3.0-generate-preview' accepts 'reference_image' input.
    const modelName = "veo-3.0-generate-preview";
    logCallback(`Using Model: ${modelName}`);

    const payload = {
        planStep: {
            stepName: "GenerateVideo",
            modelApi: "generate_video",
            inputParameters: ["text_instruction", "reference_image"],
            systemPrompt: "",
            output: "generated_video",
            options: { disablePromptRewrite: false, modelName: modelName }
        },
        execution_inputs: executionInputs
    };

    const headers = {
        "content-type": "application/json",
        "origin": "https://opal.google",
        "referer": "https://opal.google/",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        "authorization": authToken
    };

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json();

        if (data.executionOutputs && data.executionOutputs.generated_video && data.executionOutputs.generated_video.chunks.length > 0) {
            const chunkData = data.executionOutputs.generated_video.chunks[0].data;
            const decodedPath = Buffer.from(chunkData, 'base64').toString('utf-8');
            const parts = decodedPath.split('/');
            const blobId = parts[parts.length - 1];
            const downloadUrl = `https://opal.google/board/blobs/${blobId}`;

            logCallback(`Video generated successfully!`);
            return { downloadUrl, blobId };
        } else {
            // IMPROVED ERROR HANDLING
            if (data.errorMessage) {
                const errStr = typeof data.errorMessage === 'string' ? data.errorMessage : JSON.stringify(data.errorMessage);

                if (errStr.includes("RESOURCE_EXHAUSTED") || errStr.includes("Quota exceeded")) {
                    throw new Error("Quota Exceeded: Account reached daily limit.");
                }

                if (errStr.includes("sensitive words") || errStr.includes("INVALID_ARGUMENT") || errStr.includes("Responsible AI")) {
                    throw new Error("Sensitive Content: Prompt violated safety policies.");
                }
            }

            logCallback(`Debugging "No video data": Full Response = ${JSON.stringify(data).substring(0, 2000)}`);
            throw new Error("No video data in response");
        }
    } catch (error) {
        logCallback("API Execution error: " + error.message);
        throw error;
    }
}

let ffmpeg = null;
let ffmpegPath = null;

try {
    ffmpeg = require('fluent-ffmpeg');
    ffmpegPath = require('ffmpeg-static');
    if (ffmpegPath && ffmpeg) {
        ffmpeg.setFfmpegPath(ffmpegPath.replace('app.asar', 'app.asar.unpacked'));
    }
} catch (e) {
    console.warn("ffmpeg dependencies not found. Audio stripping will be disabled.", e.message);
}

async function stripAudio(inputPath, logCallback) {
    if (!ffmpeg) {
        logCallback("Warning: ffmpeg not installed. Cannot strip audio. Output will contain audio.");
        return inputPath;
    }

    return new Promise((resolve, reject) => {
        const outputPath = inputPath.replace('.mp4', '_silent.mp4');
        logCallback(`Stripping audio from: ${path.basename(inputPath)}...`);

        ffmpeg(inputPath)
            .outputOptions('-c copy')
            .outputOptions('-an')
            .save(outputPath)
            .on('end', () => {
                try {
                    fs.unlinkSync(inputPath);
                    fs.renameSync(outputPath, inputPath);
                    logCallback("Audio removed successfully.");
                    resolve(inputPath);
                } catch (e) {
                    reject(e);
                }
            })
            .on('error', (err) => {
                logCallback(`Error removing audio: ${err.message}`);
                reject(err);
            });
    });
}

async function getImageDimensions(imagePath) {
    if (!ffmpegPath) return null;
    return new Promise((resolve) => {
        // Use the same path adjustment as fluent-ffmpeg setup
        const exePath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');

        execFile(exePath, ['-i', imagePath], (error, stdout, stderr) => {
            // ffmpeg usually writes metadata to stderr
            const output = stderr || stdout || "";
            // Regex to find resolution in the Video stream line
            // Example: Stream #0:0: Video: png, rgba(pc), 512x512 ...
            const match = output.match(/Video:.*?\b(\d+)x(\d+)\b/);

            if (match && match.length >= 3) {
                resolve({ width: parseInt(match[1]), height: parseInt(match[2]) });
            } else {
                console.log("[GetImageDimensions] Failed to match resolution. Output snippet:", output.substring(0, 300));
                resolve(null);
            }
        });
    });
}

async function processVideo(videoPath, targetWidth, targetHeight, muteAudio, logCallback) {
    if (!ffmpeg) return videoPath;

    // Fix for libx264: Width and height must be divisible by 2.
    const safeWidth = targetWidth % 2 === 0 ? targetWidth : targetWidth + 1;
    const safeHeight = targetHeight % 2 === 0 ? targetHeight : targetHeight + 1;

    if (safeWidth !== targetWidth || safeHeight !== targetHeight) {
        logCallback(`Adjusting target resolution to even numbers: ${safeWidth}x${safeHeight}`);
    }

    return new Promise((resolve, reject) => {
        const outputPath = videoPath.replace('.mp4', '_processed.mp4');
        logCallback(`Processing video: Resize(${safeWidth}x${safeHeight}) + Sharpen + ${muteAudio ? 'Mute' : 'Audio Copy'}...`);

        // Filter Logic:
        // 1. Scale & Crop (Zoom to Fill)
        // 2. Unsharp Mask (Sharpen)
        const scaleFilter = `scale=max(${safeWidth}\\,iw*${safeHeight}/ih):max(${safeHeight}\\,ih*${safeWidth}/iw)`;
        const cropFilter = `crop=${safeWidth}:${safeHeight}`;
        const sharpenFilter = `unsharp=5:5:1.0:5:5:0.0`; // Default sharpening

        const complexFilter = `[0:v]${scaleFilter},${cropFilter},${sharpenFilter}[outv]`;

        let command = ffmpeg(videoPath)
            .complexFilter(complexFilter, 'outv')
            .outputOptions('-c:v libx264')
            .outputOptions('-preset ultrafast') // Optimization: Fast encoding
            .outputOptions('-crf 23'); // Reasonable quality

        if (muteAudio) {
            command.outputOptions('-an'); // Remove audio
        } else {
            command.outputOptions('-c:a copy'); // Copy audio if present
        }

        command
            .save(outputPath)
            .on('end', () => {
                try {
                    fs.unlinkSync(videoPath);
                    fs.renameSync(outputPath, videoPath);
                    logCallback("Video processing (Resize/Sharpen) complete.");
                    resolve(videoPath);
                } catch (e) {
                    reject(e);
                }
            })
            .on('error', (err) => {
                logCallback(`Error processing video: ${err.message}`);
                if (err.stderr) logCallback(`FFmpeg Stderr: ${err.stderr}`);
                reject(err);
            });
    });
}

async function downloadVideoFile(url, authToken, savePath, filenameId, logCallback, muteAudio = false, referenceImagePath = null, onProcessingStart = null) {
    if (!fs.existsSync(savePath)) {
        fs.mkdirSync(savePath, { recursive: true });
    }

    const filePath = path.join(savePath, `veo_${filenameId}.mp4`);
    logCallback(`Downloading to: ${filePath}...`);

    const headers = {
        "authorization": authToken,
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"
    };

    try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error(`Failed to download video: ${response.statusText}`);
        }

        const fileStream = fs.createWriteStream(filePath);

        if (response.body) {
            // @ts-ignore
            for await (const chunk of response.body) {
                fileStream.write(Buffer.from(chunk));
            }
        }

        fileStream.end();

        await new Promise(fulfill => fileStream.on("finish", fulfill));

        logCallback("Download complete.");

        if (referenceImagePath && fs.existsSync(referenceImagePath)) {
            try {
                const dims = await getImageDimensions(referenceImagePath);
                if (dims) {
                    if (onProcessingStart) onProcessingStart(); // Notify UI we are starting heavy work

                    logCallback(`Target Resolution: ${dims.width}x${dims.height}`);
                    await processVideo(filePath, dims.width, dims.height, muteAudio, logCallback);
                    return filePath;
                }
            } catch (e) {
                logCallback(`Resize/Processing warning: ${e.message}`);
            }
        }

        // Fallback: If no resize needed (Text-to-Video mode), but Mute IS requested
        if (muteAudio) {
            // We can use the simple stripAudio or just re-use processVideo without resize? 
            // Providing null/null for dims might break logic.
            // Let's keep the simple stripAudio logic for non-resize cases (Text Mode) or just use ffmpeg simplistically.
            // For consistency and speed, lets just use a simple -an command if we have ffmpeg.
            if (ffmpeg) {
                if (onProcessingStart) onProcessingStart();
                await stripAudio(filePath, logCallback);
            }
        }

        return filePath;
    } catch (error) {
        logCallback("Error downloading: " + error.message);
        throw error;
    }
}

module.exports = { getAuthTokenFromPage, generateVideoAPI, downloadVideoFile };
