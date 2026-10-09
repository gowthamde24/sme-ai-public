/**
 * Whether the browser can create a WebGL context at all. A positive answer is cached for the page's
 * life (a capability does not go away); a negative one is re-checked on demand, so one transient
 * failure can never become permanent. The probe context is released immediately.
 */
let known = false;

export function webglAvailable(): boolean {
  if (known) return true;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | WebGL2RenderingContext | null;
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    known = true;
    return true;
  } catch {
    return false;
  }
}
