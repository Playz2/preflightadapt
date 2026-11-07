import addOnUISdk, { RuntimeType } from "https://new.express.adobe.com/static/add-on-sdk/sdk.js";

const scanBtn = document.getElementById("scan");
const output = document.getElementById("output");

addOnUISdk.ready.then(async () => {
    const sandbox = await addOnUISdk.instance.runtime.apiProxy(RuntimeType.documentSandbox);

    scanBtn.addEventListener("click", async () => {
        scanBtn.disabled = true;
        output.textContent = "Se scanează...";
        try {
            const scan = await sandbox.scanPage();
            output.textContent = JSON.stringify(scan, null, 2);
        } catch (e) {
            console.error(e);
            output.textContent = "Eroare la scanare: " + (e.message || e);
        } finally {
            scanBtn.disabled = false;
        }
    });

    scanBtn.disabled = false;
});
