'use strict';
function negotiate(required = [], available = []) { const have = new Set(available); return { supported: required.every(x => have.has(x)), missing: required.filter(x => !have.has(x)) }; }
module.exports = { negotiate };
