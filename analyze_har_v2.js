const fs = require('fs');

try {
    const harContent = fs.readFileSync('opal.google.har', 'utf8');
    const har = JSON.parse(harContent);

    // Find executeStep requests
    const requests = har.log.entries.filter(entry =>
        entry.request.method === 'POST' &&
        entry.request.url.includes('executeStep')
    );

    console.log(`Found ${requests.length} executeStep requests.`);

    requests.forEach((req, index) => {
        console.log(`\n--- Request #${index + 1} ---`);
        if (req.request.postData && req.request.postData.text) {
            try {
                const body = JSON.parse(req.request.postData.text);
                console.log('Execution Inputs keys:', Object.keys(body.execution_inputs || {}));

                // Deep log specific fields if they exist
                if (body.execution_inputs) {
                    if (body.execution_inputs.image) {
                        console.log('Found "image" input!');
                        console.log(JSON.stringify(body.execution_inputs.image, null, 2).substring(0, 500));
                    }
                    if (body.execution_inputs.image_instruction) {
                        console.log('Found "image_instruction" input!');
                        console.log(JSON.stringify(body.execution_inputs.image_instruction, null, 2).substring(0, 500));
                    }
                    if (body.execution_inputs.prompt_image) {
                        console.log('Found "prompt_image" input!');
                        console.log(JSON.stringify(body.execution_inputs.prompt_image, null, 2).substring(0, 500));
                    }
                }
            } catch (e) {
                console.log('JSON Parse error');
            }
        }
    });

} catch (err) {
    console.error('Error:', err);
}
