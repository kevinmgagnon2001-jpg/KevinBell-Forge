/**
 * The scale the world is being drawn at this frame (Upscaler.tsx sets it; 1 when not upscaling).
 * Points are sized in pixels of the canvas, so anything drawing points multiplies its size by this to
 * keep the same size on screen when the world is drawn small and upscaled. It is shaped like a shader
 * uniform ({ value }), so a ShaderMaterial can hold it directly.
 */
export const pointScale = { value: 1 };
