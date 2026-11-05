// Can this browser draw WebGL maps? Checked once per session. The course
// page's live overview needs it; without it the page shows a still
// satellite view instead.
let webglSupport: boolean | undefined;

export function supportsWebGL(): boolean {
  if (webglSupport !== undefined) return webglSupport;
  try {
    const canvas = document.createElement("canvas");
    webglSupport = Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}
