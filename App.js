import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, Switch, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const C = {
  bg0:'#03060A', bg1:'#080F18', bg2:'#0D1A2A',
  b1:'#1A2E45', b2:'#1F3A55',
  c1:'#00D4FF', c2:'#FF6600', c3:'#39FF14',
  c4:'#FF2D78', c5:'#A855F7',
  t1:'#E2EEF9', t2:'#7FA8CC', t3:'#3D6080',
};

const TABS = ['CONECTARE','TAG READER','APDU','HCE'];
const PRESETS = [
  {n:'SELECT PPSE', v:'00A404000E325041592E5359532E444446303100'},
  {n:'SELECT VISA', v:'00A4040007A0000000031010'},
  {n:'SELECT MC',   v:'00A4040007A0000000041010'},
  {n:'GET PROC OPT',v:'80A8000002830000'},
  {n:'READ REC 1',  v:'00B2010C00'},
  {n:'GET CHALLENGE',v:'0084000008'},
];

function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

export default function App() {
  const [tab, setTab] = useState(0);
  const ws = useRef(null);
  const pending = useRef({});

  // State
  const [wsUrl, setWsUrl] = useState('ws://192.168.1.100:8080');
  const [status, setStatus] = useState('disconnected');
  const [myId, setMyId] = useState(null);
  const [clients, setClients] = useState([]);
  const [events, setEvents] = useState([]);
  const [tags, setTags] = useState([]);
  const [apduTarget, setApduTarget] = useState('');
  const [apduCmd, setApduCmd] = useState('');
  const [apduResp, setApduResp] = useState('—');
  const [apduLoading, setApduLoading] = useState(false);
  const [apduStatus, setApduStatus] = useState('');
  const [hceEnabled, setHceEnabled] = useState(false);
  const [hceMode, setHceMode] = useState(0);
  const [hceCustom, setHceCustom] = useState('9000');
  const [hceLog, setHceLog] = useState([]);
  const [hceStats, setHceStats] = useState({t:0,s:0,o:0});
  const [role, setRole] = useState('both');
  const [tagCount, setTagCount] = useState(0);
  const [apduCount, setApduCount] = useState(0);

  const addEvent = useCallback((ev) => {
    setEvents(p => [{...ev, ts:Date.now()}, ...p].slice(0,200));
  }, []);

  const connect = useCallback(() => {
    if (ws.current) { ws.current.close(); return; }
    setStatus('connecting');
    try {
      const s = new WebSocket(wsUrl);
      ws.current = s;
      s.onopen = () => {
        setStatus('connected');
        s.send(JSON.stringify({type:'REGISTER', role, info:{device:'Android RN'}}));
        s.send(JSON.stringify({type:'GET_CLIENTS'}));
      };
      s.onclose = () => { setStatus('disconnected'); ws.current=null; };
      s.onerror = () => { setStatus('disconnected'); ws.current=null; };
      s.onmessage = (e) => {
        try { handleMsg(JSON.parse(e.data)); } catch {}
      };
    } catch { setStatus('disconnected'); }
  }, [wsUrl, role]);

  const handleMsg = useCallback((m) => {
    switch(m.type) {
      case 'CONNECTED':
        setMyId(m.clientId);
        addEvent({type:'SYSTEM', src:'SRV', data:`Conectat: ${m.clientId.slice(0,8)}`});
        break;
      case 'SERVER_STATE': case 'CLIENTS_LIST':
        setClients((m.clients||[]).filter(c=>c.id!==myId));
        break;
      case 'NFC_TAG_READ':
        setTagCount(n=>n+1);
        setTags(p=>[{id:m.tagId,tech:m.tech,apdu:m.apduResponse,src:m.fromClient?.slice(0,8)||'?',ts:Date.now()},...p].slice(0,100));
        addEvent({type:'TAG', src:m.fromClient?.slice(0,8)||'?', data:`${m.tagId} | ${m.tech}`});
        break;
      case 'APDU_COMMAND':
        if(hceEnabled) processHce(m);
        addEvent({type:'HCE', src:m.fromClientId?.slice(0,8)||'SRV', data:`CMD: ${m.apdu}`});
        break;
      case 'APDU_RELAY_RESPONSE': {
        const p = pending.current[m.requestId];
        if(p) { clearTimeout(p.timer); p.resolve(m.apdu); delete pending.current[m.requestId]; }
        setApduCount(n=>n+1);
        addEvent({type:'APDU', src:m.fromClientId?.slice(0,8)||'?', data:`RSP: ${m.apdu}`});
        break;
      }
      case 'APDU_RELAY_ERROR': {
        const p = pending.current[m.requestId];
        if(p) { clearTimeout(p.timer); p.reject(new Error(m.error)); delete pending.current[m.requestId]; }
        break;
      }
    }
  }, [hceEnabled, myId, addEvent]);

  const processHce = useCallback((m) => {
    setHceStats(p=>({t:p.t+1, s:p.s+(m.apdu?.startsWith('00A40400')?1:0), o:p.o+(m.apdu?.startsWith('00A40400')?0:1)}));
    const modes = ['auto','relay','custom'];
    let rsp = '9000';
    if(modes[hceMode]==='custom') rsp = hceCustom.replace(/\s/g,'').toUpperCase()||'9000';
    else if(m.apdu?.startsWith('00A40400')) rsp = '6F0A84064E464354554C9000';
    else if(m.apdu?.startsWith('80A800')) rsp = '771682021800009000';
    else rsp = '9000';
    ws.current?.send(JSON.stringify({type:'APDU_RELAY_RESPONSE', requestId:m.requestId, apdu:rsp}));
    setHceLog(p=>[{cmd:m.apdu,rsp,ts:Date.now()},...p].slice(0,50));
  }, [hceMode, hceCustom]);

  const sendApdu = useCallback(async () => {
    if(!apduTarget||!apduCmd) return;
    const cmd = apduCmd.replace(/\s/g,'').toUpperCase();
    setApduLoading(true);
    setApduResp('⏳');
    setApduStatus('Așteptare...');
    const t0 = Date.now();
    try {
      const reqId = Math.random().toString(36).slice(2);
      const resp = await new Promise((resolve,reject)=>{
        const timer = setTimeout(()=>{ delete pending.current[reqId]; reject(new Error('TIMEOUT')); },5000);
        pending.current[reqId] = {resolve,reject,timer};
        ws.current?.send(JSON.stringify({type:'APDU_RELAY_REQUEST',targetClientId:apduTarget,apdu:cmd,requestId:reqId}));
      });
      setApduResp(resp);
      setApduStatus(`✓ ${Date.now()-t0}ms`);
    } catch(e) {
      setApduResp(`ERR: ${e.message}`);
      setApduStatus(`✗ ${e.message}`);
    } finally { setApduLoading(false); }
  }, [apduTarget, apduCmd]);

  const stColor = status==='connected'?C.c3:status==='connecting'?'#FFBE00':C.t3;
  const stText  = status==='connected'?'● CONECTAT':status==='connecting'?'◌ CONECTARE...':'○ DECONECTAT';

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg1}/>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>NFC TUNELESS</Text>
          <Text style={[s.headerSub,{color:stColor}]}>{stText}</Text>
        </View>
        <View style={s.statsRow}>
          <Text style={[s.statV,{color:C.c2}]}>{tagCount}</Text>
          <Text style={s.statL}>TAGS</Text>
          <Text style={[s.statV,{color:C.c1,marginLeft:12}]}>{apduCount}</Text>
          <Text style={s.statL}>APDU</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={s.tabs}>
        {TABS.map((t,i)=>(
          <TouchableOpacity key={t} style={[s.tab,tab===i&&s.tabActive]} onPress={()=>setTab(i)}>
            <Text style={[s.tabTxt,tab===i&&{color:C.c1}]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tab 0: Connect */}
      {tab===0 && (
        <ScrollView contentContainerStyle={s.page}>
          <View style={s.card}>
            <Text style={s.label}>SERVER WEBSOCKET</Text>
            <TextInput style={s.input} value={wsUrl} onChangeText={setWsUrl}
              placeholder="ws://192.168.1.100:8080" placeholderTextColor={C.t3}
              autoCapitalize="none" autoCorrect={false}/>
            <View style={s.roleRow}>
              {['both','reader','emulator'].map(r=>(
                <TouchableOpacity key={r} style={[s.roleBtn,role===r&&s.roleBtnA]} onPress={()=>setRole(r)}>
                  <Text style={[s.roleTxt,role===r&&{color:C.c1}]}>{r.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={[s.btn,status==='connected'&&{borderColor:C.c4}]} onPress={connect}>
              <Text style={[s.btnTxt,status==='connected'&&{color:C.c4}]}>
                {status==='connected'?'DECONECTEAZĂ':status==='connecting'?'CONECTARE...':'CONECTEAZĂ'}
              </Text>
            </TouchableOpacity>
          </View>

          {clients.length>0&&(
            <View style={s.card}>
              <Text style={s.label}>DISPOZITIVE ({clients.length})</Text>
              {clients.map(c=>(
                <View key={c.id} style={s.clientRow}>
                  <View style={[s.dot,{backgroundColor:c.role==='both'?C.c1:c.role==='emulator'?C.c3:C.c2}]}/>
                  <View style={{flex:1}}>
                    <Text style={s.clientId}>{c.id.slice(0,16)}…</Text>
                    <Text style={s.clientMeta}>{c.role} · {c.info?.device||'?'}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          <View style={s.card}>
            <Text style={s.label}>EVENIMENTE</Text>
            <View style={s.logBox}>
              {events.length===0?<Text style={s.empty}>Niciun eveniment</Text>:
                events.slice(0,40).map((e,i)=>(
                  <Text key={i} style={[s.logRow,
                    e.type==='TAG'?{color:C.c2}:e.type==='APDU'?{color:C.c1}:
                    e.type==='HCE'?{color:C.c5}:{color:C.t3}]}>
                    {fmtTime(e.ts)} [{e.type}] {e.src} · {e.data?.slice(0,40)}
                  </Text>
                ))
              }
            </View>
          </View>
        </ScrollView>
      )}

      {/* Tab 1: Tag Reader */}
      {tab===1 && (
        <ScrollView contentContainerStyle={s.page}>
          <View style={[s.card,{alignItems:'center',paddingVertical:30}]}>
            <Text style={s.radar}>◎</Text>
            <Text style={[s.label,{marginTop:12}]}>CITIRE NFC AUTOMATĂ</Text>
            <Text style={s.radarSub}>Apropiați un tag NFC de telefon</Text>
          </View>
          <View style={s.card}>
            <Text style={s.label}>TAGURI CITITE ({tags.length})</Text>
            {tags.length===0?<Text style={s.empty}>Niciun tag citit</Text>:
              tags.slice(0,20).map((t,i)=>(
                <View key={i} style={[s.tagRow,i===0&&{borderColor:C.c2}]}>
                  <Text style={s.tagId}>◈ {t.id}</Text>
                  <View style={s.tagMeta}>
                    <View style={s.techBadge}><Text style={s.techTxt}>{t.tech?.split('/')[0]}</Text></View>
                    <Text style={s.tagTime}>{fmtTime(t.ts)}</Text>
                  </View>
                  {t.apdu&&<Text style={s.tagApdu} numberOfLines={2}>{t.apdu}</Text>}
                </View>
              ))
            }
          </View>
        </ScrollView>
      )}

      {/* Tab 2: APDU */}
      {tab===2 && (
        <ScrollView contentContainerStyle={s.page}>
          <View style={s.card}>
            <Text style={s.label}>TARGET</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:10}}>
              {clients.length===0?<Text style={s.empty}>Niciun dispozitiv</Text>:
                clients.map((c,i)=>(
                  <TouchableOpacity key={c.id}
                    style={[s.chip,apduTarget===c.id&&s.chipActive]}
                    onPress={()=>setApduTarget(c.id)}>
                    <Text style={[s.chipTxt,apduTarget===c.id&&{color:C.c1}]}>
                      {c.id.slice(0,8)}{'\n'}{c.role}
                    </Text>
                  </TouchableOpacity>
                ))
              }
            </ScrollView>
            <Text style={s.label}>COMANDĂ APDU</Text>
            <TextInput style={[s.input,{minHeight:70}]} value={apduCmd} onChangeText={setApduCmd}
              placeholder="00 A4 04 00..." placeholderTextColor={C.t3}
              autoCapitalize="characters" multiline/>
            <TouchableOpacity style={[s.btn,(!apduTarget||apduLoading)&&{opacity:0.4}]}
              onPress={sendApdu} disabled={!apduTarget||apduLoading}>
              <Text style={s.btnTxt}>{apduLoading?'⏳ AȘTEPTARE...':'▶ TRIMITE APDU'}</Text>
            </TouchableOpacity>
          </View>
          <View style={[s.card,{borderColor:apduResp.endsWith('9000')?C.c3:apduResp.startsWith('ERR')?C.c4:C.b1}]}>
            <Text style={s.label}>RĂSPUNS APDU</Text>
            <Text style={[s.respBox,{color:apduResp.startsWith('ERR')?C.c4:C.c3}]}>{apduResp}</Text>
            {!!apduStatus&&<Text style={s.apduStatus}>{apduStatus}</Text>}
          </View>
          <View style={s.card}>
            <Text style={s.label}>COMENZI RAPIDE</Text>
            <View style={s.presetGrid}>
              {PRESETS.map(p=>(
                <TouchableOpacity key={p.n} style={s.preset} onPress={()=>setApduCmd(p.v)}>
                  <Text style={s.presetN}>{p.n}</Text>
                  <Text style={s.presetV} numberOfLines={1}>{p.v.slice(0,16)}…</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>
      )}

      {/* Tab 3: HCE */}
      {tab===3 && (
        <ScrollView contentContainerStyle={s.page}>
          <View style={s.card}>
            <View style={s.hceHeader}>
              <View>
                <Text style={s.hceTitle}>HCE EMULATOR</Text>
                <Text style={[s.hceSub,{color:hceEnabled?C.c3:C.t3}]}>
                  {hceEnabled?'● ACTIV':'○ INACTIV'}
                </Text>
              </View>
              <Switch value={hceEnabled} onValueChange={setHceEnabled}
                trackColor={{false:C.b2,true:'rgba(57,255,20,0.3)'}}
                thumbColor={hceEnabled?C.c3:C.t3}/>
            </View>
          </View>
          <View style={s.card}>
            <Text style={s.label}>MOD RĂSPUNS</Text>
            <View style={s.modeRow}>
              {['Auto','Relay WS','Custom'].map((m,i)=>(
                <TouchableOpacity key={m} style={[s.modeBtn,hceMode===i&&s.modeBtnA]} onPress={()=>setHceMode(i)}>
                  <Text style={[s.modeTxt,hceMode===i&&{color:C.c1}]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {hceMode===2&&(
              <TextInput style={[s.input,{marginTop:10}]} value={hceCustom}
                onChangeText={setHceCustom} placeholder="9000" placeholderTextColor={C.t3}
                autoCapitalize="characters"/>
            )}
          </View>
          <View style={s.statsCards}>
            {[{l:'TOTAL',v:hceStats.t,c:C.c3},{l:'SELECT',v:hceStats.s,c:C.c1},{l:'ALTE',v:hceStats.o,c:C.c5}].map(it=>(
              <View key={it.l} style={s.statCard}>
                <Text style={[s.statBig,{color:it.c}]}>{it.v}</Text>
                <Text style={s.statL}>{it.l}</Text>
              </View>
            ))}
          </View>
          <View style={s.card}>
            <Text style={s.label}>APDU LOG</Text>
            <View style={s.logBox}>
              {hceLog.length===0?<Text style={s.empty}>Niciun APDU primit</Text>:
                hceLog.slice(0,20).map((e,i)=>(
                  <View key={i} style={s.hceEntry}>
                    <Text style={[s.logRow,{color:C.c5}]}>→ {e.cmd?.slice(0,30)}</Text>
                    <Text style={[s.logRow,{color:C.c3}]}>← {e.rsp?.slice(0,30)}</Text>
                  </View>
                ))
              }
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:       {flex:1,backgroundColor:C.bg0},
  header:     {flexDirection:'row',alignItems:'center',justifyContent:'space-between',
               backgroundColor:C.bg1,padding:14,borderBottomWidth:1,borderBottomColor:C.b1},
  headerTitle:{fontFamily:'monospace',fontSize:16,color:C.c1,letterSpacing:3,fontWeight:'bold'},
  headerSub:  {fontFamily:'monospace',fontSize:10,marginTop:2},
  statsRow:   {flexDirection:'row',alignItems:'center'},
  statV:      {fontFamily:'monospace',fontSize:20,fontWeight:'bold'},
  statL:      {fontFamily:'monospace',fontSize:8,color:C.t3,letterSpacing:1,marginLeft:2},
  tabs:       {flexDirection:'row',backgroundColor:C.bg1,borderBottomWidth:1,borderBottomColor:C.b1},
  tab:        {flex:1,paddingVertical:12,alignItems:'center',borderBottomWidth:2,borderBottomColor:'transparent'},
  tabActive:  {borderBottomColor:C.c1},
  tabTxt:     {fontFamily:'monospace',fontSize:8,color:C.t3,letterSpacing:1},
  page:       {padding:14,paddingBottom:40},
  card:       {backgroundColor:C.bg2,borderWidth:1,borderColor:C.b1,borderRadius:8,padding:14,marginBottom:12},
  label:      {fontFamily:'monospace',fontSize:9,letterSpacing:2,color:C.t3,textTransform:'uppercase',marginBottom:8},
  input:      {fontFamily:'monospace',fontSize:12,backgroundColor:C.bg0,borderWidth:1,borderColor:C.b2,
               color:C.t1,padding:10,borderRadius:4,marginBottom:10},
  roleRow:    {flexDirection:'row',gap:6,marginBottom:10},
  roleBtn:    {flex:1,borderWidth:1,borderColor:C.b2,borderRadius:4,padding:8,alignItems:'center'},
  roleBtnA:   {borderColor:C.c1,backgroundColor:'rgba(0,212,255,0.08)'},
  roleTxt:    {fontFamily:'monospace',fontSize:9,color:C.t3},
  btn:        {borderWidth:1,borderColor:C.c1,borderRadius:4,padding:12,alignItems:'center',
               backgroundColor:'rgba(0,212,255,0.06)'},
  btnTxt:     {fontFamily:'monospace',fontSize:12,color:C.c1,letterSpacing:2},
  clientRow:  {flexDirection:'row',alignItems:'center',gap:10,paddingVertical:6,
               borderBottomWidth:1,borderBottomColor:C.b1},
  dot:        {width:8,height:8,borderRadius:4},
  clientId:   {fontFamily:'monospace',fontSize:10,color:C.c1},
  clientMeta: {fontFamily:'monospace',fontSize:9,color:C.t3,marginTop:2},
  logBox:     {backgroundColor:C.bg0,padding:8,borderRadius:4,maxHeight:200},
  logRow:     {fontFamily:'monospace',fontSize:9,lineHeight:16},
  empty:      {fontFamily:'monospace',fontSize:11,color:C.t3,textAlign:'center',padding:12},
  radar:      {fontSize:72,color:C.c1,textShadowColor:'rgba(0,212,255,0.5)',textShadowRadius:20},
  radarSub:   {fontFamily:'monospace',fontSize:11,color:C.t3,marginTop:6,letterSpacing:2},
  tagRow:     {borderWidth:1,borderColor:C.b1,borderRadius:6,padding:10,marginBottom:8},
  tagId:      {fontFamily:'monospace',fontSize:14,color:C.c2,fontWeight:'bold',marginBottom:6},
  tagMeta:    {flexDirection:'row',alignItems:'center',gap:8,marginBottom:4},
  techBadge:  {borderWidth:1,borderColor:C.c1,borderRadius:10,paddingHorizontal:8,paddingVertical:2},
  techTxt:    {fontFamily:'monospace',fontSize:9,color:C.c1},
  tagTime:    {fontFamily:'monospace',fontSize:9,color:C.t3},
  tagApdu:    {fontFamily:'monospace',fontSize:9,color:C.t2,backgroundColor:C.bg0,padding:6,borderRadius:4},
  chip:       {borderWidth:1,borderColor:C.b2,borderRadius:6,padding:10,marginRight:8,
               minWidth:90,alignItems:'center',backgroundColor:C.bg0},
  chipActive: {borderColor:C.c1,backgroundColor:'rgba(0,212,255,0.08)'},
  chipTxt:    {fontFamily:'monospace',fontSize:9,color:C.t3,textAlign:'center',lineHeight:16},
  respBox:    {fontFamily:'monospace',fontSize:13,backgroundColor:C.bg0,
               padding:12,borderRadius:4,minHeight:50,lineHeight:22},
  apduStatus: {fontFamily:'monospace',fontSize:10,color:C.t3,marginTop:6},
  presetGrid: {flexDirection:'row',flexWrap:'wrap',gap:6},
  preset:     {borderWidth:1,borderColor:C.b2,borderRadius:4,padding:8,width:'48%'},
  presetN:    {fontFamily:'monospace',fontSize:9,color:C.t2,marginBottom:2},
  presetV:    {fontFamily:'monospace',fontSize:9,color:C.t3},
  hceHeader:  {flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  hceTitle:   {fontFamily:'monospace',fontSize:14,color:C.c1,fontWeight:'bold'},
  hceSub:     {fontFamily:'monospace',fontSize:10,marginTop:2},
  modeRow:    {flexDirection:'row',gap:6},
  modeBtn:    {flex:1,borderWidth:1,borderColor:C.b2,borderRadius:4,padding:8,alignItems:'center'},
  modeBtnA:   {borderColor:C.c1,backgroundColor:'rgba(0,212,255,0.08)'},
  modeTxt:    {fontFamily:'monospace',fontSize:9,color:C.t3,textAlign:'center'},
  statsCards: {flexDirection:'row',gap:8,marginBottom:12},
  statCard:   {flex:1,backgroundColor:C.bg2,borderWidth:1,borderColor:C.b1,
               borderRadius:8,padding:10,alignItems:'center'},
  statBig:    {fontFamily:'monospace',fontSize:26,fontWeight:'bold'},
  hceEntry:   {paddingVertical:4,borderBottomWidth:1,borderBottomColor:C.b1},
});

// NFC hook integration - append to imports at top of file
