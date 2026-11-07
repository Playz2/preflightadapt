import addOnUISdk, { RuntimeType } from "https://new.express.adobe.com/static/add-on-sdk/sdk.js";
import { checkContrast, checkPalette, checkDisclaimer, score } from "./engine.js";
import KIT from "./brandkit.json";

const scanBtn = document.getElementById("scan");
const output = document.getElementById("output");

addOnUISdk.ready.then(async () => {
    const sandbox = await addOnUISdk.instance.runtime.apiProxy(RuntimeType.documentSandbox);

    scanBtn.addEventListener("click", async () => {
        scanBtn.disabled = true;
        output.textContent = "Se scanează...";
        try {
            const scan = await sandbox.scanPage();
            const [r] = await addOnUISdk.app.document.createRenditions(
                { range: addOnUISdk.constants.Range.currentPage, format: addOnUISdk.constants.RenditionFormat.png },
                addOnUISdk.constants.RenditionIntent.preview
            );
            const issues = [...await checkContrast(r.blob, scan), ...checkPalette(scan, KIT), ...checkDisclaimer(scan, KIT)];
            output.textContent = JSON.stringify({ scor: score(issues), probleme: issues, scan }, null, 2);
        } catch (e) {
            console.error(e);
            output.textContent = "Eroare la scanare: " + (e.message || e);
        } finally {
            scanBtn.disabled = false;
        }
    });

    scanBtn.disabled = false;
});
