import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate
} from "react-native-webrtc";

export default class WebRTCClient {
  constructor(sendSignal, onMessage, onStatus = () => {}) {
    this.sendSignal = sendSignal;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.channel = null;
    this.sessionId = null;
    this.pendingIce = [];
    this.remoteDescriptionUpdating = false;
    this.isOfferer = false;
    this.iceRecoveryTimer = null;
    this.iceRecoveryBusy = false;

    this.pc = new RTCPeerConnection({
      iceServers: [
        // STUN ajută telefoanele să încerce conexiune directă rapidă.
        { urls: "stun:stun.l.google.com:19302" },

        // TURN UDP prin VPS-ul nostru; acesta rezolvă conexiunile 4G/5G cu NAT strict.
        {
          urls: "turn:185.144.71.193:3478?transport=udp",
          username: "nfctuneless",
          credential: "Panamera2021!"
        },

        // TURN TCP ca rezervă dacă UDP este blocat de rețea.
        {
          urls: "turn:185.144.71.193:3478?transport=tcp",
          username: "nfctuneless",
          credential: "Panamera2021!"
        }
      ]
    });

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;
      console.log('[WebRTC] ICE:', state);
      this.onStatus('ICE_' + state.toUpperCase());
      if (state === 'connected' || state === 'completed') {
        clearTimeout(this.iceRecoveryTimer);
        this.iceRecoveryTimer = null;
      } else if (this.isOfferer && (state === 'disconnected' || state === 'failed')) {
        clearTimeout(this.iceRecoveryTimer);
        this.iceRecoveryTimer = setTimeout(async () => {
          this.iceRecoveryTimer = null;
          if (this.iceRecoveryBusy) return;
          if (!['disconnected','failed'].includes(this.pc.iceConnectionState)) return;
          await this.restartIce();
        }, state === 'failed' ? 0 : 5000);
      }
    };
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      console.log('[WebRTC] CONNECTION:', state);
      this.onStatus('CONNECTION_' + state.toUpperCase());
    };
    this.pc.onsignalingstatechange = () => {};

    this.pc.onicecandidate = event => {
      if (event.candidate) {
        this.sendSignal({
          type: "ice",
          candidate: event.candidate,
          sessionId: this.sessionId
        });
      }
    };

    this.pc.ondatachannel = event => {
      this.channel = event.channel;
      this.onStatus("WEBRTC_CHANNEL_RECEIVED");
      this.setupChannel();
    };
  }

  setupChannel() {
    this.channel.onopen = () => {
      console.log("DataChannel OPEN");
      this.onStatus("WEBRTC_OPEN");
    };

    this.channel.onmessage = event => {
      this.onMessage(event.data);
    };

    this.channel.onclose = () => {
      console.log("DataChannel CLOSED");
      this.onStatus("WEBRTC_CLOSED");
    };
  }

  async createOffer() {
    this.isOfferer = true;
    this.sessionId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    this.channel = this.pc.createDataChannel("data",{ordered:false,maxRetransmits:0});
    this.setupChannel();

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    this.onStatus("TRIMIT OFFER");
    this.sendSignal({
      type: "offer",
      offer,
      sessionId: this.sessionId
    });
  }

  createFreshConnection() {
    const fresh = new WebRTCClient(
      this.sendSignal,
      this.onMessage,
      this.onStatus
    );
    fresh.pendingIce = this.pendingIce.filter(
      item => item.sessionId
    );
    this.pendingIce = [];
    this.close();
    return fresh;
  }

  close() {
    clearTimeout(this.fullResetTimer);
    this.fullResetTimer = null;
    clearTimeout(this.iceRecoveryTimer);
    this.iceRecoveryTimer = null;
    this.isOfferer = false;
    this.pc.oniceconnectionstatechange = null;
    this.pc.onconnectionstatechange = null;
    this.pc.onicecandidate = null;
    this.pc.ondatachannel = null;
    if (this.channel) {
      this.channel.onopen = null;
      this.channel.onmessage = null;
      this.channel.onclose = null;
    }
    try { this.channel?.close(); } catch (e) {}
    try { this.pc.close(); } catch (e) {}
    this.channel = null;
  }

  async createFullResetOffer() {
    this.isOfferer = true;
    this.sessionId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    this.channel = this.pc.createDataChannel("data", {
      ordered: false,
      maxRetransmits: 0
    });
    this.setupChannel();
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    if(this.pc.signalingState==='closed') return;
    this.sendSignal({type:'offer',offer,fullReset:true,sessionId:this.sessionId});
  }

  async restartIce() {
    if (!this.isOfferer || this.iceRecoveryBusy ||
        this.pc.signalingState !== 'stable') return false;
    this.iceRecoveryBusy = true;
    try {
      const offer = await this.pc.createOffer({iceRestart:true});
      await this.pc.setLocalDescription(offer);
      if(this.pc.signalingState==='closed') return false;
      this.sendSignal({type:'offer',offer,sessionId:this.sessionId});
      return true;
    } catch (e) {
      console.log('[WebRTC] ICE restart error:',e);
      return false;
    } finally {
      this.iceRecoveryBusy = false;
    }
  }

  async handleOffer(offer, sessionId) {
    if (sessionId) this.sessionId = sessionId;
    if (this.pc.signalingState === 'closed') return;
    this.onStatus("PRIMIT OFFER");
    this.remoteDescriptionUpdating = true;
    try {
      await this.pc.setRemoteDescription(
        new RTCSessionDescription(offer)
      );
    } finally {
      this.remoteDescriptionUpdating = false;
    }
    if (this.pc.signalingState === 'closed') return;
    const pending = this.pendingIce;
    this.pendingIce = [];
    for (const item of pending) {
      if (item.sessionId === this.sessionId)
        await this.handleIce(item.candidate);
    }

    if (this.pc.signalingState === 'closed') return;
    const answer = await this.pc.createAnswer();
    if (this.pc.signalingState === 'closed') return;
    await this.pc.setLocalDescription(answer);
    if (this.pc.signalingState === 'closed') return;

    this.onStatus("TRIMIT ANSWER");
    this.sendSignal({
      type: "answer",
      answer,
      sessionId: this.sessionId
    });
  }

  async handleAnswer(answer) {
    if (this.pc.signalingState === 'closed') return;
    this.onStatus("PRIMIT ANSWER");
    this.remoteDescriptionUpdating = true;
    try {
      await this.pc.setRemoteDescription(
        new RTCSessionDescription(answer)
      );
    } finally {
      this.remoteDescriptionUpdating = false;
    }
    if (this.pc.signalingState === 'closed') return;
    const pending = this.pendingIce;
    this.pendingIce = [];
    for (const item of pending) {
      if (item.sessionId === this.sessionId)
        await this.handleIce(item.candidate);
    }
  }

  async handleIce(candidate) {
    if (this.pc.signalingState === 'closed') return;
    if (!this.pc.remoteDescription || this.remoteDescriptionUpdating) {
      this.pendingIce.push({
        candidate,
        sessionId: this.sessionId
      });
      return;
    }
    this.onStatus("PRIMIT ICE");
    try {
      await this.pc.addIceCandidate(
        new RTCIceCandidate(candidate)
      );
    } catch (e) {
      console.log(e);
    }
  }

  async logSelectedCandidatePair() {
    try {
      const stats = await this.pc.getStats();
      const byId = {};
      stats.forEach ? stats.forEach(v => { byId[v.id] = v; }) : Object.values(stats).forEach(v => { byId[v.id] = v; });

      const items = [];
      stats.forEach ? stats.forEach(v => items.push(v))
                    : Object.values(stats).forEach(v => items.push(v));

      let pair = null;

      const transport = items.find(v => v.type === "transport" && v.selectedCandidatePairId);
      if (transport) pair = byId[transport.selectedCandidatePairId];

      if (!pair) {
        pair = items.find(v => v.type === "candidate-pair" && v.selected === true);
      }

      if (!pair) {
        pair = items
          .filter(v => v.type === "candidate-pair" && (v.nominated || v.state === "succeeded"))
          .sort((a,b) => ((b.bytesSent||0)+(b.bytesReceived||0)) - ((a.bytesSent||0)+(a.bytesReceived||0)))[0];
      }

      if (!pair) {
        this.onStatus("WEBRTC ROUTE: unknown");
        return;
      }

      const local = byId[pair.localCandidateId];
      const remote = byId[pair.remoteCandidateId];

      const localType = local?.candidateType || "unknown";
      const remoteType = remote?.candidateType || "unknown";
      const localProto = local?.protocol || "unknown";
      const remoteProto = remote?.protocol || "unknown";

      this.onStatus("WEBRTC ROUTE: local=" + localType + "/" + localProto + " remote=" + remoteType + "/" + remoteProto);
    } catch (e) {
      this.onStatus("WEBRTC ROUTE ERR: " + (e.message || "stats"));
    }
  }

  send(data) {
    if (
      this.channel &&
      this.channel.readyState === "open"
    ) {
      this.channel.send(data);
    }
  }
}

