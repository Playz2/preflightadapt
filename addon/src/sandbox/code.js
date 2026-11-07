import addOnSandboxSdk from "add-on-sdk-document-sandbox";
import { editor, colorUtils } from "express-document-sdk";

const { runtime } = addOnSandboxSdk.instance;
const nodesById = new Map();

function walk(node, out) { // parcurge tot arborele paginii
    for (const child of node.allChildren) {
        out.push(child);
        if (child.allChildren) walk(child, out);
    }
}

const hex = (c) => colorUtils.toHex(c).slice(0, 7); // toHex dă #RRGGBBAA
const box = (b) => ({ x: b.x, y: b.y, w: b.width, h: b.height });

function scanPage() {
    const board = editor.context.insertionParent; // artboard-ul paginii curente
    const all = []; walk(board, all);
    nodesById.clear();
    const texts = [], shapes = [];
    for (const n of all) {
        try {
            if (n.type === "Text") {
                const st = n.fullContent.characterStyleRanges[0];
                nodesById.set(n.id, n);
                texts.push({ id: n.id, text: n.fullContent.text, color: hex(st.color),
                    fontSize: st.fontSize, bounds: box(n.boundsInParent) });
            } else if (n.fill && n.fill.color) {
                nodesById.set(n.id, n);
                shapes.push({ id: n.id, type: n.type, fill: hex(n.fill.color), bounds: box(n.boundsInParent) });
            }
        } catch (e) { /* nod care nu poate fi citit: îl ignorăm */ }
    }
    return { page: { width: board.width, height: board.height }, texts, shapes };
}

function setTextColor(id, h) {
    const n = nodesById.get(id); if (!n) return false;
    n.fullContent.applyCharacterStyles({ color: colorUtils.fromHex(h) }); return true;
}

function setFill(id, h) {
    const n = nodesById.get(id); if (!n) return false;
    n.fill = editor.makeColorFill(colorUtils.fromHex(h)); return true;
}

function replaceText(id, txt) {
    const n = nodesById.get(id); if (!n) return false;
    n.fullContent.text = txt; return true;
}

// eticheta "Imagine generată cu AI" (dreapta-jos) sau disclaimerul (stânga-jos)
function addLabel(text, { corner = "br", size = 22, color = "#FFFFFF", bg = "#0F172A", pad = 24 } = {}) {
    const board = editor.context.insertionParent;
    const rect = bg ? editor.createRectangle() : null;
    if (rect) board.children.append(rect); // întâi fundalul, apoi textul deasupra
    const t = editor.createText(text);
    board.children.append(t);
    t.fullContent.applyCharacterStyles({ fontSize: size, color: colorUtils.fromHex(color) });
    const b = t.boundsLocal, right = corner === "br";
    const x = right ? board.width - pad : pad, y = board.height - pad;
    if (rect) {
        rect.width = b.width + 20; rect.height = b.height + 12;
        rect.fill = editor.makeColorFill(colorUtils.fromHex(bg));
        rect.setPositionInParent({ x, y }, { x: right ? rect.width : 0, y: rect.height });
    }
    const dx = rect ? (right ? -10 : 10) : 0, dy = rect ? -6 : 0;
    t.setPositionInParent({ x: x + dx, y: y + dy }, { x: right ? b.x + b.width : b.x, y: b.y + b.height });
    return t.id;
}

runtime.exposeApi({ scanPage, setTextColor, setFill, replaceText, addLabel });
