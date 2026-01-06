const fs = require('fs');
const path = require('path');
const { getAuthToken } = require('./get_auth_token');

// Node.js 18+ has native fetch, so no import is needed.
// If you are on an older version, you might need to import it, but we assume Node 21+ based on user env.
async function generateVeoVideo() {
    const endpoint = "https://appcatalyst.pa.googleapis.com/v1beta1/executeStep";

    // Attempt to get token via login script
    const authToken = await getAuthToken();

    if (!authToken) {
        console.error("No auth token retrieved. Exiting.");
        return;
    }

    console.log("Using retrieved auth token.");

    const prompt = "A realistic video of a cat mid-jump, captured with 4K hyperrealistic resolution and maximum detail level.";
    const aspectRatio = "16:9";

    // Base64 encode
    const promptBase64 = Buffer.from(prompt).toString('base64');
    const aspectRatioBase64 = Buffer.from(aspectRatio).toString('base64');

    const payload = {
        planStep: {
            stepName: "GenerateVideo",
            modelApi: "generate_video",
            inputParameters: ["text_instruction"],
            systemPrompt: "",
            output: "generated_video",
            options: {
                disablePromptRewrite: false,
                modelName: "veo-3.0-generate-preview"
            }
        },
        execution_inputs: {
            text_instruction: {
                chunks: [{
                    mimetype: "text/plain",
                    data: promptBase64
                }]
            },
            aspect_ratio_key: {
                chunks: [{
                    mimetype: "text/plain",
                    data: aspectRatioBase64
                }]
            }
        }
    };

    const headers = {
        "content-type": "application/json",
        "origin": "https://opal.google",
        "referer": "https://opal.google/",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        "authorization": authToken
    };

    console.log("Sending request to generate video...");
    console.log(`Endpoint: ${endpoint}`);

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Status: ${response.status}`);
            console.error(`Error: ${errorText}`);
            return;
        }

        const data = await response.json();

        if (data.executionOutputs && data.executionOutputs.generated_video && data.executionOutputs.generated_video.chunks.length > 0) {
            const chunkData = data.executionOutputs.generated_video.chunks[0].data;
            // The data seems to be the ID or path base64 encoded? 
            // HAR thought: "bGFicy1vcGFsLXByb2QtYmxvYnMvYzk2OTNmM2EtN2FiMS00Y2VmLTgyNGQtMDNjMDM0ZTIzMWFh"
            // Decoded: "labs-opal-prod-blobs/c9693f3a-7ab1-4cef-824d-03c034e231aa"

            // Let's print the chunk data to see what we get
            console.log("Chunk Data (Base64):", chunkData);

            try {
                const decodedPath = Buffer.from(chunkData, 'base64').toString('utf-8');
                console.log("Decoded Path:", decodedPath);

                const parts = decodedPath.split('/');
                const blobId = parts[parts.length - 1];

                const downloadUrl = `https://opal.google/board/blobs/${blobId}`;
                console.log("\nSuccess! Video generated.");
                console.log(`Download URL: ${downloadUrl}`);

                // Download the video
                await downloadVideo(downloadUrl, headers, blobId);

            } catch (e) {
                console.log("Could not decode path, raw data:", chunkData);
            }

        } else {
            console.log("Response received but video data missing:", JSON.stringify(data, null, 2));
        }

    } catch (error) {
        console.error("Script execution error:", error);
    }
}


async function downloadVideo(url, headers, filenameId) {
    const outputDir = path.join(__dirname, 'downloads');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }

    const filePath = path.join(outputDir, `veo_${filenameId}.mp4`);
    console.log(`\nDownloading video to: ${filePath}...`);

    try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error(`Failed to download video: ${response.statusText}`);
        }

        const fileStream = fs.createWriteStream(filePath);

        // Node.js native fetch body is an async iterable
        if (response.body) {
            // @ts-ignore
            for await (const chunk of response.body) {
                fileStream.write(Buffer.from(chunk));
            }
        }

        fileStream.end();
        console.log("Download completed successfully!");
    } catch (error) {
        console.error("Error downloading video:", error);
    }
}

generateVeoVideo();
