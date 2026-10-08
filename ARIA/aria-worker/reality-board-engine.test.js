const assert = require('assert');
const { getRealityBoardStatus } = require('./reality-board-engine');

describe('ARIA Reality Board Multi-Project Tests', () => {
  it('should return valid reality board status for ARIA, CuevaCoin, and BattleCruiser', () => {
    const status = getRealityBoardStatus();
    assert.strictEqual(status.project, 'ARIA Reality Board Multi-Project');
    assert.ok(status.aria, 'ARIA project status missing');
    assert.ok(status.cuevacoin, 'CuevaCoin project status missing');
    assert.ok(status.battlecruiser, 'BattleCruiser project status missing');
    
    assert.strictEqual(status.aria.confirmed, true);
    assert.strictEqual(status.cuevacoin.confirmed, true);
    assert.strictEqual(status.battlecruiser.confirmed, true);
  });
});
