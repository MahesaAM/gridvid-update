const { getChromiumPath } = require('./src/automation/chromium-utils');

async function test() {
    console.log("Checking for system Chrome...");
    try {
        const result = await getChromiumPath({ customPaths: [] });
        console.log("Result:", result);
    } catch (e) {
        console.error("Error:", e);
    }
}

test();
