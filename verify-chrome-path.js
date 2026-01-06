const { getChromiumPath } = require('./src/automation/chromium-utils');

(async () => {
    try {
        console.log('Testing getChromiumPath...');
        const customPaths = ['puppeteer-chromium/chrome.exe'];
        const result = await getChromiumPath({ customPaths });
        console.log('Result:', result);

        if (result && result.path && result.version === 'custom') {
            console.log('SUCCESS: Custom local path resolved correctly.');
        } else {
            console.error('FAILURE: Did not resolve to custom local path.');
        }
    } catch (error) {
        console.error('ERROR:', error);
    }
})();
