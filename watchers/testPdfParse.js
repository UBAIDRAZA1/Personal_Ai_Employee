try {
  const mod = require('pdf-parse');
  console.log('typeof module:', typeof mod);
  console.log('keys:', Object.keys(mod || {}));
  if (mod && mod.default) {
    console.log('typeof default:', typeof mod.default);
  }
} catch (e) {
  console.error('require error:', e && e.message ? e.message : e);
}
