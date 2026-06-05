export function generateFingerprintScript(seed: string): string {
  return `
(function() {
  // Deterministic PRNG from seed (simple xorshift32)
  let s = 0;
  for (let i = 0; i < ${JSON.stringify(seed)}.length; i++) {
    s = ((s << 5) - s + ${JSON.stringify(seed)}.charCodeAt(i)) | 0;
  }
  function rand() {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  }

  // Canvas fingerprint noise
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(...args) {
    const ctx = this.getContext('2d');
    if (ctx) {
      const noise = ctx.createImageData(1, 1);
      noise.data[0] = (rand() * 10) | 0;
      noise.data[1] = (rand() * 10) | 0;
      noise.data[2] = (rand() * 10) | 0;
      noise.data[3] = 255;
      ctx.putImageData(noise, 0, 0);
    }
    return origToDataURL.apply(this, args);
  };

  const origToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function(cb, ...args) {
    const ctx = this.getContext('2d');
    if (ctx) {
      const noise = ctx.createImageData(1, 1);
      noise.data[0] = (rand() * 10) | 0;
      noise.data[1] = (rand() * 10) | 0;
      noise.data[2] = (rand() * 10) | 0;
      noise.data[3] = 255;
      ctx.putImageData(noise, 0, 0);
    }
    return origToBlob.call(this, cb, ...args);
  };

  // WebGL renderer/vendor
  const vendors = ['Google Inc.', 'Google Inc. (NVIDIA)', 'Google Inc. (AMD)', 'Google Inc. (Intel)'];
  const renderers = [
    'ANGLE (NVIDIA GeForce GTX 1080 Direct3D11)',
    'ANGLE (AMD Radeon RX 580 Direct3D11)',
    'ANGLE (Intel HD Graphics 630 Direct3D11)',
    'ANGLE (NVIDIA GeForce RTX 3060 Direct3D11)',
    'ANGLE (AMD Radeon RX 6700 XT Direct3D11)',
  ];
  const vendorIdx = (rand() * vendors.length) | 0;
  const rendererIdx = (rand() * renderers.length) | 0;

  const origGetParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(param) {
    if (param === 37445) return vendors[vendorIdx];
    if (param === 37446) return renderers[rendererIdx];
    return origGetParameter.call(this, param);
  };
  if (typeof WebGL2RenderingContext !== 'undefined') {
    const origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(param) {
      if (param === 37445) return vendors[vendorIdx];
      if (param === 37446) return renderers[rendererIdx];
      return origGetParam2.call(this, param);
    };
  }

  // Navigator properties
  const cores = [2, 4, 6, 8, 12, 16];
  const memory = [2, 4, 8, 16, 32];
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cores[(rand() * cores.length) | 0] });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => memory[(rand() * memory.length) | 0] });

  // AudioContext fingerprint offset
  const origCreateOscillator = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function() {
    const osc = origCreateOscillator.call(this);
    const origConnect = osc.connect.bind(osc);
    osc.connect = function(dest, ...a) {
      if (dest instanceof AnalyserNode) {
        osc.detune.value = (rand() - 0.5) * 0.01;
      }
      return origConnect(dest, ...a);
    };
    return osc;
  };
})();
`;
}
