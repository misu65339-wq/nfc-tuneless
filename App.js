import { View, Text, StyleSheet } from 'react-native';
export default function App() {
  return (
    <View style={s.root}>
      <Text style={s.title}>NFC TUNELESS</Text>
      <Text style={s.sub}>WebSocket NFC Relay v2.0</Text>
    </View>
  );
}
const s = StyleSheet.create({
  root:  {flex:1,backgroundColor:'#03060A',alignItems:'center',justifyContent:'center'},
  title: {color:'#00D4FF',fontSize:28,fontWeight:'bold',letterSpacing:4},
  sub:   {color:'#3D6080',fontSize:14,marginTop:8,letterSpacing:2},
});
