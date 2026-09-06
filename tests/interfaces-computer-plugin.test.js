'use strict';
const assert=require('node:assert/strict');
const {createComputerAction,validateComputerResult}=require('../computer-use/executor-contract');
const {registerPlugin,enablePlugin,disablePlugin}=require('../platform/plugin-registry');
const a=createComputerAction({id:'a1',action:'click',target:{x:1,y:2}});assert.equal(a.action,'click');assert.equal(validateComputerResult({action_id:'a1',status:'succeeded'}).valid,true);assert.throws(()=>createComputerAction({id:'a2',action:'type'}),/text_required/);
let r=registerPlugin([],{id:'p1',version:'1.0.0'});assert.equal(r[0].state,'discovered');assert.throws(()=>enablePlugin(r,'p1',{}),/plugin_verification_required/);r=enablePlugin(r,'p1',{tests_passed:true,security_passed:true});assert.equal(r[0].state,'enabled');r=disablePlugin(r,'p1');assert.equal(r[0].state,'disabled');
console.log('INTERFACE COMPUTER PLUGIN TESTS PASS');
