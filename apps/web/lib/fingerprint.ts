/**
 * Lightweight browser fingerprint generator.
 * Produces a deterministic hash from browser properties — no cookies, no tracking pixels.
 * Used to identify repeat visitors in the public "Ask Octopus" chat.
 */

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getCanvasFingerprint(): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";

    ctx.textBaseline = "top";
    ctx.font = "14px Arial";
    ctx.fillStyle = "#f60";
    ctx.fillRect(0, 0, 100, 50);
    ctx.fillStyle = "#069";
    ctx.fillText("Octopus fp", 2, 15);
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
    ctx.fillText("Octopus fp", 4, 17);

    return canvas.toDataURL();
  } catch {
    return "";
  }
}

function getWebGLFingerprint(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl || !(gl instanceof WebGLRenderingContext)) return "";

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    if (!debugInfo) return "";

    const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || "";
    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || "";
    return `${vendor}~${renderer}`;
  } catch {
    return "";
  }
}

export async function generateFingerprint(): Promise<string> {
  const signals = [
    // Screen
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    `${window.devicePixelRatio}`,
    // Timezone
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    new Date().getTimezoneOffset().toString(),
    // Navigator
    navigator.language,
    navigator.languages?.join(",") || "",
    navigator.hardwareConcurrency?.toString() || "",
    (navigator as { deviceMemory?: number }).deviceMemory?.toString() || "",
    navigator.maxTouchPoints?.toString() || "",
    navigator.platform || "",
    // Canvas
    getCanvasFingerprint(),
    // WebGL
    getWebGLFingerprint(),
  ];

  const raw = signals.join("|");
  return sha256(raw);
}
