import { useState, useEffect, useCallback } from 'react';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';

export function useNfc({ onTagRead }) {
  const [supported, setSupported] = useState(false);
  const [enabled,   setEnabled]   = useState(false);
  const [scanning,  setScanning]  = useState(false);

  useEffect(() => {
    (async () => {
      const ok = await NfcManager.isSupported();
      setSupported(ok);
      if (ok) {
        await NfcManager.start();
        const en = await NfcManager.isEnabled();
        setEnabled(en);
      }
    })();
    return () => { NfcManager.cancelTechnologyRequest().catch(()=>{}); };
  }, []);

  const readTag = useCallback(async () => {
    if (!supported || !enabled) return;
    setScanning(true);
    try {
      await NfcManager.requestTechnology([
        NfcTech.IsoDep,
        NfcTech.NfcA,
        NfcTech.NfcB,
        NfcTech.Ndef,
        NfcTech.MifareClassic,
        NfcTech.MifareUltralight,
      ]);
      const tag = await NfcManager.getTag();
      if (!tag) return;

      const tagId = (tag.id||[]).map(b=>(b&0xFF).toString(16).padStart(2,'0')).join('').toUpperCase();
      const techs = tag.techTypes || [];
      let tech = 'Unknown';
      let apduResp = null;

      if (techs.includes('android.nfc.tech.IsoDep')) {
        tech = 'IsoDep';
        try {
          const resp = await NfcManager.isoDepHandler.transceive(
            hexToBytes('00A404000E325041592E5359532E444446303100')
          );
          apduResp = bytesToHex(resp);
        } catch(e) { console.warn('IsoDep error:', e.message); }

      } else if (techs.includes('android.nfc.tech.NfcA')) {
        tech = 'NfcA';
      } else if (techs.includes('android.nfc.tech.NfcB')) {
        tech = 'NfcB';
      } else if (techs.includes('android.nfc.tech.Ndef')) {
        tech = 'Ndef';
        try {
          const msg = await NfcManager.ndefHandler.getNdefMessage();
          if (msg?.ndefMessage?.[0]?.payload) {
            apduResp = bytesToHex(msg.ndefMessage[0].payload);
          }
        } catch {}
      } else if (techs.includes('android.nfc.tech.MifareClassic')) {
        tech = 'MifareClassic';
      } else if (techs.includes('android.nfc.tech.MifareUltralight')) {
        tech = 'MifareUltralight';
      }

      onTagRead?.({ tagId, tech, apduResponse: apduResp });

    } catch(e) {
      if (e.message !== 'cancelled') console.warn('NFC error:', e.message);
    } finally {
      setScanning(false);
      NfcManager.cancelTechnologyRequest().catch(()=>{});
    }
  }, [supported, enabled, onTagRead]);

  const cancelRead = useCallback(() => {
    NfcManager.cancelTechnologyRequest().catch(()=>{});
    setScanning(false);
  }, []);

  return { supported, enabled, scanning, readTag, cancelRead };
}

function bytesToHex(bytes=[]) {
  return Array.from(bytes).map(b=>(b&0xFF).toString(16).toUpperCase().padStart(2,'0')).join('');
}
function hexToBytes(hex='') {
  const c = hex.replace(/\s/g,'');
  return Array.from({length:c.length/2},(_,i)=>parseInt(c.substring(i*2,i*2+2),16));
}
