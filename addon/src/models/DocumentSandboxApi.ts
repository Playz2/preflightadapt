// This interface declares all the APIs that the document sandbox runtime ( i.e. code.js ) exposes to the UI/iframe runtime
export interface DocumentSandboxApi {
    scanPage(): {
        page: { width: number; height: number };
        texts: { id: string; text: string; color: string; fontSize: number; bounds: Bounds }[];
        shapes: { id: string; type: string; fill: string; bounds: Bounds }[];
    };
    setTextColor(id: string, hex: string): boolean;
    setFill(id: string, hex: string): boolean;
    replaceText(id: string, text: string): boolean;
    addLabel(
        text: string,
        options?: { corner?: "br" | "bl"; size?: number; color?: string; bg?: string | null; pad?: number }
    ): string;
}

interface Bounds {
    x: number;
    y: number;
    w: number;
    h: number;
}
