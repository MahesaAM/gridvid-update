const { install, resolveBuildId, Browser, Platform } = require('@puppeteer/browsers');
const path = require('path');

(async () => {
    const root = process.cwd();

    console.log('Resolving stable version for Windows...');
    const winBuildId = await resolveBuildId('chrome', 'win64', 'stable');
    console.log(`Resolved ID: ${winBuildId}`);

    console.log(`Downloading Chrome (${winBuildId}) for Windows...`);
    await install({
        browser: 'chrome',
        buildId: winBuildId,
        cacheDir: path.join(root, 'browsers_win'),
        platform: 'win64'
    });

    console.log('Resolving stable version for macOS (ARM)...');
    const macBuildId = await resolveBuildId('chrome', 'mac_arm', 'stable');
    console.log(`Resolved ID: ${macBuildId}`);

    console.log(`Downloading Chrome (${macBuildId}) for macOS (ARM64)...`);
    await install({
        browser: 'chrome',
        buildId: macBuildId,
        cacheDir: path.join(root, 'browsers_mac'),
        platform: 'mac_arm'
    });

    console.log('Download complete!');
})();
