'use strict';
function selectAdapter(registry, required, preferred = []) { const list = registry.list().filter(x => x.status === 'available'); for (const id of preferred) { const a = registry.get(id); if (a && a.status === 'available' && required.every(c => (a.capabilities || []).includes(c))) return a; } return list.find(a => required.every(c => (a.capabilities || []).includes(c))) || null; }
module.exports = { selectAdapter };
