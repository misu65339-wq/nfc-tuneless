import { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Switch, StatusBar, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';
const C={bg0:'#03060A',bg1:'#080F18',bg2:'#0D1A2A',b1:'#1A2E45',b2:'#1F3A55',c1:'#00D4FF',c2:'#FF6600',c3:'#39FF14',c4:'#FF2D78',c5:'#A855F7',t1:'#E2EEF9',t2:'#7FA8CC',t3:'#3D6080'};
const TABS=['CONECTARE','TAG READER','APDU','HCE'];
const PRESETS=[{n:'SELECT PPSE',v:'00A404000E325041592E5359532E444446303100'},{n:'SELECT VISA',v:'00A4040007A0000000031010'},{n:'SELECT MC',v:'00A4040007A0000000041010'},{n:'GET PROC OPT',v:'80A8000002830000'},{n:'READ REC 1',v:'00B2010C00'},{n:'GET CHALLENGE',v:'0084000008'}];
function bHex(b=[]){return Array.from(b).map(x=>(x&0xFF).toString(16).toUpperCase().padStart(2,'0')).join('')}
function hBytes(h=''){const c=h.replace(/\s/g,'');return Array.from({length:c.length/2},(_,i)=>parseInt(c.substring(i*2,i*2+2),16))}
function fT(ts){const d=new Date(ts);return`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`}
export default function App(){
const[tab,setTab]=useState(0);
const ws=useRef(null);const pending=useRef({});
const[nfcOk,setNfcOk]=useState(false);const[nfcOn,setNfcOn]=useState(false);const[scan,setScan]=useState(false);
const[url,setUrl]=useState('ws://192.168.1.100:8080');const[st,setSt]=useState('disconnected');const[myId,setMyId]=useState(null);
const[clients,setClients]=useState([]);const[events,setEvents]=useState([]);const[tags,setTags]=useState([]);const[role,setRole]=useState('both');
const[tCnt,setTCnt]=useState(0);const[aCnt,setACnt]=useState(0);
const[aTgt,setATgt]=useState('');const[aCmd,setACmd]=useState('');const[aRsp,setARsp]=useState('--');const[aLoad,setALoad]=useState(false);const[aSt,setASt]=useState('');
const[hOn,setHOn]=useState(false);const[hMode,setHMode]=useState(0);const[hCust,setHCust]=useState('9000');const[hLog,setHLog]=useState([]);const[hSt,setHSt]=useState({t:0,s:0,o:0});
useEffect(()=>{(async()=>{try{const ok=await NfcManager.isSupported();setNfcOk(ok);if(ok){await NfcManager.start();setNfcOn(await NfcManager.isEnabled())}}catch(e){}})();return()=>{NfcManager.cancelTechnologyRequest().catch(()=>{})};},[]);
const addEv=useCallback((ev)=>{setEvents(p=>[{...ev,ts:Date.now()},...p].slice(0,200));},[]);
const startScan=useCallback(async()=>{
if(!nfcOk){Alert.alert('NFC','NFC nesupport!');return;}
if(!nfcOn){Alert.alert('NFC','Activati NFC din Setari!');return;}
setScan(true);
try{
await NfcManager.requestTechnology([NfcTech.IsoDep,NfcTech.NfcA,NfcTech.NfcB,NfcTech.Ndef,NfcTech.MifareClassic,NfcTech.MifareUltralight]);
const tag=await NfcManager.getTag();
if(!tag)return;
const tagId=bHex(tag.id||[]);
const techs=tag.techTypes||[];
let tech=techs[0]?.split('.').pop()||'Unknown';
let apdu=null;
if(techs.includes('android.nfc.tech.IsoDep')){tech='IsoDep';try{const r=await NfcManager.isoDepHandler.transceive(hBytes('00A404000E325041592E5359532E444446303100'));apdu=bHex(r);}catch(e){}}
else if(techs.includes('android.nfc.tech.Ndef')){tech='NDEF';try{const m=await NfcManager.ndefHandler.getNdefMessage();if(m?.ndefMessage?.[0]?.payload)apdu=bHex(m.ndefMessage[0].payload);}catch(e){}}
else if(techs.includes('android.nfc.tech.MifareClassic'))tech='MIFARE Classic';
else if(techs.includes('android.nfc.tech.MifareUltralight'))tech='MIFARE UL';
else if(techs.includes('android.nfc.tech.NfcA'))tech='NFC-A';
else if(techs.includes('android.nfc.tech.NfcB'))tech='NFC-B';
const entry={id:tagId,tech,apdu,ts:Date.now()};
setTags(p=>[entry,...p].slice(0,100));setTCnt(n=>n+1);
addEv({type:'TAG',src:'LOCAL',data:`${tagId}|${tech}`});
ws.current?.send(JSON.stringify({type:'NFC_TAG_READ',tagId,tech,apduResponse:apdu}));
Alert.alert('Tag Citit!',`ID: ${tagId}\nTeh: ${tech}${apdu?'\nAPDU: '+apdu.slice(0,30):''}`)
}catch(e){if(e.message!=='cancelled')Alert.alert('Eroare NFC',e.message);}
finally{setScan(false);NfcManager.cancelTechnologyRequest().catch(()=>{});}
},[nfcOk,nfcOn,addEv]);
const cancelScan=useCallback(()=>{NfcManager.cancelTechnologyRequest().catch(()=>{});setScan(false);},[]);
const connect=useCallback(()=>{
if(ws.current){ws.current.close();ws.current=null;return;}
setSt('connecting');
try{const s=new WebSocket(url);ws.current=s;
s.onopen=()=>{setSt('connected');s.send(JSON.stringify({type:'REGISTER',role,info:{device:'NFC Tuneless'}}));s.send(JSON.stringify({type:'GET_CLIENTS'}));addEv({type:'SYS',src:'WS',data:'Conectat'});};
s.onclose=()=>{setSt('disconnected');ws.current=null;addEv({type:'SYS',src:'WS',data:'Deconectat'});};
s.onerror=()=>{setSt('disconnected');ws.current=null;};
s.onmessage=(e)=>{try{hMsg(JSON.parse(e.data));}catch{}};
}catch{setSt('disconnected');}
},[url,role,addEv]);
const hMsg=useCallback((m)=>{
switch(m.type){
case 'CONNECTED':setMyId(m.clientId);break;
case 'SERVER_STATE':case 'CLIENTS_LIST':setClients((m.clients||[]).filter(c=>c.id!==myId));break;
case 'NFC_TAG_READ':setTCnt(n=>n+1);setTags(p=>[{id:m.tagId,tech:m.tech,apdu:m.apduResponse,src:m.fromClient?.slice(0,8)||'?',ts:Date.now()},...p].slice(0,100));addEv({type:'TAG',src:m.fromClient?.slice(0,8)||'?',data:`${m.tagId}|${m.tech}`});break;
case 'APDU_COMMAND':if(hOn)pHce(m);break;
case 'APDU_RELAY_RESPONSE':{const p=pending.current[m.requestId];if(p){clearTimeout(p.timer);p.resolve(m.apdu);delete pending.current[m.requestId];}setACnt(n=>n+1);break;}
case 'APDU_RELAY_ERROR':{const p=pending.current[m.requestId];if(p){clearTimeout(p.timer);p.reject(new Error(m.error));delete pending.current[m.requestId];}break;}
}},[hOn,myId,addEv]);
const pHce=useCallback((m)=>{
setHSt(p=>({t:p.t+1,s:p.s+(m.apdu?.startsWith('00A40400')?1:0),o:p.o+(m.apdu?.startsWith('00A40400')?0:1)}));
let r='9000';
if(hMode===2)r=hCust.replace(/\s/g,'').toUpperCase()||'9000';
else if(m.apdu?.startsWith('00A40400'))r='6F0A84064E464354554C9000';
else if(m.apdu?.startsWith('80A800'))r='771682021800009000';
ws.current?.send(JSON.stringify({type:'APDU_RELAY_RESPONSE',requestId:m.requestId,apdu:r}));
setHLog(p=>[{cmd:m.apdu,rsp:r,ts:Date.now()},...p].slice(0,50));
addEv({type:'HCE',src:'LOCAL',data:`${m.apdu?.slice(0,16)}->${r}`});
},[hMode,hCust,addEv]);
const sendApdu=useCallback(async()=>{
if(!aTgt||!aCmd)return;
const cmd=aCmd.replace(/\s/g,'').toUpperCase();
setALoad(true);setARsp('...');setASt('Asteptare...');
const t0=Date.now();
try{const reqId=Math.random().toString(36).slice(2);
const resp=await new Promise((res,rej)=>{const timer=setTimeout(()=>{delete pending.current[reqId];rej(new Error('TIMEOUT'));},5000);pending.current[reqId]={resolve:res,reject:rej,timer};ws.current?.send(JSON.stringify({type:'APDU_RELAY_REQUEST',targetClientId:aTgt,apdu:cmd,requestId:reqId}));});
setARsp(resp);setASt(`OK ${Date.now()-t0}ms`);addEv({type:'APDU',src:'LOCAL',data:`->${cmd.slice(0,16)}`});
}catch(e){setARsp(`ERR:${e.message}`);setASt(`x ${e.message}`);}
finally{setALoad(false);}
},[aTgt,aCmd,addEv]);
const stC=st==='connected'?C.c3:st==='connecting'?'#FFBE00':C.t3;
const stT=st==='connected'?'CONECTAT':st==='connecting'?'CONECTARE...':'DECONECTAT';
return(<SafeAreaView style={s.root}><StatusBar barStyle="light-content" backgroundColor={C.bg1}/>
<View style={s.hdr}><View><Text style={s.hT}>NFC TUNELESS</Text><Text style={[s.hS,{color:stC}]}>{stT}</Text></View><View style={s.sR}><Text style={[s.sV,{color:C.c2}]}>{tCnt}</Text><Text style={s.sL}> TAGS  </Text><Text style={[s.sV,{color:C.c1}]}>{aCnt}</Text><Text style={s.sL}> APDU</Text></View></View>
<View style={s.tabs}>{TABS.map((t,i)=>(<TouchableOpacity key={t} style={[s.tab,tab===i&&s.tabA]} onPress={()=>setTab(i)}><Text style={[s.tabT,tab===i&&{color:C.c1}]}>{t}</Text></TouchableOpacity>))}</View>
{tab===0&&<ScrollView contentContainerStyle={s.pg}>
<View style={s.card}><Text style={s.lbl}>SERVER</Text><TextInput style={s.inp} value={url} onChangeText={setUrl} placeholder="ws://IP:8080" placeholderTextColor={C.t3} autoCapitalize="none"/><View style={s.rR}>{['both','reader','emulator'].map(r=>(<TouchableOpacity key={r} style={[s.rB,role===r&&s.rBA]} onPress={()=>setRole(r)}><Text style={[s.rT,role===r&&{color:C.c1}]}>{r.toUpperCase()}</Text></TouchableOpacity>))}</View><TouchableOpacity style={[s.btn,st==='connected'&&{borderColor:C.c4}]} onPress={connect}><Text style={[s.bT,st==='connected'&&{color:C.c4}]}>{st==='connected'?'DECONECTEAZA':st==='connecting'?'CONECTARE...':'CONECTEAZA'}</Text></TouchableOpacity></View>
<View style={s.card}><Text style={s.lbl}>NFC STATUS</Text><View style={{flexDirection:'row',alignItems:'center',gap:10,padding:10,backgroundColor:C.bg0,borderRadius:4}}><View style={{width:10,height:10,borderRadius:5,backgroundColor:nfcOk&&nfcOn?C.c3:C.c4}}/><Text style={{fontFamily:'monospace',fontSize:12,color:nfcOk&&nfcOn?C.c3:C.c4}}>{!nfcOk?'NFC NESUPPORT':!nfcOn?'NFC DEZACTIVAT':'NFC ACTIV'}</Text></View></View>
{clients.length>0&&<View style={s.card}><Text style={s.lbl}>DISPOZITIVE ({clients.length})</Text>{clients.map(c=>(<View key={c.id} style={{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:6,borderBottomWidth:1,borderBottomColor:C.b1}}><View style={{width:8,height:8,borderRadius:4,backgroundColor:c.role==='both'?C.c1:c.role==='emulator'?C.c3:C.c2}}/><View style={{flex:1}}><Text style={{fontFamily:'monospace',fontSize:10,color:C.c1}}>{c.id.slice(0,16)}...</Text><Text style={{fontFamily:'monospace',fontSize:9,color:C.t3}}>{c.role}</Text></View></View>))}</View>}
<View style={s.card}><Text style={s.lbl}>EVENIMENTE</Text><View style={s.lB}>{events.length===0?<Text style={s.emp}>Niciun eveniment</Text>:events.slice(0,40).map((e,i)=>(<Text key={i} style={[s.lR,e.type==='TAG'?{color:C.c2}:e.type==='APDU'?{color:C.c1}:e.type==='HCE'?{color:C.c5}:{color:C.t3}]}>{fT(e.ts)} [{e.type}] {e.data?.slice(0,50)}</Text>))}</View></View>
</ScrollView>}
{tab===1&&<ScrollView contentContainerStyle={s.pg}>
<View style={[s.card,{alignItems:'center',paddingVertical:30}]}><Text style={{fontSize:72,color:scan?C.c2:C.c1}}>{scan?'◉':'◎'}</Text><Text style={{fontFamily:'monospace',fontSize:11,color:scan?C.c2:C.t3,marginTop:10,letterSpacing:1}}>{scan?'SCANARE ACTIVA - APROPIATI CARDUL':'APASATI BUTONUL PENTRU SCANARE'}</Text></View>
<TouchableOpacity style={[s.btn,{marginBottom:12},scan&&{borderColor:C.c4}]} onPress={scan?cancelScan:startScan}><Text style={[s.bT,scan&&{color:C.c4}]}>{scan?'OPRESTE SCANAREA':'SCANEAZA TAG NFC'}</Text></TouchableOpacity>
<View style={s.card}><View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:8}}><Text style={s.lbl}>TAGURI ({tags.length})</Text><TouchableOpacity onPress={()=>setTags([])}><Text style={{fontFamily:'monospace',fontSize:10,color:C.c4}}>CLEAR</Text></TouchableOpacity></View>
{tags.length===0?<Text style={s.emp}>Niciun tag citit</Text>:tags.slice(0,30).map((t,i)=>(<View key={i} style={{borderWidth:1,borderColor:i===0?C.c2:C.b1,borderRadius:6,padding:10,marginBottom:8}}><Text style={{fontFamily:'monospace',fontSize:14,color:C.c2,fontWeight:'bold',marginBottom:6}}>◈ {t.id||'?'}</Text><View style={{flexDirection:'row',gap:8,marginBottom:4,flexWrap:'wrap'}}><View style={{borderWidth:1,borderColor:C.c1,borderRadius:10,paddingHorizontal:8,paddingVertical:2}}><Text style={{fontFamily:'monospace',fontSize:9,color:C.c1}}>{t.tech}</Text></View><Text style={{fontFamily:'monospace',fontSize:9,color:C.t3}}>{fT(t.ts)}</Text></View>{t.apdu&&<Text style={{fontFamily:'monospace',fontSize:9,color:C.t2,backgroundColor:C.bg0,padding:6,borderRadius:4}} numberOfLines={2}>{t.apdu}</Text>}</View>))}</View>
</ScrollView>}
{tab===2&&<ScrollView contentContainerStyle={s.pg}>
<View style={s.card}><Text style={s.lbl}>TARGET</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:10}}>{clients.length===0?<Text style={s.emp}>Conecteaza-te la server</Text>:clients.map(c=>(<TouchableOpacity key={c.id} style={[{borderWidth:1,borderColor:aTgt===c.id?C.c1:C.b2,borderRadius:6,padding:10,marginRight:8,minWidth:90,alignItems:'center',backgroundColor:C.bg0},aTgt===c.id&&{backgroundColor:'rgba(0,212,255,0.08)'}]} onPress={()=>setATgt(c.id)}><Text style={{fontFamily:'monospace',fontSize:9,color:aTgt===c.id?C.c1:C.t3,textAlign:'center',lineHeight:16}}>{c.id.slice(0,8)}{'\n'}{c.role}</Text></TouchableOpacity>))}</ScrollView>
<Text style={s.lbl}>COMANDA APDU</Text><TextInput style={[s.inp,{minHeight:70}]} value={aCmd} onChangeText={setACmd} placeholder="00 A4 04 00..." placeholderTextColor={C.t3} autoCapitalize="characters" multiline/>
<TouchableOpacity style={[s.btn,(!aTgt||aLoad)&&{opacity:0.4}]} onPress={sendApdu} disabled={!aTgt||aLoad}><Text style={s.bT}>{aLoad?'ASTEPTARE...':'TRIMITE APDU'}</Text></TouchableOpacity></View>
<View style={[s.card,{borderColor:aRsp.endsWith('9000')?C.c3:aRsp.startsWith('ERR')?C.c4:C.b1}]}><Text style={s.lbl}>RASPUNS</Text><Text style={{fontFamily:'monospace',fontSize:13,backgroundColor:C.bg0,padding:12,borderRadius:4,minHeight:50,lineHeight:22,color:aRsp.startsWith('ERR')?C.c4:C.c3}}>{aRsp}</Text>{!!aSt&&<Text style={{fontFamily:'monospace',fontSize:10,color:C.t3,marginTop:6}}>{aSt}</Text>}</View>
<View style={s.card}><Text style={s.lbl}>COMENZI RAPIDE</Text><View style={{flexDirection:'row',flexWrap:'wrap',gap:6}}>{PRESETS.map(p=>(<TouchableOpacity key={p.n} style={{borderWidth:1,borderColor:C.b2,borderRadius:4,padding:8,width:'48%'}} onPress={()=>setACmd(p.v)}><Text style={{fontFamily:'monospace',fontSize:9,color:C.t2,marginBottom:2}}>{p.n}</Text><Text style={{fontFamily:'monospace',fontSize:9,color:C.t3}} numberOfLines={1}>{p.v.slice(0,16)}...</Text></TouchableOpacity>))}</View></View>
</ScrollView>}
{tab===3&&<ScrollView contentContainerStyle={s.pg}>
<View style={s.card}><View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><View><Text style={{fontFamily:'monospace',fontSize:14,color:C.c1,fontWeight:'bold'}}>HCE EMULATOR</Text><Text style={{fontFamily:'monospace',fontSize:10,marginTop:2,color:hOn?C.c3:C.t3}}>{hOn?'ACTIV':'INACTIV'}</Text></View><Switch value={hOn} onValueChange={setHOn} trackColor={{false:C.b2,true:'rgba(57,255,20,0.3)'}} thumbColor={hOn?C.c3:C.t3}/></View>
<Text style={[s.lbl,{marginTop:12}]}>MOD RASPUNS</Text><View style={{flexDirection:'row',gap:6}}>{['Auto','Relay WS','Custom'].map((m,i)=>(<TouchableOpacity key={m} style={{flex:1,borderWidth:1,borderColor:hMode===i?C.c1:C.b2,borderRadius:4,padding:8,alignItems:'center',backgroundColor:hMode===i?'rgba(0,212,255,0.08)':'transparent'}} onPress={()=>setHMode(i)}><Text style={{fontFamily:'monospace',fontSize:9,color:hMode===i?C.c1:C.t3,textAlign:'center'}}>{m}</Text></TouchableOpacity>))}</View>
{hMode===2&&<TextInput style={[s.inp,{marginTop:10}]} value={hCust} onChangeText={setHCust} placeholder="9000" placeholderTextColor={C.t3} autoCapitalize="characters"/>}</View>
<View style={{flexDirection:'row',gap:8,marginBottom:12}}>{[{l:'TOTAL',v:hSt.t,c:C.c3},{l:'SELECT',v:hSt.s,c:C.c1},{l:'ALTE',v:hSt.o,c:C.c5}].map(it=>(<View key={it.l} style={{flex:1,backgroundColor:C.bg2,borderWidth:1,borderColor:C.b1,borderRadius:8,padding:10,alignItems:'center'}}><Text style={{fontFamily:'monospace',fontSize:24,fontWeight:'bold',color:it.c}}>{it.v}</Text><Text style={{fontFamily:'monospace',fontSize:8,color:C.t3}}>{it.l}</Text></View>))}</View>
<View style={s.card}><View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:8}}><Text style={s.lbl}>APDU LOG</Text><TouchableOpacity onPress={()=>{setHLog([]);setHSt({t:0,s:0,o:0});}}><Text style={{fontFamily:'monospace',fontSize:10,color:C.c4}}>CLEAR</Text></TouchableOpacity></View>
<View style={s.lB}>{hLog.length===0?<Text style={s.emp}>Emulator inactiv</Text>:hLog.slice(0,20).map((e,i)=>(<View key={i} style={{paddingVertical:4,borderBottomWidth:1,borderBottomColor:C.b1}}><Text style={{fontFamily:'monospace',fontSize:9,color:C.t3}}>{fT(e.ts)}</Text><Text style={{fontFamily:'monospace',fontSize:9,color:C.c5}} numberOfLines={1}>{e.cmd?.slice(0,32)}</Text><Text style={{fontFamily:'monospace',fontSize:9,color:C.c3}} numberOfLines={1}>{e.rsp?.slice(0,32)}</Text></View>))}</View></View>
</ScrollView>}
</SafeAreaView>);
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:C.bg0},hdr:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:C.bg1,padding:14,borderBottomWidth:1,borderBottomColor:C.b1},hT:{fontFamily:'monospace',fontSize:16,color:C.c1,letterSpacing:3,fontWeight:'bold'},hS:{fontFamily:'monospace',fontSize:10,marginTop:2},sR:{flexDirection:'row',alignItems:'center'},sV:{fontFamily:'monospace',fontSize:20,fontWeight:'bold'},sL:{fontFamily:'monospace',fontSize:8,color:C.t3},tabs:{flexDirection:'row',backgroundColor:C.bg1,borderBottomWidth:1,borderBottomColor:C.b1},tab:{flex:1,paddingVertical:12,alignItems:'center',borderBottomWidth:2,borderBottomColor:'transparent'},tabA:{borderBottomColor:'#00D4FF'},tabT:{fontFamily:'monospace',fontSize:8,color:C.t3,letterSpacing:1},pg:{padding:14,paddingBottom:40},card:{backgroundColor:C.bg2,borderWidth:1,borderColor:C.b1,borderRadius:8,padding:14,marginBottom:12},lbl:{fontFamily:'monospace',fontSize:9,letterSpacing:2,color:C.t3,textTransform:'uppercase',marginBottom:8},inp:{fontFamily:'monospace',fontSize:12,backgroundColor:C.bg0,borderWidth:1,borderColor:C.b2,color:C.t1,padding:10,borderRadius:4,marginBottom:10},rR:{flexDirection:'row',gap:6,marginBottom:10},rB:{flex:1,borderWidth:1,borderColor:C.b2,borderRadius:4,padding:8,alignItems:'center'},rBA:{borderColor:'#00D4FF',backgroundColor:'rgba(0,212,255,0.08)'},rT:{fontFamily:'monospace',fontSize:9,color:C.t3},btn:{borderWidth:1,borderColor:'#00D4FF',borderRadius:4,padding:12,alignItems:'center',backgroundColor:'rgba(0,212,255,0.06)'},bT:{fontFamily:'monospace',fontSize:12,color:'#00D4FF',letterSpacing:2},lB:{backgroundColor:C.bg0,padding:8,borderRadius:4,maxHeight:220},lR:{fontFamily:'monospace',fontSize:9,lineHeight:16},emp:{fontFamily:'monospace',fontSize:11,color:C.t3,textAlign:'center',padding:12}});
