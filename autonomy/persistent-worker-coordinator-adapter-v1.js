'use strict';

// Marker-only adapter for a cloud coordinator. Planning, execution, replanning,
// and final verification are all delegated to the authenticated Windows worker.
module.exports = Object.freeze({ supabaseIndependent: true });
