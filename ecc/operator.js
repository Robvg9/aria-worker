'use strict';

const ECC_VERSION = '2.2.3';
const ALLOWED_ACTIONS = new Set(['consult', 'doctor', 'list_installed', 'install_preview']);
const ALLOWED_TARGETS = new Set(['codex', 'claude', 'kimi', 'gemini', 'qwen']);
const ALLOWED_PROFILES = new Set(['minimal', 'core']);

function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function normalizeEccRequest(input = {}) {
  if (!isPlainObject(input)) throw new TypeError('ecc input must be an object');
  const action = String(input.action || '').trim();
  if (!ALLOWED_ACTIONS.has(action)) throw new Error('ecc_action_not_allowed');
  const target = String(input.target || 'codex').trim().toLowerCase();
  if (!ALLOWED_TARGETS.has(target)) throw new Error('ecc_target_not_allowed');
  if (action === 'consult') { const topic = String(input.topic || '').trim(); if (!topic || topic.length > 2000) throw new Error('ecc_consult_topic_invalid'); return Object.freeze({ action, target, topic }); }
  if (action === 'install_preview') { const profile = String(input.profile || 'minimal').trim().toLowerCase(); if (!ALLOWED_PROFILES.has(profile)) throw new Error('ecc_profile_not_allowed'); return Object.freeze({ action, target, profile }); }
  return Object.freeze({ action, target });
}

function buildNodeRunnerCode(args) {
  return [
    'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process");',
    'const requestArgs=' + JSON.stringify(args) + ';',
    'const version="' + ECC_VERSION + '";',
    'const temp=fs.mkdtempSync(path.join(os.tmpdir(),"aria-ecc-"));',
    'try{',
    'const npmEnv={...process.env,npm_config_cache:path.join(temp,"npm-cache"),npm_config_userconfig:path.join(temp,".npmrc")};',
    'const installArgs=["install","--no-save","--ignore-scripts","--no-package-lock","--silent","ecc-universal@"+version];',
    'if(process.platform==="win32"){',
    'const npmCli=path.join(path.dirname(process.execPath),"node_modules","npm","bin","npm-cli.js");',
    'if(!fs.existsSync(npmCli)) throw new Error("windows_npm_cli_not_found");',
    'cp.execFileSync(process.execPath,[npmCli,...installArgs],{cwd:temp,stdio:"inherit",env:npmEnv});',
    '}else{',
    'cp.execFileSync("npm",installArgs,{cwd:temp,stdio:"inherit"});',
    '}',
    'const pkgPath=path.join(temp,"node_modules","ecc-universal","package.json");',
    'const pkg=JSON.parse(fs.readFileSync(pkgPath,"utf8"));',
    'const bin=typeof pkg.bin==="string"?pkg.bin:(pkg.bin&&(pkg.bin["ecc-universal"]||Object.values(pkg.bin)[0]));',
    'if(typeof bin!=="string"||!bin.trim()) throw new Error("ecc_cli_entry_not_found");',
    'const cli=path.resolve(temp,"node_modules","ecc-universal",bin);',
    'const result=cp.spawnSync(process.execPath,[cli,...requestArgs],{cwd:process.cwd(),stdio:"inherit"});',
    'if(result.error) throw result.error;',
    'process.exitCode=typeof result.status==="number"?result.status:1;',
    '}catch(error){console.error(error&&error.stack?error.stack:String(error));process.exitCode=1;',
    '}finally{try{fs.rmSync(temp,{recursive:true,force:true});}catch{}}'
  ].join('');
}
function buildEccShellCommand(input = {}) {
  const request = normalizeEccRequest(input);
  const args = request.action === 'consult' ? ['consult', request.topic, '--target', request.target] : request.action === 'doctor' ? ['doctor', '--target', request.target] : request.action === 'list_installed' ? ['list-installed'] : ['install', '--profile', request.profile, '--target', request.target, '--dry-run'];
  const encoded = Buffer.from(buildNodeRunnerCode(args), 'utf8').toString('base64');
  return 'node -e "eval(Buffer.from(\'' + encoded + '\',\'base64\').toString())"';
}

function buildEccExecution(input = {}) {
  const request = normalizeEccRequest(input);
  return Object.freeze({ tool_id: 'tool_ecc_operator', operation: 'ecc.execute', underlying_operation: 'shell.execute', request, command: buildEccShellCommand(request) });
}

module.exports = Object.freeze({ ECC_VERSION, ALLOWED_ACTIONS: [...ALLOWED_ACTIONS], ALLOWED_TARGETS: [...ALLOWED_TARGETS], ALLOWED_PROFILES: [...ALLOWED_PROFILES], normalizeEccRequest, buildEccShellCommand, buildEccExecution });