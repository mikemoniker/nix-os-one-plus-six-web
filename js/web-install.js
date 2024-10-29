// @license magnet:?xt=urn:btih:d3d9a9a6595521f9666a5e94cc830dab83b65699&dn=expat.txt MIT

import * as fastboot from "./fastboot/dist/fastboot.min.mjs";

const RELEASES_URL = "https://elasticbeanstalk-us-west-2-190312923858.s3.us-west-2.amazonaws.com";

const CACHE_DB_NAME = "BlobStore";
const CACHE_DB_VERSION = 1;

const Buttons = {
    UNLOCK_BOOTLOADER: "unlock-bootloader",
    DOWNLOAD_RELEASE: "download-release",
    FLASH_RELEASE: "flash-release",
    LOCK_BOOTLOADER: "lock-bootloader",
    REMOVE_CUSTOM_KEY: "remove-custom-key",
    FLASH_BOOT: "flash-boot",
    FLASH_SYSTEM: "flash-system",
    ERASE_DTBO: "erase-dtbo"
};

const InstallerState = {
    DOWNLOADING_RELEASE: 0x1,
    INSTALLING_RELEASE: 0x2
};

let wakeLock = null;

const requestWakeLock = async () => {
    try {
        wakeLock = await navigator.wakeLock.request("screen");
        console.log("Wake lock has been set");
        wakeLock.addEventListener("release", async () => {
            console.log("Wake lock has been released");
        });
    } catch (err) {
        // if wake lock request fails - usually system related, such as battery
        throw new Error(`${err.name}, ${err.message}`);
    }
};

const releaseWakeLock = async () => {
    if (wakeLock !== null) {
        wakeLock.release().then(() => {
            wakeLock = null;
        });
    }
};

async function flashBoot(setProgress) {
    if (!selectedBootFile) {
        throw new Error("Please select a boot image file first");
    }

    await ensureConnected(setProgress);
    setProgress("Flashing boot image to all slots...");

    try {
        // Flash to slot a
        console.log("alpha Flashing boot to slot A...");
        setProgress("Flashing boot to slot A...");
        console.log("beta await device.upload('boot_a', selectedBootFile);");
        await device.upload("boot_a", selectedBootFile);
        console.log("charlie await device.runCommand('flash:boot_a');");
        await device.runCommand("flash:boot_a");

        // Flash to slot b
        console.log("delta Flashing boot to slot B...");
        setProgress("Flashing boot to slot B...");
        console.log("echo await device.upload('boot_b', selectedBootFile);");
        await device.upload("boot_b", selectedBootFile);
        console.log("foxtrot await device.runCommand('flash:boot_b');");
        await device.runCommand("flash:boot_b");
        console.log("golf");

    } catch (error) {
        throw new Error(`Failed to flash boot image: ${error.message}`);
    }

    return "Boot image flashed to both slots successfully.";
}
async function flashSystem(setProgress) {
    if (!selectedSystemFile) {
        throw new Error("Please select a system image file first");
    }

    await ensureConnected(setProgress);
    setProgress("Flashing system image to userdata...");

    try {
        await device.upload("userdata", selectedSystemFile);
        await device.runCommand("flash:userdata");
    } catch (error) {
        throw new Error(`Failed to flash system image: ${error.message}`);
    }

    return "System image flashed to userdata successfully.";
}
async function eraseDtbo(setProgress) {
    await ensureConnected(setProgress);
    
    try {
        setProgress("Erasing DTBO slot A...");
        await device.runCommand("erase:dtbo_a");
        
        setProgress("Erasing DTBO slot B...");
        await device.runCommand("erase:dtbo_b");
    } catch (error) {
        throw new Error(`Failed to erase DTBO: ${error.message}`);
    }

    return "DTBO erased from both slots successfully.";
}
function setupCustomFileInputs() {
    // Setup boot image file input
    const bootFileInput = document.getElementById('boot-file-input');
    bootFileInput.addEventListener('change', (event) => {
        if (event.target.files.length > 0) {
            selectedBootFile = event.target.files[0];
            setButtonState({ id: 'flash-boot', enabled: true });
        } else {
            selectedBootFile = null;
            setButtonState({ id: 'flash-boot', enabled: false });
        }
    });

    // Setup system image file input
    const systemFileInput = document.getElementById('system-file-input');
    systemFileInput.addEventListener('change', (event) => {
        if (event.target.files.length > 0) {
            selectedSystemFile = event.target.files[0];
            setButtonState({ id: 'flash-system', enabled: true });
        } else {
            selectedSystemFile = null;
            setButtonState({ id: 'flash-system', enabled: false });
        }
    });
}

// Add these variables to store selected files
let selectedBootFile = null;
let selectedSystemFile = null;


// reacquires the wake lock should the visibility of the document change and the wake lock is released
document.addEventListener("visibilitychange", async () => {
    if (wakeLock !== null && document.visibilityState === "visible") {
        await requestWakeLock();
    }
});

// This wraps XHR because getting progress updates with fetch() is overly complicated.
function fetchBlobWithProgress(url, onProgress) {
    let xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = "blob";
    xhr.send();

    return new Promise((resolve, reject) => {
        xhr.onload = () => {
            resolve(xhr.response);
        };
        xhr.onprogress = (event) => {
            onProgress(event.loaded / event.total);
        };
        xhr.onerror = () => {
            reject(`${xhr.status} ${xhr.statusText}`);
        };
    });
}

function setButtonState({ id, enabled }) {
    const button = document.getElementById(`${id}-button`);
    button.disabled = !enabled;
    return button;
}

class BlobStore {
    constructor() {
        this.db = null;
    }

    async _wrapReq(request, onUpgrade = null) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                resolve(request.result);
            };
            request.oncomplete = () => {
                resolve(request.result);
            };
            request.onerror = (event) => {
                reject(event);
            };

            if (onUpgrade !== null) {
                request.onupgradeneeded = onUpgrade;
            }
        });
    }

    async init() {
        if (this.db === null) {
            this.db = await this._wrapReq(
                indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION),
                (event) => {
                    let db = event.target.result;
                    db.createObjectStore("files", { keyPath: "name" });
                    /* no index needed for such a small database */
                }
            );
        }
    }

    async saveFile(name, blob) {
        this.db.transaction(["files"], "readwrite").objectStore("files").add({
            name: name,
            blob: blob,
        });
    }

    async loadFile(name) {
        try {
            let obj = await this._wrapReq(
                this.db.transaction("files").objectStore("files").get(name)
            );
            return obj.blob;
        } catch (error) {
            return null;
        }
    }

    async close() {
        this.db.close();
    }

    async download(url, onProgress = () => {}) {
        let filename = url.split("/").pop();
        let blob = await this.loadFile(filename);
        if (blob === null) {
            console.log(`Downloading ${url}`);
            let blob = await fetchBlobWithProgress(url, onProgress);
            console.log("File downloaded, saving...");
            await this.saveFile(filename, blob);
            console.log("File saved");
        } else {
            console.log(
                `Loaded ${filename} from blob store, skipping download`
            );
        }

        return blob;
    }
}

class ButtonController {
    #map;

    constructor() {
        this.#map = new Map();
    }

    setEnabled(...ids) {
        ids.forEach((id) => {
            // Only enable button if it won't be disabled.
            if (!this.#map.has(id)) {
                this.#map.set(id, /* enabled = */ true);
            }
        });
    }

    setDisabled(...ids) {
        ids.forEach((id) => this.#map.set(id, /* enabled = */ false));
    }

    applyState() {
        this.#map.forEach((enabled, id) => {
            setButtonState({ id, enabled });
        });
        this.#map.clear();
    }
}

let installerState = 0;

let device = new fastboot.FastbootDevice();
let blobStore = new BlobStore();
let buttonController = new ButtonController();

async function ensureConnected(setProgress) {
    if (!device.isConnected) {
        setProgress("Connecting to device...");
        await device.connect();
    }
}

async function unlockBootloader(setProgress) {
    await ensureConnected(setProgress);

    // Trying to unlock when the bootloader is already unlocked results in a FAIL,
    // so don't try to do it.
    if (await device.getVariable("unlocked") === "yes") {
        return "Bootloader is already unlocked.";
    }

    setProgress("Unlocking bootloader...");
    try {
        await device.runCommand("flashing unlock");
    } catch (error) {
        // FAIL = user rejected unlock
        if (error instanceof fastboot.FastbootError && error.status === "FAIL") {
            throw new Error("Bootloader was not unlocked, please try again!");
        } else {
            throw error;
        }
    }

    return "Bootloader unlocked.";
}

async function getLatestRelease() {
    return ["result.tar.xz", "custom"];

}

async function downloadRelease(setProgress) {
    await requestWakeLock();
    
    // We don't need to check device connection for download
    setProgress("Preparing to download release...");
    
    let [latestRelease,] = await getLatestRelease();

    // Download and cache the file
    setInstallerState({ state: InstallerState.DOWNLOADING_RELEASE, active: true });
    setProgress(`Downloading ${latestRelease}...`);
    await blobStore.init();
    try {
        await blobStore.download(`${RELEASES_URL}/${latestRelease}`, (progress) => {
            setProgress(`Downloading ${latestRelease}...`, progress);
        });
    } finally {
        setInstallerState({ state: InstallerState.DOWNLOADING_RELEASE, active: false });
        await releaseWakeLock();
    }
    setProgress(`Downloaded ${latestRelease} release.`, 1.0);
}

async function reconnectCallback() {
    let statusField = document.getElementById("flash-release-status");
    statusField.textContent =
        "To continue flashing, reconnect the device by tapping here:";

    let reconnectButton = document.getElementById("flash-reconnect-button");
    let progressBar = document.getElementById("flash-release-progress");

    // Hide progress bar while waiting for reconnection
    progressBar.hidden = true;
    reconnectButton.hidden = false;

    reconnectButton.onclick = async () => {
        await device.connect();
        reconnectButton.hidden = true;
        progressBar.hidden = false;
    };
}

async function flashRelease(setProgress) {
    await requestWakeLock();
    await ensureConnected(setProgress);

    setProgress("Finding release file...");
    let [latestRelease,] = await getLatestRelease();
    await blobStore.init();
    let blob = await blobStore.loadFile(latestRelease);
    if (blob === null) {
        throw new Error("You need to download a release first!");
    }

    setProgress("Flashing release...");
    setInstallerState({ state: InstallerState.INSTALLING_RELEASE, active: true });
    try {
        await device.flashFactoryZip(blob, true, reconnectCallback,
            (action, item, progress) => {
                let userAction = fastboot.USER_ACTION_MAP[action];
                let userItem = item === "avb_custom_key" ? "verified boot key" : item;
                setProgress(`${userAction} ${userItem}...`, progress);
            }
        );
        // Remove legacy device checks here if they exist
    } finally {
        setInstallerState({ state: InstallerState.INSTALLING_RELEASE, active: false });
        await releaseWakeLock();
    }

    return `Flashed ${latestRelease} to device.`;
}

async function eraseNonStockKey(setProgress) {
    await ensureConnected(setProgress);

    setProgress("Erasing key...");
    try {
        await device.runCommand("erase:avb_custom_key");
    } catch (error) {
        console.log(error);
        throw error;
    }
    return "Key erased.";
}

async function lockBootloader(setProgress) {
    await ensureConnected(setProgress);

    setProgress("Locking bootloader...");
    try {
        await device.runCommand("flashing lock");
    } catch (error) {
        // FAIL = user rejected lock
        if (error instanceof fastboot.FastbootError && error.status === "FAIL") {
            throw new Error("Bootloader was not locked, please try again!");
        } else {
            throw error;
        }
    }

    // We can't explicitly validate the bootloader lock state because it reboots
    // to recovery after locking. Assume that the device would've replied with
    // FAIL if if it wasn't locked.
    return "Bootloader locked.";
}

function addButtonHook(id, callback) {
    const buttonId = `${id}-button`;
    const buttonz = document.getElementById(buttonId);
    console.log(`Looking for button: ${buttonId}, found: ${buttonz !== null}`);  // Add this debug line

    let statusContainer = document.getElementById(`${id}-status-container`);
    let statusField = document.getElementById(`${id}-status`);
    let progressBar = document.getElementById(`${id}-progress`);

    let statusCallback = (status, progress) => {
        if (statusContainer !== null) {
            statusContainer.hidden = false;
        }

        statusField.className = "";
        statusField.textContent = status;

        if (progress !== undefined) {
            progressBar.hidden = false;
            progressBar.value = progress;
        }
    };

    let button = setButtonState({ id, enabled: true });
    button.onclick = async () => {
        try {
            let finalStatus = await callback(statusCallback);
            if (finalStatus !== undefined) {
                statusCallback(finalStatus);
            }
        } catch (error) {
            statusCallback(`Error: ${error.message}`);
            statusField.className = "error-text";
            await releaseWakeLock();
            // Rethrow the error so it shows up in the console
            throw error;
        }
    };
}

function setInstallerState({ state, active }) {
    if (active) {
        installerState |= state;
    } else {
        installerState &= ~state;
    }
    invalidateInstallerState();
}

function isInstallerStateActive(state) {
    return (installerState & state) === state;
}

function invalidateInstallerState() {
    if (isInstallerStateActive(InstallerState.DOWNLOADING_RELEASE)) {
        buttonController.setDisabled(Buttons.DOWNLOAD_RELEASE);
    } else {
        buttonController.setEnabled(Buttons.DOWNLOAD_RELEASE);
    }

    let disableWhileInstalling = [
        Buttons.DOWNLOAD_RELEASE,
        Buttons.FLASH_RELEASE,
        Buttons.LOCK_BOOTLOADER,
        Buttons.REMOVE_CUSTOM_KEY,
    ];
    if (isInstallerStateActive(InstallerState.INSTALLING_RELEASE)) {
        buttonController.setDisabled(...disableWhileInstalling);
    } else {
        buttonController.setEnabled(...disableWhileInstalling);
    }

    buttonController.applyState();
}

function safeToLeave() {
    return installerState === 0;
}

// This doesn't really hurt, and because this page is exclusively for web install,
// we can tolerate extra logging in the console in case something goes wrong.
fastboot.setDebugLevel(2);

fastboot.configureZip({
    workerScripts: {
        inflate: ["/js/fastboot/ffe7e270/vendor/z-worker-pako.js", "pako_inflate.min.js"],
    },
});

if ("usb" in navigator) {
    addButtonHook(Buttons.UNLOCK_BOOTLOADER, unlockBootloader);
    addButtonHook(Buttons.DOWNLOAD_RELEASE, downloadRelease);
    addButtonHook(Buttons.FLASH_RELEASE, flashRelease);
    addButtonHook(Buttons.LOCK_BOOTLOADER, lockBootloader);
    addButtonHook(Buttons.REMOVE_CUSTOM_KEY, eraseNonStockKey);

    // Add the new button hooks
    addButtonHook(Buttons.FLASH_BOOT, flashBoot);
    addButtonHook(Buttons.FLASH_SYSTEM, flashSystem);
    addButtonHook(Buttons.ERASE_DTBO, eraseDtbo);
    
    // Setup the file inputs
    setupCustomFileInputs();
    
    // Initially disable flash buttons until files are selected
    setButtonState({ id: Buttons.FLASH_BOOT, enabled: true });
    setButtonState({ id: Buttons.FLASH_SYSTEM, enabled: true });
} else {
    console.log("WebUSB unavailable");
}

// This will create an alert box to stop the user from leaving the page during actions
window.addEventListener("beforeunload", event => {
    if (!safeToLeave()) {
        console.log("User tried to leave the page whilst unsafe to leave!");
        event.returnValue = "";
    }
});

// @license-end