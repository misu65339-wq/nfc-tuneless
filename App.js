import{useState,useRef,useEffect,useCallback}from'react';
import{AsyncStorage}from'react-native';
import{View,Text,TouchableOpacity,ScrollView,StyleSheet,StatusBar,NativeModules,NativeEventEmitter,Platform,AppState}from'react-native';
import{SafeAreaView}from'react-native-safe-area-context';
import NfcManager,{NfcTech}from'react-native-nfc-manager';

const C={bg0:'#03060A',bg1:'#080F18',bg2:'#0D1A2A',b1:'#1A2E45',b2:'#1F3A55',c1:'#00D4FF',c2:'#FF6600',c3:'#39FF14',c4:'#FF2D78',c5:'#A855F7',t1:'#E2EEF9',t2:'#7FA8CC',t3:'#3D6080'};
const SERVER_URL='wss://nfctuneless.serveousercontent.com';

function bH(b=[]){return Array.from(b).map(x=>(x&0xFF).toString(16).toUpperCase().padStart(2,'0')).join('')}
function hB(h=''){const c=h.replace(/\s/g,'');return Array.from({length:c.length/2},(_,i)=>parseInt(c.substring(i*2,i*2+2),16))}
function fT(ts){const d=new Date(ts);return`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`}

// Reset complet NFC - rezolva "only one card at a time"
async function resetNfc(){
try{await NfcManager.cancelTechnologyRequest();}catch(e){}
try{await NfcManager.unregisterTagEvent();}catch(e){}
try{await NfcManager.stop();}catch(e){}
await new Promise(r=>setTimeout(r,600));
try{await NfcManager.start();}catch(e){}
await new Promise(r=>setTimeout(r,200));
}

export default function App(){
const[mode,setMode]=useState(null);
const[loading,setLoading]=useState(true);
const ws=useRef(null);
const pending=useRef({});
const isoDepRef=useRef(null);
const readerRelay=useRef(false);
const hceEmitterRef=useRef(null);
const keepAliveRef=useRef(null);
const autoRestartRef=useRef(true);
const clientsRef=useRef([]);
const myIdRef=useRef(null);
const modeRef=useRef(null);
const connectingCard=useRef(false);
const connectingHce=useRef(false);

const[st,setSt]=useState('disconnected');
const[myId,setMyId]=useState(null);
const[clients,setClients]=useState([]);
const[logs,setLogs]=useState([]);
const[cardOk,setCardOk]=useState(false);
const[hceActive,setHceActive]=useState(false);
const[nfcOk,setNfcOk]=useState(false);
const[stats,setStats]=useState({total:0,ok:0,fail:0});

const addLog=useCallback((msg,color)=>{
setLogs(p=>[{msg,color:color||C.t2,ts:Date.now()},...p].slice(0,50));
},[]);

useEffect(()=>{modeRef.current=mode;},[mode]);
useEffect(()=>{clientsRef.current=clients;},[clients]);
useEffect(()=>{myIdRef.current=myId;},[myId]);

// Restaurare rol salvat
useEffect(()=>{
(async()=>{
try{
const saved=await AsyncStorage.getItem('role');
if(saved==='A'||saved==='B'){setMode(saved);}
}catch(e){}
setLoading(false);
})();
},[]);

// NFC Init
useEffect(()=>{
let mounted=true;
const initNfc=async()=>{
try{
await new Promise(r=>setTimeout(r,1000));
let ok=false;
try{ok=await NfcManager.isSupported();}catch(e){ok=true;}
setNfcOk(ok);
if(ok){
try{await NfcManager.start();}catch(e){}
}
}catch(e){}
};
initNfc();
return()=>{
mounted=false;
autoRestartRef.current=false;
try{NfcManager.cancelTechnologyRequest();}catch(e){}
if(keepAliveRef.current)clearInterval(keepAliveRef.current);
};
},[]);

// Disconnect card complet
const disconnectCard=useCallback(async()=>{
if(keepAliveRef.current){clearInterval(keepAliveRef.current);keepAliveRef.current=null;}
readerRelay.current=false;
isoDepRef.current=null;
setCardOk(false);
await resetNfc();
},[]);

// Connect card fizic (Telefon B)
const connectCard=useCallback(async()=>{
if(connectingCard.current)return;
connectingCard.current=true;

try{
// Reset complet inainte de orice
await disconnectCard();
addLog('Așteaptă card...',C.t2);

await NfcManager.requestTechnology([NfcTech.IsoDep]);
const tag=await NfcManager.getTag();
if(!tag)throw new Error('Tag null');

isoDepRef.current=tag;
readerRelay.current=true;
setCardOk(true);
addLog('✅ Card conectat! Relay activ.',C.c3);

keepAliveRef.current=null;

}catch(e){
await disconnectCard();
if(e.message!=='cancelled'){
addLog(`Eroare: ${e.message}`,C.c4);
if(autoRestartRef.current){
connectingCard.current=false;
setTimeout(()=>connectCard(),1000);
return;
}
}
}
connectingCard.current=false;
},[addLog,disconnectCard]);

// Stop HCE complet
const stopHce=useCallback(()=>{
if(hceEmitterRef.current){
try{hceEmitterRef.current.remove();}catch(e){}
hceEmitterRef.current=null;
}
const{HceModule}=NativeModules;
if(HceModule){
try{HceModule.setActive(false);}catch(e){}
}
setHceActive(false);
connectingHce.current=false;
addLog('Emulator oprit',C.c2);
},[addLog]);

// Start HCE (Telefon A)
const startHce=useCallback(()=>{
if(connectingHce.current)return;
connectingHce.current=true;

const{HceModule}=NativeModules;
if(!HceModule){
addLog('HCE indisponibil!',C.c4);
connectingHce.current=false;
return;
}

// Reset complet HCE
try{HceModule.setActive(false);}catch(e){}
if(hceEmitterRef.current){
try{hceEmitterRef.current.remove();}catch(e){}
hceEmitterRef.current=null;
}

setTimeout(()=>{
try{
HceModule.setActive(true);
const emitter=new NativeEventEmitter(HceModule);
const sub=emitter.addListener('onApduCommand',(event)=>{
const{requestId,apdu}=event;
addLog(`POS→ ${apdu.slice(0,20)}`,C.c2);
setStats(p=>({...p,total:p.total+1}));
const target=clientsRef.current.find(c=>c.id!==myIdRef.current);
if(ws.current?.readyState===1&&target){
pending.current[requestId]={
resolve:(resp)=>{
try{HceModule.deliverResponse(requestId,resp);}catch(e){}
addLog(`←OK ${resp.slice(0,16)}`,C.c3);
setStats(p=>({...p,ok:p.ok+1}));
},
reject:()=>{
try{HceModule.deliverResponse(requestId,'6F00');}catch(e){}
setStats(p=>({...p,fail:p.fail+1}));
},
timer:setTimeout(()=>{
try{HceModule.deliverResponse(requestId,'6F00');}catch(e){}
delete pending.current[requestId];
setStats(p=>({...p,fail:p.fail+1}));
addLog('TIMEOUT!',C.c4);
},4500)
};
ws.current.send(JSON.stringify({type:'APDU_RELAY_REQUEST',targetClientId:target.id,apdu,requestId}));
}else{
try{HceModule.deliverResponse(requestId,'6F00');}catch(e){}
addLog(target?'Server deconectat!':'Telefon B lipsă!',C.c4);
}
});
hceEmitterRef.current=sub;
setHceActive(true);
connectingHce.current=false;
addLog('✅ Emulator pornit! Apropie de POS.',C.c3);
}catch(e){
addLog(`HCE Eroare: ${e.message}`,C.c4);
connectingHce.current=false;
if(autoRestartRef.current)setTimeout(()=>startHce(),1000);
}
},500);
},[addLog]);

const toggleHce=useCallback(()=>{
if(hceActive)stopHce();
else startHce();
},[hceActive,startHce,stopHce]);

const toggleCard=useCallback(async()=>{
if(cardOk){
autoRestartRef.current=false;
await disconnectCard();
addLog('Card deconectat manual',C.c2);
autoRestartRef.current=true;
}else{
await connectCard();
}
},[cardOk,connectCard,disconnectCard,addLog]);

// WebSocket connect
const connect=useCallback(()=>{
if(ws.current&&ws.current.readyState===1){ws.current.close();ws.current=null;return;}
setSt('connecting');
try{
const s=new WebSocket(SERVER_URL);
ws.current=s;
s.onopen=()=>{
setSt('connected');
const r=modeRef.current==='A'?'emulator':'reader';
s.send(JSON.stringify({type:'REGISTER',role:r,info:{device:`NFC Tuneless ${modeRef.current}`}}));
s.send(JSON.stringify({type:'GET_CLIENTS'}));
addLog('✅ Conectat la server',C.c3);
if(Platform.OS==='android'){
const{HceModule}=NativeModules;
HceModule?.startForegroundService&&HceModule.startForegroundService();
}
if(modeRef.current==='A')setTimeout(()=>startHce(),1500);
else if(modeRef.current==='B')setTimeout(()=>connectCard(),1500);
};
s.onclose=()=>{
setSt('disconnected');ws.current=null;
addLog('Deconectat - reconectare...',C.c4);
if(autoRestartRef.current)setTimeout(()=>connect(),3000);
};
s.onerror=()=>{setSt('disconnected');ws.current=null;};
s.onmessage=(e)=>{
try{
const m=JSON.parse(e.data);
switch(m.type){
case 'CONNECTED':setMyId(m.clientId);myIdRef.current=m.clientId;break;
case 'SERVER_STATE':case 'CLIENTS_LIST':
const f=(m.clients||[]).filter(c=>c.id!==myIdRef.current);
setClients(f);clientsRef.current=f;
break;
case 'APDU_COMMAND':
if(modeRef.current==='B'&&readerRelay.current&&isoDepRef.current){
(async()=>{
try{
const resp=await NfcManager.isoDepHandler.transceive(hB(m.apdu||''));
const respHex=bH(resp);
ws.current?.send(JSON.stringify({type:'APDU_RELAY_RESPONSE',requestId:m.requestId,apdu:respHex}));
addLog(`Card→ ${respHex.slice(0,16)}`,C.c3);
}catch(e){
ws.current?.send(JSON.stringify({type:'APDU_RELAY_RESPONSE',requestId:m.requestId,apdu:'6F00'}));
addLog(`Card ERR: ${e.message}`,C.c4);
await disconnectCard();
addLog('Reconectare card...',C.c4);
if(autoRestartRef.current)setTimeout(()=>connectCard(),500);
}
})();
}
break;
case 'APDU_RELAY_RESPONSE':{
const p=pending.current[m.requestId];
if(p){clearTimeout(p.timer);p.resolve(m.apdu);delete pending.current[m.requestId];}
break;
}
case 'APDU_RELAY_ERROR':{
const p=pending.current[m.requestId];
if(p){clearTimeout(p.timer);p.reject();delete pending.current[m.requestId];}
break;
}
}
}catch{}
};
}catch{setSt('disconnected');}
},[addLog,startHce,connectCard,disconnectCard]);

useEffect(()=>{
const sub=AppState.addEventListener('change',(state)=>{
if(state==='active'&&(!ws.current||ws.current.readyState!==1)){
setTimeout(()=>connect(),1000);
}
});
return()=>sub.remove();
},[connect]);

useEffect(()=>{
const t=setInterval(()=>{
if(ws.current?.readyState===1)ws.current.send(JSON.stringify({type:'PING'}));
},10000);
return()=>clearInterval(t);
},[]);

useEffect(()=>{
if(mode){
autoRestartRef.current=true;
setTimeout(()=>connect(),500);
}
},[mode]);

const stC=st==='connected'?C.c3:st==='connecting'?'#FFBE00':C.c4;
const otherConnected=clients.length>0;

if(!mode){
return(
<SafeAreaView style={s.root}>
<StatusBar barStyle="light-content" backgroundColor={C.bg1}/>
<View style={s.center}>
<Text style={s.title}>NFC TUNELESS</Text>
<Text style={s.subtitle}>Selectează rolul acestui telefon</Text>
<TouchableOpacity style={[s.roleCard,{borderColor:C.c1}]} onPress={()=>{setMode('A');try{AsyncStorage.setItem('role','A');}catch(e){}}}>
<Text style={s.roleIcon}>📱</Text>
<Text style={[s.roleTitle,{color:C.c1}]}>TELEFON A</Text>
<Text style={s.roleDesc}>Lângă POS / ATM</Text>
<Text style={s.roleDesc2}>Emulează cardul automat</Text>
</TouchableOpacity>
<TouchableOpacity style={[s.roleCard,{borderColor:C.c3,marginTop:20}]} onPress={()=>{setMode('B');try{AsyncStorage.setItem('role','B');}catch(e){}}}>
<Text style={s.roleIcon}>💳</Text>
<Text style={[s.roleTitle,{color:C.c3}]}>TELEFON B</Text>
<Text style={s.roleDesc}>Lângă cardul fizic</Text>
<Text style={s.roleDesc2}>Conectează cardul automat</Text>
</TouchableOpacity>
</View>
</SafeAreaView>
);
}

return(
<SafeAreaView style={s.root}>
<StatusBar barStyle="light-content" backgroundColor={C.bg1}/>
<View style={s.header}>
<View>
<Text style={s.title2}>TELEFON {mode}</Text>
<Text style={[s.stText,{color:stC}]}>{st==='connected'?'CONECTAT':st==='connecting'?'CONECTARE...':'DECONECTAT'}</Text>
</View>
<View style={s.statsBox}>
<Text style={[s.statN,{color:C.c3}]}>{stats.ok}</Text>
<Text style={s.statL}>OK</Text>
<Text style={[s.statN,{color:C.c4,marginLeft:12}]}>{stats.fail}</Text>
<Text style={s.statL}>ERR</Text>
</View>
</View>
<View style={s.statusBar}>
<View style={[s.statusDot,{backgroundColor:st==='connected'?C.c3:C.c4}]}/>
<Text style={[s.statusTxt,{color:st==='connected'?C.c3:C.c4}]}>SERVER</Text>
<View style={{width:1,height:16,backgroundColor:C.b1,marginHorizontal:12}}/>
<View style={[s.statusDot,{backgroundColor:nfcOk?C.c3:C.c4}]}/>
<Text style={[s.statusTxt,{color:nfcOk?C.c3:C.c4}]}>NFC</Text>
<View style={{width:1,height:16,backgroundColor:C.b1,marginHorizontal:12}}/>
<View style={[s.statusDot,{backgroundColor:otherConnected?C.c3:C.c4}]}/>
<Text style={[s.statusTxt,{color:otherConnected?C.c3:C.c4}]}>{mode==='A'?'TEL B':'TEL A'} {otherConnected?'✅':'❌'}</Text>
</View>
<ScrollView contentContainerStyle={s.pg}>
<View style={[s.statusCard,{borderColor:mode==='A'?(hceActive?C.c3:C.c4):(cardOk?C.c3:C.t3)}]}>
<Text style={s.statusIcon}>{mode==='A'?(hceActive?'✅':'⏳'):(cardOk?'✅':'⏳')}</Text>
<Text style={[s.statusMain,{color:mode==='A'?(hceActive?C.c3:C.t2):(cardOk?C.c3:C.t2)}]}>
{mode==='A'?(hceActive?'EMULATOR ACTIV':'PORNIRE...'):(cardOk?'CARD CONECTAT':'AȘTEAPTĂ CARD...')}
</Text>
<Text style={s.statusSub}>
{mode==='A'?(hceActive?'Apropie de POS/ATM':'Se configurează...'):(cardOk?'Relay activ - nu mișca cardul':'Apropie cardul de telefon')}
</Text>
</View>
<TouchableOpacity
style={[s.manualBtn,{borderColor:mode==='A'?(hceActive?C.c4:C.c1):(cardOk?C.c4:C.c3)}]}
onPress={mode==='A'?toggleHce:toggleCard}
disabled={st!=='connected'}>
<Text style={[s.manualBtnTxt,{color:mode==='A'?(hceActive?C.c4:C.c1):(cardOk?C.c4:C.c3)}]}>
{mode==='A'?(hceActive?'⏹ OPREȘTE':'▶ PORNEȘTE MANUAL'):(cardOk?'⏹ DECONECTEAZĂ':'💳 CONECTEAZĂ MANUAL')}
</Text>
</TouchableOpacity>
{!otherConnected&&(
<View style={s.warning}>
<Text style={s.warningTxt}>⚠️ {mode==='A'?'Telefonul B':'Telefonul A'} nu e conectat!</Text>
</View>
)}
<View style={s.logCard}>
<View style={s.logHeader}>
<Text style={s.lbl}>LOG</Text>
<TouchableOpacity onPress={()=>setLogs([])}>
<Text style={{fontFamily:'monospace',fontSize:10,color:C.c4}}>CLEAR</Text>
</TouchableOpacity>
</View>
<View style={s.logBox}>
{logs.length===0?<Text style={s.empty}>Nicio activitate</Text>:logs.slice(0,30).map((l,i)=>(
<Text key={i} style={[s.logRow,{color:l.color}]}>{fT(l.ts)} {l.msg}</Text>
))}
</View>
</View>
<TouchableOpacity style={s.changeRole} onPress={async()=>{
autoRestartRef.current=false;
stopHce();
await disconnectCard();
if(ws.current){ws.current.close();ws.current=null;}
setSt('disconnected');
setMode(null);
}}>
<Text style={{fontFamily:'monospace',fontSize:10,color:C.t3}}>← SCHIMBĂ ROLUL</Text>
</TouchableOpacity>
</ScrollView>
</SafeAreaView>
);
}

const s=StyleSheet.create({
root:{flex:1,backgroundColor:C.bg0},
center:{flex:1,alignItems:'center',justifyContent:'center',padding:24},
title:{fontFamily:'monospace',fontSize:22,color:C.c1,letterSpacing:4,fontWeight:'bold',marginBottom:8},
subtitle:{fontFamily:'monospace',fontSize:12,color:C.t3,marginBottom:40,letterSpacing:1},
roleCard:{borderWidth:2,borderRadius:16,padding:24,width:'100%',alignItems:'center',backgroundColor:C.bg2},
roleIcon:{fontSize:48,marginBottom:8},
roleTitle:{fontFamily:'monospace',fontSize:18,fontWeight:'bold',letterSpacing:3,marginBottom:4},
roleDesc:{fontFamily:'monospace',fontSize:12,color:C.t2,marginBottom:2},
roleDesc2:{fontFamily:'monospace',fontSize:11,color:C.t3},
header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:C.bg1,padding:14,borderBottomWidth:1,borderBottomColor:C.b1},
title2:{fontFamily:'monospace',fontSize:18,color:C.c1,letterSpacing:3,fontWeight:'bold'},
stText:{fontFamily:'monospace',fontSize:11,marginTop:2},
statsBox:{flexDirection:'row',alignItems:'center'},
statN:{fontFamily:'monospace',fontSize:22,fontWeight:'bold'},
statL:{fontFamily:'monospace',fontSize:8,color:C.t3,marginLeft:2},
statusBar:{flexDirection:'row',alignItems:'center',backgroundColor:C.bg2,padding:10,paddingHorizontal:16,borderBottomWidth:1,borderBottomColor:C.b1},
statusDot:{width:8,height:8,borderRadius:4,marginRight:4},
statusTxt:{fontFamily:'monospace',fontSize:9,letterSpacing:1},
pg:{padding:16,paddingBottom:40},
statusCard:{borderWidth:2,borderRadius:12,padding:24,alignItems:'center',marginBottom:12,backgroundColor:C.bg2},
statusIcon:{fontSize:48,marginBottom:8},
statusMain:{fontFamily:'monospace',fontSize:16,fontWeight:'bold',letterSpacing:2,marginBottom:4,textAlign:'center'},
statusSub:{fontFamily:'monospace',fontSize:11,color:C.t3,textAlign:'center'},
manualBtn:{borderWidth:1,borderRadius:8,padding:12,alignItems:'center',marginBottom:12},
manualBtnTxt:{fontFamily:'monospace',fontSize:12,letterSpacing:1},
warning:{backgroundColor:'rgba(255,190,0,0.1)',borderWidth:1,borderColor:'#FFBE00',borderRadius:6,padding:10,marginBottom:12,alignItems:'center'},
warningTxt:{fontFamily:'monospace',fontSize:11,color:'#FFBE00'},
logCard:{backgroundColor:C.bg2,borderWidth:1,borderColor:C.b1,borderRadius:8,padding:12},
logHeader:{flexDirection:'row',justifyContent:'space-between',marginBottom:8},
lbl:{fontFamily:'monospace',fontSize:9,letterSpacing:2,color:C.t3,textTransform:'uppercase'},
logBox:{backgroundColor:C.bg0,padding:8,borderRadius:4,maxHeight:250},
logRow:{fontFamily:'monospace',fontSize:10,lineHeight:18},
empty:{fontFamily:'monospace',fontSize:11,color:C.t3,textAlign:'center',padding:12},
changeRole:{alignItems:'center',marginTop:16,padding:10},
});
