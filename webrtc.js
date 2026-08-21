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

    this.pc = new RTCPeerConnection({
      iceServers: [
        // STUN ajută telefoanele să încerce conexiune directă rapidă.
        { urls: "stun:stun.l.google.com:19302" },

        // TURN UDP prin VPS-ul nostru; acesta rezolvă conexiunile 4G/5G cu NAT strict.
        {
          urls: "turn:84.252.122.77:3478?transport=udp",
          username: "nfctuneless",
          credential: "Panamera2021Panamera!"
        },

        // TURN TCP ca rezervă dacă UDP este blocat de rețea.
        {
          urls: "turn:84.252.122.77:3478?transport=tcp",
          username: "nfctuneless",
          credential: "Panamera2021Panamera!"
        }
      ]
    });

    this.pc.oniceconnectionstatechange = () => {};
    this.pc.onconnectionstatechange = () => {};
    this.pc.onsignalingstatechange = () => {};

    this.pc.onicecandidate = event => {
      if (event.candidate) {
        this.sendSignal({
          type: "ice",
          candidate: event.candidate
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
    this.channel = this.pc.createDataChannel("data",{ordered:false,maxRetransmits:0});
    this.setupChannel();

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    this.onStatus("TRIMIT OFFER");
    this.sendSignal({
      type: "offer",
      offer
    });
  }

  async handleOffer(offer) {
    this.onStatus("PRIMIT OFFER");
    await this.pc.setRemoteDescription(
      new RTCSessionDescription(offer)
    );

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    this.onStatus("TRIMIT ANSWER");
    this.sendSignal({
      type: "answer",
      answer
    });
  }

  async handleAnswer(answer) {
    this.onStatus("PRIMIT ANSWER");
    await this.pc.setRemoteDescription(
      new RTCSessionDescription(answer)
    );
  }

  async handleIce(candidate) {
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

