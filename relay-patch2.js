const fs = require('fs');
let code = fs.readFileSync('App.js', 'utf8');

// Adauga buton "CONECTEAZA CARD" in tab HCE
const oldHceHeader = `<Text style={[s.lbl,{marginTop:12}]}>MOD RASPUNS</Text>`;
const newHceHeader = `<TouchableOpacity style={{borderWidth:1,borderColor:cardConnected.current?'#39FF14':'#FF6600',borderRadius:6,padding:12,alignItems:'center',marginBottom:10,backgroundColor:cardConnected.current?'rgba(57,255,20,0.08)':'rgba(255,102,0,0.08)'}} onPress={cardConnected.current?stopCardRelay:startCardRelay}>
<Text style={{fontFamily:'monospace',fontSize:12,color:cardConnected.current?'#39FF14':'#FF6600',letterSpacing:2}}>{cardConnected.current?'⏹ OPRESTE CARD RELAY':'▶ PORNESTE CARD RELAY'}</Text>
</TouchableOpacity>
<Text style={[s.lbl,{marginTop:12}]}>MOD RASPUNS</Text>`;

code = code.replace(oldHceHeader, newHceHeader);

// Adauga functiile startCardRelay si stopCardRelay
const oldSendApdu = `const sendApdu=useCallback(async()=>{`;
const newFunctions = `const startCardRelay=useCallback(async()=>{
if(!nfcOk||!nfcOn){Alert.alert('NFC','Activati NFC!');return;}
try{
await NfcManager.requestTechnology([NfcTech.IsoDep]);
cardConnected.current=true;
addEv({type:'HCE',src:'CARD',data:'Card fizic conectat - relay activ'});
setHLog(p=>[{cmd:'CARD CONECTAT',rsp:'RELAY ACTIV',ts:Date.now()},...p]);
}catch(e){
cardConnected.current=false;
Alert.alert('Eroare','Nu s-a putut conecta la card: '+e.message);
}
},[nfcOk,nfcOn,addEv]);

const stopCardRelay=useCallback(()=>{
cardConnected.current=false;
NfcManager.cancelTechnologyRequest().catch(()=>{});
addEv({type:'HCE',src:'CARD',data:'Card deconectat'});
},[addEv]);

const sendApdu=useCallback(async()=>{`;

code = code.replace(oldSendApdu, newFunctions);
fs.writeFileSync('App.js', code);
console.log('Done!');
