'use strict';

const crypto=require('node:crypto');
const VERSION='aria-proactive-fingerprint-v1.0.0';
function canonical(value){
 if(value===undefined)return'undefined';
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return'['+value.map(canonical).join(',')+']';
 return'{'+Object.keys(value).sort().map((key)=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
function sha256(value){return crypto.createHash('sha256').update(canonical(value)).digest('hex');}
function fingerprint(value){return sha256(value);}
module.exports=Object.freeze({VERSION,canonical,sha256,fingerprint});
