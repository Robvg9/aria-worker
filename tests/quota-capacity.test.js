// TEST 11 — Model Registry 10.2 still functions
ok(modelLookup.getModel(SEED_MODEL) !== null, 'TEST 11: getModel still resolves seed');
ok(modelLookup.modelsByProvider(SEED_PROVIDER).length >= 1,
  'TEST 11b: modelsByProvider(openrouter) still works');
ok(modelLookup.version === modelReg.version, 'TEST 11c: Model Registry version intact');

// TEST 12 — Capability Matrix 10.3 still functions
ok(capLookup.supports(SEED_MODEL, SEED_CAP) === true,
  'TEST 12: supports(text_generation) still true');
ok(capLookup.modelsByCapability(SEED_CAP).includes(SEED_MODEL),
  'TEST 12b: modelsByCapability still lists seed model');
ok(capLookup.version === capReg.version, 'TEST 12c: Capability Matrix version intact');

// TEST 13 — Account Manager 10.4 still functions
ok(accountLookup.version === 'aria-account-manager-v1.0.0', 'TEST 13: Account Manager version intact');
const seedCredentialRef = accountLookup.credentialRefOf(SEED_ID);
ok(typeof seedCredentialRef === 'string' && seedCredentialRef.startsWith(`secret://${SEED_PROVIDER}/`),
  'TEST 13b: credential_ref still a canonical secret reference');
ok(accountLookup.modelsOfAccount(SEED_ID).includes(SEED_MODEL),
  'TEST 13c: modelsOfAccount still lists seed model');
ok(!('quota' in (accountLookup.getAccount(SEED_ID) || {})),
  'TEST 13d: Account Manager still does not copy quota');

// TEST 14 — no Router logic
ok(!/selectModel|chooseAccount|routeTo|bestAccount|pickRoute/.test(lookupSrc),
  'TEST 14: lookup contains no router selection logic');
ok(!('router' in registry) && !('fallback' in registry),
  'TEST 14b: registry has no router/fallback objects');
