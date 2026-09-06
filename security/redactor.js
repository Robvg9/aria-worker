'use strict';
const PATTERNS=[/[A-Za-z0-9_-]{24,}/g,/Bearer\s+[A-Za-z0-9._-]+/gi,/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY[\s\S]*?END (?:RSA |EC |OPENSSH )?PRIVATE KEY/g];
function redact(value){const text=typeof value==='string'?value:JSON.stringify(value??'');let out=text;for(const re of PATTERNS)out=out.replace(re,'***');return out;}
function safeEvent(event){return JSON.parse(redact(event));}
module.exports={redact,safeEvent};
