'use strict';

function createPriorityQueue() {
  const items = [];
  return {
    push(goal) { items.push(goal); items.sort((a,b) => (b.priority-a.priority) || String(a.id).localeCompare(String(b.id))); },
    next() { return items.shift() || null; },
    peek() { return items[0] || null; },
    size() { return items.length; },
    snapshot() { return items.map(x => ({ ...x })); }
  };
}

module.exports = { createPriorityQueue };
