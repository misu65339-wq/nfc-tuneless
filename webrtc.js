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
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });

    this.pc.onicecandidate = event => {
      if (event.candidate) {
        this.onStatus("TRIMIT ICE");
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
    this.channel = this.pc.createDataChannel("data");
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

  send(data) {
    if (
      this.channel &&
      this.channel.readyState === "open"
    ) {
      this.channel.send(data);
    }
  }
}0

