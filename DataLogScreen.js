import React,{useState,useEffect} from 'react';
import {
  View,Text,TextInput,TouchableOpacity,ScrollView,
  StyleSheet,Alert,Share,NativeModules,StatusBar
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

const {DataLogModule}=NativeModules;

const C={
  bg:'#03060A',panel:'#0D1A2A',border:'#1A2E45',
  cyan:'#00D4FF',green:'#39FF14',red:'#FF2D78',
  text:'#E2EEF9',muted:'#7FA8CC'
};

export default function DataLogScreen({onClose}){
  const[configured,setConfigured]=useState(null);
  const[unlocked,setUnlocked]=useState(false);
  const[password,setPassword]=useState('');
  const[confirm,setConfirm]=useState('');
  const[error,setError]=useState('');
  const[rows,setRows]=useState([]);
  const[busy,setBusy]=useState(false);

  useEffect(()=>{
    DataLogModule.isConfigured()
      .then(setConfigured)
      .catch(e=>setError(String(e.message||e)));
    return()=>{DataLogModule.lockLog().catch(()=>{});};
  },[]);

  const refresh=async()=>{
    const text=await DataLogModule.listEvents();
    setRows(JSON.parse(text).reverse());
  };

  const submit=async()=>{
    if(busy)return;
    setBusy(true);
    setError('');
    try{
      if(!configured){
        if(password.length<8)throw Error('Parola trebuie să aibă minimum 8 caractere.');
        if(password!==confirm)throw Error('Parolele nu coincid.');
        await DataLogModule.setup(password);
        setConfigured(true);
      }else{
        const ok=await DataLogModule.unlock(password);
        if(!ok)throw Error('Parolă incorectă.');
      }
      setPassword('');
      setConfirm('');
      setUnlocked(true);
      await refresh();
    }catch(e){
      setError(String(e.message||e));
    }finally{
      setBusy(false);
    }
  };

  const format=row=>{
    const time=new Date(row.timestamp).toLocaleString('ro-RO');
    return `${time} | Sesiune ${row.session} | Telefon ${row.role} | ${row.event}`;
  };

  const exportData=async()=>{
    try{
      await Share.share({
        title:'NFC Tuneless DATA LOG',
        message:rows.slice().reverse().map(format).join('\n')||'DATA LOG gol'
      });
    }catch(e){Alert.alert('Export',String(e.message||e));}
  };

  const deleteAll=()=>{
    Alert.alert(
      'DELETE ALL DATA',
      'Ștergi definitiv toate înregistrările DATA LOG?',
      [
        {text:'ANULEAZĂ',style:'cancel'},
        {
          text:'ȘTERGE TOT',
          style:'destructive',
          onPress:async()=>{
            try{
              await DataLogModule.deleteAll();
              await refresh();
            }catch(e){Alert.alert('Eroare',String(e.message||e));}
          }
        }
      ]
    );
  };

  const Button=({label,onPress,danger=false})=>(
    <TouchableOpacity
      style={[s.button,{borderColor:danger?C.red:C.cyan}]}
      onPress={onPress}
    >
      <Text style={[s.buttonText,{color:danger?C.red:C.cyan}]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return(
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg}/>
      <View style={s.header}>
        <Text style={s.title}>▣ DATA LOG</Text>
        <TouchableOpacity onPress={onClose}>
          <Text style={s.back}>← ÎNAPOI</Text>
        </TouchableOpacity>
      </View>

      {configured===null?(
        <Text style={s.info}>Se încarcă...</Text>
      ):!unlocked?(
        <View style={s.auth}>
          <Text style={s.heading}>
            {configured?'INTRODU PAROLA':'CREEAZĂ PAROLA DATA LOG'}
          </Text>
          <Text style={s.info}>
            {configured
              ?'Introdu parola pentru a vedea istoricul.'
              :'Alege o parolă de minimum 8 caractere.'}
          </Text>

          <TextInput
            style={s.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Parolă"
            placeholderTextColor={C.muted}
            autoCapitalize="none"
          />

          {!configured&&(
            <TextInput
              style={s.input}
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              placeholder="Confirmă parola"
              placeholderTextColor={C.muted}
              autoCapitalize="none"
            />
          )}

          {!!error&&<Text style={s.error}>{error}</Text>}

          <Button
            label={busy?'AȘTEAPTĂ...':configured?'DEBLOCHEAZĂ':'SALVEAZĂ PAROLA'}
            onPress={submit}
          />
        </View>
      ):(
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.heading}>ISTORIC PERSISTENT</Text>
          <Text style={s.info}>{rows.length} evenimente salvate</Text>

          <Button label="ACTUALIZEAZĂ" onPress={()=>refresh().catch(
            e=>Alert.alert('Eroare',String(e.message||e))
          )}/>

          <Button label="EXPORT TEXT" onPress={exportData}/>

          <Button
            label="COPIAZĂ TOT"
            onPress={async()=>{
              try{
                await DataLogModule.copyText(
                  rows.slice().reverse().map(format).join('\n')
                );
                Alert.alert('DATA LOG','Istoricul a fost copiat.');
              }catch(e){Alert.alert('Eroare',String(e.message||e));}
            }}
          />

          <Button label="DELETE ALL DATA" onPress={deleteAll} danger/>

          <Text style={s.info}>
            Exportul și clipboardul nu sunt criptate.
          </Text>

          {rows.length===0?(
            <Text style={s.info}>Nicio înregistrare.</Text>
          ):rows.map((row,index)=>(
            <View style={s.row} key={index}>
              <Text style={s.rowText}>{format(row)}</Text>
              <TouchableOpacity
                onPress={()=>DataLogModule.copyText(format(row))
                  .then(()=>Alert.alert('DATA LOG','Înregistrare copiată.'))
                  .catch(e=>Alert.alert('Eroare',String(e.message||e)))}
              >
                <Text style={s.copy}>COPY</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:C.bg},
  header:{
    padding:16,backgroundColor:'#080F18',
    borderBottomWidth:1,borderBottomColor:C.border,
    flexDirection:'row',justifyContent:'space-between',alignItems:'center'
  },
  title:{
    color:C.cyan,fontFamily:'monospace',
    fontSize:17,fontWeight:'bold',letterSpacing:2
  },
  back:{color:C.cyan,fontFamily:'monospace',fontSize:12},
  auth:{padding:20},
  content:{padding:16,paddingBottom:40},
  heading:{
    color:C.text,fontFamily:'monospace',
    fontSize:13,fontWeight:'bold',marginBottom:12
  },
  info:{
    color:C.muted,fontFamily:'monospace',
    fontSize:11,marginBottom:16,lineHeight:18
  },
  input:{
    borderWidth:1,borderColor:C.border,borderRadius:8,
    backgroundColor:C.panel,color:C.text,
    padding:14,marginBottom:12
  },
  error:{color:C.red,marginBottom:12,fontFamily:'monospace'},
  button:{
    borderWidth:1,borderRadius:8,
    padding:13,alignItems:'center',marginBottom:12
  },
  buttonText:{
    fontFamily:'monospace',fontSize:12,
    fontWeight:'bold',letterSpacing:1
  },
  row:{
    backgroundColor:C.panel,borderWidth:1,
    borderColor:C.border,borderRadius:8,
    padding:12,marginBottom:8
  },
  rowText:{
    color:C.text,fontFamily:'monospace',
    fontSize:10,lineHeight:18
  },
  copy:{
    color:C.cyan,fontFamily:'monospace',
    fontSize:11,marginTop:10,textAlign:'right'
  }
});
