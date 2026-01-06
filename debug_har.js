const fs = require('fs');

const harPath = 'c:\\Users\\LENOVO\\Downloads\\GridVidReborn\\opal.google.har';

try {
    const harContent = fs.readFileSync(harPath, 'utf8');
    const har = JSON.parse(harContent);
    const entries = har.log.entries;

    console.log(`Searching through ${entries.length} entries for 'appcatalyst' or 'video' related requests...`);

    entries.forEach((entry, index) => {
        const url = entry.request.url;
        if (url.includes('appcatalyst') || url.includes('executeStep')) {
            console.log(`\n[Entry ${index}] Method: ${entry.request.method} | URL: ${url}`);
            if (entry.request.postData && entry.request.postData.text) {
                try {
                    const body = JSON.parse(entry.request.postData.text);
                    console.log("Request Body Structure:");
                    // Recursive function to print keys and types, truncating long strings
                    function printStructure(obj, indent = 2) {
                        const spacer = ' '.repeat(indent);
                        if (typeof obj === 'object' && obj !== null) {
                            if (Array.isArray(obj)) {
                                console.log(`${spacer}[Array length: ${obj.length}]`);
                                if (obj.length > 0) printStructure(obj[0], indent + 2);
                            } else {
                                Object.keys(obj).forEach(key => {
                                    const val = obj[key];
                                    if (typeof val === 'string' && val.length > 100) {
                                        console.log(`${spacer}${key}: [String length: ${val.length}]`);
                                    } else if (key === 'data' && typeof val === 'string') {
                                        console.log(`${spacer}${key}: [Base64 Data length: ${val.length}]`);
                                    } else {
                                        console.log(`${spacer}${key}: ${typeof val}`);
                                        if (typeof val === 'object') printStructure(val, indent + 2);
                                        else console.log(`${spacer}  -> ${val}`);
                                    }
                                });
                            }
                        }
                    }
                    printStructure(body);
                } catch (e) {
                    console.log("Request Body (Non-JSON or Error parsing):", entry.request.postData.text.substring(0, 200));
                }
            }
        }
    });

} catch (error) {
    console.error("Error reading/parsing HAR:", error);
}
