/**
 * Lightweight browser fingerprint generator.
 * Produces a deterministic hash from stable browser properties only.
 * Fragile signals (screen size, DPR, timezone offset, etc.) are excluded
 * from the primary hash to avoid fingerprint breakage on monitor switch,
 * zoom change, or DST transition.
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

function getWebGLRenderer(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
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

/**
 * Bucket a numeric value into a coarse range.
 * e.g. bucketize(8, 4) => "8" (8GB RAM), bucketize(6, 4) => "4" (rounds down to nearest 4)
 */
function bucketize(value: number, step: number): string {
  return (Math.floor(value / step) * step).toString();
}

export async function generateFingerprint(): Promise<string> {
  // --- Stable signals (primary hash) ---
  // These rarely change for the same user on the same device.
  const stableSignals = [
    // Timezone name (not offset -- offset changes with DST)
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    // Language preferences
    navigator.language,
    navigator.languages?.join(",") || "",
    // Hardware (hardwareConcurrency is stable per device)
    navigator.hardwareConcurrency?.toString() || "",
    // Touch capability (stable per device)
    navigator.maxTouchPoints?.toString() || "",
    // Platform
    navigator.platform || "",
    // Canvas fingerprint (GPU + font rendering, very stable)
    getCanvasFingerprint(),
  ];

  const raw = stableSignals.join("|");
  return sha256(raw);
}

/**
 * Collect secondary (fragile) signals as metadata.
 * These are NOT included in the fingerprint hash but can be stored
 * alongside it for additional context or fuzzy matching.
 */
export function getSecondarySignals(): Record<string, string> {
  const webgl = getWebGLRenderer();
  const deviceMemory = (navigator as { deviceMemory?: number }).deviceMemory;

  return {
    screenResolution: `${screen.width}x${screen.height}x${screen.colorDepth}`,
    devicePixelRatio: window.devicePixelRatio?.toString() || "",
    timezoneOffset: new Date().getTimezoneOffset().toString(),
    // Bucketed to 4GB ranges since browser already coarsens this
    deviceMemory: deviceMemory ? bucketize(deviceMemory, 4) : "",
    // WebGL may be unavailable due to privacy settings
    webglRenderer: webgl,
  };
}
