const fs = require('fs');
let code = fs.readFileSync('App.js', 'utf8');

const oldPHce = `const pHce=useCallback((m)=>{
setHSt(p=>({t:p.t+1,s:p.s+(m.apdu?.startsWith('00A40400')?1:0),o:p.o+(m.apdu?.startsWith('00A40400')?0:1)}));
let r='9000';
if(hMode===2)r=hCust.replace(/\\s/g,'').toUpperCase()||'9000';
else if(m.apdu?.startsWith('00A40400'))r='6F0A84064E464354554C9000';
else if(m.apdu?.startsWith('80A800'))r='771682021800009000';
ws.current?.send(JSON.stringify({type:'APDU_RELAY_RESPONSE',requestId:m.requestId,apdu:r}));
setHLog(p=>[{cmd:m.apdu,rsp:r,ts:Date.now()},...p].slice(0,50));
addEv({type:'HCE',src:'LOCAL',data:\`\${m.apdu?.slice(0,16)}->\${r}\`});
},[hMode,hCust,addEv]);`;

const newPHce = `const pHce=useCallback(async(m)=>{
setHSt(p=>({t:p.t+1,s:p.s+(m.apdu?.startsWith('00A40400')?1:0),o:p.o+(m.apdu?.startsWith('00A40400')?0:1)}));
const apduBytes=hB(m.apdu||'');
let r='6F00';
try{
if(hMode===2){
// Custom response
r=hCust.replace(/\\s/g,'').toUpperCase()||'9000';
}else if(hMode===1){
// Relay WS - trimite mai departe
ws.current?.send(JSON.stringify({type:'APDU_RELAY_REQUEST',targetClientId:'card',apdu:m.apdu,requestId:m.requestId}));
return;
}else{
// Auto - citeste card fizic real
if(cardConnected.current){
try{
const resp=await NfcManager.isoDepHandler.transceive(apduBytes);
r=bH(resp);
}catch(e){
r='6F00';
}
}else{
// Fallback local
if(m.apdu?.startsWith('00A40400'))r='6F0A84064E464354554C9000';
else if(m.apdu?.startsWith('80A800'))r='771682021800009000';
else r='9000';
}
}
}catch(e){r='6F00';}
ws.current?.send(JSON.stringify({type:'APDU_RELAY_RESPONSE',requestId:m.requestId,apdu:r}));
setHLog(p=>[{cmd:m.apdu,rsp:r,ts:Date.now()},...p].slice(0,50));
addEv({type:'HCE',src:cardConnected.current?'CARD':'LOCAL',data:\`\${m.apdu?.slice(0,16)}->\${r}\`});
},[hMode,hCust,addEv]);`;

if(code.includes(oldPHce)){
  code = code.replace(oldPHce, newPHce);
  console.log('pHce replaced!');
} else {
  console.log('Pattern not found - trying alternative...');
  // Save what we have for inspection
  fs.writeFileSync('debug.txt', code.substring(code.indexOf('pHce'), code.indexOf('pHce')+500));
}

// Add cardConnected ref
code = code.replace(
  'const loopRef=useRef(false);const lastTagRef=useRef(\'\');',
  'const loopRef=useRef(false);const lastTagRef=useRef(\'\');const cardConnected=useRef(false);'
);

fs.writeFileSync('App.js', code);
console.log('Done!');
