const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
    send: (channel, data) => {
        // whitelist channels
        let validChannels = ['start-automation', 'stop-automation', 'minimize', 'maximize', 'close', 'save-accounts', 'get-accounts', 'login-accounts', 'install-update'];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    receive: (channel, func) => {
        let validChannels = ['log-update', 'automation-status', 'accounts-data', 'item-status', 'account-update', 'update-available', 'update-downloaded', 'update-error', 'download-progress'];
        if (validChannels.includes(channel)) {
            // Deliberately strip event as it includes `sender` 
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    },
    removeListener: (channel, func) => {
        ipcRenderer.removeListener(channel, func);
    },
    invoke: (channel, data) => {
        let validChannels = ['open-directory-dialog', 'get-bios-serial', 'get-profiles-size', 'delete-all-profiles', 'clear-accounts', 'get-app-version'];
        if (validChannels.includes(channel)) {
            return ipcRenderer.invoke(channel, data);
        }
    },
    getBiosSerial: () => ipcRenderer.invoke('get-bios-serial'),
    getFilePath: (file) => {
        try {
            return webUtils.getPathForFile(file);
        } catch (e) {
            return null;
        }
    }
});
