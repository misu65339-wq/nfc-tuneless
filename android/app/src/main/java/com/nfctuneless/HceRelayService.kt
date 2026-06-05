package com.nfctuneless

import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import android.util.Log
import org.json.JSONObject
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class HceRelayService : HostApduService() {

    companion object {
        const val TAG = "HceRelayService"
        val SW_OK = byteArrayOf(0x90.toByte(), 0x00)
        val SW_ERR = byteArrayOf(0x6F.toByte(), 0x00)

        // Queue pentru răspunsuri de la JS
        val responseQueue = LinkedBlockingQueue<ByteArray>(1)

        // Callback către JS
        var onApduReceived: ((String, String) -> Unit)? = null
        var isActive = false
    }

    override fun processCommandApdu(apdu: ByteArray, extras: Bundle?): ByteArray {
        val apduHex = apdu.joinToString("") { "%02X".format(it) }
        Log.d(TAG, "APDU primit de la POS: $apduHex")

        if (!isActive || onApduReceived == null) {
            return SW_ERR
        }

        // Trimite APDU la JavaScript prin callback
        val requestId = System.currentTimeMillis().toString()
        responseQueue.clear()
        onApduReceived?.invoke(requestId, apduHex)

        // Asteapta raspuns de la JS (max 4.5 secunde)
        val response = responseQueue.poll(4500, TimeUnit.MILLISECONDS)
        return response ?: SW_ERR
    }

    override fun onDeactivated(reason: Int) {
        Log.d(TAG, "HCE dezactivat: $reason")
        responseQueue.clear()
    }

    fun deliverResponse(apduHex: String) {
        val bytes = apduHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        responseQueue.offer(bytes)
    }
}
