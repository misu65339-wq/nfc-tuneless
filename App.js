import{useState,useRef,useEffect,useCallback}from'react';
import{View,Text,TouchableOpacity,ScrollView,StyleSheet,StatusBar,Alert,NativeModules,NativeEventEmitter,Platform,AppState}from'react-native';
import{SafeAreaView}from'react-native-safe-area-context';
import NfcManager,{NfcTech}from'react-native-nfc-manager';

const C={bg0:'#03060A',bg1:'#080F18',bg2:'#0D1A2A',b1:'#1A2E45',b2:'#1F3A55',c1:'#00D4FF',c2:'#FF6600',c3:'#39FF14',c4:'#FF2D78',c5:'#A855F7',t1:'#E2EEF9',t2:'#7FA8CC',t3:'#3D6080'};
const SERVER_URL='wss://nfctuneless.serveousercontent.com';

function bH(b=[]){return Array.from(b).map(x=>(x&0xFF).toString(16).toUpperCase().padStart(2,'0')).join('')}
function hB(h=''){const c=h.replace(/\s/g,'');return Array.from({length:c.length/2},(_,i)=>parseInt(c.substring(i*2,i*2+2),16))}
function fT(ts){const d=new Date(ts);return`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`}

export default function App(){
const[mode,setMode]=useState(null); // null=selectie, 'A'=emulator, 'B'=reader
const ws=useRef(null);
const pending=useRef({});
const isoDepRef=useRef(null);
const readerRelay=useRef(false);
const urlRef=useRef(SERVER_URL);

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

// NFC Init
useEffect(()=>{
(async()=>{
try{
let ok=false;
try{ok=await NfcManager.isSupported();}catch(e){ok=true;}
setNfcOk(ok);
if(ok){
try{await NfcManager.start();}catch(e){}
}
}catch(e){}
})();
return()=>{NfcManager.cancelTechnologyRequest().catch(()=>{});};
},[]);

// HCE Native listener (Telefon A)
useEffect(()=>{
if(Platform.OS!=='android'||mode!=='A')return;
const{HceModule}=NativeModules;
if(!HceModule)return;
const emitter=new NativeEventEmitter(HceModule);
const sub=emitter.addListener('onApduCommand',(event)=>{
const{requestId,apdu}=event;
addLog(`POS→ ${apdu.slice(0,20)}`,C.c2);
setStats(p=>({...p,total:p.total+1}));
if(ws.current?.readyState===1){
const target=clients.find(c=>c.id!==myId);
if(target){
pending.current[requestId]={
resolve:(resp)=>{
HceModule.deliverResponse(requestId,resp);
addLog(`←POS ${resp.slice(0,20)}`,C.c3);
setStats(p=>({...p,ok:p.ok+1}));
},
reject:()=>{
HceModule.deliverResponse(requestId,'6F00');
setStats(p=>({...p,fail:p.fail+1}));
},
timer:setTimeout(()=>{
HceModule.deliverResponse(requestId,'6F00');
delete pending.current[requestId];
setStats(p=>({...p,fail:p.fail+1}));
addLog('TIMEOUT!',C.c4);
},4500)
};
ws.current.send(JSON.stringify({type:'APDU_RELAY_REQUEST',targetClientId:target.id,apdu,requestId}));
}else{
HceModule.deliverResponse(requestId,'6F00');
addLog('Niciun telefon B conectat!',C.c4);
}
}else{
HceModule.deliverResponse(requestId,'6F00');
addLog('Server deconectat!',C.c4);
}
});
HceModule.setActive(true);
HceModule.startForegroundService&&HceModule.startForegroundService();
return()=>{
sub.remove();
HceModule.setActive(false);
};
},[mode,clients,myId,addLog]);

// WebSocket connect
const connect=useCallback(()=>{
if(ws.current){ws.current.close();ws.current=null;return;}
setSt('connecting');
try{
const s=new WebSocket(SERVER_URL);
ws.current=s;
s.onopen=()=>{
setSt('connected');
const r=mode==='A'?'emulator':mode==='B'?'reader':'both';
s.send(JSON.stringify({type:'REGISTER',role:r,info:{device:`Samsung A22 ${mode||'?'}`}}));
s.send(JSON.stringify({type:'GET_CLIENTS'}));
addLog('Conectat la server',C.c3);
if(Platform.OS==='android'){
const{HceModule}=NativeModules;
HceModule?.startForegroundService&&HceModule.startForegroundService();
}
};
s.onclose=()=>{
setSt('disconnected');
ws.current=null;
addLog('Deconectat - reconectare...',C.c4);
setTimeout(()=>connect(),3000);
};
s.onerror=()=>{setSt('disconnected');ws.current=null;};
s.onmessage=(e)=>{
try{
const m=JSON.parse(e.data);
switch(m.type){
case 'CONNECTED':setMyId(m.clientId);break;
case 'SERVER_STATE':case 'CLIENTS_LIST':
setClients((m.clients||[]).filter(c=>c.id!==myId));
break;
case 'APDU_COMMAND':
// Telefon B primeste comanda si o trimite la card
if(mode==='B'&&readerRelay.current&&isoDepRef.current){
(async()=>{
try{
const resp=await NfcManager.isoDepHandler.transceive(hB(m.apdu||''));
const respHex=bH(resp);
ws.current?.send(JSON.stringify({type:'APDU_RELAY_RESPONSE',requestId:m.requestId,apdu:respHex}));
addLog(`Card→ ${respHex.slice(0,20)}`,C.c3);
}catch(e){
ws.current?.send(JSON.stringify({type:'APDU_RELAY_RESPONSE',requestId:m.requestId,apdu:'6F00'}));
addLog(`Card ERR: ${e.message}`,C.c4);
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
},[mode,myId,addLog]);

// Auto-reconnect AppState
useEffect(()=>{
const sub=AppState.addEventListener('change',(state)=>{
if(state==='active'&&(!ws.current||ws.current.readyState!==1)){
setTimeout(()=>connect(),1000);
}
});
return()=>sub.remove();
},[connect]);

// Ping keep-alive
useEffect(()=>{
const t=setInterval(()=>{
if(ws.current?.readyState===1)ws.current.send(JSON.stringify({type:'PING'}));
},10000);
return()=>clearInterval(t);
},[]);

// Connect card fizic (Telefon B)
const connectCard=useCallback(async()=>{
if(cardOk){
readerRelay.current=false;
isoDepRef.current=null;
NfcManager.cancelTechnologyRequest().catch(()=>{});
setCardOk(false);
addLog('Card deconectat',C.c2);
return;
}
try{
await NfcManager.requestTechnology([NfcTech.IsoDep]);
const tag=await NfcManager.getTag();
isoDepRef.current=tag;
readerRelay.current=true;
setCardOk(true);
addLog('Card conectat! Relay activ.',C.c3);
}catch(e){
readerRelay.current=false;
isoDepRef.current=null;
Alert.alert('Eroare',e.message);
}
},[cardOk,addLog]);

// Toggle HCE (Telefon A)
const toggleHce=useCallback(()=>{
const{HceModule}=NativeModules;
if(!HceModule){Alert.alert('Eroare','HCE Module indisponibil');return;}
if(hceActive){
HceModule.setActive(false);
setHceActive(false);
addLog('Emulator oprit',C.c2);
}else{
HceModule.setActive(true);
setHceActive(true);
addLog('Emulator pornit - apropie de POS',C.c3);
}
},[hceActive,addLog]);

const stC=st==='connected'?C.c3:st==='connecting'?'#FFBE00':C.c4;
const stT=st==='connected'?'CONECTAT':st==='connecting'?'CONECTARE...':'DECONECTAT';
const otherConnected=clients.length>0;

// Ecran selectie rol
if(!mode){
return(
<SafeAreaView style={s.root}>
<StatusBar barStyle="light-content" backgroundColor={C.bg1}/>
<View style={s.center}>
<Text style={s.title}>NFC TUNELESS</Text>
<Text style={s.subtitle}>Selectează rolul acestui telefon</Text>
<TouchableOpacity style={[s.roleCard,{borderColor:C.c1}]} onPress={()=>setMode('A')}>
<Text style={s.roleIcon}>📱</Text>
<Text style={[s.roleTitle,{color:C.c1}]}>TELEFON A</Text>
<Text style={s.roleDesc}>Lângă POS / ATM</Text>
<Text style={s.roleDesc2}>Emulează cardul</Text>
</TouchableOpacity>
<TouchableOpacity style={[s.roleCard,{borderColor:C.c3,marginTop:20}]} onPress={()=>setMode('B')}>
<Text style={s.roleIcon}>💳</Text>
<Text style={[s.roleTitle,{color:C.c3}]}>TELEFON B</Text>
<Text style={s.roleDesc}>Lângă cardul fizic</Text>
<Text style={s.roleDesc2}>Citește cardul real</Text>
</TouchableOpacity>
</View>
</SafeAreaView>
);
}

return(
<SafeAreaView style={s.root}>
<StatusBar barStyle="light-content" backgroundColor={C.bg1}/>

{/* Header */}
<View style={s.header}>
<View>
<Text style={s.title2}>TELEFON {mode}</Text>
<Text style={[s.stText,{color:stC}]}>{stT}</Text>
</View>
<View style={s.statsBox}>
<Text style={[s.statN,{color:C.c3}]}>{stats.ok}</Text>
<Text style={s.statL}>OK</Text>
<Text style={[s.statN,{color:C.c4,marginLeft:12}]}>{stats.fail}</Text>
<Text style={s.statL}>ERR</Text>
</View>
</View>

{/* Status Bar */}
<View style={s.statusBar}>
<View style={[s.statusDot,{backgroundColor:st==='connected'?C.c3:C.c4}]}/>
<Text style={[s.statusTxt,{color:st==='connected'?C.c3:C.c4}]}>SERVER</Text>
<View style={{width:1,height:16,backgroundColor:C.b1,marginHorizontal:12}}/>
<View style={[s.statusDot,{backgroundColor:nfcOk?C.c3:C.c4}]}/>
<Text style={[s.statusTxt,{color:nfcOk?C.c3:C.c4}]}>NFC</Text>
<View style={{width:1,height:16,backgroundColor:C.b1,marginHorizontal:12}}/>
<View style={[s.statusDot,{backgroundColor:otherConnected?C.c3:C.c4}]}/>
<Text style={[s.statusTxt,{color:otherConnected?C.c3:C.c4}]}>
{mode==='A'?'TEL B':'TEL A'} {otherConnected?'OK':'LIPSA'}
</Text>
</View>

<ScrollView contentContainerStyle={s.pg}>

{/* Buton principal */}
{mode==='A'?(
<View>
<TouchableOpacity
style={[s.mainBtn,{borderColor:hceActive?C.c4:C.c1,backgroundColor:hceActive?'rgba(255,45,120,0.1)':'rgba(0,212,255,0.08)'}]}
onPress={toggleHce}
disabled={st!=='connected'}>
<Text style={[s.mainBtnIcon]}>{hceActive?'⏹':'▶'}</Text>
<Text style={[s.mainBtnTxt,{color:hceActive?C.c4:C.c1}]}>
{hceActive?'OPREȘTE EMULATOR':'PORNEȘTE EMULATOR'}
</Text>
<Text style={s.mainBtnSub}>
{hceActive?'Emulator activ - apropie de POS':'Apasă apoi apropie de POS'}
</Text>
</TouchableOpacity>
{!otherConnected&&<View style={s.warning}><Text style={s.warningTxt}>⚠️ Telefonul B nu e conectat!</Text></View>}
</View>
):(
<View>
<TouchableOpacity
style={[s.mainBtn,{borderColor:cardOk?C.c4:C.c3,backgroundColor:cardOk?'rgba(255,45,120,0.1)':'rgba(57,255,20,0.08)'}]}
onPress={connectCard}
disabled={st!=='connected'}>
<Text style={s.mainBtnIcon}>{cardOk?'⏹':'💳'}</Text>
<Text style={[s.mainBtnTxt,{color:cardOk?C.c4:C.c3}]}>
{cardOk?'DECONECTEAZĂ CARDUL':'CONECTEAZĂ CARD FIZIC'}
</Text>
<Text style={s.mainBtnSub}>
{cardOk?'Card conectat - relay activ':'Apropie cardul de telefon după ce apeși'}
</Text>
</TouchableOpacity>
{!otherConnected&&<View style={s.warning}><Text style={s.warningTxt}>⚠️ Telefonul A nu e conectat!</Text></View>}
</View>
)}

{/* Connect/Disconnect server */}
<TouchableOpacity
style={[s.serverBtn,{borderColor:st==='connected'?C.c4:C.t3}]}
onPress={connect}>
<Text style={[s.serverBtnTxt,{color:st==='connected'?C.c4:C.t3}]}>
{st==='connected'?'DECONECTEAZĂ SERVER':'CONECTEAZĂ SERVER'}
</Text>
</TouchableOpacity>

{/* Log */}
<View style={s.logCard}>
<View style={s.logHeader}>
<Text style={s.lbl}>LOG TRANZACȚII</Text>
<TouchableOpacity onPress={()=>setLogs([])}>
<Text style={{fontFamily:'monospace',fontSize:10,color:C.c4}}>CLEAR</Text>
</TouchableOpacity>
</View>
<View style={s.logBox}>
{logs.length===0
?<Text style={s.empty}>Nicio activitate</Text>
:logs.slice(0,30).map((l,i)=>(
<Text key={i} style={[s.logRow,{color:l.color}]}>
{fT(l.ts)} {l.msg}
</Text>
))}
</View>
</View>

{/* Schimba rol */}
<TouchableOpacity style={s.changeRole} onPress={()=>{setMode(null);setSt('disconnected');if(ws.current){ws.current.close();ws.current=null;}}}>
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
mainBtn:{borderWidth:2,borderRadius:12,padding:24,alignItems:'center',marginBottom:12},
mainBtnIcon:{fontSize:40,marginBottom:8},
mainBtnTxt:{fontFamily:'monospace',fontSize:14,fontWeight:'bold',letterSpacing:2,marginBottom:4},
mainBtnSub:{fontFamily:'monospace',fontSize:10,color:C.t3,textAlign:'center'},
warning:{backgroundColor:'rgba(255,190,0,0.1)',borderWidth:1,borderColor:'#FFBE00',borderRadius:6,padding:10,marginBottom:12,alignItems:'center'},
warningTxt:{fontFamily:'monospace',fontSize:11,color:'#FFBE00'},
serverBtn:{borderWidth:1,borderRadius:6,padding:10,alignItems:'center',marginBottom:16},
serverBtnTxt:{fontFamily:'monospace',fontSize:11,letterSpacing:1},
logCard:{backgroundColor:C.bg2,borderWidth:1,borderColor:C.b1,borderRadius:8,padding:12},
logHeader:{flexDirection:'row',justifyContent:'space-between',marginBottom:8},
lbl:{fontFamily:'monospace',fontSize:9,letterSpacing:2,color:C.t3,textTransform:'uppercase'},
logBox:{backgroundColor:C.bg0,padding:8,borderRadius:4,maxHeight:250},
logRow:{fontFamily:'monospace',fontSize:10,lineHeight:18},
empty:{fontFamily:'monospace',fontSize:11,color:C.t3,textAlign:'center',padding:12},
changeRole:{alignItems:'center',marginTop:16,padding:10},
});
